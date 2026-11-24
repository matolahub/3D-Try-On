"""Priori geometrici per il Live Body Scan: dalla mesh calibrata ricava, ai livelli di petto/vita/fianchi,
il rapporto profondita'/larghezza della sezione del busto e il fattore tra circonferenza a nastro ed ellisse.

Uso:
  Blender -b blender/man-model.blend --python blender/scripts/scan_shape_priors.py -- frontend/src/scan/shapePriors.json

La fotocamera vede solo larghezze (di fronte) e profondita' (di lato). La circonferenza si stima come
  giro ~= k * perimetro_ellisse(larghezza/2, profondita'/2)
e, se manca la vista laterale, profondita' ~= r * larghezza. k ed r si misurano qui sulla sezione reale del busto
(braccia escluse, guscio convesso = nastro), su una griglia di corpi ottenuta combinando gli shape key calibrati.
Sono priori di UN modello anatomico: vanno affinati con misure reali (metro) su persone vere.
"""
import json, math, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bodyspec as S

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
out_path = args[0] if args else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'frontend', 'src', 'scan', 'shapePriors.json')
cal = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'frontend', 'src', 'bodyCalibration.json')))

body = S.Body()
kb = body.me.shape_keys.key_blocks
base_w = body.key_world(kb['Basis'])
delta = {k: body.key_world(kb[k]) - base_w for k in S.KEYS}


def influence(k, cm):
    pts = cal[k]['curve']
    return float(np.interp(cm, [p[0] for p in pts], [p[1] for p in pts]))


def ramanujan(a, b):
    h = ((a - b) / (a + b)) ** 2
    return math.pi * (a + b) * (1 + 3 * h / (10 + math.sqrt(4 - 3 * h)))


# quote (frazione dell'altezza) dove la fotocamera legge la LARGHEZZA (vista frontale) e la PROFONDITA' (vista laterale).
# Il petto di fronte si legge sotto le ascelle (0,70): da 0,72 in su, nelle silhouette dei corpi magri entra il tessuto dell'ascella
# (provato sul corpo 3D renderizzato: +3,5 cm di larghezza a 0,72 con petto 88). A 0,75 (quota del giro petto del modello) nella silhouette frontale il
# braccio tocca il busto anche in posa "A". Di profilo il braccio non disturba e la profondita' si legge a 0,75.
# Varianti provate (max/medio errore sul giro petto, cm): w0,72+d0,72 8,5/2,8 · w0,72+d0,735 5,1/2,0 · w0,72+d0,75 3,1/1,5.
FRONT_LEVEL = {'Chest': 0.70, 'Waist': S.LEVEL['Waist'], 'Hips': S.LEVEL['Hips']}
SIDE_LEVEL = dict(S.LEVEL)


def section(coords, z, zg=None):
    """Larghezza e profondita' della sezione a quota z, giro a nastro a quota zg (default: la stessa)."""
    if zg is not None and zg != z:
        w, d, _ = section(coords, z)
        _, _, g = section(coords, zg)
        return w, d, g
    arcs = [p for p in body.loops(coords, z, ~body.arm_mask) if p[:, 0].min() < 0 < p[:, 0].max()]
    if not arcs:
        return None
    pts = np.vstack(arcs)
    w = pts[:, 0].max() - pts[:, 0].min()
    d = pts[:, 1].max() - pts[:, 1].min()
    g = body._hull_perimeter(pts)
    return w * 100, d * 100, g * 100


def frac_steps(k):
    c = cal[k]
    return [c['min'] + 0.15 * (c['max'] - c['min']), c['neutral'], c['max'] - 0.15 * (c['max'] - c['min'])]


# Quote di ripiego per la larghezza del petto: se nella silhouette frontale il braccio copre la quota 0,70, la si legge piu'
# in basso e la si riporta a 0,70 con il rapporto medio w(0,70)/w(L) misurato qui.
CHEST_FALLBACK = [0.685, 0.67, 0.655, 0.64]
fallback = {L: [] for L in CHEST_FALLBACK}

rows = {k: [] for k in S.LEVEL}
for h in [160, cal['Altezza']['neutral'], 192]:
    for ch in frac_steps('Chest'):
        for wa in frac_steps('Waist'):
            for hi in frac_steps('Hips'):
                cms = {'Chest': ch, 'Waist': wa, 'Hips': hi, 'Altezza': h}
                coords = base_w + sum(influence(k, cms[k]) * delta[k] for k in S.KEYS)
                z0, z1 = coords[:, 2].min(), coords[:, 2].max()
                for k, f in S.LEVEL.items():
                    zw, zd, zg = (z0 + L * (z1 - z0) for L in (FRONT_LEVEL[k], SIDE_LEVEL[k], f))
                    w, _, g = section(coords, zw, zg)
                    s = (w, section(coords, zd)[1], g)
                    if s:
                        w, d, g = s
                        rows[k].append((w, d, g, cms[k]))
                        if k == 'Chest':
                            for L in CHEST_FALLBACK:
                                fallback[L].append(w / section(coords, z0 + L * (z1 - z0))[0])

out = {'source': 'blender/scripts/scan_shape_priors.py su man-model.blend', 'levels': FRONT_LEVEL, 'sideLevels': SIDE_LEVEL, 'girthLevels': dict(S.LEVEL), 'priors': {}}
for k, rs in rows.items():
    a = np.array(rs)
    r = a[:, 1] / a[:, 0]
    kk = a[:, 2] / np.array([ramanujan(w / 2, d / 2) for w, d, _, _ in rs])
    # errore della stima con sola larghezza (profondita' = r medio * larghezza) rispetto al giro a nastro
    est_front = kk.mean() * np.array([ramanujan(w / 2, r.mean() * w / 2) for w, _, _, _ in rs])
    est_both = kk.mean() * np.array([ramanujan(w / 2, d / 2) for w, d, _, _ in rs])
    out['priors'][k] = {
        'depthRatio': round(float(r.mean()), 4), 'depthRatioStd': round(float(r.std()), 4),
        'k': round(float(kk.mean()), 4), 'kStd': round(float(kk.std()), 4),
        'errFrontOnlyCm': round(float(np.abs(est_front - a[:, 2]).max()), 2),
        'errFrontSideCm': round(float(np.abs(est_both - a[:, 2]).max()), 2),
        'n': len(rs),
    }
    # modelli lineari (minimi quadrati): giro = a*W + b*D (+c), e profondita' = alpha*W + beta (solo vista frontale)
    W, D, G = a[:, 0], a[:, 1], a[:, 2]
    A2 = np.c_[W, D, np.ones_like(W)]
    c2, *_ = np.linalg.lstsq(A2, G, rcond=None)
    A1 = np.c_[W, np.ones_like(W)]
    cd, *_ = np.linalg.lstsq(A1, D, rcond=None)
    Dhat = A1 @ cd
    c1, *_ = np.linalg.lstsq(A1, G, rcond=None)
    out['priors'][k].update({
        'linFS': [round(float(x), 5) for x in c2], 'errLinFSCm': round(float(np.abs(A2 @ c2 - G).max()), 2),
        'depthFromWidth': [round(float(x), 5) for x in cd], 'errDepthCm': round(float(np.abs(Dhat - D).max()), 2),
        'linF': [round(float(x), 5) for x in c1], 'errLinFCm': round(float(np.abs(A1 @ c1 - G).max()), 2),
        'widthRange': [round(float(W.min()), 1), round(float(W.max()), 1)], 'depthRange': [round(float(D.min()), 1), round(float(D.max()), 1)],
    })
    print('PRIOR', k, out['priors'][k])

out['chestFallback'] = [{'level': L, 'ratio': round(float(np.mean(v)), 4), 'ratioStd': round(float(np.std(v)), 4),
                         'ratioMaxErr': round(float(np.max(np.abs(np.array(v) - np.mean(v)))), 4)} for L, v in fallback.items()]
print('FALLBACK', out['chestFallback'])

os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
json.dump(out, open(out_path, 'w'), indent=2)
print('WROTE', out_path)
