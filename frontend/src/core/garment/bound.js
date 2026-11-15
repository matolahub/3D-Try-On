// Capo 3D reale legato al corpo ("body-bound"): funzioni PURE (nessuna dipendenza da Three.js), testabili in node.
//
// Il GLB del capo e' UNA cloth sim sul corpo neutro. Qui il capo viene adattato al corpo corrente SENZA shape key del capo e senza
// somme lineari: ad ogni cambio di misure si rilegge la forma vera del corpo (tutte le misure insieme) e si ricalcola il capo.
// Tre regole, scelte per zona del capo e sfumate tra loro:
//
//   APPOGGIO  dove il tessuto poggia sul corpo dall'alto (spalle, trapezio, colletto): segue la pelle sottostante
//             (media pesata degli spostamenti dei vertici del corpo piu' vicini).
//   CADUTA    il resto del busto pende dalle spalle. In coordinate polari attorno all'asse del busto:
//               quota   = quota a riposo + spostamento verticale delle spalle (il capo non si allunga con l'altezza) + risalita
//               raggio  = corpo "drappeggiato" R(quota, θ) + s · (ease a riposo)
//             R e' il guscio convesso della sezione del corpo, con la regola di caduta verticale di drape.js (il tessuto non rientra
//             sotto una sporgenza piu' di KAPPA). s (0..) e' scelto fetta per fetta perche' il GIRO del tessuto resti quello della sim:
//             corpo piu' grande -> s < 1 (l'ease e le pieghe si consumano); s = 0 -> il capo e' teso sul corpo ("stretto").
//             La risalita conserva la lunghezza del tessuto lungo il meridiano: una pancia sporgente alza l'orlo davanti.
//   MANICA    nel riferimento del braccio (spalla -> gomito, ricavato dai vertici del corpo): la manica ruota e trasla rigidamente
//             col braccio; il raggio attorno all'asse segue lo spessore del braccio conservando il giro della manica.
//
// Con il corpo neutro ogni regola restituisce esattamente la posizione della sim. Unita': metri, Y in alto, fronte verso +Z.

import { convexHull, hullRadial, ringPerimeter, smoothstep } from "./drape.js";

export const N_DIR = 96;             // direzioni attorno all'asse del busto
export const LEVEL_DY = 0.012;       // passo verticale delle fette (m)
const GAP = 0.004;                   // distanza minima tessuto-corpo (m)
const S_MAX = 1.2;                   // corpo piu' piccolo del neutro: l'ease in piu' non gonfia le pieghe oltre il 20% (il tessuto in eccesso pende)
// Sicurezza sui vertici del corpo legati A RIPOSO: SPENTA. Confronta il capo con il piano tangente di punti di pelle lontani fino a SAFE_LAT
// (2,5 cm): su una zona convessa (spalla, petto) quel piano passa sopra la superficie vera e la regola vedeva violazioni di 6-9 mm che non
// esistono, anche con un corpo piu' PICCOLO del neutro (petto 84: 2500 vertici spinti -> capo a bozzi). La protezione vera e' la sicurezza
// sulla forma corrente (piu' sotto), che guarda solo la pelle direttamente sotto il vertice (SKIN_LAT).
const REST_SAFETY = false;
const DISP_SMOOTH = 5;                // passate di media sulla maglia dello spostamento del capo rispetto alla sim
const SKIN_FOLLOW_SMOOTH = 6;         // passate di media sulla maglia dello spostamento della pelle seguito dal tessuto che poggia
const SAFETY_SPREAD = 4;              // passate con cui una spinta di sicurezza si propaga ai vertici vicini
const DRAPE_SMOOTH = 3;               // passate di media verticale (1-2-1) sulla sagoma drappeggiata
const SKIN_MIN = 0.003;              // distanza minima dalla pelle garantita sulla forma corrente del corpo (m)
const SKIN_SLACK = 0.0005;           // margine sotto la distanza a riposo prima che la sicurezza intervenga (m)
const SKIN_LAT = 0.015;              // un vertice del corpo conta come "sotto" il tessuto entro questo scarto laterale (m)
const SKIN_CELL = 0.03;              // lato delle celle della griglia dei vertici del corpo (m): un vertice del capo guarda solo entro questa distanza
const SAFE_LAT = 0.025;               // raggio laterale (m) entro cui un vertice del corpo conta come "sotto" il tessuto
const KAPPA = 0.15;                  // rientro massimo del tessuto in caduta (m per m)
const ARM_PREFIX = ["upperarm", "lowerarm", "wrist", "finger", "metacarpal", "shoulder"];
const TWO_PI = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** Peso "braccio" per vertice dai dati di skinning (nomi delle ossa, indici e pesi a gruppi di 4). */
export function armWeights(boneNames, skinIndex, skinWeight, n) {
  const isArm = boneNames.map((b) => ARM_PREFIX.some((p) => b.startsWith(p)));
  const w = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    let s = 0;
    for (let k = 0; k < 4; k++) if (isArm[skinIndex[v * 4 + k]]) s += skinWeight[v * 4 + k];
    w[v] = Math.min(1, s);
  }
  return w;
}

function vertexNormals(pos, index) {
  const n = new Float32Array(pos.length);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { n[i] += nx; n[i + 1] += ny; n[i + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

function lerpArr(a, x) {                   // a[floor(x)] .. a[ceil(x)], x in indici frazionari, con estremi bloccati
  const n = a.length;
  if (x <= 0) return a[0];
  if (x >= n - 1) return a[n - 1];
  const i = Math.floor(x), t = x - i;
  return a[i] + t * (a[i + 1] - a[i]);
}

/** Corpo parametrico: geometria di base + shape key (delta) + pesi delle braccia. */
export class BodyModel {
  /**
   * @param {{ position: Float32Array, index: ArrayLike<number>, morphs: Object<string, Float32Array>, armW: Float32Array }} d
   *   morphs = spostamenti per vertice (come i morph target relativi di glTF)
   */
  constructor({ position, index, morphs, armW }) {
    this.base = position;
    this.index = index;
    this.morphs = morphs;
    this.armW = armW;
    this.n = position.length / 3;
    this.normal = vertexNormals(position, index);
    let y0 = Infinity, y1 = -Infinity;
    for (let v = 0; v < this.n; v++) { const y = position[v * 3 + 1]; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    this.y0 = y0;
    this.H0 = y1 - y0;
    this.yLo = y0 + 0.28 * this.H0;
    this.nLevels = Math.ceil((0.72 * this.H0 + 0.25) / LEVEL_DY);          // fino a sopra le spalle anche col corpo piu' alto
    // triangoli: busto (+ gambe e testa) e braccia
    const torso = [], arm = [];
    for (let t = 0; t < index.length; t += 3) {
      const a = index[t], b = index[t + 1], c = index[t + 2];
      ((armW[a] + armW[b] + armW[c]) / 3 < 0.5 ? torso : arm).push(a, b, c);
    }
    this.torsoTris = Uint32Array.from(torso);
    this.armTris = Uint32Array.from(arm);
    // asse del busto: verticale per il centro della sezione della vita (corpo simmetrico: x = 0)
    const yw = y0 + 0.635 * this.H0;
    let zmin = Infinity, zmax = -Infinity;
    for (let v = 0; v < this.n; v++) {
      if (armW[v] < 0.5 && Math.abs(position[v * 3 + 1] - yw) < 0.02) { const z = position[v * 3 + 2]; if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
    }
    this.axisZ = (zmin + zmax) / 2;
    // appoggi delle spalle (superficie rivolta verso l'alto accanto al collo) e bande del braccio (spalla, gomito)
    const sup = [], bands = { top: [[], []], bot: [[], []] }, armV = [[], []];
    for (let v = 0; v < this.n; v++) {
      const x = position[v * 3], f = (position[v * 3 + 1] - y0) / this.H0, side = x >= 0 ? 1 : 0;
      if (f > 0.80 && f < 0.875 && Math.abs(x) > 0.07 && Math.abs(x) < 0.20 && this.normal[v * 3 + 1] > 0.6) sup.push(v);
      if (armW[v] >= 0.9) {
        if (f > 0.735 && f < 0.775) bands.top[side].push(v);
        if (f > 0.60 && f < 0.635) bands.bot[side].push(v);
        if (f > 0.56 && f < 0.80) armV[side].push(v);
      }
    }
    this.support = sup;
    this.bands = bands;
    this.armV = armV;
  }

  /** Posizioni correnti per le influence { Chest, Waist, Hips, Altezza } (le assenti valgono 0). */
  shape(influences = {}) {
    const cur = Float32Array.from(this.base);
    for (const [name, d] of Object.entries(this.morphs)) {
      const w = influences[name] || 0;
      if (!w) continue;
      for (let i = 0; i < cur.length; i++) cur[i] += w * d[i];
    }
    return cur;
  }

  /** Spostamento verticale medio (m) degli appoggi delle spalle nella forma `cur` rispetto al corpo base. */
  shoulderShift(cur) {
    let dY = 0;
    for (const v of this.support) dY += cur[v * 3 + 1] - this.base[v * 3 + 1];
    return this.support.length ? dY / this.support.length : 0;
  }

  /** Sezioni e riferimenti del corpo nella forma `cur`. `yShift` (m) sposta in quota la griglia delle fette (vedi deformGarment). */
  analyse(cur, yShift = 0) {
    const K = this.nLevels, yLo = this.yLo + yShift;
    const ptsT = Array.from({ length: K }, () => []), ptsA = Array.from({ length: K }, () => []);
    const slice = (tris, out) => {
      for (let t = 0; t < tris.length; t += 3) {
        const i0 = tris[t] * 3, i1 = tris[t + 1] * 3, i2 = tris[t + 2] * 3;
        const ya = cur[i0 + 1], yb = cur[i1 + 1], yc = cur[i2 + 1];
        const lo = Math.min(ya, yb, yc), hi = Math.max(ya, yb, yc);
        const k0 = Math.max(0, Math.ceil((lo - yLo) / LEVEL_DY)), k1 = Math.min(K - 1, Math.floor((hi - yLo) / LEVEL_DY));
        for (let k = k0; k <= k1; k++) {
          const y = yLo + k * LEVEL_DY;
          for (let e = 0; e < 3; e++) {
            const i = e === 0 ? i0 : e === 1 ? i1 : i2, j = e === 0 ? i1 : e === 1 ? i2 : i0;
            const di = cur[i + 1] - y, dj = cur[j + 1] - y;
            if (di * dj < 0) { const u = di / (di - dj); out[k].push([cur[i] + u * (cur[j] - cur[i]), cur[i + 2] + u * (cur[j + 2] - cur[i + 2])]); }
          }
        }
      }
    };
    slice(this.torsoTris, ptsT);
    slice(this.armTris, ptsA);
    const RT = [], RS = [], girth = new Float64Array(K).fill(NaN);
    for (let k = 0; k < K; k++) {
      if (ptsT[k].length < 6) { RT.push(null); RS.push(null); continue; }
      const hT = convexHull(ptsT[k]);
      const rt = hullRadial(hT, 0, this.axisZ, N_DIR);
      RT.push(rt);
      girth[k] = ringPerimeter(rt);
      RS.push(ptsA[k].length >= 6 ? hullRadial(convexHull(ptsT[k].concat(ptsA[k])), 0, this.axisZ, N_DIR) : rt);
    }
    // i buchi (fette senza sezione) prendono la fetta valida piu' vicina
    const fill = (arr) => {
      let last = null;
      for (let k = 0; k < K; k++) { if (arr[k]) last = arr[k]; else if (last) arr[k] = last; }
      for (let k = K - 1; k >= 0; k--) { if (arr[k]) last = arr[k]; else arr[k] = last; }
    };
    fill(RT); fill(RS);
    // spalle: spostamento verticale medio degli appoggi
    const dY = this.shoulderShift(cur);
    // braccia: origine (sotto la spalla), asse verso il gomito, raggio medio lungo l'asse
    const arms = [0, 1].map((s) => {
      const cen = (list) => {
        const c = [0, 0, 0];
        for (const v of list) for (let d = 0; d < 3; d++) c[d] += cur[v * 3 + d];
        return c.map((x) => x / Math.max(1, list.length));
      };
      const J = cen(this.bands.top[s]), E = cen(this.bands.bot[s]);
      let a = [E[0] - J[0], E[1] - J[1], E[2] - J[2]];
      const l = Math.hypot(a[0], a[1], a[2]) || 1;
      a = a.map((x) => x / l);
      const NB = 24, DT = 0.02, T0 = -0.14;                    // t = distanza lungo l'asse dall'origine (m), fette di 2 cm
      const sum = new Float64Array(NB), cnt = new Float64Array(NB);
      for (const v of this.armV[s]) {
        const q = [cur[v * 3] - J[0], cur[v * 3 + 1] - J[1], cur[v * 3 + 2] - J[2]];
        const t = q[0] * a[0] + q[1] * a[1] + q[2] * a[2];
        const b = Math.floor((t - T0) / DT);
        if (b < 0 || b >= NB) continue;
        sum[b] += Math.hypot(q[0] - t * a[0], q[1] - t * a[1], q[2] - t * a[2]); cnt[b]++;
      }
      const rad = new Float64Array(NB);
      let last = 0.05;
      for (let b = 0; b < NB; b++) { if (cnt[b] >= 4) last = sum[b] / cnt[b]; rad[b] = last; }
      for (let b = NB - 2; b >= 0; b--) if (cnt[b] < 4) rad[b] = rad[b + 1];
      return { J, a, rad, T0, DT };
    });
    return { cur, RT, RS, girth, dY, arms, yLo, K };
  }

  /** Circonferenza "a nastro" (m) del busto alla quota y nello stato `st`. */
  girthAt(st, y) { return lerpArr(st.girth, (y - st.yLo) / LEVEL_DY); }
}

// ── griglia spaziale per i vicini ────────────────────────────────────────────
class Grid {
  constructor(pos, cell) {
    this.pos = pos; this.cell = cell; this.map = new Map();
    for (let v = 0; v < pos.length / 3; v++) {
      const k = this.key(Math.floor(pos[v * 3] / cell), Math.floor(pos[v * 3 + 1] / cell), Math.floor(pos[v * 3 + 2] / cell));
      let a = this.map.get(k);
      if (!a) this.map.set(k, (a = []));
      a.push(v);
    }
  }
  key(i, j, k) { return (i + 512) * 1048576 + (j + 512) * 1024 + (k + 512); }
  /** I `count` vertici piu' vicini a (x, y, z): [[indice, distanza], ...] in ordine crescente. */
  nearest(x, y, z, count) {
    const c = this.cell, ci = Math.floor(x / c), cj = Math.floor(y / c), ck = Math.floor(z / c);
    let found = [];
    for (let ring = 1; ring <= 6; ring++) {
      found = [];
      for (let i = ci - ring; i <= ci + ring; i++) for (let j = cj - ring; j <= cj + ring; j++) for (let k = ck - ring; k <= ck + ring; k++) {
        const a = this.map.get(this.key(i, j, k));
        if (!a) continue;
        for (const v of a) found.push([v, Math.hypot(this.pos[v * 3] - x, this.pos[v * 3 + 1] - y, this.pos[v * 3 + 2] - z)]);
      }
      found.sort((p, q) => p[1] - q[1]);
      if (found.length >= count && found[count - 1][1] <= ring * c) break;     // oltre questa distanza potrebbero essercene di piu' vicini fuori dal cubo
    }
    return found.slice(0, count);
  }
}

// ── tabelle polari ───────────────────────────────────────────────────────────
// le braccia allargano il riferimento solo ai lati (davanti e dietro il tessuto poggia su petto e schiena, non sulle braccia)
const LATERAL = Float64Array.from({ length: N_DIR }, (_, i) => smoothstep(0.55, 0.9, Math.abs(Math.sin((i / N_DIR) * TWO_PI))));

/** Corpo "drappeggiato": dall'alto verso il basso il tessuto non rientra piu' di KAPPA·dy; sopra `kA` vale la sagoma con le braccia. */
function drapedTable(st, kA, kTop) {
  const K = st.K, R = new Array(K), D = new Array(K);
  for (let k = K - 1; k >= 0; k--) {
    const w = smoothstep(kA, kA + 5, k);
    const r = new Float64Array(N_DIR), d = new Float64Array(N_DIR), rt = st.RT[k], rs = st.RS[k], above = k < K - 1 ? D[k + 1] : null;
    for (let i = 0; i < N_DIR; i++) {
      d[i] = rt[i] + GAP;                              // D: solo il busto (le braccia non sono un appoggio per il busto del capo)
      if (above && k < kTop) d[i] = Math.max(d[i], above[i] - KAPPA * LEVEL_DY);
      r[i] = d[i] + w * LATERAL[i] * Math.max(0, rs[i] + GAP - d[i]);   // R: sopra l'ascella del capo, ai FIANCHI, la sagoma con le braccia
    }
    D[k] = d; R[k] = r;
  }
  // R (la sagoma su cui pende il tessuto) lisciata in verticale: le sezioni del corpo sono tagliate su una mesh a triangoli e oscillano di
  // qualche millimetro da una fetta all'altra; appena il corpo cambia quelle oscillazioni si stampavano sul capo come righe orizzontali
  // (una ogni fetta, 1,2 cm). D resta com'e': e' il vincolo "mai dentro il busto".
  for (let pass = 0; pass < DRAPE_SMOOTH; pass++) {
    let prev = R[0];
    for (let k = 1; k < K - 1; k++) {
      const cur = R[k], next = R[k + 1], out = new Float64Array(N_DIR);
      for (let i = 0; i < N_DIR; i++) out[i] = 0.25 * prev[i] + 0.5 * cur[i] + 0.25 * next[i];
      prev = cur; R[k] = out;
    }
  }
  return { R, D };
}

function sampleTable(R, kf, th) {               // interpolazione bilineare (fetta frazionaria, angolo in rad)
  const K = R.length, k = clamp(kf, 0, K - 1), k0 = Math.min(K - 2, Math.floor(k)), tk = k - k0;
  let a = (th / TWO_PI) * N_DIR;
  a = ((a % N_DIR) + N_DIR) % N_DIR;
  const i0 = Math.floor(a) % N_DIR, i1 = (i0 + 1) % N_DIR, ta = a - Math.floor(a);
  const r0 = R[k0][i0] + ta * (R[k0][i1] - R[k0][i0]), r1 = R[k0 + 1][i0] + ta * (R[k0 + 1][i1] - R[k0 + 1][i0]);
  return r0 + tk * (r1 - r0);
}

/** Lunghezza cumulata del meridiano (per direzione) scendendo da kTop: L[k][i]. */
function meridian(R, kTop) {
  const L = new Array(R.length);
  for (let k = R.length - 1; k >= 0; k--) {
    const l = new Float64Array(N_DIR);
    if (k < kTop) for (let i = 0; i < N_DIR; i++) l[i] = L[k + 1][i] + Math.hypot(LEVEL_DY, R[k][i] - R[k + 1][i]);
    L[k] = l;
  }
  // la risalita non cambia bruscamente da una direzione all'altra (il tessuto resiste al taglio): media mobile di +-22 gradi
  const W = 6;
  for (let k = 0; k < R.length; k++) {
    const src = L[k], dst = new Float64Array(N_DIR);
    for (let i = 0; i < N_DIR; i++) { let a = 0; for (let j = -W; j <= W; j++) a += src[(i + j + N_DIR) % N_DIR]; dst[i] = a / (2 * W + 1); }
    L[k] = dst;
  }
  return L;
}

/**
 * Lega il capo al corpo neutro.
 * @param {{ position: Float32Array, index: ArrayLike<number>, sleeve?: Float32Array }} garment
 *   sleeve = attributo `_sleeve` del GLB: 0 sul busto, +w manica sinistra (x > 0), -w manica destra, |w| = 1 a 6 cm dalla cucitura
 * @param {BodyModel} body
 */
export function bindGarment(garment, body) {
  const P = garment.position, n = P.length / 3, idx = garment.index;
  const sleeve = garment.sleeve || new Float32Array(n);
  const st0 = body.analyse(body.shape({}));
  const yLo = st0.yLo, K = st0.K, az = body.axisZ;
  // coordinate polari a riposo
  const th = new Float64Array(n), r0 = new Float64Array(n), kf = new Float64Array(n);
  let yMax = -Infinity;
  for (let v = 0; v < n; v++) {
    const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2] - az;
    th[v] = Math.atan2(x, z); r0[v] = Math.hypot(x, z); kf[v] = (y - yLo) / LEVEL_DY;
    if (y > yMax) yMax = y;
  }
  // anelli del capo a riposo (solo il busto: triangoli senza vertici di manica), per fetta: raggio medio per direzione
  const sum = Array.from({ length: K }, () => new Float64Array(N_DIR)), cnt = Array.from({ length: K }, () => new Uint16Array(N_DIR));
  const trueLen = new Float64Array(K);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (Math.abs(sleeve[a]) > 1e-4 || Math.abs(sleeve[b]) > 1e-4 || Math.abs(sleeve[c]) > 1e-4) continue;
    const ys = [P[a * 3 + 1], P[b * 3 + 1], P[c * 3 + 1]], vs = [a, b, c];
    const k0 = Math.max(0, Math.ceil((Math.min(...ys) - yLo) / LEVEL_DY)), k1 = Math.min(K - 1, Math.floor((Math.max(...ys) - yLo) / LEVEL_DY));
    for (let k = k0; k <= k1; k++) {
      const y = yLo + k * LEVEL_DY;
      let px = NaN, pz = 0;
      for (let e = 0; e < 3; e++) {
        const i = vs[e], j = vs[(e + 1) % 3], di = ys[e] - y, dj = ys[(e + 1) % 3] - y;
        if (di * dj >= 0) continue;
        const u = di / (di - dj), x = P[i * 3] + u * (P[j * 3] - P[i * 3]), z = P[i * 3 + 2] + u * (P[j * 3 + 2] - P[i * 3 + 2]) - az;
        let a2 = Math.atan2(x, z); if (a2 < 0) a2 += TWO_PI;
        const bi = Math.min(N_DIR - 1, Math.round((a2 / TWO_PI) * N_DIR) % N_DIR);
        sum[k][bi] += Math.hypot(x, z); cnt[k][bi]++;
        if (Number.isNaN(px)) { px = x; pz = z; } else trueLen[k] += Math.hypot(x - px, z - pz);      // lunghezza vera della sezione, pieghe comprese
      }
    }
  }
  // il "tubo" del busto e' chiuso (tutte le direzioni coperte) fino alla fetta kA: sopra, ai lati ci sono i giromanica
  const closed = cnt.map((c) => {                    // chiuso = nessun vuoto angolare piu' largo di ~11 gradi
    let pts = 0, run = 0, worst = 0;
    for (let i = 0; i < 2 * N_DIR; i++) { if (c[i % N_DIR]) { run = 0; if (i < N_DIR) pts++; } else worst = Math.max(worst, ++run); }
    return pts > N_DIR / 3 && worst <= 3;
  });
  let kHem = 0;
  while (kHem < K - 1 && !closed[kHem]) kHem++;
  let kA = kHem;
  while (kA < K - 1 && closed[kA + 1]) kA++;
  const kTop = clamp(Math.ceil((yMax - yLo) / LEVEL_DY), kA + 1, K - 1);
  const { R: R0, D: D0 } = drapedTable(st0, kA, kTop), L0 = meridian(D0, kTop);
  const rings = [];
  for (let k = kHem; k <= kA; k++) {
    const ring = new Float64Array(N_DIR);
    for (let i = 0; i < N_DIR; i++) ring[i] = cnt[k][i] ? sum[k][i] / cnt[k][i] : NaN;
    for (let i = 0; i < N_DIR; i++) {                               // direzioni vuote: media dei vicini validi
      if (!Number.isNaN(ring[i])) continue;
      let a = i, b = i, g = 0;
      while (Number.isNaN(ring[((a % N_DIR) + N_DIR) % N_DIR]) && g++ < N_DIR) a--;
      g = 0;
      while (Number.isNaN(ring[b % N_DIR]) && g++ < N_DIR) b++;
      ring[i] = (ring[((a % N_DIR) + N_DIR) % N_DIR] + ring[b % N_DIR]) / 2;
    }
    const slack = new Float64Array(N_DIR);
    for (let i = 0; i < N_DIR; i++) slack[i] = ring[i] - R0[k][i];
    // il tessuto e' piu' lungo dell'anello polare: il resto sta nelle pieghe (fold > 0), che si spianano quando l'ease si consuma
    const per = ringPerimeter(ring);
    rings.push({ k, slack, perimeter: per, fold: trueLen[k] / per - 1 });
  }
  // quota di pieghe: una sola per tutto il tubo (mediana), perche' sulle singole fette la misura e' sporcata dai risvolti (strato doppio
  // all'orlo) e dai giromanica (anello non chiuso in alto)
  const folds = rings.map((r) => r.fold).filter((f) => f >= 0 && f < 0.08).sort((a, b) => a - b);
  const foldMed = folds.length ? folds[folds.length >> 1] : 0;
  for (const r of rings) { r.fold = foldMed; r.fabric = r.perimeter * (1 + foldMed); }
  // vicini sul corpo: appoggio (pesi) e sicurezza (vertice piu' vicino)
  const grid = new Grid(body.base, 0.04);
  const NN = 6, nnI = new Int32Array(n * NN), nnW = new Float32Array(n * NN), near = new Int32Array(n), follow = new Float32Array(n);
  const slack0 = new Float64Array(n), slackT0 = new Float64Array(n), len0 = new Float64Array(n), clear0 = new Float32Array(n), cling = new Float32Array(n), dist0 = new Float32Array(n), needK = new Float32Array(n * 6);
  for (let v = 0; v < n; v++) {
    const f = grid.nearest(P[v * 3], P[v * 3 + 1], P[v * 3 + 2], NN);
    let ws = 0;
    const h = Math.max(0.012, f[0][1]);
    for (let k = 0; k < NN; k++) {
      const [bi, d] = f[Math.min(k, f.length - 1)];
      const w = 1 / (d * d + h * h * 0.25);
      nnI[v * NN + k] = bi; nnW[v * NN + k] = w; ws += w;
    }
    for (let k = 0; k < NN; k++) nnW[v * NN + k] /= ws;
    near[v] = f[0][0];
    dist0[v] = f[0][1];
    // appoggio: tessuto vicino alla pelle, su una superficie che guarda in alto, sopra la linea dell'ascella del capo
    let ny = 0;
    for (let k = 0; k < NN; k++) ny += nnW[v * NN + k] * body.normal[nnI[v * NN + k] * 3 + 1];
    follow[v] = (1 - smoothstep(0.012, 0.035, f[0][1])) * smoothstep(0.55, 0.85, ny) * smoothstep(kA + 2, kA + 10, kf[v]);
    // sopra il tubo, il tessuto vicino al corpo vi aderisce quando il capo e' teso (s -> 0): quanto, lo dice `cling`
    cling[v] = (1 - smoothstep(0.012, 0.04, f[0][1])) * smoothstep(kA - 14, kA + 4, kf[v]);
    slack0[v] = r0[v] - sampleTable(R0, kf[v], th[v]);
    slackT0[v] = Math.min(0, r0[v] - sampleTable(D0, kf[v], th[v]));       // < 0 solo dove a riposo il tessuto sta in una concavita' del busto
    {                                                  // distanza a riposo dal piano tangente del vicino lateralmente piu' prossimo (stessa
      let c = Infinity;
      for (let k = 0; k < NN; k++) {
        const bi = nnI[v * NN + k] * 3, nx = body.normal[bi], ny = body.normal[bi + 1], nz = body.normal[bi + 2];
        const ex = P[v * 3] - body.base[bi], ey = P[v * 3 + 1] - body.base[bi + 1], ez = P[v * 3 + 2] - body.base[bi + 2];
        const d = ex * nx + ey * ny + ez * nz, lat = Math.hypot(ex - d * nx, ey - d * ny, ez - d * nz);
        needK[v * NN + k] = lat < SAFE_LAT ? Math.min(GAP * 0.6, d) : GAP * 0.6;     // per vicino: mai piu' sotto il suo piano di quanto fosse nella sim
        if (lat < SAFE_LAT && d < c) c = d;
      }
      clear0[v] = c;
    }
    let a = (th[v] / TWO_PI) * N_DIR; a = ((a % N_DIR) + N_DIR) % N_DIR;
    const i0 = Math.floor(a) % N_DIR, i1 = (i0 + 1) % N_DIR, ta = a - Math.floor(a), kk = clamp(kf[v], 0, K - 1), k0 = Math.min(K - 2, Math.floor(kk)), tk = kk - k0;
    len0[v] = (L0[k0][i0] + ta * (L0[k0][i1] - L0[k0][i0])) * (1 - tk) + (L0[k0 + 1][i0] + ta * (L0[k0 + 1][i1] - L0[k0 + 1][i0])) * tk;
  }
  // l'appoggio sfuma sui vertici vicini (nessuna linea netta tra tessuto che segue e tessuto che pende)
  const nb = Array.from({ length: n }, () => []);
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) { const a = idx[t + e], b = idx[t + ((e + 1) % 3)]; nb[a].push(b); nb[b].push(a); }
  for (let it = 0; it < 4; it++) {
    const nx = Float32Array.from(follow);
    for (let v = 0; v < n; v++) { if (!nb[v].length) continue; let s = 0; for (const u of nb[v]) s += follow[u]; nx[v] = 0.5 * follow[v] + 0.5 * s / nb[v].length; }
    follow.set(nx);
  }
  for (let it = 0; it < 14; it++) {                 // anche l'aderenza sfuma largamente: il confine tra tessuto aderente e tessuto che pende non si deve vedere
    const nx = Float32Array.from(cling);
    for (let v = 0; v < n; v++) { if (!nb[v].length) continue; let sm = 0; for (const u of nb[v]) sm += cling[u]; nx[v] = 0.4 * cling[v] + 0.6 * sm / nb[v].length; }
    cling.set(nx);
  }
  // maniche: coordinate nel riferimento del braccio a riposo
  const sl = [];
  const armBins = [0, 1].map(() => ({ sum: new Float64Array(24), cnt: new Float64Array(24) }));
  for (let v = 0; v < n; v++) {
    if (Math.abs(sleeve[v]) < 1e-4) continue;
    const s = sleeve[v] > 0 ? 1 : 0, A = st0.arms[s];
    const q = [P[v * 3] - A.J[0], P[v * 3 + 1] - A.J[1], P[v * 3 + 2] - A.J[2]];
    const t = q[0] * A.a[0] + q[1] * A.a[1] + q[2] * A.a[2];
    const rv = [q[0] - t * A.a[0], q[1] - t * A.a[1], q[2] - t * A.a[2]], rho = Math.hypot(rv[0], rv[1], rv[2]) || 1e-9;
    sl.push({ v, s, t, rho, u: rv.map((x) => x / rho), w: Math.abs(sleeve[v]), near: 1 - smoothstep(0.03, 0.10, dist0[v]) });
    const b = Math.floor((t - A.T0) / A.DT);
    if (b >= 0 && b < 24 && Math.abs(sleeve[v]) > 0.5) { armBins[s].sum[b] += rho; armBins[s].cnt[b]++; }
  }
  const sleeveRho = armBins.map((b) => { const m = new Float64Array(24); for (let i = 0; i < 24; i++) m[i] = b.cnt[i] >= 3 ? b.sum[i] / b.cnt[i] : NaN; return m; });
  const weld = weldGroups(P);
  const b = { n, rest: P, index: idx, th, r0, kf, slack0, slackT0, clear0, needK, cling, len0, follow, nnI, nnW, NN, near, sleeve, sl, sleeveRho, rings, kHem, kA, kTop, R0, L0, st0, body, weld,
    yChestLine: yLo + kA * LEVEL_DY, yHem: yLo + kHem * LEVEL_DY };
  // residuo a riposo (interpolazioni delle tabelle, < 1 mm): sottratto sempre, cosi' col corpo neutro il capo e' ESATTAMENTE quello della sim
  b.fix = new Float32Array(n * 3);
  // la correzione che rende esatto il corpo neutro si calcola SENZA la sicurezza: cosi' col corpo neutro la sicurezza vede esattamente la sim
  // (che la rispetta per costruzione) e non sposta nulla. Calcolandola con la sicurezza attiva restava uno scarto fino a 0,8 mm sui capi morbidi.
  b.noSafety = true;
  const at0 = deformGarment(b, {}).position;
  b.noSafety = false;
  for (let i2 = 0; i2 < n * 3; i2++) b.fix[i2] = P[i2] - at0[i2];
  // Vicini sulla mesh SALDATA (compatti), per le lisciature. Nel GLB i vertici sono duplicati dove cambia la texture o il materiale (cucitura
  // della spalla tra davanti e dietro, bordi degli strati): i duplicati devono avere gli stessi vicini e, alla fine, la stessa posizione,
  // altrimenti lisciandoli separatamente il capo si apre lungo quelle linee e si vede la pelle.
  const members = Array.from({ length: weld.count }, () => []);
  for (let v = 0; v < n; v++) members[weld.group[v]].push(v);
  const gnb = Array.from({ length: weld.count }, () => new Set());
  for (let v = 0; v < n; v++) for (const u of nb[v]) if (weld.group[u] !== weld.group[v]) gnb[weld.group[v]].add(members[weld.group[u]][0]);
  b.nbStart = new Uint32Array(n + 1);
  for (let v = 0; v < n; v++) b.nbStart[v + 1] = b.nbStart[v] + gnb[weld.group[v]].size;
  b.nbList = new Uint32Array(b.nbStart[n]);
  for (let v = 0; v < n; v++) b.nbList.set(Array.from(gnb[weld.group[v]]), b.nbStart[v]);
  const dup = members.filter((m) => m.length > 1);
  // STRATI AGGIUNTI (attributo `_layer` > 0: guscio della costina, risvolti di orlo e polsini): pezzi separati dallo strato base, appoggiati
  // su di esso. Adattati per conto proprio scorrevano rispetto al tessuto (fessura lungo la cucitura del colletto, con la pelle in vista).
  // Ogni loro vertice segue invece lo spostamento dei 3 vertici dello strato base piu' vicini a riposo.
  const layer = garment.layer;
  b.attV = new Uint32Array(0);
  if (layer && layer.some((x) => x > 0.5)) {
    const baseIdx = [];
    for (let v = 0; v < n; v++) if (!(layer[v] > 0.5)) baseIdx.push(v);
    const bp = new Float32Array(baseIdx.length * 3);
    baseIdx.forEach((v, i) => { bp[i * 3] = P[v * 3]; bp[i * 3 + 1] = P[v * 3 + 1]; bp[i * 3 + 2] = P[v * 3 + 2]; });
    const grid = new Grid(bp, 0.02), av = [], ai = [], aw = [];
    for (let v = 0; v < n; v++) {
      if (!(layer[v] > 0.5)) continue;
      const f = grid.nearest(P[v * 3], P[v * 3 + 1], P[v * 3 + 2], 3);
      if (!f.length) continue;
      let ws = 0;
      const w = f.map(([, d]) => 1 / (d * d + 1e-8));
      w.forEach((x) => { ws += x; });
      av.push(v);
      for (let k = 0; k < 3; k++) { const q = f[Math.min(k, f.length - 1)]; ai.push(baseIdx[q[0]]); aw.push(k < f.length ? w[k] / ws : 0); }
    }
    b.attV = Uint32Array.from(av); b.attI = Uint32Array.from(ai); b.attW = Float32Array.from(aw);
  }
  b.dupList = Uint32Array.from(dup.flat());
  b.dupStart = new Uint32Array(dup.length + 1);
  dup.forEach((m, i) => { b.dupStart[i + 1] = b.dupStart[i] + m.length; });
  // distanza dalla pelle a riposo, con la stessa misura della sicurezza a runtime: e' la soglia sotto cui un vertice non deve scendere
  const map0 = skinGrid(body.base, body.n);
  b.skin0 = new Float32Array(n);
  for (let v = 0; v < n; v++) b.skin0[v] = skinClearance(P, v, body.base, body.normal, map0, 1).d;
  return b;
}

/** Porta alla media i valori (terne) dei vertici duplicati di ogni gruppo saldato. */
function unifyDuplicates(b, F) {
  const st = b.dupStart, li = b.dupList;
  for (let g = 0; g + 1 < st.length; g++) {
    let x = 0, y = 0, z = 0;
    const a = st[g], e = st[g + 1];
    for (let j = a; j < e; j++) { const v = li[j] * 3; x += F[v]; y += F[v + 1]; z += F[v + 2]; }
    x /= e - a; y /= e - a; z /= e - a;
    for (let j = a; j < e; j++) { const v = li[j] * 3; F[v] = x; F[v + 1] = y; F[v + 2] = z; }
  }
}

// ── sicurezza sulla pelle (forma corrente del corpo) ─────────────────────────
const skinKey = (i, j, k) => (i + 512) * 1048576 + (j + 512) * 1024 + (k + 512);

/** Griglia dei vertici del corpo nella forma `cur` (celle di lato SKIN_CELL). */
function skinGrid(cur, nBody) {
  const C = SKIN_CELL, map = new Map();
  for (let q = 0; q < nBody; q++) {
    const kk = skinKey(Math.floor(cur[q * 3] / C), Math.floor(cur[q * 3 + 1] / C), Math.floor(cur[q * 3 + 2] / C));
    let a = map.get(kk);
    if (!a) map.set(kk, (a = []));
    a.push(q);
  }
  return map;
}

/** Tra i vertici del corpo che stanno SOTTO il vertice v del capo (scarto laterale < SKIN_LAT dal loro piano tangente), quello con la
 *  distanza dal piano piu' piccola, purche' sotto `limit`: { q: indice (-1 se nessuno), d: distanza con segno }. */
function skinClearance(pos, v, cur, nrm, map, limit) {
  const C = SKIN_CELL, x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
  const ci = Math.floor(x / C), cj = Math.floor(y / C), ck = Math.floor(z / C);
  let best = -1, d = limit;
  for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) for (let k = ck - 1; k <= ck + 1; k++) {
    const a = map.get(skinKey(i, j, k));
    if (!a) continue;
    for (const q of a) {
      const q3 = q * 3, ex = x - cur[q3], ey = y - cur[q3 + 1], ez = z - cur[q3 + 2];
      const dn = ex * nrm[q3] + ey * nrm[q3 + 1] + ez * nrm[q3 + 2];
      if (dn >= d || dn < -C) continue;
      const lx = ex - dn * nrm[q3], ly = ey - dn * nrm[q3 + 1], lz = ez - dn * nrm[q3 + 2];
      if (lx * lx + ly * ly + lz * lz < SKIN_LAT * SKIN_LAT) { d = dn; best = q; }
    }
  }
  return { q: best, d };
}

function solveS(R1row, slack, fabric, fold) {
  // lunghezza del tessuto = perimetro(R + s·ease) · (1 + fold·s): crescente in s, bisezione. s = 0: teso sul corpo; `tight` = quanto manca.
  const n = R1row.length, r = new Float64Array(n);
  const per = (s) => { for (let i = 0; i < n; i++) r[i] = R1row[i] + (slack[i] > 0 ? s * slack[i] : slack[i] * Math.min(1, s)); return ringPerimeter(r) * (1 + fold * Math.min(1, s)); };
  const p0 = per(0);
  if (p0 >= fabric) return { s: 0, tight: Math.max(0, p0 - fabric - TWO_PI * GAP) };   // `tight` conta il corpo, non il margine di sicurezza
  let lo = 0, hi = 1;
  while (per(hi) < fabric && hi < 6) hi *= 1.6;
  for (let it = 0; it < 22; it++) { const m = (lo + hi) / 2; if (per(m) < fabric) lo = m; else hi = m; }
  return { s: (lo + hi) / 2, tight: 0 };
}

/**
 * Posizioni del capo sul corpo con le influence date.
 * @returns {{ position: Float32Array, info: { s: number[], tightCm: number, chestGarmentCm: number, chestBodyCm: number, hemY: number, dY: number } }}
 */
export function deformGarment(b, influences, out = null) {
  // Le spalle salgono o scendono di dY (altezza, ma anche petto): il capo le segue. Le fette del corpo vengono tagliate su una griglia spostata
  // della parte frazionaria di dY, cosi' lo spostamento in fette (dK) e' un numero INTERO e tutte le tabelle restano allineate al capo.
  // Prima la griglia era fissa e dK veniva arrotondato solo in alcuni punti: il capo seguiva le spalle a scatti di una fetta (1,2 cm) e tra
  // uno scatto e l'altro si deformava (fino a 15 mm sulle spalle gia' con 0,4 cm di altezza in meno, cioe' col corpo di partenza del widget).
  const body = b.body, cur0 = body.shape(influences), dY = body.shoulderShift(cur0);
  const dK = Math.round(dY / LEVEL_DY);
  const st = body.analyse(cur0, dY - dK * LEVEL_DY), cur = st.cur, base = body.base;
  const n = b.n, P = b.rest, pos = out || new Float32Array(n * 3), az = body.axisZ, yLo = st.yLo, K = st.K;
  const kTop1 = Math.min(K - 1, b.kTop + dK);
  const { R: R1, D: D1 } = drapedTable(st, b.kA + dK, kTop1);
  const L1 = meridian(D1, kTop1);
  // quota di ogni fetta del tessuto (per direzione): stessa lunghezza di meridiano dalla cima, sul corpo corrente
  const rowK = (k0, i, len) => {                 // fetta corrente (frazionaria) a cui il meridiano i ha lunghezza len dalla cima
    let k = Math.round(k0 + dK);
    k = clamp(k, 0, kTop1);
    while (k > 0 && L1[k][i] < len) k--;
    while (k < kTop1 && L1[k + 1][i] >= len) k++;
    const a = L1[k][i], c = k < kTop1 ? L1[k + 1][i] : a;
    return a > c ? k + (a - len) / (a - c) : k;
  };
  // s per fetta: il giro del tessuto resta quello della sim
  const sK = new Float64Array(K).fill(1);
  let tight = 0;
  for (const ring of b.rings) {
    const row = new Float64Array(N_DIR);
    for (let i = 0; i < N_DIR; i++) {
      const kk = clamp(rowK(ring.k, i, b.L0[ring.k][i]), 0, K - 1), k0 = Math.min(K - 2, Math.floor(kk)), t = kk - k0;
      row[i] = R1[k0][i] + t * (R1[k0 + 1][i] - R1[k0][i]);
    }
    const r = solveS(row, ring.slack, ring.fabric, ring.fold);
    sK[ring.k] = Math.min(r.s, S_MAX);
    if (r.tight > tight) tight = r.tight;
  }
  for (let k = 0; k < b.kHem; k++) sK[k] = sK[b.kHem];
  for (let k = b.kA + 1; k < K; k++) sK[k] = sK[b.kA] + (1 - sK[b.kA]) * smoothstep(b.kA, b.kTop, k);    // verso le spalle l'ease torna quello della sim
  for (let it = 0; it < 6; it++) {               // niente salti di s tra fette vicine
    const c = Float64Array.from(sK);
    for (let k = 1; k < K - 1; k++) sK[k] = 0.25 * c[k - 1] + 0.5 * c[k] + 0.25 * c[k + 1];
  }
  const rotA = st.arms.map((A, s) => rotationBetween(b.st0.arms[s].a, A.a));
  // Spostamento della pelle sotto ogni vertice del capo (media pesata dei vertici del corpo legati a riposo), poi lisciato sulla maglia:
  // vertici vicini sono legati a punti di pelle diversi e copiandone lo spostamento uno per uno il tessuto che poggia (spalle, petto alto,
  // maniche) usciva a bozzi appena il corpo cambiava (misurato a petto 84: 1,2 mm medi di variazione della forma locale sulle spalle).
  const U = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    let ux = 0, uy = 0, uz = 0;
    for (let k = 0; k < b.NN; k++) {
      const bi = b.nnI[v * b.NN + k] * 3, w = b.nnW[v * b.NN + k];
      ux += w * (cur[bi] - base[bi]); uy += w * (cur[bi + 1] - base[bi + 1]); uz += w * (cur[bi + 2] - base[bi + 2]);
    }
    U[v * 3] = ux; U[v * 3 + 1] = uy; U[v * 3 + 2] = uz;
  }
  if (b.nbList) {
    const T = new Float32Array(n * 3);
    for (let pass = 0; pass < SKIN_FOLLOW_SMOOTH; pass++) {
      for (let v = 0; v < n; v++) {
        const a = b.nbStart[v], e = b.nbStart[v + 1];
        if (e === a) { T[v * 3] = U[v * 3]; T[v * 3 + 1] = U[v * 3 + 1]; T[v * 3 + 2] = U[v * 3 + 2]; continue; }
        let x = 0, y = 0, z = 0;
        for (let j = a; j < e; j++) { const u = b.nbList[j] * 3; x += U[u]; y += U[u + 1]; z += U[u + 2]; }
        const k = 0.5 / (e - a);
        T[v * 3] = 0.5 * U[v * 3] + k * x; T[v * 3 + 1] = 0.5 * U[v * 3 + 1] + k * y; T[v * 3 + 2] = 0.5 * U[v * 3 + 2] + k * z;
      }
      U.set(T);
    }
  }
  let hemY = Infinity;
  for (let v = 0; v < n; v++) {
    const x0 = P[v * 3], y0 = P[v * 3 + 1], z0 = P[v * 3 + 2];
    // CADUTA
    let a = (b.th[v] / TWO_PI) * N_DIR; a = ((a % N_DIR) + N_DIR) % N_DIR;
    const i0 = Math.floor(a) % N_DIR, i1 = (i0 + 1) % N_DIR, ta = a - Math.floor(a);
    const kr = Math.round(b.kf[v]);
    const k1 = (1 - ta) * rowK(kr, i0, b.len0[v]) + ta * rowK(kr, i1, b.len0[v]);
    const s = lerpArr(sK, b.kf[v]);
    const sl0 = b.slack0[v];
    let r = sampleTable(R1, k1, b.th[v]) + (sl0 > 0 ? s * sl0 : sl0 * Math.min(1, s));
    r = Math.max(r, sampleTable(D1, k1, b.th[v]) + b.slackT0[v]);        // mai dentro il busto (guscio convesso), qualunque sia la sagoma
    const yh = yLo + k1 * LEVEL_DY;
    let px = Math.sin(b.th[v]) * r, py = yh, pz = Math.cos(b.th[v]) * r + az;
    // APPOGGIO (sempre dove il tessuto poggia; ovunque sia vicino al corpo, sopra il tubo, quando il capo e' teso)
    const ux = U[v * 3], uy = U[v * 3 + 1], uz = U[v * 3 + 2];
    const f = b.follow[v] + (1 - b.follow[v]) * b.cling[v] * (1 - Math.min(1, s));
    if (f > 1e-3) { px += f * (x0 + ux - px); py += f * (y0 + uy - py); pz += f * (z0 + uz - pz); }
    pos[v * 3] = px; pos[v * 3 + 1] = py; pos[v * 3 + 2] = pz;
  }
  // MANICA
  const sS = st.arms.map((A, s) => {
    const m = new Float64Array(24);
    for (let i = 0; i < 24; i++) {
      const g0 = b.sleeveRho[s][i], a0 = b.st0.arms[s].rad[i], a1 = A.rad[i];
      m[i] = Number.isNaN(g0) || g0 - a0 < 0.004 ? 1 : clamp((g0 - a1) / (g0 - a0), 0.05, 1.6);
    }
    for (let i = 1; i < 24; i++) if (Number.isNaN(b.sleeveRho[s][i])) m[i] = m[i - 1];
    return m;
  });
  for (const e of b.sl) {
    const A1 = st.arms[e.s], A0 = b.st0.arms[e.s], bf = (e.t - A0.T0) / A0.DT - 0.5;
    const ra0 = lerpArr(A0.rad, bf), ra1 = lerpArr(A1.rad, bf), ss = lerpArr(sS[e.s], bf);
    const rho = e.rho > ra0 ? ra1 + ss * (e.rho - ra0) : e.rho + (ra1 - ra0);
    const q = [A0.a[0] * e.t + e.u[0] * rho, A0.a[1] * e.t + e.u[1] * rho, A0.a[2] * e.t + e.u[2] * rho];
    const R = rotA[e.s];
    let sx = A1.J[0] + R[0] * q[0] + R[1] * q[1] + R[2] * q[2], sy = A1.J[1] + R[3] * q[0] + R[4] * q[1] + R[5] * q[2], sz = A1.J[2] + R[6] * q[0] + R[7] * q[1] + R[8] * q[2];
    const v = e.v, w = e.w;
    const cl = e.near * (1 - Math.min(1, ss));                    // manica tesa sul braccio: aderisce alla pelle
    if (cl > 1e-3) { sx += cl * (P[v * 3] + U[v * 3] - sx); sy += cl * (P[v * 3 + 1] + U[v * 3 + 1] - sy); sz += cl * (P[v * 3 + 2] + U[v * 3 + 2] - sz); }
    pos[v * 3] += w * (sx - pos[v * 3]); pos[v * 3 + 1] += w * (sy - pos[v * 3 + 1]); pos[v * 3 + 2] += w * (sz - pos[v * 3 + 2]);
    // la manica non entra nel busto: stesso vincolo polare del resto del capo
    const x = pos[v * 3], z = pos[v * 3 + 2] - az, rr = Math.hypot(x, z), th1 = Math.atan2(x, z);
    const lim = sampleTable(D1, (pos[v * 3 + 1] - yLo) / LEVEL_DY, th1) + b.slackT0[v];
    if (rr < lim && rr > 1e-6) { pos[v * 3] = x * lim / rr; pos[v * 3 + 2] = z * lim / rr + az; }
  }
  if (b.fix) for (let i = 0; i < n * 3; i++) pos[i] += b.fix[i];
  // Lo SPOSTAMENTO rispetto alla sim viene lisciato sulla maglia. Le regole qui sopra lavorano vertice per vertice (tabelle polari, legame
  // col braccio, ease riscalato): tra vertici vicini lasciano differenze di qualche millimetro che sul tessuto si vedono come bozzi appena
  // il corpo cambia (petto 84: spalle, petto alto e maniche "trapuntati"). Il capo deve restare la sim, spostata e adattata in modo dolce:
  // le pieghe della sim (larghe alcuni centimetri) passano, il rumore alla scala della maglia no. Col corpo neutro lo spostamento e' zero.
  if (b.nbList && !b.noSafety) {
    const D = new Float32Array(n * 3), T = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) D[i] = pos[i] - P[i];
    unifyDuplicates(b, D);
    for (let pass = 0; pass < DISP_SMOOTH; pass++) {
      for (let v = 0; v < n; v++) {
        const a = b.nbStart[v], e = b.nbStart[v + 1];
        if (e === a) { T[v * 3] = D[v * 3]; T[v * 3 + 1] = D[v * 3 + 1]; T[v * 3 + 2] = D[v * 3 + 2]; continue; }
        let x = 0, y = 0, z = 0;
        for (let j = a; j < e; j++) { const u = b.nbList[j] * 3; x += D[u]; y += D[u + 1]; z += D[u + 2]; }
        const k = 0.5 / (e - a);
        T[v * 3] = 0.5 * D[v * 3] + k * x; T[v * 3 + 1] = 0.5 * D[v * 3 + 1] + k * y; T[v * 3 + 2] = 0.5 * D[v * 3 + 2] + k * z;
      }
      D.set(T);
    }
    for (let j = 0; j < b.attV.length; j++) {                    // strati aggiunti: lo spostamento dello strato base su cui poggiano
      const v = b.attV[j] * 3;
      let x = 0, y = 0, z = 0;
      for (let k = 0; k < 3; k++) { const u = b.attI[j * 3 + k] * 3, w = b.attW[j * 3 + k]; x += w * D[u]; y += w * D[u + 1]; z += w * D[u + 2]; }
      D[v] = x; D[v + 1] = y; D[v + 2] = z;
    }
    for (let i = 0; i < n * 3; i++) pos[i] = P[i] + D[i];
  }
  const before = b.nbList && !b.noSafety ? Float32Array.from(pos.subarray(0, n * 3)) : null;      // posizioni prima delle sicurezze
  // normali del corpo nella forma CORRENTE: con quelle a riposo la sicurezza qui sotto vedeva violazioni inesistenti appena la pelle ruotava
  // (misurato a petto 84, cioe' con un corpo piu' PICCOLO: 2500 vertici spinti, fino a 9 mm -> spalle e petto a bozzi)
  const moved = Object.values(influences || {}).some((w) => Math.abs(w) > 1e-6);
  const bodyN = moved ? vertexNormals(cur, body.index) : body.normal;
  // sicurezza: nessun vertice piu' vicino di GAP/2 alla pelle (rispetto al vertice del corpo piu' vicino a riposo)
  for (let v = 0; v < n; v++) {
    // per ogni vertice del corpo legato a riposo che ora sta sotto il tessuto (entro SAFE_LAT): mai sotto il suo piano tangente piu' di
    // quanto lo fosse nella sim (e mai a meno di 0,6 GAP se nella sim era piu' lontano). Due passate: una spinta puo' scoprirne un'altra.
    for (let pass = 0; pass < (b.noSafety || !REST_SAFETY ? 0 : 5); pass++) {               // ogni passata corregge la violazione peggiore (una spinta puo' scoprirne un'altra)
      let worst = 0, wb = -1;
      for (let k = 0; k < b.NN; k++) {
        const bi = b.nnI[v * b.NN + k] * 3, nx = bodyN[bi], ny = bodyN[bi + 1], nz = bodyN[bi + 2];
        const ex = pos[v * 3] - cur[bi], ey = pos[v * 3 + 1] - cur[bi + 1], ez = pos[v * 3 + 2] - cur[bi + 2];
        const d = ex * nx + ey * ny + ez * nz, lack = b.needK[v * b.NN + k] - d;
        if (lack > worst && Math.hypot(ex - d * nx, ey - d * ny, ez - d * nz) < SAFE_LAT) { worst = lack; wb = bi; }
      }
      if (wb < 0) break;
      pos[v * 3] += worst * bodyN[wb]; pos[v * 3 + 1] += worst * bodyN[wb + 1]; pos[v * 3 + 2] += worst * bodyN[wb + 2];
    }
    if (pos[v * 3 + 1] < hemY) hemY = pos[v * 3 + 1];
  }
  // Seconda sicurezza, sulla forma CORRENTE del corpo. Quella sopra usa i vertici del corpo legati a riposo e le loro normali a riposo: agli
  // estremi (petto 130, altezza 200) il tessuto scorre rispetto alla pelle e la pelle ruota, e dietro l'ascella e lungo la schiena restavano
  // vertici dentro il corpo (misurato: fino a 260 vertici, 18 mm). Qui ogni vertice del capo guarda il vertice del corpo piu' vicino ADESSO
  // e la sua normale di adesso: se sta sotto il piano tangente (o a meno di SKIN_MIN) viene portato a SKIN_MIN. Col corpo neutro non si fa nulla.
  let skinFixed = 0;
  if (b.skin0 && moved) {
    const nrm = bodyN, map = skinGrid(cur, body.n);
    let active = null;                                  // dopo la prima passata si ricontrollano solo i vertici appena spostati
    for (let pass = 0; pass < 4; pass++) {
      const next = [];
      for (let w = 0, m = active ? active.length : n; w < m; w++) {
        const v = active ? active[w] : w;
        // soglia per vertice: mai piu' vicino alla pelle di quanto lo fosse nella sim (meno un margine), e comunque non oltre SKIN_MIN.
        // Cosi' un corpo quasi neutro lascia il capo com'e' (niente spinte su colletto, risvolti e pieghe che nella sim stavano gia' li').
        const need = Math.min(SKIN_MIN, b.skin0[v] - SKIN_SLACK);
        const r = skinClearance(pos, v, cur, nrm, map, need);
        if (r.q < 0) continue;
        const bi = r.q * 3, push = need - r.d;
        pos[v * 3] += push * nrm[bi]; pos[v * 3 + 1] += push * nrm[bi + 1]; pos[v * 3 + 2] += push * nrm[bi + 2];
        next.push(v);
      }
      if (pass === 0) skinFixed = next.length;
      if (!next.length) break;
      active = next;
    }
  }
  // Le sicurezze spostano i vertici uno per uno: da sole lasciano punte e fossette (misurato: un quarto dei "bozzi" del capo quando il petto
  // cresce). Ogni spinta trascina i vicini, sfumando: un vertice prende la spinta piu' grande tra la sua e il 70% della media dei vicini.
  // Nessun vertice viene spinto MENO di prima, quindi la distanza dalla pelle non peggiora.
  if (before) {
    let any = false;
    const d = new Float32Array(n * 3);
    for (let i = 0; i < n * 3; i++) { d[i] = pos[i] - before[i]; if (d[i] !== 0) any = true; }
    if (any) {
      const m = new Float32Array(n * 3);
      for (let pass = 0; pass < SAFETY_SPREAD; pass++) {
        for (let v = 0; v < n; v++) {
          const a = b.nbStart[v], e = b.nbStart[v + 1];
          let x = 0, y = 0, z = 0;
          for (let j = a; j < e; j++) { const u = b.nbList[j] * 3; x += d[u]; y += d[u + 1]; z += d[u + 2]; }
          const k = e > a ? 0.7 / (e - a) : 0;
          x *= k; y *= k; z *= k;
          const own = d[v * 3] * d[v * 3] + d[v * 3 + 1] * d[v * 3 + 1] + d[v * 3 + 2] * d[v * 3 + 2];
          if (x * x + y * y + z * z > own) { m[v * 3] = x; m[v * 3 + 1] = y; m[v * 3 + 2] = z; } else { m[v * 3] = d[v * 3]; m[v * 3 + 1] = d[v * 3 + 1]; m[v * 3 + 2] = d[v * 3 + 2]; }
        }
        d.set(m);
      }
      hemY = Infinity;
      for (let v = 0; v < n; v++) {
        pos[v * 3] = before[v * 3] + d[v * 3]; pos[v * 3 + 1] = before[v * 3 + 1] + d[v * 3 + 1]; pos[v * 3 + 2] = before[v * 3 + 2] + d[v * 3 + 2];
        if (pos[v * 3 + 1] < hemY) hemY = pos[v * 3 + 1];
      }
    }
  }
  if (b.dupList && !b.noSafety) unifyDuplicates(b, pos);      // i vertici duplicati (stessa posizione nella sim) restano coincidenti
  const yChest = b.yChestLine + dY;
  return { position: pos, info: { s: Array.from(sK.slice(b.kHem, b.kA + 1)), tightCm: tight * 100, dY, hemY,
    skinFixed, chestGarmentCm: b.rings.length ? b.rings[b.rings.length - 1].fabric * 100 : NaN, chestLineY: yChest, bodyAtChestLineCm: body.girthAt(st, yChest) * 100, bodyAtHemCm: body.girthAt(st, hemY + 0.015) * 100 } };
}

/** Gruppi di vertici coincidenti (stessa posizione a riposo): servono per normali continue attraverso i bordi delle primitive. */
export function weldGroups(position) {
  const n = position.length / 3, group = new Int32Array(n), map = new Map();
  let count = 0;
  for (let v = 0; v < n; v++) {
    const k = `${Math.round(position[v * 3] * 2e4)},${Math.round(position[v * 3 + 1] * 2e4)},${Math.round(position[v * 3 + 2] * 2e4)}`;
    let g = map.get(k);
    if (g === undefined) { g = count++; map.set(k, g); }
    group[v] = g;
  }
  return { group, count };
}

/** Normali per vertice (pesate sull'area), uguali per i vertici dello stesso gruppo. */
export function smoothNormals(position, index, weld, out = null) {
  const acc = new Float64Array(weld.count * 3), nrm = out || new Float32Array(position.length);
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t] * 3, b = index[t + 1] * 3, c = index[t + 2] * 3;
    const ux = position[b] - position[a], uy = position[b + 1] - position[a + 1], uz = position[b + 2] - position[a + 2];
    const vx = position[c] - position[a], vy = position[c + 1] - position[a + 1], vz = position[c + 2] - position[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (let e = 0; e < 3; e++) { const g = weld.group[index[t + e]] * 3; acc[g] += nx; acc[g + 1] += ny; acc[g + 2] += nz; }
  }
  for (let v = 0; v < position.length / 3; v++) {
    const g = weld.group[v] * 3, l = Math.hypot(acc[g], acc[g + 1], acc[g + 2]) || 1;
    nrm[v * 3] = acc[g] / l; nrm[v * 3 + 1] = acc[g + 1] / l; nrm[v * 3 + 2] = acc[g + 2] / l;
  }
  return nrm;
}

/** Matrice 3x3 (per righe) della rotazione minima che porta il versore a su b. */
export function rotationBetween(a, b) {
  const v = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], c = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (c > 0.999999) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const k = 1 / (1 + c);
  return [
    c + k * v[0] * v[0], k * v[0] * v[1] - v[2], k * v[0] * v[2] + v[1],
    k * v[1] * v[0] + v[2], c + k * v[1] * v[1], k * v[1] * v[2] - v[0],
    k * v[2] * v[0] - v[1], k * v[2] * v[1] + v[0], c + k * v[2] * v[2],
  ];
}
