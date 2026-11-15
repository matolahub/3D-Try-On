import http.server
import pathlib
import threading

import pytest
from fastapi.testclient import TestClient

import main

FIX = pathlib.Path(__file__).parent / "fixtures"
client = TestClient(main.app)


@pytest.fixture(scope="module")
def site():
    """Piccolo sito locale con pagine prodotto, un redirect, un robots.txt e una pagina con captcha."""
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a): pass
        def do_GET(self):
            if self.path == "/robots.txt":
                body, code, ct = b"User-agent: *\nDisallow: /private/\n", 200, "text/plain"
            elif self.path == "/old":
                self.send_response(301); self.send_header("Location", "/tee"); self.end_headers(); return
            elif self.path == "/private/tee":
                body, code, ct = (FIX / "tshirt_shopify_garment.html").read_bytes(), 200, "text/html; charset=utf-8"
            elif self.path == "/tee":
                body, code, ct = (FIX / "tshirt_shopify_garment.html").read_bytes(), 200, "text/html; charset=utf-8"
            elif self.path == "/hoodie":
                body, code, ct = (FIX / "hoodie_it_body.html").read_bytes(), 200, "text/html; charset=utf-8"
            elif self.path == "/blocked":
                body, code, ct = (FIX / "blocked_captcha.html").read_bytes(), 403, "text/html"
            elif self.path == "/data.json":
                body, code, ct = b"{}", 200, "application/json"
            else:
                body, code, ct = b"nope", 404, "text/plain"
            self.send_response(code); self.send_header("Content-Type", ct); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)

    srv = http.server.HTTPServer(("127.0.0.1", 0), H)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


@pytest.fixture(autouse=True)
def local_env(monkeypatch):
    monkeypatch.setenv("TRYON_ALLOW_PRIVATE_HOSTS", "1")          # solo per i test locali
    monkeypatch.setattr("tryon.fetcher.fetch_image", lambda url: None)


def test_health():
    assert client.get("/health").json() == {"status": "ok"}


def test_extract_end_to_end_over_http(site):
    r = client.post("/api/extract", json={"url": f"{site}/tee"})
    assert r.status_code == 200
    d = r.json()
    assert d["product"]["name"] == "Classic Heavyweight Tee"
    assert d["classification"]["category"] == "tshirt"
    assert d["size_chart"]["kind"] == "garment" and len(d["size_chart"]["rows"]) == 4


def test_redirect_is_followed(site):
    r = client.post("/api/extract", json={"url": f"{site}/old"})
    assert r.status_code == 200 and r.json()["final_url"].endswith("/tee")


def test_hoodie_italian_page(site):
    d = client.post("/api/extract", json={"url": f"{site}/hoodie"}).json()
    assert d["classification"]["category"] == "hoodie" and d["size_chart"]["kind"] == "body"


def test_robots_disallow_is_respected(site):
    r = client.post("/api/extract", json={"url": f"{site}/private/tee"})
    assert r.status_code == 403 and r.json()["detail"]["code"] == "robots_disallowed"


def test_antibot_page_returns_explicit_error(site):
    r = client.post("/api/extract", json={"url": f"{site}/blocked"})
    assert r.status_code == 422 and r.json()["detail"]["code"] == "blocked_by_site"


def test_non_html_and_404(site):
    assert client.post("/api/extract", json={"url": f"{site}/data.json"}).json()["detail"]["code"] in ("not_html", "http_error")
    assert client.post("/api/extract", json={"url": f"{site}/missing"}).json()["detail"]["code"] == "http_error"


def test_private_hosts_blocked_by_default(monkeypatch):
    monkeypatch.delenv("TRYON_ALLOW_PRIVATE_HOSTS")
    r = client.post("/api/extract", json={"url": "http://127.0.0.1:9/x"})
    assert r.status_code == 400 and r.json()["detail"]["code"] == "forbidden_host"


def test_invalid_url():
    assert client.post("/api/extract", json={"url": "ciao"}).status_code == 400
