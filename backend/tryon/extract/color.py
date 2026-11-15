"""Colore dominante dell'immagine prodotto (per il colore del capo 3D). Nessun dato inventato: se non e' affidabile ritorna None."""
import io
from typing import Optional

from PIL import Image


def dominant_color(data: bytes) -> Optional[str]:
    try:
        im = Image.open(io.BytesIO(data))
        im.thumbnail((96, 96))
        rgba = im.convert("RGBA")
    except Exception:
        return None
    px = [p for p in rgba.getdata() if p[3] > 200]
    # scarto lo sfondo tipico delle foto prodotto (bianco/grigio molto chiaro) e i pixel quasi neri di ombre
    fg = [p[:3] for p in px if not (min(p[:3]) > 232) and not (max(p[:3]) < 14)]
    if len(fg) < max(60, 0.04 * len(px)):
        fg = [p[:3] for p in px]                                    # capo bianco/nero: uso tutti i pixel
    if not fg:
        return None
    img = Image.new("RGB", (len(fg), 1))
    img.putdata(fg)
    q = img.quantize(colors=6, method=Image.Quantize.MEDIANCUT)
    pal = q.getpalette()[: 6 * 3]
    counts = sorted(q.getcolors(), reverse=True)                     # [(n, idx)]
    n, idx = counts[0]
    r, g, b = pal[idx * 3: idx * 3 + 3]
    return "#%02x%02x%02x" % (r, g, b)
