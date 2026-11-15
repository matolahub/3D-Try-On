"""Estrazione e normalizzazione delle size chart da tabelle HTML.

Cosa fa
- trova le <table> che sembrano tabelle taglie (anche trasposte: taglie sulle colonne);
- mappa le colonne su misure canoniche (multilingua IT/EN/FR/DE/ES);
- normalizza in cm (rileva cm/pollici) e i range ("88-92" -> punto medio + min/max);
- distingue misure del CAPO ("garment") da misure del CORPO ("body") usando il contesto (titoli, tab, didascalie,
  intestazioni) e, in mancanza, euristiche dichiarate come tali;
- distingue larghezza a piatto (meta' circonferenza) da circonferenza.
Non inventa mai valori: se una cella non e' leggibile la misura manca.
"""
import re
from statistics import median
from typing import Dict, List, Optional, Tuple

from bs4 import BeautifulSoup, Tag

from ..schemas import ChartColumn, Measure, SizeChart, SizeRow

# ── Etichette delle colonne → misura canonica (ordine = priorita') ────────────
_KEYS: List[Tuple[str, re.Pattern]] = [
    ("sleeve_opening", re.compile(r"(sleeve|manica|manche|ärmel|armel|manga).*(opening|cuff|hem|apertura|polsino|ouverture|bordo)|cuff\b|polsino|sleeve opening", re.I)),
    ("sleeve_cb", re.compile(r"(center|centre|centro|milieu|mitte).*(back|schiena|dos|rücken|espalda).*(sleeve|manica|manche|ärmel|manga)|(sleeve|manica|manche|ärmel|manga).*(center|centre|centro).*(back|schiena|dos)", re.I)),
    ("sleeve", re.compile(r"sleeve|manica|maniche|manche|ärmel|armel|armlänge|manga", re.I)),
    ("shoulder", re.compile(r"shoulder|spalla|spalle|épaule|epaule|schulter|hombro", re.I)),
    ("bicep", re.compile(r"bicep|upper arm|bicipite|braccio|oberarm|biceps", re.I)),
    ("neck", re.compile(r"\bneck\b|\bcollo\b|\bcou\b|\bhals\b|cuello", re.I)),
    ("hem", re.compile(r"\bhem\b|bottom|\borlo\b|\bfondo\b|bas du|\bsaum\b|dobladillo", re.I)),
    ("hips", re.compile(r"\bhips?\b|fianchi|bacino|hanches?|hüfte|hufte|cadera", re.I)),
    ("waist", re.compile(r"waist|\bvita\b|\btaille\b|taillenumfang|cintura|\bbund\b", re.I)),
    ("body_height", re.compile(r"body height|\bheight\b|altezza|körpergröße|korpergrosse|estatura|hauteur|statura", re.I)),
    ("length", re.compile(r"length|lunghezza|longueur|länge|lange\b|\blargo\b|\bhps\b", re.I)),
    ("chest", re.compile(r"chest|bust|torace|petto|torso|poitrine|brust|pecho|pit[\s-]*to[\s-]*pit|\bp2p\b|underarm|under arm|ascell|circonferenza torace|giro\s*torace", re.I)),
    ("width_generic", re.compile(r"\bwidth\b|larghezza|largeur|breite|\bancho\b", re.I)),
]
_HALF = re.compile(r"pit[\s-]*to[\s-]*pit|\bp2p\b|flat|laid flat|half|1/2|½|larghezza|\bwidth\b|a piatto|largeur|breite|\bancho\b|semi|mezza", re.I)
_CIRC = re.compile(r"circumference|circonferenza|giro|\btour\b|umfang|contorno", re.I)
_UNIT_CM = re.compile(r"\bcm\b|centim|\(cm\)", re.I)
_UNIT_IN = re.compile(r"(\bin\b|inch|inches|pollic|pouces?|zoll|pulgada|[\"”″]|\(in\))", re.I)

# ── Contesto: misure del capo vs del corpo ───────────────────────────────────
_GARMENT_CTX = re.compile(
    r"garment|product measure|item measure|product dimension|measurements? of (the )?(garment|product|item)|laid flat|lay flat|"
    r"flat measure|pit[\s-]*to[\s-]*pit|misure (del )?(capo|prodotto|articolo)|dimensioni (del )?(capo|prodotto)|misure a piatto|"
    r"mesures? (du )?(vêtement|vetement|produit)|produktma|artikelma|medidas (de la )?prenda", re.I)
_BODY_CTX = re.compile(
    r"body (measure|size|dimension)|your (body|measure)|measure (your|yourself)|how to measure|fits? (body|chest|to)|to fit|"
    r"misure (del )?(corpo|corporee)|misure corpo|corpo|come misurarti|mesures? (du )?corps|körperma|korperma|medidas (del )?cuerpo|"
    r"human|person|wearer", re.I)

_SIZE_WORD = re.compile(
    r"^(x{0,3}s|x{0,4}l|m|[2-6]\s?x[sl]|xs/s|s/m|m/l|l/xl|xl/xxl|xs-s|s-m|m-l|l-xl|"
    r"one\s*size|unica|taglia unica|os|uni|petite|regular|tall)$", re.I)
_SIZE_NUM = re.compile(r"^(?:[2-6]\d(?:\.5)?|1[0-9]{2})$")

_LENGTH_KEYS = {"length", "sleeve", "sleeve_cb", "shoulder", "body_height"}
_FRACTIONS = {"½": 0.5, "¼": 0.25, "¾": 0.75, "⅓": 1 / 3, "⅔": 2 / 3}
_NUM = r"(\d{1,3}(?:[.,]\d{1,2})?)(?:\s*(\d)/(\d)|\s*([½¼¾⅓⅔]))?"
_RANGE = re.compile(rf"^\D*{_NUM}\s*(?:[-–—]|to|a|/)\s*{_NUM}\D*$", re.I)
_SINGLE = re.compile(rf"^\D*{_NUM}\D*$")


def _norm(t: str) -> str:
    return " ".join((t or "").replace("\xa0", " ").split())


def _num(g: Tuple) -> float:
    v = float(g[0].replace(",", "."))
    if g[1] and g[2] and int(g[2]) != 0:
        v += int(g[1]) / int(g[2])
    elif g[3]:
        v += _FRACTIONS[g[3]]
    return v


def parse_cell(text: str) -> Optional[Tuple[float, float, Optional[str]]]:
    """(min, max, unit_hint) oppure None. Rifiuta celle che non sono una misura."""
    t = _norm(text)
    if not t or len(t) > 40:
        return None
    unit = "in" if _UNIT_IN.search(t) and not _UNIT_CM.search(t) else ("cm" if _UNIT_CM.search(t) else None)
    m = _RANGE.match(t)
    if m:
        a, b = _num(m.groups()[0:4]), _num(m.groups()[4:8])
        if a <= b:
            return a, b, unit
    m = _SINGLE.match(t)
    if m:
        v = _num(m.groups())
        return v, v, unit
    return None


def is_size_label(text: str) -> bool:
    t = _norm(text)
    t = re.sub(r"\(.*?\)", "", t).strip()
    return bool(t) and bool(_SIZE_WORD.match(t) or _SIZE_NUM.match(t))


def map_label(label: str) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """(chiave canonica, base 'half'|'circumference'|None, unita' 'cm'|'in'|None) per un'intestazione di colonna."""
    t = _norm(label)
    key = next((k for k, rx in _KEYS if rx.search(t)), None)
    basis = "half" if _HALF.search(t) else ("circumference" if _CIRC.search(t) else None)
    unit = "cm" if _UNIT_CM.search(t) else ("in" if _UNIT_IN.search(t) else None)
    return key, basis, unit


# ── Tabelle → griglia ────────────────────────────────────────────────────────
def table_grid(table: Tag) -> List[List[str]]:
    grid: List[List[str]] = []
    pending: Dict[Tuple[int, int], str] = {}
    for r, tr in enumerate(table.find_all("tr")):
        row: List[str] = []
        c = 0
        for cell in tr.find_all(["th", "td"], recursive=False) or tr.find_all(["th", "td"]):
            while (r, c) in pending:
                row.append(pending.pop((r, c))); c += 1
            txt = _norm(cell.get_text(" "))
            span = max(1, min(int(cell.get("colspan", 1) or 1), 12)) if str(cell.get("colspan", "1")).isdigit() else 1
            rspan = max(1, min(int(cell.get("rowspan", 1) or 1), 12)) if str(cell.get("rowspan", "1")).isdigit() else 1
            for _ in range(span):
                row.append(txt)
                for k in range(1, rspan):
                    pending[(r + k, c)] = txt
                c += 1
        while (r, c) in pending:
            row.append(pending.pop((r, c))); c += 1
        if any(row):
            grid.append(row)
    w = max((len(r) for r in grid), default=0)
    return [r + [""] * (w - len(r)) for r in grid]


def _root(node: Tag) -> Tag:
    while node.parent is not None:
        node = node.parent
    return node


def _attrs_text(node: Tag, names) -> List[str]:
    out = []
    for a in names:
        v = node.get(a)
        out.append(" ".join(v) if isinstance(v, list) else str(v or ""))
    return out


def _context(table: Tag) -> str:
    """Testo che descrive la tabella: didascalia, attributi, tab associata, titoli che la precedono."""
    parts: List[str] = []
    cap = table.find("caption")
    if cap:
        parts.append(_norm(cap.get_text(" ")))
    parts += _attrs_text(table, ("id", "class", "aria-label", "summary", "title"))
    root = _root(table)
    node: Optional[Tag] = table
    for _ in range(4):                                         # antenati: attributi + eventuale tab associata
        node = node.parent if node is not None else None
        if not isinstance(node, Tag):
            break
        parts += _attrs_text(node, ("id", "class", "aria-label", "data-title", "data-tab"))
        for i in str(node.get("aria-labelledby") or "").split():
            el = root.find(id=i)
            if el:
                parts.append(_norm(el.get_text(" "))[:80])
        nid = node.get("id")
        if nid:
            for t in root.find_all(attrs={"href": f"#{nid}"}) + root.find_all(attrs={"data-target": f"#{nid}"}) + root.find_all(attrs={"aria-controls": nid}):
                parts.append(_norm(t.get_text(" "))[:80])
    # testo che precede la tabella (titoli, note): fratelli precedenti, salendo di livello
    hops, cur = 0, table
    while cur is not None and hops < 5:
        sib = cur.find_previous_sibling()
        while sib is not None and hops < 5:
            if isinstance(sib, Tag):
                if sib.name == "table":
                    break
                if sib.name not in ("script", "style"):
                    parts.append(_norm(sib.get_text(" "))[:160])
                    hops += 1
            sib = sib.find_previous_sibling()
        cur = cur.parent if isinstance(cur.parent, Tag) and cur.parent.name not in ("body", "html", "[document]") else None
    return " | ".join(p for p in parts if p).lower()


def _decide_kind(context: str, header: str, rows: List[SizeRow], columns: List[ChartColumn]) -> Tuple[str, Optional[str], float, List[str]]:
    reasons: List[str] = []
    g = len(_GARMENT_CTX.findall(context + " " + header))
    b = len(_BODY_CTX.findall(context + " " + header))
    if g:
        reasons.append(f"contesto/intestazioni indicano misure del capo ({g} {'indizio' if g == 1 else 'indizi'})")
    if b:
        reasons.append(f"contesto/intestazioni indicano misure del corpo ({b} {'indizio' if b == 1 else 'indizi'})")
    if g and not b:
        return "garment", "garment", min(0.95, 0.7 + 0.1 * g), reasons
    if b and not g:
        return "body", "body", min(0.95, 0.7 + 0.1 * b), reasons
    if g and b:
        return "unknown", "garment" if g > b else "body", 0.4, reasons + ["indizi contrastanti"]
    # nessun indizio esplicito: euristiche deboli, dichiarate come tali
    keys = {c.key for c in columns}
    score_g = score_b = 0.0
    if keys & {"length", "shoulder", "sleeve", "sleeve_cb", "sleeve_opening", "bicep", "hem"}:
        score_g += 1.0; reasons.append("colonne tipiche del capo (lunghezza/spalla/manica)")
    if {"waist", "hips"} <= keys or "body_height" in keys:
        score_b += 1.0; reasons.append("colonne tipiche del corpo (vita+fianchi/altezza)")
    ranged = sum(1 for r in rows for m in r.measures.values() if m.min_cm is not None and m.max_cm is not None and m.max_cm > m.min_cm)
    tot = sum(len(r.measures) for r in rows) or 1
    if ranged / tot > 0.4:
        score_b += 0.7; reasons.append("molti intervalli (tipici delle misure corpo)")
    hint = "garment" if score_g > score_b else ("body" if score_b > score_g else None)
    return "unknown", hint, 0.3 if hint else 0.0, reasons + ["tipo di misure non dichiarato nella pagina"]


def parse_table(table: Tag, index: int) -> Optional[SizeChart]:
    grid = table_grid(table)
    if len(grid) < 2 or len(grid[0]) < 2:
        return None
    # Orientamento: le taglie sono nella prima colonna (normale) o nella riga di intestazione (trasposta)?
    col0 = sum(is_size_label(r[0]) for r in grid[1:])
    row0 = sum(is_size_label(c) for c in grid[0][1:])
    transposed = row0 > col0 and row0 >= 2
    if transposed:
        grid = [list(x) for x in zip(*grid)]
    # Riga di intestazione: la prima con almeno una colonna riconosciuta
    hdr = None
    for i in range(min(3, len(grid))):
        if any(map_label(c)[0] for c in grid[i][1:]):
            hdr = i
            break
    if hdr is None:
        return None
    header = grid[hdr]
    body = grid[hdr + 1:]
    unit_row: Optional[List[str]] = None
    if body:
        cells = [c for c in body[0][1:] if c]
        if cells and all(_UNIT_CM.search(c) or _UNIT_IN.search(c) for c in cells):
            unit_row, body = body[0], body[1:]                    # sotto-intestazione con solo le unita'
    body = [r for r in body if r and r[0] and (is_size_label(r[0]) or (len(r[0]) <= 24 and any(parse_cell(c) for c in r[1:])))]
    if len(body) < 1:
        return None

    context = _context(table)
    title = next((p.strip() for p in context.split("|") if p.strip()), None)
    table_unit: Optional[str] = None
    if _UNIT_CM.search(context):
        table_unit = "cm"
    elif _UNIT_IN.search(context):
        table_unit = "in"

    # Colonne
    cols: List[Tuple[int, str, Optional[str], Optional[str], str]] = []      # (idx, key, basis, unit, label)
    for j in range(1, len(header)):
        key, basis, unit = map_label(header[j])
        if unit_row and not unit and j < len(unit_row):
            unit = "cm" if _UNIT_CM.search(unit_row[j]) else ("in" if _UNIT_IN.search(unit_row[j]) else None)
        if key:
            cols.append((j, key, basis, unit, header[j]))
    if not cols:
        return None
    # width generico -> chest solo se manca una colonna chest
    if not any(c[1] == "chest" for c in cols):
        cols = [(j, "chest" if k == "width_generic" else k, b or ("half" if k == "width_generic" else None), u, l) for j, k, b, u, l in cols]
    cols = [c for c in cols if c[1] != "width_generic"]
    # stessa misura in cm e in pollici: tengo cm
    best: Dict[str, Tuple[int, str, Optional[str], Optional[str], str]] = {}
    for c in cols:
        cur = best.get(c[1])
        if cur is None or (c[3] == "cm" and cur[3] != "cm"):
            best[c[1]] = c
    cols = sorted(best.values())

    # Valori grezzi
    raw_rows: List[Tuple[str, Dict[str, Tuple[float, float, Optional[str], str]]]] = []
    for r in body:
        vals = {}
        for j, key, basis, unit, label in cols:
            if j < len(r):
                p = parse_cell(r[j])
                if p:
                    vals[key] = (p[0], p[1], p[2], r[j])
        if vals:
            raw_rows.append((re.sub(r"\s+", " ", r[0]).strip().upper(), vals))
    if not raw_rows:
        return None

    # Unita': per colonna (etichetta/cella) > tabella (contesto) > inferenza dichiarata
    warnings: List[str] = []
    unit_assumed = False
    col_unit: Dict[str, str] = {}
    for j, key, basis, unit, label in cols:
        cell_units = {v[key][2] for _, v in raw_rows if key in v and v[key][2]}
        u = unit or (cell_units.pop() if len(cell_units) == 1 else None) or table_unit
        if u:
            col_unit[key] = u
    if "chest" in col_unit:
        default_unit = col_unit["chest"]
    else:
        default_unit = next(iter(col_unit.values()), None)
    if default_unit is None:
        ref = [(v["chest"][0] + v["chest"][1]) / 2 for _, v in raw_rows if "chest" in v] or \
              [(v[k][0] + v[k][1]) / 2 for _, v in raw_rows for k in v if k in ("waist", "hips", "length")]
        med = median(ref) if ref else 100
        default_unit = "cm" if med >= 62 else ("in" if med <= 46 else "cm")
        unit_assumed = True
        warnings.append(f"unita' non indicata: assunta '{default_unit}' dai valori (mediana {med:.0f})")
    for j, key, *_ in cols:
        col_unit.setdefault(key, default_unit)

    # Misure normalizzate (cm); mantengo raw
    columns = [ChartColumn(key=key, label=label, unit=col_unit[key]) for j, key, basis, unit, label in cols]
    basis_hint = {key: basis for j, key, basis, unit, label in cols}
    rows: List[SizeRow] = []
    for size, vals in raw_rows:
        ms: Dict[str, Measure] = {}
        for key, (lo, hi, _u, raw) in vals.items():
            f = 2.54 if col_unit[key] == "in" else 1.0
            lo_cm, hi_cm = lo * f, hi * f
            note = "convertito da pollici" if f != 1.0 else None
            ms[key] = Measure(value_cm=round((lo_cm + hi_cm) / 2, 2), min_cm=round(lo_cm, 2) if hi > lo else None,
                              max_cm=round(hi_cm, 2) if hi > lo else None, raw=raw,
                              basis="length" if key in _LENGTH_KEYS else "circumference", note=note)
        rows.append(SizeRow(size=size, measures=ms))

    header_text = " ".join(header + (unit_row or []))
    kind, hint, conf, reasons = _decide_kind(context, header_text, rows, [ChartColumn(key=c.key, label=c.label, unit=c.unit) for c in columns])
    eff = kind if kind != "unknown" else (hint or "garment")

    # Larghezza a piatto -> circonferenza (x2): esplicita da etichetta, oppure ipotesi dichiarata su valori troppo piccoli
    for key in ("chest", "hem", "waist", "hips", "bicep", "sleeve_opening"):
        if key not in basis_hint:
            continue
        explicit = basis_hint[key] == "half"
        vals = [r.measures[key].value_cm for r in rows if key in r.measures]
        limit = {"chest": 62, "hem": 62, "waist": 50, "hips": 60, "bicep": 20, "sleeve_opening": 16}[key]
        implicit = (basis_hint[key] is None and eff == "garment" and key in ("chest", "hem", "waist", "hips") and vals and median(vals) < limit)
        if explicit or implicit:
            for r in rows:
                if key in r.measures:
                    m = r.measures[key]
                    m.value_cm = round(m.value_cm * 2, 2)
                    m.min_cm = round(m.min_cm * 2, 2) if m.min_cm is not None else None
                    m.max_cm = round(m.max_cm * 2, 2) if m.max_cm is not None else None
                    m.note = ("larghezza a piatto x2" if explicit else "ipotesi: valore troppo piccolo per una circonferenza, interpretato come larghezza a piatto x2")
            if implicit:
                warnings.append(f"'{key}': valori bassi interpretati come larghezza a piatto (x2) - verificare")
    if transposed:
        reasons.append("tabella con le taglie sulle colonne (trasposta)")
    return SizeChart(kind=kind, kind_hint=hint if kind == "unknown" else None, kind_confidence=round(conf, 2), kind_reasons=reasons,
                     title=title[:90] if title else None, unit=default_unit, unit_assumed=unit_assumed, columns=columns,
                     rows=rows, source=f"html-table:{index}", warnings=warnings)


def _quality(c: SizeChart) -> Tuple:
    keys = {col.key for col in c.columns}
    return ("chest" in keys, c.kind == "garment", not c.unit_assumed, len(keys & {"chest", "length", "shoulder", "sleeve", "waist", "hips"}), len(c.rows))


def find_size_charts(soup: BeautifulSoup) -> List[SizeChart]:
    charts: List[SizeChart] = []
    for i, t in enumerate(soup.find_all("table")):
        try:
            c = parse_table(t, i)
        except Exception:                                         # una tabella strana non deve far fallire tutto
            c = None
        if c:
            charts.append(c)
    # duplicati (stessa tabella in cm e in pollici, o ripetuta per tab): tengo la migliore
    unique: List[SizeChart] = []
    for c in sorted(charts, key=_quality, reverse=True):
        sig = [(r.size, round(r.measures["chest"].value_cm)) for r in c.rows if "chest" in r.measures]
        dup = False
        for u in unique:
            sig_u = [(r.size, round(r.measures["chest"].value_cm)) for r in u.rows if "chest" in r.measures]
            if sig and sig_u and [s for s, _ in sig] == [s for s, _ in sig_u] and all(abs(a[1] - b[1]) <= max(2, 0.03 * a[1]) for a, b in zip(sig, sig_u)):
                dup = True
                break
        if not dup:
            unique.append(c)
    return unique


def has_image_only_size_guide(soup: BeautifulSoup) -> bool:
    rx = re.compile(r"size[\s_-]*(chart|guide)|guida[\s_-]*(alle )?taglie|tabella[\s_-]*(delle )?(taglie|misure)|sizing", re.I)
    for img in soup.find_all("img"):
        if rx.search(" ".join([str(img.get("alt", "")), str(img.get("src", "")), str(img.get("title", "")), " ".join(img.get("class") or [])])):
            return True
    return False
