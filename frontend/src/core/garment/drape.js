// Drappeggio del capo: funzioni PURE (nessuna dipendenza da Three.js), testabili in node.
//
// Il capo, sotto il torace, non e' un'offset del corpo: e' tessuto che POGGIA sulle parti sporgenti del corpo e CADE in verticale.
// Ogni sezione orizzontale e' una curva polare r(θ) attorno a un asse verticale (θ = 0 davanti, θ = π/2 verso +x, π dietro).
// Per ogni fetta, dall'alto verso il basso:
//   1. il tessuto non entra nel corpo:               r >= rb   (rb = raggio del guscio convesso del corpo + spessore)
//   2. cade in verticale dalla fetta sopra:          r >= r_sopra - kappa·dy   (kappa = quanto puo' rientrare per metro)
//   3. il giro e' quello del capo, esatto:           perimetro(r) = G
//      - se G e' maggiore: l'ease in eccesso si distribuisce (soprattutto ai lati) fino a raggiungere G
//      - se G e' minore del giro "in caduta": il tessuto rientra verso il corpo (capo che si stringe, es. costina)
//      - se G e' minore del corpo: il capo e' stretto, aderisce (r = rb) e il report lo segnala
//   4. le braccia sono ostacoli: il fianco non puo' espandersi dentro il braccio, l'eccesso va davanti/dietro
//   5. dove c'e' tessuto in eccesso (distanza dal corpo) nascono pieghe verticali, proporzionali all'eccesso
// Unita': metri.

export const TWO_PI = Math.PI * 2;

export const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a || 1)));
  return t * t * (3 - 2 * t);
};

const trigCache = new Map();
/** Seni e coseni degli n angoli θ_i = 2π i / n (in cache: sono usati migliaia di volte per aggiornamento). */
function trig(n) {
  let t = trigCache.get(n);
  if (!t) {
    t = { sin: new Float64Array(n), cos: new Float64Array(n) };
    for (let i = 0; i < n; i++) { t.sin[i] = Math.sin((i * TWO_PI) / n); t.cos[i] = Math.cos((i * TWO_PI) / n); }
    trigCache.set(n, t);
  }
  return t;
}

// ── Geometria 2D (x, z) ──────────────────────────────────────────────────────
/** Guscio convesso (catena monotona di Andrew) di punti [x, z]. Non modifica l'input. */
export function convexHull(points) {
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

export function polygonPerimeter(poly) {
  let per = 0;
  for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; per += Math.hypot(a[0] - b[0], a[1] - b[1]); }
  return per;
}

/** Perimetro del guscio convesso: e' il "nastro" con cui e' calibrato il corpo. NaN se i punti sono meno di 3. */
export function hullPerimeter(points) {
  return points.length < 3 ? NaN : polygonPerimeter(convexHull(points));
}

/** Intersezione del raggio c + t·d con l'edge a-b. Ritorna t (>= 0) o NaN. */
function rayEdge(cx, cz, dx, dz, a, b) {
  const ex = b[0] - a[0], ez = b[1] - a[1];
  const den = dx * ez - dz * ex;
  if (Math.abs(den) < 1e-12) return NaN;
  const px = a[0] - cx, pz = a[1] - cz;
  const t = (px * ez - pz * ex) / den;
  const u = (px * dz - pz * dx) / den;
  return t >= 0 && u >= -1e-9 && u <= 1 + 1e-9 ? t : NaN;
}

/** Raggio di un poligono CONVESSO lungo n direzioni uscenti da un punto interno (cx, cz). Costo O(n + vertici). */
export function hullRadial(hull, cx, cz, n) {
  const r = new Float64Array(n), m = hull.length;
  if (m < 3) return r;
  // vertici ordinati per angolo attorno al centro (θ come nel resto del file: 0 = +z, verso +x)
  const v = hull.map(([x, z]) => {
    let th = Math.atan2(x - cx, z - cz);
    if (th < 0) th += TWO_PI;
    return { th, x: x - cx, z: z - cz };
  }).sort((p, q) => p.th - q.th);
  const { sin, cos } = trig(n);
  let k = 0;                                           // v[k-1] e v[k] racchiudono l'angolo corrente
  for (let i = 0; i < n; i++) {
    const th = (i * TWO_PI) / n;
    while (k < m && v[k].th < th) k++;
    const p = v[(k - 1 + m) % m], q = v[k % m];
    // il raggio d = (sin, cos) incontra il segmento p-q a distanza  (p × q) / (d × (q - p))
    const ex = q.x - p.x, ez = q.z - p.z;
    const den = sin[i] * ez - cos[i] * ex;
    r[i] = Math.abs(den) < 1e-12 ? Math.hypot(p.x, p.z) : (p.x * q.z - p.z * q.x) / den;
  }
  return r;
}

/**
 * Distanza a cui un raggio da (cx, cz) ENTRA in un poligono convesso esterno (ostacolo), Infinity se non lo incontra.
 * Serve per limitare l'espansione del fianco contro il braccio. Si provano solo i raggi dentro l'angolo sotteso dal poligono.
 */
export function hullEntry(hull, cx, cz, n) {
  const r = new Float64Array(n).fill(Infinity);
  if (hull.length < 3) return r;
  let sx = 0, sz = 0;
  for (const [x, z] of hull) { sx += x; sz += z; }
  const mid = Math.atan2(sx / hull.length - cx, sz / hull.length - cz);
  let lo = 0, hi = 0;
  for (const [x, z] of hull) {
    let d = Math.atan2(x - cx, z - cz) - mid;
    d = Math.atan2(Math.sin(d), Math.cos(d));          // in (-π, π]
    if (d < lo) lo = d; if (d > hi) hi = d;
  }
  if (hi - lo > Math.PI * 0.95) return r;              // il centro e' (quasi) dentro il poligono: non e' un ostacolo esterno
  const step = TWO_PI / n;
  const i0 = Math.floor((mid + lo) / step) - 1, i1 = Math.ceil((mid + hi) / step) + 1;
  for (let ii = i0; ii <= i1; ii++) {
    const i = ((ii % n) + n) % n, th = ii * step, dx = Math.sin(th), dz = Math.cos(th);
    let best = Infinity;
    for (let k = 0; k < hull.length; k++) {
      const t = rayEdge(cx, cz, dx, dz, hull[k], hull[(k + 1) % hull.length]);
      if (t < best) best = t;
    }
    r[i] = best;
  }
  return r;
}

/** Raggio polare di una curva a "stella" (non necessariamente convessa) descritta da punti sparsi, campionato in n direzioni. */
export function starRadial(points, cx, cz, n) {
  const pol = points.map(([x, z]) => {
    let th = Math.atan2(x - cx, z - cz);
    if (th < 0) th += TWO_PI;
    return [th, Math.hypot(x - cx, z - cz)];
  }).sort((a, b) => a[0] - b[0]);
  const m = pol.length;
  const r = new Float64Array(n);
  if (!m) return r;
  let k = 0;
  for (let i = 0; i < n; i++) {
    const th = (i * TWO_PI) / n;
    while (k < m && pol[k][0] < th) k++;
    const hi = pol[k % m], lo = pol[(k - 1 + m) % m];
    const a0 = lo[0], a1 = k < m ? hi[0] : hi[0] + TWO_PI;
    const t0 = k === 0 ? a0 - TWO_PI : a0;
    const span = a1 - t0 || 1;
    const u = Math.min(1, Math.max(0, (th - t0) / span));
    r[i] = lo[1] + u * (hi[1] - lo[1]);
  }
  return r;
}

/** Perimetro della curva polare r(θ_i), θ_i = 2π i / n. */
export function ringPerimeter(r) {
  const n = r.length, { sin, cos } = trig(n);
  let per = 0, px = r[n - 1] * sin[n - 1], pz = r[n - 1] * cos[n - 1];   // parte dall'ultimo punto
  for (let i = 0; i < n; i++) {
    const x = r[i] * sin[i], z = r[i] * cos[i];
    per += Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz));
    px = x; pz = z;
  }
  return per;
}

// ── Pieghe ───────────────────────────────────────────────────────────────────
/**
 * Profilo delle pieghe verticali attorno alla sezione, in [0, 1]. Simmetrico destra/sinistra; `tilt` (rad) le inclina
 * leggermente scendendo, dal fianco verso davanti/dietro (come il tessuto che pende dall'ascella).
 */
export function foldPattern(n, count, tilt = 0) {
  const p = new Float64Array(n), { sin, cos } = trig(n);
  const k2 = Math.max(2, Math.round(count * 0.6));             // seconda onda, piu' larga: le pieghe non sono tutte uguali
  // (1 + cos(k·θ + π + ts)) / 2, al quadrato: creste strette e valli larghe; ts = inclinazione, con segno opposto ai due lati
  const wave = (k, i, ts) => {
    const j = (k * i) % n, c = cos[j], s = sin[j], ct = Math.cos(ts), st = Math.sin(ts);
    const v = 0.5 - 0.5 * (c * ct - s * st);
    return v * v;
  };
  for (let i = 0; i < n; i++) {
    const side = sin[i] >= 0 ? 1 : -1;
    const lateral = 0.15 + 0.85 * sin[i] * sin[i];              // le pieghe stanno soprattutto ai fianchi; davanti/dietro il tessuto e' piu' teso
    p[i] = Math.min(1, 0.7 * wave(count, i, side * tilt) + 0.5 * wave(k2, i, -side * tilt * 0.5)) * lateral;
  }
  return p;
}

/**
 * Ampiezza delle pieghe per una fetta: proporzionale all'ease medio (quanto tessuto in piu' del corpo, in raggio), con un massimo.
 * Un capo aderente (ease ~0) non ha pieghe; uno oversize le ha piu' profonde.
 */
export function foldAmplitude(G, bodyPerimeter, { gain, max }, ramp = 1) {
  if (!Number.isFinite(gain) || !Number.isFinite(max)) throw new Error("foldAmplitude: servono { gain, max } numerici");
  const ease = Math.max(0, (G - bodyPerimeter) / TWO_PI);
  return Math.min(ease * gain, max) * ramp;
}

// ── Sezione ──────────────────────────────────────────────────────────────────
/**
 * Risolve una sezione del capo.
 * @param {object} a
 * @param {Float64Array} a.rb     raggio minimo ammesso (corpo + spessore)
 * @param {Float64Array} a.prev   raggio "base" della fetta sopra (senza pieghe): da li' il tessuto pende
 * @param {number} a.G            giro del capo a questa quota
 * @param {number} a.dy           distanza verticale dalla fetta sopra
 * @param {number} a.kappa        rientro massimo per metro di caduta (0 = verticale perfetta)
 * @param {Float64Array} a.w      pesi di distribuzione dell'eccesso (piu' alto = piu' tessuto in quella direzione)
 * @param {Float64Array} [a.caps] raggio massimo per direzione (ostacoli, es. braccia), Infinity se libero
 * @param {{pattern:Float64Array, amp:number}|null} [a.fold]  pieghe: ampiezza = amp·pattern (m), verso l'esterno; consumano tessuto
 * @returns {{ base: Float64Array, r: Float64Array, tight: boolean, gathered: boolean, perimeter: number }}
 */
export function solveRing({ rb, prev, G, dy, kappa, w, caps = null, fold = null }) {
  const n = rb.length;
  const env = new Float64Array(n);
  for (let i = 0; i < n; i++) env[i] = Math.max(rb[i], prev[i] - kappa * dy);

  if (ringPerimeter(rb) >= G) {                                   // capo piu' stretto del corpo: aderisce
    return { base: rb, r: rb, tight: true, gathered: false, perimeter: ringPerimeter(rb) };
  }
  const base = new Float64Array(n);
  if (ringPerimeter(env) >= G) {                                  // il tessuto in caduta e' piu' largo del capo: rientra verso il corpo
    let lo = 0, hi = 1;
    for (let it = 0; it < 26; it++) {
      const s = (lo + hi) / 2;
      for (let i = 0; i < n; i++) base[i] = rb[i] + s * (env[i] - rb[i]);
      if (ringPerimeter(base) < G) lo = s; else hi = s;
    }
    for (let i = 0; i < n; i++) base[i] = rb[i] + hi * (env[i] - rb[i]);
    return { base, r: base, tight: false, gathered: true, perimeter: ringPerimeter(base) };
  }

  // eccesso da distribuire: base(λ) = min(cap, env + λ·w), piu' le pieghe (che consumano tessuto)
  const cap = new Float64Array(n);
  for (let i = 0; i < n; i++) cap[i] = caps ? Math.max(env[i], caps[i]) : Infinity;
  const r = new Float64Array(n);
  const build = (lambda) => {
    for (let i = 0; i < n; i++) {
      base[i] = Math.min(cap[i], env[i] + lambda * w[i]);
      r[i] = base[i] + (fold ? fold.amp * fold.pattern[i] : 0);
    }
    return ringPerimeter(r);
  };
  // perimetro(λ) - G e' continuo e crescente: si cerca la radice con regula falsi (Illinois), di solito in ~6 valutazioni
  let lo = 0, hi = 0.05, fLo = build(0) - G, fHi = build(hi) - G;
  for (let g = 0; g < 40 && fHi < 0; g++) { lo = hi; fLo = fHi; hi *= 2; fHi = build(hi) - G; }
  let side = 0;
  for (let it = 0; it < 40 && hi - lo > 1e-9; it++) {
    const x = (lo * fHi - hi * fLo) / (fHi - fLo);
    const f = build(x) - G;
    if (Math.abs(f) < 1e-7) { lo = hi = x; break; }
    if (f < 0) { lo = x; fLo = f; if (side === -1) fHi /= 2; side = -1; } else { hi = x; fHi = f; if (side === 1) fLo /= 2; side = 1; }
  }
  hi = (lo + hi) / 2;
  const per = build(hi);
  return { base: Float64Array.from(base), r: Float64Array.from(r), tight: false, gathered: false, perimeter: per };
}

/** Pesi di distribuzione dell'eccesso: piu' ai fianchi (θ = ±π/2) che davanti/dietro. */
export function slackWeights(n, lateral = 0.65) {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) { const s = Math.sin((i * TWO_PI) / n); w[i] = (1 - lateral) + lateral * s * s; }
  return w;
}

/**
 * Quota dell'orlo per direzione: dritto sul corpo aderente, piu' alto ai fianchi (il tessuto in eccesso lo tira su)
 * e leggermente piu' lungo dietro (coda). `loose` in [0, 1] = quanto il capo e' abbondante.
 */
export function hemHeights(n, yHem, { sideRise = 0, backDrop = 0, loose = 1 } = {}) {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const th = (i * TWO_PI) / n, s = Math.sin(th), c = Math.cos(th);
    y[i] = yHem + sideRise * loose * s * s - backDrop * Math.max(0, -c);
  }
  return y;
}
