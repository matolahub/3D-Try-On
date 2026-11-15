// Pagina di sviluppo (non fa parte del widget ne' della build): mostra il capo con parametri da URL, per ispezionarlo a colpo d'occhio.
//   /lab.html?cat=tshirt&body=100,85,100,178&chest=104&length=70&sleeve=22&hem=&angle=30&zoom=3&y=1.2
//   /lab.html?asset=grillz-tee&size=XL&body=120,,,&angle=30      capo 3D reale (GLB) nella taglia indicata; boxer=0 nasconde i boxer
//   &base=/assets/garments/_work/   GLB di prova da un'altra cartella (non tocca gli asset veri)
// body = petto,vita,fianchi,altezza (cm); chest/hem = GIRI in cm; length/sleeve/shoulder in cm; angle in gradi.
import * as THREE from "three";
import { TryOnEngine } from "../core/engine.js";
import { TEMPLATES } from "../core/garment/templates.js";
import { resolveGarment, buildFitReport } from "../core/garment/fit.js";
import { normalizeProduct, pickSize } from "../core/contract.js";
import { defaultBody } from "../core/bodyMeasures.js";
import { assetFor } from "../core/garment/assets.js";

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) && q.get(k) !== "" ? Number(q.get(k)) : d);
let last = null;
const hud = (spec, b, geom) => {
  const rep = buildFitReport({ template: spec.template, resolved: spec.resolved, body: b, geom });
  document.getElementById("hud").textContent = rep.map((z) => `${z.label}: ${z.garmentCm?.toFixed?.(1) ?? ""} ${z.easeCm !== undefined ? `(ease ${z.easeCm.toFixed(1)}, ${z.verdict ?? "-"})` : z.text ?? ""}${z.note ? " · " + z.note : ""}${z.warn ? " ! " + z.warn : ""}`).join("\n");
  window.lab.report = rep;
};
const engine = new TryOnEngine(document.getElementById("v"), { modelUrl: "/assets/man-model.glb", onGeom: (geom) => { if (last) hud(last.spec, last.b, geom); window.lab.assetReady = true; engine.renderer.render(engine.scene, engine.camera); } });
window.lab = { engine, THREE };

// ?base=/assets/garments/_work/ : carica i GLB di prova da un'altra cartella (stessa struttura <base><prodotto>/tee-<taglia>.glb), solo per il lab
const labAsset = (a) => {
  if (!a || !q.get("base")) return a;
  const url = q.get("base") + a.url.split("/garments/")[1];
  return { ...a, url, metaUrl: url.replace(/\.glb$/, ".json") };
};

function build(params) {
  const cat = params.cat || "tshirt";
  const garmentMeasurements = { chest: params.chest ?? 104, length: params.length ?? 70, sleeve: params.sleeve ?? 22 };
  if (params.hem) garmentMeasurements.hem = params.hem;
  if (params.shoulder) garmentMeasurements.shoulder = params.shoulder;
  const r = normalizeProduct({ id: "lab", name: "lab", category: cat, color: params.color, sizes: [{ label: "X", garmentMeasurements }] });
  if (!r.ok) throw new Error(r.errors.join("; "));
  const template = TEMPLATES[cat];
  const size = pickSize(r.product, "X");
  const resolved = resolveGarment({ template, size, body: {} });
  return { template, resolved, color: r.product.color || template.color, category: cat, asset: params.asset ? labAsset(assetFor(params.asset, cat, params.size || "S")) : null };
}

// Giro del capo misurato sulla mesh renderizzata (gonna: sezione orizzontale della griglia; shell: sezione dei triangoli), in cm.
// `hull` = giro "a nastro" (guscio convesso), `raw` = lunghezza della curva reale (include le pieghe).
window.lab.measure = (yAbs) => {
  const g = engine.garment, P = g.skirt.geometry.attributes.position.array, COLS = 144, ROWS = 48;
  const pts = [];
  for (let i = 0; i < COLS; i++) {
    for (let m = 0; m < ROWS; m++) {
      const a = (m * (COLS + 1) + i) * 3, b = ((m + 1) * (COLS + 1) + i) * 3;
      if ((P[a + 1] - yAbs) * (P[b + 1] - yAbs) <= 0 && P[a + 1] !== P[b + 1]) {
        const u = (P[a + 1] - yAbs) / (P[a + 1] - P[b + 1]);
        pts.push([P[a] + u * (P[b] - P[a]), P[a + 2] + u * (P[b + 2] - P[a + 2])]); break;
      }
    }
  }
  let raw = 0;
  for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; raw += Math.hypot(p[0] - q[0], p[1] - q[1]); }
  return { n: pts.length, rawCm: +(raw * 100).toFixed(1), pts };
};

// Inquadratura libera per gli screenshot: camera in (x, y, z) che guarda (0, ty, 0) con campo `fov` (gradi). Due render: il primo dopo un
// cambio di stato puo' mostrare ancora il fotogramma precedente.
window.lab.view = (x, y, z, ty, fov = 10) => {
  const e = engine;
  e.controls.enableDamping = false; e.controls.minDistance = 0.05;
  e.camera.fov = fov; e.camera.updateProjectionMatrix();
  e.camera.position.set(x, y, z); e.controls.target.set(0, ty, 0); e.controls.update(); e.camera.lookAt(0, ty, 0);
  e.renderer.render(e.scene, e.camera); e.renderer.render(e.scene, e.camera);
  return true;
};

window.lab.set = (params = {}) => {
  const b = params.body || defaultBody();
  const spec = build(params);
  const geom = engine.apply({ body: b, garment: spec });
  engine.setAngle(params.angle ?? 0);
  if (params.zoom) { engine.camera.position.set(0, params.y ?? 1.15, params.zoom); engine.controls.target.set(0, params.y ?? 1.15, 0); engine.controls.update(); }
  engine.model.rotation.y = engine.angle * Math.PI / 180;
  engine.controls.update();
  engine.renderer.render(engine.scene, engine.camera);          // render esplicito: gli screenshot non aspettano il prossimo frame
  last = { spec, b };
  hud(spec, b, geom);
  if (engine.shorts && params.boxer === 0) engine.shorts.group.visible = false;
  return geom;
};

engine.load().then(() => {
  const [c, w, h, hh] = (q.get("body") || "").split(",").map(Number);
  const d = defaultBody();
  const body = { chest: c || d.chest, waist: w || d.waist, hips: h || d.hips, height: hh || d.height };
  window.lab.ready = true;
  const asset = q.get("asset") || undefined;
  if (asset) {                                            // misure del negozio per la taglia (stesse del demo-shop), cosi' il report e' completo
    // [petto a piatto, lunghezza, manica dal punto spalla, spalla] per taglia: tabelle dei negozi (la raglan non ha spalla ne' manica dalla spalla)
    const CHARTS = {
      "grillz-tee": { S: [55.5, 70, 20.9, 53.7], M: [57.5, 72, 21.4, 55.2], L: [60, 74, 22, 57], XL: [62.5, 76, 22.6, 58.8], "2XL": [65, 78, 23.2, 60.6] },
      "kermit-tee": { S: [59, 70, 21, 58], M: [61, 72, 22, 60], L: [63, 74, 23, 62], XL: [65, 76, 24, 64], "2XL": [67, 78, 25, 66] },
      "drivingmato-tee": { S: [55, 69], M: [57, 71], L: [59, 73], XL: [61, 75], "2XL": [63, 77] },
    };
    const T = (CHARTS[asset] || CHARTS["grillz-tee"])[q.get("size") || "S"];
    window.lab.set({ body, cat: "tshirt", asset, size: q.get("size") || "S", chest: T[0] * 2, length: T[1], sleeve: T[2], shoulder: T[3], color: "#eeeeee",
      angle: num("angle", 0), zoom: num("zoom", 3.2), y: num("y", 1.2), boxer: num("boxer", 1) });
    return;
  }
  window.lab.set({ body, cat: q.get("cat") || "tshirt", chest: num("chest", 122), length: num("length", 66), sleeve: num("sleeve", 27),
    hem: num("hem", 0), shoulder: num("shoulder", 54), color: q.get("color") || undefined, angle: num("angle", 0), zoom: num("zoom", 3.2), y: num("y", 1.2) });
});
