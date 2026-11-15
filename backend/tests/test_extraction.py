import io
import pathlib

import pytest
from PIL import Image

from tryon import fetcher
from tryon.extract import pipeline
from tryon.extract.classify import classify_product
from tryon.extract.color import dominant_color
from tryon.extract.sizechart import is_size_label, map_label, parse_cell
from tryon.schemas import ProductInfo

FIX = pathlib.Path(__file__).parent / "fixtures"


def analyze(name: str, url: str = "https://shop.test/p/x"):
    return pipeline.analyze_html((FIX / name).read_text(), url, with_color=False)


# ── celle e etichette ────────────────────────────────────────────────────────
@pytest.mark.parametrize("text,expected", [
    ("94", (94, 94, None)), ("88-92", (88, 92, None)), ("88 – 92 cm", (88, 92, "cm")), ("36,5", (36.5, 36.5, None)),
    ("23 1/2", (23.5, 23.5, None)), ('39.5"', (39.5, 39.5, "in")), ("21½", (21.5, 21.5, None)), ("100 cm", (100, 100, "cm")),
])
def test_parse_cell(text, expected):
    assert parse_cell(text) == expected


@pytest.mark.parametrize("text", ["", "S", "n/d", "cotone 100%" * 4])
def test_parse_cell_rejects_non_measures(text):
    assert parse_cell(text) is None


def test_size_labels():
    assert all(is_size_label(x) for x in ["S", "xl", "XXL", "2XL", "One Size", "46", "M (46)"])
    assert not any(is_size_label(x) for x in ["Chest", "Length", ""])


@pytest.mark.parametrize("label,key", [
    ("Chest (pit to pit)", "chest"), ("Torace", "chest"), ("Vita", "waist"), ("Fianchi", "hips"), ("Sleeve length", "sleeve"),
    ("Lunghezza manica", "sleeve"), ("Body Length", "length"), ("Shoulder", "shoulder"), ("Hem", "hem"), ("Peso", None),
    ("Sleeve opening", "sleeve_opening"), ("Tour de poitrine", "chest"), ("Brustumfang", "chest")])
def test_map_label(label, key):
    assert map_label(label)[0] == key


# ── dati prodotto ────────────────────────────────────────────────────────────
def test_structured_jsonld_product():
    r = analyze("tshirt_shopify_garment.html")
    p = r.product
    assert p.name == "Classic Heavyweight Tee" and p.sources["name"] == "json-ld"
    assert p.brand == "ACME Basics" and p.color == "Navy"
    assert [i.url for i in p.images][:2] == ["https://cdn.acme.test/tee-front.jpg", "https://cdn.acme.test/tee-back.jpg"]
    assert len(p.images) == 2                                                          # og:image (//cdn...) coincide e viene deduplicata
    assert p.sizes_available == ["S", "M", "L", "XL"]
    assert p.breadcrumbs == ["Men", "T-Shirts"]


def test_structured_microdata_and_html_fallbacks():
    r = analyze("hoodie_it_body.html", "https://shop.test/it/felpa")
    p = r.product
    assert p.name == "Felpa con cappuccio uomo Essential"
    assert p.color == "Nero" and p.sources["color"] == "microdata"
    assert "https://shop.test/img/felpa-1.jpg" in [i.url for i in p.images]
    assert p.sizes_available == ["S", "M", "L", "XL"] and p.sources["sizes_available"] == "html-select"
    assert p.breadcrumbs[-1] == "Felpe"


def test_page_title_suffix_is_stripped():
    html = "<html><head><title>Womens Juniper Zip Hoodie | Recycled Materials | Shop</title></head><body></body></html>"
    r = pipeline.analyze_html(html, "https://x.test/p", with_color=False)
    assert r.product.name == "Womens Juniper Zip Hoodie" and r.classification.category == "hoodie"


def test_missing_data_stays_missing():
    r = analyze("unknown_kind.html")
    assert r.product.brand is None and r.product.color is None and r.product.images == []
    assert {w.code for w in r.warnings} >= {"no_image"}


# ── classificazione ──────────────────────────────────────────────────────────
@pytest.mark.parametrize("name,url,expected", [
    ("Classic Heavyweight Tee", "https://x.test/tee", "tshirt"),
    ("Maglietta girocollo cotone", "https://x.test/m", "tshirt"),
    ("Felpa con cappuccio uomo", "https://x.test/f", "hoodie"),
    ("Zip Hoodie Essential", "https://x.test/h", "hoodie"),
    ("Kapuzenpullover Basic", "https://x.test/k", "hoodie"),
    ("Sweatshirt with hood", "https://x.test/w", "hoodie"),
    ("Robin Hood Tee", "https://x.test/r", "tshirt"),
    ("Slim Fit Jeans", "https://x.test/j", "unknown"),
    ("Crewneck Sweatshirt", "https://x.test/c", "unknown"),
    ("Something", "https://x.test/p", "unknown"),
])
def test_classification_by_name(name, url, expected):
    assert classify_product(ProductInfo(name=name), url).category == expected


def test_classification_uses_breadcrumbs_and_category():
    p = ProductInfo(name="Essential Pullover", breadcrumbs=["Men", "Hoodies"])
    assert classify_product(p, "https://x.test/p").category == "hoodie"
    p = ProductInfo(name="Everyday", category_raw="Apparel > T-Shirts")
    assert classify_product(p, "https://x.test/p").category == "tshirt"


def test_classification_conflict_is_unknown_not_forced():
    c = classify_product(ProductInfo(name="Hoodie", breadcrumbs=["T-Shirts"], category_raw="T-shirt"), "https://x.test/p")
    assert c.category in ("hoodie", "unknown")            # mai una sicurezza alta su indizi contrastanti
    assert c.confidence < 0.9


# ── size chart ───────────────────────────────────────────────────────────────
def test_garment_flat_chart_is_doubled_and_labelled():
    r = analyze("tshirt_shopify_garment.html")
    c = r.size_chart
    assert c.kind == "garment" and c.unit == "cm" and not c.unit_assumed
    assert [row.size for row in c.rows] == ["S", "M", "L", "XL"]
    m = c.rows[1].measures
    assert m["chest"].value_cm == 104.0 and "x2" in m["chest"].note                # 52 a piatto -> 104
    assert m["length"].value_cm == 70 and m["sleeve"].value_cm == 22 and m["shoulder"].value_cm == 47
    assert {col.key for col in c.columns} == {"chest", "length", "sleeve", "shoulder"}


def test_body_chart_with_ranges():
    r = analyze("hoodie_it_body.html")
    c = r.size_chart
    assert c.kind == "body"
    chest = c.rows[0].measures["chest"]
    assert (chest.min_cm, chest.max_cm, chest.value_cm) == (88, 92, 90)
    assert c.rows[1].measures["waist"].value_cm == 84 and c.rows[3].measures["hips"].value_cm == 118
    assert "x2" not in (chest.note or "")                                              # il corpo non va raddoppiato


def test_transposed_inches_chart_converted_to_cm():
    r = analyze("hoodie_inches_transposed.html")
    c = r.size_chart
    assert c.kind == "garment" and c.unit == "in"
    assert [row.size for row in c.rows] == ["S", "M", "L", "XL"]
    chest_l = c.rows[2].measures["chest"]
    assert chest_l.value_cm == pytest.approx(23.5 * 2.54 * 2, abs=0.05)              # 1/2 chest, pollici, frazione
    assert c.rows[0].measures["length"].value_cm == pytest.approx(26 * 2.54, abs=0.05)
    assert "sleeve_cb" in {col.key for col in c.columns} or "sleeve" in {col.key for col in c.columns}
    assert r.classification.category == "hoodie"


def test_unknown_kind_is_declared_not_guessed():
    r = analyze("unknown_kind.html")
    c = r.size_chart
    assert c.kind == "unknown" and c.kind_hint == "garment"
    assert any(w.code == "chart_kind_unknown" for w in r.warnings)
    assert c.rows[0].measures["chest"].value_cm == 108                                  # 108 e' una circonferenza: nessun x2


def test_no_chart_reports_explicitly():
    r = analyze("tshirt_no_chart.html")
    assert r.size_chart is None
    codes = {w.code for w in r.warnings}
    assert "size_chart_image_only" in codes and "no_size_chart" not in codes
    assert r.classification.category == "tshirt"


def test_unit_ambiguity_is_flagged():
    html = "<html><body><h1>Tee</h1><table><tr><th>Size</th><th>Chest</th><th>Length</th></tr><tr><td>M</td><td>40</td><td>28</td></tr><tr><td>L</td><td>42</td><td>29</td></tr></table></body></html>"
    r = pipeline.analyze_html(html, "https://x.test/t", with_color=False)
    c = r.size_chart
    assert c.unit_assumed and c.unit == "in"
    assert c.rows[0].measures["chest"].value_cm == pytest.approx(40 * 2.54, abs=0.1)
    assert any("unita'" in w for w in c.warnings)


def test_broken_table_does_not_break_page():
    html = "<html><body><table><tr><td>a</td></tr></table><table><tr><th>Size</th></tr></table></body></html>"
    assert pipeline.analyze_html(html, "https://x.test/t", with_color=False).size_chart is None


# ── fetcher ──────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("url", ["file:///etc/passwd", "ftp://x.test/a", "http://localhost:8000/", "http://127.0.0.1/",
                                 "http://10.0.0.5/x", "http://192.168.1.2/", "http://169.254.169.254/latest/meta-data",
                                 "http://user:pw@example.com/", "javascript:alert(1)", "not a url"])
def test_ssrf_and_bad_urls_rejected(url):
    with pytest.raises(fetcher.FetchError):
        fetcher.check_url(url)


def test_captcha_page_is_reported_not_bypassed():
    html = (FIX / "blocked_captcha.html").read_text()
    assert fetcher._looks_blocked(200, html) and fetcher._looks_blocked(403, "<html>forbidden</html>")
    assert not fetcher._looks_blocked(200, "<html>" + "prodotto " * 5000 + "</html>")


# ── colore ───────────────────────────────────────────────────────────────────
def _png(color, size=(80, 80), bg=(255, 255, 255)):
    im = Image.new("RGB", size, bg)
    for x in range(20, 60):
        for y in range(10, 70):
            im.putpixel((x, y), color)
    b = io.BytesIO(); im.save(b, "PNG"); return b.getvalue()


def test_dominant_color_ignores_white_background():
    hexv = dominant_color(_png((30, 60, 120)))
    r, g, b = (int(hexv[i:i + 2], 16) for i in (1, 3, 5))
    assert abs(r - 30) < 14 and abs(g - 60) < 14 and abs(b - 120) < 14


def test_dominant_color_bad_data():
    assert dominant_color(b"not an image") is None
