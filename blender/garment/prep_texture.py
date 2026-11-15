"""Prepara le texture del capo dalla foto del prodotto (Python di sistema: numpy + cv2).

  python3 blender/garment/prep_texture.py <id prodotto>          es. grillz-tee, kermit-tee
Scrive in assets/products/<id>/textures/:
  front.png  foto del davanti; fuori dalla sagoma il colore del tessuto e' esteso verso l'esterno (niente alone ai bordi delle mesh)
  back.png   retro: SEGNAPOSTO liscio ricavato da una zona senza grafica del davanti, finche' non c'e' la foto del retro
La calibrazione della foto e la zona liscia stanno in products.py. Lato lungo massimo 2048 px (le UV sono normalizzate).
"""
import os
import sys

import cv2
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import products  # noqa: E402

pid = sys.argv[1]
spec = products.PRODUCTS[pid]
ph = spec['photo']
root = os.path.join(HERE, '..', '..', 'assets', 'products', spec.get('folder', pid))
out = os.path.join(root, 'textures')
os.makedirs(out, exist_ok=True)
im = cv2.imread(os.path.join(root, ph['file']), cv2.IMREAD_UNCHANGED)
bgr = im[..., :3]
if ph['mask'] == 'alpha':
    mask = (im[..., 3] >= 250).astype(np.uint8)
else:                                                # foto senza trasparenza su fondo bianco: sagoma = tutto cio' che non e' fondo
    mask = (bgr.min(2) < ph.get('bg_min', 246)).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((25, 25), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(mask)
    mask = (lab == 1 + stats[1:, cv2.CC_STAT_AREA].argmax()).astype(np.uint8)
    h, w = mask.shape                                # riempie i buchi interni (tessuto chiaro quanto il fondo)
    ff = mask.copy()
    cv2.floodFill(ff, np.zeros((h + 2, w + 2), np.uint8), (0, 0), 1)
    mask = (mask | (1 - ff)).astype(np.uint8)
mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
# esclude il bordo (pixel misti con l'alone o col fondo): ~3,5 mm con la trasparenza, ~1 cm su fondo bianco (bordo sfumato e ombra);
# `edge_cm` nella calibrazione della foto lo allarga (es. foto con un alone colorato attorno al capo)
k = max(5, int(ph.get('edge_cm', 0.35) * ph['K']) | 1) if ph['mask'] == 'alpha' else max(9, int(ph.get('edge_cm', 1.0) * ph['K']) | 1)
core = cv2.erode(mask, np.ones((k, k), np.uint8))

# estensione del colore verso l'esterno: ripete il pixel valido piu' vicino
dist, labels = cv2.distanceTransformWithLabels(1 - core, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
ys, xs = np.where(core == 1)
lut = np.zeros((labels.max() + 1, 3), np.uint8)
lut[labels[ys, xs]] = bgr[ys, xs]
filled = np.where(core[..., None] == 1, bgr, lut[labels])

# retro liscio: tessuto senza grafica, ripetuto a specchio
x0, x1, y0, y1 = ph['plain_cm']
px = lambda x: int(round(ph['cx'] + x * ph['K']))     # noqa: E731
py = lambda y: int(round(ph['hps_y'] + y * ph['K']))  # noqa: E731
patch = filled[py(y0):py(y1), px(x0):px(x1)]
# Il retro e' un colore uniforme (mediana della zona liscia) piu' la sola GRANA del tessuto (la zona liscia meno la sua versione sfocata),
# ripetuta a specchio. Ripetendo la zona liscia cosi' com'e', le sue sfumature larghe (ombre del mockup) facevano un salto a ogni
# piastrella: sulla schiena si vedevano righe orizzontali.
base = np.median(patch.reshape(-1, 3), axis=0)
# Colore di fondo per RIGA: alcuni capi sono sfumati dall'alto in basso (lavaggio "washed"): il retro segue la stessa sfumatura del davanti,
# letta nelle due fasce laterali del busto dove non c'e' grafica (tra il 55% e l'85% della mezza larghezza), lisciata in verticale.
half = 0.5 * spec['chart'][next(iter(spec['chart']))]['chest']
ys_ = np.arange(filled.shape[0])
prof = np.tile(base, (filled.shape[0], 1)).astype(np.float32)
cols_ = [c for c in range(filled.shape[1]) if 0.55 * half <= abs((c - ph['cx']) / ph['K']) <= 0.85 * half]
y_top, y_bot = py(ph.get('profile_from_cm', 22.0)), min(int(ph['hem_y']) - 5, filled.shape[0] - 1)      # sotto il giromanica, fino all'orlo
if cols_ and y_bot > y_top + 10:
    band = filled[y_top:y_bot][:, cols_].astype(np.float32)
    ok = core[y_top:y_bot][:, cols_] == 1
    rows_ = np.array([np.median(band[i][ok[i]], axis=0) if ok[i].sum() > 20 else base for i in range(len(band))], np.float32)
    rows_ = cv2.GaussianBlur(rows_[:, None, :], (1, 0), sigmaX=0.1, sigmaY=3.0 * ph['K'])[:, 0, :]
    prof[y_top:y_bot] = rows_
    prof[:y_top] = rows_[0]
    prof[y_bot:] = rows_[-1]
sigma = max(3.0, 1.5 * ph['K'])                        # ~1,5 cm: sotto questa scala e' grana, sopra e' illuminazione della foto
grain = patch.astype(np.float32) - cv2.GaussianBlur(patch.astype(np.float32), (0, 0), sigma)
tile = np.concatenate([grain, grain[:, ::-1]], axis=1)
tile = np.concatenate([tile, tile[::-1]], axis=0)
H, W = filled.shape[:2]
back = np.tile(tile, (H // tile.shape[0] + 1, W // tile.shape[1] + 1, 1))[:H, :W]
back = np.clip(prof[:, None, :] + back, 0, 255).astype(np.uint8)
s = min(1.0, 2048 / max(H, W))
if s < 1:
    filled, back = (cv2.resize(a, (int(W * s), int(H * s)), interpolation=cv2.INTER_AREA) for a in (filled, back))
cv2.imwrite(os.path.join(out, 'front.png'), filled)
cv2.imwrite(os.path.join(out, 'back.png'), back)
cv2.imwrite(os.path.join(out, 'mask.png'), mask * 255)
print(pid, 'colore medio tessuto (RGB):', patch.reshape(-1, 3)[:, ::-1].mean(0).round(1), 'texture:', filled.shape[:2])
