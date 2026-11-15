"""Prodotti con capo 3D reale: per ognuno, da dove vengono i dati e come e' fatto. Python puro.

Ogni voce dice cosa e' MISURATO (tabella del negozio, foto, scheda del prodotto) e cosa e' ASSUNTO: finisce nei metadati di ogni GLB.
La scheda del prodotto (assets/products/<id>/source/*detail*.md) fornisce vestibilita', tipo di manica, composizione, grammatura.
"""

# tabella taglie della Grillz Tee (cm), dal negozio
GRILLZ_CHART = {
    'S':   dict(length=70, shoulder=53.7, chest=55.5, sleeve=20.9),
    'M':   dict(length=72, shoulder=55.2, chest=57.5, sleeve=21.4),
    'L':   dict(length=74, shoulder=57.0, chest=60.0, sleeve=22.0),
    'XL':  dict(length=76, shoulder=58.8, chest=62.5, sleeve=22.6),
    '2XL': dict(length=78, shoulder=60.6, chest=65.0, sleeve=23.2),
}
# taglio "drop shoulder" misurato sulla foto della Grillz (taglia S), in cm nel riferimento del pezzo (vedi pattern.py)
DROP_SHOULDER_CUT = dict(
    neck_seam_a=8.4, neck_seam_y=0.3, neck_front=7.3, neck_back=1.3, rib=1.9, shoulder_slope=0.374,
    sleeve_tip=(43.35, 16.24), sleeve_low=(34.05, 34.26), armpit=34.3,
    armhole=((0.0, 0.0), (0.12, -1.55), (0.20, -2.3), (0.35, -3.0), (0.45, -3.1), (0.55, -2.8), (0.67, -2.1), (0.78, -1.0), (0.87, -0.15), (1.0, 0.0)),
)
# taglio RAGLAN misurato sulla foto della DrivingMato con la scala provvisoria 9,694 px/cm (petto 55,5 cm = 538 px); DRIVINGMATO_CUT lo
# riporta alla scala vera (petto di tabella 55 cm). cm nel riferimento del pezzo
RAGLAN_CUT = dict(
    neck_seam_a=9.7, neck_seam_y=0.5,      # cucitura del colletto: semi-larghezza e quota sulla linea della spalla
    neck_n=2.8,                            # lo scollo e' piu' "quadrato" di un'ellisse: superellisse con questo esponente (adattata ai punti misurati)
    neck_front=9.2, neck_back=1.3, rib=1.7,
    raglan_t=33.0,                         # dove la cucitura raglan incontra il colletto DAVANTI (angolo sulla superellisse, gradi): punto (8,4; 7,6)
    raglan_t_back=27.5,                    # ... DIETRO: ASSUNTO (la foto mostra solo il davanti)
    # cucitura raglan davanti (confine rosso/bianco), dal colletto all'ascella
    raglan=((10.4, 9.1), (14.0, 12.2), (17.3, 15.3), (20.2, 18.4), (22.6, 21.5), (24.6, 24.6), (26.1, 27.6), (27.3, 30.7), (27.6, 33.8)),
    sleeve_tip=(45.0, 22.8), sleeve_low=(34.2, 38.8), armpit=36.6,
)
# tabelle taglie di Kermit e DrivingMato: fornite dal negozio (assets/products/<id>/[Ss]ource/tabella_taglie.csv)
KERMIT_CHART = {
    'S':   dict(length=70, shoulder=58, chest=59, sleeve=21),
    'M':   dict(length=72, shoulder=60, chest=61, sleeve=22),
    'L':   dict(length=74, shoulder=62, chest=63, sleeve=23),
    'XL':  dict(length=76, shoulder=64, chest=65, sleeve=24),
    '2XL': dict(length=78, shoulder=66, chest=67, sleeve=25),
}
DRIVINGMATO_CHART = {          # raglan: la tabella non ha la spalla
    'S':   dict(length=69, chest=55, sleeve=39),
    'M':   dict(length=71, chest=57, sleeve=40),
    'L':   dict(length=73, chest=59, sleeve=41),
    'XL':  dict(length=75, chest=61, sleeve=42),
    '2XL': dict(length=77, chest=63, sleeve=43),
}


def _scale_cut(cut, f):
    """Un taglio misurato sulla foto con una scala (px/cm) riportato a un'altra scala: tutte le lunghezze in cm per f; pendenze, angoli,
    esponenti e frazioni restano uguali."""
    keep = {'shoulder_slope', 'neck_n', 'raglan_t', 'raglan_t_back'}
    out = {}
    for k, v in cut.items():
        if k in keep:
            out[k] = v
        elif k == 'armhole':
            out[k] = tuple((u, dx * f) for u, dx in v)            # (frazione della discesa, rientro in cm)
        elif isinstance(v, tuple):
            out[k] = tuple(tuple(c * f for c in q) if isinstance(q, tuple) else q * f for q in v)
        else:
            out[k] = v * f
    return out


# Kermit: sulla foto, con la scala dal petto ASSUNTO 55,5 cm, il taglio coincideva con quello della Grillz entro 0,3 cm (manica (43,6; 16,1) e
# (34,4; 33,9), ascella 34,0). Il petto VERO e' 59 cm (stessi 1269 px): tutte quelle misure della foto valgono 59 / 55,5 volte tanto.
_KF = 59.0 / 55.5
KERMIT_CUT = _scale_cut(dict(DROP_SHOULDER_CUT, sleeve_tip=(43.6, 16.1), sleeve_low=(34.4, 33.9), armpit=34.0), _KF)
# DrivingMato: petto vero 55 cm invece dei 55,5 assunti (stessi 538 px)
_DF = 55.5 / 55.0
DRIVINGMATO_CUT = _scale_cut(RAGLAN_CUT, _DF)

REF_GSM = 250.0          # grammatura a cui e' stata tarata (a occhio) la cloth sim: quella della Grillz
# taratura di riferimento a REF_GSM (unita' della cloth sim di Blender). Flessione 40 -> 20: a 40 il capo usciva liscio e "scatolato"
# (spalla a spallina, quasi nessuna piega); a 20 le pieghe dall'ascella all'orlo si leggono e la manica scende sul braccio; a 12 compaiono
# grinze piccole e la trama della mesh (prove affiancate su Grillz M, un parametro alla volta: blender/garment/README.md)
# Flessione 20 -> 1 e risvolti morbidi quanto il tessuto (hem_bend 0): a 20 il capo era una "campana" (orlo ovale e liscio largo 45,9 cm su
# fianchi di 37,8: ne' l'orlo morbido da solo ne' la flessione bassa da sola la toglievano, servono entrambi); a 1 l'orlo scende a 42,0 cm, le
# pieghe arrivano all'orlo e le maniche si appoggiano al braccio. Sotto 1 (0,5 e 0,2) non cambia piu'; massa 0,5 e trazione 15 non aiutano.
REF_MASS, REF_BENDING, REF_BEND_MAX = 0.30, 1.0, 40.0

PRODUCTS = {
    'grillz-tee': dict(
        name='Grillz Tee', style='set_in', object='grillz_tee',
        photo=dict(file='source/front.png', K=13.98, cx=700.0, hps_y=236.0, w=1400, h=1400, hem_y=1163.0, print_end=50.0,
                   mask='alpha', plain_cm=(-25.0, 25.0, 50.0, 65.0)),
        chart=GRILLZ_CHART, chart_source='tabella del negozio (source/size-chart.md)',
        cut=DROP_SHOULDER_CUT, cut_source='foto del davanti',
        details=dict(fit='Loose', neckline='Round Neck', sleeve_style='Drop Shoulder', effects='Washed', material='100% cotton', gsm=250, thickness='Moderate',
                     elasticity='Slight Stretch', source='source/grillz-tee-details.md'),
        assumed=dict(hem_fold=2.0, fabric_mm=0.9, collar_mm=4.0),
        sources_extra={},
    ),
    'kermit-tee': dict(
        name='Kermit Tee', style='set_in', object='kermit_tee',
        photo=dict(file='Source/Kermit_Mato-nobg.png', K=1269.0 / 59.0, cx=1018.5, hps_y=692.0, w=2048, h=2731, hem_y=2140.0, print_end=40.0 * _KF,
                   mask='alpha', plain_cm=(-22.0 * _KF, 22.0 * _KF, 44.0 * _KF, 60.0 * _KF)),      # scala: petto di tabella 59 cm = 1269 px
        chart=KERMIT_CHART, chart_source='tabella del negozio (Source/tabella_taglie.csv)',
        # forma del taglio: quella della Grillz (sulla foto coincidono entro lo 0,5%), nella scala vera della foto Kermit (petto 59 cm = 1269 px)
        cut=KERMIT_CUT, cut_source='foto del davanti (scala dal petto di tabella; scollo e giromanica: forma della Grillz riportata a questa scala)',
        details=dict(fit='Loose', neckline='Round Neck', sleeve_style='Drop Shoulder', effects='Washed', material='88.91% cotton, 11.09% polyester', gsm=350,
                     thickness='Thick', breathability='Moderate', source='Source/kermit-tee-details.md'),
        # orlo e maniche a taglio vivo (si vede nella foto): nessun risvolto. Spessori: scalati con la grammatura (ASSUNTO)
        assumed=dict(hem_fold=0.0, fabric_mm=1.3, collar_mm=4.6),
        sources_extra={'length': 'tabella del negozio (nella foto il capo e\' lungo 67,3 cm: il mockup e\' piu\' corto, vale la tabella)',
                       'hem_fold': 'foto: orlo e maniche a taglio vivo, nessun risvolto'},
    ),
    'drivingmato-tee': dict(
        name='DrivingMato Tee', style='raglan', object='drivingmato_tee', folder='drivingMato-tee',
        photo=dict(file='source/tee.png', K=538.0 / 55.0, cx=516.0, hps_y=335.0, w=1024, h=1366, hem_y=1041.0, print_end=45.0 * _DF,
                   mask='alpha', plain_cm=(-20.0 * _DF, 20.0 * _DF, 45.0 * _DF, 68.0 * _DF)),      # la foto ha la trasparenza: attorno al capo c'e' un alone giallo semitrasparente, escluso dalla sagoma
        chart=DRIVINGMATO_CHART, chart_source='tabella del negozio (source/tabella_taglie.csv)',
        cut=DRIVINGMATO_CUT, cut_source='foto del davanti (scala dal petto di tabella: 55 cm = 538 px)',
        details=dict(fit='Loose', neckline='Round Neck', sleeve_style='Raglan Sleeve', material='70.1% cotton, 29.9% polyester', gsm=250, thickness='Moderate',
                     breathability='High', source='source/drivingMato-detail.md'),
        assumed=dict(hem_fold=2.0, fabric_mm=0.9, collar_mm=4.0),
        # la mesh a triangoli non ha molle di taglio: con la trazione piena (40) il tubo della manica raglan non si inclina sotto il braccio,
        # il fianco resta alto di 4 cm e il davanti fa pieghe orizzontali. Provato: attrito 5 (nessun effetto), discesa delle braccia in due
        # tempi (nessun effetto), trazione 12 (orlo alla quota attesa, pieghe sparite): scelto. Le lunghezze tornano al cartamodello in rifinitura.
        sim=dict(tension=12.0),
        sources_extra={'shoulder': 'NON APPLICABILE: una raglan non ha cucitura di spalla (la tabella non la riporta)',
                       'sleeve': 'tabella del negozio, intesa come bordo superiore della manica dal colletto all\'orlo manica: interpretazione ASSUNTA '
                                 '(nella foto quel bordo e\' lungo 42,1 cm contro 39 di tabella; angolo e apertura della manica restano quelli della foto)',
                       'armhole': 'foto: cucitura raglan davanti (confine rosso/bianco); dietro ASSUNTA con la stessa curvatura',
                       'shoulder_slope': 'foto: linea spalla-manica resa come un\'unica retta dal colletto al polsino (nella foto e\' leggermente spezzata)',
                       'length': 'tabella del negozio (nella foto il capo e\' lungo 73,6 cm: il mockup e\' piu\' lungo, vale la tabella)'},
    ),
}


def fabric_overrides(product):
    """Parametri della cloth sim derivati dalla grammatura della scheda prodotto, rispetto alla taratura di riferimento (REF_GSM).
    Regola dichiarata, non misurata: la massa per area cresce con la grammatura, la rigidezza a flessione col quadrato (tessuto piu' spesso)."""
    r = PRODUCTS[product]['details']['gsm'] / REF_GSM
    q = dict(mass=round(REF_MASS * r, 3), bending=round(REF_BENDING * r * r, 1), bend_max=round(REF_BEND_MAX * r * r, 1))
    q.update(PRODUCTS[product].get('sim', {}))        # ritocchi dichiarati per prodotto (es. raglan)
    return q
