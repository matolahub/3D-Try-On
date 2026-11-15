"""Capo adattato a runtime (stesso codice del viewer) sui corpi agli ESTREMI degli slider: distanza vera dal corpo, vertici dentro la pelle.

  python3 blender/tools/worn_extremes.py [--products a,b,c] [--sizes L,2XL] [--out blender/out/eval/extremes]
Per ogni prodotto/taglia/corpo: node frontend/scripts/deform-asset.mjs -> GLB, poi blender/tools/check_worn.py (un solo avvio di Blender).
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

BODIES = [('neutro', ''), ('petto130', '130'), ('vita120', ',120'), ('fianchi124', ',,124'), ('alt155', ',,,155'), ('alt200', ',,,200'),
          ('grande_alto', '130,120,124,200'), ('grande_basso', '130,120,124,155')]


def main():
    a = sys.argv[1:]
    opt = lambda k, d: a[a.index(k) + 1] if k in a else d      # noqa: E731
    products = opt('--products', 'grillz-tee,kermit-tee,drivingmato-tee').split(',')
    sizes = opt('--sizes', 'L,2XL').split(',')
    out = os.path.abspath(opt('--out', os.path.join(ROOT, 'blender', 'out', 'eval', 'extremes')))
    os.makedirs(out, exist_ok=True)
    cal = json.load(open(os.path.join(ROOT, 'frontend', 'src', 'bodyCalibration.json')))
    pairs, info = [], {}
    for p in products:
        for s in sizes:
            for name, spec in BODIES:
                vals = (spec.split(',') + ['', '', '', ''])[:4]
                cm = {k: float(v) for k, v in zip(('Chest', 'Waist', 'Hips', 'Altezza'), vals) if v != ''}
                glb = os.path.join(out, f'{p}_{s}_{name}.glb')
                r = subprocess.run(['node', 'scripts/deform-asset.mjs', '--in', os.path.join(ROOT, 'frontend', 'public', 'assets', 'garments', p, f'tee-{s}.glb'),
                                    '--body', spec, '--out', glb], cwd=os.path.join(ROOT, 'frontend'), capture_output=True, text=True)
                if r.returncode:
                    sys.exit(r.stderr[-2000:])
                info[os.path.basename(glb)] = json.loads(r.stdout.strip().splitlines()[-1])
                pairs += [glb, ','.join(f'{k}={influence(cal, k, v):.5f}' for k, v in cm.items()) or 'none']
    r = subprocess.run([BLENDER, '-b', os.path.join(ROOT, 'blender', 'man-model.blend'), '--python', os.path.join(HERE, 'check_worn.py'), '--'] + pairs, capture_output=True, text=True)
    for line in r.stdout.splitlines():
        if line.startswith('WORN'):
            i = info[line.split()[1]]
            print(line, ' sMin %.2f tightCm %s' % (i['sMin'], i['tightCm']))
    json.dump(info, open(os.path.join(out, 'deform.json'), 'w'), indent=1)


if __name__ == '__main__':
    main()
