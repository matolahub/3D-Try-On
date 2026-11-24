// Figura sintetica per i test del Live Body Scan: una silhouette con misure NOTE (larghezze e profondita' in cm ai
// livelli di petto/vita/fianchi) e landmark coerenti, resa come maschera a bordi sfumati (come quella di MediaPipe).
// Non e' un corpo realistico: serve a verificare che la geometria di misura ritrovi esattamente cio' che e' stato disegnato.

import { ANKLE_FRAC, BANDS, LM, defaultFocalPx, tiltMap } from "./measure.js";

/**
 * @param o { heightCm=175, w=360, h=640, fill=0.8 (frazione verticale occupata), cx=0.5,
 *            widths {chest,waist,hips} cm, depths {chest,waist,hips} cm, yawDeg=0, armDeg=35, poses=1, jitterPx=0 }
 */
export function syntheticFrame(o = {}) {
  const H = o.heightCm ?? 175, w = o.w ?? 360, h = o.h ?? 640, fill = o.fill ?? 0.8;
  const yaw = ((o.yawDeg ?? 0) * Math.PI) / 180, armDeg = o.armDeg ?? 35;
  const W = { chest: 34, waist: 30, hips: 36, ...o.widths }, D = { chest: 25, waist: 22, hips: 24, ...o.depths };
  const pxPerCm = (fill * h) / H, footY = h * (0.5 + fill / 2), cx = (o.cx ?? 0.5) * w;
  const j = o.jitterPx ?? 0;
  const Y = (frac) => footY - frac * H * pxPerCm;                 // frazione dell'altezza -> riga
  // larghezza apparente di una sezione ellittica ruotata di yaw: 2*sqrt((W/2 cos)^2 + (D/2 sin)^2)
  const appear = (k) => Math.sqrt((W[k] * Math.cos(yaw)) ** 2 + (D[k] * Math.sin(yaw)) ** 2);
  const lv = { ...BANDS.front };
  const knots = [[0.47, appear("hips") * 0.92], [lv.hips, appear("hips")], [lv.waist, appear("waist")], [lv.chest, appear("chest")], [0.81, appear("chest")]];
  const torsoHalf = (f) => {
    // larghezza piatta per +-0,03 intorno ai livelli (cosi' le bande di ricerca leggono il valore esatto)
    if (f >= BANDS.front.chest - 0.03 && f <= BANDS.side.chest + 0.03) return (appear("chest") / 2) * pxPerCm;
    for (const [k, c] of Object.entries(lv)) if (Math.abs(f - c) <= 0.03) return (appear(k) / 2) * pxPerCm;
    for (let i = 1; i < knots.length; i++) if (f <= knots[i][0]) {
      const [f0, a] = knots[i - 1], [f1, b] = knots[i];
      return ((a + ((f - f0) / (f1 - f0)) * (b - a)) / 2) * pxPerCm;
    }
    return null;
  };
  const shoulderHalfCm = 19 * Math.abs(Math.cos(yaw)) + 3;
  const P = (fx, fy, v = 0.99) => ({ x: (fx + (j ? (Math.random() - 0.5) * j : 0)) / w, y: fy / h, z: 0, visibility: v });
  const shY = Y(0.818), hipY = Y(0.53);
  const armLen = 55 * pxPerCm, a = (armDeg * Math.PI) / 180;
  const sideArm = Math.cos(yaw);                                  // di profilo le braccia si sovrappongono al busto
  const shL = cx + shoulderHalfCm * pxPerCm, shR = cx - shoulderHalfCm * pxPerCm;
  // di profilo (yaw >= 60) le braccia sono tese in avanti all'altezza delle spalle, come chiede la scansione
  const forward = Math.abs(o.yawDeg ?? 0) >= 60 && o.armsForward !== false;
  const elbow = (sx, s) => forward ? [cx + armLen * 0.5, shY + 2] : [sx + s * Math.sin(a) * armLen * 0.5 * sideArm, shY + Math.cos(a) * armLen * 0.5];
  const wrist = (sx, s) => forward ? [cx + armLen, shY + 4] : [sx + s * Math.sin(a) * armLen * sideArm, shY + Math.cos(a) * armLen];
  const lm = new Array(33).fill(null).map(() => P(cx, Y(0.5), 0.99));
  lm[LM.nose] = P(cx, Y(0.94)); lm[LM.lEar] = P(cx + 7 * pxPerCm * Math.cos(yaw), Y(0.935)); lm[LM.rEar] = P(cx - 7 * pxPerCm * Math.cos(yaw), Y(0.935));
  lm[LM.lShoulder] = P(shL, shY); lm[LM.rShoulder] = P(shR, shY);
  lm[LM.lElbow] = P(...elbow(shL, 1)); lm[LM.rElbow] = P(...elbow(shR, -1));
  lm[LM.lWrist] = P(...wrist(shL, 1)); lm[LM.rWrist] = P(...wrist(shR, -1));
  const hipHalf = 9 * pxPerCm * Math.abs(Math.cos(yaw)) + 2;
  lm[LM.lHip] = P(cx + hipHalf, hipY); lm[LM.rHip] = P(cx - hipHalf, hipY);
  lm[LM.lKnee] = P(cx + hipHalf, Y(0.285)); lm[LM.rKnee] = P(cx - hipHalf, Y(0.285));
  lm[LM.lAnkle] = P(cx + hipHalf, Y(ANKLE_FRAC)); lm[LM.rAnkle] = P(cx - hipHalf, Y(ANKLE_FRAC));
  lm[LM.lHeel] = P(cx + hipHalf, Y(0.015)); lm[LM.rHeel] = P(cx - hipHalf, Y(0.015));
  lm[LM.lFoot] = P(cx + hipHalf, Y(0.005)); lm[LM.rFoot] = P(cx - hipHalf, Y(0.005));

  // maschera: bordi lineari su 1,5 px, come una segmentazione morbida
  const mask = new Float32Array(w * h);
  const soft = (d) => Math.max(0, Math.min(1, 0.5 + d / 1.5));
  const armSeg = [[shL, shY, ...wrist(shL, 1)], [shR, shY, ...wrist(shR, -1)]];
  const armHalfPx = 4.5 * pxPerCm;
  const headR = 0.065 * H * pxPerCm, headCy = Y(1) + headR * 1.25;
  for (let y = 0; y < h; y++) {
    const f = (footY - y) / (H * pxPerCm);
    if (f < -0.002 || f > 1.002) continue;
    const th = f >= 0.47 && f <= 0.81 ? torsoHalf(f) : null;
    for (let x = 0; x < w; x++) {
      let v = 0;
      if (th !== null) v = Math.max(v, soft(th - Math.abs(x - cx)));
      if (f > 0.81 && f < 0.86) v = Math.max(v, soft(shoulderHalfCm * pxPerCm + 3 - Math.abs(x - cx)));
      if (f >= 0.86) {                                                   // collo + testa (ellisse)
        const dy = (y - headCy) / (headR * 1.25), dx = (x - cx) / headR;
        v = Math.max(v, soft((1 - Math.hypot(dx, dy)) * headR), soft(6 * pxPerCm - Math.abs(x - cx)) * (f < 0.88 ? 1 : 0));
      }
      if (f >= 0 && f < 0.47) {                                          // gambe, con spazio tra le gambe sotto l'inguine
        const legHalf = 7 * pxPerCm * (f > 0.3 ? 1.15 : 1);
        v = Math.max(v, soft(legHalf - Math.abs(x - (cx + hipHalf))), soft(legHalf - Math.abs(x - (cx - hipHalf))));
      }
      for (const [x0, y0, x1, y1] of armSeg) {                           // braccia: segmenti spessi
        const vx = x1 - x0, vy = y1 - y0, t = Math.max(0, Math.min(1, ((x - x0) * vx + (y - y0) * vy) / (vx * vx + vy * vy)));
        v = Math.max(v, soft(armHalfPx - Math.hypot(x - (x0 + t * vx), y - (y0 + t * vy))));
      }
      mask[y * w + x] = v;
    }
  }
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const wl = (dx, dy) => ({ x: dx * c, y: dy, z: -dx * s, visibility: 0.99 });   // landmark 3D (m): busto ruotato di yaw
  const world = lm.map(() => wl(0, 0));
  world[LM.lShoulder] = wl(0.19, -0.5); world[LM.rShoulder] = wl(-0.19, -0.5);
  world[LM.lHip] = wl(0.09, 0); world[LM.rHip] = wl(-0.09, 0);
  const frame = { t: o.t ?? 0, w, h, poses: o.poses ?? 1, lm, world, mask, luma: o.luma ?? 120, maskSoft: 0.05, truth: { W, D, pxPerCm } };
  return o.pitchDeg ? tiltFrame(frame, o.pitchDeg, o.focalPx ?? defaultFocalPx(w, h)) : frame;
}

/**
 * La stessa scena ripresa con il telefono inclinato di pitchDeg (> 0 = fotocamera verso l'alto): prospettiva vera, ottenuta
 * con l'omografia di rotazione (per ogni pixel inclinato si legge il punto corrispondente dell'immagine dritta).
 */
export function tiltFrame(frame, pitchDeg, focalPx) {
  const { w, h, mask } = frame;
  const T = tiltMap(pitchDeg, focalPx, h), cx0 = w / 2;
  const out = new Float32Array(w * h);
  const at = (x, y) => (x < 0 || y < 0 || x >= w - 1 || y >= h - 1 ? 0 : mask[Math.floor(y) * w + Math.floor(x)]);
  for (let y = 0; y < h; y++) {
    const yU = T.up(y), k = T.rowScale(y);
    for (let x = 0; x < w; x++) {
      const xU = cx0 + (x - cx0) * k;
      // bilineare: bordi sfumati come nella maschera originale
      const x0 = Math.floor(xU), y0 = Math.floor(yU), fx = xU - x0, fy = yU - y0;
      out[y * w + x] = (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
    }
  }
  const lm = frame.lm.map((p) => {
    const y = T.down(p.y * h);
    return { ...p, x: (cx0 + (p.x * w - cx0) / T.rowScale(y)) / w, y: y / h };
  });
  return { ...frame, mask: out, lm, pitchDeg, focalPx };
}
