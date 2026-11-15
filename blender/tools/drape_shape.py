"""Forma della CADUTA di un build (.npz scritto da build_tee.py): quanto il capo e' "a campana". Da eseguire dentro Blender.

  Blender -b blender/man-model.blend --python blender/tools/drape_shape.py -- etichetta=blender/out/garment/tee_M_build.npz [altra=...]
Per ogni build stampa, a 0/8/16/24/32 cm sopra l'orlo (sul cartamodello): larghezza e profondita' dell'anello, distanza dal corpo
(media, centro davanti, centro dietro, fianchi); per l'orlo: giro, guscio convesso e quota di tessuto in pieghe (giro / guscio - 1:
0% = ovale liscio, senza pieghe), quota minima e massima; e la larghezza del corpo alla quota dell'orlo.
"""
import sys, os, json
sys.path.insert(0, os.path.join(os.getcwd(), 'blender', 'garment'))
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
import common as C
C.set_body_keys({}); C.set_pose('natural')
bco, btr = C.evaluated_body()
tree = BVHTree.FromPolygons([tuple(v) for v in bco], [tuple(t) for t in btr])
for it in C.script_args():
    name, f = it.split('=')
    d = np.load(f); base, weld, P2, piece = d['base'], d['weld'], d['P2'], d['piece']
    ch = json.loads(str(d['chains']))
    Hy = P2[ch['front.hem'][0], 1]
    print('HEM', name)
    for up in (0, 8, 16, 24, 32):                     # cm sopra l'orlo, sul cartamodello
        sel = (piece < 2) & (np.abs(P2[:, 1] - (Hy - up)) < 0.7)
        pts = base[np.unique(weld[sel])]
        dist = np.array([tree.find_nearest(Vector(p))[3] for p in pts]) * 100
        fr = pts[:, 1] < np.median(pts[:, 1]); 
        side = np.abs(pts[:, 0]) > 0.75 * np.abs(pts[:, 0]).max()
        print('  %2d cm sopra l\'orlo: z %.1f cm | larghezza x %.1f cm, profondita\' y %.1f cm | distanza dal corpo: media %.1f, davanti-centro %.1f, dietro-centro %.1f, fianchi %.1f, max %.1f' % (
            up, pts[:, 2].mean() * 100, np.ptp(pts[:, 0]) * 100, np.ptp(pts[:, 1]) * 100, dist.mean(),
            dist[(np.abs(pts[:, 0]) < 0.06) & fr].mean(), dist[(np.abs(pts[:, 0]) < 0.06) & ~fr].mean(), dist[side].mean(), dist.max()))
    def hull_len(q):
        q = sorted(map(tuple, q)); 
        def half(pts):
            h = []
            for p_ in pts:
                while len(h) >= 2 and (h[-1][0]-h[-2][0])*(p_[1]-h[-2][1]) - (h[-1][1]-h[-2][1])*(p_[0]-h[-2][0]) <= 0: h.pop()
                h.append(p_)
            return h
        hl = half(q)[:-1] + half(q[::-1])[:-1]
        return sum(np.hypot(hl[i][0]-hl[i-1][0], hl[i][1]-hl[i-1][1]) for i in range(len(hl)))
    ring = np.vstack([base[weld[ch['front.hem']]], base[weld[ch['back.hem']]]])
    per = sum(np.linalg.norm(np.diff(base[weld[ch[k]]], axis=0), axis=1).sum() for k in ('front.hem', 'back.hem'))
    torso = np.unique(weld[(piece < 2) & (P2[:, 1] > 36) ])
    dt = np.array([tree.find_nearest(Vector(p))[3] for p in base[torso]]) * 100
    print('  orlo: giro %.1f cm, guscio convesso %.1f cm -> pieghe %.1f%% | quota min..max %.1f..%.1f cm | busto sotto l\'ascella: distanza media dal corpo %.2f cm, %.0f%% dei vertici entro 1 cm' % (
        per * 100, hull_len(ring[:, :2]) * 100, (per / hull_len(ring[:, :2]) - 1) * 100, ring[:, 2].min() * 100, ring[:, 2].max() * 100, dt.mean(), (dt < 1.0).mean() * 100))
    # corpo alla quota dell'orlo
    z = base[weld[ch['front.hem']]][:, 2].mean()
    s = (np.abs(bco[:, 2] - z) < 0.01) & (np.abs(bco[:, 0]) < 0.25)
    print('  corpo alla quota dell\'orlo: larghezza x %.1f cm, profondita\' y %.1f cm' % (np.ptp(bco[s, 0]) * 100, np.ptp(bco[s, 1]) * 100))
