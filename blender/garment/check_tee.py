"""Criteri di accettazione MISURATI di una build della T-shirt. Esce con codice 1 se un criterio non e' rispettato.

  Blender -b blender/man-model.blend --python blender/garment/check_tee.py -- --size S [--glb percorso.glb] [--out cartella dei .npz]

Legge l'archivio scritto da build_tee.py (cartamodello + posizioni finali) e misura SULLA MESH 3D FINALE, non sul cartamodello:
  misure   petto (giro), orlo (giro), lunghezza, manica, spalla = tabella entro TOL_CM. Ogni misura e' la lunghezza, sulla superficie 3D,
           della stessa linea che si misura sul capo steso (tracciata nel cartamodello e riportata sui triangoli).
  corpo    nessun vertice a meno di MIN_GAP dalla pelle (ne' dentro)
  simmetria sinistra/destra del capo
  auto-intersezioni  triangoli del capo che si attraversano
  orlo     quota attesa: quella di un filo teso lungo quanto il capo, dall'HPS attorno al profilo del petto e poi in verticale (+-2,5 cm)
  colletto spessore della costina = valore dichiarato
  bake     tempo
I valori misurati vengono scritti nei metadati del GLB (chiave "measured" e "checks"): il report di vestibilita' del frontend usa quelli.
"""
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

import common as C  # noqa: E402
import pattern as P  # noqa: E402

TOL_CM = 0.3           # misure del capo vs tabella (petto, orlo, lunghezza, manica)
TOL_SHOULDER_CM = 0.5  # spalla: sul capo indossato la linea delle spalle e' in tensione (porta il peso del capo); criterio aggiuntivo
MIN_GAP_MM = 2.0       # distanza minima dal corpo
TOL_SYM_MM = 0.5       # asimmetria massima
TOL_COLLAR_MM = 0.4    # spessore del colletto vs dichiarato
MAX_SELF = 0           # coppie di triangoli che si intersecano
PIECES = ('front', 'back', 'sleeve_L', 'sleeve_R')
CM = 0.01

args = C.script_args()


def opt(k, d):
    return args[args.index(k) + 1] if k in args else d


product = opt('--product', 'grillz-tee')
P.use(product)
size = opt('--size', 'S')
out = os.path.abspath(opt('--out', os.path.join(C.ROOT, 'blender', 'out', 'garment', *([] if product == 'grillz-tee' else [product]))))
glb = opt('--glb', os.path.join(C.ROOT, 'frontend', 'public', 'assets', 'garments', product, f'tee-{size}.glb'))
d = np.load(os.path.join(out, f'tee_{size}_build.npz'))
meta_path = os.path.splitext(glb)[0] + '.json'
meta = json.load(open(meta_path))
P2, piece, tris, weld, base = d['P2'], d['piece'], d['tris'], d['weld'], d['base']
chains = json.loads(str(d['chains']))
m = P.garment_measures(size)
kp = P.key_points(m)
table = P.SIZE_CHART[size]
pos3 = base[weld]                       # posizione 3D di ogni vertice del cartamodello


def trace(pi, a, b):
    """Lunghezza 3D (cm) della linea a -> b del cartamodello (cm) sul pezzo `pi`, seguendo la superficie del capo."""
    a, b = np.array(a, float), np.array(b, float)
    t_ = tris[d['tpiece'] == pi]
    E = np.unique(np.sort(np.concatenate([t_[:, [0, 1]], t_[:, [1, 2]], t_[:, [2, 0]]]), axis=1), axis=0)
    p, q = P2[E[:, 0]], P2[E[:, 1]]
    r, s = b - a, q - p
    den = r[0] * s[:, 1] - r[1] * s[:, 0]
    ok = np.abs(den) > 1e-12
    t = np.where(ok, ((p[:, 0] - a[0]) * s[:, 1] - (p[:, 1] - a[1]) * s[:, 0]) / np.where(ok, den, 1), -9)
    u = np.where(ok, ((p[:, 0] - a[0]) * r[1] - (p[:, 1] - a[1]) * r[0]) / np.where(ok, den, 1), -9)
    hit = ok & (t > -1e-6) & (t < 1 + 1e-6) & (u > -1e-9) & (u < 1 + 1e-9)
    order = np.argsort(t[hit])
    tt, uu, ee = t[hit][order], u[hit][order], E[hit][order]
    pts = pos3[ee[:, 0]] + uu[:, None] * (pos3[ee[:, 1]] - pos3[ee[:, 0]])
    keep = np.concatenate([[True], np.diff(tt) > 1e-7])
    pts, tt = pts[keep], tt[keep]
    covered = tt[-1] - tt[0]                          # frazione della linea effettivamente dentro il pezzo
    return float(np.linalg.norm(np.diff(pts, axis=0), axis=1).sum() / max(covered, 1e-9) * 100)


def chain_len(key):
    ids = chains[key]
    return float(np.linalg.norm(np.diff(pos3[ids], axis=0), axis=1).sum() * 100)


fails = 0
rows = []


def check(label, ok, text):
    global fails
    fails += not ok
    rows.append((label, bool(ok), text))
    print(f'  {"OK  " if ok else "FAIL"} {label:22s} {text}')


print(f'CHECK tee-{size}  ({meta["mesh"]["vertices"]} vertici, {meta["mesh"]["triangles"]} triangoli)')
RAGLAN = P.STYLE == 'raglan'           # niente cucitura di spalla: spalla e manica di tabella non si applicano (la manica viene dalla foto)
W2, A, S, N, H = m['chest'] / 2, kp['A'], kp['S'], kp['N'], kp['H']
yc = A[1] + 2.5                       # il petto si misura per convenzione 2,5 cm (1 pollice) sotto l'ascella
measured = {
    'chest_circ_cm': trace(0, (-W2, yc), (W2, yc)) + trace(1, (-W2, yc), (W2, yc)),
    'hem_circ_cm': chain_len('front.hem') + chain_len('back.hem'),
    'length_cm': trace(0, (4.0, m['neck_front'] + m['rib'] + 0.8), (4.0, H[1])) + m['neck_front'] + m['rib'] + 0.8 - N[1] if RAGLAN else trace(0, N, (N[0], H[1])),
    'sleeve_cm': None, 'shoulder_cm': None if RAGLAN else trace(1, (-S[0], S[1] + 0.05), (S[0], S[1] + 0.05)),
}
Sf, e, ep = (np.array(v) for v in (S, (math.cos(kp['alpha']), math.sin(kp['alpha'])), (-math.sin(kp['alpha']), math.cos(kp['alpha']))))
u_t = float((np.array(kp['T']) - Sf) @ e)
measured['sleeve_cm'] = trace(2, (0.0, 0.0), (u_t, m['cuff'] / 2))
measured['cuff_circ_cm'] = chain_len('sleeve_L.cuff')
sleeve_target = math.hypot(table['sleeve'], m['cuff'] / 2) if RAGLAN else table['sleeve']      # raglan: la tabella da' il bordo superiore (dal colletto)
for key, target, label in (('chest_circ_cm', 2 * table['chest'], 'petto (giro)'), ('hem_circ_cm', 2 * table['chest'], 'orlo (giro)'),
                           ('length_cm', table['length'], 'lunghezza'), ('sleeve_cm', sleeve_target, 'manica (colletto-centro polsino)' if RAGLAN else 'manica'), ('shoulder_cm', table.get('shoulder'), 'spalla')):
    if measured[key] is None:
        continue
    v = measured[key]
    src = 'tabella' if key != 'hem_circ_cm' else 'tabella: fianco dritto, orlo = petto'
    tol = TOL_SHOULDER_CM if key == 'shoulder_cm' else TOL_CM
    check(label, abs(v - target) <= tol, f'{v:7.2f} cm  atteso {target:.1f} ({src})  errore {v - target:+.2f} (tolleranza {tol})')

# corpo
C.set_body_keys({})
C.set_pose('natural')
bco, btr = C.evaluated_body()
tree = BVHTree.FromPolygons([tuple(v) for v in bco], [tuple(t) for t in btr])
allp = d['pos']
dist = np.empty(len(allp))
for i, p_ in enumerate(allp):
    loc, nrm, _, dd = tree.find_nearest(Vector(p_))
    dist[i] = dd if (Vector(p_) - loc).dot(nrm) >= 0 else -dd
check('distanza dal corpo', dist.min() * 1000 > MIN_GAP_MM, f'minima {dist.min() * 1000:5.2f} mm (> {MIN_GAP_MM}), vertici dentro il corpo {(dist < 0).sum()}, sotto 2 mm {(dist * 1000 < MIN_GAP_MM).sum()}')

# simmetria
wm = d['wmirror']
ok = wm >= 0
asym = np.linalg.norm(base[ok] - base[wm[ok]] * np.array([-1.0, 1, 1]), axis=1) * 1000
check('simmetria sx/dx', asym.max() <= TOL_SYM_MM, f'scarto massimo {asym.max():.3f} mm, medio {asym.mean():.3f} mm (vertici senza specchio: {(~ok).sum()})')

# auto-intersezioni (triangoli che si attraversano senza condividere vertici; i vertici coincidenti contano come condivisi)
ft = d['ftris']
keyv = {}
gid = np.array([keyv.setdefault(tuple(np.round(p_ * 2e4).astype(int)), len(keyv)) for p_ in allp])
gt = BVHTree.FromPolygons([tuple(v) for v in allp], [tuple(int(i) for i in t) for t in ft], epsilon=0.0)
pairs = [(a, b) for a, b in gt.overlap(gt) if a < b and not (set(gid[ft[a]]) & set(gid[ft[b]]))]
check('auto-intersezioni', len(pairs) <= MAX_SELF, f'{len(pairs)} coppie di triangoli')

# orlo: quota attesa = filo teso lungo L che parte dall'HPS del capo, gira attorno al profilo del corpo davanti e poi cade in verticale
hem_ids = chains['front.hem'] + chains['back.hem']
hz = pos3[hem_ids][:, 2]
pN = pos3[chains['sleeve_L.neck_seam'][int(np.abs(P2[chains['sleeve_L.neck_seam']]).sum(1).argmin())]] if RAGLAN else pos3[chains['front.shoulder_R'][0]]
slab = bco[(np.abs(bco[:, 0] - pN[0]) < 0.025) & (bco[:, 2] < pN[2]) & (bco[:, 2] > pN[2] - 0.6) & (bco[:, 1] < pN[1])]
prof = np.vstack([[pN[2], -pN[1]], np.stack([slab[:, 2], -slab[:, 1]], 1)])       # (quota, sporgenza in avanti)
prof = prof[np.argsort(-prof[:, 0])]
hull = []                                                                            # catena convessa superiore, dall'alto verso il basso
for q_ in prof:
    while len(hull) >= 2 and (hull[-1][0] - hull[-2][0]) * (q_[1] - hull[-2][1]) - (hull[-1][1] - hull[-2][1]) * (q_[0] - hull[-2][0]) <= 0:
        hull.pop()
    hull.append(q_)
hull = np.array(hull)
kf_ = int(hull[:, 1].argmax())                                                       # punto piu' sporgente: da li' il tessuto cade in verticale
wrap = float(np.linalg.norm(np.diff(hull[:kf_ + 1], axis=0), axis=1).sum())
exp_z = hull[kf_, 0] - (table['length'] * CM - wrap)
fc = pos3[chains['front.hem'][len(chains['front.hem']) // 2]][2]
bc = pos3[chains['back.hem'][len(chains['back.hem']) // 2]][2]
fx = pos3[chains['front.hem']]
at_n = float(fx[np.abs(fx[:, 0] - pN[0]).argmin(), 2])
check('quota dell\'orlo', abs(at_n - exp_z) <= 0.025,
      f'davanti (sotto l\'HPS) {at_n * 100:.1f} cm da terra, attesa {exp_z * 100:.1f} +-2.5 (filo teso di {table["length"]} cm dall\'HPS a {pN[2] * 100:.1f} cm sul profilo del corpo); '
      f'tutto l\'orlo {hz.min() * 100:.1f}..{hz.max() * 100:.1f}, centro davanti {fc * 100:.1f}, dietro {bc * 100:.1f}')

# colletto: distanza tra strato esterno e strato base
lay, src, nb = d['layer'], d['src'], len(base)
col = np.nonzero(lay == 1)[0]
th = np.linalg.norm(allp[col] - (d['anchor'][col] if 'anchor' in d else allp[src[col]]), axis=1) * 1000      # dal punto dello strato base su cui poggia
full = th[th > 0.8 * m['collar_mm']]                 # esclude l'anello a meta' spessore del bordo arrotondato
check('spessore colletto', len(full) > 0 and abs(np.median(full) - m['collar_mm']) <= TOL_COLLAR_MM,
      f'mediana {np.median(full) if len(full) else float("nan"):.2f} mm (dichiarato {m["collar_mm"]} mm, ASSUNTO), {len(full)} vertici dello strato esterno')

# tessuto: scarto dalle lunghezze del cartamodello
E, L, el = d['E'], d['L'], d['elastic']
st = np.linalg.norm(base[E[~el, 1]] - base[E[~el, 0]], axis=1) / L[~el] - 1
print(f'  INFO lati del tessuto vs cartamodello: scarto medio {np.abs(st).mean() * 100:.2f}%, 99% dei lati entro {np.percentile(np.abs(st), 99) * 100:.1f}%, medio con segno {st.mean() * 100:+.3f}%')
print(f'  INFO tempo di bake {meta["bake_seconds"]} s; taglia {size}: ' + ', '.join(f'{k} {v}' for k, v in table.items()))

meta['measured'] = {k: round(v, 2) for k, v in measured.items() if v is not None}
meta['measured']['note'] = 'misurato sulla mesh 3D finale (check_tee.py), non copiato dalla tabella'
meta['checks'] = [dict(name=a, ok=b, detail=c) for a, b, c in rows]
meta['hem_z_m'] = dict(min=round(float(hz.min()), 4), max=round(float(hz.max()), 4), front_center=round(float(fc), 4), back_center=round(float(bc), 4))
json.dump(meta, open(meta_path, 'w'), indent=2, ensure_ascii=False)
print('CHECK', 'TUTTO OK' if not fails else f'{fails} criteri NON rispettati')
sys.exit(1 if fails else 0)
