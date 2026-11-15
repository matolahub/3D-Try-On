// Applica offline il deformatore "body-bound" a un GLB del capo e scrive un nuovo GLB (stessa struttura, posizioni e normali aggiornate).
// Serve per le contact sheet in Blender e per confrontare il runtime con una cloth sim vera.
//   node scripts/deform-asset.mjs --in public/assets/garments/grillz-tee/tee-S.glb --body 120,78.5,96,173 --out /tmp/tee-S_chest120.glb
// --body = petto,vita,fianchi,altezza in cm (valori vuoti = neutro). Stampa i tempi e le grandezze misurate.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadBody, loadGarment, writeVec3, saveGlb } from "./glb.mjs";
import { BodyModel, armWeights, bindGarment, deformGarment, smoothNormals } from "../src/core/garment/bound.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const cal = JSON.parse(readFileSync(root + "src/bodyCalibration.json", "utf8"));
export function influences(cm) {
  const out = {};
  for (const [k, v] of Object.entries(cm)) {
    const c = cal[k], x = Math.max(c.min, Math.min(c.max, v)), pts = c.curve;
    let y = pts[pts.length - 1][1];
    for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; y = y0 + ((x - x0) / (x1 - x0)) * (y1 - y0); break; }
    out[k] = y;
  }
  return out;
}

const b = loadBody(arg("--bodyglb", root + "public/assets/man-model.glb"));
const body = new BodyModel({ position: b.position, index: b.index, morphs: b.morphs, armW: armWeights(b.boneNames, b.skinIndex, b.skinWeight, b.position.length / 3) });
const g = loadGarment(arg("--in"));
let t = performance.now();
const bind = bindGarment(g, body);
const tBind = performance.now() - t;
const vals = (arg("--body", "") || "").split(",").map((x) => (x === "" ? NaN : Number(x)));
const cm = {};
["Chest", "Waist", "Hips", "Altezza"].forEach((k, i) => { if (Number.isFinite(vals[i])) cm[k] = vals[i]; });
const infl = influences(cm);
t = performance.now();
let res;
const N = 5;
for (let i = 0; i < N; i++) res = deformGarment(bind, infl);
const tDef = (performance.now() - t) / N;
let maxMove = 0;
for (let i = 0; i < res.position.length; i += 3) maxMove = Math.max(maxMove, Math.hypot(res.position[i] - g.position[i], res.position[i + 1] - g.position[i + 1], res.position[i + 2] - g.position[i + 2]));
const nrm = smoothNormals(res.position, g.index, bind.weld);
for (const p of g.parts) {
  writeVec3(g.glb, p.posAcc, res.position.subarray(p.start * 3, (p.start + p.count) * 3));
  if (p.nrmAcc !== undefined) writeVec3(g.glb, p.nrmAcc, nrm.subarray(p.start * 3, (p.start + p.count) * 3));
}
if (arg("--out")) saveGlb(g.glb, arg("--out"));
const sMin = Math.min(...res.info.s), sMax = Math.max(...res.info.s);
console.log(JSON.stringify({ body: cm, influences: infl, vertices: g.position.length / 3, bindMs: +tBind.toFixed(1), deformMs: +tDef.toFixed(2), maxMoveCm: +(maxMove * 100).toFixed(2),
  sMin: +sMin.toFixed(3), sMax: +sMax.toFixed(3), tightCm: +res.info.tightCm.toFixed(2), dYcm: +(res.info.dY * 100).toFixed(2), hemY: +res.info.hemY.toFixed(4),
  chestGarmentCm: +res.info.chestGarmentCm.toFixed(1), bodyAtChestLineCm: +res.info.bodyAtChestLineCm.toFixed(1), kHem: bind.kHem, kA: bind.kA, kTop: bind.kTop }));
