// Test del capo "body-bound" sugli asset veri (corpo e Grillz Tee): il deformatore e' puro, quindi gira in node senza Three.js.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadBody, loadGarment } from "../../../scripts/glb.mjs";
import { BodyModel, armWeights, bindGarment, deformGarment, LEVEL_DY, N_DIR } from "./bound.js";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const cal = JSON.parse(readFileSync(root + "src/bodyCalibration.json", "utf8"));
const glbPath = (size) => `${root}public/assets/garments/grillz-tee/tee-${size}.glb`;
const available = existsSync(glbPath("S")) && existsSync(glbPath("XL"));

function influences(cm) {
  const out = {};
  for (const [k, v] of Object.entries(cm)) {
    const pts = cal[k].curve;
    let y = pts[pts.length - 1][1];
    for (let i = 1; i < pts.length; i++) if (v <= pts[i][0]) { const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]; y = y0 + ((v - x0) / (x1 - x0)) * (y1 - y0); break; }
    out[k] = y;
  }
  return out;
}

let cache = null;
function setup() {
  if (cache) return cache;
  const b = loadBody(root + "public/assets/man-model.glb");
  const body = new BodyModel({ position: b.position, index: b.index, morphs: b.morphs, armW: armWeights(b.boneNames, b.skinIndex, b.skinWeight, b.position.length / 3) });
  const binds = {};
  for (const size of ["S", "XL"]) { const g = loadGarment(glbPath(size)); binds[size] = { g, bind: bindGarment(g, body) }; }
  cache = { body, binds };
  return cache;
}

/** Giro (m) dell'anello del capo alla fetta k: stessa misura polare usata dal deformatore (raggio medio per direzione, solo il busto). */
function ringGirth(bind, pos, y) {
  const sum = new Float64Array(N_DIR), cnt = new Uint16Array(N_DIR), idx = bind.index, az = bind.body.axisZ;
  for (let t = 0; t < idx.length; t += 3) {
    const vs = [idx[t], idx[t + 1], idx[t + 2]];
    if (vs.some((v) => Math.abs(bind.sleeve[v]) > 1e-4)) continue;
    for (let e = 0; e < 3; e++) {
      const i = vs[e], j = vs[(e + 1) % 3], di = pos[i * 3 + 1] - y, dj = pos[j * 3 + 1] - y;
      if (di * dj >= 0) continue;
      const u = di / (di - dj), x = pos[i * 3] + u * (pos[j * 3] - pos[i * 3]), z = pos[i * 3 + 2] + u * (pos[j * 3 + 2] - pos[i * 3 + 2]) - az;
      let a = Math.atan2(x, z); if (a < 0) a += Math.PI * 2;
      const bi = Math.round((a / (Math.PI * 2)) * N_DIR) % N_DIR;
      sum[bi] += Math.hypot(x, z); cnt[bi]++;
    }
  }
  let per = 0, prev = null, first = null;
  for (let i = 0; i < N_DIR; i++) {
    if (!cnt[i]) continue;
    const r = sum[i] / cnt[i], a = (i / N_DIR) * Math.PI * 2, p = [r * Math.sin(a), r * Math.cos(a)];
    if (prev) per += Math.hypot(p[0] - prev[0], p[1] - prev[1]); else first = p;
    prev = p;
  }
  return per + Math.hypot(prev[0] - first[0], prev[1] - first[1]);
}

/** Per vertice del capo: distanza (m) dal piano tangente del vertice del corpo lateralmente piu' vicino (Infinity se nessuno entro 2 cm). */
function minClearance(bind, pos, cur) {
  const body = bind.body, out = new Float64Array(bind.n);
  for (let v = 0; v < bind.n; v++) {
    let best = Infinity, d = 0;
    for (let k = 0; k < bind.NN; k++) {
      const bi = bind.nnI[v * bind.NN + k] * 3, n = [body.normal[bi], body.normal[bi + 1], body.normal[bi + 2]];
      const e = [pos[v * 3] - cur[bi], pos[v * 3 + 1] - cur[bi + 1], pos[v * 3 + 2] - cur[bi + 2]];
      const dn = e[0] * n[0] + e[1] * n[1] + e[2] * n[2], lat = Math.hypot(e[0] - dn * n[0], e[1] - dn * n[1], e[2] - dn * n[2]);
      if (lat < best) { best = lat; d = dn; }
    }
    out[v] = best < 0.02 ? d : Infinity;
  }
  return out;
}

const opts = { skip: available ? false : "asset del capo non costruiti (sh blender/garment/build_all.sh)" };

test("bound: col corpo neutro il capo e' esattamente quello della sim", opts, () => {
  const { binds } = setup();
  for (const size of ["S", "XL"]) {
    const { g, bind } = binds[size];
    const r = deformGarment(bind, {});
    let max = 0;
    for (let i = 0; i < r.position.length; i++) max = Math.max(max, Math.abs(r.position[i] - g.position[i]));
    assert.ok(max < 1e-5, `${size}: scarto massimo ${max} m`);
    assert.equal(r.info.tightCm, 0);
  }
});

test("bound: il giro del tessuto si conserva quando il corpo cresce (non segue il corpo come un guscio)", opts, () => {
  const { binds } = setup();
  const { g, bind } = binds.XL;
  const y = bind.yHem + 0.5 * (bind.yChestLine - bind.yHem);
  const g0 = ringGirth(bind, g.position, y);
  for (const cm of [{ Waist: 95, Hips: 110 }, { Chest: 110, Waist: 100, Hips: 108 }]) {
    const r = deformGarment(bind, influences(cm));
    const g1 = ringGirth(bind, r.position, y + r.info.dY);
    // ringGirth e' l'anello "liscio" (raggio medio per direzione): con un tessuto morbido a riposo e' piu' corto del tessuto vero, perche' una
    // parte sta nelle pieghe. Quando il corpo cresce le pieghe si consumano e l'anello liscio si allunga, ma mai oltre il tessuto: il capo
    // non si stringe (>= riposo - 2%) e non si allarga piu' della sua stoffa (<= giro del tessuto + 1%).
    const fabric = Math.max(...bind.rings.map((q) => q.fabric));
    assert.ok(g1 > g0 * 0.98 && g1 < fabric * 1.01, `${JSON.stringify(cm)}: giro ${(g1 * 100).toFixed(1)} cm, a riposo ${(g0 * 100).toFixed(1)}, tessuto ${(fabric * 100).toFixed(1)}`);
    assert.equal(r.info.tightCm, 0, "XL su questi corpi non e' stretta");
  }
});

test("bound: corpo piu' grande -> meno ease; corpo piu' grande del capo -> stretto (s = 0) e segnalato", opts, () => {
  const { binds } = setup();
  const a = deformGarment(binds.S.bind, influences({ Chest: 100, Waist: 85, Hips: 100 })).info;
  const b = deformGarment(binds.S.bind, influences({ Chest: 120 })).info;
  const mean = (x) => x.reduce((s, v) => s + v, 0) / x.length;
  assert.ok(mean(a.s) < 1 && mean(a.s) > 0, `corpo un po' piu' grande: s medio ${mean(a.s)}`);
  assert.ok(Math.min(...b.s) === 0 && b.tightCm > 5, `S su torace 120: stretto di ${b.tightCm} cm`);
  assert.ok(b.bodyAtChestLineCm > b.chestGarmentCm);
});

test("bound: il tessuto non entra nel corpo (salvo il limite noto nell'ascella a petto molto grande)", opts, () => {
  const { body, binds } = setup();
  for (const [size, cm] of [["S", {}], ["S", { Chest: 120 }], ["XL", { Chest: 120 }], ["XL", { Waist: 95, Hips: 110 }], ["XL", { Chest: 125, Waist: 115, Hips: 120, Altezza: 190 }], ["S", { Chest: 82, Waist: 66, Hips: 86, Altezza: 160 }]]) {
    const bind = binds[size].bind, infl = influences(cm), r = deformGarment(bind, infl);
    const now = minClearance(bind, r.position, body.shape(infl)), rest = minClearance(bind, bind.rest, body.base);
    // chi nella sim era fuori dal corpo resta fuori (>= 0,5 mm); nelle concavita' (ascella) il piano tangente inganna: li' non peggiora
    let bad = 0;
    for (let v = 0; v < bind.n; v++) if (now[v] - Math.min(0.0005, rest[v]) < -1e-4) bad++;
    // limite noto: col petto molto piu' grande del neutro restano alcuni vertici schiacciati nell'ascella (misura vera in Blender:
    // blender/tools/check_worn.py, 15-16 vertici su ~8000 a petto 120). Altrove nessuno.
    // Questa e' una STIMA (piano tangente del vertice del corpo lateralmente piu' vicino, con le normali a riposo), non la distanza vera:
    // col petto molto piu' grande la pelle ruota e la stima segnala qualche vertice in piu'. La misura vera (BVH in Blender,
    // blender/tools/check_worn.py) per S a petto 120 da' 2 vertici dentro il corpo su 7113.
    // Negli altri casi la stima sbaglia su pochi vertici mentre la misura vera e' pulita (XL vita 95 + fianchi 110: 2 segnalati, minimo
    // vero 2,81 mm; S su 82/66/86/160: 8 segnalati, minimo vero 2,30 mm; nessuno dentro il corpo): ammessi fino allo 0,2%.
    const allowed = (cm.Chest || 0) >= 118 ? Math.ceil(bind.n * 0.01) : Math.ceil(bind.n * 0.002);
    assert.ok(bad <= allowed, `${size} ${JSON.stringify(cm)}: ${bad} vertici piu' vicini al corpo che nella sim (ammessi ${allowed})`);
  }
});

test("bound: con l'altezza il capo sale con le spalle e NON si allunga", opts, () => {
  const { binds } = setup();
  const { g, bind } = binds.S;
  const ext = (p) => { let lo = Infinity, hi = -Infinity; for (let i = 1; i < p.length; i += 3) { if (p[i] < lo) lo = p[i]; if (p[i] > hi) hi = p[i]; } return [lo, hi]; };
  const [lo0, hi0] = ext(g.position);
  const r = deformGarment(bind, influences({ Altezza: 195 }));
  const [lo1, hi1] = ext(r.position);
  assert.ok(r.info.dY > 0.15, `le spalle salgono di ${(r.info.dY * 100).toFixed(1)} cm`);
  assert.ok(Math.abs((hi1 - lo1) - (hi0 - lo0)) < 0.03, `estensione verticale ${(hi1 - lo1).toFixed(3)} m contro ${(hi0 - lo0).toFixed(3)} a riposo`);
  assert.ok(Math.abs((lo1 - lo0) - r.info.dY) < 0.04, "l'orlo sale quanto le spalle");
});

test("bound: le combinazioni di misure non sono la somma dei singoli effetti (il capo e' ricalcolato sul corpo intero)", opts, () => {
  const { binds } = setup();
  const { g, bind } = binds.S;
  const both = deformGarment(bind, influences({ Chest: 108, Waist: 100 })).position.slice();
  const c = deformGarment(bind, influences({ Chest: 108 })).position.slice(), w = deformGarment(bind, influences({ Waist: 100 })).position.slice();
  let diff = 0;
  for (let i = 0; i < both.length; i++) diff = Math.max(diff, Math.abs(both[i] - (c[i] + w[i] - g.position[i])));
  assert.ok(diff > 0.002, `scarto dalla somma lineare ${(diff * 1000).toFixed(1)} mm`);
  assert.ok(LEVEL_DY > 0);
});

test("bound: sicurezza sulla pelle sulla forma corrente (estremi degli slider): neutro intatto, petto 130 senza vertici sotto la pelle", opts, () => {
  const { body, binds } = setup();
  const bind = binds.XL.bind;
  assert.equal(deformGarment(bind, {}).info.skinFixed, 0, "col corpo neutro la sicurezza non deve spostare nulla");
  const infl = influences({ Chest: 130 }), r = deformGarment(bind, infl), cur = body.shape(infl);
  assert.ok(r.info.skinFixed > 0, "a petto 130 la sicurezza deve intervenire");
  // misura indipendente dal deformatore: vertice del corpo piu' vicino (forza bruta su un campione) e sua normale nella forma corrente
  const nrm = new Float32Array(cur.length), idx = body.index;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const u = [cur[b] - cur[a], cur[b + 1] - cur[a + 1], cur[b + 2] - cur[a + 2]], w = [cur[c] - cur[a], cur[c + 1] - cur[a + 1], cur[c + 2] - cur[a + 2]];
    const f = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    for (const i of [a, b, c]) for (let d = 0; d < 3; d++) nrm[i + d] += f[d];
  }
  let inside = 0, checked = 0;
  for (let v = 0; v < bind.n; v += 7) {
    let best = -1, bd = Infinity;
    for (let q = 0; q < body.n; q++) {
      const d2 = (r.position[v * 3] - cur[q * 3]) ** 2 + (r.position[v * 3 + 1] - cur[q * 3 + 1]) ** 2 + (r.position[v * 3 + 2] - cur[q * 3 + 2]) ** 2;
      if (d2 < bd) { bd = d2; best = q; }
    }
    if (bd > 0.02 * 0.02) continue;
    const l = Math.hypot(nrm[best * 3], nrm[best * 3 + 1], nrm[best * 3 + 2]) || 1;
    const dn = ((r.position[v * 3] - cur[best * 3]) * nrm[best * 3] + (r.position[v * 3 + 1] - cur[best * 3 + 1]) * nrm[best * 3 + 1] + (r.position[v * 3 + 2] - cur[best * 3 + 2]) * nrm[best * 3 + 2]) / l;
    checked++;
    if (dn < -0.0005) inside++;
  }
  assert.ok(checked > 200, "campione troppo piccolo");
  assert.ok(inside <= Math.ceil(checked * 0.005), `${inside} vertici su ${checked} sotto la pelle a petto 130`);
});

test("bound: il capo segue le spalle in modo continuo (niente scatti di una fetta con piccole variazioni di altezza)", opts, () => {
  const { binds } = setup();
  const { g, bind } = binds.XL;
  // influence dell'altezza che spostano le spalle di frazioni di fetta (LEVEL_DY = 1,2 cm): prima il capo restava indietro e si deformava
  for (const a of [-0.004, -0.02, 0.02, -0.035]) {
    const r = deformGarment(bind, { Altezza: a }), dY = r.info.dY;
    assert.ok(Math.abs(dY) > 1e-4 && Math.abs(dY) < 1.5 * LEVEL_DY, `spostamento delle spalle fuori dal caso di prova: ${dY}`);
    let far = 0;
    for (let v = 0; v < bind.n; v++) {
      const e = Math.hypot(r.position[v * 3] - g.position[v * 3], r.position[v * 3 + 1] - g.position[v * 3 + 1] - dY, r.position[v * 3 + 2] - g.position[v * 3 + 2]);
      if (e > 0.003) far++;
    }
    // corpo quasi identico: il capo deve essere la sim traslata con le spalle. Prima un terzo dei vertici si scostava di oltre 3 mm (fino a
    // 17 mm); ora restano pochi vertici vicino all'orlo, dove la sagoma del corpo sotto il tessuto cambia in fretta (cavallo, cosce)
    assert.ok(far <= Math.ceil(bind.n * 0.01), `Altezza ${a}: ${far} vertici su ${bind.n} a piu' di 3 mm dalla sim traslata di ${(dY * 1000).toFixed(1)} mm`);
  }
});

test("bound: gli strati aggiunti (costina, risvolti) restano attaccati al tessuto base e i vertici duplicati restano coincidenti", opts, () => {
  const { binds } = setup();
  const { g, bind } = binds.XL;
  assert.ok(bind.attV.length > 500, "il GLB deve avere strati aggiunti (attributo _layer)");
  const r = deformGarment(bind, influences({ Chest: 114, Waist: 95, Hips: 104, Altezza: 185 })), Q = r.position, P = g.position;
  const dist = (A, a, b) => Math.hypot(A[a * 3] - A[b * 3], A[a * 3 + 1] - A[b * 3 + 1], A[a * 3 + 2] - A[b * 3 + 2]);
  // la distanza di ogni vertice di uno strato dal vertice base piu' vicino cambia al massimo di ~2 mm (prima il guscio della costina
  // scorreva e lungo la cucitura si apriva una fessura)
  let worst = 0;
  for (let j = 0; j < bind.attV.length; j++) worst = Math.max(worst, Math.abs(dist(Q, bind.attV[j], bind.attI[j * 3]) - dist(P, bind.attV[j], bind.attI[j * 3])));
  assert.ok(worst < 0.0025, `uno strato si e' spostato di ${(worst * 1000).toFixed(1)} mm rispetto al tessuto base`);
  // vertici duplicati (stessa posizione nella sim, texture diverse): ancora coincidenti, altrimenti il capo si apre lungo le cuciture
  let open = 0;
  for (let i = 0; i + 1 < bind.dupStart.length; i++) for (let j = bind.dupStart[i] + 1; j < bind.dupStart[i + 1]; j++) open = Math.max(open, dist(Q, bind.dupList[j], bind.dupList[bind.dupStart[i]]));
  assert.ok(open < 1e-5, `vertici duplicati separati di ${(open * 1000).toFixed(2)} mm`);
});
