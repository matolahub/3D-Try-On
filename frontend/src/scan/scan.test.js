import test from "node:test";
import assert from "node:assert/strict";
import { aggregate, analyzeSilhouette, circumference, ellipsePerimeter, robust, rowRun } from "./measure.js";
import { evaluateFrame, torsoYaw } from "./quality.js";
import { ScanSession } from "./session.js";
import { syntheticFrame } from "./synthetic.js";

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ""} atteso ${b} ± ${tol}, ottenuto ${a}`);

test("perimetro dell'ellisse: cerchio e caso degenere", () => {
  near(ellipsePerimeter(10, 10), 2 * Math.PI * 10, 1e-9);
  near(ellipsePerimeter(20, 10), 96.8845, 1e-3);           // valore di riferimento (integrale ellittico)
  assert.equal(ellipsePerimeter(0, 5), 0);
});

test("rowRun: bordi a sub-pixel su maschera sfumata", () => {
  const w = 100, mask = new Float32Array(w);
  for (let x = 0; x < w; x++) mask[x] = Math.max(0, Math.min(1, 0.5 + (15.3 - Math.abs(x - 50)) / 1.5));
  const r = rowRun(mask, w, 1, 0, 50);
  near(r.r - r.l, 30.6, 0.35, "larghezza");
});

test("silhouette frontale: larghezze ritrovate entro 0,6 cm e scala corretta", () => {
  const f = syntheticFrame({ widths: { chest: 35, waist: 29, hips: 37 } });
  const s = analyzeSilhouette(f, 175, "front");
  assert.ok(s.ok);
  near(s.cmPerPx, 1 / f.truth.pxPerCm, 0.01, "cm/px");
  near(s.widths.chest, 35, 0.6, "petto"); near(s.widths.waist, 29, 0.6, "vita"); near(s.widths.hips, 37, 0.6, "fianchi");
});

test("silhouette: braccia attaccate a tutto il busto -> misura del petto rifiutata", () => {
  const f = syntheticFrame({ armDeg: 0, widths: { chest: 41, waist: 41 } });     // busto largo ovunque, braccio lungo il fianco
  const s = analyzeSilhouette(f, 175, "front");
  assert.equal(s.widths.chest, null);
  assert.equal(s.merged.chest, true);
  assert.ok(evaluateFrame({ ...f, sil: s }, { view: "front" }).issues.includes("arms_down"));
});

test("silhouette: braccio che copre solo la quota del petto -> petto letto piu' in basso (ripiego) con piu' incertezza", () => {
  const f = syntheticFrame({ armDeg: 9, widths: { chest: 41 } });          // il braccio tocca a 0,70 ma non a 0,685
  const s = analyzeSilhouette(f, 175, "front");
  assert.ok(Number.isFinite(s.widths.chest), "petto misurato");
  assert.ok(s.chestLevel < 0.7 && s.chestRelStd > 0, `quota ${s.chestLevel}`);
  near(s.widths.chest, 41 * 1.028, 0.8, "petto riportato a 0,70");
  assert.equal(s.merged.chest, false);
  const fr = Array.from({ length: 20 }, () => ({ widths: { chest: s.widths.chest, waist: 30, hips: 36 }, shoulderCm: 38, chestRelStd: s.chestRelStd }));
  const base = Array.from({ length: 20 }, () => ({ widths: { chest: s.widths.chest, waist: 30, hips: 36 }, shoulderCm: 38 }));
  assert.ok(aggregate(fr, [], 175).measures.chest.uncertainty > aggregate(base, [], 175).measures.chest.uncertainty);
});

test("silhouette: braccio vicino al busto ma staccato (fessura di sfondo) -> misura valida, nessun richiamo", () => {
  // posa "A" leggera (14°, sotto la vecchia soglia di 18°): a quota petto tra braccio e busto restano ~1,7 cm di sfondo.
  const f = syntheticFrame({ armDeg: 14, widths: { chest: 42 } });
  const s = analyzeSilhouette(f, 175, "front");
  near(s.widths.chest, 42, 0.6, "petto");
  assert.equal(s.merged.chest, false);
  assert.ok(!evaluateFrame({ ...f, sil: s }, { view: "front" }).issues.includes("arms_down"));
});

test("sessione: braccio unito al busto solo al petto -> vita e fianchi si raccolgono comunque", () => {
  const S = new ScanSession({ heightCm: 175 });
  const f = syntheticFrame({ armDeg: 0, widths: { chest: 41, hips: 32 } });   // il braccio copre il petto (anche i ripieghi), non i fianchi
  let t = 0, snap;
  const cues = new Set();
  for (let i = 0; i < 40 && S.phase !== "turn"; i++) { snap = S.push({ ...f, t: (t += 100) }); cues.add(snap.cue); }
  const n = (k) => S.front.filter((r) => Number.isFinite(r.widths[k])).length;
  assert.ok(n("waist") >= 24 && n("hips") >= 24, `vita ${n("waist")}, fianchi ${n("hips")}`);
  assert.ok(!cues.has("moving"));
});

test("sessione: fase di fronte con tempo massimo -> prosegue se ogni misura ha abbastanza letture", () => {
  const S = new ScanSession({ heightCm: 175, config: { frontFrames: 1000 } });   // obiettivo irraggiungibile
  const f = syntheticFrame();
  let t = 0;
  for (let i = 0; i < 220 && S.phase !== "turn"; i++) S.push({ ...f, t: (t += 100) });
  assert.equal(S.phase, "turn");
});

test("sessione: se il richiamo sulle braccia non basta diventa piu' preciso", () => {
  const S = new ScanSession({ heightCm: 175 });
  const f = syntheticFrame({ armDeg: 0, widths: { chest: 41 } });
  let t = 0, snap;
  for (let i = 0; i < 70; i++) snap = S.push({ ...f, t: (t += 100) });
  assert.equal(snap.cue, "arms_down_more");
});

test("telefono inclinato (appoggiato): la prospettiva si corregge con l'inclinazione dei sensori", () => {
  const W = { chest: 35, waist: 29, hips: 37 };
  for (const pitch of [10, 20, 30]) {
    const f = syntheticFrame({ widths: W, pitchDeg: pitch, fill: 0.75 });
    const ok = analyzeSilhouette(f, 175, "front");
    for (const k of ["chest", "waist", "hips"]) near(ok.widths[k], W[k], 0.3, `${k} a ${pitch}°`);
    // senza correzione l'errore e' di centimetri
    const raw = analyzeSilhouette({ ...f, pitchDeg: 0 }, 175, "front");
    assert.ok(Math.abs(raw.widths.chest - W.chest) > 4, `senza correzione a ${pitch}°: ${raw.widths.chest}`);
  }
  // inclinato in avanti (fotocamera verso il basso)
  const fd = syntheticFrame({ widths: W, pitchDeg: -10, fill: 0.6 });
  near(analyzeSilhouette(fd, 175, "front").widths.waist, W.waist, 0.3, "vita a -10°");
});

test("telefono inclinato: l'incertezza dichiarata cresce con l'inclinazione", () => {
  const fr = (pitch) => Array.from({ length: 20 }, () => ({ widths: { chest: 34, waist: 30, hips: 36 }, shoulderCm: 38, pitch }));
  const u = (pitch) => aggregate(fr(pitch), [], 175).measures.waist.uncertainty;
  assert.ok(u(0) < u(15) && u(15) < u(28));
});

test("qualita': oltre 30° di inclinazione si chiede di raddrizzare, sotto no", () => {
  const f = syntheticFrame();
  assert.ok(!evaluateFrame({ ...f, pitchDeg: 22 }, {}).issues.includes("tilt"));
  assert.ok(evaluateFrame({ ...f, pitchDeg: 35 }, {}).issues.includes("tilt"));
});

test("bordo della maschera (MediaPipe): si toglie l'eccesso per lato, solo se dichiarato dalla sorgente", () => {
  const f = syntheticFrame({ widths: { chest: 35, waist: 29, hips: 37 } });
  const exact = analyzeSilhouette(f, 175, "front");
  const biased = analyzeSilhouette({ ...f, edgeBiasPx: 0.7 }, 175, "front");
  for (const k of ["chest", "waist", "hips"]) near(exact.widths[k] - biased.widths[k], 2 * 0.7 * exact.cmPerPx, 0.01, k);
});

test("silhouette laterale: la larghezza vista di profilo e' la profondita'", () => {
  const f = syntheticFrame({ yawDeg: 90, depths: { chest: 26, waist: 23, hips: 25 } });
  const s = analyzeSilhouette(f, 175, "side");
  near(s.widths.chest, 26, 0.7); near(s.widths.waist, 23, 0.7); near(s.widths.hips, 25, 0.7);
});

test("qualita': inquadratura, distanza, persone multiple, movimento", () => {
  const ok = syntheticFrame();
  assert.deepEqual(evaluateFrame({ ...ok, sil: analyzeSilhouette(ok, 175) }, { view: "front" }).issues, []);
  assert.ok(evaluateFrame(syntheticFrame({ fill: 0.4 }), {}).issues.includes("too_far"));
  assert.ok(evaluateFrame(syntheticFrame({ fill: 0.99 }), {}).issues.includes("too_close"));
  assert.ok(evaluateFrame(syntheticFrame({ poses: 2 }), {}).issues.includes("many_people"));
  assert.ok(evaluateFrame(syntheticFrame({ cx: 0.2 }), {}).issues.includes("off_center"));
  assert.ok(evaluateFrame(syntheticFrame({ luma: 20 }), {}).issues.includes("dark"));
  assert.ok(evaluateFrame({ ...ok, poses: 0 }, {}).issues.includes("no_person"));
  const moved = syntheticFrame({ cx: 0.56 });
  assert.ok(evaluateFrame(moved, { prevLm: ok.lm, dtMs: 100 }).issues.includes("moving"));
  const feet = syntheticFrame(); feet.lm[27] = { ...feet.lm[27], visibility: 0.1 };
  assert.ok(evaluateFrame(feet, {}).issues.includes("feet_missing"));
});

test("profilo: braccia lungo i fianchi -> chiede di tenderle in avanti; tese in avanti -> ok", () => {
  const down = syntheticFrame({ yawDeg: 90, armsForward: false });
  assert.ok(evaluateFrame({ ...down, sil: analyzeSilhouette(down, 175, "side") }, { view: "side" }).issues.includes("arms_forward"));
  const fwd = syntheticFrame({ yawDeg: 90 });
  assert.deepEqual(evaluateFrame({ ...fwd, sil: analyzeSilhouette(fwd, 175, "side") }, { view: "side" }).issues, []);
});

test("orientamento del busto dai landmark 3D", () => {
  near(torsoYaw(syntheticFrame({ yawDeg: 0 }).world), 0, 0.01);
  near(torsoYaw(syntheticFrame({ yawDeg: 80 }).world), 80, 0.5);
});

test("profilo: le letture a rotazione incompleta (piu' profonde) non gonfiano la profondita'", () => {
  const front = Array.from({ length: 20 }, () => ({ widths: { chest: 34, waist: 30, hips: 35 }, shoulderCm: 38 }));
  // 40% delle letture mentre ci si gira (piu' profonde), poi profilo pieno a 25,6
  const side = [27.4, 27.2, 27.0, 26.8, 26.6, 26.4, 26.2, 26.0].map((h) => ({ widths: { chest: 25, waist: 24, hips: h } }))
    .concat(Array.from({ length: 12 }, () => ({ widths: { chest: 25, waist: 24, hips: 25.6 } })));
  near(aggregate(front, side, 175).measures.hips.depthCm, 25.6, 0.05);
});

test("aggregazione robusta: scarta gli outlier", () => {
  const r = robust([10, 10.2, 9.9, 10.1, 10, 30, 10.05]);
  near(r.value, 10.025, 0.05); assert.equal(r.rejected, 1);
});

test("circonferenze: fronte + profilo usa la profondita' misurata, solo fronte dichiara piu' incertezza", () => {
  const front = Array.from({ length: 20 }, () => ({ widths: { chest: 34, waist: 30, hips: 36 }, shoulderCm: 38 }));
  const side = Array.from({ length: 15 }, () => ({ widths: { chest: 25, waist: 22, hips: 24 } }));
  const both = aggregate(front, side, 175), only = aggregate(front, [], 175);
  near(both.measures.chest.value, circumference("chest", 34, 25), 1e-9);
  assert.equal(both.measures.chest.method, "front+side");
  assert.equal(only.measures.chest.method, "front");
  assert.ok(only.measures.waist.uncertainty > both.measures.waist.uncertainty);
  assert.ok(both.overall.sideView && !only.overall.sideView);
});

test("profondita' implausibile (es. braccio nella vista laterale) -> scartata, si usa la stima frontale", () => {
  const front = Array.from({ length: 20 }, () => ({ widths: { chest: 34, waist: 30, hips: 36 }, shoulderCm: 38 }));
  const side = Array.from({ length: 15 }, () => ({ widths: { chest: 38, waist: 22, hips: 24 } }));     // petto: 38/34 = 1,12
  const r = aggregate(front, side, 175);
  assert.equal(r.measures.chest.method, "front");
  assert.equal(r.measures.chest.depthRejected, true);
  assert.equal(r.measures.waist.method, "front+side");
});

test("sessione: fronte fermo -> rotazione -> profilo -> misure coerenti con la figura", () => {
  const S = new ScanSession({ heightCm: 175 });
  const W = { chest: 35, waist: 30, hips: 37 }, D = { chest: 26, waist: 23, hips: 25 };
  const front = syntheticFrame({ widths: W, depths: D });
  let t = 0, snap;
  const phases = new Set();
  for (let i = 0; i < 40 && S.phase !== "turn"; i++) { snap = S.push({ ...front, t: (t += 100) }); phases.add(snap.phase); }
  assert.ok(phases.has("pose") && phases.has("front"), [...phases].join(","));
  assert.equal(S.phase, "turn");
  // rotazione lenta: 10 gradi per fotogramma
  for (let a = 10; a <= 90 && S.phase !== "done"; a += 10) snap = S.push({ ...syntheticFrame({ widths: W, depths: D, yawDeg: a }), t: (t += 100) });
  const side = syntheticFrame({ widths: W, depths: D, yawDeg: 90 });
  for (let i = 0; i < 40 && S.phase !== "done"; i++) snap = S.push({ ...side, t: (t += 100) });
  assert.equal(snap.phase, "done");
  const m = snap.result.measures;
  for (const k of ["chest", "waist", "hips"]) {
    near(m[k].widthCm, W[k], 0.7, `${k} larghezza`);
    near(m[k].depthCm, D[k], 0.8, `${k} profondita'`);
    near(m[k].value, circumference(k, W[k], D[k]), 2, `${k} giro`);
  }
});

test("sessione: chi si muove non viene misurato e riceve l'istruzione 'resta fermo'", () => {
  const S = new ScanSession({ heightCm: 175 });
  let t = 0, snap;
  for (let i = 0; i < 30; i++) snap = S.push({ ...syntheticFrame({ cx: i % 2 ? 0.45 : 0.55 }), t: (t += 100) });
  assert.equal(S.front.length, 0);
  assert.equal(snap.cue, "moving");
});

// persona reale: il corpo oscilla di ~1 cm, i polsi tremano di ~3 cm, di profilo il lato lontano e' poco visibile
function realistic(o, rnd) {
  const f = syntheticFrame({ ...o, jitterPx: 5.8 });                 // ~±1 cm sui landmark
  const cm = f.truth.pxPerCm;
  for (const i of [15, 16]) f.lm[i] = { ...f.lm[i], x: f.lm[i].x + ((rnd() - 0.5) * 6 * cm) / f.w, y: f.lm[i].y + ((rnd() - 0.5) * 6 * cm) / f.h };
  if ((o.yawDeg ?? 0) >= 60) for (const i of [12, 14, 16, 24, 26, 28, 30, 32]) f.lm[i] = { ...f.lm[i], visibility: 0.35 };
  return f;
}
function seeded(seed) { let x = seed; return () => ((x = (x * 1664525 + 1013904223) % 4294967296) / 4294967296); }

test("sessione: oscillazioni naturali e polsi che tremano non bloccano la scansione (fronte e profilo)", () => {
  const rnd = seeded(7);
  const origRandom = Math.random;
  Math.random = rnd;
  try {
    const S = new ScanSession({ heightCm: 175 });
    let t = 0, snap, moving = 0, yaw = 0;
    for (let i = 0; i < 300 && S.phase !== "done"; i++) {
      if (S.phase === "turn" || S.phase === "side") yaw = Math.min(90, yaw + 3);          // ~30°/s
      snap = S.push({ ...realistic({ yawDeg: yaw }, rnd), t: (t += 100) });
      if (snap.issues.includes("moving") && snap.phase !== "turn") moving++;      // girarsi e' un movimento vero
    }
    assert.equal(S.phase, "done", `fermo in fase ${S.phase}, ultimo cue ${snap.cue}`);
    assert.ok(moving <= 3, `"resta fermo" scattato ${moving} volte`);
    assert.equal(snap.result.measures.chest.method, "front+side");
  } finally {
    Math.random = origRandom;
  }
});

test("movimento vero (un passo di lato) -> 'resta fermo'", () => {
  const S = new ScanSession({ heightCm: 175 });
  let t = 0, snap;
  for (let i = 0; i < 6; i++) snap = S.push({ ...syntheticFrame({ cx: 0.4 + i * 0.04 }), t: (t += 100) });
  assert.ok(snap.issues.includes("moving"));
});

function toSide(S, t) {
  const f = syntheticFrame();
  while (S.phase !== "turn") S.push({ ...f, t: (t.v += 100) });
  for (let yaw = 10; yaw <= 90; yaw += 10) S.push({ ...syntheticFrame({ yawDeg: yaw }), t: (t.v += 100) });
}

test("profilo: braccia lungo i fianchi coprono le zone -> nessuna lettura sporca, istruzione progressiva", () => {
  const S = new ScanSession({ heightCm: 175 });
  const t = { v: 0 };
  toSide(S, t);
  const n0 = S.side.length;
  let snap;
  const down = syntheticFrame({ yawDeg: 90, armsForward: false });
  for (let i = 0; i < 60; i++) snap = S.push({ ...down, t: (t.v += 100) });
  const clean = S.side.slice(n0).every((r) => ["chest", "waist", "hips"].every((k) => !Number.isFinite(r.widths[k])));
  assert.ok(clean, "nessuna profondita' letta attraverso il braccio");
  assert.equal(snap.cue, "arms_forward_more");
});

test("profilo: tempo massimo -> si chiude se ogni misura ha abbastanza letture", () => {
  const S = new ScanSession({ heightCm: 175, config: { sideFrames: 1000 } });
  const t = { v: 0 };
  toSide(S, t);
  const side = syntheticFrame({ yawDeg: 90 });
  for (let i = 0; i < 200 && S.phase !== "done"; i++) S.push({ ...side, t: (t.v += 100) });
  assert.equal(S.phase, "done");
  assert.equal(S.result.measures.waist.method, "front+side");
});

test("sessione: rotazione troppo rapida -> 'piu' piano'", () => {
  const S = new ScanSession({ heightCm: 175, config: { frontFrames: 5 } });
  let t = 0;
  const f = syntheticFrame();
  while (S.phase !== "turn") S.push({ ...f, t: (t += 100) });
  S.push({ ...syntheticFrame({ yawDeg: 5 }), t: (t += 100) });
  const snap = S.push({ ...syntheticFrame({ yawDeg: 60 }), t: (t += 100) });
  assert.equal(snap.cue, "turn_slow");
});

test("sessione: saltare la vista laterale da' misure solo frontali", () => {
  const S = new ScanSession({ heightCm: 175 });
  let t = 0;
  const f = syntheticFrame();
  while (S.phase !== "turn") S.push({ ...f, t: (t += 100) });
  const r = S.skipSide();
  assert.equal(S.phase, "done");
  assert.equal(r.measures.chest.method, "front");
  assert.equal(r.overall.sideView, false);
});
