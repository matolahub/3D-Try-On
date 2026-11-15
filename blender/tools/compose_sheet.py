"""Compone i riquadri di render_tiles.py in una contact sheet (Python di sistema: PIL).

  python3 blender/tools/compose_sheet.py <cartella con manifest.json> <sheet.png> [--rows views|tiles] [--scale 1.0]
Per default: una colonna per corpo/caso, una riga per vista.
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont


def font(sz):
    for p in ('/System/Library/Fonts/Supplemental/Arial.ttf', '/System/Library/Fonts/Helvetica.ttc', '/Library/Fonts/Arial.ttf'):
        if os.path.exists(p):
            try:
                return ImageFont.truetype(p, sz)
            except OSError:
                pass
    return ImageFont.load_default()


def compose(src, out, rows='views', scale=1.0):
    man = json.load(open(os.path.join(src, 'manifest.json')))
    w, h = (int(v * scale) for v in man['size'])
    tiles, views = man['tiles'], man['views']
    pad, head = 2, 22
    cols_n, rows_n = (len(tiles), len(views)) if rows == 'views' else (len(views), len(tiles))
    sheet = Image.new('RGB', (cols_n * (w + pad) + pad, rows_n * (h + pad) + pad + head), (20, 20, 22))
    d = ImageDraw.Draw(sheet)
    f = font(13)
    for ti, t in enumerate(tiles):
        for vi, v in enumerate(views):
            p = os.path.join(src, f"{t['name']}_{v}.png")
            if not os.path.exists(p):
                continue
            im = Image.open(p).convert('RGB')
            if scale != 1.0:
                im = im.resize((w, h), Image.LANCZOS)
            c, r = (ti, vi) if rows == 'views' else (vi, ti)
            x, y = pad + c * (w + pad), head + pad + r * (h + pad)
            sheet.paste(im, (x, y))
            if rows == 'tiles':
                d.text((x + 4, y + 3), f"{t['label']} · {v}", fill=(255, 235, 120), font=f)
    if rows == 'views':
        for ti, t in enumerate(tiles):
            d.text((pad + ti * (w + pad) + 4, 4), t['label'], fill=(255, 235, 120), font=f)
    sheet.save(out)
    print('SHEET', out, sheet.size)


if __name__ == '__main__':
    a = sys.argv[1:]
    compose(a[0], a[1], rows=a[a.index('--rows') + 1] if '--rows' in a else 'views', scale=float(a[a.index('--scale') + 1]) if '--scale' in a else 1.0)
