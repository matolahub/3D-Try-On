"""Estrae da MakeHuman il riferimento antropometrico usato dagli shape key del corpo e lo salva in data/mh_reference.npz.

Uso (serve SOLO per rigenerare il file, che e' gia' nel repository; richiede MakeHuman 1.2 installato):
  Blender -b blender/man-model.blend --python blender/scripts/extract_mh_reference.py [-- /percorso/makehuman/data]

Perche' MakeHuman
  Il corpo (man-model.blend) e' la mesh base di MakeHuman (13380 vertici, stesso ordine: verificato qui sotto). I "target" macro di
  MakeHuman sono corpi interi disegnati da artisti su riferimenti anatomici (licenza CC0): dicono DOVE si distribuisce il volume
  quando una persona ingrassa o mette massa (addome, fianchi, glutei, cosce, dorso, braccia, collo, viso), cosa che una fascia
  orizzontale scritta a mano non puo' sapere.

Campi estratti (spostamento per vertice, metri, spazio mondo, sulla posa naturale del nostro modello)
  OBESE     = universal-male-young-minmuscle-maxweight  - universal-male-young-averagemuscle-averageweight
  ATHLETIC  = universal-male-young-maxmuscle-maxweight  - universal-male-young-averagemuscle-averageweight
  Sul nostro corpo OBESE vale circa +30 / +48 / +34 cm su petto / vita / fianchi: lo stesso ordine di grandezza del range degli slider,
  quindi i morph lavorano dentro l'intervallo per cui il target e' stato disegnato (nessuna estrapolazione di 3-4 volte).

Trasferimento sulla posa naturale
  I target sono definiti sulla posa di MakeHuman (braccia a ~45 gradi); il nostro modello ha le braccia lungo i fianchi. Ogni spostamento
  viene ruotato con la rotazione locale (Kabsch pesato sui vicini fino al terzo anello) che porta l'intorno del vertice dalla mesh
  MakeHuman alla nostra mesh: cosi' "il braccio si ispessisce" resta un ispessimento attorno all'asse del braccio anche a braccia abbassate.
"""
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bodyspec as S  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
MH = args[0] if args else os.environ.get('MAKEHUMAN_DATA', '/Applications/MakeHuman.app/Contents/Resources/makehuman/data')
NB = 13380                    # vertici del corpo nella mesh base di MakeHuman (i successivi sono helper)
MACRO = 'macrodetails/universal-male-young-'
SOURCES = {'OBESE': ('minmuscle-maxweight', 'averagemuscle-averageweight'), 'ATHLETIC': ('maxmuscle-maxweight', 'averagemuscle-averageweight')}


def base_obj():
    v = []
    with open(os.path.join(MH, '3dobjs', 'base.obj')) as f:
        for line in f:
            if line.startswith('v '):
                v.append([float(x) for x in line.split()[1:4]])
    return np.array(v)[:NB]


def target(rel):
    d = np.zeros((19158, 3))
    with open(os.path.join(MH, 'targets', rel + '.target')) as f:
        for line in f:
            if line.startswith('#') or not line.strip():
                continue
            p = line.split()
            d[int(p[0])] = (float(p[1]), float(p[2]), float(p[3]))
    return d[:NB]


body = S.Body()
me = body.me
if len(me.vertices) != NB:
    raise SystemExit(f'La mesh ha {len(me.vertices)} vertici, attesi {NB}: non e\' la mesh base di MakeHuman')
X = body.key_world(me.shape_keys.key_blocks['Basis']).astype(np.float64)
edges = np.empty(len(me.edges) * 2, np.int64)
me.edges.foreach_get('vertices', edges)
edges = edges.reshape(-1, 2)

# MakeHuman: decimetri, Y in alto, Z verso il davanti  ->  mondo: metri, Z in alto, davanti verso -Y
P = np.array([[1, 0, 0], [0, 0, -1], [0, 1, 0]], float) * 0.1
char = (base_obj() + target(MACRO + 'averagemuscle-averageweight') + target('macrodetails/caucasian-male-young')) @ P.T


def spread(a, rings=3):
    """Somma sui vicini fino a `rings` anelli (pesi = numero di cammini): media locale senza scipy."""
    for _ in range(rings):
        acc = a.copy()
        np.add.at(acc, edges[:, 0], a[edges[:, 1]])
        np.add.at(acc, edges[:, 1], a[edges[:, 0]])
        a = acc
    return a


def local_rotations(src, dst):
    n = len(src)
    w = spread(np.ones(n))
    ms, md = spread(src) / w[:, None], spread(dst) / w[:, None]
    H = spread((src[:, :, None] * dst[:, None, :]).reshape(n, 9)).reshape(n, 3, 3) / w[:, None, None] - ms[:, :, None] * md[:, None, :]
    U, _, Vt = np.linalg.svd(H)
    det = np.sign(np.linalg.det(np.einsum('nij,njk->nik', U, Vt)))
    D = np.zeros((n, 3, 3))
    D[:, 0, 0] = D[:, 1, 1] = 1
    D[:, 2, 2] = det
    return np.einsum('nji,njk,nlk->nil', Vt, D, U)          # R = V D U^T  (dst ~ R src)


ROT = local_rotations(char, X)
# controllo dell'ordine dei vertici: riallineando ogni intorno, la nostra mesh deve coincidere con quella di MakeHuman
w = spread(np.ones(len(X)))
res = np.linalg.norm((X - spread(X) / w[:, None]) - np.einsum('nij,nj->ni', ROT, char - spread(char) / w[:, None]), axis=1)
print('CONTROLLO ordine vertici: residuo locale mediano %.2f mm, 99%% %.2f mm' % (np.median(res) * 1000, np.percentile(res, 99) * 1000))
if np.median(res) > 0.004:
    raise SystemExit('I vertici non corrispondono alla mesh base di MakeHuman: riferimento non applicabile')

out = {}
for name, (a, b) in SOURCES.items():
    d = (target(MACRO + a) - target(MACRO + b)) @ P.T
    out[name] = np.einsum('nij,nj->ni', ROT, d).astype(np.float32)
    zmin = X[:, 2].min()
    g0 = {k: body.girth(X, zmin + f * np.ptp(X[:, 2])) for k, f in S.LEVEL.items()}
    g1 = {k: body.girth(X + out[name], zmin + f * np.ptp(X[:, 2])) for k, f in S.LEVEL.items()}
    print(name, 'effetto sulle circonferenze (cm):', {k: round(g1[k] - g0[k], 1) for k in g0}, 'spostamento max %.1f cm' % (np.linalg.norm(out[name], axis=1).max() * 100))
os.makedirs(os.path.join(HERE, 'data'), exist_ok=True)
dst = os.path.join(HERE, 'data', 'mh_reference.npz')
np.savez_compressed(dst, basis=X.astype(np.float32), sources=np.array([f'{k}={MACRO}{a} - {MACRO}{b}' for k, (a, b) in SOURCES.items()]), **out)
print('SCRITTO', dst)
