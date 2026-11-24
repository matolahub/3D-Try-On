// Live Body Scan – geometria di misura. Funzioni pure (nessun DOM): ricevono la maschera della silhouette e i landmark
// di un fotogramma e restituiscono larghezze in cm; poi aggregano molti fotogrammi in misure con incertezza.
//
// Cosa si ricava e come (vedi anche il report in docs/live-body-scan.md):
//   DIRETTO    altezza (la inserisce l'utente: e' la scala cm/pixel), larghezze di petto/vita/fianchi (vista frontale),
//              profondita' di petto/vita/fianchi (vista laterale), distanza tra le spalle.
//   STIMATO    circonferenze = k * perimetro dell'ellisse (larghezza, profondita'); k misurato sulla mesh calibrata
//              (blender/scripts/scan_shape_priors.py -> shapePriors.json). Il petto si legge a quote diverse di fronte e di lato.
//   ASSUNTO    senza vista laterale la profondita' e' r * larghezza, con r medio della mesh: e' un'ipotesi sulla forma del
//              corpo, quindi l'incertezza dichiarata e' piu' alta.
//
// I livelli (frazione dell'altezza dal pavimento) sono gli stessi con cui e' calibrato il modello 3D (bodyspec.LEVEL):
// misurare l'utente dove il modello misura se stesso rende coerente il passaggio misura -> morph.

import priors from "./shapePriors.json" with { type: "json" };

/** Indici dei landmark MediaPipe Pose (33 punti). */
export const LM = {
  nose: 0, lEar: 7, rEar: 8, lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28, lHeel: 29, rHeel: 30, lFoot: 31, rFoot: 32,
};

/**
 * Quote di lettura (frazione dell'altezza dal pavimento) per vista: sono quelle su cui shapePriors.json e' calibrato.
 * Il petto di fronte si legge a 0,72 (sotto le ascelle: piu' in alto il braccio si fonde con il busto nella silhouette),
 * di profilo a 0,75 (la quota del giro petto del modello). Si prende la mediana delle righe valide in una banda stretta.
 */
const HALF = 0.012;
// quote di ripiego per la larghezza frontale del petto (rapporto w(0,70)/w(L) dalla mesh); oltre 0,67 l'errore del rapporto
// supera il 7% (0,655: 11%, 0,64: 14%) e non conviene piu'
const CHEST_FALLBACK = (priors.chestFallback || []).filter((f) => f.level >= 0.67);
export const BANDS = {
  front: { chest: priors.levels.Chest, waist: priors.levels.Waist, hips: priors.levels.Hips },
  side: { chest: priors.sideLevels.Chest, waist: priors.sideLevels.Waist, hips: priors.sideLevels.Hips },
};
const PRIOR_KEY = { chest: "Chest", waist: "Waist", hips: "Hips" };
export const CIRC_FIELDS = ["chest", "waist", "hips"];

const THR = 0.5;
/**
 * Eccesso del bordo della maschera di MediaPipe, in pixel per lato. La maschera nasce a bassa risoluzione e viene ingrandita:
 * alla soglia 0,5 il contorno "sborda" verso l'esterno. Stimato sul campo (2026-11-24, 5 scansioni con abiti aderenti, metro):
 * ~0,25 cm per lato a ~0,37 cm/px, che azzera l'eccesso medio di +1,7 cm sui giri (petto +0,6, vita -0,6, fianchi +0,3 dopo).
 * Vale solo per le maschere di MediaPipe (vision.js imposta frame.edgeBiasPx); le maschere sintetiche dei test sono esatte.
 */
export const MASK_EDGE_BIAS_PX = 0.7;
export const ANKLE_FRAC = 0.045;     // altezza del landmark caviglia dal pavimento, frazione della statura

/** Perimetro dell'ellisse di semiassi a, b (Ramanujan II, errore < 0,01%). */
export function ellipsePerimeter(a, b) {
  if (a <= 0 || b <= 0) return 0;
  const h = ((a - b) / (a + b)) ** 2;
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

/**
 * Fattore di forma k (giro a nastro / perimetro dell'ellisse larghezza x profondita'), calibrato su misure REALI.
 * La mesh dava 1,13 (petto) e 1,04 (vita, fianchi): la sezione del modello 3D e' piu' "squadrata" di quella di una persona.
 * Prima prova sul campo (2026-11-24, 1 persona, 2 scansioni con abiti aderenti, metro da sarta): k reale 0,96-1,01 su tutte e
 * tre le misure. Si usa 1,0 (il giro e' il perimetro dell'ellisse), non il valore adattato a una sola persona: da rivedere con
 * piu' persone (docs/live-body-scan.md, "Calibrazione sul campo").
 */
export const FIELD_K = { chest: 1.0, waist: 1.0, hips: 1.0 };

/** Circonferenza stimata da larghezza (frontale) e profondita' (laterale, opzionale) in cm. */
export function circumference(field, widthCm, depthCm) {
  const p = priors.priors[PRIOR_KEY[field]];
  const d = Number.isFinite(depthCm) && depthCm > 0 ? depthCm : p.depthRatio * widthCm;
  return (FIELD_K[field] ?? p.k) * ellipsePerimeter(widthCm / 2, d / 2);
}

const at = (mask, w, x, y) => mask[y * w + x];

/**
 * Tratto continuo di silhouette sulla riga y che contiene cx. Bordi a sub-pixel (interpolazione sulla soglia 0,5).
 * Tollera buchi di `gap` pixel (rumore della maschera). Ritorna { l, r } in pixel o null.
 */
export function rowRun(mask, w, h, y, cx, gap = 2) {
  y = Math.round(y); cx = Math.round(cx);
  if (y < 0 || y >= h || cx < 0 || cx >= w || at(mask, w, cx, y) < THR) return null;
  const edge = (dir) => {
    let x = cx, miss = 0, last = cx;
    while (x + dir >= 0 && x + dir < w) {
      x += dir;
      if (at(mask, w, x, y) >= THR) { last = x; miss = 0; } else if (++miss > gap) break;
    }
    // sub-pixel: tra last (>= soglia) e last+dir (< soglia)
    const nx = last + dir;
    if (nx < 0 || nx >= w) return last + dir * 0.5;
    const a = at(mask, w, last, y), b = at(mask, w, nx, y);
    const t = a === b ? 0.5 : Math.min(1, Math.max(0, (a - THR) / (a - b)));
    return last + dir * t;
  };
  return { l: edge(-1), r: edge(1) };
}

/** Riga piu' alta della silhouette (testa) nella colonna intorno a cx; ritorna y sub-pixel o null. */
export function topOfHead(mask, w, h, cx, halfW) {
  const x0 = Math.max(0, Math.round(cx - halfW)), x1 = Math.min(w - 1, Math.round(cx + halfW));
  for (let y = 0; y < h; y++) {
    let n = 0;
    for (let x = x0; x <= x1; x++) if (at(mask, w, x, y) >= THR) n++;
    if (n >= 3) {
      if (y === 0) return 0;
      // sub-pixel sul massimo della colonna
      let best = 0, bx = x0;
      for (let x = x0; x <= x1; x++) { const v = at(mask, w, x, y); if (v > best) { best = v; bx = x; } }
      const above = at(mask, w, bx, y - 1);
      return y - Math.min(1, Math.max(0, (best - THR) / Math.max(1e-6, best - above)));
    }
  }
  return null;
}

/** x della linea del braccio (spalla -> gomito -> polso -> mano) alla quota y, o null se il braccio non arriva a quella quota. */
function armXAt(pts, y) {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y);
    if (y >= lo && y <= hi && hi > lo) return a.x + ((y - a.y) / (b.y - a.y)) * (b.x - a.x);
  }
  return null;
}

function armPolyline(lm, w, h, s, e, wr) {
  const P = (i) => ({ x: lm[i].x * w, y: lm[i].y * h });
  const S = P(s), E = P(e), W = P(wr);
  const hand = { x: W.x + (W.x - E.x) * 0.45, y: W.y + (W.y - E.y) * 0.45 };   // la mano prosegue oltre il polso
  return [S, E, W, hand];
}

// ── Telefono inclinato ───────────────────────────────────────────────────────
// Appoggiato a un mobile o a un oggetto, il telefono e' spesso inclinato indietro di 10-25°: la fotocamera guarda in alto e la
// persona appare in prospettiva (la parte alta piu' lontana dal sensore, quindi rimpicciolita). Una rotazione della fotocamera
// si annulla ESATTAMENTE con un'omografia (non dipende dalla distanza ne' dalla scena): conoscendo l'inclinazione (sensori) e la
// lunghezza focale, ogni riga dell'immagine inclinata corrisponde a una riga dell'immagine "dritta", con una scala orizzontale
// propria. La rotazione e' attorno all'asse orizzontale dell'immagine, quindi le righe restano righe.

/** Campo visivo tipico della fotocamera frontale lungo il lato lungo dell'immagine (gradi). */
export const DEFAULT_FOV_LONG = 66;
export const TILT_MAX = 30;            // oltre, la correzione dipende troppo dalla focale stimata: si chiede di raddrizzare

export function defaultFocalPx(w, h) {
  return Math.max(w, h) / 2 / Math.tan(((DEFAULT_FOV_LONG / 2) * Math.PI) / 180);
}

/**
 * Corrispondenza tra immagine inclinata e immagine dritta.
 * @param pitchDeg inclinazione dell'asse della fotocamera: > 0 = guarda in alto (telefono inclinato indietro)
 * @returns { up(y) -> y dritta, down(yDritta) -> y, rowScale(y) -> fattore per le larghezze sulla riga y }
 */
export function tiltMap(pitchDeg, focalPx, h) {
  if (!pitchDeg || !focalPx) return { up: (y) => y, down: (y) => y, rowScale: () => 1 };
  const t = (pitchDeg * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t), f = focalPx, c0 = h / 2;
  return {
    up: (y) => { const v = y - c0; return c0 + (f * (v * c - f * s)) / (v * s + f * c); },
    down: (y) => { const v = y - c0; return c0 + (f * (v * c + f * s)) / (-v * s + f * c); },
    rowScale: (y) => f / ((y - c0) * s + f * c),
  };
}

/**
 * Analizza la silhouette di un fotogramma.
 * @param frame { w, h, mask: Float32Array, lm: [{x,y,z,visibility}] normalizzati, pitchDeg?, focalPx? }
 * @param heightCm altezza dichiarata dall'utente
 * @param view "front" | "side"
 * @returns { ok, reason?, topY, bottomY, pxHeight, cmPerPx, widths: { chest, waist, hips } (cm, null se non valida), armMerged: {...},
 *            shoulderCm, centerX }
 */
export function analyzeSilhouette(frame, heightCm, view = "front") {
  const { w, h, mask, lm } = frame;
  const P = (i) => ({ x: lm[i].x * w, y: lm[i].y * h });
  const sh = [P(LM.lShoulder), P(LM.rShoulder)], hp = [P(LM.lHip), P(LM.rHip)];
  const cx = (sh[0].x + sh[1].x + hp[0].x + hp[1].x) / 4;
  const shoulderSpan = Math.hypot(sh[0].x - sh[1].x, sh[0].y - sh[1].y);
  const torsoLen = Math.abs((hp[0].y + hp[1].y) / 2 - (sh[0].y + sh[1].y) / 2);
  // centro della testa: media di naso e orecchie (di profilo il naso sporge in avanti)
  const headX = (P(LM.nose).x + P(LM.lEar).x + P(LM.rEar).x) / 3;
  const top = topOfHead(mask, w, h, headX, Math.max(4, torsoLen * 0.22));
  if (top === null) return { ok: false, reason: "silhouette" };
  // Pavimento: NON il bordo inferiore della silhouette. La fotocamera sta piu' in alto del pavimento, quindi cio' che e' piu'
  // vicino appare piu' in basso: di fronte le punte dei piedi, di profilo il piede piu' vicino (misurato sul corpo 3D: +5% di
  // scala tra le due viste). La media delle due caviglie sta invece alla profondita' del corpo; il pavimento e' sotto di loro
  // di ANKLE_FRAC dell'altezza (malleolo ~0,04-0,045 H). Niente ombre, niente scarpe/calze che si confondono con il pavimento.
  const ankleY = (P(LM.lAnkle).y + P(LM.rAnkle).y) / 2;
  // Scala e quote si calcolano nell'immagine "dritta" (U); la maschera si legge nell'immagine vera.
  const T = tiltMap(frame.pitchDeg, frame.focalPx ?? defaultFocalPx(w, h), h);
  const topU = T.up(top), pxHeightU = (T.up(ankleY) - topU) / (1 - ANKLE_FRAC), bottomU = topU + pxHeightU;
  const bottomY = T.down(bottomU), pxHeight = bottomY - top;     // nell'immagine vera (inquadratura, rapporti)
  if (pxHeight < h * 0.25 || !(pxHeightU > 0)) return { ok: false, reason: "small" };
  const cmPerPx = heightCm / pxHeightU;                           // cm per pixel dell'immagine dritta
  const rowAt = (level) => T.down(bottomU - level * pxHeightU);    // riga dell'immagine vera a una quota del corpo
  const edgeBias = frame.edgeBiasPx ?? 0;

  const arms = [armPolyline(lm, w, h, LM.lShoulder, LM.lElbow, LM.lWrist), armPolyline(lm, w, h, LM.rShoulder, LM.rElbow, LM.rWrist)];
  // di profilo il braccio dietro al corpo e' nascosto: MediaPipe lo stima male e non tocca la silhouette, quindi non si usa
  const armVisible = [[LM.lElbow, LM.lWrist], [LM.rElbow, LM.rWrist]].map((ids) => Math.min(...ids.map((i) => lm[i].visibility ?? 1)) >= 0.6);
  const armHalfPx = 5.5 / cmPerPx;                          // semi-spessore del braccio (~11 cm con la mano)

  // Di profilo le braccia vanno tese in avanti all'altezza delle spalle: lungo i fianchi coprono (e allargano) la profondita'
  // di vita e fianchi. Si verifica che i polsi siano lontani dal busto e non molto piu' bassi delle spalle (tollerato un
  // braccio che scende un po': tenerle tese stanca). Non blocca la misura: ogni zona coperta da un braccio si scarta da se'.
  const hipX = (hp[0].x + hp[1].x) / 2, shY = (sh[0].y + sh[1].y) / 2;
  // Il braccio dalla parte opposta e' nascosto dal corpo e MediaPipe lo stima male: conta solo se ben visibile.
  const wristVis = [lm[LM.lWrist].visibility ?? 1, lm[LM.rWrist].visibility ?? 1];
  const fwd = arms.map((a) => Math.abs(a[2].x - hipX) * cmPerPx > 25 && (a[2].y - shY) / pxHeight < 0.15);
  const best = wristVis[0] >= wristVis[1] ? 0 : 1;
  const armsForward = fwd[best] && (wristVis[1 - best] < 0.8 || fwd[1 - best]);
  /** Larghezza alla quota `level` (frazione di H): { px, row } se la banda e' leggibile, { merged } se un braccio la copre. */
  const readBand = (level) => {
    const y0 = rowAt(level + HALF), y1 = rowAt(level - HALF), yH = (y1 - y0) / 2;
    const cands = [];
    let anyMerged = false;
    for (let y = Math.round(y0); y <= Math.round(y1); y++) {
      // media su 3 righe: meno rumore della maschera
      const runs = [-1, 0, 1].map((d) => rowRun(mask, w, h, y + d, cx)).filter(Boolean);
      if (runs.length < 2) continue;
      const l = runs.reduce((s, r) => s + r.l, 0) / runs.length, r = runs.reduce((s, q) => s + q.r, 0) / runs.length;
      // braccio che tocca il bordo del busto -> riga non valida
      let touch = false;
      for (let ai = 0; ai < arms.length; ai++) {
        const arm = arms[ai];
        // braccio nascosto dietro al corpo: ignorato solo se le braccia sono in avanti (altrimenti si resta prudenti)
        if (view !== "front" && armsForward && !armVisible[ai]) continue;
        const ax = armXAt(arm, y);
        if (ax === null) continue;
        if (view === "front") {
          // di fronte: braccio unito al busto = il tratto continuo di silhouette arriva fino alla linea centrale del braccio.
          // Se tra busto e braccio c'e' una fessura di sfondo, il tratto si ferma al bordo del busto e la riga e' buona.
          // Tolleranza per l'imprecisione dei landmark: un quarto del semi-spessore del braccio.
          const dArm = Math.abs(ax - cx), dEdge = ax < cx ? cx - l : r - cx;
          if (dEdge > dArm - armHalfPx * 0.25) touch = true;
        } else if (ax > l - armHalfPx && ax < r + armHalfPx) {
          // di profilo: un braccio che attraversa la riga dentro (o a ridosso del) busto ne altera la profondita'
          touch = true;
        }
      }
      if (touch) { anyMerged = true; continue; }
      cands.push({ y, l, r, px: r - l });
    }
    // banda illeggibile perche' un braccio la attraversa (anche solo in parte) = braccio unito: si segnala, non si ignora
    if (cands.length < Math.max(2, (2 * yH) * 0.3)) return { merged: anyMerged };
    const best = [...cands].sort((a, b) => a.px - b.px)[cands.length >> 1];          // riga mediana: robusta a righe rumorose
    return { px: Math.max(0, best.px - 2 * edgeBias) * T.rowScale(best.y), row: { y: best.y, l: best.l, r: best.r } };
  };

  const widths = {}, rows = {}, merged = {};
  let chestLevel = null, chestRelStd = 0;
  for (const [field, level] of Object.entries(BANDS[view === "side" ? "side" : "front"])) {
    let b = readBand(level);
    if (view === "front" && field === "chest" && b.px === undefined) {
      // Il braccio copre la quota del petto (succede con braccia poco aperte, maniche, tessuto dell'ascella): si legge la
      // larghezza poco piu' in basso e la si riporta a 0,70 con il rapporto misurato sulla mesh, pagando piu' incertezza.
      for (const fb of CHEST_FALLBACK) {
        const c = readBand(fb.level);
        if (c.px !== undefined) { b = { px: c.px * fb.ratio, row: c.row }; chestLevel = fb.level; chestRelStd = fb.ratioStd; break; }
      }
    }
    merged[field] = b.px === undefined && !!b.merged;
    if (b.px === undefined) { widths[field] = null; continue; }
    widths[field] = b.px * cmPerPx;
    rows[field] = b.row;
    if (field === "chest" && view === "front" && chestLevel === null) chestLevel = level;
  }
  // Di profilo, controllo indipendente dai landmark: la profondita' del petto non supera di molto quella 5 cm piu' in basso
  // (sulla mesh il rapporto e' 1,00-1,02). Un salto netto e' un braccio che entra nella banda (braccia cadenti; per prospettiva il
  // braccio lontano appare piu' basso): la lettura si scarta e l'utente viene invitato ad alzare le braccia.
  if (view !== "front" && Number.isFinite(widths.chest)) {
    const yRef = rowAt(BANDS.side.chest - 0.035);
    const refs = [-2, 0, 2].map((d) => rowRun(mask, w, h, yRef + d, cx)).filter(Boolean).map((q) => Math.max(0, q.r - q.l - 2 * edgeBias) * T.rowScale(yRef) * cmPerPx);
    if (refs.length && widths.chest > 1.08 * median(refs)) { widths.chest = null; merged.chest = true; }
  }
  return { ok: true, topY: top, bottomY, pxHeight, cmPerPx, widths, rows, merged, centerX: cx, shoulderPx: shoulderSpan, shoulderCm: shoulderSpan * T.rowScale((sh[0].y + sh[1].y) / 2) * cmPerPx, armsForward, chestLevel, chestRelStd };
}

// ── Aggregazione ─────────────────────────────────────────────────────────────

const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

export function median(a) {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Valore robusto: scarta i valori oltre 3 MAD dalla mediana e prende il quantile `q` (default la mediana) di quelli rimasti.
 * Ritorna { value, spread (deviazione robusta), n, rejected }.
 */
export function robust(values, q = 0.5) {
  const v = values.filter(Number.isFinite);
  if (!v.length) return { value: NaN, spread: NaN, n: 0, rejected: 0 };
  const m = median(v);
  const mad = 1.4826 * median(v.map((x) => Math.abs(x - m)));
  const keep = mad > 0 ? v.filter((x) => Math.abs(x - m) <= 3 * mad) : v;
  const mk = median(keep);
  const sorted = [...keep].sort((a, b) => a - b);
  const value = q === 0.5 ? mk : sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
  return { value, spread: 1.4826 * median(keep.map((x) => Math.abs(x - mk))), n: keep.length, rejected: v.length - keep.length };
}

// Incertezza di metodo (cm, ~1 sigma) sulla circonferenza, due termini indipendenti:
//  - modello geometrico: meta' dell'errore massimo misurato sulla mesh di riferimento (shapePriors: errFrontSideCm / errFrontOnlyCm);
//  - mondo reale (abiti, postura, bordi della segmentazione, corpo diverso dalla mesh): 3% del valore. Prudente e NON ancora
//    misurato su persone: da ricalibrare con il confronto metro vs scansione (docs/live-body-scan.md).
// Con queste regole nessuna misura arriva oggi ad affidabilita' "alta": e' voluto finche' mancano dati reali.
const REAL_WORLD_REL = 0.03;
// Rapporto profondita'/larghezza plausibile per un corpo umano. Fuori da qui la vista laterale e' contaminata (braccia, abiti
// larghi, rotazione incompleta): si scarta e la misura ricade sulla stima dalla sola vista frontale, con incertezza piu' alta.
// Sulla mesh calibrata i rapporti vanno da 0,55 a 0,85; il margine copre corpi reali piu' estremi (es. addome prominente).
export const SIDE_DEPTH_QUANTILE = 0.25;
export const DEPTH_RATIO_RANGE = { chest: [0.5, 0.95], waist: [0.5, 1.05], hips: [0.5, 0.95] };

export function confidenceLabel(uncCm) {
  if (!Number.isFinite(uncCm)) return "bassa";
  return uncCm <= 2.5 ? "alta" : uncCm <= 5 ? "media" : "bassa";
}

/**
 * Misure finali da molte letture.
 * @param front [{ widths: {chest,waist,hips}, shoulderCm, quality }]  letture frontali valide
 * @param side  [{ widths: {chest,waist,hips} }]                       letture laterali (larghezza vista di lato = profondita')
 * @returns { measures: { chest: { value, low, high, uncertainty, confidence, method, widthCm, depthCm } ..., shoulders }, overall }
 */
export function aggregate(front, side, heightCm) {
  const out = {};
  for (const f of CIRC_FIELDS) {
    const W = robust(front.map((r) => r.widths[f]));
    // Profondita': un corpo visto non del tutto di profilo appare SEMPRE piu' profondo del vero (larghezza apparente di una
    // sezione ruotata >= profondita'). Le letture a rotazione incompleta la gonfiano in un solo verso: si usa il 25° percentile.
    // Prova sul campo (2026-11-24): fianchi da ~27,4 a ~25,6 cm mentre la rotazione si completa; mediana +1 cm rispetto alla fine.
    const D = robust(side.map((r) => r.widths[f]), SIDE_DEPTH_QUANTILE);
    if (!Number.isFinite(W.value) || W.n < 5) { out[f] = null; continue; }
    const ratio = D.value / W.value;
    const depthRejected = Number.isFinite(D.value) && D.n >= 5 && (ratio < DEPTH_RATIO_RANGE[f][0] || ratio > DEPTH_RATIO_RANGE[f][1]);
    const hasDepth = Number.isFinite(D.value) && D.n >= 5 && !depthRejected;
    const value = circumference(f, W.value, hasDepth ? D.value : undefined);
    // propagazione: dC/dW ~ C/(W+D) * ... approssimata con la sensibilita' numerica
    const dW = circumference(f, W.value + 1, hasDepth ? D.value : undefined) - value;
    const dD = hasDepth ? circumference(f, W.value, D.value + 1) - value : 0;
    const stat = Math.hypot(dW * W.spread, dD * (hasDepth ? D.spread : 0));
    // petto letto a una quota di ripiego in parte dei fotogrammi: incertezza del rapporto di conversione, pesata per la quota
    const relStd = f === "chest" ? front.reduce((acc, r) => acc + (Number.isFinite(r.widths.chest) ? r.chestRelStd || 0 : 0), 0) / Math.max(1, W.n) : 0;
    const conv = dW * W.value * relStd;
    const p = priors.priors[PRIOR_KEY[f]];
    const method = Math.hypot((hasDepth ? p.errFrontSideCm : p.errFrontOnlyCm) / 2, value * REAL_WORLD_REL);
    // telefono inclinato: la correzione e' esatta se la focale e' giusta; la focale della fotocamera frontale e' stimata
    // (DEFAULT_FOV_LONG), e un errore del 10% sulla focale vale circa 4,2e-5 * gradi^2 sulla larghezza (sintetico: 0,4% a 10°,
    // 1,7% a 20°, 3,8% a 30°)
    const p2 = mean([...front, ...(hasDepth ? side : [])].map((r) => (Number.isFinite(r.pitch) ? r.pitch ** 2 : 0)));
    const tilt = value * 4.2e-5 * p2;
    const unc = Math.hypot(stat, method, conv, tilt);
    out[f] = {
      value, uncertainty: unc, low: value - unc, high: value + unc, confidence: confidenceLabel(unc),
      method: hasDepth ? "front+side" : "front", widthCm: W.value, depthCm: hasDepth ? D.value : null, frames: W.n + (hasDepth ? D.n : 0), depthRejected, fallbackShare: f === "chest" ? +(front.filter((r) => r.chestRelStd > 0).length / Math.max(1, W.n)).toFixed(2) : 0,
    };
  }
  const S = robust(front.map((r) => r.shoulderCm));
  // distanza tra i centri delle articolazioni delle spalle: non e' la "larghezza spalle" del sarto (da acromion ad acromion)
  out.shoulders = Number.isFinite(S.value) ? { value: S.value, uncertainty: Math.hypot(S.spread, 2.5), confidence: "bassa", method: "landmark" } : null;
  out.height = { value: heightCm, uncertainty: 0, confidence: "dichiarata", method: "user" };
  const circ = CIRC_FIELDS.map((f) => out[f]).filter(Boolean);
  const worst = circ.length === CIRC_FIELDS.length ? Math.max(...circ.map((m) => m.uncertainty)) : Infinity;
  return { measures: out, overall: { confidence: confidenceLabel(worst), complete: circ.length === CIRC_FIELDS.length, sideView: side.length >= 5 } };
}
