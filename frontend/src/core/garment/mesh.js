// Capo 3D parametrico, costruito a runtime sul corpo. Tre parti:
//
//  1. SHELL sopra le ascelle (spalle, parte alta di petto e schiena, maniche): il tessuto poggia sul corpo. Sono i triangoli del corpo spostati
//     verso l'esterno di   ease(z) = (giro capo(z) - giro corpo(z)) / 2π - spessore   (giro corpo misurato sulla mesh corrente).
//  2. GONNA sotto le ascelle: una griglia regolare (colonne = angolo attorno al busto, righe = quota) che pende dal torace.
//     Le sezioni sono risolte da drape.js: il tessuto cade in verticale dalle parti sporgenti, il giro e' esatto,
//     l'eccesso va ai fianchi (ma non dentro le braccia) e forma pieghe. Orlo curvo, senza vincoli del cavallo.
//  3. GIROCOLLO: taglio curvo del collo (profondita' davanti/dietro dal template) + colletto in geometria.
//
// Sistema di coordinate: quello della geometria del corpo (metri, Y su, fronte verso +Z); il gruppo del capo va
// agganciato allo stesso genitore del corpo (`pivot`), che eredita la scala/posizione del wrapper.

import * as THREE from "three";
import { LEVELS } from "./templates.js";
import { convexHull, hullPerimeter, hullRadial, hullEntry, starRadial, solveRing, slackWeights, foldPattern, foldAmplitude, hemHeights, smoothstep, ringPerimeter } from "./drape.js";

const ARM_PREFIX = ["upperarm", "lowerarm", "wrist", "finger", "metacarpal", "shoulder"];
const BIN = 0.01;                    // altezza delle fette orizzontali (m)
const CM = 0.01;
const TWO_PI = Math.PI * 2;
const HAND_LEVEL = 0.47;             // sotto questo livello (frazione di H0) ci sono le mani
const COLS = 144;                    // colonne della gonna (angolo attorno al busto)
const ROWS = 64;                     // righe del busto (dal girocollo/dalle ascelle all'orlo)
const SCOLS = 48, SROWS = 20;        // maniche: colonne x righe
const COLLAR_S = 10;                 // lati della sezione di un bordo (colletto, orlo, polsino)

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function interp(xs, ys, x) {          // xs crescente
  const n = xs.length;
  if (n === 0) return 0;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xs[mid] <= x) lo = mid; else hi = mid; }
  const t = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return ys[lo] + t * (ys[hi] - ys[lo]);
}

function fillNaN(xs, ys) {            // interpola i buchi (NaN) di ys lungo xs
  const ok = [];
  for (let i = 0; i < ys.length; i++) if (Number.isFinite(ys[i])) ok.push(i);
  if (ok.length === 0) return ys.fill(0);
  for (let i = 0; i < ys.length; i++) {
    if (Number.isFinite(ys[i])) continue;
    let a = -1, b = -1;
    for (const j of ok) { if (j < i) a = j; else { b = j; break; } }
    if (a < 0) ys[i] = ys[b]; else if (b < 0) ys[i] = ys[a];
    else ys[i] = ys[a] + (ys[b] - ys[a]) * (xs[i] - xs[a]) / (xs[b] - xs[a] || 1);
  }
  return ys;
}

const mean2 = (pts) => {
  let x = 0, z = 0;
  for (const p of pts) { x += p[0]; z += p[1]; }
  return [x / pts.length, z / pts.length];
};

export class GarmentSystem {
  /** @param {THREE.SkinnedMesh} bodyMesh mesh del corpo (con shape key Chest/Waist/Hips/Altezza), @param {THREE.Object3D} parent */
  constructor(bodyMesh, parent) {
    this.body = bodyMesh;
    const g = bodyMesh.geometry;
    this.n = g.attributes.position.count;
    this.base = g.attributes.position.array;
    this.nrm = g.attributes.normal.array;
    this.morphs = g.morphAttributes.position.map((a) => a.array);
    this.morphDict = bodyMesh.morphTargetDictionary;
    this.cur = new Float32Array(this.n * 3);

    // pesi "braccio" per vertice, dalle ossa a cui sono legati
    const armBone = bodyMesh.skeleton.bones.map((b) => ARM_PREFIX.some((p) => b.name.startsWith(p)));
    const si = g.attributes.skinIndex.array, sw = g.attributes.skinWeight.array;
    this.armW = new Float32Array(this.n);
    for (let v = 0; v < this.n; v++) {
      let w = 0;
      for (let k = 0; k < 4; k++) if (armBone[si[v * 4 + k]]) w += sw[v * 4 + k];
      this.armW[v] = Math.min(1, w);
    }
    let minY = Infinity, maxY = -Infinity;
    for (let v = 0; v < this.n; v++) { const y = this.base[v * 3 + 1]; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    this.y0 = minY;
    this.H0 = maxY - minY;
    this.side = new Int8Array(this.n);
    for (let v = 0; v < this.n; v++) this.side[v] = this.base[v * 3] >= 0 ? 1 : 0;   // 1 = +x
    this.binOf = new Int16Array(this.n);
    for (let v = 0; v < this.n; v++) this.binOf[v] = Math.floor((this.base[v * 3 + 1] - this.y0) / BIN);

    this._initBins();
    this._initAltitude();
    this._initTriangles(g.index.array);

    this.group = new THREE.Group();
    this.group.name = "garment";
    this.group.visible = false;
    parent.add(this.group);
    this.spec = null;
    this.meshes = [];
    this.hood = null;
    this.skirt = null;
    this.collar = null;
    this.hemBand = null;
    this.sleeveBandL = null;
    this.sleeveBandR = null;
    this.sleeveL = null;
    this.sleeveR = null;
  }

  bin(f) { return Math.floor((this.y0 + f * this.H0 - this.y0) / BIN); }

  // ── Preparazione (una volta) ───────────────────────────────────────────────
  _initBins() {
    const L = LEVELS;
    this.bT0 = this.bin(L.minHem) - 2;
    this.bT1 = this.bin(L.neck) + 4;                          // fino al collo incluso
    this.bA0 = this.bin(HAND_LEVEL);
    this.bA1 = this.bin(L.neck) + 4;
    const nT = this.bT1 - this.bT0 + 1, nA = this.bA1 - this.bA0 + 1;
    this.torsoBins = Array.from({ length: nT }, () => []);
    this.armBins = [Array.from({ length: nA }, () => []), Array.from({ length: nA }, () => [])];
    for (let v = 0; v < this.n; v++) {
      const b = this.binOf[v];
      if (this.armW[v] < 0.5) { if (b >= this.bT0 && b <= this.bT1) this.torsoBins[b - this.bT0].push(v); }
      else if (b >= this.bA0 && b <= this.bA1) this.armBins[this.side[v]][b - this.bA0].push(v);
    }
    // assi di base (centroidi x,z) per le direzioni di spostamento
    // centro del riquadro della sezione (non il baricentro dei vertici: dipende dalla densita' dei vertici e puo' cadere fuori centro)
    const axis = (list) => {
      if (!list.length) return null;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const v of list) {
        const x = this.base[v * 3], z = this.base[v * 3 + 2];
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
      }
      return [(x0 + x1) / 2, (z0 + z1) / 2];
    };
    this.torsoAxis = this.torsoBins.map(axis);
    this.armAxis = this.armBins.map((bins) => bins.map(axis));
    const fillAxis = (arr) => { for (let i = 0; i < arr.length; i++) if (!arr[i]) arr[i] = arr[i - 1] || arr.find(Boolean) || [0, 0]; };
    fillAxis(this.torsoAxis); this.armAxis.forEach(fillAxis);
    this.dirT = new Float32Array(this.n * 2);
    this.dirA = new Float32Array(this.n * 2);
    for (let v = 0; v < this.n; v++) {
      const b = this.binOf[v];
      const at = this.torsoAxis[clamp(b, this.bT0, this.bT1) - this.bT0];
      const aa = this.armAxis[this.side[v]][clamp(b, this.bA0, this.bA1) - this.bA0];
      const set = (arr, ax) => {
        let dx = this.base[v * 3] - ax[0], dz = this.base[v * 3 + 2] - ax[1];
        let l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        // lo spostamento non deve mai andare contro la normale della superficie (dove questa e' abbastanza orizzontale)
        const nx = this.nrm[v * 3], nz = this.nrm[v * 3 + 2], nh = Math.hypot(nx, nz);
        if (nh > 0.4 && dx * nx + dz * nz < 0) { dx = nx / nh; dz = nz / nh; }
        arr[v * 2] = dx; arr[v * 2 + 1] = dz;
      };
      set(this.dirT, at); set(this.dirA, aa);
    }
  }

  _initAltitude() {
    // spostamento verticale del corpo dovuto alla shape key "Altezza", in funzione della quota di base
    const idx = this.morphDict.Altezza;
    const nb = Math.ceil(this.H0 / BIN) + 2;
    const sum = new Float64Array(nb), cnt = new Uint32Array(nb);
    const arr = idx !== undefined ? this.morphs[idx] : null;
    for (let v = 0; v < this.n && arr; v++) { const b = this.binOf[v]; if (b >= 0 && b < nb) { sum[b] += arr[v * 3 + 1]; cnt[b]++; } }
    this.altY = Array.from({ length: nb }, (_, b) => (cnt[b] ? sum[b] / cnt[b] : NaN));
    fillNaN(this.altY.map((_, b) => b), this.altY);
    this.altX = this.altY.map((_, b) => this.y0 + b * BIN + BIN / 2);
  }

  _initTriangles(index) {
    const lo = this.y0 + LEVELS.minHem * this.H0 - 3 * BIN, loArm = this.y0 + HAND_LEVEL * this.H0 - 2 * BIN, hi = this.y0 + 0.90 * this.H0;
    const loShell = this.y0 + LEVELS.armpit * this.H0 - 8 * BIN;      // la shell parte dalle ascelle (piano di taglio); il margine include i triangoli alti che lo attraversano
    const body = [], shell = [], arms = [[], []];
    const used = new Set();
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t], b = index[t + 1], c = index[t + 2];
      const ys = [this.base[a * 3 + 1], this.base[b * 3 + 1], this.base[c * 3 + 1]];
      if (Math.max(...ys) > hi) continue;
      const w = (this.armW[a] + this.armW[b] + this.armW[c]) / 3;
      const minYt = Math.min(...ys);
      if (w >= 0.5) {
        if (minYt < loArm) continue;
        arms[this.side[a]].push(a, b, c);
      } else {
        if (minYt < lo) continue;
        body.push(a, b, c);                                              // busto + gambe: solo per misurare il corpo
        if (minYt < loShell) continue;
        shell.push(a, b, c);
      }
      used.add(a); used.add(b); used.add(c);
    }
    this.triParts = { torso: shell, armL: arms[1], armR: arms[0] };
    this.active = Int32Array.from(used);
    // triangoli per fetta (in base alla quota di BASE: le shape key spostano i vertici in modo continuo)
    const bucket = (list, b0, b1) => {
      const out = Array.from({ length: b1 - b0 + 1 }, () => []);
      for (let t = 0; t < list.length; t += 3) {
        const ys = [this.binOf[list[t]], this.binOf[list[t + 1]], this.binOf[list[t + 2]]];
        const lo2 = Math.max(Math.min(...ys), b0), hi2 = Math.min(Math.max(...ys), b1);
        for (let b = lo2; b <= hi2; b++) out[b - b0].push(list[t], list[t + 1], list[t + 2]);
      }
      return out;
    };
    this.sliceTorso = bucket(body, this.bT0, this.bT1);                   // corpo (per le misure)
    this.sliceShell = bucket(shell, this.bT0, this.bT1);                  // shell del capo (per misurarne il giro)
    this.sliceArm = [bucket(arms[0], this.bA0, this.bA1), bucket(arms[1], this.bA0, this.bA1)];
  }

  // ── Stato del corpo ────────────────────────────────────────────────────────
  _computeCurrent() {
    this.cur.set(this.base);
    const infl = this.body.morphTargetInfluences || [];
    for (let k = 0; k < this.morphs.length; k++) {
      const w = infl[k];
      if (!w) continue;
      const d = this.morphs[k];
      for (let i = 0; i < this.cur.length; i++) this.cur[i] += w * d[i];
    }
  }

  /** Quota corrente (m) di un livello anatomico espresso come frazione dell'altezza del corpo base. */
  yAt(f) {
    const yb = this.y0 + f * this.H0;
    const idx = this.morphDict.Altezza;
    const w = idx !== undefined ? (this.body.morphTargetInfluences?.[idx] || 0) : 0;
    return yb + w * interp(this.altX, this.altY, yb);
  }

  /** Punti (x,z) e centroide dell'intersezione dei triangoli `tris` con il piano orizzontale y (mesh corrente, o `arr`). */
  _ring(tris, y, arr) {
    const c = arr || this.cur, pts = [];
    let sx = 0, sz = 0;
    for (let t = 0; t < tris.length; t += 3) {
      const i0 = tris[t] * 3, i1 = tris[t + 1] * 3, i2 = tris[t + 2] * 3;
      const d0 = c[i0 + 1] - y, d1 = c[i1 + 1] - y, d2 = c[i2 + 1] - y;
      // un piano orizzontale taglia due lati del triangolo (o nessuno): si scorrono i tre lati senza allocare
      for (let e = 0; e < 3; e++) {
        const i = e === 0 ? i0 : e === 1 ? i1 : i2, j = e === 0 ? i1 : e === 1 ? i2 : i0;
        const di = e === 0 ? d0 : e === 1 ? d1 : d2, dj = e === 0 ? d1 : e === 1 ? d2 : d0;
        if (di * dj < 0) {
          const u = di / (di - dj);
          const x = c[i] + u * (c[j] - c[i]), z = c[i + 2] + u * (c[j + 2] - c[i + 2]);
          pts.push([x, z]); sx += x; sz += z;
        }
      }
    }
    const n = pts.length;
    return { pts, cx: n ? sx / n : NaN, cz: n ? sz / n : NaN };
  }

  /** Quota corrente del piano di una fetta (bin b), sulla mesh con le shape key applicate. */
  _binY(b) {
    const yb = this.y0 + (b + 0.5) * BIN;
    const idx = this.morphDict.Altezza;
    const w = idx !== undefined ? (this.body.morphTargetInfluences?.[idx] || 0) : 0;
    return yb + w * interp(this.altX, this.altY, yb);
  }

  _slices() {
    // busto e gambe: circonferenza "a nastro" (guscio convesso della sezione) alla quota di ogni fetta
    const yT = [], BT = [], ringsT = [];
    this.sliceTorso.forEach((tris, i) => {
      const y = this._binY(this.bT0 + i);
      const r = this._ring(tris, y);
      yT.push(y); ringsT.push(r.pts); BT.push(r.pts.length >= 6 ? hullPerimeter(r.pts) : NaN);
    });
    fillNaN(yT.map((_, i) => i), BT);
    // braccia: circonferenza e asse (centroide della sezione) per fetta
    const arms = [0, 1].map((s) => {
      const y = [], B = [], cx = [], cy = [], cz = [], pts = [];
      this.sliceArm[s].forEach((tris, i) => {
        const yy = this._binY(this.bA0 + i);
        const r = this._ring(tris, yy);
        y.push(yy); cy.push(yy); pts.push(r.pts);
        if (r.pts.length >= 6) { B.push(hullPerimeter(r.pts)); cx.push(r.cx); cz.push(r.cz); } else { B.push(NaN); cx.push(NaN); cz.push(NaN); }
      });
      const ii = y.map((_, i) => i);
      [B, cx, cz].forEach((a) => fillNaN(ii, a));
      // lunghezza d'arco dal punto della spalla verso il polso
      const bSh = clamp(this.bin(LEVELS.shoulder) - this.bA0, 0, y.length - 1);
      const sArc = new Array(y.length).fill(0);
      for (let i = bSh - 1; i >= 0; i--) sArc[i] = sArc[i + 1] + Math.hypot(cx[i] - cx[i + 1], cy[i] - cy[i + 1], cz[i] - cz[i + 1]);
      return { y, B, cx, cy, cz, sArc, bSh, pts };
    });
    return { yT, BT, ringsT, arms };
  }

  // ── Aggiornamento ──────────────────────────────────────────────────────────
  /** Configura il capo. spec = { template, resolved, color } oppure null per rimuoverlo. */
  setSpec(spec) {
    const prev = this.spec;
    this.spec = spec;
    // le mesh si ricostruiscono solo se compare/scompare il capo o cambia il tipo; altrimenti basta update()
    if (!spec || !prev || prev.template.id !== spec.template.id) this._rebuildMeshes();
    else if (prev.color !== spec.color) this.setColor(spec.color);
    this.group.visible = !!spec;
  }

  _disposeMesh(m) { m.geometry.dispose(); m.material.dispose(); this.group.remove(m); }

  _rebuildMeshes() {
    for (const m of this.meshes) this._disposeMesh(m);
    this.meshes = [];
    for (const k of ["skirt", "collar", "hemBand", "sleeveBandL", "sleeveBandR", "sleeveL", "sleeveR"]) if (this[k]) { this._disposeMesh(this[k]); this[k] = null; }
    if (this.hood) {
      this.hood.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
      this.group.remove(this.hood); this.hood = null;
    }
    if (!this.spec) return;
    const tpl = this.spec.template;
    this.posAttr = new THREE.BufferAttribute(new Float32Array(this.n * 3), 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.shellNrm = new THREE.BufferAttribute(new Float32Array(this.n * 3), 3);
    this.shellNrm.setUsage(THREE.DynamicDrawUsage);
    const nrmAttr = this.shellNrm;
    const color = new THREE.Color(this.spec.color || tpl.color);
    const material = (planes) => new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0, side: THREE.DoubleSide, clippingPlanes: planes });
    const mk = (name, idx, nPlanes) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", this.posAttr);
      geo.setAttribute("normal", nrmAttr);
      geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(idx), 1));
      const planes = Array.from({ length: nPlanes }, () => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0));
      const mat = material(planes);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = name;
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.userData.local = planes.map((p) => p.clone());
      // i clipping plane sono in spazio mondo: il wrapper ruota con lo slider, quindi si riallineano a ogni frame
      mesh.onBeforeRender = () => {
        mesh.userData.local.forEach((lp, i) => planes[i].copy(lp).applyMatrix4(this.group.matrixWorld));
      };
      this.group.add(mesh);
      this.meshes.push(mesh);
      return mesh;
    };
    if (tpl.hood) this._buildHood(color);
    if (tpl.panels) {
      // T-shirt a pannelli: busto (griglia dal girocollo all'orlo) + due maniche, senza triangoli del corpo
      this.skirt = this._buildGrid("garment-body", COLS, ROWS, color);
      this.sleeveL = this._buildGrid("garment-sleeve-L", SCOLS, SROWS, color);
      this.sleeveR = this._buildGrid("garment-sleeve-R", SCOLS, SROWS, color);
      this.collar = this._makeBand("garment-collar", COLS, color);
      this.hemBand = this._makeBand("garment-hem", COLS, color);
      this.sleeveBandL = this._makeBand("garment-cuff-L", SCOLS, color);
      this.sleeveBandR = this._makeBand("garment-cuff-R", SCOLS, color);
      return;
    }
    this.torsoMesh = mk("garment-torso", this.triParts.torso, 2);     // taglio in basso (dove inizia la gonna) + collo
    this.armMeshL = mk("garment-sleeve-L", this.triParts.armL, 2);    // fine manica + collo
    this.armMeshR = mk("garment-sleeve-R", this.triParts.armR, 2);
    this.skirt = this._buildGrid("garment-skirt", COLS, ROWS, color);
  }

  /** Griglia (cols+1) x (rows+1), topologia fissa; le posizioni si riscrivono a ogni update(). */
  _buildGrid(name, COLS, ROWS, color) {
    const nv = (COLS + 1) * (ROWS + 1);
    const geo = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(nv * 3), 3), nor = new THREE.BufferAttribute(new Float32Array(nv * 3), 3);
    pos.setUsage(THREE.DynamicDrawUsage); nor.setUsage(THREE.DynamicDrawUsage);
    const uv = new Float32Array(nv * 2), idx = new Uint32Array(COLS * ROWS * 6);
    let q = 0;
    for (let m = 0; m <= ROWS; m++) {
      for (let i = 0; i <= COLS; i++) {
        const v = m * (COLS + 1) + i;
        uv[v * 2] = i / COLS; uv[v * 2 + 1] = 1 - m / ROWS;
        if (i < COLS && m < ROWS) {
          const a = v, b = v + 1, c = v + COLS + 1, d = c + 1;
          idx.set([a, c, b, b, c, d], q); q += 6;                          // ordine tale che la normale punti verso l'esterno
        }
      }
    }
    const shade = new THREE.BufferAttribute(new Float32Array(nv * 3).fill(1), 3);
    shade.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", pos); geo.setAttribute("normal", nor); geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2)); geo.setAttribute("color", shade);
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.88, metalness: 0, side: THREE.DoubleSide, vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name; mesh.frustumCulled = false; mesh.castShadow = true;
    this.group.add(mesh);
    return mesh;
  }

  /** Bordo rifinito (colletto, orlo, fine manica): un tubo appiattito lungo una curva chiusa. Topologia fissa, posizioni riscritte a ogni update(). */
  _makeBand(name, K, color) {
    const nv = K * COLLAR_S;
    const geo = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array(nv * 3), 3), nor = new THREE.BufferAttribute(new Float32Array(nv * 3), 3);
    pos.setUsage(THREE.DynamicDrawUsage); nor.setUsage(THREE.DynamicDrawUsage);
    const idx = [];
    for (let k = 0; k < K; k++) {
      for (let s = 0; s < COLLAR_S; s++) {
        const a = k * COLLAR_S + s, b = ((k + 1) % K) * COLLAR_S + s, c = k * COLLAR_S + ((s + 1) % COLLAR_S), d = ((k + 1) % K) * COLLAR_S + ((s + 1) % COLLAR_S);
        idx.push(a, b, c, b, d, c);
      }
    }
    geo.setAttribute("position", pos); geo.setAttribute("normal", nor); geo.setIndex(idx);
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.95, metalness: 0, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name; mesh.frustumCulled = false; mesh.castShadow = true;
    mesh.userData.K = K;
    this.group.add(mesh);
    return mesh;
  }

  /**
   * Scrive un bordo lungo la curva C (K punti sul bordo del tessuto). Nn = normale del tessuto (verso l'esterno), M = direzione lungo il
   * tessuto verso l'interno del capo. Il tubo ha semi-assi a (lungo M) e b (lungo Nn) e copre l'ultimo tratto di tessuto.
   */
  _writeBand(mesh, C, Nn, M, a, b) {
    const K = mesh.userData.K;
    const pos = mesh.geometry.attributes.position.array, nor = mesh.geometry.attributes.normal.array;
    for (let k = 0; k < K; k++) {
      // il centro sta un po' dentro il bordo (cosi' il tubo lo copre) e appena sopra il tessuto
      const cx = C[k].x + Nn[k].x * b + M[k].x * a * 0.85, cy = C[k].y + Nn[k].y * b + M[k].y * a * 0.85, cz = C[k].z + Nn[k].z * b + M[k].z * a * 0.85;
      for (let s = 0; s < COLLAR_S; s++) {
        const ph = (s * TWO_PI) / COLLAR_S, cp = Math.cos(ph), sp = Math.sin(ph), p = (k * COLLAR_S + s) * 3;
        pos[p] = cx + M[k].x * a * cp + Nn[k].x * b * sp;
        pos[p + 1] = cy + M[k].y * a * cp + Nn[k].y * b * sp;
        pos[p + 2] = cz + M[k].z * a * cp + Nn[k].z * b * sp;
        const nx = M[k].x * cp / a + Nn[k].x * sp / b, ny = M[k].y * cp / a + Nn[k].y * sp / b, nz = M[k].z * cp / a + Nn[k].z * sp / b;
        const l = Math.hypot(nx, ny, nz) || 1;
        nor[p] = nx / l; nor[p + 1] = ny / l; nor[p + 2] = nz / l;
      }
    }
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.attributes.normal.needsUpdate = true;
  }

  /** Cappuccio abbassato: un cuscino piatto sulla parte alta della schiena + un anello (bordo del cappuccio) attorno al collo. */
  _buildHood(color) {
    const g = new THREE.Group();
    g.name = "garment-hood";
    const clip = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);
    const mk = (geo, planes) => {
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, side: THREE.DoubleSide, clippingPlanes: planes });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false; mesh.castShadow = true;
      g.add(mesh);
      return mesh;
    };
    const cushion = mk(new THREE.SphereGeometry(1, 40, 24), [clip]);
    const ring = mk(new THREE.TorusGeometry(1, 0.34, 18, 56), []);
    // il piano e' espresso nello spazio del gruppo del capo (non in quello, scalato, del cuscino)
    cushion.onBeforeRender = () => { clip.copy(g.userData.clip).applyMatrix4(this.group.matrixWorld); };
    g.userData = { cushion, ring, clip: clip.clone() };
    this.group.add(g);
    this.hood = g;
  }

  setColor(hex) {
    if (this.spec) this.spec.color = hex;
    for (const m of [...this.meshes, this.skirt, this.collar, this.hemBand, this.sleeveBandL, this.sleeveBandR, this.sleeveL, this.sleeveR]) if (m) m.material.color.set(hex);
    if (this.hood) this.hood.traverse((o) => { if (o.isMesh) o.material.color.set(hex); });
  }

  /** Ricalcola forma e tagli del capo sul corpo attuale. Ritorna i valori misurati per il report. */
  update() {
    const spec = this.spec;
    if (!spec || !this.posAttr) return null;
    const t = spec.template, R = spec.resolved.measures;
    this._computeCurrent();
    const { yT, BT, ringsT, arms } = this._slices();
    const nearest = (y) => yT.reduce((best, yy, i) => (Math.abs(yy - y) < Math.abs(yT[best] - y) ? i : best), 0);

    // livelli correnti
    const yHps = this.yAt(LEVELS.neck), yChest = this.yAt(LEVELS.chest), yWaist = this.yAt(LEVELS.waist);
    const yHips = this.yAt(LEVELS.hips), ySh = this.yAt(LEVELS.shoulder), yCrotch = this.yAt(LEVELS.crotch);
    const yMin = this.yAt(LEVELS.minHem) + (t.drape.hemBackDrop || 0) + 0.005;
    const jIdx = nearest(this.yAt(LEVELS.armpit));       // fetta a cui la shell (appoggiata al corpo) si unisce alla gonna (che pende)
    const yJoin = yT[jIdx];

    // lunghezza / orlo
    let lengthCm = R.length ? R.length.value : (yHps - this.yAt(t.hemLevel)) / CM;
    let yHem = yHps - lengthCm * CM;
    let lengthClamped = false;
    if (yHem < yMin) { yHem = yMin; lengthClamped = !!R.length; lengthCm = (yHps - yHem) / CM; }
    if (yHem > yJoin - 0.03) { yHem = yJoin - 0.03; lengthCm = (yHps - yHem) / CM; }     // almeno 3 cm di gonna

    // profilo circonferenza del capo G(y) (m). Per un orlo sotto il cavallo il corpo di riferimento sono i fianchi, non le due cosce
    const Bt = (y) => interp(yT, BT, y);
    const bHemRef = Bt(yHem < yCrotch ? yHips : yHem);
    const chestG = R.chest.value * CM;
    const hemG = R.hem ? R.hem.value * CM : t.hemRatio ? chestG * t.hemRatio : bHemRef + t.hemBodyEase * CM;
    const waistG = R.waist ? R.waist.value * CM : null;
    const knots = [[yHem, hemG]];
    if (waistG && yWaist > yHem + 0.02) knots.push([yWaist, waistG]);
    knots.push([Math.max(yChest, yHem + 0.05), chestG], [Math.max(yJoin, yHem + 0.06), chestG]);
    const G = (y) => interp(knots.map((k) => k[0]), knots.map((k) => k[1]), y);

    if (t.panels) {
      return this._updateTee({ t, R, yT, BT, ringsT, arms, jIdx, yJoin, yHps, yHem, yHips, yWaist, G, hemG, chestG, bHemRef, lengthCm, lengthClamped });
    }

    // ── 1. shell: ease radiale per fetta. Lo spessore del tessuto e' gia' aggiunto lungo la normale: lo si toglie qui,
    // cosi' il giro finale coincide con la misura del prodotto (salvo capo piu' stretto del corpo)
    const thick = t.thickness * CM;
    const epsSh = t.shoulderEase * CM;
    const epsJoin = Math.max(0, (chestG - BT[jIdx]) / TWO_PI - thick);
    const epsT = yT.map((y) => {
      if (y <= yJoin) return epsJoin;
      const u = clamp((y - yJoin) / Math.max(ySh - yJoin, 1e-3), 0, 1);
      const s = u * u * (3 - 2 * u);
      return epsJoin + (epsSh - epsJoin) * s;
    });

    // maniche. Un capo piu' abbondante del regular ha maniche piu' larghe (se il negozio non da' bicipite/apertura)
    const sleeveCfg = t.sleeve;
    const sleeveExtra = Math.max(0, chestG - BT[jIdx] - t.chestEase * CM) * (sleeveCfg.looseFollow || 0);
    const armInfo = arms.map((a) => {
      const bWrist = clamp(this.bin(HAND_LEVEL) - this.bA0 + 3, 0, a.y.length - 1);
      const sWrist = a.sArc[bWrist];
      const want = R.sleeve ? R.sleeve.value * CM : (Number.isFinite(sleeveCfg.length) ? sleeveCfg.length * CM : Infinity);
      const len = Math.min(want, sWrist);
      const Bs = (s) => interp([...a.sArc].reverse(), [...a.B].reverse(), s);                 // sArc decresce con l'indice
      const topG = R.bicep ? R.bicep.value * CM : Bs(0.06) + sleeveCfg.topEase * CM + sleeveExtra;
      const openG = R.sleeveOpening ? R.sleeveOpening.value * CM : Bs(len) + sleeveCfg.openingEase * CM + sleeveExtra;
      const Gs = (s) => interp([0.03, Math.max(len, 0.04)], [topG, openG], s);
      const eps = a.sArc.map((s, i) => Math.max(0, (Gs(s) - a.B[i]) / TWO_PI - thick));
      // piano di fine manica: punto sulla poligonale a distanza `len`, normale verso la spalla
      let i = 0; while (i < a.sArc.length - 1 && a.sArc[i] > len) i++;                          // primo indice con sArc <= len
      const j = Math.min(i + 1, a.sArc.length - 1), k = Math.max(i - 1, 0);
      const s0 = a.sArc[i], s1 = a.sArc[k];
      const u = s1 === s0 ? 0 : clamp((len - s0) / (s1 - s0), 0, 1);
      const p = new THREE.Vector3(a.cx[i] + u * (a.cx[k] - a.cx[i]), a.cy[i] + u * (a.cy[k] - a.cy[i]), a.cz[i] + u * (a.cz[k] - a.cz[i]));
      const dir = new THREE.Vector3(a.cx[j] - a.cx[k], a.cy[j] - a.cy[k], a.cz[j] - a.cz[k]);       // verso la spalla
      if (dir.lengthSq() < 1e-12) dir.set(0, 1, 0);
      dir.normalize();
      const loose = smoothstep(0.004, 0.03, (openG - Bs(len)) / TWO_PI);      // 0 = manica aderente, 1 = ampia: il tessuto cade sotto il braccio
      return { eps, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(dir, p), len, sWrist, sag: (sleeveCfg.sag || 0) * loose };
    });

    // posizioni dei vertici della shell (scale = correzione dell'ease del busto)
    const out = this.posAttr.array, cur = this.cur;
    const place = (scale) => {
      for (const v of this.active) {
        const b = this.binOf[v];
        const a = this.armW[v];
        const bt = clamp(b, this.bT0, this.bT1) - this.bT0;
        let eps = epsT[bt] * scale;
        let dx = this.dirT[v * 2], dz = this.dirT[v * 2 + 1];
        if (a > 0) {
          const ai = armInfo[this.side[v]];
          // sotto il braccio il tessuto cade (piu' ease), sopra poggia (meno): l'ease medio resta quello del capo
          const ea = ai.eps[clamp(b, this.bA0, this.bA1) - this.bA0] * clamp(1 - ai.sag * this.nrm[v * 3 + 1], 0.25, 2);
          eps = (1 - a) * eps + a * ea;
          dx = (1 - a) * dx + a * this.dirA[v * 2]; dz = (1 - a) * dz + a * this.dirA[v * 2 + 1];
          const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
        }
        out[v * 3] = cur[v * 3] + dx * eps + this.nrm[v * 3] * thick;
        out[v * 3 + 1] = cur[v * 3 + 1] + this.nrm[v * 3 + 1] * thick;
        out[v * 3 + 2] = cur[v * 3 + 2] + dz * eps + this.nrm[v * 3 + 2] * thick;
      }
    };
    place(1);
    // Feedback: spostare i vertici in direzione radiale su una sezione ellittica allunga il perimetro meno di 2π·ease.
    // Si misura il giro reale della shell al torace e si riscala l'ease perche' coincida con la misura del prodotto.
    const ringOf = (list, i, y) => this._ring(list[i], y, out);
    const need = chestG - BT[jIdx];
    if (need > TWO_PI * thick + 0.005) {
      const r = ringOf(this.sliceShell, jIdx, yJoin);
      const got = r.pts.length >= 6 ? hullPerimeter(r.pts) : NaN;
      const f = clamp(need / (got - BT[jIdx]), 0.85, 1.6);
      if (Number.isFinite(f) && Math.abs(f - 1) > 0.01) place(f);
    }
    this.posAttr.needsUpdate = true;
    this._shellNormals();

    // ── 2. gonna: dal giro della shell al torace fino all'orlo
    const skirtInfo = this._updateSkirt({ t, yT, ringsT, arms, jIdx, yJoin, yHem, G, hemG, thick, out, chestG, bHemRef });

    // ── 3. girocollo (T-shirt) oppure taglio piatto (hoodie: il collo e' coperto dal cappuccio)
    const neck = new THREE.Plane(new THREE.Vector3(0, -1, 0), yHps);      // tiene sotto il collo

    // cappuccio: dimensionato sulla sezione corrente del collo e della schiena
    if (this.hood) {
      const nb = (yy) => clamp(Math.round((yy - this.y0) / BIN) - this.bT0, 0, this.sliceTorso.length - 1);
      const neckR = this._ring(this.sliceTorso[nb(yHps)], yHps);
      const upper = this._ring(this.sliceTorso[nb(yHps - 0.07)], yHps - 0.07);
      const ok = (r) => r.pts.length >= 6 && Number.isFinite(r.cx);
      const cx = ok(neckR) ? neckR.cx : 0, cz = ok(neckR) ? neckR.cz : 0;
      const nr = ok(neckR) ? hullPerimeter(neckR.pts) / TWO_PI : 0.1;
      const zBack = ok(upper) ? Math.min(...upper.pts.map((p) => p[1])) : cz - 0.1;
      const { cushion, ring } = this.hood.userData;
      cushion.position.set(cx, yHps - 0.055, zBack + 0.012);
      cushion.scale.set(0.155, 0.105, 0.055);
      cushion.rotation.set(-0.1, 0, 0);
      ring.position.set(cx, yHps + 0.004, cz);
      ring.rotation.set(Math.PI / 2, 0, 0);
      ring.scale.set(nr * 0.86 * 1.12, nr * 0.86, nr * 0.86);
      this.hood.userData.clip.set(new THREE.Vector3(0, 0, -1), cz - nr * 0.2);   // il cuscino resta dietro al collo
    }

    // tagli: la shell finisce dove inizia la gonna; il collo; la fine delle maniche
    const join = new THREE.Plane(new THREE.Vector3(0, 1, 0), -yJoin);     // tiene sopra la giunzione
    this.torsoMesh.userData.local[0].copy(join); this.torsoMesh.userData.local[1].copy(neck);
    this.armMeshL.userData.local[0].copy(armInfo[1].plane); this.armMeshL.userData.local[1].copy(neck);
    this.armMeshR.userData.local[0].copy(armInfo[0].plane); this.armMeshR.userData.local[1].copy(neck);

    const sl = (armInfo[0].len + armInfo[1].len) / 2, sw = (armInfo[0].sWrist + armInfo[1].sWrist) / 2;
    return {
      gChest: chestG / CM, gWaist: G(yWaist) / CM, gHem: hemG / CM, bHem: bHemRef / CM,
      lengthCm, lengthClamped, lengthRequestedCm: R.length ? R.length.value : null, hemVsHipsCm: (yHem - yHips) / CM,
      sleeveCm: sl / CM, sleeveEndRatio: sw > 0 ? sl / sw : null,
      levels: { yHps, yHem, yChest, yWaist, yHips },
      drape: skirtInfo,
    };
  }

  /** Normali della shell dalla geometria reale (media delle facce, pesata per l'area): il capo non ha le normali del corpo. */
  _shellNormals() {
    const p = this.posAttr.array, nr = this.shellNrm.array;
    for (const v of this.active) nr[v * 3] = nr[v * 3 + 1] = nr[v * 3 + 2] = 0;
    for (const list of [this.triParts.torso, this.triParts.armL, this.triParts.armR]) {
      for (let t = 0; t < list.length; t += 3) {
        const a = list[t] * 3, b = list[t + 1] * 3, c = list[t + 2] * 3;
        const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2];
        const vx = p[c] - p[a], vy = p[c + 1] - p[a + 1], vz = p[c + 2] - p[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const k of [a, b, c]) { nr[k] += nx; nr[k + 1] += ny; nr[k + 2] += nz; }
      }
    }
    for (const v of this.active) {
      const i = v * 3;
      let x = nr[i], y = nr[i + 1], z = nr[i + 2];
      const l = Math.hypot(x, y, z) || 1;
      x /= l; y /= l; z /= l;
      if (x * this.nrm[i] + y * this.nrm[i + 1] + z * this.nrm[i + 2] < 0) { x = -x; y = -y; z = -z; }     // verso l'esterno, come il corpo
      nr[i] = x; nr[i + 1] = y; nr[i + 2] = z;
    }
    this.shellNrm.needsUpdate = true;
  }

  /** Normali di una griglia (colonne = angolo attorno al busto, righe verso il basso): differenze finite con avvolgimento, verso l'esterno. */
  _gridNormals(mesh, COLS, ROWS) {
    const pos = mesh.geometry.attributes.position.array, nor = mesh.geometry.attributes.normal.array;
    const P = (i, m) => (m * (COLS + 1) + i) * 3;
    for (let i = 0; i <= COLS; i++) {
      const il = (i - 1 + COLS) % COLS, ir = (i + 1) % COLS, c = i % COLS;
      const th = (c * TWO_PI) / COLS, ox = Math.sin(th), oz = Math.cos(th);
      for (let m = 0; m <= ROWS; m++) {
        const a = P(il, m), b = P(ir, m), u = P(i, Math.max(m - 1, 0)), dn = P(i, Math.min(m + 1, ROWS));
        const tx = pos[b] - pos[a], ty = pos[b + 1] - pos[a + 1], tz = pos[b + 2] - pos[a + 2];      // lungo θ
        const vx = pos[dn] - pos[u], vy = pos[dn + 1] - pos[u + 1], vz = pos[dn + 2] - pos[u + 2];   // verso il basso
        let nx = vy * tz - vz * ty, ny = vz * tx - vx * tz, nz = vx * ty - vy * tx;
        const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
        const s = nx * ox + nz * oz < 0 ? -1 : 1;
        const p = P(i, m); nor[p] = nx * s; nor[p + 1] = ny * s; nor[p + 2] = nz * s;
      }
    }
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.attributes.normal.needsUpdate = true;
  }

  /**
   * T-shirt a pannelli. Il busto e' una griglia unica dal girocollo all'orlo:
   *  - sopra le ascelle la sezione e' quella del corpo con spalle (busto + spalle), piu' l'ease che porta il giro al torace del capo:
   *    le spalle sono "cadenti" perche' il capo copre anche la parte alta del braccio, e l'ease cala verso il collo;
   *  - sotto le ascelle il tessuto pende (drape.js, come prima);
   *  - il bordo alto e' un cerchio attorno al collo, con una piccola scollatura davanti, e il colletto lo copre.
   * Le maniche sono tronchi di cono attorno all'asse del braccio.
   */
  _updateTee({ t, R, yT, BT, ringsT, arms, jIdx, yJoin, yHps, yHem, yHips, yWaist, G, hemG, chestG, bHemRef, lengthCm, lengthClamped }) {
    const thick = t.thickness * CM;
    const sl = this._updateSleeves({ t, R, arms, chestG, bChest: BT[jIdx], thick });
    const upper = this._teeUpper({ t, yT, ringsT, arms, jIdx, yJoin, yHps, thick, chestG });
    let drape = null;
    if (upper && sl) {
      // il giro alle ascelle e' quello della sezione costruita: il profilo parte da li' e raggiunge il giro del torace entro 5,5 cm (il torace resta esatto)
      const dP = ringPerimeter(upper.rows[upper.rows.length - 1].r) - chestG;
      const G2 = (y) => G(y) + dP * (1 - smoothstep(0, 0.055, yJoin - y));
      drape = this._updateSkirt({ t, yT, ringsT, arms, jIdx, yJoin, yHem, G: G2, hemG, thick, out: null, chestG, bHemRef, upper });
    } else this.skirt.visible = false;
    return {
      gChest: chestG / CM, gWaist: G(yWaist) / CM, gHem: hemG / CM, bHem: bHemRef / CM,
      lengthCm, lengthClamped, lengthRequestedCm: R.length ? R.length.value : null, hemVsHipsCm: (yHem - yHips) / CM,
      sleeveCm: sl ? sl.len / CM : null, sleeveEndRatio: sl && sl.sWrist > 0 ? sl.len / sl.sWrist : null,
      levels: { yHps, yHem, yChest: this.yAt(LEVELS.chest), yWaist, yHips },
      drape,
    };
  }

  /** Sezioni del busto dalle ascelle al collo + bordo alto circolare. */
  _teeUpper({ t, yT, ringsT, arms, jIdx, yJoin, yHps, thick, chestG }) {
    const N = COLS, nl = t.neckline;
    const ring0 = ringsT[jIdx];
    if (ring0.length < 6) return null;
    const [ax, az] = mean2(ring0);
    const nearest = (y) => clamp(Math.round((y - yT[0]) / BIN), 0, yT.length - 1);
    const iTop = nearest(yHps + 0.02);
    // il limite inferiore e' il guscio di busto + braccia: sopra le ascelle il capo copre anche le spalle
    const bodyR = (i) => {
      const pts = ringsT[i].slice();
      for (let s = 0; s < 2; s++) { const ai = this.bT0 + i - this.bA0; if (ai >= 0 && ai < arms[s].pts.length) pts.push(...arms[s].pts[ai]); }
      const r = hullRadial(convexHull(pts), ax, az, N);
      for (let k = 0; k < N; k++) r[k] += thick;
      return r;
    };
    // ease all'altezza delle ascelle: quello che porta il giro del capo a quello del torace (mai negativo)
    const rA = bodyR(jIdx);
    let lo = 0, hi = 0.1;
    if (ringPerimeter(rA) < chestG) {
      for (let it = 0; it < 30; it++) {
        const mid = (lo + hi) / 2, tmp = rA.map((v) => v + mid);
        if (ringPerimeter(tmp) < chestG) lo = mid; else hi = mid;
      }
    } else hi = 0;
    const epsArm = Math.max(hi, t.shoulderEase * CM), epsTop = nl.epsTop;      // spalle cadenti: il busto e' sempre piu' largo del braccio
    const rows = [];
    for (let i = iTop; i >= jIdx; i--) {
      const u = clamp((yT[i] - yJoin) / Math.max(yHps - yJoin, 1e-3), 0, 1);
      const uu = Math.min(1, Math.max(0, u - 0.2) * 2.1), eps = epsArm + (epsTop - epsArm) * (uu * uu * (3 - 2 * uu));      // l'ease cala in fretta: niente cuscinetto sulle spalle
      const r = bodyR(i);
      for (let k = 0; k < N; k++) r[k] += eps;
      rows.push({ y: yT[i], r });
    }
    // bordo alto: cerchio attorno al collo, piu' basso davanti (scollatura) che dietro
    const iN = nearest(yHps + 0.005);
    const nRing = ringsT[iN];
    const nc = nRing.length >= 6 ? mean2(nRing) : [ax, az];
    const neckR = nRing.length >= 6 ? hullPerimeter(nRing) / TWO_PI : 0.06;
    const Rn = clamp(neckR + nl.gap, 0.075, 0.11);
    const yTopCols = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      const c = Math.cos((i * TWO_PI) / N);
      yTopCols[i] = yHps - nl.front * Math.pow(Math.max(c, 0), 2) - nl.back * Math.pow(Math.max(-c, 0), 2);
    }
    return { rows, axis: [ax, az], nc, Rn, yTopCols, blend: nl.blend, capBelow: -Infinity };   // capBelow: la maglia non e' limitata dalle braccia (il busto e' largo quanto le spalle cadenti)
  }

  /** Maniche: tronchi di cono attorno all'asse del braccio (sezioni orizzontali), con apertura che cresce con la vestibilita' del capo. */
  _updateSleeves({ t, R, arms, chestG, bChest, thick }) {
    const sc = t.sleeve, N = SCOLS;
    const sleeveExtra = Math.max(0, chestG - bChest - t.chestEase * CM) * (sc.looseFollow || 0);
    let yEnd = Infinity, len = 0, sWristSum = 0, ok = true;
    for (let s = 0; s < 2; s++) {
      const a = arms[s], mesh = s === 1 ? this.sleeveL : this.sleeveR, band = s === 1 ? this.sleeveBandL : this.sleeveBandR;
      const iTop = Math.max(a.bSh - 6, 1);                      // la manica nasce sotto la linea della spalla, nascosta dal busto: il tratto sopra e' del busto
      const bWrist = clamp(this.bin(HAND_LEVEL) - this.bA0 + 3, 0, a.y.length - 1);
      const sWrist = a.sArc[bWrist];
      const want = R.sleeve ? R.sleeve.value * CM : (Number.isFinite(sc.length) ? sc.length * CM : Infinity);
      const L = Math.min(want, sWrist);
      let iEnd = iTop;
      while (iEnd > 0 && a.sArc[iEnd] < L) iEnd--;
      if (iTop - iEnd < 2) { mesh.visible = false; band.visible = false; ok = false; continue; }
      mesh.visible = true; band.visible = true;
      const Bs = (d) => interp([...a.sArc].reverse(), [...a.B].reverse(), d);
      const topG = R.bicep ? R.bicep.value * CM : Bs(0.06) + sc.topEase * CM + sleeveExtra;
      const openG = R.sleeveOpening ? R.sleeveOpening.value * CM : Bs(L) + sc.openingEase * CM + sleeveExtra;
      const sign = s === 1 ? 1 : -1;
      const rows = [];
      for (let i = iTop; i >= iEnd; i--) {
        const pts = a.pts[i];
        if (pts.length < 6) continue;
        const s = a.sArc[i] - a.sArc[iTop];
        const wide = interp([0.03, Math.max(L, 0.04)], [topG, openG], a.sArc[i]);
        const g = a.B[i] + (wide - a.B[i]) * smoothstep(0, 0.09, s);     // parte aderente al braccio e si apre in pochi cm
        const hull = hullRadial(convexHull(pts), a.cx[i], a.cz[i], N);
        const Rc = g / TWO_PI, off = 0.3 * Math.max(0, Rc - a.B[i] / TWO_PI) * sign;      // la manica si allarga verso l'esterno
        const r = new Float64Array(N);
        for (let k = 0; k < N; k++) r[k] = Math.max(hull[k] + thick, Rc);
        rows.push({ y: a.y[i], cx: a.cx[i] + off, cz: a.cz[i], r });
      }
      if (rows.length < 2) { mesh.visible = false; band.visible = false; ok = false; continue; }
      const pos = mesh.geometry.attributes.position.array, P = (i, m) => (m * (SCOLS + 1) + i) * 3;
      for (let m = 0; m <= SROWS; m++) {
        const f = (m / SROWS) * (rows.length - 1), k = Math.min(Math.floor(f), rows.length - 2), u = f - k, A = rows[k], B = rows[k + 1];
        for (let i = 0; i <= SCOLS; i++) {
          const c = i % SCOLS, th = (c * TWO_PI) / SCOLS, r = A.r[c] + u * (B.r[c] - A.r[c]), p = P(i, m);
          pos[p] = A.cx + u * (B.cx - A.cx) + r * Math.sin(th);
          pos[p + 1] = A.y + u * (B.y - A.y);
          pos[p + 2] = A.cz + u * (B.cz - A.cz) + r * Math.cos(th);
        }
      }
      this._gridNormals(mesh, SCOLS, SROWS);
      const nor = mesh.geometry.attributes.normal.array, C = [], Nn = [], M = [];
      for (let i = 0; i < SCOLS; i++) {                                     // polsino: bordo rifinito in fondo alla manica
        const p = P(i, SROWS), q = P(i, SROWS - 2);
        C.push(new THREE.Vector3(pos[p], pos[p + 1], pos[p + 2]));
        Nn.push(new THREE.Vector3(nor[p], nor[p + 1], nor[p + 2]));
        M.push(new THREE.Vector3(pos[q] - pos[p], pos[q + 1] - pos[p + 1], pos[q + 2] - pos[p + 2]).normalize());
      }
      this._writeBand(band, C, Nn, M, t.bands.sleeve.width / 2, t.bands.sleeve.thickness / 2);
      yEnd = Math.min(yEnd, rows[rows.length - 1].y); len += L / 2; sWristSum += sWrist / 2;
    }
    return ok ? { yEnd, len, sWrist: sWristSum } : null;
  }

  /** Scrive nella gonna le posizioni dalla giunzione con la shell fino all'orlo. Ritorna metriche per il report/test. */
  _updateSkirt({ t, yT, ringsT, arms, jIdx, yJoin, yHem, G, hemG, thick, out, chestG, bHemRef, upper = null }) {
    const dr = t.drape;
    const N = COLS;
    let ax, az, r0;
    if (upper) {                                          // T-shirt a pannelli: la parte alta e' gia' costruita
      [ax, az] = upper.axis;
      r0 = upper.rows[upper.rows.length - 1].r;
    } else {
      const top = this._ring(this.sliceShell[jIdx], yJoin, out).pts;
      if (top.length < 12) { this.skirt.visible = false; return null; }
      [ax, az] = mean2(top);
      r0 = starRadial(top, ax, az, N);
    }
    this.skirt.visible = true;

    // orlo: piu' alto ai fianchi e piu' lungo dietro se il capo e' ampio
    const easeHem = Math.max(0, (hemG - bHemRef) / TWO_PI);
    const loose = smoothstep(0.004, 0.03, easeHem);
    const yHemCols = hemHeights(N, yHem, { sideRise: dr.hemSideRise, backDrop: dr.hemBackDrop, loose });
    const foldCount = clamp(Math.round(chestG / dr.foldWave / 2) * 2, 8, 30);
    const foldSpec = { gain: dr.foldGain, max: dr.foldMax };
    const hemAmp = foldAmplitude(hemG, bHemRef, foldSpec, 1);
    if (hemAmp > 1e-5) {                                                  // le creste delle pieghe pendono piu' in basso delle valli
      const p = foldPattern(N, foldCount, dr.foldTilt * (yJoin - yHem));
      for (let i = 0; i < N; i++) yHemCols[i] -= dr.hemWave * hemAmp * p[i];
    }
    let yLowest = Infinity;
    for (const y of yHemCols) yLowest = Math.min(yLowest, y);

    // Raggio minimo (corpo + spessore) e ostacoli (braccia) per ogni fetta, dall'alto verso il basso
    const w = slackWeights(N, dr.lateral);
    const rows = [{ y: yJoin, base: r0 }];
    let rbLast = null;
    for (let i = jIdx - 1; i >= 0; i--) {
      const y = yT[i];
      const pts = ringsT[i];
      const d = yJoin - y;
      let rb;
      if (pts.length >= 6) {
        // Alla giunzione il tessuto segue la superficie reale del corpo (come la shell sopra); scendendo passa al guscio convesso
        // ("nastro"), che scavalca le concavita' (solco dello sterno, colonna vertebrale). Il passaggio e' graduale: niente gradino.
        const hull = hullRadial(convexHull(pts), ax, az, N);
        rb = new Float64Array(N);
        if (d < dr.hullBlend) {
          const star = starRadial(pts, ax, az, N), s = smoothstep(0, dr.hullBlend, d);
          for (let k = 0; k < N; k++) rb[k] = Math.min(hull[k], star[k] + s * (hull[k] - star[k]) + 1e-9) + thick;
        } else for (let k = 0; k < N; k++) rb[k] = hull[k] + thick;
        rbLast = rb;
      } else if (rbLast) rb = rbLast; else break;
      // braccia: ostacoli per l'espansione dei fianchi
      let caps = null;
      for (let s = 0; s < 2; s++) {
        const ai = this.bT0 + i - this.bA0;
        if (upper && y > upper.capBelow) continue;                  // dove il braccio e' dentro la manica il busto puo' passargli attorno
        if (ai < 0 || ai >= arms[s].pts.length || arms[s].pts[ai].length < 6) continue;
        const e = hullEntry(convexHull(arms[s].pts[ai]), ax, az, N);
        if (!caps) caps = new Float64Array(N).fill(Infinity);
        for (let k = 0; k < N; k++) caps[k] = Math.min(caps[k], e[k] - 0.002);
      }
      rows.push({ y, rb, caps, d });
      if (y < yLowest - 0.012) break;
    }
    // Un rilievo stretto (ombelico, cucitura) puo' passare tra due fette: il raggio minimo di una fetta e' il massimo tra la sua e le vicine
    for (let j = 1; j < rows.length; j++) {
      const a = rows[j - 1].rb, c = rows[j + 1]?.rb, b = rows[j].rb, keep = Float64Array.from(b);
      for (let k = 0; k < N; k++) b[k] = Math.max(keep[k], c ? c[k] : 0, j > 1 ? a[k] : 0);
    }
    // Passo 1: il tessuto pende da sopra e non entra nel corpo (nessuna piega)
    for (let j = 1; j < rows.length; j++) {
      const row = rows[j], prevRow = rows[j - 1];
      // solo la sagoma di caduta: il tessuto non rientra piu' di kappa·dy e non entra nel corpo. Il giro lo impone il passo 3
      const env = new Float64Array(N), drop = dr.kappa * (prevRow.y - row.y);
      for (let k = 0; k < N; k++) env[k] = Math.max(row.rb[k], prevRow.base[k] - drop);
      row.base = env;
    }
    // Passo 2: un tessuto teso e' piu' liscio del corpo che copre (non segue il gradino dei glutei): si rilassa il profilo verticale
    // tenendolo fuori dal corpo. Passo 3: si ripristina il giro esatto, aggiungendo le pieghe dove c'e' tessuto in eccesso.
    for (let it = 0; it < dr.relax; it++) {
      for (let j = 1; j < rows.length - 1; j++) {
        const a = rows[j - 1].base, b = rows[j].base, c = rows[j + 1].base, rb = rows[j].rb;
        for (let k = 0; k < N; k++) { const s = 0.25 * a[k] + 0.5 * b[k] + 0.25 * c[k]; if (s > b[k]) b[k] = s; }   // solo verso l'esterno: il perimetro lo fissa il passo 3
        for (let k = 0; k < N; k++) if (b[k] < rb[k]) b[k] = rb[k];
      }
    }
    const up = upper ? upper.rows.slice(0, -1) : [];
    const rowsY = [...up.map((r) => r.y), yJoin], rowsR = [...up.map((r) => r.r), r0], rowsS = [...up.map(() => new Float64Array(N).fill(1)), new Float64Array(N).fill(1)];
    let tightRows = 0, gatheredRows = 0;
    const bodyPer = (rb) => ringPerimeter(rb) - TWO_PI * thick;         // giro del corpo (senza lo spessore del tessuto)
    for (let j = 1; j < rows.length; j++) {
      const { y, rb, caps, d, base } = rows[j];
      const ramp = smoothstep(dr.foldStart, dr.foldFull, d);
      const amp = foldAmplitude(G(y), bodyPer(rb), foldSpec, ramp);
      const fold = amp > 1e-5 ? { pattern: foldPattern(N, foldCount, dr.foldTilt * d), amp } : null;
      const res = solveRing({ rb, prev: base, G: G(y), dy: 0, kappa: 0, w, caps, fold });
      if (res.tight) tightRows++;
      if (res.gathered) gatheredRows++;
      // occlusione ambientale approssimata: le valli delle pieghe sono piu' scure
      const sh = new Float64Array(N).fill(1);
      if (fold) {                                          // scurisce solo le valli dove le pieghe sono davvero marcate
        for (let k = 0; k < N; k++) {
          const s = Math.sin((k * TWO_PI) / N), local = amp * (0.15 + 0.85 * s * s);
          sh[k] = 1 - dr.foldShade * Math.min(1, local / dr.foldMax) * (1 - Math.min(1, (res.r[k] - res.base[k]) / (local + 1e-9)));
        }
      }
      rowsY.push(y); rowsR.push(res.r); rowsS.push(sh);
    }

    // vertici: colonna i da yJoin fino all'orlo di quella colonna
    const pos = this.skirt.geometry.attributes.position.array;
    const P = (i, m) => (m * (COLS + 1) + i) * 3;
    const colors = this.skirt.geometry.attributes.color.array;
    const radiusAt = (i, y, m) => {
      let j = 0;
      while (j < rowsY.length - 2 && rowsY[j + 1] > y) j++;
      if (rowsY.length < 2) return rowsR[0][i];
      const u = clamp((rowsY[j] - y) / (rowsY[j] - rowsY[j + 1] || 1), 0, 1);
      const s = rowsS[j][i] + u * (rowsS[j + 1][i] - rowsS[j][i]);
      const c = (m * (COLS + 1) + i) * 3, cc = (m * (COLS + 1) + COLS) * 3;
      colors[c] = colors[c + 1] = colors[c + 2] = s;
      if (i === 0) colors[cc] = colors[cc + 1] = colors[cc + 2] = s;         // la colonna di chiusura ripete la prima
      return rowsR[j][i] + u * (rowsR[j + 1][i] - rowsR[j][i]);
    };
    for (let i = 0; i <= COLS; i++) {
      const c = i % COLS, th = (c * TWO_PI) / COLS, sn = Math.sin(th), cs = Math.cos(th);
      for (let m = 0; m <= ROWS; m++) {
        const yTop = upper ? upper.yTopCols[c] : yJoin;
        let y = yTop + (yHemCols[c] - yTop) * (m / ROWS);
        if (upper) {                                       // righe piu' fitte sulle spalle, dove la sezione cambia in fretta
          const Lc = yTop - yHemCols[c], h = Math.min(0.14, 0.3 * Lc), f = m / ROWS;
          y = yTop - (f < 0.4 ? (h * f) / 0.4 : h + ((Lc - h) * (f - 0.4)) / 0.6);
        }
        const r = radiusAt(c, y, m), p = P(i, m);
        pos[p] = ax + r * sn; pos[p + 1] = y; pos[p + 2] = az + r * cs;
        if (upper) {                                       // il bordo alto e' un cerchio: i vertici vicini al bordo vi convergono
          const wgt = 1 - smoothstep(0, upper.blend, yTop - y);
          pos[p] += (upper.nc[0] + upper.Rn * sn - pos[p]) * wgt;
          pos[p + 2] += (upper.nc[1] + upper.Rn * cs - pos[p + 2]) * wgt;
        }
      }
    }
    this._gridNormals(this.skirt, COLS, ROWS);
    const nor = this.skirt.geometry.attributes.normal.array;
    this.skirt.geometry.attributes.position.needsUpdate = true;
    this.skirt.geometry.attributes.normal.needsUpdate = true;
    this.skirt.geometry.attributes.color.needsUpdate = true;
    if (this.hemBand) {
      const C = [], Nn = [], M = [];
      for (let i = 0; i < COLS; i++) {
        const p = P(i, ROWS), q = P(i, ROWS - 2);
        C.push(new THREE.Vector3(pos[p], pos[p + 1], pos[p + 2]));
        Nn.push(new THREE.Vector3(nor[p], nor[p + 1], nor[p + 2]));
        M.push(new THREE.Vector3(pos[q] - pos[p], pos[q + 1] - pos[p + 1], pos[q + 2] - pos[p + 2]).normalize());     // lungo il tessuto, verso l'alto
      }
      this._writeBand(this.hemBand, C, Nn, M, t.bands.hem.width / 2, t.bands.hem.thickness / 2);
    }
    if (upper) {                                            // colletto a costina lungo il bordo alto
      const C = [], Nn = [], M = [];
      for (let i = 0; i < COLS; i++) {
        const th = (i * TWO_PI) / COLS, p = P(i, 0), q = P(i, 3);
        C.push(new THREE.Vector3(pos[p], pos[p + 1], pos[p + 2]));
        Nn.push(new THREE.Vector3(Math.sin(th), 0.55, Math.cos(th)).normalize());
        M.push(new THREE.Vector3(pos[q] - pos[p], pos[q + 1] - pos[p + 1], pos[q + 2] - pos[p + 2]).normalize());     // lungo il tessuto, verso il basso
      }
      this._writeBand(this.collar, C, Nn, M, t.neckline.collar.width / 2, t.neckline.collar.thickness / 2);
    }
    return { rows: rowsY.length, tightRows, gatheredRows, loose, foldCount, axis: [ax, az] };
  }

  dispose() {
    this._rebuildMeshes();
    this.spec = null;
    this.group.parent?.remove(this.group);
  }
}
