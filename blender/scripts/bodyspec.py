"""Specifiche anatomiche del corpo, condivise da build_shape_keys.py e measure_body.py.

Convenzioni
- Tutte le coordinate di questo modulo sono in spazio MONDO, in metri, Z verso l'alto, fronte verso -Y.
- Le misure sono circonferenze "a nastro": perimetro convesso della sezione orizzontale del busto
  (le braccia sono escluse tramite i pesi dei vertex group).
- I livelli di misura sono frazioni dell'altezza del modello base (H0).
"""
import math
import bmesh
import bpy
import numpy as np

BODY, EYES = 'firstmodelMesh', 'high-polyMesh'
ARM_PREFIX = ('upperarm', 'lowerarm', 'wrist', 'finger', 'metacarpal', 'shoulder')

# Livello (frazione di H0) a cui si misura ciascuna circonferenza
LEVEL = {'Chest': 0.75, 'Waist': 0.635, 'Hips': 0.52}

# Fascia di influenza di ciascun morph: (centro, semilarghezza sopra, semilarghezza sotto), in frazioni di H0.
# Le fasce terminano ai livelli di misura vicini (petto 0.75, vita 0.635, fianchi 0.52) o al cavallo (0.49),
# non necessariamente al proprio centro: il picco puo' stare piu' in alto/basso del livello di misura.
BANDS = {
    'Chest': (0.75,  0.100, 0.115),
    'Waist': (0.635, 0.115, 0.115),
    'Hips':  (0.53,  0.105, 0.040),
}

# Le braccia sono appese lungo i fianchi: sotto il picco dei fianchi seguono comunque lo spostamento pieno,
# altrimenti le mani resterebbero indietro rispetto al bacino allargato.
ARM_FOLLOW_BELOW = ('Hips',)

# Direzionalita': la crescita non e' uniforme attorno al busto. f = 1 + b * (-rhat_y): b > 0 favorisce il davanti
# (addome), b < 0 il dietro (glutei). La calibrazione in cm compensa l'effetto sul perimetro.
FRONT_BIAS = {'Chest': 0.15, 'Waist': 0.70, 'Hips': -0.20}

# Allungamento verticale (Altezza): dalle caviglie alla base del collo; testa, mani e piedi restano invariati
STRETCH_Z0, STRETCH_Z1, STRETCH_RAMP = 0.05, 0.86, 0.06

# Range di misure supportato dallo slider (cm): (min, max) - corrisponde a circa taglie XS-4XL
RANGES = {'Chest': (80, 130), 'Waist': (65, 120), 'Hips': (84, 124), 'Altezza': (155, 200)}

KEYS = ('Chest', 'Waist', 'Hips', 'Altezza')

# Grandezze DERIVATE: non sono input dell'utente, seguono una delle 4 misure principali con una pendenza fissa
# (cm di variazione per ogni cm di variazione della misura guida).
# ATTENZIONE: le pendenze sono stime antropometriche approssimate, non dati misurati su una popolazione.
# livello = frazione di H0; le misure sono circonferenze orizzontali (a nastro).
DERIVED = {
    'Collo':   {'level': 0.865, 'driver': 'Chest', 'slope': 0.25},   # colletto: cresce col petto
    'Braccio': {'level': 0.70,  'driver': 'Chest', 'slope': 0.30},   # braccio (sezione orizzontale, meta' superiore)
    'Coscia':  {'level': 0.40,  'driver': 'Hips',  'slope': 0.60},   # coscia: cresce coi fianchi
}
NECK_BAND = (0.865, 0.020, 0.025)      # (centro, semilarghezza sopra, sotto) in frazioni di H0
THIGH_BAND = (0.40, 0.09, 0.13)        # dal cavallo (0.49) al ginocchio (0.27), nullo al cavallo
CROTCH = 0.49


def arm_profile(zf):
    """Peso dello ispessimento del braccio lungo la sua lunghezza (frazioni di H0): nullo alla mano e alla spalla."""
    zf = np.asarray(zf, float)
    return np.interp(zf, [0.47, 0.52, 0.68, 0.78, 0.83], [0.0, 0.55, 1.0, 1.0, 0.0])


def cos_band(zf, band):
    c, up, down = band
    d = np.asarray(zf, float) - c
    w = np.zeros_like(d)
    m = (d >= 0) & (d < up);   w[m] = 0.5 * (1 + np.cos(np.pi * d[m] / up))
    m = (d < 0) & (d > -down); w[m] = 0.5 * (1 + np.cos(np.pi * d[m] / down))
    return w


def stretch_profile(zf):
    """Frazione di allungamento verticale s(z) in [0,1] per quote zf (frazioni di H0). Derivata trapezoidale => estremi lisci."""
    g = np.linspace(0.0, 1.2, 2401)
    d = np.clip(np.minimum((g - STRETCH_Z0) / STRETCH_RAMP, (STRETCH_Z1 - g) / STRETCH_RAMP), 0.0, 1.0)
    c = np.cumsum(d)
    c = c / c[-1]
    return np.interp(zf, g, c)


def band_weight(zf, key):
    c, up, down = BANDS[key]
    d = zf - c
    w = np.zeros_like(zf)
    m = (d >= 0) & (d < up)
    w[m] = 0.5 * (1 + np.cos(np.pi * d[m] / up))
    m = (d < 0) & (d > -down)
    w[m] = 0.5 * (1 + np.cos(np.pi * d[m] / down))
    return w


class Body:
    """Accesso alla mesh del corpo in spazio mondo e vertex group delle braccia."""

    def __init__(self):
        self.ob = bpy.data.objects[BODY]
        self.me = self.ob.data
        mw = np.array(self.ob.matrix_world)
        self.R = mw[:3, :3]          # local -> world (lineare)
        self.t = mw[:3, 3]
        self.Rinv = np.linalg.inv(self.R)
        names = {g.index: g.name for g in self.ob.vertex_groups}
        self.arm = set()
        for v in self.me.vertices:
            if sum(g.weight for g in v.groups if names[g.group].startswith(ARM_PREFIX)) > 0.5:
                self.arm.add(v.index)
        self.arm_mask = np.zeros(len(self.me.vertices), bool)
        self.arm_mask[list(self.arm)] = True
        self.arm_w = np.array([min(1.0, sum(g.weight for g in v.groups if names[g.group].startswith(ARM_PREFIX)))
                               for v in self.me.vertices])

    def key_world(self, key):
        a = np.empty(len(self.me.vertices) * 3, np.float32)
        key.data.foreach_get('co', a)
        return a.reshape(-1, 3) @ self.R.T + self.t

    def to_local_delta(self, dworld):
        return dworld @ self.Rinv.T

    # ── Misura ────────────────────────────────────────────────────────────────
    def _hull_perimeter(self, pts):
        P = sorted(set(map(tuple, pts)))
        if len(P) < 3:
            return 0.0
        def cross(o, a, b): return (a[0]-o[0])*(b[1]-o[1]) - (a[1]-o[1])*(b[0]-o[0])
        lo, up = [], []
        for p in P:
            while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0: lo.pop()
            lo.append(p)
        for p in reversed(P):
            while len(up) >= 2 and cross(up[-2], up[-1], p) <= 0: up.pop()
            up.append(p)
        H = lo[:-1] + up[:-1]
        return sum(math.dist(H[i], H[(i+1) % len(H)]) for i in range(len(H)))

    def loops(self, coords, z, keep):
        """Sezione orizzontale a quota z (m). Tiene solo i vertici con keep=True. Ritorna una lista di array (N,2) di punti (x,y), uno per loop."""
        bm = bmesh.new()
        bm.from_mesh(self.me)
        for v, c in zip(bm.verts, coords):
            v.co = tuple(c)
        bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.verts[i] for i in np.nonzero(~keep)[0]], context='VERTS')
        bm.verts.index_update(); bm.verts.ensure_lookup_table(); bm.edges.ensure_lookup_table(); bm.faces.ensure_lookup_table()
        res = bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
                                     plane_co=(0, 0, z), plane_no=(0, 0, 1), clear_inner=False, clear_outer=False)
        cut = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
        parent = {}
        def find(a):
            parent.setdefault(a, a)
            while parent[a] != a:
                parent[a] = parent[parent[a]]; a = parent[a]
            return a
        for e in cut:
            parent[find(e.verts[0].index)] = find(e.verts[1].index)
        comps = {}
        for e in cut:
            comps.setdefault(find(e.verts[0].index), []).append(e)
        out = [np.array([(v.co.x, v.co.y) for v in {v.index: v for e in es for v in e.verts}.values()]) for es in comps.values()]
        bm.free()
        return out

    def girth(self, coords, z):
        """Circonferenza a nastro (cm) del busto alla quota z (m), oppure None se non c'e' sezione."""
        best = None
        for pts in self.loops(coords, z, ~self.arm_mask):
            if pts[:, 0].min() < 0 < pts[:, 0].max() and (best is None or np.ptp(pts[:, 0]) > best[0]):
                best = (np.ptp(pts[:, 0]), pts)
        return None if best is None else self._hull_perimeter(best[1]) * 100.0

    def limb_girth(self, coords, z, kind):
        """Circonferenza (cm) di coscia o braccio sinistro (x > 0) alla quota z (m)."""
        keep = self.arm_mask if kind == 'Braccio' else ~self.arm_mask
        cand = [p for p in self.loops(coords, z, keep) if p[:, 0].mean() > 0.02]
        if not cand:
            return None
        return self._hull_perimeter(max(cand, key=len)) * 100.0

    def measure_derived(self, coords, z, name):
        return self.girth(coords, z) if name == 'Collo' else self.limb_girth(coords, z, name)
