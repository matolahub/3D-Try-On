"""Orchestrazione: URL -> pagina -> dati prodotto, categoria, size chart, avvisi."""
from typing import List

from bs4 import BeautifulSoup

from .. import fetcher
from ..schemas import ExtractResult, ExtractWarning, SizeChart
from .classify import classify_product
from .color import dominant_color
from .sizechart import find_size_charts, has_image_only_size_guide
from .structured import extract_product


def _pick_best(charts: List[SizeChart]):
    return (charts[0], charts[1:]) if charts else (None, [])


def analyze_html(html: str, url: str, final_url: str = None, with_color: bool = True) -> ExtractResult:
    final_url = final_url or url
    soup = BeautifulSoup(html, "html.parser")
    product = extract_product(soup, final_url)
    classification = classify_product(product, final_url)
    charts = find_size_charts(soup)
    best, others = _pick_best(charts)

    warnings: List[ExtractWarning] = []
    def warn(code: str, msg: str) -> None:
        warnings.append(ExtractWarning(code=code, message=msg))

    if not product.name:
        warn("no_name", "Nome del prodotto non trovato.")
    if not product.images:
        warn("no_image", "Nessuna immagine prodotto trovata.")
    if classification.category == "unknown":
        warn("category_unknown", "Impossibile distinguere con certezza t-shirt/hoodie: scegli la categoria a mano.")
    elif classification.confidence < 0.6:
        warn("category_low_confidence", "Categoria dedotta con bassa confidenza: verificala.")
    if best is None:
        if has_image_only_size_guide(soup):
            warn("size_chart_image_only", "La size chart sembra essere solo un'immagine: non posso leggerla. Inserisci le misure a mano.")
        else:
            warn("no_size_chart", "Nessuna size chart trovata nella pagina. Verranno usati valori del template (segnalati come tali).")
    else:
        if best.kind == "unknown":
            warn("chart_kind_unknown", f"La tabella non dichiara se le misure sono del capo o del corpo (ipotesi: {best.kind_hint or 'nessuna'}). Verificalo.")
        for w in best.warnings:
            warn("chart_assumption", w)
    if not product.sizes_available and best is None:
        warn("no_sizes", "Taglie disponibili non trovate.")

    color = None
    if with_color and product.images:
        for img in product.images[:2]:
            data = fetcher.fetch_image(img.url)
            if data:
                color = dominant_color(data)
                if color:
                    break

    return ExtractResult(url=url, final_url=final_url, product=product, classification=classification, size_chart=best,
                         other_size_charts=others, dominant_color=color, warnings=warnings)


def extract_from_url(url: str) -> ExtractResult:
    html, final_url, _ = fetcher.fetch_html(url)
    return analyze_html(html, url, final_url)
