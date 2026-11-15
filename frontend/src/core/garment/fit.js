// Logica di fitting PURA (nessuna dipendenza da Three.js): risolve le misure del capo e produce il report di vestibilita'.
//
// Le misure del CAPO arrivano dall'e-commerce (contratto v1, taglia per taglia). Le misure del CORPO sono quelle dell'utente.
// Ogni misura del capo ha una provenienza (`origin`):
//   "prodotto"  -> fornita dal negozio per questa taglia
//   "derivato"  -> ricavata dai dati del negozio con una regola dichiarata (es. manica dal centro schiena -> dalla spalla)
//   "template"  -> default del template: il negozio NON l'ha fornita
// Le misure mancanti non vengono mai presentate come dati del negozio.

const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export const ORIGIN_LABEL = { prodotto: "negozio", derivato: "derivato", template: "template" };

/**
 * Misure del capo per una taglia normalizzata (vedi contract.normalizeProduct).
 * @returns {{ measures: Object<string,{value:number,origin:string,note?:string}>, missing: string[], notes: string[] }}
 *   chiavi: chest, hem, waist (giri), length (dall'HPS), sleeve (dalla spalla), sleeveOpening, bicep, shoulder
 */
export function resolveGarment({ template, size, body }) {
  const M = {};
  const notes = [];
  const set = (k, value, origin, note) => { if (isNum(value)) M[k] = { value, origin, ...(note ? { note } : {}) }; };
  const g = size?.garment || {};
  const n = size?.notes || {};

  set("chest", g.chest, "prodotto", n.chest);
  set("waist", g.waist, "prodotto", n.waist);
  set("hem", g.hem, "prodotto", n.hem);
  set("length", g.length, "prodotto");
  set("shoulder", g.shoulder, "prodotto");
  set("bicep", g.bicep, "prodotto");
  set("sleeveOpening", g.sleeveOpening, "prodotto");
  if (isNum(g.sleeve)) {
    if (g.sleeveFrom === "centerBack") {                          // manica misurata dal centro schiena -> dalla spalla
      const sh = M.shoulder?.value ?? template.shoulderWidth;
      set("sleeve", g.sleeve - sh / 2, "derivato",
        `manica dal centro schiena (${g.sleeve} cm) convertita sottraendo mezza spalla (${(sh / 2).toFixed(1)} cm${M.shoulder ? "" : ", valore del template"})`);
    } else {
      set("sleeve", g.sleeve, "prodotto");
    }
  }
  if (!M.chest) {                                                 // il contratto lo impone; difesa per dati non validati
    set("chest", body.chest + template.chestEase, "template", `nessun dato: torace del corpo + ease del template (${template.chestEase} cm)`);
    notes.push("Il negozio non ha fornito il torace del capo: uso il default del template.");
  }
  const all = ["chest", "waist", "hem", "length", "sleeve", "sleeveOpening", "bicep", "shoulder"];
  return { measures: M, missing: all.filter((k) => !M[k]), notes };
}

/**
 * Taglia consigliata per il corpo attuale, con la ragione. Considera solo le taglie disponibili.
 *  - se le taglie hanno `bodyFit` (per quali misure corpo sono pensate) si usa quello;
 *  - altrimenti si sceglie l'ease al torace piu' vicino a quello del template, senza andare sotto zero.
 */
export function recommendSize(sizes, template, body) {
  const pool = (sizes || []).filter((s) => s.available);
  if (!pool.length || !template) return null;
  if (pool.some((s) => s.bodyFit)) {
    let best = null;
    for (const s of pool) {
      if (!s.bodyFit) continue;
      let dist = 0;
      for (const [field, val] of [["chest", body.chest], ["waist", body.waist], ["hips", body.hips], ["height", body.height]]) {
        const r = s.bodyFit[field];
        if (!r) continue;
        dist += val < r[0] ? r[0] - val : val > r[1] ? val - r[1] : 0;
      }
      if (!best || dist < best.dist) best = { label: s.label, dist };
    }
    if (best) {
      return { label: best.label, tooSmall: false,
        reason: best.dist === 0 ? "le tue misure rientrano in quelle previste dal negozio per questa taglia" : `la taglia piu' vicina alle tue misure (scarto ${best.dist.toFixed(0)} cm)` };
    }
  }
  let best = null;
  for (const s of pool) {
    const c = s.garment.chest;
    if (!isNum(c)) continue;
    const ease = c - body.chest;
    const score = ease < 0 ? 1000 - ease : Math.abs(ease - template.chestEase);
    if (!best || score < best.score) best = { label: s.label, score, ease };
  }
  if (!best) return null;
  return {
    label: best.label, tooSmall: best.ease < 0,
    reason: best.ease < 0
      ? `nessuna taglia è abbastanza grande: anche questa sarebbe stretta di ${(-best.ease).toFixed(0)} cm al torace`
      : `ease al torace +${best.ease.toFixed(0)} cm, obiettivo ${template.chestEase} cm`,
  };
}

// -- Vestibilita' -------------------------------------------------------------
export const VERDICTS = ["stretto", "aderente", "regular", "morbido", "oversize"];

/** Giudizio dell'ease (cm di circonferenza) secondo le soglie del template. */
export function easeVerdict(easeCm, template) {
  const t = template.verdicts;
  const i = easeCm < t[0] ? 0 : easeCm < t[1] ? 1 : easeCm < t[2] ? 2 : easeCm < t[3] ? 3 : 4;
  return VERDICTS[i];
}

export function sleeveEndLabel(ratio) {
  if (ratio == null) return null;
  if (ratio < 0.3) return "sopra metà bicipite";
  if (ratio < 0.5) return "a metà braccio";
  if (ratio < 0.62) return "al gomito";
  if (ratio < 0.9) return "sull'avambraccio";
  return "al polso";
}

/**
 * Report di vestibilita' per zona.
 * @param geom  valori misurati sulla mesh dal motore: { gChest, gWaist, gHem, bHem, lengthCm, lengthClamped, lengthRequestedCm,
 *              hemVsHipsCm, sleeveCm, sleeveEndRatio }; per un capo 3D reale anche { fromAsset, pending, tightCm }
 */
export function buildFitReport({ template, resolved, body, geom }) {
  if (!geom) return [];
  const m = resolved.measures;
  const origin = (k) => (m[k] ? m[k].origin : "template");
  const rows = [];
  const circ = (id, label, garment, bodyCm, org, note, judge = true) => {
    if (!isNum(garment) || !isNum(bodyCm)) return;
    const ease = garment - bodyCm;
    rows.push({ id, label, garmentCm: garment, bodyCm, easeCm: ease, verdict: judge ? easeVerdict(ease, template) : null, origin: org, note });
  };
  // capo 3D reale: i giri sono misurati sulla mesh dell'asset (non copiati dal negozio); se differiscono dal dato del negozio lo si dice
  const meshNote = (k, v) => {
    if (!geom.fromAsset || geom.pending || !isNum(v)) return null;
    const shop = m[k]?.value;
    return isNum(shop) && Math.abs(shop - v) > 0.5 ? `misurato sulla mesh 3D del capo (il negozio dichiara ${shop.toFixed(1)} cm)` : "misurato sulla mesh 3D del capo";
  };
  circ("chest", "Torace", geom.gChest, body.chest, origin("chest"), meshNote("chest", geom.gChest) || m.chest?.note);
  // se il negozio non da' la vita, e' interpolata tra torace e orlo: si mostra la differenza ma senza giudizio
  circ("waist", "Vita", geom.gWaist, body.waist, m.waist ? "prodotto" : "derivato", m.waist ? m.waist.note : "interpolata tra torace e orlo", !!m.waist);
  if (geom.fromAsset && !m.hem) circ("hem", "Orlo", geom.gHem, geom.bHem, "derivato", meshNote("hem", geom.gHem));
  else circ("hem", "Orlo", geom.gHem, geom.bHem, m.hem ? m.hem.origin : "template",
    m.hem ? m.hem.note : template.hemRatio ? "orlo = torace (taglio dritto del template)" : `corpo all'orlo + ease ${template.hemBodyEase} cm (template)`);
  if (isNum(geom.lengthCm)) {
    const rel = geom.hemVsHipsCm;
    const where = rel == null ? "" : Math.abs(rel) < 3 ? "arriva ai fianchi" : rel > 0 ? `${rel.toFixed(0)} cm sopra la linea dei fianchi` : `${(-rel).toFixed(0)} cm sotto la linea dei fianchi`;
    const shown = geom.lengthClamped && isNum(geom.lengthRequestedCm) ? geom.lengthRequestedCm : geom.lengthCm;
    rows.push({ id: "length", label: "Lunghezza", garmentCm: shown, text: where, origin: origin("length"),
      warn: geom.lengthClamped ? `Lunghezza dichiarata ${shown.toFixed(0)} cm, ma l'orlo è fermato all'altezza dell'inguine (rappresentati ${geom.lengthCm.toFixed(0)} cm).` : null });
  }
  if (isNum(geom.sleeveCm)) {
    rows.push({ id: "sleeve", label: "Manica", garmentCm: geom.sleeveCm, text: sleeveEndLabel(geom.sleeveEndRatio), origin: origin("sleeve"), note: m.sleeve?.note });
  }
  if (geom.fromAsset && isNum(geom.tightCm) && geom.tightCm > 0.5) {
    const chest = rows.find((r) => r.id === "chest");
    if (chest) chest.warn = `Il capo è più stretto del corpo di ${geom.tightCm.toFixed(0)} cm nel punto più critico: nel modello 3D il tessuto è teso sulla pelle.`;
  }
  if (m.shoulder) rows.push({ id: "shoulder", label: "Spalle", garmentCm: m.shoulder.value, text: "dato del negozio (non confrontato: la larghezza spalle del corpo non è tra le misure calibrate)", origin: m.shoulder.origin });
  return rows;
}

/** Riepilogo compatto per l'e-commerce (evento `fit` dell'SDK): niente dati del corpo, solo l'esito della vestibilita'. */
export function summarizeFit(report) {
  const zones = {};
  for (const r of report) {
    if (r.easeCm !== undefined && r.verdict) zones[r.id] = { easeCm: Math.round(r.easeCm * 10) / 10, verdict: r.verdict };
  }
  return zones;
}
