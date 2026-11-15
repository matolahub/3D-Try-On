"""Contact sheet automatica del CAPO indossato: 8 viste x corpi x taglie (Python di sistema + node + Blender).

  python3 blender/tools/garment_sheet.py [--product grillz-tee] [--sizes S,XL] [--dir cartella dei GLB] [--out blender/out/garment/sheet]
         [--bodies "neutro=;chest120=120;waist95_hips110=,95,110"]        corpi: petto,vita,fianchi,altezza in cm (vuoto = neutro)

Per ogni taglia e corpo il capo viene adattato con lo STESSO codice del viewer (frontend/scripts/deform-asset.mjs -> core/garment/bound.js),
poi Blender lo renderizza sul corpo con quelle misure. Viste: fronte, retro, due lati, 3/4, spalla, ascella, colletto, orlo.
Scrive <out>/sheet_<taglia>.png (una riga per corpo) e i tempi/grandezze del deformatore in <out>/deform.json.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
BLENDER = os.environ.get('BLENDER', '/Applications/Blender.app/Contents/MacOS/Blender')
sys.path.insert(0, HERE)
from body_sheet import influence  # noqa: E402
from compose_sheet import compose  # noqa: E402

VIEWS = [
    {'name': 'fronte', 'view': 'front', 'focus': [0, 0, 1.17], 'extent': 0.98},
    {'name': 'retro', 'view': 'back', 'focus': [0, 0, 1.17], 'extent': 0.98},
    {'name': 'lato_sx', 'view': 'side', 'focus': [0, 0.02, 1.17], 'extent': 0.98},
    {'name': 'lato_dx', 'view': 'side_r', 'focus': [0, 0.02, 1.17], 'extent': 0.98},
    {'name': 'tre_quarti', 'view': 'three', 'focus': [0, 0, 1.17], 'extent': 0.98},
    {'name': 'spalla', 'dir': [0.55, -0.6, 0.6], 'focus': [0.2, 0, 1.42], 'extent': 0.42},
    {'name': 'ascella', 'dir': [0.45, -0.85, -0.15], 'focus': [0.24, 0, 1.25], 'extent': 0.42},
    {'name': 'colletto', 'dir': [0.3, -1, 0.35], 'focus': [0, 0, 1.46], 'extent': 0.34},
    {'name': 'orlo', 'dir': [0.3, -0.9, -0.25], 'focus': [0, 0, 0.9], 'extent': 0.6},
]


def main():
    a = sys.argv[1:]

    def opt(k, d):
        return a[a.index(k) + 1] if k in a else d

    sizes = opt('--sizes', 'S,XL').split(',')
    product = opt('--product', 'grillz-tee')
    gdir = os.path.abspath(opt('--dir', os.path.join(ROOT, 'frontend', 'public', 'assets', 'garments', product)))
    out = os.path.abspath(opt('--out', os.path.join(ROOT, 'blender', 'out', 'garment', 'sheet')))
    pat = opt('--file', 'tee-{size}.glb')
    bodies = [b.split('=') for b in opt('--bodies', 'neutro=;chest120=120;waist95_hips110=,95,110').split(';')]
    cal = json.load(open(os.path.join(ROOT, 'frontend', 'src', 'bodyCalibration.json')))
    os.makedirs(out, exist_ok=True)
    report = {}
    for size in sizes:
        tiles = []
        for name, spec in bodies:
            vals = (spec.split(',') + ['', '', '', ''])[:4]
            cm = {k: float(v) for k, v in zip(('Chest', 'Waist', 'Hips', 'Altezza'), vals) if v != ''}
            glb = os.path.join(out, f'tee-{size}_{name}.glb')
            r = subprocess.run(['node', 'scripts/deform-asset.mjs', '--in', os.path.join(gdir, pat.format(size=size)), '--body', spec, '--out', glb],
                               cwd=os.path.join(ROOT, 'frontend'), capture_output=True, text=True)
            if r.returncode:
                sys.exit(r.stderr[-2000:])
            report[f'{size}/{name}'] = json.loads(r.stdout.strip().splitlines()[-1])
            tiles.append({'name': f'{size}_{name}', 'label': f'{size} {name}', 'glb': glb, 'keys': {k: influence(cal, k, v) for k, v in cm.items()}})
        d = os.path.join(out, f'tiles_{size}')
        p = os.path.join(out, f'spec_{size}.json')
        json.dump({'out': d, 'size': [300, 300], 'views': VIEWS, 'tiles': tiles}, open(p, 'w'))
        r = subprocess.run([BLENDER, '-b', os.path.join(ROOT, 'blender', 'man-model.blend'), '--python', os.path.join(HERE, 'render_tiles.py'), '--', p], capture_output=True, text=True)
        if 'TILES' not in r.stdout:
            sys.exit(r.stdout[-3000:] + r.stderr[-3000:])
        compose(d, os.path.join(out, f'sheet_{size}.png'), rows='tiles')
    json.dump(report, open(os.path.join(out, 'deform.json'), 'w'), indent=1)
    for k, v in report.items():
        print(k, {x: v[x] for x in ('deformMs', 'maxMoveCm', 'sMin', 'sMax', 'tightCm', 'chestGarmentCm', 'bodyAtChestLineCm')})


if __name__ == '__main__':
    main()
