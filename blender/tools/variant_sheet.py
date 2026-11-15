"""Confronto affiancato di piu' GLB dello stesso capo sul corpo neutro (una riga per variante). Python di sistema + Blender.

  python3 blender/tools/variant_sheet.py --items "b40=percorso.glb;b20=percorso.glb" --out cartella [--px 420] [--views drape|neck]
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
BLENDER = os.environ.get('BLENDER', '/Applications/Blender.app/Contents/MacOS/Blender')
sys.path.insert(0, HERE)
from compose_sheet import compose  # noqa: E402

DRAPE = [
    {'name': 'fronte', 'view': 'front', 'focus': [0, 0, 1.17], 'extent': 0.95},
    {'name': 'tre_quarti', 'view': 'three', 'focus': [0, 0, 1.17], 'extent': 0.95},
    {'name': 'lato', 'view': 'side', 'focus': [0, 0.02, 1.17], 'extent': 0.95},
    {'name': 'retro', 'view': 'back', 'focus': [0, 0, 1.17], 'extent': 0.95},
    {'name': 'ascella', 'dir': [0.45, -0.85, -0.05], 'focus': [0.22, 0, 1.25], 'extent': 0.5},
    {'name': 'orlo', 'dir': [0.3, -0.9, -0.1], 'focus': [0, 0, 0.95], 'extent': 0.6},
]


def main():
    a = sys.argv[1:]
    opt = lambda k, d: a[a.index(k) + 1] if k in a else d      # noqa: E731
    items = [it.split('=', 1) for it in opt('--items', '').split(';') if it]
    px = int(opt('--px', '420'))
    out = os.path.abspath(opt('--out', os.path.join(ROOT, 'blender', 'out', 'eval', 'variants')))
    os.makedirs(out, exist_ok=True)
    tiles = [{'name': n, 'label': n, 'glb': os.path.abspath(g), 'keys': {}} for n, g in items]
    d = os.path.join(out, 'tiles')
    spec = os.path.join(out, 'spec.json')
    json.dump({'out': d, 'size': [px, px], 'views': DRAPE, 'tiles': tiles}, open(spec, 'w'))
    r = subprocess.run([BLENDER, '-b', os.path.join(ROOT, 'blender', 'man-model.blend'), '--python', os.path.join(HERE, 'render_tiles.py'), '--', spec], capture_output=True, text=True)
    if 'TILES' not in r.stdout:
        sys.exit(r.stdout[-3000:] + r.stderr[-3000:])
    compose(d, os.path.join(out, 'sheet.png'), rows='tiles')
    print(os.path.join(out, 'sheet.png'))


if __name__ == '__main__':
    main()
