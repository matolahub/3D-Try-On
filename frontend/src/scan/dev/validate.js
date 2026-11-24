// SOLO SVILUPPO: validazione della scansione sul corpo 3D a misure note, fotogramma per fotogramma (non dipende dal tempo reale).
// Stessa pipeline della scansione vera: render -> MediaPipe (posa + maschera) -> ScanSession -> misure.
//   const v = await import("/src/scan/dev/validate.js");
//   await v.validateScan({ chest: 100, waist: 88, hips: 102, height: 178 })
// Il soggetto "obbedisce": resta di fronte in posa A (e apre di piu' le braccia se la sessione lo chiede), quando la sessione
// chiede di girarsi tende le braccia in avanti e ruota a 3°/fotogramma.

import { createModelSubject } from "./modelCamera.js";
import { createDetector, createFrameReader } from "../vision.js";
import { ScanSession } from "../session.js";

let detector = null, clock = 0;               // il rilevatore e' condiviso: i timestamp devono crescere anche tra una prova e l'altra

export async function validateScan(body, { degPerFrame = 3, maxFrames = 300, heightCm, frontOnly = false, camera = {}, knownFocal = false, correctTilt = true } = {}) {
  detector ??= await createDetector();
  const subj = await createModelSubject({ body, ...camera });
  const fov = camera.fovDeg ?? 62;
  const reader = createFrameReader(detector.landmarker);
  const S = new ScanSession({ heightCm: heightCm ?? subj.truth.height });
  let yaw = 0;
  try {
    for (let i = 0; i < maxFrames && S.phase !== "done"; i++) {
      if (frontOnly && S.phase === "turn") { S.skipSide(); break; }
      const turning = S.phase === "turn" || S.phase === "side";
      if (turning) yaw = Math.min(90, yaw + degPerFrame);
      subj.render(yaw, turning);
      clock += 100;
      const f = reader.read(subj.canvas, clock);
      if (f) {
        // inclinazione "dai sensori"; focale vera (knownFocal) oppure stimata come nell'app (DEFAULT_FOV_LONG)
        f.pitchDeg = correctTilt ? camera.pitchDeg ?? 0 : 0;
        if (knownFocal) f.focalPx = f.h / 2 / Math.tan(((fov / 2) * Math.PI) / 180);
        const snap = S.push(f);
        if (snap.cue === "arms_down" || snap.cue === "arms_down_more") subj.openArms();
        if (snap.cue === "arms_forward" || snap.cue === "arms_forward_more") subj.raiseArms();
      }
    }
  } finally {
    subj.dispose();
  }
  const r = S.result;
  const truth = subj.truth;
  if (!r) return { truth, error: `scansione non completata (fase ${S.phase})`, stats: S.stats };
  const rows = Object.fromEntries(["chest", "waist", "hips"].map((k) => {
    const m = r.measures[k];
    return [k, { truth: truth[k], scan: +m.value.toFixed(1), err: +(m.value - truth[k]).toFixed(1), unc: +m.uncertainty.toFixed(1), widthCm: +m.widthCm.toFixed(2), depthCm: m.depthCm && +m.depthCm.toFixed(2) }];
  }));
  return { truth, rows, overall: r.overall, stats: { frames: S.stats.frames, front: S.front.length, side: S.side.length, rejected: S.stats.rejected } };
}
