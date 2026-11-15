"""Costruisce e veste la T-shirt: cartamodello (pattern.py) -> pezzi cuciti -> UNA cloth sim sul corpo neutro -> rifinitura -> GLB.

Uso (dalla cartella del repository):
  Blender -b blender/man-model.blend --python blender/garment/build_tee.py -- --size S [--glb percorso.glb] [--out cartella] [--res 1.2] [--preview]
         [--q chiave=valore,...]   parametri del tessuto (vedi FABRIC)      [--no-sym]  non simmetrizzare
         [--keys Chest=0.7,...]    SOLO PER CONFRONTO: sim su un corpo con quegli shape key (verifica del deformatore runtime, compare_hybrid.py)

Fasi
  1. pezzi: davanti, dietro, due maniche (pattern.pieces), triangolati con reticolo simmetrico; cuciture = coppie di vertici
  2. vestizione: corpo con le braccia all'angolo della manica del cartamodello (i pezzi stesi combaciano senza tensioni); il davanti e il
     dietro sono piani davanti e dietro al busto, le maniche piegate a U sopra le braccia; le molle di cucitura chiudono le cuciture
  3. saldatura delle cuciture; le lunghezze del tessuto vengono riportate a quelle del cartamodello (strain limiting)
  4. le braccia scendono nella posa naturale e il tessuto si assesta
  5. rifinitura: simmetria sinistra/destra, lunghezze = cartamodello, distanza minima dal corpo, spessore del colletto, risvolti
  6. export: GLB (texture dalla foto, colore per vertice sulle cuciture, attributo _sleeve per il runtime) + JSON di metadati
     + archivio .npz con cartamodello e posizioni, usato da check_tee.py per i criteri di accettazione
Il corpo NON cambia forma durante la sim: l'adattamento alle misure dell'utente avviene a runtime (frontend/src/core/garment/bound.js).
"""
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector, geometry  # noqa: E402
from mathutils.bvhtree import BVHTree  # noqa: E402

import common as C  # noqa: E402
import pattern as P  # noqa: E402

CM = 0.01
OBJECT_NAME = 'tee'
PIECES = ('front', 'back', 'sleeve_L', 'sleeve_R')

# Tessuto. Unita' della cloth sim di Blender (non fisiche: la massa e' per vertice). La GRAMMATURA reale non e' nota: questi valori
# descrivono un jersey di cotone pesante "a occhio" e sono stati tarati un parametro alla volta (vedi README, tabella di taratura).
FABRIC = dict(
    quality=10,          # sottopassi per fotogramma
    mass=0.30,           # massa per vertice
    air=3.0,             # smorzamento dell'aria (assestamento)
    tension=40.0,        # rigidezza a trazione/compressione del tessuto
    shear=12.0,          # rigidezza a taglio (lo sbieco)
    bending=1.0,         # rigidezza a flessione: piu' alta = pieghe piu' larghe e meno numerose (a 250 gsm; scalata con la grammatura in products.py)
    collar_tension=8.0,  # la costina e' elastica: rigidezza a TRAZIONE molto piu' bassa del tessuto (a compressione resta quella piena: non si arriccia)
    bend_max=40.0,       # flessione del colletto (strato doppio a costina)
    hem_bend=0.0,        # risvolto dell'orlo: frazione di bend_max in piu' rispetto al tessuto (0 = morbido come il tessuto)
    cuff_bend=0.6,       # risvolto dei polsini: idem. Resta rigido: a 0 il polsino si accartoccia sul braccio (manica "arrotolata")
    friction=18.0,       # attrito sul corpo
    dist=0.003,          # distanza di collisione tessuto-corpo (m)
    thick=0.002,         # spessore esterno del corpo come ostacolo (m): dist + thick = distanza a cui il tessuto galleggia sulla pelle
    smooth=2,            # passate di levigatura (Taubin, non restringe) prima di riportare le lunghezze al cartamodello
    selfdist=0.003,      # distanza di auto-collisione (m)
    gap=0.004,           # distanza minima dal corpo garantita in rifinitura (m)
)
FRAMES = dict(dress=50, lower=50, settle=70, hold=30, close=15)   # hold: sosta a braccia aperte di OPEN_DEG prima di chiuderle
OPEN_DEG = 14.0          # durante la sosta le braccia stanno a questi gradi dalla posa naturale: il capo scende senza restare pizzicato sotto l'ascella


# ── cartamodello -> mesh 2D ───────────────────────────────────────────────────
def _inside(poly, pts):
    """Even-odd: quali punti stanno dentro il poligono (vettorizzato)."""
    x, y = pts[:, 0], pts[:, 1]
    res = np.zeros(len(pts), bool)
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        cond = (y1 > y) != (y2 > y)
        with np.errstate(divide='ignore', invalid='ignore'):
            xi = (x2 - x1) * (y - y1) / (y2 - y1) + x1
        res ^= cond & (x < xi)
    return res


def _dense(chain, step):
    out = []
    for a, b in zip(chain[:-1], chain[1:]):
        a, b = np.array(a), np.array(b)
        m = max(1, int(np.linalg.norm(b - a) / step))
        for t in np.linspace(0, 1, m, endpoint=False):
            out.append(a + (b - a) * t)
    out.append(np.array(chain[-1]))
    return out


def mesh_piece(piece, spacing, sym):
    """Triangola un pezzo. sym = indice della coordinata rispetto a cui il pezzo e' simmetrico (0: x, 1: v).
    Ritorna dict(pts Nx2 cm, tris Mx3, chains nome -> indici ordinati)."""
    pts, key, chains, edges, loop = [], {}, {}, set(), []

    def vid(p):
        k = (round(p[0], 4), round(p[1], 4))
        if k not in key:
            key[k] = len(pts)
            pts.append((float(p[0]), float(p[1])))
        return key[k]

    for group, closed in ((piece['outline'], True), (piece['inner'], False)):
        for name, c in group:
            ids = [vid(p) for p in c]
            chains[name] = ids
            edges.update((a, b) for a, b in zip(ids[:-1], ids[1:]) if a != b)
            if closed:
                loop.extend(c[:-1])
    poly = np.array(loop)
    # punti interni: reticolo esagonale simmetrico rispetto alla coordinata `sym`, lontano da contorno e catene interne
    a, b = sym, 1 - sym
    lo, hi = poly.min(0), poly.max(0)
    dy = spacing * math.sqrt(3) / 2
    g = []
    for j in range(int(math.floor(lo[b] / dy)) - 1, int(math.ceil(hi[b] / dy)) + 2):
        off = spacing / 2 if j % 2 else 0.0
        for k in range(int(math.floor(lo[a] / spacing)) - 2, int(math.ceil(hi[a] / spacing)) + 2):
            q = [0.0, 0.0]
            q[a], q[b] = k * spacing + off, j * dy
            g.append(q)
    g = np.array(g)
    g = g[_inside(poly, g)]
    dens = np.array([q for _, c in piece['outline'] + piece['inner'] for q in _dense(c, spacing / 4)])
    keep = np.ones(len(g), bool)
    for k in range(0, len(g), 512):
        keep[k:k + 512] = np.linalg.norm(g[k:k + 512, None, :] - dens[None, :, :], axis=2).min(1) > spacing * 0.72
    allp = np.vstack([np.array(pts), g[keep]])
    vo, _, fo, ov, _, _ = geometry.delaunay_2d_cdt([Vector((float(p[0]), float(p[1]))) for p in allp], [tuple(e) for e in edges], [], 0, 1e-5)
    out = np.array([(v.x, v.y) for v in vo])
    inmap = {}
    for oi, srcs in enumerate(ov):
        for s in srcs:
            inmap[s] = oi
    tris = np.array([f for f in fo if len(f) == 3])
    tris = tris[_inside(poly, out[tris].mean(1))]
    return dict(pts=out, tris=tris, chains={n: [inmap[i] for i in ids] for n, ids in chains.items()})


def in_poly(poly, pts, tol=0.0):
    """Punti dentro il poligono o a meno di `tol` dal suo bordo."""
    res = _inside(poly, pts)
    if tol > 0:
        a, b = poly, np.roll(poly, -1, 0)
        ab = b - a
        l2 = np.maximum((ab ** 2).sum(1), 1e-12)
        for k in range(0, len(pts), 2048):
            q = pts[k:k + 2048]
            t = np.clip(((q[:, None, :] - a[None]) * ab[None]).sum(2) / l2[None], 0, 1)
            dd = np.linalg.norm(q[:, None, :] - (a[None] + t[..., None] * ab[None]), axis=2).min(1)
            res[k:k + 2048] |= dd < tol
    return res


class Garment:
    """Tutti i pezzi in un'unica numerazione, con cuciture, zone e coordinate del cartamodello."""

    def __init__(self, size, spacing):
        self.size, self.spacing = size, spacing
        pat = P.pieces(size, spacing)
        self.meas, self.kp = pat['meas'], pat['points']
        self.frame = pat['pieces']['sleeve']['frame']               # (S, e, eperp)
        meshes = {'front': mesh_piece(pat['pieces']['front'], spacing, 0), 'back': mesh_piece(pat['pieces']['back'], spacing, 0)}
        meshes['sleeve_L'] = mesh_piece(pat['pieces']['sleeve'], spacing, 1)
        meshes['sleeve_R'] = meshes['sleeve_L']
        self.off, P2, piece, tris, tpiece = {}, [], [], [], []
        n = 0
        for pi, name in enumerate(PIECES):
            mp = meshes[name]
            self.off[name] = n
            P2.append(mp['pts'])
            piece += [pi] * len(mp['pts'])
            tris.append(mp['tris'] + n)
            tpiece += [pi] * len(mp['tris'])
            n += len(mp['pts'])
        self.P2, self.piece = np.vstack(P2), np.array(piece)
        self.tris, self.tpiece = np.vstack(tris), np.array(tpiece)
        self.n = n
        self.chains = {(name, cn): [i + self.off[name] for i in ids] for name in PIECES for cn, ids in meshes[name]['chains'].items()}
        self.pairs = []
        for (pa, ca, da), (pb, cb, db) in P.seams():
            A, B = self.chains[(pa, ca)][::da], self.chains[(pb, cb)][::db]
            if len(A) != len(B):
                raise RuntimeError(f'Cucitura {pa}.{ca} / {pb}.{cb}: {len(A)} vs {len(B)} vertici')
            self.pairs += list(zip(A, B))
        # zone (per vertice originale)
        m, kp = self.meas, self.kp
        x, y = self.P2[:, 0], self.P2[:, 1]
        body = self.piece < 2
        back = self.piece == 1
        # colletto: i vertici dentro (o sul bordo de) la fascia tra apertura dello scollo e cucitura, pezzo per pezzo
        self.collar_poly = {name: (np.array(pat['pieces'][name.split('_')[0]]['collar_poly']) if pat['pieces'][name.split('_')[0]].get('collar_poly') else None) for name in PIECES}
        self.collar = np.zeros(n, bool)
        for pi, name in enumerate(PIECES):
            if self.collar_poly[name] is not None:
                sel = np.nonzero(self.piece == pi)[0]
                self.collar[sel] = in_poly(self.collar_poly[name], self.P2[sel], 2e-3)
        self.stitch_y = kp['H'][1] - m['hem_fold']
        self.hem = body & (y >= self.stitch_y - 1e-6)
        S, e, ep = self.frame
        self.u_t = (kp['T'][0] - S[0]) * e[0] + (kp['T'][1] - S[1]) * e[1]
        self.cuff = (~body) & (x >= self.u_t - m['hem_fold'] - 1e-6)                   # per le maniche P2 = (u, v)
        # peso "manica" per il runtime: 0 sulla cucitura del giromanica, 1 a 6 cm dentro la manica
        cap = np.array(self.P2[self.chains[('sleeve_L', 'cap_F')]].tolist() + self.P2[self.chains[('sleeve_L', 'cap_B')]].tolist())
        d = np.full(n, 0.0)
        sl = np.nonzero(~body)[0]
        dd = np.linalg.norm(self.P2[sl][:, None, :] - cap[None, :, :], axis=2).min(1)
        t = np.clip(dd / 6.0, 0, 1)
        d[sl] = t * t * (3 - 2 * t)
        u_sh = pat['pieces']['sleeve'].get('sleeve_from_u')              # raglan: sopra la spalla la manica e' tessuto che poggia sul busto
        if u_sh is not None:
            tt = np.clip((x - (u_sh - 3.0)) / 8.0, 0, 1)
            d = d * tt * tt * (3 - 2 * tt)
        self.sleeve_w = d * np.where(self.piece == 2, 1.0, -1.0) * (~body)
        # saldatura: union-find sulle coppie cucite
        parent = np.arange(n)

        def find(i):
            while parent[i] != i:
                parent[i] = parent[parent[i]]
                i = parent[i]
            return i

        for i, j in self.pairs:
            a, b = find(i), find(j)
            if a != b:
                parent[max(a, b)] = min(a, b)
        root = np.array([find(i) for i in range(n)])
        uniq, self.weld = np.unique(root, return_inverse=True)
        self.nw = len(uniq)
        self.seam_vert = np.zeros(self.nw, bool)
        for i, j in self.pairs:
            self.seam_vert[self.weld[i]] = True
        # specchio sinistra/destra (vertici originali): davanti/dietro x -> -x, manica sinistra <-> destra
        from mathutils.kdtree import KDTree
        mirror = np.arange(n)
        for name in ('front', 'back'):
            o, k = self.off[name], int((self.piece == PIECES.index(name)).sum())
            kd = KDTree(k)
            for i in range(k):
                kd.insert((self.P2[o + i, 0], self.P2[o + i, 1], 0), i)
            kd.balance()
            for i in range(k):
                co, j, dist = kd.find((-self.P2[o + i, 0], self.P2[o + i, 1], 0))
                mirror[o + i] = o + j if dist < 0.05 else -1
        ns = self.off['sleeve_R'] - self.off['sleeve_L']
        mirror[self.off['sleeve_L']:self.off['sleeve_L'] + ns] = np.arange(ns) + self.off['sleeve_R']
        mirror[self.off['sleeve_R']:] = np.arange(ns) + self.off['sleeve_L']
        self.mirror = mirror
        self.unpaired = int((mirror < 0).sum())
        wm = np.full(self.nw, -1)
        ok = mirror >= 0
        wm[self.weld[ok]] = self.weld[mirror[ok]]
        self.wmirror = wm
        side = np.where(self.piece == 2, 1, np.where(self.piece == 3, -1, np.sign(np.round(self.P2[:, 0], 4)))).astype(int)
        self.wside = np.zeros(self.nw, int)                    # +1 = meta' sinistra di chi indossa (x > 0), -1 = destra, 0 = linea di centro
        self.wside[self.weld] = side
        # lati e lunghezze a riposo (cartamodello) sulla numerazione saldata
        E = {}
        for (a, b, c) in self.tris:
            for i, j in ((a, b), (b, c), (c, a)):
                L = float(np.linalg.norm(self.P2[i] - self.P2[j])) * CM
                k = (min(self.weld[i], self.weld[j]), max(self.weld[i], self.weld[j]))
                E.setdefault(k, []).append((L, bool(self.collar[i] and self.collar[j])))
        self.E = np.array(list(E.keys()))
        self.L = np.array([np.mean([v[0] for v in vs]) for vs in E.values()])
        self.elastic = np.array([all(v[1] for v in vs) for vs in E.values()])
        self.wtris = self.weld[self.tris]

    # ── posizione iniziale ───────────────────────────────────────────────────
    def photo_point(self, i):
        """Punto nel riferimento della foto (cm) del vertice originale i (per le maniche: meta' visibile, |v|)."""
        if self.piece[i] < 2:
            return self.P2[i]
        S, e, ep = self.frame
        u, v = self.P2[i]
        return np.array([S[0] + u * e[0] + abs(v) * ep[0], S[1] + u * e[1] + abs(v) * ep[1]])

    def initial(self, co):
        """Posizioni 3D (m) per la vestizione: `co` = vertici del corpo nella posa a braccia alzate all'angolo della manica."""
        m, kp = self.meas, self.kp
        S, e, ep = self.frame
        al = kp['alpha']
        xs = np.arange(0.11, kp['T'][0] * CM + 0.02, 0.01)
        top = []
        for xv in xs:
            sel = np.abs(co[:, 0] - xv) < 0.012
            ytop = m['neck_seam_y'] + m['shoulder_slope'] * (xv / CM - m['neck_seam_a']) if xv <= kp['S'][0] * CM else kp['S'][1] + (xv / CM - kp['S'][0]) * math.tan(al)
            if xv < m['neck_seam_a'] * CM:
                continue
            top.append(co[sel, 2].max() + 0.025 + ytop * CM)
        z0 = max(top)
        hem_z = z0 - kp['H'][1] * CM
        torso = (np.abs(co[:, 0]) < 0.20) & (co[:, 2] > hem_z) & (co[:, 2] < z0 - 0.02)
        yf, yb = co[torso, 1].min() - 0.035, co[torso, 1].max() + 0.035
        arm = (co[:, 0] > max(kp['S'][0] * CM + 0.03, 0.30)) & (co[:, 0] < kp['T'][0] * CM + 0.03)
        arm_y = co[arm, 1].mean()
        rho = np.abs(co[arm, 1] - arm_y).max() + 0.035
        pos = np.zeros((self.n, 3))
        x, y = self.P2[:, 0], self.P2[:, 1]
        for pi, yy in ((0, yf), (1, yb)):
            s = self.piece == pi
            pos[s] = np.stack([x[s] * CM, np.full(s.sum(), yy), z0 - y[s] * CM], 1)
        epw = np.array([-math.sin(al), 0.0, -math.cos(al)])
        for pi, sgn in ((2, 1.0), (3, -1.0)):
            s = np.nonzero(self.piece == pi)[0]
            u, v = x[s], y[s] * CM
            av = np.abs(v)
            fx, fz = (S[0] + u * e[0]) * CM, z0 - (S[1] + u * e[1]) * CM
            # sopra il busto (raglan: la manica parte dal collo) la U e' larga quanto il busto e centrata su di esso; sul braccio e' quella del braccio
            tb = np.clip((fx - 0.15) / 0.10, 0, 1)
            tb = tb * tb * (3 - 2 * tb)
            rr = (1 - tb) * (yb - yf) / 2 + tb * rho
            cy = (1 - tb) * (yf + yb) / 2 + tb * arm_y
            arc = av <= math.pi * rr / 2
            drop = np.where(arc, rr * (1 - np.cos(av / rr)), rr + av - math.pi * rr / 2)
            side = np.where(arc, rr * np.sin(av / rr), rr)
            q = np.stack([fx, cy, fz], 1) + drop[:, None] * epw + np.stack([np.zeros(len(s)), -np.sign(v) * side, np.zeros(len(s))], 1)
            q[:, 0] *= sgn
            pos[s] = q
        self.z0, self.yf, self.yb, self.arm_y, self.rho = z0, yf, yb, arm_y, rho
        # verso delle facce: normali verso l'esterno (lontano dall'asse del busto / del braccio)
        tri = self.tris.copy()
        c = pos[tri].mean(1)
        nrm = np.cross(pos[tri[:, 1]] - pos[tri[:, 0]], pos[tri[:, 2]] - pos[tri[:, 0]])
        ref = c - np.stack([np.zeros(len(c)), np.full(len(c), (yf + yb) / 2), c[:, 2]], 1)
        slv = self.tpiece >= 2
        up = np.array([math.sin(al), 0.0, math.cos(al)])                                # perpendicolare alla piega, verso l'alto
        sg = np.where(self.tpiece == 3, -1.0, 1.0)
        axis_pt = np.stack([c[:, 0], np.full(len(c), arm_y), c[:, 2]], 1) - rho * up * np.stack([sg, sg * 0 + 1, sg * 0 + 1], 1)
        ref[slv] = (c - axis_pt)[slv]
        flip = (nrm * ref).sum(1) < 0
        tri[flip] = tri[flip][:, ::-1]
        self.tris = tri
        self.wtris = self.weld[self.tris]
        return pos

    # ── UV e materiali ───────────────────────────────────────────────────────
    def _polyline_nearest(self, pts, q):
        """Punto piu' vicino a q sulla polilinea pts: (punto, distanza, frazione d'arco 0..1)."""
        seg = pts[1:] - pts[:-1]
        sl = np.maximum((seg ** 2).sum(1), 1e-12)
        t = np.clip(((q - pts[:-1]) * seg).sum(1) / sl, 0, 1)
        near = pts[:-1] + seg * t[:, None]
        d2 = ((q - near) ** 2).sum(1)
        j = int(d2.argmin())
        ln = np.sqrt(sl)
        return near[j], math.sqrt(d2[j]), float((ln[:j].sum() + t[j] * ln[j]) / ln.sum())

    def _polyline_at(self, pts, s):
        ln = np.linalg.norm(pts[1:] - pts[:-1], axis=1)
        c = np.concatenate([[0.0], np.cumsum(ln)])
        x = s * c[-1]
        j = int(min(np.searchsorted(c, x, side='right') - 1, len(ln) - 1))
        return pts[j] + (pts[j + 1] - pts[j]) * ((x - c[j]) / max(ln[j], 1e-12))

    def collar_photo_point(self, name, q, dist=None):
        """Punto della foto (cm) da cui prende il colore un punto `q` della costina del pezzo `name` (coordinate del pezzo).

        La costina e' una fascia uniforme: si campiona la sua parte centrale (dal 20% al 75% della larghezza, contando dalla cucitura), cosi'
        ne' il bordo interno (oltre il quale la foto mostra l'INTERNO del retro attraverso lo scollo: un trapezio scuro che sul capo
        sembrava uno scollo a V) ne' la cucitura sporcano il colore. La costina DIETRO non e' fotografata: riusa quella del davanti alla
        stessa posizione lungo lo scollo (ASSUNTO: costina uguale davanti e dietro)."""
        rib = self.meas['rib']
        seam = self.P2[self.chains[(name, 'neck_seam')]]
        Pn, d_seam, s = self._polyline_nearest(seam, q)
        dist = d_seam if dist is None else dist              # `dist` esplicita: q e' un punto della cucitura, la distanza la decide chi chiama
        src = name
        if name == 'back':
            src = 'front'
            seam = self.P2[self.chains[('front', 'neck_seam')]]
            Pn = self._polyline_at(seam, s)
        inner_names = [cn for (nm, cn) in self.chains if nm == src and (cn == 'neck' or cn.startswith('neck_')) and cn != 'neck_seam']
        best = None
        for cn in inner_names:
            In, dd, _ = self._polyline_nearest(self.P2[self.chains[(src, cn)]], Pn)
            if best is None or dd < best[1]:
                best = (In, dd)
        nrm = (best[0] - Pn) / max(best[1], 1e-9)
        out = Pn + nrm * (0.20 * rib + 0.55 * min(dist, rib))
        if src in ('front', 'back'):
            return out
        S, e, ep = self.frame
        return np.array([S[0] + out[0] * e[0] + abs(out[1]) * ep[0], S[1] + out[0] * e[1] + abs(out[1]) * ep[1]])

    def sample_point(self, i, margin=2.5):
        """Punto della foto (cm) da cui prende il colore il vertice i. Di norma e' la sua posizione nella foto (photo_point).

        RAGLAN: manica e busto hanno colori diversi e il confine nella foto non coincide al millimetro con la cucitura del cartamodello;
        la meta' DIETRO della manica, poi, riusa la foto del davanti ma la sua cucitura parte piu' in alto. Vicino alle cuciture la manica
        prendeva cosi' il colore del busto (bordo a denti, toppe chiare dietro). Qui la manica campiona sempre dalla propria parte: mai
        oltre la cucitura raglan DAVANTI meno `margin` cm. Il busto resta com'e' nella foto. Il margine e' largo perche' la foto non e'
        simmetrica: a destra, vicino al colletto, il confine tra i colori sta ~2 cm oltre la cucitura del cartamodello (misurato)."""
        if P.STYLE != 'raglan':
            return self.photo_point(i)
        if self.piece[i] >= 2:
            if not hasattr(self, '_cap_uv'):
                cap = self.P2[self.chains[('sleeve_L', 'cap_F')]]
                o = np.argsort(cap[:, 0])
                self._cap_uv = (cap[o, 0], np.abs(cap[o, 1]))
            u, v = self.P2[i]
            if u <= self._cap_uv[0][-1]:                              # oltre l'ascella non c'e' cucitura raglan
                v = min(abs(v), max(float(np.interp(u, *self._cap_uv)) - margin, 0.0))
            S, e, ep = self.frame
            return np.array([S[0] + u * e[0] + abs(v) * ep[0], S[1] + u * e[1] + abs(v) * ep[1]])
        return self.photo_point(i)                                    # busto: la foto com'e' (spostarne il campionamento rende il confine a denti)

    def loop_uv(self):
        """UV per angolo di triangolo (Mx3x2) e materiale (0 = foto del davanti, 1 = retro segnaposto)."""
        uv = np.zeros((len(self.tris), 3, 2))
        mat = np.zeros(len(self.tris), int)
        cen = self.P2[self.tris].mean(1)
        for t, tri in enumerate(self.tris):
            pi = self.tpiece[t]
            name = PIECES[pi]
            # dietro = segnaposto, tranne maniche e colletto: per quelli vale la foto del davanti (manica dietro ~ manica davanti),
            # cosi' colori come maniche e collo a contrasto restano giusti
            in_collar = self.collar_poly[name] is not None and in_poly(self.collar_poly[name], cen[t][None], 0.0)[0]
            back = pi == 1 and not in_collar
            mat[t] = 1 if back else 0
            for k, i in enumerate(tri):
                q = self.collar_photo_point(name, self.P2[i]) if in_collar else self.sample_point(i)
                uv[t, k] = P.photo_uv(q[0], q[1], self.meas, back)
        return uv, mat


# ── oggetti Blender ───────────────────────────────────────────────────────────
def make_materials(textures):
    mats = []
    for tex in ('front', 'back'):
        mat = bpy.data.materials.new(f'tee_{tex}')
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes['Principled BSDF']
        img = bpy.data.images.load(os.path.join(textures, f'{tex}.png'))
        n = mat.node_tree.nodes.new('ShaderNodeTexImage')
        n.image = img
        mat.node_tree.links.new(n.outputs['Color'], bsdf.inputs['Base Color'])
        bsdf.inputs['Roughness'].default_value = 0.92
        mat.use_backface_culling = False
        mats.append(mat)
    return mats


def make_object(name, verts, faces, edges=(), uv=None, mat=None, mats=()):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [tuple(e) for e in edges], [tuple(int(i) for i in f) for f in faces])
    me.update()
    if uv is not None:
        layer = me.uv_layers.new(name='UVMap')
        layer.data.foreach_set('uv', np.asarray(uv, np.float32).reshape(-1))
    for m in mats:
        me.materials.append(m)
    if mat is not None:
        me.polygons.foreach_set('material_index', np.asarray(mat, np.int32))
    me.polygons.foreach_set('use_smooth', [True] * len(me.polygons))
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def add_groups(ob, stiff, bend):
    for name, w in (('stiff', stiff), ('bend', bend)):
        vg = ob.vertex_groups.new(name=name)
        for i in np.nonzero(w > 0.005)[0]:
            vg.add([int(i)], float(w[i]), 'REPLACE')


def setup_cloth(ob, q, sewing):
    md = ob.modifiers.new('Cloth', 'CLOTH')
    cs, cc = md.settings, md.collision_settings
    cs.quality = int(q['quality'])
    cs.mass = q['mass']
    cs.air_damping = q['air']
    cs.tension_stiffness = q['collar_tension']                                    # peso 0 del gruppo `stiff` = costina (elastica solo a trazione)
    cs.tension_stiffness_max = cs.compression_stiffness = cs.compression_stiffness_max = q['tension']        # peso 1 = tessuto
    cs.vertex_group_structural_stiffness = 'stiff'
    cs.shear_stiffness = q['shear']
    cs.bending_stiffness = q['bending']
    cs.bending_stiffness_max = q['bend_max']
    cs.vertex_group_bending = 'bend'
    cs.tension_damping = cs.compression_damping = cs.shear_damping = 5
    cs.bending_damping = 0.5
    if sewing:
        cs.use_sewing_springs = True
        cs.sewing_force_max = 0
        cs.rest_shape_key = ob.data.shape_keys.key_blocks['Rest']
    cc.use_collision = True
    cc.distance_min = q['dist']
    cc.collision_quality = 6
    cc.impulse_clamp = 0
    cc.use_self_collision = True
    cc.self_distance_min = q['selfdist']
    cc.self_friction = 8
    return md


def setup_body_collision(q):
    body, _ = C.body_objects()
    if 'Collision' not in body.modifiers:
        md = body.modifiers.new('Collision', 'COLLISION')
        md.settings.thickness_outer = q['thick']
        md.settings.cloth_friction = q['friction']
        md.settings.use_culling = False


def read_positions(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = ev.to_mesh()
    co = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', co)
    ev.to_mesh_clear()
    return co.reshape(-1, 3).copy()


# ── rifinitura numerica ───────────────────────────────────────────────────────
def body_tree():
    bco, btr = C.evaluated_body()
    return BVHTree.FromPolygons([tuple(v) for v in bco], [tuple(t) for t in btr])


def push_out(pos, tree, gap):
    """Porta a distanza >= gap dal corpo i vertici piu' vicini o interni. Ritorna (posizioni, quanti spostati)."""
    p = pos.copy()
    moved = 0
    for i in range(len(p)):
        v = Vector(p[i])
        loc, nrm, _, dist = tree.find_nearest(v)
        if loc is None:
            continue
        if (v - loc).dot(nrm) < gap:
            p[i] = np.array(loc + nrm * gap)
            moved += 1
    return p, moved


def strain(pos, E, L):
    return np.linalg.norm(pos[E[:, 1]] - pos[E[:, 0]], axis=1) / L - 1.0


def edge_batches(E, n):
    """Colorazione golosa dei lati: in ogni gruppo nessun vertice compare due volte (aggiornamenti indipendenti, tipo Gauss-Seidel)."""
    used = [set() for _ in range(n)]
    color = np.zeros(len(E), int)
    for k, (i, j) in enumerate(E):
        c = 0
        while c in used[i] or c in used[j]:
            c += 1
        color[k] = c
        used[i].add(c)
        used[j].add(c)
    return [np.nonzero(color == c)[0] for c in range(color.max() + 1)]


def layered_vertices(pos, E, radius=0.007):
    """Vertici in una zona a strati sovrapposti (es. manica schiacciata tra braccio e busto): hanno entro `radius` un vertice che non e'
    loro vicino sulla mesh (fino al terzo anello). Li' la sim ha gia' risolto l'auto-collisione: la rifinitura non li sposta."""
    from mathutils.kdtree import KDTree
    n = len(pos)
    nb = [set() for _ in range(n)]
    for i, j in E:
        nb[i].add(int(j))
        nb[j].add(int(i))
    kd = KDTree(n)
    for i, q in enumerate(pos):
        kd.insert(q, i)
    kd.balance()
    out = np.zeros(n, bool)
    for i in range(n):
        ring = {i} | nb[i]
        for _ in range(2):
            ring = ring | {k for j in ring for k in nb[j]}
        out[i] = any(j not in ring for _, j, _ in kd.find_range(pos[i], radius))
    return out


def strain_limit(pos, E, L, iters=120, tree=None, gap=0.004, every=10, batches=None, fixed=None, sor=1.0, center=None):
    """Riporta le lunghezze dei lati a quelle del cartamodello (proiezioni tipo PBD, Gauss-Seidel a gruppi), con il corpo come vincolo.
    `fixed` = vertici che non si muovono (massa infinita); `center` = vertici della linea di centro, tenuti sul piano x = 0 (simmetria)."""
    p = pos.copy()
    batches = batches or edge_batches(E, len(p))
    w = np.ones(len(p)) if fixed is None else np.where(fixed, 0.0, 1.0)
    for it in range(iters):
        for bt in batches:
            i, j = E[bt, 0], E[bt, 1]
            d = p[j] - p[i]
            ln = np.maximum(np.linalg.norm(d, axis=1), 1e-9)
            ws = np.maximum(w[i] + w[j], 1e-9)
            corr = (sor * (ln - L[bt]) / ln / ws)[:, None] * d
            p[i] += corr * w[i][:, None]
            p[j] -= corr * w[j][:, None]
        if center is not None:
            p[center, 0] = 0.0
        if tree is not None and (it % every == every - 1 or it == iters - 1):
            p, _ = push_out(p, tree, gap)
    return p


def self_pairs(pos, tris):
    """Coppie di triangoli che si attraversano (senza vertici in comune, contando come comuni i vertici coincidenti)."""
    keyv = {}
    gid = np.array([keyv.setdefault(tuple(np.round(q * 2e4).astype(int)), len(keyv)) for q in pos])
    t = BVHTree.FromPolygons([tuple(v) for v in pos], [tuple(int(i) for i in f) for f in tris], epsilon=0.0)
    return [(a, b) for a, b in t.overlap(t) if a < b and not (set(gid[tris[a]]) & set(gid[tris[b]]))]


def resolve_self(pos, tris, E, rounds=12):
    """Scioglie le auto-intersezioni (pieghe schiacciate, es. sotto il braccio): levigatura locale dei vertici coinvolti e dei loro vicini."""
    p = pos.copy()
    n = len(p)
    deg = np.zeros(n)
    np.add.at(deg, E[:, 0], 1)
    np.add.at(deg, E[:, 1], 1)
    deg = np.maximum(deg, 1)[:, None]
    first = None
    for r in range(rounds):
        pairs = self_pairs(p, tris)
        first = len(pairs) if first is None else first
        if not pairs:
            break
        w = np.zeros(n)
        w[np.unique(tris[np.unique(np.array(pairs))])] = 1.0
        for _ in range(2 + r // 3):                              # la zona si allarga ai vicini (di piu' se l'intersezione resiste)
            acc = np.zeros(n)
            np.add.at(acc, E[:, 0], w[E[:, 1]])
            np.add.at(acc, E[:, 1], w[E[:, 0]])
            w = np.maximum(w, 0.6 * np.minimum(acc, 1.0))
        for _ in range(4):
            acc = np.zeros_like(p)
            np.add.at(acc, E[:, 0], p[E[:, 1]])
            np.add.at(acc, E[:, 1], p[E[:, 0]])
            p += 0.5 * w[:, None] * (acc / deg - p)
    return p, first, len(self_pairs(p, tris))


def taubin(pos, E, iters, tris):
    """Levigatura di Taubin (passa-basso senza restringimento) SOLO lungo la normale: i vertici non scivolano sulla superficie,
    quindi le lunghezze dei lati (il cartamodello) non vengono alterate dalla regolarizzazione della mesh."""
    p = pos.copy()
    deg = np.zeros(len(p))
    np.add.at(deg, E[:, 0], 1)
    np.add.at(deg, E[:, 1], 1)
    deg = np.maximum(deg, 1)[:, None]
    for _ in range(iters):
        for lam in (0.5, -0.53):
            n = vertex_normals(p, tris)
            acc = np.zeros_like(p)
            np.add.at(acc, E[:, 0], p[E[:, 1]])
            np.add.at(acc, E[:, 1], p[E[:, 0]])
            d = lam * (acc / deg - p)
            p += n * (d * n).sum(1, keepdims=True)
    return p


COLLAR_SEG = 4           # tratti del profilo della costina tra cucitura e bordo


def rebuild_collar(g, pos, tree, gap, harmonics=3, blend_cm=6.0, lay_deg=50.0, max_open=0.015, max_stretch=0.08, rest_deg=25.0):
    """Colletto a costina: girocollo CIRCOLARE e simmetrico, fascia ricostruita sopra la cucitura dello scollo, aderente al collo.

    La cloth sim tratta la costina come tessuto piatto e la arriccia; una costina vera e' elastica e resta liscia e regolare.
      1. la cucitura dello scollo (anello chiuso, risultato della sim) viene resa una curva regolare: restano solo le prime `harmonics`
         armoniche di Fourier dell'anello (ellisse in pianta + quota davanti/dietro): niente punta al centro davanti, niente ondulazioni;
      2. lo spostamento della cucitura e' distribuito sul tessuto vicino (entro `blend_cm` sul cartamodello), poi le lunghezze tornano al
         cartamodello nella rifinitura;
      3. ogni punto della fascia sta a distanza `t` dalla cucitura lungo un profilo a due tratti "verso il collo e in su": ciascun tratto e'
         inclinato del minimo che basta a non entrare nel corpo (la costina si appoggia al collo solo dove il collo c'e').
    La larghezza della fascia e' quella del cartamodello (rib); la sua lunghezza si adatta al collo (e' elastica).
    Ritorna (posizioni, inclinazione media in gradi, spostamento massimo della cucitura in mm, dict con l'allargamento dello scollo)."""
    p = pos.copy()
    seam_pieces = [nm for nm in PIECES if (nm, 'neck_seam') in g.chains]
    nxt = {}
    for nm in seam_pieces:                                            # anello chiuso della cucitura: si percorrono i lati delle catene saldate
        ch = g.weld[g.chains[(nm, 'neck_seam')]]
        for a_, b_ in zip(ch[:-1], ch[1:]):
            nxt.setdefault(int(a_), []).append(int(b_))
            nxt.setdefault(int(b_), []).append(int(a_))
    start = int(g.weld[g.chains[('front', 'neck_seam')][0]])
    loop, prev, cur = [start], -1, start
    while True:
        cand = [v for v in nxt[cur] if v != prev]
        if not cand or cand[0] == start:
            break
        prev, cur = cur, cand[0]
        loop.append(cur)
    loop = np.array(loop)
    C0 = p[loop].copy()
    C = None
    def lowpass(X, keep=None):                                        # passa-basso sull'anello: curva regolare e simmetrica
        F = np.fft.rfft(X, axis=0)
        F[(keep or harmonics) + 1:] = 0
        return np.fft.irfft(F, n=len(X), axis=0)

    def dist_to_body(q):
        loc, nrm, _, _ = tree.find_nearest(Vector(q))
        return (Vector(q) - loc).dot(nrm), loc, nrm

    def rest_on_body(q, keep=None):
        """Il punto scende (al massimo 1,5 cm) finche' torna alla distanza `keep` dal corpo (default: appoggiato, a `gap`); se e' dentro, esce."""
        q = np.array(q, float)
        lim = max(gap, keep if keep is not None else gap) + 0.0015
        for _ in range(15):
            d, loc, nrm = dist_to_body(q)
            if d <= lim:
                break
            q[2] -= 0.001
        d, loc, nrm = dist_to_body(q)
        if d < gap:
            q = np.array(loc + nrm * gap)
        return q

    def ring_len(X):
        return float(np.linalg.norm(X - np.roll(X, -1, 0), axis=0 if X.ndim == 1 else 1).sum())

    C = lowpass(C0)
    C = np.array([rest_on_body(c) if dist_to_body(c)[0] < gap else c for c in C])
    d0 = np.array([dist_to_body(c)[0] for c in C])
    rib = g.meas['rib'] * CM
    half = rib * 0.5
    # Collo piu' grosso dell'apertura: lo scollo (jersey, leggermente elastico) si allarga quanto basta perche' la costina resti inclinata
    # al massimo di `lay_deg` invece di salire dritta sul collo; l'allungamento della cucitura e' limitato a `max_stretch` ed e' riportato.
    ax0 = np.array([0.0, C[:, 1].mean()])
    er0 = C[:, :2] - ax0
    er0 /= np.linalg.norm(er0, axis=1, keepdims=True)
    bl = math.radians(lay_deg)

    def lies(q, e2):
        d = np.array([-e2[0] * math.cos(bl), -e2[1] * math.cos(bl), math.sin(bl)])
        return dist_to_body(q + d * half)[0] >= gap and dist_to_body(q + d * rib)[0] >= gap

    shift = np.zeros(len(loop))
    for i in range(len(loop)):
        for sh in np.arange(0.0, max_open + 1e-9, 0.0015):
            shift[i] = sh
            if lies(rest_on_body(C[i] + np.array([er0[i, 0], er0[i, 1], 0.0]) * sh, d0[i]), er0[i]):
                break
    for _ in range(6):
        shift = np.maximum(shift, 0.5 * shift + 0.25 * (np.roll(shift, 1) + np.roll(shift, -1)))
    len0 = sum(float(np.linalg.norm(np.diff(g.P2[g.chains[(nm, 'neck_seam')]], axis=0), axis=1).sum()) for nm in seam_pieces) * CM    # cucitura del cartamodello
    k_open = 1.0
    for _ in range(12):
        Cn = np.array([rest_on_body(C[i] + np.array([er0[i, 0], er0[i, 1], 0.0]) * shift[i] * k_open, d0[i]) for i in range(len(loop))])
        Cn = lowpass(Cn)
        Cn = np.array([rest_on_body(c) if dist_to_body(c)[0] < gap else c for c in Cn])
        stretch = ring_len(Cn) / len0 - 1.0
        if stretch <= max_stretch:
            break
        k_open *= 0.8
    C = Cn
    delta = C - C0
    p[loop] = C
    axis = np.array([0.0, C[:, 1].mean()])
    er = C[:, :2] - axis
    er /= np.linalg.norm(er, axis=1, keepdims=True)
    # PROFILO della fascia per ogni punto dell'anello: dalla cucitura verso il collo, in COLLAR_SEG tratti. Ogni tratto parte "verso il collo
    # e un po' in su" (rest_deg) e, se entrerebbe nel corpo, si appoggia alla pelle (a `gap`) seguendone la curva: la costina e' elastica e
    # sta stesa dove c'e' spazio, sale lungo il collo solo dove il collo c'e'. Niente tratti rigidi che si staccano ("orecchie" ai lati, con
    # l'interno del capo in vista) e nessun punto dentro il corpo.
    M = COLLAR_SEG
    seg_len = rib / M
    br = math.radians(rest_deg)
    prof = np.zeros((len(loop), M + 1, 3))
    for i in range(len(loop)):
        d0 = np.array([-er[i, 0] * math.cos(br), -er[i, 1] * math.cos(br), math.sin(br)])
        q0, d = C[i].copy(), d0
        prof[i, 0] = q0
        for k in range(1, M + 1):
            q = q0 + d * seg_len
            for _ in range(3):                                        # appoggio sulla pelle mantenendo la lunghezza del tratto
                dist, loc, nrm = dist_to_body(q)
                if dist >= gap:
                    break
                q = np.array(loc + nrm * gap)
                v_ = q - q0
                q = q0 + v_ / max(np.linalg.norm(v_), 1e-9) * seg_len
            dist, loc, nrm = dist_to_body(q)
            if dist < gap:
                q = np.array(loc + nrm * gap)
            d = (q - q0) / max(np.linalg.norm(q - q0), 1e-9)
            prof[i, k] = q
            q0 = q
    for k in range(1, M + 1):                                         # ogni fila della fascia e' una curva regolare attorno al collo
        row = lowpass(prof[:, k], harmonics + 3)
        prof[:, k] = np.array([rest_on_body(c, 1e9) if dist_to_body(c)[0] < gap else c for c in row])
    # simmetria esatta sinistra/destra del profilo (come il resto del capo: la rifinitura specchia la meta' sinistra sulla destra; un profilo
    # non perfettamente simmetrico lasciava lo strato a griglia della costina fuori registro con lo strato base, fino a intersecarlo)
    idx_of = {int(v_): k_ for k_, v_ in enumerate(loop)}
    mir = np.array([idx_of.get(int(g.wmirror[v_]), k_) if g.wmirror[v_] >= 0 else k_ for k_, v_ in enumerate(loop)])
    flipx_ = np.array([-1.0, 1.0, 1.0])
    left = np.array([g.wside[v_] > 0 for v_ in loop])
    centre = np.array([g.wside[v_] == 0 for v_ in loop])
    prof[~left & ~centre] = prof[mir[~left & ~centre]] * flipx_
    prof[centre, :, 0] = 0.0
    # normale della fascia (verso l'esterno, lontano dal corpo) e direzione "oltre il bordo", per lo spessore e il bordo arrotondato
    tan = np.roll(prof, -1, 0) - np.roll(prof, 1, 0)
    along = np.gradient(prof, axis=1)
    pn = np.cross(tan, along)
    pn /= np.maximum(np.linalg.norm(pn, axis=2, keepdims=True), 1e-12)
    for i in range(len(loop)):
        for k in range(M + 1):
            dist, loc, nrm = dist_to_body(prof[i, k])
            if pn[i, k] @ np.array(nrm) < 0:
                pn[i, k] = -pn[i, k]
    edge = prof[:, M] - prof[:, M - 1]
    edge /= np.maximum(np.linalg.norm(edge, axis=1, keepdims=True), 1e-12)
    span = prof[:, M] - prof[:, 0]
    beta = np.arctan2(span[:, 2], np.maximum(np.linalg.norm(span[:, :2], axis=1), 1e-9))

    def on_profile(a_, b_, f_, t_):
        """Punto, normale e direzione di bordo sulla fascia: tra i punti a_ e b_ dell'anello (frazione f_), a distanza t_ dalla cucitura."""
        x = min(max(t_ / seg_len, 0.0), M - 1e-9)
        k0 = int(x)
        u = x - k0
        P_ = (prof[a_, k0] * (1 - u) + prof[a_, k0 + 1] * u) * (1 - f_) + (prof[b_, k0] * (1 - u) + prof[b_, k0 + 1] * u) * f_
        N_ = (pn[a_, k0] * (1 - u) + pn[a_, k0 + 1] * u) * (1 - f_) + (pn[b_, k0] * (1 - u) + pn[b_, k0 + 1] * u) * f_
        E_ = edge[a_] * (1 - f_) + edge[b_] * f_
        return P_, N_ / max(np.linalg.norm(N_), 1e-12), E_ / max(np.linalg.norm(E_), 1e-12)

    g.collar_prof = dict(loop=loop.copy(), prof=prof.copy(), pn=pn.copy(), edge=edge.copy())      # per lo strato esterno a griglia (finish_layers)
    g.collar_n = np.zeros((len(p), 3))                                # per vertice saldato del colletto: normale e direzione di bordo
    g.collar_edge = np.zeros((len(p), 3))
    for k_, v_ in enumerate(loop):
        g.collar_n[v_], g.collar_edge[v_] = pn[k_, 0], edge[k_]
    where = {int(v): k for k, v in enumerate(loop)}
    acc, cnt = np.zeros_like(p), np.zeros(len(p))
    for name in seam_pieces:
        chain = g.chains[(name, 'neck_seam')]
        S2 = g.P2[chain]
        seg = S2[1:] - S2[:-1]
        sl = (seg ** 2).sum(1)
        pi = PIECES.index(name)
        for v in np.nonzero(g.piece == pi)[0]:
            w = g.weld[v]
            if int(w) in where:
                continue                                              # vertice sulla cucitura
            q = g.P2[v]
            t = np.clip(((q - S2[:-1]) * seg).sum(1) / sl, 0, 1)
            near = S2[:-1] + seg * t[:, None]
            d2 = ((q - near) ** 2).sum(1)
            j = int(d2.argmin())
            dist_cm = math.sqrt(d2[j])
            if not g.collar[v] and dist_cm >= blend_cm:
                continue
            a, b_ = where[int(g.weld[chain[j]])], where[int(g.weld[chain[j + 1]])]
            f = t[j]
            if not g.collar[v]:                                       # tessuto vicino alla cucitura: segue lo spostamento, sfumato
                k = 1.0 - dist_cm / blend_cm
                acc[w] += (delta[a] * (1 - f) + delta[b_] * f) * k * k * (3 - 2 * k)
                cnt[w] += 1
                continue
            p[w], g.collar_n[w], g.collar_edge[w] = on_profile(a, b_, f, dist_cm * CM)
    mv = cnt > 0
    p[mv] += acc[mv] / cnt[mv][:, None]
    return p, float(np.degrees(beta).mean()), float(np.linalg.norm(delta, axis=1).max() * 1000), dict(stretch=float(stretch), open_mm=float(shift.max() * k_open * 1000), seam_cm=float(ring_len(C) * 100))


def vertex_normals(pos, tris):
    fn = np.cross(pos[tris[:, 1]] - pos[tris[:, 0]], pos[tris[:, 2]] - pos[tris[:, 0]])
    vn = np.zeros_like(pos)
    for k in range(3):
        np.add.at(vn, tris[:, k], fn)
    return vn / np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-12)


COLLAR_SUB = 3           # colonne della griglia della costina per ogni lato della cucitura (passo ~3 mm)


def collar_grid(g, cp, thick):
    """Strato ESTERNO della costina come griglia regolare, costruita sul profilo di rebuild_collar (non sui triangoli del pezzo).

    I triangoli del pezzo nella fascia sono pochi e grossi (una fila): la texture a coste ci "nuotava" sopra a zig-zag e il bordo seguiva la
    triangolazione. Qui la costina ha COLLAR_SEG file per COLLAR_SUB colonne per lato di cucitura, UV calcolate angolo per angolo dalla
    posizione lungo lo scollo e attraverso la fascia, un gradino alla cucitura e il bordo arrotondato verso il collo.
    Ritorna (posizioni, triangoli, uv per angolo, src = vertice base della cucitura, ancora = punto dello strato base, colore)."""
    loop, prof, pn, edge = cp['loop'], cp['prof'], cp['pn'], cp['edge']
    n, M = len(loop), prof.shape[1] - 1
    # a quale pezzo appartiene ogni lato della cucitura (per le UV): (pezzo, vertice a, vertice b) del cartamodello
    seg_piece = {}
    for nm in PIECES:
        if (nm, 'neck_seam') not in g.chains:
            continue
        ch = g.chains[(nm, 'neck_seam')]
        for a_, b_ in zip(ch[:-1], ch[1:]):
            wa, wb = int(g.weld[a_]), int(g.weld[b_])
            if nm == 'sleeve_R' and (wa, wb) in seg_piece:
                continue
            seg_piece[(wa, wb)] = (nm, a_, b_)
            seg_piece[(wb, wa)] = (nm, b_, a_)
    # file della griglia: (frazione della larghezza per le UV, funzione posizione, funzione ancora)
    # guscio chiuso: cucitura -> faccia esterna (a `thick` dal profilo) -> bordo arrotondato -> faccia interna (sul profilo) -> cucitura.
    # I triangoli del pezzo nella fascia vengono tolti dal capo finale (finish_layers): tagliavano "in corda" il profilo curvo e sporgevano.
    # La faccia interna sta `lift` sopra il profilo: i suoi bordi non toccano i lati del tessuto accanto alla cucitura (triangoli complanari).
    lift = min(0.0006, thick * 0.15)
    rows = [(0.0, lambda j: prof[j, 0] + pn[j, 0] * lift, lambda j: prof[j, 0])]                 # gradino alla cucitura
    # lo spessore parte smussato alla cucitura (la costina e' presa dentro la cucitura: niente gradino verticale di 4 mm, che dove il
    # tessuto della spalla sale accanto alla cucitura lo attraversava) ed e' pieno dal secondo tratto in poi
    bevel = [0.35, 0.85] + [1.0] * (M - 1)
    for k in range(M + 1):
        rows.append((k / M, (lambda j, k=k: prof[j, k] + pn[j, k] * thick * bevel[k]), (lambda j, k=k: prof[j, k])))
    rows.append((1.0, lambda j: prof[j, M] + pn[j, M] * (thick + lift) * 0.5 + edge[j] * thick * 0.5, lambda j: prof[j, M]))   # bordo arrotondato
    for k in range(M, -1, -1):
        rows.append((k / M, (lambda j, k=k: prof[j, k] + pn[j, k] * lift), (lambda j, k=k: prof[j, k])))
    R, S = len(rows), COLLAR_SUB
    NC = n * S
    P_ = np.zeros((NC, R, 3))
    A_ = np.zeros((NC, R, 3))
    for j in range(n):
        j1 = (j + 1) % n
        for s_ in range(S):
            f = s_ / S
            for r, (_, fp, fa) in enumerate(rows):
                P_[j * S + s_, r] = fp(j) * (1 - f) + fp(j1) * f
                A_[j * S + s_, r] = fa(j) * (1 - f) + fa(j1) * f
    vid = lambda c, r: (c % NC) * R + r                                                           # noqa: E731
    # verso delle facce: normale verso l'esterno (come pn)
    c0 = n * S // 4
    nq = np.cross(P_[c0 + 1, 2] - P_[c0, 2], P_[c0, 3] - P_[c0, 2])
    flip = (nq @ pn[c0 // S, 1]) < 0
    tris, uvs = [], []
    for j in range(n):
        j1 = (j + 1) % n
        nm, va, vb = seg_piece[(int(loop[j]), int(loop[j1]))]
        for s_ in range(S):
            c = j * S + s_
            fa_, fb_ = s_ / S, (s_ + 1) / S

            def uv_at(f_ring, f_across):
                q = g.P2[va] * (1 - f_ring) + g.P2[vb] * f_ring
                ph = g.collar_photo_point(nm, q, dist=f_across * g.meas['rib'])
                return P.photo_uv(ph[0], ph[1], g.meas, False)

            for r in range(R - 1):
                f0, f1 = rows[r][0], rows[r + 1][0]
                quad = [(vid(c, r), uv_at(fa_, f0)), (vid(c + 1, r), uv_at(fb_, f0)), (vid(c + 1, r + 1), uv_at(fb_, f1)), (vid(c, r + 1), uv_at(fa_, f1))]
                for tri in ((0, 1, 2), (0, 2, 3)):
                    t3 = [quad[i] for i in (tri[::-1] if flip else tri)]
                    tris.append([q_[0] for q_ in t3])
                    uvs.append([q_[1] for q_ in t3])
    src = np.repeat(loop, S * R)
    col = np.ones(NC * R)
    col.reshape(NC, R)[:, :2] = 0.9                                                               # la cucitura si legge appena
    return P_.reshape(-1, 3), np.array(tris), np.array(uvs), src, A_.reshape(-1, 3), col


def finish_layers(g, pos, uv, mat):
    """Spessori: colletto a costina (strato esterno + bordo arrotondato + gradino alla cucitura), risvolti di orlo e polsini (strato interno).
    Ritorna dict(pos, tris, uv, mat, color, sleeve, layer) sul capo completo (strato base + strati aggiunti)."""
    m = g.meas
    tris = g.wtris
    n0 = len(pos)
    vn = vertex_normals(pos, tris)
    P_, T_, UV_, M_ = [pos], [tris], [uv], [mat]
    layer = [np.zeros(n0, int)]
    src = [np.arange(n0)]
    nxt = n0
    color = np.ones(n0)
    color[g.seam_vert] = 0.97
    for nm, cn in [(nm_, 'neck_seam') for nm_ in PIECES if (nm_, 'neck_seam') in g.chains]:
        color[g.weld[g.chains[(nm, cn)]]] = 0.88
    for key in (('front', 'hem_stitch'), ('back', 'hem_stitch'), ('sleeve_L', 'cuff_stitch'), ('sleeve_R', 'cuff_stitch')):
        if key not in g.chains:
            continue                                           # taglio vivo: nessuna ribattitura
        color[g.weld[g.chains[key]]] = 0.94
    # facce adiacenti per lato
    edge_faces = {}
    for t, (a, b, c) in enumerate(tris):
        for i, j in ((a, b), (b, c), (c, a)):
            edge_faces.setdefault((min(i, j), max(i, j)), []).append(t)
    cen2 = g.P2[g.tris].mean(1)

    def add_layer(fsel, offset, tag, reverse, lip, shade):
        nonlocal nxt
        ft = np.nonzero(fsel)[0]
        used = np.unique(tris[ft])
        new_id = np.full(n0, -1)
        new_id[used] = nxt + np.arange(len(used))
        # colletto: normale e direzione di bordo calcolate sulla fascia ricostruita (regolari lungo l'anello); altrove quelle della mesh
        ln = vn.copy()
        cn = getattr(g, 'collar_n', None)
        if tag == 1 and cn is not None:
            has = np.linalg.norm(cn, axis=1) > 0.5
            ln[has] = cn[has]
        newpos = pos[used] + ln[used] * offset
        P_.append(newpos)
        layer.append(np.full(len(used), tag))
        src.append(used)
        base = nxt
        nxt += len(used)
        nt = new_id[tris[ft]]
        UV_.append(uv[ft][:, ::-1] if reverse else uv[ft])
        T_.append(nt[:, ::-1] if reverse else nt)
        M_.append(mat[ft])
        col = np.full(len(used), shade)
        # pareti sui bordi dell'insieme di facce: bordo libero del capo -> labbro; bordo interno (cucitura/ribattitura) -> gradino
        inset = set(ft.tolist())
        vuv = {}
        for t in ft:
            for k in range(3):
                vuv[int(tris[t, k])] = (uv[t, k], mat[t])
        walls, wuv, wmat, mids = [], [], [], {}
        extra_pos, extra_src = [], []
        # direzione "oltre il bordo" per vertice del bordo libero: media sui lati di bordo che lo toccano (non dipende da come e' triangolato
        # il pezzo: prima il bordo arrotondato usciva a zig-zag)
        lipdir = {}
        if lip:
            for t in ft:
                a, b, c = (int(v) for v in tris[t])
                for i, j, o in ((a, b, c), (b, c, a), (c, a, b)):
                    if len(edge_faces[(min(i, j), max(i, j))]) != 1:
                        continue
                    e_ = pos[j] - pos[i]
                    e_ /= max(np.linalg.norm(e_), 1e-9)
                    d = (pos[i] + pos[j]) / 2 - pos[o]
                    d -= e_ * (d @ e_)
                    d /= max(np.linalg.norm(d), 1e-9)
                    for v in (i, j):
                        lipdir[v] = lipdir.get(v, 0.0) + d
        for t in ft:
            a, b, c = (int(v) for v in tris[t])
            for i, j, o in ((a, b, c), (b, c, a), (c, a, b)):
                fs = edge_faces[(min(i, j), max(i, j))]
                free = len(fs) == 1
                inner_border = (not free) and any(f not in inset for f in fs)
                if not (free or inner_border):
                    continue
                if inner_border and not lip:
                    continue                                   # risvolto: sul lato della ribattitura resta aperto (e' nascosto all'interno)
                i2, j2 = int(new_id[i]), int(new_id[j])
                quad_uv = (vuv[i][0], vuv[j][0])
                if free and lip:                               # bordo arrotondato: un anello a meta' spessore, spinto oltre il bordo
                    for v in (i, j):
                        if v not in mids:
                            ce = getattr(g, 'collar_edge', None)
                            d = ce[v].copy() if (tag == 1 and ce is not None and np.linalg.norm(ce[v]) > 0.5) else lipdir[v].copy()
                            d -= ln[v] * (d @ ln[v])
                            d /= max(np.linalg.norm(d), 1e-9)
                            mids[v] = nxt + len(extra_pos)
                            extra_pos.append(pos[v] + ln[v] * offset * 0.5 + d * abs(offset) * 0.5)
                            extra_src.append(v)
                    mi, mj = mids[i], mids[j]
                    quads = [(i, j, mj, mi), (mi, mj, j2, i2)]
                else:
                    quads = [(i, j, j2, i2)]
                for (q0, q1, q2, q3) in quads:
                    fl = reverse != free                       # il verso della parete segue lo strato che chiude
                    for tri3, u3 in (((q0, q1, q2), (quad_uv[0], quad_uv[1], quad_uv[1])), ((q0, q2, q3), (quad_uv[0], quad_uv[1], quad_uv[0]))):
                        walls.append(tri3[::-1] if fl else tri3)
                        wuv.append(u3[::-1] if fl else u3)
                        wmat.append(vuv[i][1])
        if extra_pos:
            P_.append(np.array(extra_pos))
            layer.append(np.full(len(extra_pos), tag))
            src.append(np.array(extra_src))
            col = np.concatenate([col, np.full(len(extra_pos), shade)])
            nxt += len(extra_pos)
        if walls:
            T_.append(np.array(walls))
            UV_.append(np.array(wuv))
            M_.append(np.array(wmat))
        return base, col

    t_collar, t_fold = m['collar_mm'] / 1000.0, (m['fabric_mm'] + 0.3) / 1000.0
    body_t = g.tpiece < 2
    collar_f = np.zeros(len(tris), bool)
    for pi, name in enumerate(PIECES):
        if g.collar_poly[name] is not None:
            sel = np.nonzero(g.tpiece == pi)[0]
            collar_f[sel] = in_poly(g.collar_poly[name], cen2[sel])
    collar_f |= g.collar[g.tris].all(1)                        # anche i triangoli con i tre vertici nella fascia (alle estremita' il centro puo' cadere sul bordo)
    hem_f = body_t & (cen2[:, 1] > g.stitch_y)
    cuff_f = (~body_t) & (cen2[:, 0] > g.u_t - m['hem_fold'])
    cols = [color]
    anchor = [pos.copy()]                                      # per ogni vertice: il punto dello strato base su cui poggia (per assottigliare)
    cp = getattr(g, 'collar_prof', None)
    if cp is None:
        _, c1 = add_layer(collar_f, t_collar, 1, False, True, 1.0)
        cols.append(c1)
    else:
        # la fascia del pezzo e' sostituita dal guscio a griglia; via anche i triangoli DEGENERI del cartamodello (tre vertici allineati sul
        # bordo, es. lungo la linea della spalla tra colletto e spalla: area nulla, nel capo finale erano lame che attraversavano la costina)
        q_ = g.P2[g.tris]
        area = np.abs((q_[:, 1, 0] - q_[:, 0, 0]) * (q_[:, 2, 1] - q_[:, 0, 1]) - (q_[:, 1, 1] - q_[:, 0, 1]) * (q_[:, 2, 0] - q_[:, 0, 0])) / 2
        keep = ~collar_f & (area > 1e-3)
        T_[0], UV_[0], M_[0] = tris[keep], uv[keep], mat[keep]
        gp, gt, guv, gsrc, ganc, gcol = collar_grid(g, cp, t_collar)
        P_.append(gp)
        T_.append(gt + nxt)
        UV_.append(guv)
        M_.append(np.zeros(len(gt), int))
        layer.append(np.full(len(gp), 1))
        src.append(gsrc)
        anchor.append(ganc)
        cols.append(gcol)
        nxt += len(gp)
    for fsel, tag in ((hem_f, 2), (cuff_f, 3)):
        if m['hem_fold'] <= 0 or not fsel.any():
            continue
        _, c2 = add_layer(fsel, -t_fold, tag, True, False, 0.9)
        cols.append(c2)
    src = np.concatenate(src)
    allpos = np.vstack(P_)
    anc = np.vstack(anchor)
    if len(anc) < len(allpos):                                 # risvolti: poggiano sul vertice base da cui derivano
        anc = np.vstack([anc, pos[src[len(anc):]]])
    return dict(pos=allpos, tris=np.vstack(T_), uv=np.vstack(UV_), mat=np.concatenate(M_), color=np.concatenate(cols),
                layer=np.concatenate(layer), src=src, n_base=n0, anchor=anc)


def export_glb(g, fin, mats, path):
    ob = make_object(OBJECT_NAME, fin['pos'], fin['tris'], uv=fin['uv'], mat=fin['mat'], mats=mats)
    me = ob.data
    wsl = np.zeros(g.nw)
    wsl[g.weld] = np.where(np.abs(g.sleeve_w) > 0, g.sleeve_w, 0)
    body_side = np.zeros(g.nw, bool)
    body_side[g.weld[g.piece < 2]] = True
    wsl[body_side] = 0.0                                       # i vertici di cucitura appartengono al busto
    a = me.attributes.new('_sleeve', 'FLOAT', 'POINT')
    a.data.foreach_set('value', wsl[fin['src']].astype(np.float32))
    a = me.attributes.new('_layer', 'FLOAT', 'POINT')
    a.data.foreach_set('value', fin['layer'].astype(np.float32))
    col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    c = np.repeat(fin['color'][:, None], 4, 1).astype(np.float32)
    c[:, 3] = 1.0
    col.data.foreach_set('color', c.reshape(-1))
    me.color_attributes.active_color = col
    me.color_attributes.render_color_index = 0
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_yup=True, use_selection=True, export_apply=False,
                              export_normals=True, export_texcoords=True, export_attributes=True, export_vertex_color='ACTIVE',
                              export_image_format='JPEG', export_jpeg_quality=90, export_materials='EXPORT', export_animations=False,
                              export_morph=False, export_skins=False)
    return ob


def main():
    args = C.script_args()

    def opt(k, d):
        return args[args.index(k) + 1] if k in args else d

    product = opt('--product', 'grillz-tee')
    P.use(product)
    spec = P._products.PRODUCTS[product]
    sub = [] if product == 'grillz-tee' else [product]
    size = opt('--size', 'S')
    out = os.path.abspath(opt('--out', os.path.join(C.ROOT, 'blender', 'out', 'garment', *sub)))
    glb = opt('--glb', os.path.join(C.ROOT, 'frontend', 'public', 'assets', 'garments', product, f'tee-{size}.glb'))
    res = float(opt('--res', '1.2'))
    os.makedirs(out, exist_ok=True)
    q = dict(FABRIC)
    q.update(P._products.fabric_overrides(product))           # massa e flessione dalla grammatura della scheda prodotto
    for kv in opt('--q', '').split(','):
        if '=' in kv:
            k, v = kv.split('=')
            q[k] = float(v)
    fr = dict(FRAMES)
    if '--frames' in args:
        fr['dress'], fr['lower'], fr['settle'] = (int(v) for v in opt('--frames', '').split(','))
    tex = os.path.join(C.ROOT, 'assets', 'products', spec.get('folder', product), 'textures')
    t0 = time.time()
    log = lambda *a: print('TEE', *a, 'time %.0fs' % (time.time() - t0), flush=True)       # noqa: E731

    g = Garment(size, res)
    body, _ = C.body_objects()
    body_keys = {kv.split('=')[0]: float(kv.split('=')[1]) for kv in opt('--keys', '').split(',') if '=' in kv}
    C.set_body_keys(body_keys)
    C.set_pose('raised', g.meas['sleeve_angle'])
    co, _ = C.evaluated_body()
    pos0 = g.initial(co)
    log('pezzi: vertici', g.n, '-> saldati', g.nw, 'triangoli', len(g.tris), 'coppie cucite', len(g.pairs), 'non specchiati', g.unpaired,
        'z0 %.3f yf %.3f yb %.3f rho %.3f' % (g.z0, g.yf, g.yb, g.rho))
    uv, mat = g.loop_uv()
    mats = make_materials(tex)
    hard = ~g.elastic
    sim_file = os.path.join(out, f'tee_{size}_sim.npz')
    if '--refinish' in args:                                   # solo rifinitura ed export, sulla sim gia' salvata (stessa mesh: e' deterministica)
        sim = np.load(sim_file)['sim']
        prev = json.load(open(os.path.splitext(glb)[0] + '.json')) if os.path.exists(os.path.splitext(glb)[0] + '.json') else {}
        sim_seconds = prev.get('sim_seconds', prev.get('bake_seconds', 0))
        C.set_pose('natural')
        ob2 = None
        log('rifinitura della sim salvata', sim_file)
    else:
        ob = make_object('tee_sew', pos0, g.tris, edges=g.pairs, uv=uv.reshape(-1, 2), mat=mat, mats=mats)
        ob.shape_key_add(name='Basis')
        rest = ob.shape_key_add(name='Rest')
        flat = np.zeros((g.n, 3))
        for i in range(g.n):                                       # ogni pezzo steso (isometrico): davanti/dietro sovrapposti, maniche come nella foto
            pt = g.photo_point(i) if g.piece[i] < 2 else g.P2[i]
            dy = (-0.0005, 0.0005, 0.3, 0.6)[g.piece[i]]
            flat[i] = (pt[0] * CM, dy, -pt[1] * CM)
        rest.data.foreach_set('co', flat.reshape(-1))
        stiff = np.where(g.collar, 0.0, 1.0)
        bend = np.where(g.collar, 1.0, np.where(g.cuff, q['cuff_bend'], np.where(g.hem, q['hem_bend'], 0.0)))
        add_groups(ob, stiff, bend)
        setup_body_collision(q)
        setup_cloth(ob, q, sewing=True)

        sc = bpy.context.scene
        f1 = fr['dress']
        fa = f1 + fr['lower']                                  # braccia quasi giu' (aperte di OPEN_DEG)
        fb = fa + fr['hold']
        f2 = fb + fr['close']                                  # posa naturale
        f3 = f2 + fr['settle']
        C.key_pose(1)
        C.key_pose(f1)
        C.set_pose('raised', C.ARM_DOWN - OPEN_DEG)
        C.key_pose(fa)
        C.key_pose(fb)
        C.set_pose('natural')
        C.key_pose(f2)
        sc.frame_start, sc.frame_end = 1, f3

        def run(ob_, a, b, tag):
            cache = ob_.modifiers['Cloth'].point_cache
            cache.frame_start, cache.frame_end = a, b
            for f in range(a, b + 1):
                sc.frame_set(f)
                if f % 10 == 0 or f == b:
                    p = read_positions(ob_)
                    log(tag, 'fotogramma', f, 'z %.3f..%.3f' % (p[:, 2].min(), p[:, 2].max()))

        run(ob, 1, f1, 'vestizione')
        dress = read_positions(ob)
        gaps = np.array([np.linalg.norm(dress[i] - dress[j]) for i, j in g.pairs])
        log('cuciture: distanza massima %.1f mm, media %.1f mm' % (gaps.max() * 1000, gaps.mean() * 1000))
        # saldatura (media dei vertici cuciti) + lunghezze = cartamodello
        w = np.zeros((g.nw, 3))
        cnt = np.zeros(g.nw)
        np.add.at(w, g.weld, dress)
        np.add.at(cnt, g.weld, 1)
        w /= cnt[:, None]
        tree = body_tree()
        st = strain(w, g.E[hard], g.L[hard])
        w = strain_limit(w, g.E[hard], g.L[hard], iters=80, tree=tree, gap=q['gap'])
        st2 = strain(w, g.E[hard], g.L[hard])
        log('saldato: deformazione dei lati prima %.2f%% (max %.1f%%), dopo %.2f%% (max %.1f%%)' % (np.abs(st).mean() * 100, np.abs(st).max() * 100, np.abs(st2).mean() * 100, np.abs(st2).max() * 100))
        ob.hide_viewport = ob.hide_render = True
        ob.modifiers.remove(ob.modifiers['Cloth'])
        ob2 = make_object('tee_w', w, g.wtris, uv=uv.reshape(-1, 2), mat=mat, mats=mats)
        ws = np.ones(g.nw)
        ws[g.weld[g.collar]] = 0.0
        ws[g.weld[~g.collar]] = 1.0
        wb = np.zeros(g.nw)
        wb[g.weld] = bend
        add_groups(ob2, ws, wb)
        setup_cloth(ob2, q, sewing=False)
        sc.frame_set(f1)
        run(ob2, f1, f3, 'discesa')
        sim = read_positions(ob2)
        np.savez(sim_file, dress=dress, welded=w, sim=sim)
        sim_seconds = round(time.time() - t0)

    # ── rifinitura ───────────────────────────────────────────────────────────
    tree = body_tree()                                         # corpo nella posa naturale
    flipx = np.array([-1.0, 1.0, 1.0])
    ok = g.wmirror >= 0
    asym = np.linalg.norm(sim[ok] - sim[g.wmirror[ok]] * flipx, axis=1)
    log('asimmetria della sim: media %.1f mm, max %.1f mm' % (asym.mean() * 1000, asym.max() * 1000))
    def mirror_half(p):
        """Simmetria esatta: la meta' destra diventa lo specchio della sinistra (le pieghe restano quelle vere della sim, non una media)."""
        o = p.copy()
        right = (g.wside < 0) & ok
        o[right] = p[g.wmirror[right]] * flipx
        o[g.wside == 0, 0] = 0.0
        return o

    sym = '--no-sym' not in args
    batches = edge_batches(g.E[hard], g.nw)
    center = np.nonzero(g.wside == 0)[0] if sym else None
    nx = lambda p_: len(self_pairs(p_, g.wtris))               # noqa: E731
    stages = [('sim', nx(sim))]
    fin = taubin(sim, g.E, int(q['smooth']), g.wtris)
    stages.append(('levigata', nx(fin)))
    if sym:
        fin = mirror_half(fin)
        stages.append(('specchiata', nx(fin)))
    fin, beta, seam_dev, neck = rebuild_collar(g, fin, tree, q['gap'])
    if nx(fin):                                                # la fascia ricostruita puo' toccare il tessuto accanto alla cucitura sulla spalla
        fin, _, _ = resolve_self(fin, g.wtris, g.E)
    stages.append(('colletto', nx(fin)))
    log('colletto ricostruito: inclinazione media della costina %.0f gradi, spostamento massimo della cucitura %.1f mm; scollo allargato di %.1f mm al massimo, cucitura %.1f cm (%+.1f%%)' % (beta, seam_dev, neck['open_mm'], neck['seam_cm'], neck['stretch'] * 100))
    st = strain(fin, g.E[hard], g.L[hard])
    # Lo strain limiting non conosce l'auto-collisione: dove la sim ha schiacciato il tessuto (pieghe strette tra braccio e busto) riallungare
    # i lati fa attraversare gli strati. Quei vertici (solo quelli: si trovano provando) restano come nella sim; il resto torna al cartamodello.
    pinned = np.zeros(g.nw, bool)
    start = fin
    for attempt in range(6):
        fin = strain_limit(start, g.E[hard], g.L[hard], iters=int(q.get('strain_iters', 300)) // (2 if attempt else 1), tree=tree, gap=q['gap'], every=3, batches=batches, fixed=pinned, sor=1.3, center=center)
        pairs = self_pairs(fin, g.wtris)
        stages.append(('lunghezze/%d' % attempt, len(pairs)))
        if not pairs:
            break
        bad = np.zeros(g.nw, bool)
        bad[np.unique(g.wtris[np.unique(np.array(pairs))])] = True
        for _ in range(1 + attempt // 2):                      # zona piccola; si allarga solo se l'intersezione resiste
            grow = bad.copy()
            grow[g.E[bad[g.E[:, 0]], 1]] = True
            grow[g.E[bad[g.E[:, 1]], 0]] = True
            bad = grow
        if sym:
            bad = bad | bad[np.where(ok, g.wmirror, np.arange(g.nw))]
        pinned |= bad
    log('auto-intersezioni per fase:', stages, '- vertici lasciati come nella sim: %d su %d' % (pinned.sum(), g.nw))
    for _ in range(3):                                         # simmetria esatta e distanza dal corpo insieme
        fin, _ = push_out(fin, tree, q['gap'])
        if sym:
            fin = mirror_half(fin)
    # tentativo: un ultimo giro di lunghezze su TUTTI i vertici (anche quelli lasciati come nella sim); vale solo se non crea intersezioni
    if pinned.any():
        trial = strain_limit(fin, g.E[hard], g.L[hard], iters=40, tree=tree, gap=q['gap'], every=3, batches=batches, center=center)
        if sym:
            trial = mirror_half(trial)
        if len(self_pairs(trial, g.wtris)) <= len(self_pairs(fin, g.wtris)):
            fin = trial
            log('ultimo giro di lunghezze su tutti i vertici: accettato')
    # per ultime le auto-intersezioni: riportare le lunghezze dopo le farebbe tornare (li' il tessuto e' schiacciato tra braccio e busto)
    fin, x0, x1 = resolve_self(fin, g.wtris, g.E)
    fin, _ = push_out(fin, tree, q['gap'])
    if sym:
        fin = mirror_half(fin)
    log('auto-intersezioni: %d coppie di triangoli -> %d dopo la levigatura locale' % (x0, x1))
    # Il colletto per ULTIMO: riportare le lunghezze al cartamodello tira la cucitura dello scollo (punta al centro davanti, ondulazioni).
    # L'anello torna la curva regolare, la fascia viene ricostruita e resta ferma; solo il tessuto intorno recupera le sue lunghezze.
    before, first = fin, (beta, neck)
    first_collar = (g.collar_prof, g.collar_n, g.collar_edge)          # la griglia della costina segue il colletto che resta, non quello scartato
    fin, beta, seam_dev, neck = rebuild_collar(g, fin, tree, q['gap'])
    ring = np.zeros(g.nw, bool)
    ring[g.weld[g.collar]] = True
    for nm_ in PIECES:
        if (nm_, 'neck_seam') in g.chains:
            ring[g.weld[g.chains[(nm_, 'neck_seam')]]] = True
    fin = strain_limit(fin, g.E[hard], g.L[hard], iters=200, tree=tree, gap=q['gap'], every=3, batches=batches, fixed=ring | pinned, sor=1.3, center=center)
    if sym:
        fin = mirror_half(fin)
    if len(self_pairs(fin, g.wtris)):
        fin, (beta, neck) = before, first
        g.collar_prof, g.collar_n, g.collar_edge = first_collar
        log('colletto finale: SCARTATO (creava auto-intersezioni), resta quello della prima passata')
    else:
        log('colletto finale: inclinazione media %.0f gradi, spostamento massimo della cucitura %.1f mm; scollo allargato di %.1f mm al massimo, cucitura %.1f cm (%+.1f%%)' % (beta, seam_dev, neck['open_mm'], neck['seam_cm'], neck['stretch'] * 100))
    # Giro dell'orlo = cartamodello. L'orlo e' un anello chiuso di lunghezza nota; dopo le proiezioni lato per lato puo' restare qualche
    # millimetro di scarto sul giro intero (somma di residui piccoli, tutti dello stesso segno). Lo si toglie con una scala orizzontale
    # attorno al centro dell'anello, sfumata sugli 8 cm sopra l'orlo; solo scarti sotto l'1,2% (oltre e' un problema vero: resta e il check lo dice).
    hem_ids = [g.weld[g.chains[(nm_, 'hem')]] for nm_ in ('front', 'back')]
    hem_rest = sum(float(np.linalg.norm(np.diff(g.P2[g.chains[(nm_, 'hem')]], axis=0), axis=1).sum()) for nm_ in ('front', 'back')) * CM
    hem_len = lambda p_: sum(float(np.linalg.norm(np.diff(p_[ids], axis=0), axis=1).sum()) for ids in hem_ids)      # noqa: E731
    hem0 = hem_len(fin)
    wh = np.zeros(g.nw)
    bsel = g.piece < 2
    wh[g.weld[bsel]] = np.clip(1.0 - (g.kp['H'][1] - g.P2[bsel, 1]) / 8.0, 0.0, 1.0) ** 2
    for _ in range(3):
        k = hem_rest / hem_len(fin)
        if abs(k - 1.0) < 0.0003 or abs(k - 1.0) > 0.012:
            break
        cy = float(np.concatenate([fin[ids, 1] for ids in hem_ids]).mean())
        fin[:, 0] *= 1.0 + (k - 1.0) * wh
        fin[:, 1] = cy + (fin[:, 1] - cy) * (1.0 + (k - 1.0) * wh)
    fin, _ = push_out(fin, tree, q['gap'] * 0.75)
    if sym:
        fin = mirror_half(fin)
    log('giro dell\'orlo: %.2f cm -> %.2f cm (cartamodello %.2f)' % (hem0 * 100, hem_len(fin) * 100, hem_rest * 100))
    st2 = strain(fin, g.E[hard], g.L[hard])
    log('rifinitura: deformazione dei lati prima %.2f%% (99%%: %.1f%%), dopo %.2f%% (99%%: %.1f%%, media con segno %+.3f%%), spostamento max %.1f mm, auto-intersezioni finali %d' % (
        np.abs(st).mean() * 100, np.percentile(np.abs(st), 99) * 100, np.abs(st2).mean() * 100, np.percentile(np.abs(st2), 99) * 100, st2.mean() * 100,
        np.abs(fin - sim).max() * 1000, len(self_pairs(fin, g.wtris))))
    full = finish_layers(g, fin, uv, mat)
    full['pos'], pushed = push_out(full['pos'], tree, 0.0025)
    for rnd in range(14):                                      # strati aggiunti (risvolti, colletto) che toccano altro tessuto: si assottigliano li'
        pairs = self_pairs(full['pos'], full['tris'])
        if not pairs:
            break
        vv = np.unique(full['tris'][np.unique(np.array(pairs))])
        vv = vv[vv >= full['n_base']]
        if not len(vv):
            break
        grow = np.zeros(len(full['pos']), bool)
        grow[vv] = True
        ft_ = full['tris']
        for _k in range(2):                                    # anche i vertici vicini dello stesso strato, per non lasciare un dente
            hit = grow[ft_].any(1)
            grow[np.unique(ft_[hit])] = True
        grow[:full['n_base']] = False
        vv = np.nonzero(grow)[0]
        full['pos'][vv] = full['anchor'][vv] + (0.25 if rnd < 3 else 0.0) * (full['pos'][vv] - full['anchor'][vv])    # poi: a filo dello strato base
    log('auto-intersezioni del capo completo: %d' % len(self_pairs(full['pos'], full['tris'])))
    log('strati: vertici', len(full['pos']), 'triangoli', len(full['tris']), 'spinti fuori dal corpo', pushed)
    export_glb(g, full, mats, glb)
    np.savez(os.path.join(out, f'tee_{size}_build.npz'), P2=g.P2, piece=g.piece, tris=g.tris, tpiece=g.tpiece, weld=g.weld, wmirror=g.wmirror, base=fin,
             pos=full['pos'], ftris=full['tris'], layer=full['layer'], src=full['src'], anchor=full['anchor'], E=g.E, L=g.L, elastic=g.elastic,
             collar=g.collar, hem=g.hem, cuff=g.cuff, chains=json.dumps({f'{a}.{b}': [int(i) for i in ids] for (a, b), ids in g.chains.items()}))
    elapsed = (time.time() - t0) if '--refinish' not in args else sim_seconds + (time.time() - t0)
    meta = dict(product=product, name=spec['name'], details=spec['details'], size=size, kind='tshirt', version=2,
                measures={k: (round(v, 3) if isinstance(v, float) else v) for k, v in g.meas.items()},
                table=P.SIZE_CHART[size], flat={k: round(v, 2) for k, v in P.flat_measures(size).items()}, sources=P.SOURCES,
                fabric=dict(q, gsm=spec['details']['gsm'], reference_gsm=P._products.REF_GSM,
                            note='unita\' della cloth sim di Blender, tarate a occhio sulla Grillz (250 gsm); massa e flessione scalate con la grammatura della scheda prodotto'),
                frames=fr, mesh=dict(spacing_cm=res, vertices=int(len(full['pos'])), triangles=int(len(full['tris'])), base_vertices=int(g.nw)),
                data_quality=dict(
                    size_chart='REALE (tabella del negozio)' if 'ASSUNT' not in spec['chart_source'] else 'ASSUNTA = tabella della Grillz Tee: NON e\' un dato di questo prodotto',
                    size_chart_assumed='ASSUNT' in spec['chart_source'],
                    back_photo='MANCANTE (retro = segnaposto liscio)', back_neck='ASSUNTO (profondita\' dello scollo dietro vista solo dal davanti)',
                    gsm='scheda prodotto, DA CONFERMARE',
                    assumed=sorted(k for k, v in P.SOURCES.items() if 'ASSUNT' in v),
                    missing=sorted(k for k, v in P.SOURCES.items() if 'MANCANTE' in v),
                    not_applicable=sorted(k for k, v in P.SOURCES.items() if 'NON APPLICABILE' in v)),
                neckline=dict(seam_cm=round(neck['seam_cm'], 1), vs_pattern_pct=round(neck['stretch'] * 100, 1), collar_tilt_deg=round(beta)),
                bake_seconds=round(elapsed), sim_seconds=sim_seconds, back='SEGNAPOSTO: manca la foto del retro',
                runtime='il capo e\' drappeggiato sul corpo neutro; l\'adattamento alle misure e\' calcolato a runtime (core/garment/bound.js)')
    with open(os.path.splitext(glb)[0] + '.json', 'w') as f:
        json.dump(meta, f, indent=2, ensure_ascii=False)
    log('ESPORTATO', glb)
    if '--preview' in args:
        chk = bpy.data.objects[OBJECT_NAME]
        if ob2 is not None:
            ob2.hide_render = True
        C.render(os.path.join(out, f'tee_{size}'), views=('front', 'side', 'back', 'three'), size=800, objects=[chk, body], focus=(0, 0.02, 1.15), extent=1.0)


main()
