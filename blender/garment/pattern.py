"""Cartamodello 2D della T-shirt Grillz: pezzi veri (davanti, dietro, manica separata, colletto a costina), graduati dalla tabella taglie.

Python puro (senza bpy): usabile dentro Blender e da riga di comando.

Coordinate dei pezzi del busto: origine al centro, sulla linea del punto alto della spalla (HPS); x verso destra nella foto
(= sinistra di chi indossa), y verso il BASSO, in cm. E' lo stesso riferimento della foto stesa (scala K px/cm).

PEZZI E CUCITURE
  front / back   pannelli del busto: spalla inclinata, scollo, GIROMANICA CURVO, fianco dritto, orlo
  sleeve         manica separata: nella foto e' piegata lungo il bordo superiore; il pezzo intero e' la meta' visibile piu' la sua
                 riflessa rispetto alla piega. La testa della manica e' la stessa curva del giromanica (stessa lunghezza: si cuciono 1:1)
  colletto       fascia a costina larga `rib` tra il bordo interno dello scollo e la cucitura (catena interna `neck_seam`)
  risvolti       orlo e polsini: fascia alta `hem_fold` delimitata dalla linea della ribattitura (catene interne `hem_stitch`, `cuff_stitch`)

DA DOVE VENGONO I NUMERI  (vedi anche SOURCES, che finisce nei metadati di ogni GLB)
  TABELLA  (fonte primaria, per taglia)   chest, shoulder, length, sleeve
  FOTO     (misurato sulla foto del davanti, scala 13,98 px/cm ricavata da chest 55,5 = 776 px)
           scollo (larghezza, profondita' davanti, bordo superiore del colletto DIETRO: e' visibile dal davanti), larghezza costina,
           pendenza spalla, curva del giromanica, angolo e apertura della manica, profondita' dell'ascella
  ASSUNTO  (non ricavabile dai dati disponibili: valori tipici, da sostituire quando arrivano i dati veri)
           forma dello scollo dietro e giromanica dietro (uguale al davanti), altezza dei risvolti, spessori, graduazione dello scollo
"""
import math

import os as _os
import sys as _sys

_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import products as _products  # noqa: E402

# I valori qui sotto sono quelli del prodotto ATTIVO (use(id)); il default e' la Grillz Tee. Ogni processo lavora su un prodotto solo.
PRODUCT = None
K = PHOTO_CX = PHOTO_HPS_Y = PHOTO_W = PHOTO_H = PHOTO_HEM_Y = HEM_PRINT_END = None
SIZE_CHART, SIZES, PHOTO, ASSUMED, SOURCES, STYLE, DETAILS = {}, (), {}, {}, {}, 'set_in', {}
BASE_SIZE = 'S'


def use(product):
    """Attiva un prodotto di products.PRODUCTS: tabella, taglio misurato sulla foto, calibrazione della foto, assunzioni, provenienze."""
    global PRODUCT, K, PHOTO_CX, PHOTO_HPS_Y, PHOTO_W, PHOTO_H, PHOTO_HEM_Y, HEM_PRINT_END, SIZE_CHART, SIZES, PHOTO, ASSUMED, SOURCES, STYLE, DETAILS
    spec = _products.PRODUCTS[product]
    ph = spec['photo']
    PRODUCT, STYLE, DETAILS = product, spec['style'], spec['details']
    K, PHOTO_CX, PHOTO_HPS_Y, PHOTO_W, PHOTO_H, PHOTO_HEM_Y, HEM_PRINT_END = ph['K'], ph['cx'], ph['hps_y'], ph['w'], ph['h'], ph['hem_y'], ph['print_end']
    SIZE_CHART, SIZES, PHOTO, ASSUMED = spec['chart'], tuple(spec['chart']), spec['cut'], spec['assumed']
    t, c = spec['chart_source'], spec['cut_source']
    SOURCES = {
        'chest': t, 'shoulder': t, 'length': t, 'sleeve': t + ' (intesa come spalla -> centro del polsino: sulla foto Grillz 21,3 vs 20,9 cm)',
        'neck_seam_a': c, 'neck_front': c, 'neck_back': c + ' (bordo alto del colletto dietro visto dal davanti; la curva dietro e\' assunta)', 'rib': c,
        'shoulder_slope': c, 'armhole': c + ' (cucitura visibile, davanti); dietro ASSUNTO uguale', 'sleeve_angle': c, 'cuff': c + ', scalata col petto',
        'armpit': c + ', scalata col petto', 'hem_fold': 'ASSUNTO', 'fabric_mm': 'ASSUNTO', 'collar_mm': 'ASSUNTO',
        'gsm': f"scheda prodotto ({spec['details']['source']}): {spec['details']['gsm']} gsm, {spec['details']['material']} - DA CONFERMARE col negozio (GSM reale non verificata)",
        'fabric_rule': 'ASSUNTO: massa della sim proporzionale alla grammatura, flessione al quadrato (regola dichiarata, non misurata su una prova di caduta)',
        'back': 'MANCANTE: nessuna foto del retro (grafica, etichetta, scollo dietro reale)',
        'collar_back': 'ASSUNTO: la costina dietro riusa il colore di quella del davanti (non e\' fotografata)',
        'neck_stretch': 'ASSUNTO: lo scollo si allarga fino all\'8% (jersey leggermente elastico) dove il collo del manichino e\' piu\' grosso dell\'apertura',
    }
    SOURCES.update(spec['sources_extra'])


use(_os.environ.get('TRYON_PRODUCT', 'grillz-tee'))


def garment_measures(size):
    """Misure del cartamodello per la taglia: quelle di tabella + quelle della foto, scalate col petto dove serve."""
    if size not in SIZE_CHART:
        raise ValueError(f'Taglia sconosciuta: {size}')
    m = dict(SIZE_CHART[size])
    b = SIZE_CHART[BASE_SIZE]
    g = m['chest'] / b['chest']
    if STYLE == 'raglan':
        N0 = (PHOTO['neck_seam_a'], PHOTO['neck_seam_y'])
        T0, O0 = PHOTO['sleeve_tip'], PHOTO['sleeve_low']
        m.update(size=size, grade=g, neck_seam_a=PHOTO['neck_seam_a'], neck_seam_y=PHOTO['neck_seam_y'], neck_front=PHOTO['neck_front'], neck_back=PHOTO['neck_back'],
                 rib=PHOTO['rib'], shoulder_slope=(T0[1] - N0[1]) / (T0[0] - N0[0]), sleeve_angle=math.degrees(math.atan2(T0[1] - N0[1], T0[0] - N0[0])),
                 cuff=math.dist(T0, O0) * g, armpit=PHOTO['armpit'] * g, armhole_scale=g,
                 sleeve_top=float(m['sleeve']), sleeve_top_photo_S=math.dist(N0, T0),     # bordo superiore della manica: di TABELLA (dal colletto)
                 hem_fold=ASSUMED['hem_fold'], fabric_mm=ASSUMED['fabric_mm'], collar_mm=ASSUMED['collar_mm'])
        return m
    S0 = (b['shoulder'] / 2, PHOTO['neck_seam_y'] + PHOTO['shoulder_slope'] * (b['shoulder'] / 2 - PHOTO['neck_seam_a']))
    T0, O0 = PHOTO['sleeve_tip'], PHOTO['sleeve_low']
    top0 = math.dist(S0, T0)
    m.update(
        size=size, grade=g,
        neck_seam_a=PHOTO['neck_seam_a'], neck_seam_y=PHOTO['neck_seam_y'], neck_front=PHOTO['neck_front'], neck_back=PHOTO['neck_back'],
        rib=PHOTO['rib'], shoulder_slope=PHOTO['shoulder_slope'],
        sleeve_angle=math.degrees(math.atan2(T0[1] - S0[1], T0[0] - S0[0])),
        cuff=math.dist(T0, O0) * g, armpit=PHOTO['armpit'] * g, armhole_scale=g,
        hem_fold=ASSUMED['hem_fold'], fabric_mm=ASSUMED['fabric_mm'], collar_mm=ASSUMED['collar_mm'],
    )
    # bordo superiore della manica: tale che spalla -> centro del polsino valga la manica di tabella (il polsino e' perpendicolare al bordo)
    m['sleeve_top'] = math.sqrt(max(m['sleeve'] ** 2 - (m['cuff'] / 2) ** 2, 1.0))
    m['sleeve_top_photo_S'] = top0
    return m


# ── geometria ────────────────────────────────────────────────────────────────
def _resample(pts, spacing, n=None):
    """Ricampiona una polilinea a passo uniforme lungo l'arco (n segmenti; default: lunghezza / spacing). Estremi invariati."""
    seg = [math.dist(a, b) for a, b in zip(pts[:-1], pts[1:])]
    total = sum(seg)
    n = n or max(1, round(total / spacing))
    out, i, acc = [tuple(pts[0])], 0, 0.0
    for k in range(1, n):
        s = total * k / n
        while i < len(seg) - 1 and acc + seg[i] < s:
            acc += seg[i]
            i += 1
        t = (s - acc) / seg[i] if seg[i] > 0 else 0.0
        a, b = pts[i], pts[i + 1]
        out.append((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t))
    out.append(tuple(pts[-1]))
    return out


def _catmull(ctrl, per=12):
    """Curva di Catmull-Rom centripeta-uniforme per i punti di controllo (passa per tutti)."""
    P = [ctrl[0]] + list(ctrl) + [ctrl[-1]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(per):
            t = k / per
            out.append(tuple(0.5 * ((2 * p1[d]) + (-p0[d] + p2[d]) * t + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t * t
                                    + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t ** 3) for d in (0, 1)))
    out.append(tuple(ctrl[-1]))
    return out


def _half_ellipse(a, y0, depth, n=48):
    """Da (+a, y0) a (-a, y0) passando per (0, y0 + depth)."""
    return [(a * math.cos(math.pi * i / n), y0 + depth * math.sin(math.pi * i / n)) for i in range(n + 1)]


def _mirror(pts):
    return [(-x, y) for x, y in pts]


def key_points(m):
    """Punti notevoli del cartamodello (cm)."""
    a, y0 = m['neck_seam_a'], m['neck_seam_y']
    if STYLE == 'raglan':                         # la piega della manica parte dal colletto: S coincide con N
        al = math.radians(m['sleeve_angle'])
        N = (a, y0)
        T = (N[0] + m['sleeve_top'] * math.cos(al), N[1] + m['sleeve_top'] * math.sin(al))
        O = (T[0] - m['cuff'] * math.sin(al), T[1] + m['cuff'] * math.cos(al))
        Ni = (a - m['rib'] * math.cos(al), y0 - m['rib'] * math.sin(al))
        return dict(S=N, T=T, O=O, A=(m['chest'] / 2, m['armpit']), H=(m['chest'] / 2, y0 + m['length']), N=N, Ni=Ni, alpha=al)
    Sh2, W2 = m['shoulder'] / 2, m['chest'] / 2
    S = (Sh2, y0 + m['shoulder_slope'] * (Sh2 - a))
    al = math.radians(m['sleeve_angle'])
    T = (S[0] + m['sleeve_top'] * math.cos(al), S[1] + m['sleeve_top'] * math.sin(al))
    O = (T[0] - m['cuff'] * math.sin(al), T[1] + m['cuff'] * math.cos(al))
    A = (W2, m['armpit'])
    H = (W2, y0 + m['length'])
    N = (a, y0)                                   # cucitura del colletto sulla spalla
    Ni = (a - m['rib'], y0 - m['shoulder_slope'] * m['rib'])     # bordo interno del colletto sulla linea della spalla (HPS)
    return dict(S=S, T=T, O=O, A=A, H=H, N=N, Ni=Ni, alpha=al)


def armhole_curve(m):
    """Giromanica dal punto spalla S all'ascella A (curva misurata sulla foto, scalata con la taglia)."""
    P = key_points(m)
    S, A = P['S'], P['A']
    ctrl = [(S[0] + (A[0] - S[0]) * u + dx * m['armhole_scale'], S[1] + (A[1] - S[1]) * u) for u, dx in PHOTO['armhole']]
    return _catmull(ctrl)


def _superellipse(a, y0, b, n, t0, t1, k=40):
    """Arco di superellisse |x/a|^n + |(y-y0)/b|^n = 1 tra gli angoli t0 e t1 (gradi; 0 = sulla linea della spalla, 90 = al centro)."""
    out = []
    for i in range(k + 1):
        t = math.radians(t0 + (t1 - t0) * i / k)
        out.append((a * max(math.cos(t), 0.0) ** (2 / n), y0 + b * max(math.sin(t), 0.0) ** (2 / n)))
    return out


def pieces_raglan(size, spacing=1.2):
    """Pezzi di una T-shirt RAGLAN: davanti e dietro arrivano al colletto solo al centro; la manica sale fino al colletto e porta la sua
    parte di costina. Stessa struttura di pieces(): la manica e' la meta' visibile nella foto piu' la meta' dietro, ribaltata sulla piega
    (qui le due meta' NON sono uguali: dietro lo scollo e' meno profondo, quindi la cucitura raglan parte piu' in alto)."""
    m = garment_measures(size)
    P = key_points(m)
    N, T, O, A, H, Ni = (P[k] for k in ('N', 'T', 'O', 'A', 'H', 'Ni'))
    a, y0, rib, n = m['neck_seam_a'], m['neck_seam_y'], m['rib'], PHOTO['neck_n']
    g = m['armhole_scale']
    fold = m['hem_fold'] > 0
    Hs = (A[0], H[1] - m['hem_fold'])
    side = (_resample([A, Hs], spacing) + _resample([Hs, H], spacing)[1:]) if fold else _resample([A, H], spacing)
    hem_half = _resample([H, (0.0, H[1])], spacing)
    hem = hem_half + _mirror(hem_half)[-2::-1]
    al = P['alpha']
    e, ep = (math.cos(al), math.sin(al)), (-math.sin(al), math.cos(al))

    def to_uv(p):
        d = (p[0] - N[0], p[1] - N[1])
        return (d[0] * e[0] + d[1] * e[1], d[0] * ep[0] + d[1] * ep[1])

    flip = lambda pts: [(u, -v) for u, v in pts]                     # noqa: E731
    # curvatura della cucitura raglan davanti (taglia base): scostamento orizzontale dalla corda, a frazioni della discesa
    A0 = (SIZE_CHART[BASE_SIZE]['chest'] / 2, PHOTO['armpit'])
    nr0 = _superellipse(a, y0, PHOTO['neck_front'] + rib - y0, n, PHOTO['raglan_t'], PHOTO['raglan_t'], 1)[0]
    bulge = [((y - nr0[1]) / (A0[1] - nr0[1]), x - (nr0[0] + (A0[0] - nr0[0]) * (y - nr0[1]) / (A0[1] - nr0[1]))) for x, y in PHOTO['raglan']]
    out = {'meas': m, 'spacing': spacing, 'points': P, 'pieces': {}}
    halves = {}
    for name, back in (('front', False), ('back', True)):
        depth_in = m['neck_back'] if back else m['neck_front']
        tr = PHOTO['raglan_t_back'] if back else PHOTO['raglan_t']
        b_seam, b_in = depth_in + rib - y0, depth_in - Ni[1]
        seam_r = _resample(_superellipse(a, y0, b_seam, n, tr, 90), spacing * 0.8)                 # Nr -> centro
        inner_r = _resample(_superellipse(Ni[0], Ni[1], b_in, n, tr, 90), spacing * 0.8)            # Nri -> centro
        Nr, Nri = seam_r[0], inner_r[0]
        rag = _resample(_catmull([Nr] + [(Nr[0] + (A[0] - Nr[0]) * u + dx * g, Nr[1] + (A[1] - Nr[1]) * u) for u, dx in bulge] + [A]), spacing)   # Nr -> A
        cside = _resample([Nri, Nr], spacing, n=2)
        neck = _mirror(inner_r) + inner_r[-2::-1]                    # (-Nri) -> centro -> (+Nri)
        outline = [('collar_side_R', cside), ('armhole_R', rag), ('side_R', side), ('hem', hem), ('side_L', _mirror(side)[::-1]),
                   ('armhole_L', _mirror(rag)[::-1]), ('collar_side_L', _mirror(cside)[::-1]), ('neck', neck)]
        seam = _mirror(seam_r) + seam_r[-2::-1]
        stitch_y = H[1] - m['hem_fold']
        st_half = _resample([(A[0], stitch_y), (0.0, stitch_y)], spacing)
        inner = [('neck_seam', seam), ('hem_stitch', st_half + _mirror(st_half)[-2::-1])][:2 if fold else 1]
        out['pieces'][name] = dict(outline=outline, inner=inner, frame=None, back=back, collar_poly=neck + seam[::-1])
        # la parte di colletto e la cucitura che stanno sulla manica, da questo lato (nel riferimento della manica)
        s_seam = _resample(_superellipse(a, y0, b_seam, n, 0, tr), spacing * 0.8)                   # N -> Nr
        s_in = _resample(_superellipse(Ni[0], Ni[1], b_in, n, 0, tr), spacing * 0.8, n=len(s_seam) - 1)   # Ni -> Nri
        halves[name] = dict(seam=[to_uv(q) for q in s_seam], inner=[to_uv(q) for q in s_in], cside=[to_uv(q) for q in cside], cap=[to_uv(q) for q in rag])
    hf = m['hem_fold'] if fold else 1.0
    uA, vA = to_uv(A)
    u_t, cuff = to_uv(T)[0], to_uv(O)[1]
    tq = 1.0 - hf / (u_t - uA)
    Q = (u_t - hf, vA + tq * (cuff - vA))
    under_f = (_resample([(uA, vA), Q], spacing) + _resample([Q, (u_t, cuff)], spacing)[1:]) if fold else _resample([(uA, vA), (u_t, cuff)], spacing)
    cuff_f = [to_uv(q) for q in _resample([O, T], spacing)]
    F, B = halves['front'], halves['back']
    for d in (F, B):                                                 # le due meta' condividono esattamente i punti sulla piega
        d['seam'][0], d['inner'][0] = (0.0, 0.0), to_uv(Ni)
    outline = [
        ('neck_F', F['inner']), ('collar_side_F', F['cside']), ('cap_F', F['cap']), ('under_F', under_f), ('cuff', cuff_f + flip(cuff_f)[-2::-1]),
        ('under_B', flip(under_f)[::-1]), ('cap_B', flip(B['cap'])[::-1]), ('collar_side_B', flip(B['cside'])[::-1]), ('neck_B', flip(B['inner'])[::-1]),
    ]
    seam = flip(B['seam'])[::-1] + F['seam'][1:]                     # Nr dietro -> N -> Nr davanti
    st = _resample([Q, (u_t - hf, 0.0)], spacing)
    inner = [('neck_seam', seam)] + ([('cuff_stitch', st + flip(st)[-2::-1])] if fold else [])
    poly = flip(B['inner'])[::-1] + F['inner'][1:] + seam[::-1]
    # sopra la spalla la "manica" e' tessuto che poggia sul busto: per il runtime conta come manica solo oltre la spalla
    # la tabella di una raglan non ha la spalla: per il solo peso "manica" del runtime si usa una spalla tipica (0,97 x petto: ASSUNTO)
    u_sh = (SIZE_CHART[size].get('shoulder', 0.97 * SIZE_CHART[size]['chest']) / 2 - N[0]) / math.cos(al)
    out['pieces']['sleeve'] = dict(outline=outline, inner=inner, frame=(N, e, ep), back=None, collar_poly=poly, sleeve_from_u=u_sh)
    return out


RAGLAN_SEAMS = [
    (('front', 'side_R', 1), ('back', 'side_R', 1)), (('front', 'side_L', 1), ('back', 'side_L', 1)),
    (('front', 'armhole_R', 1), ('sleeve_L', 'cap_F', 1)), (('back', 'armhole_R', 1), ('sleeve_L', 'cap_B', -1)),
    (('front', 'armhole_L', 1), ('sleeve_R', 'cap_F', -1)), (('back', 'armhole_L', 1), ('sleeve_R', 'cap_B', 1)),
    (('front', 'collar_side_R', 1), ('sleeve_L', 'collar_side_F', 1)), (('back', 'collar_side_R', 1), ('sleeve_L', 'collar_side_B', -1)),
    (('front', 'collar_side_L', 1), ('sleeve_R', 'collar_side_F', -1)), (('back', 'collar_side_L', 1), ('sleeve_R', 'collar_side_B', 1)),
    (('sleeve_L', 'under_F', 1), ('sleeve_L', 'under_B', -1)), (('sleeve_R', 'under_F', 1), ('sleeve_R', 'under_B', -1)),
]


def seams():
    return RAGLAN_SEAMS if STYLE == 'raglan' else SEAMS


def pieces(size, spacing=1.2):
    if STYLE == 'raglan':
        return pieces_raglan(size, spacing)
    return pieces_set_in(size, spacing)


def pieces_set_in(size, spacing=1.2):
    """Pezzi del cartamodello.

    Ritorna { 'meas': misure, 'pieces': { nome: { 'outline': [(catena, [(x, y)...])...] in senso orario nella foto, chiuso;
                                                   'inner': [(catena, [(x, y)...])...] catene interne (cucitura colletto, ribattiture);
                                                   'frame': None | (origine, e, eperp) per la manica } } }
    Catene con lo stesso nome su pezzi diversi hanno lo stesso numero di punti nello stesso verso: si cuciono per indice (vedi SEAMS).
    """
    m = garment_measures(size)
    P = key_points(m)
    S, T, O, A, H, N, Ni = (P[k] for k in ('S', 'T', 'O', 'A', 'H', 'N', 'Ni'))
    rib = m['rib']
    arm = _resample(armhole_curve(m), spacing)                       # S -> A
    shoulder = _resample([N, S], spacing)                            # N -> S
    collar_top = _resample([Ni, N], spacing, n=2)                    # bordo interno -> cucitura, lungo la linea della spalla
    fold = m['hem_fold'] > 0                                         # False: orlo e polsini a taglio vivo, nessuna ribattitura
    Hs = (A[0], H[1] - m['hem_fold'])                                # la ribattitura dell'orlo incontra il fianco: vertice in comune
    side = (_resample([A, Hs], spacing) + _resample([Hs, H], spacing)[1:]) if fold else _resample([A, H], spacing)
    hem_half = _resample([H, (0.0, H[1])], spacing)
    hem = hem_half + _mirror(hem_half)[-2::-1]                       # H -> -H, simmetrico, con un vertice sul centro
    out = {'meas': m, 'spacing': spacing, 'points': P, 'pieces': {}}
    for name, back in (('front', False), ('back', True)):
        depth_in = m['neck_back'] if back else m['neck_front']
        inner_r = _resample(_half_ellipse(Ni[0], Ni[1], depth_in - Ni[1])[:25], spacing * 0.8)        # Ni -> centro (meta' destra)
        seam_r = _resample(_half_ellipse(N[0], N[1], depth_in + rib - N[1])[:25], spacing * 0.8)      # N  -> centro
        neck = _mirror(inner_r) + inner_r[-2::-1]                    # (-Ni) -> centro -> (+Ni)
        outline = [
            ('collar_top_R', collar_top), ('shoulder_R', shoulder), ('armhole_R', arm), ('side_R', side), ('hem', hem),
            ('side_L', _mirror(side)[::-1]), ('armhole_L', _mirror(arm)[::-1]), ('shoulder_L', _mirror(shoulder)[::-1]),
            ('collar_top_L', _mirror(collar_top)[::-1]), ('neck', neck),
        ]
        stitch_y = H[1] - m['hem_fold']
        st_half = _resample([(A[0], stitch_y), (0.0, stitch_y)], spacing)
        inner = [('neck_seam', _mirror(seam_r) + seam_r[-2::-1]),     # (-N) -> centro -> (+N)
                 ('hem_stitch', st_half + _mirror(st_half)[-2::-1])][:2 if fold else 1]
        out['pieces'][name] = dict(outline=outline, inner=inner, frame=None, back=back, collar_poly=neck + inner[0][1][::-1])

    # manica (lato destro della foto = sinistra di chi indossa): riferimento con origine in S, e lungo la piega, eperp verso il davanti
    al = P['alpha']
    e, ep = (math.cos(al), math.sin(al)), (-math.sin(al), math.cos(al))

    def to_uv(p):
        d = (p[0] - S[0], p[1] - S[1])
        return (d[0] * e[0] + d[1] * e[1], d[0] * ep[0] + d[1] * ep[1])

    cap_f = [to_uv(p) for p in arm]                                  # S -> A (davanti, v > 0)
    hf = m['hem_fold'] if fold else 1.0
    uA, vA = to_uv(A)
    u_t, cuff = to_uv(T)[0], to_uv(O)[1]                             # il polsino e' la retta u = u_t (perpendicolare alla piega)
    tq = 1.0 - hf / (u_t - uA)
    Q = (u_t - hf, vA + tq * (cuff - vA))                            # dove la ribattitura del polsino incontra il sottomanica
    under_f = (_resample([(uA, vA), Q], spacing) + _resample([Q, (u_t, cuff)], spacing)[1:]) if fold else _resample([(uA, vA), (u_t, cuff)], spacing)   # A -> Q -> O
    cuff_f = [to_uv(p) for p in _resample([O, T], spacing)]          # O -> T
    flip = lambda pts: [(u, -v) for u, v in pts]                     # noqa: E731  riflessione rispetto alla piega
    outline = [
        ('cap_F', cap_f), ('under_F', under_f), ('cuff', cuff_f + flip(cuff_f)[-2::-1]),
        ('under_B', flip(under_f)[::-1]), ('cap_B', flip(cap_f)[::-1]),
    ]
    st = _resample([Q, (u_t - hf, 0.0)], spacing)                    # ribattitura del polsino: parallela al polsino, a hem_fold
    out['pieces']['sleeve'] = dict(outline=outline, inner=[('cuff_stitch', st + flip(st)[-2::-1])] if fold else [], frame=(S, e, ep), back=None)
    return out


# cuciture: (pezzo, catena, verso) <-> (pezzo, catena, verso); verso -1 = la catena va percorsa al contrario per corrispondere
SEAMS = [
    (('front', 'shoulder_R', 1), ('back', 'shoulder_R', 1)), (('front', 'shoulder_L', 1), ('back', 'shoulder_L', 1)),
    (('front', 'collar_top_R', 1), ('back', 'collar_top_R', 1)), (('front', 'collar_top_L', 1), ('back', 'collar_top_L', 1)),
    (('front', 'side_R', 1), ('back', 'side_R', 1)), (('front', 'side_L', 1), ('back', 'side_L', 1)),
    (('front', 'armhole_R', 1), ('sleeve_L', 'cap_F', 1)), (('back', 'armhole_R', 1), ('sleeve_L', 'cap_B', -1)),
    (('front', 'armhole_L', 1), ('sleeve_R', 'cap_F', -1)), (('back', 'armhole_L', 1), ('sleeve_R', 'cap_B', 1)),
    (('sleeve_L', 'under_F', 1), ('sleeve_L', 'under_B', -1)), (('sleeve_R', 'under_F', 1), ('sleeve_R', 'under_B', -1)),
]


def flat_measures(size):
    """Misure del cartamodello a riposo (cm), ricalcolate dalla geometria dei pezzi: servono a verificare la corrispondenza con la tabella."""
    o = pieces(size)
    m, P = o['meas'], o['points']

    def length(pts):
        return sum(math.dist(a, b) for a, b in zip(pts[:-1], pts[1:]))

    f = dict(o['pieces']['front']['outline'])
    s = dict(o['pieces']['sleeve']['outline'])
    if STYLE == 'raglan':
        return dict(chest_flat=2 * P['A'][0], chest_circ=4 * P['A'][0], hem_circ=2 * length(f['hem']), length=P['H'][1] - P['N'][1],
                    sleeve_top=math.dist(P['N'], P['T']), sleeve=math.dist(P['N'], ((P['T'][0] + P['O'][0]) / 2, (P['T'][1] + P['O'][1]) / 2)),
                    cuff_circ=length(s['cuff']), armhole=length(f['armhole_R']), cap=length(s['cap_F']),
                    armhole_back=length(dict(o['pieces']['back']['outline'])['armhole_R']), cap_back=length(s['cap_B']), underarm=length(s['under_F']))
    mid_cuff = ((P['T'][0] + P['O'][0]) / 2, (P['T'][1] + P['O'][1]) / 2)
    return dict(
        chest_flat=2 * P['A'][0], chest_circ=4 * P['A'][0], hem_circ=2 * length(f['hem']), shoulder=2 * P['S'][0],
        length=P['H'][1] - P['N'][1], sleeve=math.dist(P['S'], mid_cuff), sleeve_top=math.dist(P['S'], P['T']),
        cuff_circ=2 * length(s['cuff']) / 2 * 1.0, armhole=length(f['armhole_R']), cap=length(s['cap_F']), underarm=length(s['under_F']),
        neck_seam_circ=length(dict(o['pieces']['front']['inner'])['neck_seam']) + length(dict(o['pieces']['back']['inner'])['neck_seam']),
        neck_open_circ=length(f['neck']) + length(dict(o['pieces']['back']['outline'])['neck']),
    )


def photo_uv(x, y, m, back=False):
    """Coordinate texture (u, v in [0,1], v verso l'alto) di un punto nel riferimento della foto.

    Davanti: 1:1 sulla foto della taglia base; sotto HEM_PRINT_END il tessuto e' liscio e viene allungato fino alla lunghezza di tabella.
    Le altre taglie usano la stessa foto scalata in larghezza col petto (la grafica resta centrata; proporzione ASSUNTA).
    Dietro: stesso layout specchiato, su texture segnaposto.
    """
    g = m['grade']
    hem_y = m['neck_seam_y'] + m['length']
    py_hem_cm = (PHOTO_HEM_Y - PHOTO_HPS_Y) / K
    cut = HEM_PRINT_END * g
    yy = y / g if y <= cut else HEM_PRINT_END + (y - cut) * (py_hem_cm - HEM_PRINT_END) / (hem_y - cut)
    px = PHOTO_CX + (-x if back else x) / g * K
    py = PHOTO_HPS_Y + yy * K
    return px / PHOTO_W, 1.0 - py / PHOTO_H


if __name__ == '__main__':   # controllo: tabella vs cartamodello per ogni taglia; con un argomento, sovrappone il contorno S alla foto
    import sys
    print(f'{"taglia":6s} {"petto":>13s} {"spalla":>13s} {"lunghezza":>13s} {"manica":>13s}  giromanica=testa  sottomanica  polsino(giro)  scollo(cucitura/apertura)')
    for sz in SIZES:
        fm, t = flat_measures(sz), SIZE_CHART[sz]
        cells = [f'{fm.get(a, float("nan")):6.2f}/{t.get(b, float("nan")):<6.1f}' for a, b in (('chest_flat', 'chest'), ('shoulder', 'shoulder'), ('length', 'length'), ('sleeve_top' if STYLE == 'raglan' else 'sleeve', 'sleeve'))]
        print(f'{sz:6s} ' + ' '.join(cells) + f'  {fm["armhole"]:.2f}={fm["cap"]:.2f}      {fm["underarm"]:.2f}        {fm["cuff_circ"]:.1f}          {fm.get("neck_seam_circ", float("nan")):.1f}/{fm.get("neck_open_circ", float("nan")):.1f}')
    if len(sys.argv) > 2:
        from PIL import Image, ImageDraw
        img = Image.open(sys.argv[1]).convert('RGBA')
        bg = Image.new('RGBA', img.size, (0, 0, 0, 255))
        bg.alpha_composite(img)
        d = ImageDraw.Draw(bg)
        o = pieces('S')
        px = lambda p: (PHOTO_CX + p[0] * K, PHOTO_HPS_Y + p[1] * K)     # noqa: E731
        for nm, col in (('front', (0, 220, 0)),):
            for cn, pts in o['pieces'][nm]['outline'] + o['pieces'][nm]['inner']:
                d.line([px(p) for p in pts], fill=(255, 220, 0) if cn in ('neck_seam', 'hem_stitch') else col, width=2)
        S, e, ep = o['pieces']['sleeve']['frame']
        for cn, pts in o['pieces']['sleeve']['outline'] + o['pieces']['sleeve']['inner']:
            fr = [(S[0] + u * e[0] + abs(v) * ep[0], S[1] + u * e[1] + abs(v) * ep[1]) for u, v in pts]
            d.line([px(p) for p in fr], fill=(0, 200, 255), width=2)
        bg.convert('RGB').save(sys.argv[2])
        print('overlay ->', sys.argv[2])
