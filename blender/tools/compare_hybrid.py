"""Confronto tra il deformatore runtime ("body-bound") e una cloth sim VERA sullo stesso corpo (Python di sistema: numpy, scipy).

  python3 blender/tools/compare_hybrid.py --size XL --body 120 --truth blender/out/truth/chest120/tee-XL.glb [--neutral <glb neutro>]
--body = petto,vita,fianchi,altezza in cm. Il GLB "vero" si ottiene con build_tee.py --keys <influence> (sim sul corpo gia' modificato).
Misura la distanza tra le due superfici (vertice -> vertice piu' vicino, nei due versi), la quota dell'orlo e i tempi.
Per confronto riporta anche quanto dista dal "vero" il capo neutro non adattato: e' l'errore che il runtime deve ridurre.
"""
import json
import os
import struct
import subprocess
import sys

import numpy as np
from scipy.spatial import cKDTree

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))


def positions(path):
    b = open(path, 'rb').read()
    n = struct.unpack('<I', b[12:16])[0]
    j = json.loads(b[20:20 + n])
    bin_ = b[20 + n + 8:]
    out = []
    for m in j['meshes']:
        for p in m['primitives']:
            a = j['accessors'][p['attributes']['POSITION']]
            bv = j['bufferViews'][a['bufferView']]
            off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
            out.append(np.frombuffer(bin_, np.float32, a['count'] * 3, off).reshape(-1, 3))
    return np.vstack(out)


def dist(a, b):
    d1 = cKDTree(b).query(a)[0]
    d2 = cKDTree(a).query(b)[0]
    d = np.concatenate([d1, d2]) * 1000
    return dict(mean_mm=round(float(d.mean()), 1), p95_mm=round(float(np.percentile(d, 95)), 1), max_mm=round(float(d.max()), 1))


def main():
    a = sys.argv[1:]
    opt = lambda k, d=None: a[a.index(k) + 1] if k in a else d      # noqa: E731
    size, body, truth = opt('--size', 'XL'), opt('--body', ''), os.path.abspath(opt('--truth'))
    neutral = opt('--neutral', os.path.join(ROOT, 'frontend', 'public', 'assets', 'garments', 'grillz-tee', f'tee-{size}.glb'))
    hyb = os.path.splitext(truth)[0] + '_hybrid.glb'
    r = subprocess.run(['node', 'scripts/deform-asset.mjs', '--in', neutral, '--body', body, '--out', hyb], cwd=os.path.join(ROOT, 'frontend'), capture_output=True, text=True)
    if r.returncode:
        sys.exit(r.stderr[-2000:])
    info = json.loads(r.stdout.strip().splitlines()[-1])
    T, H, N = positions(truth), positions(hyb), positions(neutral)
    meta = json.load(open(os.path.splitext(truth)[0] + '.json'))
    res = dict(size=size, body_cm=body, hybrid_vs_sim=dist(H, T), neutral_vs_sim=dist(N, T),
               hem_y_cm=dict(sim=round(float(T[:, 1].min()) * 100, 1), hybrid=round(float(H[:, 1].min()) * 100, 1), neutral=round(float(N[:, 1].min()) * 100, 1)),
               seconds_sim=meta.get('bake_seconds'), ms_runtime=info['deformMs'], ms_bind_once=info['bindMs'], runtime=dict(sMin=info['sMin'], sMax=info['sMax'], tightCm=info['tightCm']))
    print(json.dumps(res, indent=1))
    json.dump(res, open(os.path.splitext(truth)[0] + '_compare.json', 'w'), indent=1)


if __name__ == '__main__':
    main()
