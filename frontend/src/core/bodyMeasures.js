// Misure del CORPO dell'utente (body measurements) e loro conversione in shape key del modello 3D.
//
// La calibrazione (misura di partenza, range, curva cm -> influence) NON e' scritta a mano: viene misurata sulla mesh da
// blender/scripts/build_shape_keys.py e salvata in bodyCalibration.json. Per verificarla: blender/scripts/measure_body.py.
// Questo modulo si limita a leggerla: la logica e' quella storica, spostata qui dal componente React.
//
//   chest  -> Chest   circonferenza torace   (a nastro, a 0.75 dell'altezza)
//   waist  -> Waist   circonferenza vita     (a 0.635 dell'altezza)
//   hips   -> Hips    circonferenza fianchi  (a 0.52 dell'altezza)
//   height -> Altezza statura
//
// I morph target valgono in entrambi i versi: influence negativa restringe / accorcia.

import calibration from "../bodyCalibration.json";

/** Campo del contratto -> nome dello shape key nel GLB. */
export const FIELD_TO_MORPH = { chest: "Chest", waist: "Waist", hips: "Hips", height: "Altezza" };
export const BODY_FIELDS = Object.keys(FIELD_TO_MORPH);

export const BODY_KEYS = [
  { field: "chest",  morphName: "Chest",   label: "Petto"   },
  { field: "waist",  morphName: "Waist",   label: "Vita"    },
  { field: "hips",   morphName: "Hips",    label: "Fianchi" },
  { field: "height", morphName: "Altezza", label: "Altezza" },
].map((k) => {
  const c = calibration[k.morphName];
  return {
    ...k,
    unit: "cm",
    step: 1,
    min: c.min,
    max: c.max,
    neutral: c.neutral,               // misura reale del corpo base (influence = 0)
    curve: c.curve,                   // [[cm, influence], ...] misurata sulla mesh
    initial: Math.round(c.neutral),   // valore di partenza
  };
});

/** Misure di partenza (corpo base calibrato). */
export function defaultBody() {
  return Object.fromEntries(BODY_KEYS.map((k) => [k.field, k.initial]));
}

/** Porta ogni misura dentro il range supportato; i valori non numerici tornano al default. */
export function clampBody(body = {}) {
  const out = {};
  for (const k of BODY_KEYS) {
    const v = Number(body[k.field]);
    out[k.field] = Number.isFinite(v) ? Math.max(k.min, Math.min(k.max, v)) : k.initial;
  }
  return out;
}

/** Converte una misura reale in cm nell'influence del morph target (interpolazione sulla curva misurata). */
export function cmToMorphInfluence(key, cm) {
  const pts = key.curve;
  const x = Math.max(key.min, Math.min(key.max, cm));
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return pts[pts.length - 1][1];
}

/** { chest, waist, hips, height } in cm -> { Chest, Waist, Hips, Altezza } influence. */
export function bodyToInfluences(body) {
  const b = clampBody(body);
  return Object.fromEntries(BODY_KEYS.map((k) => [k.morphName, cmToMorphInfluence(k, b[k.field])]));
}
