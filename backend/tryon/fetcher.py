"""Download sicuro di pagine web.

- solo http/https; host risolti e rifiutati se privati/loopback/link-local (protezione SSRF);
- redirect seguiti a mano, ricontrollando ogni hop;
- timeout e dimensione massima; rispetto di robots.txt;
- se il sito risponde con captcha/challenge anti-bot ci si ferma con un errore esplicito: NESSUN bypass.
"""
import ipaddress
import os
import re
import socket
from typing import Optional, Tuple
from urllib import robotparser
from urllib.parse import urljoin, urlparse

import httpx

USER_AGENT = "3DTryOnBot/0.1 (+prototipo; richiesta singola avviata dall'utente)"
MAX_BYTES = 3 * 1024 * 1024
MAX_IMAGE_BYTES = 4 * 1024 * 1024
TIMEOUT = 10.0
MAX_REDIRECTS = 5

_BLOCK_MARKERS = re.compile(
    r"(just a moment\.\.\.|cf-browser-verification|cf-chl|attention required|px-captcha|captcha-delivery|"
    r"g-recaptcha|h-captcha|access denied|pardon our interruption|are you a robot|verify you are human|"
    r"unusual traffic)", re.I)


class FetchError(Exception):
    def __init__(self, code: str, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def _allow_private() -> bool:
    return os.environ.get("TRYON_ALLOW_PRIVATE_HOSTS") == "1"        # solo sviluppo/test locali


def _respect_robots() -> bool:
    return os.environ.get("TRYON_RESPECT_ROBOTS", "1") != "0"


def check_url(url: str) -> str:
    """Valida schema e host. Ritorna l'URL normalizzato oppure solleva FetchError."""
    p = urlparse(url.strip())
    if p.scheme not in ("http", "https") or not p.hostname:
        raise FetchError("invalid_url", "Inserisci un URL http(s) valido.")
    if p.username or p.password:
        raise FetchError("invalid_url", "URL con credenziali non supportato.")
    if not _allow_private():
        try:
            infos = socket.getaddrinfo(p.hostname, p.port or (443 if p.scheme == "https" else 80), proto=socket.IPPROTO_TCP)
        except socket.gaierror:
            raise FetchError("dns_error", "Impossibile risolvere il dominio.")
        for info in infos:
            ip = ipaddress.ip_address(info[4][0])
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_multicast or ip.is_reserved or ip.is_unspecified:
                raise FetchError("forbidden_host", "Indirizzo non consentito (rete locale/privata).")
    return p.geturl()


def _robots_allows(client: httpx.Client, url: str) -> bool:
    if not _respect_robots():
        return True
    p = urlparse(url)
    try:
        r = client.get(f"{p.scheme}://{p.netloc}/robots.txt", timeout=5.0)
        if r.status_code >= 400:
            return True                                             # nessun robots.txt utilizzabile
        rp = robotparser.RobotFileParser()
        rp.parse(r.text.splitlines())
        return rp.can_fetch(USER_AGENT, url)
    except Exception:
        return True


def _looks_blocked(status: int, body: str) -> bool:
    if status in (401, 403, 429, 503) and (len(body) < 60_000 or _BLOCK_MARKERS.search(body)):
        return True
    return len(body) < 20_000 and bool(_BLOCK_MARKERS.search(body))


def _get(client: httpx.Client, url: str, max_bytes: int) -> Tuple[httpx.Response, bytes, str]:
    for _ in range(MAX_REDIRECTS + 1):
        url = check_url(url)
        with client.stream("GET", url) as r:
            if r.is_redirect and r.headers.get("location"):
                url = urljoin(url, r.headers["location"])
                continue
            data = b""
            for chunk in r.iter_bytes():
                data += chunk
                if len(data) > max_bytes:
                    data = data[:max_bytes]
                    break
            return r, data, url
    raise FetchError("too_many_redirects", "Troppi reindirizzamenti.")


def make_client() -> httpx.Client:
    return httpx.Client(headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
                                 "Accept-Language": "it,en;q=0.8"}, timeout=TIMEOUT, follow_redirects=False)


def fetch_html(url: str) -> Tuple[str, str, int]:
    """Ritorna (html, final_url, status)."""
    url = check_url(url)
    with make_client() as client:
        if not _robots_allows(client, url):
            raise FetchError("robots_disallowed", "Il sito non consente l'accesso automatico a questa pagina (robots.txt).")
        try:
            r, data, final_url = _get(client, url, MAX_BYTES)
        except httpx.HTTPError as e:
            raise FetchError("network_error", f"Errore di rete: {type(e).__name__}.")
        text = data.decode(r.encoding or "utf-8", errors="replace")
        if _looks_blocked(r.status_code, text):
            raise FetchError("blocked_by_site", "Il sito ha bloccato la richiesta automatica (anti-bot/captcha). "
                             "Non provo ad aggirarlo: inserisci le misure del capo a mano.", r.status_code)
        if r.status_code >= 400:
            raise FetchError("http_error", f"La pagina ha risposto con errore HTTP {r.status_code}.", r.status_code)
        ctype = r.headers.get("content-type", "")
        if "html" not in ctype and "xml" not in ctype and "<html" not in text[:2000].lower():
            raise FetchError("not_html", "L'URL non punta a una pagina HTML.")
        return text, final_url, r.status_code


def fetch_image(url: str) -> Optional[bytes]:
    """Scarica un'immagine (solo per il colore dominante). Ritorna None se non disponibile."""
    try:
        with make_client() as client:
            r, data, _ = _get(client, url, MAX_IMAGE_BYTES)
            if r.status_code >= 400 or not r.headers.get("content-type", "").startswith("image/"):
                return None
            return data
    except (FetchError, httpx.HTTPError):
        return None
