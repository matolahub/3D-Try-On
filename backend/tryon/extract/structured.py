"""Estrazione dei dati prodotto da JSON-LD, microdata, OpenGraph e meta tag. Nessun dato viene inventato."""
import json
import re
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import urljoin

from bs4 import BeautifulSoup

from ..schemas import ImageRef, ProductInfo

_SIZE_PLACEHOLDER = re.compile(r"^((seleziona|scegli|select|choose|pick|wähle|elige|choisir)\b.*|--.*|—.*|taglia|size)$", re.I)


def _as_list(x: Any) -> list:
    if x is None:
        return []
    return x if isinstance(x, list) else [x]


def _text(x: Any) -> Optional[str]:
    if isinstance(x, str):
        t = " ".join(x.split())
        return t or None
    if isinstance(x, dict):
        return _text(x.get("name") or x.get("@value") or x.get("value"))
    return None


def _walk_jsonld(node: Any) -> Iterable[dict]:
    """Tutti i nodi dict di un documento JSON-LD (gestisce @graph e annidamenti)."""
    if isinstance(node, list):
        for n in node:
            yield from _walk_jsonld(n)
    elif isinstance(node, dict):
        yield node
        for k, v in node.items():
            if k != "@context" and isinstance(v, (dict, list)):
                yield from _walk_jsonld(v)


def _types(node: dict) -> List[str]:
    return [str(t).lower().rsplit("/", 1)[-1] for t in _as_list(node.get("@type"))]


def load_jsonld(soup: BeautifulSoup) -> List[dict]:
    out = []
    for s in soup.find_all("script", attrs={"type": re.compile(r"ld\+json", re.I)}):
        raw = (s.string or s.get_text() or "").strip()
        if not raw:
            continue
        try:
            out.extend(_walk_jsonld(json.loads(raw)))
        except ValueError:
            try:                                                  # alcuni siti lasciano virgole/commenti: ultimo tentativo
                out.extend(_walk_jsonld(json.loads(re.sub(r",\s*([}\]])", r"\1", raw))))
            except ValueError:
                continue
    return out


def _image_urls(value: Any) -> List[str]:
    urls = []
    for v in _as_list(value):
        if isinstance(v, str):
            urls.append(v)
        elif isinstance(v, dict):
            u = v.get("url") or v.get("contentUrl") or v.get("@id")
            if isinstance(u, str):
                urls.append(u)
    return urls


def _add_images(info: ProductInfo, base: str, urls: Iterable[str], source: str) -> None:
    seen = {i.url for i in info.images}
    for u in urls:
        u = (u or "").strip()
        if not u or u.startswith("data:"):
            continue
        full = urljoin(base, u)
        if full not in seen:
            seen.add(full)
            info.images.append(ImageRef(url=full, source=source))


def _set(info: ProductInfo, field: str, value: Optional[str], source: str) -> None:
    if value and not getattr(info, field):
        setattr(info, field, value)
        info.sources[field] = source


def _crumb_name(i: dict) -> Optional[str]:
    item = i.get("item")
    return _text(i.get("name")) or (_text(item.get("name")) if isinstance(item, dict) else None)


def _from_jsonld(nodes: List[dict], info: ProductInfo, base: str) -> None:
    products = [n for n in nodes if {"product", "productgroup"} & set(_types(n))]
    for n in products:
        _set(info, "name", _text(n.get("name")), "json-ld")
        _set(info, "brand", _text(n.get("brand")), "json-ld")
        _set(info, "description", _text(n.get("description")), "json-ld")
        _set(info, "category_raw", _text(n.get("category")), "json-ld")
        _set(info, "color", _text(n.get("color")), "json-ld")
        _add_images(info, base, _image_urls(n.get("image")), "json-ld")
        variants = _as_list(n.get("hasVariant")) + _as_list(n.get("offers"))
        for v in [n] + [x for x in variants if isinstance(x, dict)]:
            for key in ("size", "sizeName"):
                for s in _as_list(v.get(key)):
                    t = _text(s)
                    if t and t not in info.sizes_available:
                        info.sizes_available.append(t)
            _set(info, "color", _text(v.get("color")), "json-ld")
            for off in _as_list(v.get("offers")):
                if isinstance(off, dict):
                    for s in _as_list(off.get("size")):
                        t = _text(s)
                        if t and t not in info.sizes_available:
                            info.sizes_available.append(t)
    for n in nodes:
        if "breadcrumblist" in _types(n) and not info.breadcrumbs:
            items = sorted((i for i in _as_list(n.get("itemListElement")) if isinstance(i, dict)),
                           key=lambda i: i.get("position") or 0)
            crumbs = [_crumb_name(i) for i in items]
            info.breadcrumbs = [c for c in crumbs if c]
            if info.breadcrumbs:
                info.sources["breadcrumbs"] = "json-ld"


def _from_microdata(soup: BeautifulSoup, info: ProductInfo, base: str) -> None:
    scope = soup.find(attrs={"itemtype": re.compile(r"schema\.org/Product", re.I)})
    if not scope:
        return
    def prop(name: str):
        return scope.find(attrs={"itemprop": name})
    def val(tag) -> Optional[str]:
        if tag is None:
            return None
        return _text(tag.get("content") or tag.get_text(" "))
    _set(info, "name", val(prop("name")), "microdata")
    _set(info, "description", val(prop("description")), "microdata")
    _set(info, "category_raw", val(prop("category")), "microdata")
    _set(info, "color", val(prop("color")), "microdata")
    b = prop("brand")
    if b is not None:
        n = b.find(attrs={"itemprop": "name"})
        _set(info, "brand", val(n) or val(b), "microdata")
    urls = [t.get("src") or t.get("content") or t.get("href") for t in scope.find_all(attrs={"itemprop": "image"})]
    _add_images(info, base, [u for u in urls if u], "microdata")


def _meta(soup: BeautifulSoup, *names: str) -> List[str]:
    out = []
    for n in names:
        for t in soup.find_all("meta", attrs={"property": n}) + soup.find_all("meta", attrs={"name": n}):
            c = (t.get("content") or "").strip()
            if c:
                out.append(c)
    return out


def _sizes_from_html(soup: BeautifulSoup, info: ProductInfo) -> None:
    if info.sizes_available:
        return
    for sel in soup.find_all("select"):
        cls = sel.get("class") or []
        ident = " ".join([str(sel.get(a, "")) for a in ("name", "id", "aria-label", "data-option-name")]
                         + (cls if isinstance(cls, list) else [str(cls)])).lower()
        if not re.search(r"\b(size|taglia|talla|taille|grösse|größe)\b|size|taglia", ident):
            continue
        for opt in sel.find_all("option"):
            t = _text(opt.get_text(" "))
            if t and not _SIZE_PLACEHOLDER.match(t) and t not in info.sizes_available:
                info.sizes_available.append(t)
        if info.sizes_available:
            info.sources["sizes_available"] = "html-select"
            return


def extract_product(soup: BeautifulSoup, base_url: str) -> ProductInfo:
    info = ProductInfo()
    jsonld = load_jsonld(soup)
    _from_jsonld(jsonld, info, base_url)
    if info.sizes_available:
        info.sources["sizes_available"] = "json-ld"
    _from_microdata(soup, info, base_url)

    og_title = _meta(soup, "og:title")
    _set(info, "name", og_title[0] if og_title else None, "opengraph")
    _set(info, "description", (_meta(soup, "og:description", "description") or [None])[0], "meta")
    _set(info, "brand", (_meta(soup, "og:brand", "product:brand") or [None])[0], "opengraph")
    _set(info, "category_raw", (_meta(soup, "product:category", "article:section") or [None])[0], "opengraph")
    _set(info, "color", (_meta(soup, "product:color") or [None])[0], "opengraph")
    _add_images(info, base_url, _meta(soup, "og:image", "og:image:url", "og:image:secure_url"), "opengraph")
    _add_images(info, base_url, _meta(soup, "twitter:image", "twitter:image:src"), "twitter")
    if not info.name:
        h1 = soup.find("h1")
        _set(info, "name", _text(h1.get_text(" ")) if h1 else None, "html-h1")
    if not info.name and soup.title:
        _set(info, "name", _text(soup.title.get_text()), "html-title")
    if not info.images:
        imgs = [i.get("src") for i in soup.find_all("img") if i.get("src") and re.search(r"product|prodotto|zoom|large|main", " ".join(i.get("class") or []) + (i.get("src") or ""), re.I)]
        _add_images(info, base_url, imgs[:4], "html")
    if not info.breadcrumbs:
        nav = soup.find(attrs={"aria-label": re.compile(r"breadcrumb|briciole", re.I)}) or soup.find(class_=re.compile(r"breadcrumb", re.I))
        if nav:
            crumbs = [_text(li.get_text(" ")) for li in nav.find_all(["li", "a"])]
            info.breadcrumbs = [c for i, c in enumerate(crumbs) if c and c not in crumbs[:i]]
            if info.breadcrumbs:
                info.sources["breadcrumbs"] = "html"
    _sizes_from_html(soup, info)
    # i titoli di pagina/OpenGraph spesso hanno il suffisso "| Negozio | Slogan": il nome prodotto e' la prima parte
    if info.name and info.sources.get("name") in ("opengraph", "html-title", "html-h1") and " | " in info.name:
        info.name = info.name.split(" | ")[0].strip() or info.name
    return info
