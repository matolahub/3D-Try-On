"""Test di fedeltà: misura la mesh in cm reali per diversi valori degli shape key.

Uso:
  Blender -b man-model.blend --python measure_body.py [-- percorso/bodyCalibration.json]

Usa la stessa curva cm -> influence che legge il frontend (bodyCalibration.json).

Per ogni misura (petto/vita/fianchi/altezza) imposta il valore in cm, calcola la geometria deformata
e misura la circonferenza a nastro. Poi verifica l'indipendenza dei morph e alcune combinazioni.
Esce con codice 1 se un errore supera la tolleranza.
"""
import json, os, sys
import numpy as np
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bodyspec as S

TOL_CM = 0.8       # errore massimo accettato sulle circonferenze
TOL_H = 0.3        # ... e sull'altezza

body = S.Body()
kb = body.me.shape_keys.key_blocks
base_w = body.key_world(kb['Basis'])
delta = {k: body.key_world(kb[k]) - base_w for k in S.KEYS}
z_min, z_max = base_w[:, 2].min(), base_w[:, 2].max()
H0 = z_max - z_min
zf = (base_w[:, 2] - z_min) / H0
level0 = {k: z_min + S.LEVEL[k] * H0 for k in S.LEVEL}
z0 = z_min

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
cal_path = args[0] if args else os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'frontend', 'src', 'bodyCalibration.json')
cal = json.load(open(cal_path))

# valori neutri = misure del corpo base
neutral = {k: body.girth(base_w, level0[k]) for k in S.LEVEL}
neutral['Altezza'] = H0 * 100
amp_h = delta['Altezza'][:, 2].max()          # m per influence = 1

def influence(k, cm):
    pts = cal[k]['curve']                       # interpolazione lineare sulla curva misurata
    return float(np.interp(cm, [p[0] for p in pts], [p[1] for p in pts]))

def shape(cms):
    """Geometria deformata per un dict {misura: cm}; le assenti restano al valore neutro."""
    v = {k: influence(k, cms.get(k, neutral[k])) for k in S.KEYS}
    return base_w + sum(v[k] * delta[k] for k in S.KEYS), v

def measure(coords, v):
    """Misure (cm) della geometria; i livelli seguono l'allungamento verticale."""
    out = {}
    for n, sp in S.DERIVED.items():
        z = z0 + sp['level'] * H0 + v['Altezza'] * amp_h * float(S.stretch_profile(np.array(sp['level'])))
        out[n] = body.measure_derived(coords, z, n)
    for k in S.LEVEL:
        z = level0[k] + v['Altezza'] * amp_h * float(S.stretch_profile(np.array(S.LEVEL[k])))
        out[k] = body.girth(coords, z)
    out['Altezza'] = (coords[:, 2].max() - coords[:, 2].min()) * 100
    return out

fails = 0
def check(label, target, got, tol):
    global fails
    ok = abs(got - target) <= tol
    fails += not ok
    print(f'  {"OK  " if ok else "FAIL"} {label:34s} richiesto {target:7.1f}  misurato {got:7.1f}  errore {got-target:+5.2f}')

print('NEUTRO (misure del corpo base): ' + ', '.join(f'{k} {v:.1f}' for k, v in neutral.items()))

print('\n1) Sweep di ogni misura sull\'intero range')
for k in S.KEYS:
    lo, hi = S.RANGES[k]
    for cm in np.linspace(lo, hi, 9) + 0.7:      # valori NON coincidenti coi punti della curva
        if cm > hi: continue
        c, v = shape({k: cm})
        check(f'{k} = {cm:.0f} cm', cm, measure(c, v)[k], TOL_H if k == 'Altezza' else TOL_CM)

print('\n2) Indipendenza: variazione delle ALTRE misure quando ne muovo una all\'estremo')
for k in S.KEYS:
    for cm in S.RANGES[k]:
        c, v = shape({k: cm})
        m = measure(c, v)
        for o in S.KEYS:
            if o == k: continue
            check(f'{k}={cm} -> {o} resta {neutral[o]:.0f}', neutral[o], m[o], TOL_H if o == 'Altezza' else TOL_CM)

print('\n3) Combinazioni realistiche')
for combo in ({'Chest': 108, 'Waist': 92, 'Hips': 104, 'Altezza': 182},
              {'Chest': 86, 'Waist': 70, 'Hips': 90, 'Altezza': 165},
              {'Chest': 122, 'Waist': 112, 'Hips': 118, 'Altezza': 190},
              {'Chest': 92, 'Waist': 100, 'Hips': 96, 'Altezza': 175}):
    c, v = shape(combo)
    m = measure(c, v)
    for k in S.KEYS:
        check(f'combo {k}', combo[k], m[k], TOL_H if k == 'Altezza' else TOL_CM)

# ── Grandezze derivate ────────────────────────────────────────────────────────
TOL_DERIVED = 1.2   # le pendenze sono lineari, la mesh no: tolleranza piu' larga
_c0, _v0 = shape({})
derived0 = {n: measure(_c0, _v0)[n] for n in S.DERIVED}

print('\n4) Grandezze derivate: seguono la misura guida con la pendenza stabilita')
for n, sp in S.DERIVED.items():
    drv = sp['driver']; lo, hi = S.RANGES[drv]
    for cm in np.linspace(lo, hi, 5):
        c, v = shape({drv: cm})
        want = derived0[n] + sp['slope'] * (cm - neutral[drv])
        check(f'{n} con {drv}={cm:.0f} (pend. {sp["slope"]})', want, measure(c, v)[n], TOL_DERIVED)

print('\n5) Le derivate NON cambiano quando muovo misure che non le guidano')
for n, sp in S.DERIVED.items():
    for k in S.KEYS:
        if k == sp['driver']: continue
        for cm in S.RANGES[k]:
            c, v = shape({k: cm})
            check(f'{n} resta con {k}={cm}', derived0[n], measure(c, v)[n], TOL_CM)

print('\n6) INFORMATIVO (non fa fallire il test): altre grandezze influenzate dalle misure')
def extras(c, v):
    z = z0 + 0.815 * H0 + v['Altezza'] * amp_h * float(S.stretch_profile(np.array(0.815)))
    sh = c[np.abs(c[:, 2] - z) < 0.02]
    torso = c[(c[:, 2] > z0 + 0.60 * H0) & (c[:, 2] < z0 + 0.78 * H0) & (~body.arm_mask)]
    ar = c[body.arm_mask & (c[:, 0] > 0)]
    return {'larghezza spalle+braccia': np.ptp(sh[:, 0]) * 100, 'profondita busto': np.ptp(torso[:, 1]) * 100,
            'lunghezza braccio': np.ptp(ar[:, 2]) * 100, 'lunghezza gamba (cavallo-suolo)': (z0 + 0.49 * H0 + v['Altezza'] * amp_h * float(S.stretch_profile(np.array(0.49))) - c[:, 2].min()) * 100}
e0 = extras(_c0, _v0)
print('  base: ' + ', '.join(f'{k} {x:.1f}' for k, x in e0.items()))
for k in S.KEYS:
    for cm in S.RANGES[k]:
        c, v = shape({k: cm}); e = extras(c, v)
        ch = [f'{n} {e[n]-e0[n]:+.1f}' for n in e0 if abs(e[n] - e0[n]) >= 0.3]
        print(f'  {k}={cm}: ' + (', '.join(ch) if ch else 'nessuna variazione'))

print('\nRISULTATO:', 'TUTTO OK' if not fails else f'{fails} controlli falliti')
sys.exit(1 if fails else 0)
