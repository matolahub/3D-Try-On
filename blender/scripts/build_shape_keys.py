"""Ricostruisce gli shape key Chest / Waist / Hips / Altezza calibrati in centimetri reali.

Uso (sul .blend gia' passato da fix_model.py e pose_natural.py):
  Blender -b man-model.blend --python build_shape_keys.py -- man-model.blend ../frontend/src/bodyCalibration.json

Modello di deformazione
- Chest/Waist/Hips sono parti dello stesso campo anatomico, preso dai target macro di MakeHuman (data/mh_reference.npz, vedi
  extract_mh_reference.py): il volume si distribuisce come su un corpo vero (addome davanti e sui fianchi, zona lombare, glutei, anche,
  cosce, dorso, spalle, braccia, collo, viso), non in una fascia orizzontale. Tre finestre lisce che si sommano a 1 (bodyspec.windows)
  assegnano il campo alle tre misure: insieme ricostruiscono il corpo intero del riferimento, da sole sfumano con continuita'.
  Il petto e' un misto OBESE/ATHLETIC (bodyspec.CHEST_FAT_SHARE): un torace che cresce da solo e' soprattutto massa muscolare.
- Lo shape key a influence = 1 vale +(max - misura_base) cm; influence negativa restringe in modo lineare.
  L'ampiezza e' calibrata misurando la circonferenza a nastro della mesh, non stimata.
- Collo, braccia e cosce non hanno piu' un campo a parte ne' una pendenza scritta a mano: sono dentro il campo anatomico.
- Altezza: allungamento verticale da caviglie a base del collo (busto + gambe + braccia); testa/mani/piedi rigidi.
  A influence = 1 la statura vale il massimo del range. Le circonferenze non cambiano.
"""
import json, os, sys
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

# ── Riferimento anatomico (MakeHuman) ────────────────────────────────────────
ref = np.load(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'data', 'mh_reference.npz'))
if ref['basis'].shape != base_w.shape or np.abs(ref['basis'] - base_w).max() > 1e-3:
    raise SystemExit('mh_reference.npz non corrisponde a questa mesh: rigenerarlo con extract_mh_reference.py')
edges = body.edges()

# attorno agli occhi il campo si annulla: la mesh degli occhi non ha questi morph e non deve restare scoperta
mw_e = np.array(eyes.matrix_world); Re, te = mw_e[:3, :3], mw_e[:3, 3]
ec = np.empty(len(eyes.data.vertices) * 3, np.float32)
eyes.data.vertices.foreach_get('co', ec)
ew = ec.reshape(-1, 3) @ Re.T + te
head = np.nonzero(zf > 0.9)[0]
dist_eye = np.full(len(base_w), 1.0)
dist_eye[head] = np.sqrt(((base_w[head, None, :] - ew[None, ::4, :]) ** 2).sum(2)).min(1)
eye_mask = S.ramp(0.012, 0.04, dist_eye, 0.5)[:, None]

OBESE = S.smooth_field(ref['OBESE'], edges) * eye_mask
ATHLETIC = S.smooth_field(ref['ATHLETIC'], edges) * eye_mask
sag = S.sag_mask(zf, body.arm_w)
OBESE[:, 2] *= sag
ATHLETIC[:, 2] *= sag
win = S.windows(zf, body.arm_w)

def height_delta(amp, zfrac):
    d = np.zeros((len(zfrac), 3), np.float32)
    d[:, 2] = amp * S.stretch_profile(zfrac)
    return d

# ── Misure di base ───────────────────────────────────────────────────────────
level_z = {k: z_min + S.LEVEL[k] * H0 for k in S.LEVEL}
base_girth = {k: body.girth(base_w, level_z[k]) for k in S.LEVEL}
print('BASE H0 = %.1f cm' % (H0 * 100), {k: round(v, 1) for k, v in base_girth.items()})

def gain(field, k):
    """Variazione (cm) della circonferenza k prodotta dal campo."""
    return body.girth(base_w + field, level_z[k]) - base_girth[k]

# ── Campi dei tre morph (forma) ──────────────────────────────────────────────
wc = win['Chest'][:, None]
fat, ath = OBESE * wc, ATHLETIC * wc
shape = {'Chest': S.CHEST_FAT_SHARE * fat / gain(fat, 'Chest') + (1 - S.CHEST_FAT_SHARE) * ath / gain(ath, 'Chest')}
shape['Waist'] = OBESE * win['Waist'][:, None]
shape['Hips'] = OBESE * win['Hips'][:, None]

# ── Calibrazione ampiezze: a influence = 1 la circonferenza vale il massimo del range ─
amp = {}
for k in S.LEVEL:
    target = S.RANGES[k][1] - base_girth[k]
    a = target / gain(shape[k], k)
    for _ in range(5):
        a *= target / gain(a * shape[k], k)
    amp[k] = a
    d = a * shape[k]
    print(f'CAL {k}: +{gain(d, k):.2f} cm (target +{target:.2f}), spostamento massimo {np.linalg.norm(d, axis=1).max() * 100:.1f} cm, '
          f'effetto sulle altre: ' + ', '.join(f'{o} {body.girth(base_w + d, level_z[o]) - base_girth[o]:+.2f}' for o in S.LEVEL if o != k))
# ── Braccia a petto massimo: non devono entrare nel dorso ──────────────────────────────────────────────────────────────────────
# Un dorso largo spinge le braccia in fuori: rotazione attorno alla spalla (non una traslazione, che allargherebbe le spalle), fino a
# ARM_ABDUCT_MAX_DEG; il resto e' contatto: la faccia interna del braccio si appiattisce contro il dorso, come fa il tessuto molle.
body.swing_w = {s_: S.smooth_field(body.swing_w[s_][:, None], edges, 6)[:, 0] for s_ in body.swing_w}
chest_full = base_w + amp['Chest'] * shape['Chest']
deg = 0.0
while body.arm_penetration(chest_full + body.abduct(chest_full, deg)) > 0.0 and deg < S.ARM_ABDUCT_MAX_DEG:
    deg += 0.5
abduction = body.abduct(chest_full, deg)
# il contatto e' calcolato contro il busto con TUTTE le misure al massimo (il caso piu' largo): cosi' non c'e' compenetrazione in nessuna combinazione
widest = chest_full + sum(amp[k] * shape[k] for k in ('Waist', 'Hips'))
abduction = abduction + body.arm_contact(widest + abduction, edges)
print(f'BRACCIA a petto massimo: abduzione {deg:.1f} gradi + contatto (compenetrazione senza: {body.arm_penetration(chest_full):.1f} cm, con: {body.arm_penetration(chest_full + abduction):.1f} cm)')
for _ in range(3):          # i pesi levigati dell'abduzione sfiorano il busto sotto l'ascella: si ritocca l'ampiezza perche' il petto resti esatto
    amp['Chest'] *= (S.RANGES['Chest'][1] - base_girth['Chest']) / gain(amp['Chest'] * shape['Chest'] + abduction, 'Chest')

unit = {'OBESE': {k: gain(OBESE * win[k][:, None], k) for k in S.LEVEL}}
print('RIFERIMENTO: frazione del target OBESE usata a influence = 1 -> ' + ', '.join(
    f'{k} {(S.RANGES[k][1] - base_girth[k]) * (S.CHEST_FAT_SHARE if k == "Chest" else 1) / unit["OBESE"][k]:.2f}' for k in S.LEVEL))
amp['Altezza'] = (S.RANGES['Altezza'][1] - H0 * 100) / 100.0
print('CAL Altezza: +%.2f cm' % (amp['Altezza'] * 100))

# ── Scrittura degli shape key sul corpo ──────────────────────────────────────
body.ob.shape_key_clear()
body.ob.shape_key_add(name='Basis', from_mix=False)
deltas = {k: amp[k] * shape[k] for k in S.LEVEL}
deltas['Chest'] = deltas['Chest'] + abduction
deltas['Altezza'] = height_delta(amp['Altezza'], zf)
for name in S.KEYS:
    kb = body.ob.shape_key_add(name=name, from_mix=False)
    kb.slider_min, kb.slider_max = -1.0, 1.0
    kb.relative_key = me.shape_keys.key_blocks['Basis']
    kb.data.foreach_set('co', (base + body.to_local_delta(deltas[name]).astype(np.float32).ravel()))
    kb.value = 0.0

# ── Occhi: seguono la testa nell'allungamento (nessun altro morph li tocca) ──
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
