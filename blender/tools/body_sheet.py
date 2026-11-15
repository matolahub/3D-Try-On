"""Contact sheet automatica del CORPO: neutro, estremi singoli di ogni misura, combinazioni realistiche (Python di sistema + Blender).

  python3 blender/tools/body_sheet.py [--blend blender/man-model.blend] [--cal frontend/src/bodyCalibration.json] [--out blender/out/body]

Scrive in <out>:
  body_full.png    figura intera: fronte, lato, 3/4
  body_torso.png   primo piano del busto: fronte, 3/4, retro
Serve a controllare a occhio cio' che measure_body.py non misura: bordi netti, fasce, gradini, proporzioni.
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

# combinazioni realistiche (cm): petto, vita, fianchi, altezza
COMBOS = {
    'atletico': dict(Chest=112, Waist=82, Hips=100, Altezza=182),
    'sovrappeso': dict(Chest=118, Waist=112, Hips=116, Altezza=176),
    'magro_alto': dict(Chest=86, Waist=70, Hips=88, Altezza=192),
}


def influence(cal, key, cm):
    pts = cal[key]['curve']
    x = max(cal[key]['min'], min(cal[key]['max'], cm))
    for (x0, y0), (x1, y1) in zip(pts[:-1], pts[1:]):
        if x <= x1:
            return y0 + (x - x0) / (x1 - x0) * (y1 - y0)
    return pts[-1][1]


def cases(cal):
    out = [('neutro', {})]
    for k in ('Chest', 'Waist', 'Hips', 'Altezza'):
        for end in ('min', 'max'):
            out.append((f'{k.lower()}{cal[k][end]:g}', {k: cal[k][end]}))
    out += list(COMBOS.items())
    out.append(('tutto_min', {k: cal[k]['min'] for k in ('Chest', 'Waist', 'Hips')}))
    out.append(('tutto_max', {k: cal[k]['max'] for k in ('Chest', 'Waist', 'Hips')}))
    return [{'name': n, 'label': n.replace('_', ' '), 'keys': {k: influence(cal, k, cm) for k, cm in b.items()}, 'cm': b} for n, b in out]


def main():
    a = sys.argv[1:]

    def opt(k, d):
        return a[a.index(k) + 1] if k in a else d

    blend = opt('--blend', os.path.join(ROOT, 'blender', 'man-model.blend'))
    cal = json.load(open(opt('--cal', os.path.join(ROOT, 'frontend', 'src', 'bodyCalibration.json'))))
    out = os.path.abspath(opt('--out', os.path.join(ROOT, 'blender', 'out', 'body')))
    os.makedirs(out, exist_ok=True)
    tiles = cases(cal)
    for tag, spec in (('full', dict(size=[250, 470], views=['front', 'side', 'three'], focus=[0, 0, 0.95], extent=2.1)),
                      ('torso', dict(size=[250, 280], views=['front', 'three', 'back'], focus=[0, 0, 1.08], extent=0.95))):
        d = os.path.join(out, 'tiles_' + tag)
        # la quota del centro segue l'altezza: il busto resta inquadrato anche a 155 e a 200 cm
        ts = []
        for t in tiles:
            h = t['cm'].get('Altezza', cal['Altezza']['neutral']) / cal['Altezza']['neutral']
            ts.append({**t, 'focus': [0, 0, spec['focus'][2] * (h if tag == 'torso' else 1)]})
        p = os.path.join(out, f'spec_{tag}.json')
        json.dump({'out': d, **spec, 'tiles': ts}, open(p, 'w'))
        r = subprocess.run([BLENDER, '-b', blend, '--python', os.path.join(HERE, 'render_tiles.py'), '--', p], capture_output=True, text=True)
        if 'TILES' not in r.stdout:
            sys.exit(r.stdout[-3000:] + r.stderr[-3000:])
        compose(d, os.path.join(out, f'body_{tag}.png'))


if __name__ == '__main__':
    main()
