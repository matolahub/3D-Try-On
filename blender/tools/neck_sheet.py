"""Contact sheet del GIROCOLLO: fronte, 3/4, alto (+ raglan/spalla) per i prodotti indicati, corpo neutro. Python di sistema + Blender.

  python3 blender/tools/neck_sheet.py [--products grillz-tee,kermit-tee,drivingmato-tee] [--size M] [--out blender/out/eval/neck] [--px 520]
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

VIEWS = [
    {'name': 'collo_fronte', 'dir': [0, -1, 0.12], 'focus': [0, 0, 1.47], 'extent': 0.36},
    {'name': 'collo_3/4'.replace('/', '_'), 'dir': [-0.62, -0.75, 0.3], 'focus': [0, 0, 1.47], 'extent': 0.40},
    {'name': 'collo_alto', 'dir': [0, -0.75, 1], 'focus': [0, 0.0, 1.47], 'extent': 0.40},
    {'name': 'collo_retro', 'dir': [0, 1, 0.25], 'focus': [0, 0, 1.47], 'extent': 0.40},
    {'name': 'spalla_ascella', 'dir': [0.5, -0.85, 0.15], 'focus': [0.2, 0, 1.36], 'extent': 0.50},
    {'name': 'busto', 'view': 'front', 'focus': [0, 0, 1.17], 'extent': 0.98},
]


def main():
    a = sys.argv[1:]
    opt = lambda k, d: a[a.index(k) + 1] if k in a else d      # noqa: E731
    products = opt('--products', 'grillz-tee,kermit-tee,drivingmato-tee').split(',')
    size = opt('--size', 'M')
    px = int(opt('--px', '520'))
    out = os.path.abspath(opt('--out', os.path.join(ROOT, 'blender', 'out', 'eval', 'neck')))
    gdir = opt('--dir', os.path.join(ROOT, 'frontend', 'public', 'assets', 'garments'))
    os.makedirs(out, exist_ok=True)
    tiles = [{'name': p, 'label': f'{p} {size}', 'glb': os.path.join(gdir, p, f'tee-{size}.glb'), 'keys': {}} for p in products]
    d = os.path.join(out, f'tiles_{size}')
    spec = os.path.join(out, f'spec_{size}.json')
    json.dump({'out': d, 'size': [px, px], 'views': VIEWS, 'tiles': tiles}, open(spec, 'w'))
    r = subprocess.run([BLENDER, '-b', os.path.join(ROOT, 'blender', 'man-model.blend'), '--python', os.path.join(HERE, 'render_tiles.py'), '--', spec], capture_output=True, text=True)
    if 'TILES' not in r.stdout:
        sys.exit(r.stdout[-3000:] + r.stderr[-3000:])
    compose(d, os.path.join(out, f'neck_{size}.png'), rows='tiles')
    print(os.path.join(out, f'neck_{size}.png'))


if __name__ == '__main__':
    main()
