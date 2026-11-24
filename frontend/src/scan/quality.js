// Live Body Scan – qualita' del singolo fotogramma. Funzioni pure.
// Ogni controllo produce un codice; i codici hanno una priorita' (si dice all'utente una cosa sola alla volta: la piu' importante).

import { LM, TILT_MAX } from "./measure.js";

/** Messaggi brevi, pensati per essere letti ad alta voce. */
export const CUES = {
  tilt: "Il telefono è troppo inclinato: raddrizzalo un po'.",
  dark: "C'è poca luce. Accendi una luce davanti a te.",
  bright: "Troppa luce alle tue spalle. Cambia posizione.",
  no_person: "Mettiti davanti alla fotocamera, a circa due metri.",
  many_people: "Deve esserci una sola persona nell'inquadratura.",
  head_missing: "Non vedo la testa. Allontanati un po'.",
  feet_missing: "Non riesco a vedere i piedi.",
  too_close: "Allontanati leggermente.",
  too_far: "Avvicinati di un passo.",
  off_center: "Spostati verso il centro.",
  not_facing: "Mettiti di fronte alla fotocamera.",
  arms_down: "Allarga le braccia, staccate dai fianchi.",
  arms_down_more: "Ancora un po' più aperte, come una A.",
  arms_high: "Abbassa un po' le braccia.",
  arms_forward: "Tendi le braccia in avanti, all'altezza delle spalle.",
  arms_forward_more: "Alza un po' le braccia, sopra il petto.",
  moving: "Resta fermo un momento.",
  mask: "Mettiti davanti a una parete libera.",
  // fasi
  hold_front: "Perfetto. Resta fermo così.",
  front_done: "Fatto. Ora girati di lato, lentamente.",
  turn: "Gira lentamente di un quarto e tendi le braccia in avanti.",
  turn_slow: "Più piano.",
  hold_side: "Ottimo, resta fermo così, di lato.",
  done: "Perfetto, scansione completata.",
};

export const MOVING_THRESHOLD = 0.015;

const PRIORITY = ["tilt", "dark", "bright", "many_people", "no_person", "head_missing", "feet_missing", "too_close", "too_far", "off_center", "not_facing", "arms_down", "arms_high", "arms_forward", "mask", "moving"];

/** Il codice da comunicare all'utente tra quelli presenti. */
export function topIssue(issues) {
  for (const p of PRIORITY) if (issues.includes(p)) return p;
  return issues[0] ?? null;
}

const vis = (lm, i, t = 0.5) => (lm[i]?.visibility ?? 1) >= t;
const deg = (r) => (r * 180) / Math.PI;

/** Angolo (gradi) del braccio rispetto alla verticale, nel piano dell'immagine. 0 = lungo il fianco. */
export function armAngle(lm, s, e, aspect) {
  const dx = (lm[e].x - lm[s].x) * aspect, dy = lm[e].y - lm[s].y;
  return deg(Math.atan2(Math.abs(dx), dy));
}

/**
 * Orientamento del busto rispetto alla fotocamera.
 * Usa i landmark 3D "world" (metri, origine ai fianchi) se presenti: yaw = angolo della linea delle spalle nel piano x-z.
 * @returns gradi in [0, 90]: 0 = di fronte, 90 = di profilo
 */
export function torsoYaw(world) {
  if (!world) return null;
  const a = world[LM.lShoulder], b = world[LM.rShoulder], c = world[LM.lHip], d = world[LM.rHip];
  const sx = a.x - b.x, sz = a.z - b.z, hx = c.x - d.x, hz = c.z - d.z;
  const ys = deg(Math.atan2(Math.abs(sz), Math.abs(sx))), yh = deg(Math.atan2(Math.abs(hz), Math.abs(hx)));
  return 0.6 * ys + 0.4 * yh;
}

/**
 * Spostamento medio del corpo tra due fotogrammi, in frazione dell'altezza (0 = immobile).
 * Solo busto e gambe: testa e polsi si muovono sempre un po' (e con le braccia tese in avanti tremano), ma non cambiano
 * le misure di petto, vita e fianchi.
 */
export function motion(prev, cur, bodyH) {
  if (!prev || !cur || !bodyH) return 0;
  const ids = [LM.lShoulder, LM.rShoulder, LM.lHip, LM.rHip, LM.lKnee, LM.rKnee, LM.lAnkle, LM.rAnkle];
  let s = 0;
  for (const i of ids) s += Math.hypot(cur[i].x - prev[i].x, cur[i].y - prev[i].y);
  return s / ids.length / bodyH;
}

/**
 * Valuta un fotogramma.
 * @param f { w, h, poses, lm, world, luma?, contrast?, pitchDeg?, sil? (risultato di analyzeSilhouette), maskSoft? }
 * @param ctx { view: "front"|"side", prevLm, dtMs }
 * @returns { issues: string[], score: 0..1, metrics }
 */
export function evaluateFrame(f, ctx = {}) {
  const issues = [], metrics = {};
  // Fino a TILT_MAX gradi l'inclinazione si corregge nella misura (measure.js, tiltMap); oltre si chiede di raddrizzare.
  if (Number.isFinite(f.pitchDeg) && Math.abs(f.pitchDeg) > TILT_MAX) issues.push("tilt");
  if (Number.isFinite(f.luma)) {
    metrics.luma = f.luma;
    if (f.luma < 45) issues.push("dark");
    else if (f.luma > 225) issues.push("bright");
  }
  if (!f.poses) { issues.push("no_person"); return { issues, score: 0, metrics }; }
  if (f.poses > 1) issues.push("many_people");
  const lm = f.lm, aspect = f.w / f.h;

  const headVisible = vis(lm, LM.nose, 0.5) && lm[LM.nose].y > 0.03;
  const feetIds = [LM.lAnkle, LM.rAnkle, LM.lHeel, LM.rHeel];
  // di profilo il piede dalla parte opposta e' nascosto: basta che si veda bene uno dei due
  const footOk = (a, b) => vis(lm, a, 0.4) && vis(lm, b, 0.4) && lm[a].y < 0.985 && lm[b].y < 0.985;
  const feetVisible = ctx.view === "side"
    ? footOk(LM.lAnkle, LM.lHeel) || footOk(LM.rAnkle, LM.rHeel)
    : feetIds.every((i) => vis(lm, i, 0.4) && lm[i].y < 0.985);
  if (!headVisible) issues.push("head_missing");
  if (!feetVisible) issues.push("feet_missing");

  const sil = f.sil;
  const topN = sil?.ok ? sil.topY / f.h : Math.min(...lm.map((p) => p.y)) - 0.06;
  const botN = sil?.ok ? sil.bottomY / f.h : Math.max(...feetIds.map((i) => lm[i].y));
  const bodyH = botN - topN;
  metrics.bodyH = bodyH;
  if (headVisible && feetVisible) {
    if (topN < 0.02 || botN > 0.985 || bodyH > 0.93) issues.push("too_close");
    // 45% dell'immagine (a 640 px: ~0,6 cm/px). Con il telefono basso e inclinato la finestra di distanza utile e' stretta.
    else if (bodyH < 0.45) issues.push("too_far");
  }
  const cx = (lm[LM.lShoulder].x + lm[LM.rShoulder].x + lm[LM.lHip].x + lm[LM.rHip].x) / 4;
  metrics.cx = cx;
  if (cx < 0.3 || cx > 0.7) issues.push("off_center");

  const yaw = torsoYaw(f.world);
  metrics.yaw = yaw;
  if (ctx.view !== "side") {
    if (yaw !== null && yaw > 25) issues.push("not_facing");
    // apertura del braccio: la maggiore tra braccio superiore (spalla-gomito) e braccio intero (spalla-polso). Chi "apre le
    // braccia" spesso piega i gomiti e allarga gli avambracci: il solo braccio superiore restava sotto soglia.
    const open = (s, e, w) => Math.max(armAngle(lm, s, e, aspect), armAngle(lm, s, w, aspect));
    const aL = open(LM.lShoulder, LM.lElbow, LM.lWrist), aR = open(LM.rShoulder, LM.rElbow, LM.rWrist);
    metrics.arms = [aL, aR];
    // Conta solo la silhouette: braccio staccato dal busto dove si misura. L'angolo serve solo a dire "troppo alte".
    if (sil?.ok && Object.values(sil.merged).some(Boolean)) issues.push("arms_down");
    else if (Math.max(aL, aR) > 75) issues.push("arms_high");
  } else if (sil?.ok && (!sil.armsForward || sil.merged.chest)) issues.push("arms_forward");

  if (Number.isFinite(f.maskSoft)) { metrics.maskSoft = f.maskSoft; if (f.maskSoft > 0.35) issues.push("mask"); }
  if (sil && !sil.ok && !issues.includes("feet_missing") && !issues.includes("head_missing")) issues.push("mask");

  // Movimento: normalizzato a 100 ms e mediato nel tempo (media esponenziale, ~0,3 s). Una persona in piedi oscilla sempre di
  // qualche centimetro e MediaPipe aggiunge il suo tremolio: non va fermata per questo, perche' ogni fotogramma si misura da
  // solo. "Resta fermo" serve per i movimenti veri (spostarsi, girarsi, gesticolare): soglia ~1,5% dell'altezza ogni
  // 100 ms (~25 cm/s). Prima era 0,6% istantaneo, polsi compresi: scattava di continuo.
  const raw = motion(ctx.prevLm, lm, bodyH) * (100 / Math.max(30, ctx.dtMs || 100));
  const mv = Number.isFinite(ctx.motionEma) ? 0.6 * ctx.motionEma + 0.4 * raw : raw;
  metrics.motion = mv;
  if (mv > MOVING_THRESHOLD) issues.push("moving");

  // punteggio continuo, usato per pesare/scartare anche quando nessun controllo e' fallito
  let score = 1;
  // visibilita' dei punti chiave; di profilo il lato lontano e' nascosto (visibilita' bassa per forza): conta il lato migliore
  const v = (i) => lm[i].visibility ?? 1;
  const pairs = [[LM.lShoulder, LM.rShoulder], [LM.lHip, LM.rHip], [LM.lAnkle, LM.rAnkle]];
  score *= Math.min(1, ...pairs.map(([a, b]) => (ctx.view === "side" ? Math.max(v(a), v(b)) : Math.min(v(a), v(b))) / 0.8));
  score *= 1 - Math.min(0.3, mv * 15);
  if (Number.isFinite(f.maskSoft)) score *= 1 - Math.min(0.5, f.maskSoft);
  if (Number.isFinite(f.luma)) score *= f.luma < 70 ? 0.8 : 1;
  metrics.score = score;
  // un problema "vero" rende il fotogramma inutilizzabile; le braccia unite al busto no (le altre zone restano misurabili)
  const blocking = issues.some((i) => i !== "arms_down" && i !== "arms_forward");
  return { issues, score: blocking ? Math.min(score, 0.4) : score, metrics };
}
