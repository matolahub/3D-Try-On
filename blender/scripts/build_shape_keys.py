"""Ricostruisce gli shape key Chest / Waist / Hips / Altezza calibrati in centimetri reali.

Uso (sul .blend gia' passato da fix_model.py e pose_natural.py):
  Blender -b man-model.blend --python build_shape_keys.py -- man-model.blend ../frontend/src/bodyCalibration.json

Modello di deformazione
- Chest/Waist/Hips: spostamento radiale orizzontale (dall'asse del busto) modulato da una fascia verticale liscia
  e da un fattore direzionale (addome in avanti, glutei indietro).
  Lo shape key a influence = 1 vale +(max - misura_base) cm; influence negativa restringe in modo lineare.
  L'ampiezza e' calibrata misurando la circonferenza a nastro della mesh, non stimata.
- Grandezze derivate (non sono input): collo e braccia seguono Chest, cosce seguono Hips, con le pendenze di
  bodyspec.DERIVED (stime antropometriche approssimate). Sono campi aggiuntivi dentro lo stesso shape key.
- Altezza: allungamento verticale da caviglie a base del collo (busto + gambe + braccia); testa/mani/piedi rigidi.
  A influence = 1 la statura vale il massimo del range. Le circonferenze non cambiano.
"""
import json, math, os, sys
import numpy as np
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bodyspec as S

args = sys.argv[sys.argv.index('--') + 1:]
out_blend, out_json = args[0], args[1]

body = S.Body()
me = body.me
eyes = bpy.data.objects[S.EYES]

# ── Geometria di partenza (Basis, spazio mondo) ──────────────────────────────
base = np.empty(len(me.vertices) * 3, np.float32)
me.vertices.foreach_get('co', base)
base_w = base.reshape(-1, 3) @ body.R.T + body.t
z_min, z_max = base_w[:, 2].min(), base_w[:, 2].max()
H0 = z_max - z_min
zf = (base_w[:, 2] - z_min) / H0

# Asse del busto per quota (centroide dei vertici non-braccio), interpolato in z
grid = np.arange(0.80, 1.60, 0.01)
ax = []
for zg in grid:
    m = (~body.arm_mask) & (np.abs(base_w[:, 2] - zg) < 0.015)
    ax.append(base_w[m, :2].mean(0))
ax = np.array(ax)
axis_xy = np.stack([np.interp(base_w[:, 2], grid, ax[:, 0]), np.interp(base_w[:, 2], grid, ax[:, 1])], 1)
rvec = base_w[:, :2] - axis_xy
rhat = rvec / np.maximum(np.linalg.norm(rvec, axis=1, keepdims=True), 1e-6)

# Lato (sinistra/destra del personaggio) e assi per lato di arti e gambe
sgn = np.where(base_w[:, 0] >= 0, 1, -1)
def unit(v): return v / np.maximum(np.linalg.norm(v, axis=1, keepdims=True), 1e-6)
def side_axis(mask, zlo, zhi):
    """Asse (x,y) per vertice: centroide dei vertici in mask, per quota e per lato."""
    xy = np.zeros((len(base_w), 2))
    g = np.arange(zlo, zhi, 0.01)
    for s in (1, -1):
        zs, pts = [], []
        for zg in g:
            m = mask & (sgn == s) & (np.abs(base_w[:, 2] - zg) < 0.015)
            if m.sum() >= 3:
                zs.append(zg); pts.append(base_w[m, :2].mean(0))
        pts = np.array(pts); sel = sgn == s
        xy[sel, 0] = np.interp(base_w[sel, 2], zs, pts[:, 0]); xy[sel, 1] = np.interp(base_w[sel, 2], zs, pts[:, 1])
    return xy
arm_axis = side_axis(body.arm_mask, 0.70, 1.50)
arm_rhat = unit(base_w[:, :2] - arm_axis)
leg_rhat = unit(base_w[:, :2] - side_axis(~body.arm_mask, 0.10, 0.84))

def neck_field(a):
    d = np.zeros_like(base_w)
    d[:, :2] = rhat * (a * S.cos_band(zf, S.NECK_BAND) * (1 - body.arm_w))[:, None]
    return d

def arm_field(a):
    d = np.zeros_like(base_w)
    d[:, :2] = arm_rhat * (a * S.arm_profile(zf) * body.arm_w)[:, None]
    return d

def thigh_field(a):
    """Ispessisce la coscia solo verso l'esterno: il lato interno non si muove, cosi' le cosce non si compenetrano."""
    d = np.zeros_like(base_w)
    inward = -sgn * leg_rhat[:, 0]
    f = np.clip(1 - 1.5 * np.maximum(inward, 0), 0, 1)
    w = S.cos_band(zf, S.THIGH_BAND) * (1 - body.arm_w) * (zf < S.CROTCH) * f
    d[:, :2] = leg_rhat * (a * w)[:, None]
    return d

# Direzione per i vertici del braccio: il braccio trasla in modo RIGIDO (stessa direzione per ogni vertice della
# sezione, verso il centro del braccio), altrimenti una direzione radiale "a ventaglio" ne allargherebbe la sezione.
arm_dir = unit(arm_axis - axis_xy)
dir_xy = unit((1 - body.arm_w)[:, None] * rhat + body.arm_w[:, None] * arm_dir)

def radial_delta(key, amp):
    """Spostamento radiale (m, mondo) di ampiezza amp con la fascia del morph."""
    d = np.zeros_like(base_w)
    w = S.band_weight(zf, key)
    if key in S.ARM_FOLLOW_BELOW:
        w = body.arm_w * np.where(zf <= S.BANDS[key][0], 1.0, w) + (1 - body.arm_w) * w
    f = np.clip(1 + S.FRONT_BIAS[key] * (-dir_xy[:, 1]), 0.2, None)
    d[:, :2] = dir_xy * (amp * w * f)[:, None]
    return d

def height_delta(amp, zfrac):
    d = np.zeros((len(zfrac), 3), np.float32)
    d[:, 2] = amp * S.stretch_profile(zfrac)
    return d

# ── Misure di base ───────────────────────────────────────────────────────────
level_z = {k: z_min + S.LEVEL[k] * H0 for k in S.LEVEL}
base_girth = {k: body.girth(base_w, level_z[k]) for k in S.LEVEL}
print('BASE H0 = %.1f cm' % (H0 * 100), {k: round(v, 1) for k, v in base_girth.items()})

# ── Calibrazione ampiezze ────────────────────────────────────────────────────
FIELD = {'Collo': neck_field, 'Braccio': arm_field, 'Coscia': thigh_field}
ZERO = np.zeros_like(base_w)
extra = {'Chest': ZERO, 'Waist': ZERO, 'Hips': ZERO}

def calibrate_torso(k):
    target = S.RANGES[k][1] - base_girth[k]              # +cm all'estremo alto del range
    a = target / 100.0 / (2 * math.pi)
    for _ in range(4):
        got = body.girth(base_w + radial_delta(k, a) + extra[k], level_z[k]) - base_girth[k]
        a *= target / got
    return a

# passata 1: busto da solo
amp = {k: calibrate_torso(k) for k in S.LEVEL}
# passata 2: grandezze derivate misurate NEL contesto del morph guida (a influence = 1), cosi' l'effetto del busto e' incluso
derived_base = {}
for name, spec in S.DERIVED.items():
    drv = spec['driver']
    target = spec['slope'] * (S.RANGES[drv][1] - base_girth[drv])      # cm all'estremo alto del range
    z = z_min + spec['level'] * H0
    b0 = body.measure_derived(base_w, z, name)
    ctx = radial_delta(drv, amp[drv]) + extra[drv]
    a = target / 100.0 / (2 * math.pi)
    for _ in range(6):
        got = body.measure_derived(base_w + ctx + FIELD[name](a), z, name) - b0
        a *= target / got
    extra[drv] = extra[drv] + FIELD[name](a)
    derived_base[name] = b0
    got = body.measure_derived(base_w + radial_delta(drv, amp[drv]) + extra[drv], z, name) - b0
    print(f'CAL {name}: base {b0:.1f} cm, +{got:.2f} cm all\'estremo (target +{target:.2f}, pendenza {spec["slope"]} su {drv})')
# passata 3: busto ricalibrato con i campi derivati inclusi
for k in S.LEVEL:
    amp[k] = calibrate_torso(k)
    got = body.girth(base_w + radial_delta(k, amp[k]) + extra[k], level_z[k]) - base_girth[k]
    print(f'CAL {k}: ampiezza {amp[k]*100:.3f} cm radiali -> +{got:.2f} cm (target +{S.RANGES[k][1] - base_girth[k]:.2f})')
amp['Altezza'] = (S.RANGES['Altezza'][1] - H0 * 100) / 100.0
print('CAL Altezza: +%.2f cm' % (amp['Altezza'] * 100))

# ── Scrittura degli shape key sul corpo ──────────────────────────────────────
body.ob.shape_key_clear()
body.ob.shape_key_add(name='Basis', from_mix=False)
deltas = {k: radial_delta(k, amp[k]) + extra[k] for k in S.LEVEL}
deltas['Altezza'] = height_delta(amp['Altezza'], zf)
for name in S.KEYS:
    kb = body.ob.shape_key_add(name=name, from_mix=False)
    kb.slider_min, kb.slider_max = -1.0, 1.0
    kb.relative_key = me.shape_keys.key_blocks['Basis']
    kb.data.foreach_set('co', (base + body.to_local_delta(deltas[name]).astype(np.float32).ravel()))
    kb.value = 0.0

# ── Occhi: seguono la testa nell'allungamento (nessun altro morph li tocca) ──
mw_e = np.array(eyes.matrix_world); Re, te = mw_e[:3, :3], mw_e[:3, 3]
ec = np.empty(len(eyes.data.vertices) * 3, np.float32)
eyes.data.vertices.foreach_get('co', ec)
ew = ec.reshape(-1, 3) @ Re.T + te
ezf = (ew[:, 2] - z_min) / H0
eyes.shape_key_clear()
eyes.shape_key_add(name='Basis', from_mix=False)
ek = eyes.shape_key_add(name='Altezza', from_mix=False)
ek.slider_min, ek.slider_max = -1.0, 1.0
ek.data.foreach_set('co', ec + (height_delta(amp['Altezza'], ezf) @ np.linalg.inv(Re).T).astype(np.float32).ravel())

# ── Curva di calibrazione cm -> influence (misurata, non assunta lineare) ────
def solve_influence(k, cm):
    """Influence dello shape key k per cui la circonferenza misurata vale cm."""
    v = (cm - base_girth[k]) / (S.RANGES[k][1] - base_girth[k])
    for _ in range(6):
        g = body.girth(base_w + v * deltas[k], level_z[k])
        if abs(g - cm) < 0.02:
            break
        h = 0.02
        slope = (body.girth(base_w + (v + h) * deltas[k], level_z[k]) - g) / h
        v += (cm - g) / slope
    return v

cal = {}
for k in S.LEVEL:
    lo, hi = S.RANGES[k]
    cms = sorted(set(list(np.linspace(lo, hi, 13).round(2)) + [round(base_girth[k], 2)]))
    curve = [[float(c), 0.0 if abs(c - round(base_girth[k], 2)) < 1e-9 else round(float(solve_influence(k, c)), 5)] for c in cms]
    cal[k] = {'neutral': round(base_girth[k], 2), 'min': lo, 'max': hi, 'curve': curve}
    print(f'CURVA {k}:', ' '.join(f'{c:.0f}->{v:+.3f}' for c, v in curve))
lo, hi = S.RANGES['Altezza']
n = round(H0 * 100, 2)
cal['Altezza'] = {'neutral': n, 'min': lo, 'max': hi, 'curve': [[lo, (lo - n) / (hi - n)], [n, 0.0], [hi, 1.0]]}
with open(out_json, 'w') as f:
    json.dump(cal, f, indent=2)
print('CALIBRATION scritta in', out_json)

bpy.ops.wm.save_as_mainfile(filepath=out_blend)
print('SAVED', out_blend)
