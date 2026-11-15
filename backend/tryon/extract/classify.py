"""Classificazione del prodotto: `tshirt`, `hoodie` oppure `unknown` (mai forzata)."""
import re
from typing import Dict, List, Tuple

from ..schemas import Classification, ProductInfo

_HOODIE = re.compile(
    r"\bhood(?:ie|y|ies|ed)\b|\bwith\s+(?:a\s+)?hood\b|\bhood\s+(?:sweatshirt|jumper|pullover)\b|\bzip[\s-]*hood|felpa\s+con\s+cappuccio|felpa\s+cappuccio|con\s+cappuccio|"
    r"\bsweat\s+(?:à|a)\s+capuche|\bcapuche\b|kapuzen(?:pullover|pulli|sweat)|sudadera\s+con\s+capucha|\bcapucha\b|\bhoodies\b", re.I)
_TSHIRT = re.compile(
    r"\bt[\s-]*shirts?\b|\btshirts?\b|\btees?\b|\bmaglietta\b|\bmagliette\b|maglia\s+(?:a\s+)?maniche\s+corte|"
    r"\bt[\s-]*shirt\b|\bcamiseta\b|\bmarcel\b|\btee-shirt\b|\bteeshirt\b|\bkurzarmshirt\b|\bt-shirts\b", re.I)
_NOT_UPPER = re.compile(r"\b(pants?|jeans?|shorts?|skirt|dress|jacket|coat|giacc|pantalon|gonna|vestito|scarp|shoes?|cap|hat|cappell|bag|socks?|calz)\b", re.I)

# (campo, peso): il nome del prodotto conta piu' della descrizione
_WEIGHTS = {"name": 3.0, "breadcrumbs": 2.0, "category": 2.0, "url": 1.5, "description": 0.4}


def classify_product(product: ProductInfo, url: str) -> Classification:
    fields: Dict[str, str] = {
        "name": product.name or "",
        "breadcrumbs": " > ".join(product.breadcrumbs),
        "category": product.category_raw or "",
        "url": re.sub(r"[-_/+.]", " ", url),
        "description": (product.description or "")[:400],
    }
    score = {"hoodie": 0.0, "tshirt": 0.0}
    reasons: List[str] = []
    for field, text in fields.items():
        if not text:
            continue
        w = _WEIGHTS[field]
        if _HOODIE.search(text):
            score["hoodie"] += w
            reasons.append(f"'{_HOODIE.search(text).group(0)}' in {field}")
        if _TSHIRT.search(text):
            score["tshirt"] += w
            reasons.append(f"'{_TSHIRT.search(text).group(0)}' in {field}")
    if fields["name"] and _NOT_UPPER.search(fields["name"]) and max(score.values()) < 3.0:
        return Classification(category="unknown", confidence=0.0, reasons=reasons + ["il nome indica un altro tipo di capo"])
    # il nome e' l'indizio piu' specifico: se nomina una sola categoria, questa prevale (con confidenza ridotta se altri indizi divergono)
    in_name = {"hoodie": bool(_HOODIE.search(fields["name"])), "tshirt": bool(_TSHIRT.search(fields["name"]))}
    if in_name["hoodie"] != in_name["tshirt"]:
        score["hoodie" if in_name["hoodie"] else "tshirt"] += 2.0
    best, other = ("hoodie", "tshirt") if score["hoodie"] >= score["tshirt"] else ("tshirt", "hoodie")
    if score[best] == 0:
        return Classification(category="unknown", confidence=0.0, reasons=["nessuna parola chiave di t-shirt/hoodie trovata"])
    if score[best] == score[other]:
        return Classification(category="unknown", confidence=0.2, reasons=reasons + ["indizi contrastanti"])
    total = score["hoodie"] + score["tshirt"]
    conf = round(min(0.98, 0.5 + 0.5 * (score[best] - score[other]) / total + min(score[best], 5) * 0.03), 2)
    if score[other] > 0:
        reasons.append("altri indizi indicano la categoria opposta")
    return Classification(category=best, confidence=conf, reasons=reasons)
