// Live Body Scan – macchina a stati della scansione. Pura: riceve un fotogramma gia' analizzato alla volta e decide
// fase, istruzione da dare, avanzamento e quali letture tenere. Nessuna dipendenza dal browser: si testa in Node.
//
//   framing -> pose -> front (raccolta) -> turn -> side (raccolta) -> done
//
// Perche' fronte + profilo e non 360°: due viste ortogonali danno larghezza e profondita' di ogni sezione, che e' quanto
// serve per l'ellisse; le viste intermedie aggiungono poco (la sezione e' gia' modellata) e chiedono un tracciamento
// dell'angolo molto piu' fragile con una sola fotocamera. Sulla mesh di riferimento l'errore massimo passa da 4,7-9,5 cm
// (solo fronte) a 0,5-3,8 cm (fronte + profilo): e' li' che sta il guadagno.

import { CIRC_FIELDS, analyzeSilhouette, aggregate, median } from "./measure.js";

/**
 * Avanzamento di una raccolta: ogni misura (petto, vita, fianchi) conta le sue letture. Un fotogramma in cui una sola misura
 * non e' leggibile (es. braccio che sfiora il petto) serve comunque per le altre, invece di essere scartato in silenzio.
 * @returns { done: ogni misura ha `target` letture, fill: avanzamento medio 0..1 }
 */
export function collectionFill(list, target) {
  const counts = CIRC_FIELDS.map((k) => list.filter((r) => Number.isFinite(r.widths[k])).length);
  return { done: counts.every((c) => c >= target), fill: counts.reduce((s, c) => s + Math.min(1, c / target), 0) / counts.length, counts };
}
const anyWidth = (sil) => sil?.ok && Object.values(sil.widths).some(Number.isFinite);
import { evaluateFrame, topIssue } from "./quality.js";

export const PHASES = ["framing", "pose", "front", "turn", "side", "done"];
const LAYOUT = new Set(["tilt", "dark", "bright", "no_person", "many_people", "head_missing", "feet_missing", "too_close", "too_far", "off_center", "mask"]);
export const CFG = {
  framingFrames: 4,      // fotogrammi consecutivi ben inquadrati per passare alla posa
  poseFrames: 5,         // ... in posa corretta e fermi per iniziare la raccolta
  frontFrames: 24,       // letture frontali valide da raccogliere
  sideFrames: 18,        // letture laterali valide
  minScore: 0.5,
  frontMaxMs: 15000,     // dopo questo tempo di raccolta frontale si prosegue se ogni misura ha almeno frontMinFrames letture
  frontMinFrames: 8,
  sideMaxMs: 12000,      // idem per la vista di profilo
  sideMinFrames: 6,
  sideYaw: 65,           // gradi oltre i quali la vista e' di profilo
  turnTooFast: 110,      // gradi/s
  lostMs: 2500,          // senza persona per piu' di cosi' si torna all'inquadratura
  skipSideAfterMs: 25000,
};

export class ScanSession {
  constructor({ heightCm, config = {} }) {
    this.heightCm = heightCm;
    this.cfg = { ...CFG, ...config };
    this.phase = "framing";
    this.front = [];
    this.side = [];
    this.streak = 0;
    this.prevLm = null;
    this.prevT = null;
    this.lostSince = null;
    this.turnStart = null;
    this.armsDownSince = null;
    this.motionEma = null;
    this.frontStart = null;
    this.sideStart = null;
    this.armsFwdSince = null;
    this.prevAngle = null;
    this.frontShoulderRatio = null;
    this.stats = { frames: 0, rejected: {} };
    this.result = null;
  }

  /** Angolo stimato del busto (0 fronte, 90 profilo): landmark 3D + restringimento delle spalle rispetto alla vista frontale. */
  angle(f, sil, yaw) {
    let byWidth = null;
    if (this.frontShoulderRatio && sil?.ok) {
      const ratio = sil.shoulderPx / sil.pxHeight / this.frontShoulderRatio;
      byWidth = (Math.acos(Math.max(0, Math.min(1, ratio))) * 180) / Math.PI;
    }
    if (yaw === null || yaw === undefined) return byWidth;
    return byWidth === null ? yaw : 0.5 * yaw + 0.5 * byWidth;
  }

  /**
   * Un fotogramma.
   * @param f { t (ms), w, h, poses, lm, world, mask, luma?, tiltDeg?, maskSoft? }
   * @returns { phase, cue, progress (0..1 della fase), overall (0..1), accepted, issues, metrics, canSkipSide, result? }
   */
  push(f) {
    if (this.phase === "done") return this.snapshot(null, [], {});
    this.stats.frames++;
    const dt = this.prevT === null ? 100 : f.t - this.prevT;
    this.prevT = f.t;
    const view = this.phase === "turn" || this.phase === "side" ? "side" : "front";
    const sil = f.poses && f.mask ? analyzeSilhouette(f, this.heightCm, view) : null;
    const q = evaluateFrame({ ...f, sil }, { view, prevLm: this.prevLm, dtMs: dt, motionEma: this.motionEma });
    this.prevLm = f.poses ? f.lm : null;
    this.motionEma = f.poses ? q.metrics.motion : null;
    const issues = q.issues;
    for (const i of issues) this.stats.rejected[i] = (this.stats.rejected[i] || 0) + 1;

    // persona sparita a lungo: si ricomincia dall'inquadratura (le letture gia' raccolte restano)
    if (issues.includes("no_person")) {
      this.lostSince ??= f.t;
      if (f.t - this.lostSince > this.cfg.lostMs && this.phase !== "framing") { this.phase = this.phase === "side" || this.phase === "turn" ? "turn" : "framing"; this.streak = 0; }
    } else this.lostSince = null;

    const layoutIssue = issues.filter((i) => LAYOUT.has(i));
    let cue = null, accepted = false;

    switch (this.phase) {
      case "framing":
        if (layoutIssue.length) { this.streak = 0; cue = topIssue(layoutIssue); break; }
        if (++this.streak >= this.cfg.framingFrames) { this.phase = "pose"; this.streak = 0; }
        cue = topIssue(issues) ?? "hold_front";
        break;
      case "pose": {
        if (layoutIssue.length) { this.phase = "framing"; this.streak = 0; cue = topIssue(layoutIssue); break; }
        // le braccia non bloccano l'avvio: se toccano il busto in una zona, le altre misure si raccolgono comunque
        const hard = issues.filter((i) => i !== "arms_down");
        if (hard.length) { this.streak = 0; cue = topIssue(hard); break; }
        if (++this.streak >= this.cfg.poseFrames) { this.phase = "front"; this.streak = 0; this.frontStart = f.t; }
        cue = "hold_front";
        break;
      }
      case "front": {
        // Braccia "unite" al busto: non si scarta il fotogramma (vale per le misure libere). Si chiede di aprirle solo se a una
        // zona coperta dal braccio mancano ancora letture.
        const hard = issues.filter((i) => i !== "arms_down");
        if (hard.length) { cue = topIssue(hard); break; }
        const fill = collectionFill(this.front, this.cfg.frontFrames);
        const needArms = sil?.ok && CIRC_FIELDS.some((k, i) => sil.merged[k] && fill.counts[i] < this.cfg.frontFrames);
        cue = needArms ? "arms_down" : "hold_front";
        if (anyWidth(sil) && q.score >= this.cfg.minScore) {
          this.front.push({ t: f.t, widths: sil.widths, shoulderCm: sil.shoulderCm, shoulderRatio: sil.shoulderPx / sil.pxHeight, quality: q.score, chestRelStd: sil.chestRelStd, pitch: f.pitchDeg });
          accepted = true;
        }
        const now = collectionFill(this.front, this.cfg.frontFrames);
        const timeUp = this.frontStart !== null && f.t - this.frontStart > this.cfg.frontMaxMs && now.counts.every((c) => c >= this.cfg.frontMinFrames);
        if (now.done || timeUp) {
          this.frontShoulderRatio = median(this.front.map((r) => r.shoulderRatio));
          this.phase = "turn"; this.turnStart = f.t; this.prevAngle = null; cue = "front_done";
        }
        break;
      }
      case "turn":
      case "side": {
        const a = this.angle(f, sil, q.metrics.yaw);
        q.metrics.angle = a;
        if (a !== null && this.prevAngle !== null && Math.abs(a - this.prevAngle) / Math.max(0.03, dt / 1000) > this.cfg.turnTooFast) cue = "turn_slow";
        this.prevAngle = a;
        const blocking = layoutIssue.concat(issues.includes("moving") && this.phase === "side" ? ["moving"] : []);
        if (blocking.length && !(blocking.length === 1 && blocking[0] === "off_center")) { cue = cue ?? topIssue(blocking); break; }
        const isSide = a !== null && a >= this.cfg.sideYaw;
        if (!isSide) { if (this.phase === "side") this.phase = "turn"; cue = cue ?? "turn"; break; }
        this.phase = "side";
        if (issues.includes("moving")) { cue = "moving"; break; }
        // Braccia: non bloccano. Le zone coperte da un braccio si scartano da sole (measure.js); si chiede di alzarle solo
        // se a una zona mancano ancora letture.
        const sideFill = collectionFill(this.side, this.cfg.sideFrames);
        const needArms = sil?.ok && CIRC_FIELDS.some((k, i) => (sil.merged[k] || (!sil.armsForward && !Number.isFinite(sil.widths[k]))) && sideFill.counts[i] < this.cfg.sideFrames);
        cue = needArms ? "arms_forward" : "hold_side";
        this.sideStart ??= f.t;
        if (anyWidth(sil) && q.score >= this.cfg.minScore) {
          this.side.push({ t: f.t, widths: sil.widths, quality: q.score, pitch: f.pitchDeg, angle: q.metrics.angle });
          accepted = true;
        }
        const sNow = collectionFill(this.side, this.cfg.sideFrames);
        const sideTimeUp = f.t - this.sideStart > this.cfg.sideMaxMs && sNow.counts.every((c) => c >= this.cfg.sideMinFrames);
        if (sNow.done || sideTimeUp) this.finish();
        if (this.phase === "done") cue = "done";
        break;
      }
      default:
        break;
    }
    // se "allarga le braccia" non basta, dopo qualche secondo l'istruzione diventa piu' precisa
    if (cue === "arms_down") {
      this.armsDownSince ??= f.t;
      if (f.t - this.armsDownSince > 4000) cue = "arms_down_more";
    } else this.armsDownSince = null;
    if (cue === "arms_forward") {
      this.armsFwdSince ??= f.t;
      if (f.t - this.armsFwdSince > 4000) cue = "arms_forward_more";
    } else this.armsFwdSince = null;
    return this.snapshot(cue, issues, q.metrics, accepted, sil);
  }

  /** L'utente salta la vista laterale: misure con la sola vista frontale (incertezza piu' alta). */
  skipSide() {
    if (collectionFill(this.front, this.cfg.frontFrames).done) this.finish();
    return this.result;
  }

  finish() {
    this.result = aggregate(this.front, this.side, this.heightCm);
    this.result.stats = { ...this.stats, frontFrames: this.front.length, sideFrames: this.side.length };
    // letture grezze (solo numeri, cm): servono alla calibrazione sul campo, non escono dal dispositivo da sole
    const r1 = (v) => (Number.isFinite(v) ? Math.round(v * 10) / 10 : null);
    this.result.raw = {
      front: this.front.map((r) => ({ chest: r1(r.widths.chest), waist: r1(r.widths.waist), hips: r1(r.widths.hips), shoulders: r1(r.shoulderCm), q: r1(r.quality) })),
      side: this.side.map((r) => ({ chest: r1(r.widths.chest), waist: r1(r.widths.waist), hips: r1(r.widths.hips), q: r1(r.quality), angle: r1(r.angle) })),
    };
    this.phase = "done";
    return this.result;
  }

  snapshot(cue, issues, metrics, accepted = false, sil = null) {
    const c = this.cfg;
    const fF = collectionFill(this.front, c.frontFrames).fill, fS = collectionFill(this.side, c.sideFrames).fill;
    const progress = {
      framing: Math.min(1, this.streak / c.framingFrames),
      pose: Math.min(1, this.streak / c.poseFrames),
      front: fF,
      turn: Math.min(1, Math.max(0, (metrics.angle ?? 0) / c.sideYaw)),
      side: fS,
      done: 1,
    }[this.phase];
    const overall = Math.min(1, fF * 0.55 + fS * 0.45);
    const canSkipSide = (this.phase === "turn" || this.phase === "side") && this.turnStart !== null && (this.prevT - this.turnStart) > c.skipSideAfterMs;
    return { phase: this.phase, cue, progress, overall, accepted, issues, metrics, canSkipSide, sil, result: this.result };
  }
}
