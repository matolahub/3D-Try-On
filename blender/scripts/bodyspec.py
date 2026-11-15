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

# ── Forma dei morph ───────────────────────────────────────────────────────────
# I tre morph di circonferenza sono PARTI dello stesso campo anatomico (riferimento MakeHuman, vedi extract_mh_reference.py):
#   Chest = campo x finestra_petto,  Waist = campo x finestra_vita,  Hips = campo x finestra_fianchi
# Le finestre sono funzioni lisce della quota che si sommano a 1 (partizione dell'unita'): muovendo le tre misure insieme si ottiene
# il corpo intero del riferimento (nessuna fascia separata); muovendone una sola, il volume sfuma con continuita' verso le altre.
# Ogni finestra vale 1 al proprio livello di misura e 0 ai livelli delle altre due: per questo le misure restano indipendenti
# (il contratto cm -> influence resta una curva per misura) senza correzioni a posteriori.
#   petto   : 1 dal livello del petto in su (spalle, braccia, collo), sfuma a 0 al livello della vita
#   vita    : 1 al livello della vita, 0 al petto e ai fianchi (addome, fianchi alti, zona lombare)
#   fianchi : 1 dal livello dei fianchi in giu' (glutei, anche, cosce, polpacci), sfuma a 0 alla vita
# Braccia e mani appartengono al petto (pesi delle ossa), non alla quota a cui pendono: la vita non le trascina.
RAMP = 0.22                 # raccordo delle finestre (frazione della transizione): rampa lineare con estremi arrotondati
SMOOTH_ITERS = 15           # levigatura laplaciana del CAMPO di spostamento (non della mesh): toglie pieghe e solchi netti dei target
SMOOTH_LAMBDA = 0.6
CHEST_FAT_SHARE = 0.6       # quota della crescita del petto dovuta al campo OBESE; il resto e' ATHLETIC (pettorali, dorsali, spalle, braccia)
TORSO_SAG = 0.0             # frazione della componente VERTICALE del campo tenuta sul busto tra fianchi e petto. A 0 il volume cresce solo in
                            # orizzontale: niente piega "a grembiule" sotto l'addome e, soprattutto, i vertici non attraversano i livelli di
                            # misura, quindi le tre circonferenze restano esatte anche in combinazione (non solo una alla volta)
SAG_BAND = (0.44, 0.50, 0.78, 0.84)   # la componente verticale e' piena sotto 0.44 e sopra 0.84, ridotta a TORSO_SAG tra 0.50 e 0.78
ARM_GAIN = 0.75             # le braccia prendono questa frazione del campo: col campo pieno il braccio cresceva di 0,58 cm per cm di petto
                            # (48 cm a petto 130), piu' di quanto dicano le tabelle antropometriche (braccio ~ 0,35-0,45 del petto)
ARM_ABDUCT_MAX_DEG = 8.0    # un dorso largo spinge le braccia in fuori: rotazione attorno alla spalla, al massimo questi gradi a petto massimo
ARM_CONTACT_GAP = 0.0015    # m: oltre quel limite il braccio non si apre piu': si appiattisce contro il dorso (contatto), a questa distanza
HEAD_FROM, HEAD_TO = 0.845, 0.885            # sopra la base del collo il volume (viso, collo) segue tutte e tre le misure
HEAD_SPLIT = {'Chest': 0.40, 'Waist': 0.35, 'Hips': 0.25}

# Allungamento verticale (Altezza): dalle caviglie alla base del collo; testa, mani e piedi restano invariati
STRETCH_Z0, STRETCH_Z1, STRETCH_RAMP = 0.05, 0.86, 0.06

# Range di misure supportato dallo slider (cm): (min, max) - corrisponde a circa taglie XS-4XL
RANGES = {'Chest': (80, 130), 'Waist': (65, 120), 'Hips': (84, 124), 'Altezza': (155, 200)}

KEYS = ('Chest', 'Waist', 'Hips', 'Altezza')

# Grandezze DERIVATE: non sono input dell'utente e non hanno piu' una pendenza scritta a mano. Seguono la misura guida perche' fanno
# parte dello stesso campo anatomico; qui c'e' solo DOVE si misurano (frazione di H0). measure_body.py ne riporta i valori.
DERIVED = {
    'Collo':   {'level': 0.875, 'driver': 'Chest'},   # sopra il trapezio: a 0.865 un trapezio sviluppato entra nella sezione
    'Braccio': {'level': 0.70,  'driver': 'Chest'},
    'Coscia':  {'level': 0.40,  'driver': 'Hips'},
}
CROTCH = 0.49


def ramp(a, b, x, r=None):
    """Rampa 0 -> 1 tra a e b: lineare, con i due estremi raccordati (derivata trapezoidale => nessuno spigolo, pendenza massima bassa)."""
    r = RAMP if r is None else r
    t = np.clip((np.asarray(x, float) - a) / (b - a), 0.0, 1.0)
    g = np.linspace(0.0, 1.0, 801)
    d = np.clip(np.minimum(g / r, (1 - g) / r), 0.0, 1.0)
    c = np.concatenate([[0.0], np.cumsum((d[1:] + d[:-1]) / 2)])
    return np.interp(t, g, c / c[-1])


def windows(zf, arm_w):
    """Finestre (petto, vita, fianchi) per vertice: zf = quota come frazione di H0, arm_w = peso 'braccio' in [0, 1]. Somma = 1 sul busto."""
    wc = ramp(LEVEL['Waist'], LEVEL['Chest'], zf)
    wh = 1.0 - ramp(LEVEL['Hips'], LEVEL['Waist'], zf)
    ww = 1.0 - wc - wh
    torso = 1.0 - arm_w
    wc, ww, wh = ARM_GAIN * arm_w + torso * wc, torso * ww, torso * wh
    h = ramp(HEAD_FROM, HEAD_TO, zf) * torso
    return {'Chest': wc * (1 - h) + HEAD_SPLIT['Chest'] * h, 'Waist': ww * (1 - h) + HEAD_SPLIT['Waist'] * h, 'Hips': wh * (1 - h) + HEAD_SPLIT['Hips'] * h}


def sag_mask(zf, arm_w):
    """Fattore della componente verticale del campo per vertice (1 = invariata)."""
    a, b, c, d = SAG_BAND
    inside = ramp(a, b, zf) * (1.0 - ramp(c, d, zf)) * (1.0 - arm_w)
    return 1.0 - (1.0 - TORSO_SAG) * inside


def smooth_field(d, edges, iters=None, lam=None):
    """Levigatura laplaciana di un campo per vertice lungo gli spigoli della mesh."""
    iters = SMOOTH_ITERS if iters is None else iters
    lam = SMOOTH_LAMBDA if lam is None else lam
    d = np.array(d, np.float64)
    deg = np.zeros(len(d))
    np.add.at(deg, edges[:, 0], 1)
    np.add.at(deg, edges[:, 1], 1)
    for _ in range(iters):
        acc = np.zeros_like(d)
        np.add.at(acc, edges[:, 0], d[edges[:, 1]])
        np.add.at(acc, edges[:, 1], d[edges[:, 0]])
        d += lam * (acc / deg[:, None] - d)
    return d


def stretch_profile(zf):
    """Frazione di allungamento verticale s(z) in [0,1] per quote zf (frazioni di H0). Derivata trapezoidale => estremi lisci."""
    g = np.linspace(0.0, 1.2, 2401)
    d = np.clip(np.minimum((g - STRETCH_Z0) / STRETCH_RAMP, (STRETCH_Z1 - g) / STRETCH_RAMP), 0.0, 1.0)
    c = np.cumsum(d)
    c = c / c[-1]
    return np.interp(zf, g, c)


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

        # abduzione: pesi delle ossa del braccio vero e proprio (senza spalla/clavicola) e centro dell'articolazione, per lato
        arm_ob = next(m.object for m in self.ob.modifiers if m.type == 'ARMATURE')
        A = np.array(arm_ob.matrix_world)
        self.swing_w, self.joint = {}, {}
        for side in ('L', 'R'):
            idx = {g.index for g in self.ob.vertex_groups if g.name.endswith('.' + side) and g.name.startswith(ARM_PREFIX[:-1])}
            self.swing_w[side] = np.array([min(1.0, sum(g.weight for g in v.groups if g.group in idx)) for v in self.me.vertices])
            h = np.array(arm_ob.data.bones['upperarm01.' + side].head_local)
            self.joint[side] = A[:3, :3] @ h + A[:3, 3]
        self.me.calc_loop_triangles()
        tri = np.array([t.vertices[:] for t in self.me.loop_triangles])
        self.torso_tri = tri[(~self.arm_mask[tri]).all(1)]
        bz = self.key_world(self.me.shape_keys.key_blocks['Basis'])[:, 2] if self.me.shape_keys else np.array([(self.R @ np.array(v.co) + self.t)[2] for v in self.me.vertices])
        self.zf0 = (bz - bz.min()) / np.ptp(bz)
        # sotto l'ascella il busto (senza braccia) e' una superficie chiusa: solo li' "dentro/fuori" ha senso
        self.arm_probe = np.nonzero((self.arm_w > 0.95) & (self.zf0 < 0.745))[0]

    def abduct(self, coords, deg):
        """Ruota le braccia verso l'esterno di `deg` gradi attorno all'asse antero-posteriore che passa per la spalla. Ritorna lo spostamento."""
        d = np.zeros_like(coords)
        for side, sgn in (('L', -1.0), ('R', 1.0)):
            a = math.radians(deg) * sgn
            R = np.array([[math.cos(a), 0, math.sin(a)], [0, 1, 0], [-math.sin(a), 0, math.cos(a)]])
            rel = coords - self.joint[side]
            d += self.swing_w[side][:, None] * (rel @ R.T - rel)
        return d

    def arm_contact(self, coords, edges, gap=None, rounds=8):
        """Spostamento che porta fuori dal busto i vertici del braccio che ci stanno dentro (il braccio si appiattisce contro il dorso)."""
        from mathutils import Vector
        from mathutils.bvhtree import BVHTree
        gap = ARM_CONTACT_GAP if gap is None else gap
        tree = BVHTree.FromPolygons([tuple(p) for p in coords], [tuple(t) for t in self.torso_tri])
        total = np.zeros_like(coords)
        w = self.arm_w[:, None]
        for r in range(rounds):
            push = np.zeros_like(coords)
            for i in self.arm_probe:
                p = Vector(coords[i] + total[i])
                loc, nrm, _, dist = tree.find_nearest(p, 0.08)
                if loc is not None and (p - loc).dot(nrm) < gap:
                    push[i] = np.array(loc + nrm * gap - p)
            if np.abs(push).max() < 1e-5:
                break
            total += push
            if r < rounds - 1:                     # il contatto sfuma sui vertici vicini (nessuno spigolo), l'ultimo giro garantisce la distanza
                total = (0.5 * total + 0.5 * smooth_field(total, edges, 2)) * w
        return total

    def arm_penetration(self, coords):
        """Profondita' massima (cm) a cui un vertice del braccio (sotto l'ascella) sta dentro il busto."""
        from mathutils import Vector
        from mathutils.bvhtree import BVHTree
        tree = BVHTree.FromPolygons([tuple(p) for p in coords], [tuple(t) for t in self.torso_tri])
        deep = 0.0
        for i in self.arm_probe:
            loc, nrm, _, dist = tree.find_nearest(Vector(coords[i]), 0.08)
            if loc is not None and (Vector(coords[i]) - loc).dot(nrm) < 0:
                deep = max(deep, dist)
        return deep * 100.0

    def key_world(self, key):
        a = np.empty(len(self.me.vertices) * 3, np.float32)
        key.data.foreach_get('co', a)
        return a.reshape(-1, 3) @ self.R.T + self.t

    def to_local_delta(self, dworld):
        return dworld @ self.Rinv.T

    def edges(self):
        e = np.empty(len(self.me.edges) * 2, np.int64)
        self.me.edges.foreach_get('vertices', e)
        return e.reshape(-1, 2)

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
        """Circonferenza a nastro (cm) del busto alla quota z (m), oppure None se non c'e' sezione.

        Tolte le braccia, la sezione del busto puo' arrivare in piu' archi (davanti e dietro, separati sotto le ascelle): il nastro
        li avvolge tutti, quindi si prende il guscio convesso dell'UNIONE degli archi che attraversano il piano sagittale.
        """
        arcs = [pts for pts in self.loops(coords, z, ~self.arm_mask) if pts[:, 0].min() < 0 < pts[:, 0].max()]
        return self._hull_perimeter(np.vstack(arcs)) * 100.0 if arcs else None

    def limb_girth(self, coords, z, kind):
        """Circonferenza (cm) di coscia o braccio sinistro (x > 0) alla quota z (m)."""
        keep = self.arm_mask if kind == 'Braccio' else ~self.arm_mask
        cand = [p for p in self.loops(coords, z, keep) if p[:, 0].mean() > 0.02]
        if not cand:
            return None
        return self._hull_perimeter(max(cand, key=len)) * 100.0

    def measure_derived(self, coords, z, name):
        return self.girth(coords, z) if name == 'Collo' else self.limb_girth(coords, z, name)
