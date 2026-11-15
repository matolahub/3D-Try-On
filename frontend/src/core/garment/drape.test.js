import test from "node:test";
import assert from "node:assert/strict";
import { convexHull, hullPerimeter, hullRadial, hullEntry, starRadial, ringPerimeter, solveRing, slackWeights, foldPattern, foldAmplitude, hemHeights, TWO_PI } from "./drape.js";

const N = 144;
const circle = (r, n = 200, cx = 0, cz = 0) => Array.from({ length: n }, (_, i) => [cx + r * Math.sin((i * TWO_PI) / n), cz + r * Math.cos((i * TWO_PI) / n)]);
const ellipse = (a, b, n = 200) => Array.from({ length: n }, (_, i) => [a * Math.sin((i * TWO_PI) / n), b * Math.cos((i * TWO_PI) / n)]);
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ""} ${a} vs ${b} (tol ${tol})`);

test("guscio convesso e perimetro di un cerchio", () => {
  near(hullPerimeter(circle(0.15)), TWO_PI * 0.15, 0.002);
  assert.ok(Number.isNaN(hullPerimeter([[0, 0], [1, 1]])));
});

test("il guscio ignora i punti interni (il nastro salta le concavita')", () => {
  const pts = circle(0.15).concat([[0, 0.02], [0.03, 0]]);
  assert.equal(convexHull(pts).length, convexHull(circle(0.15)).length);
});

test("hullRadial: raggio di un ellisse lungo gli assi", () => {
  const r = hullRadial(convexHull(ellipse(0.2, 0.1)), 0, 0, N);
  near(r[0], 0.1, 0.002, "davanti (z)");
  near(r[N / 4], 0.2, 0.002, "fianco (x)");
  near(r[N / 2], 0.1, 0.002, "dietro");
  near(ringPerimeter(r), hullPerimeter(ellipse(0.2, 0.1)), 0.004);
});

test("starRadial ricostruisce un cerchio fuori centro", () => {
  const r = starRadial(circle(0.1, 60, 0.02, -0.01), 0.02, -0.01, N);
  for (const i of [0, 30, 72, 100]) near(r[i], 0.1, 0.002);
});

test("hullEntry: ostacolo laterale (braccio) e raggi che non lo incontrano", () => {
  const arm = convexHull(circle(0.05, 40, 0.25, 0));
  const e = hullEntry(arm, 0, 0, N);
  near(e[N / 4], 0.2, 0.002, "verso il braccio");
  assert.equal(e[0], Infinity, "davanti non c'e' nulla");
});

const setup = () => {
  const rb = hullRadial(convexHull(ellipse(0.16, 0.11)), 0, 0, N).map((v) => v + 0.0035);
  return { rb, prev: rb.slice(), dy: 0.01, kappa: 0.35, w: slackWeights(N) };
};

test("solveRing: il giro finale e' esattamente quello del capo (ease 10 cm)", () => {
  const s = setup();
  const G = ringPerimeter(s.rb) + 0.1;
  const r = solveRing({ ...s, G });
  near(r.perimeter, G, 1e-4);
  assert.ok(!r.tight);
  for (let i = 0; i < N; i++) assert.ok(r.r[i] >= s.rb[i] - 1e-9, "il tessuto non entra nel corpo");
});

test("solveRing: capo piu' stretto del corpo -> aderisce e lo segnala", () => {
  const s = setup();
  const r = solveRing({ ...s, G: ringPerimeter(s.rb) - 0.05 });
  assert.equal(r.tight, true);
  assert.deepEqual(Array.from(r.r), Array.from(s.rb));
});

test("solveRing: l'eccesso va soprattutto ai fianchi, poco davanti/dietro", () => {
  const s = setup();
  const r = solveRing({ ...s, G: ringPerimeter(s.rb) + 0.2 });
  const side = r.r[N / 4] - s.rb[N / 4], front = r.r[0] - s.rb[0];
  assert.ok(side > front * 1.5, `fianco ${side} vs davanti ${front}`);
});

test("solveRing: il braccio limita l'espansione del fianco, l'eccesso passa davanti/dietro e il giro resta esatto", () => {
  const s = setup();
  const G = ringPerimeter(s.rb) + 0.25;
  const caps = new Float64Array(N).fill(Infinity);
  for (let i = 0; i < N; i++) { const th = (i * TWO_PI) / N; if (Math.abs(Math.sin(th)) > 0.7) caps[i] = 0.19; }
  const free = solveRing({ ...s, G });
  const capped = solveRing({ ...s, G, caps });
  near(capped.perimeter, G, 1e-4);
  assert.ok(capped.r[N / 4] <= 0.19 + 1e-9, "il fianco non supera il braccio");
  assert.ok(capped.r[0] > free.r[0], "davanti prende l'eccesso che non entra ai fianchi");
});

test("solveRing: cade in verticale dalla fetta sopra (sporgenza del ventre si mantiene)", () => {
  const s = setup();
  const belly = s.rb.slice();
  for (let i = 0; i < N; i++) { const th = (i * TWO_PI) / N; if (Math.abs(th) < 0.5 || th > TWO_PI - 0.5) belly[i] += 0.04; }
  const G = ringPerimeter(belly) + 0.02;
  const r = solveRing({ rb: s.rb, prev: belly, G, dy: 0.01, kappa: 0, w: s.w });
  assert.ok(r.r[0] > s.rb[0] + 0.03, "davanti resta a distanza dal corpo, non lo segue verso l'interno");
  near(r.perimeter, G, 1e-4);
});

test("solveRing: capo che si stringe (costina) rientra verso il corpo con giro esatto", () => {
  const s = setup();
  const wide = s.rb.map((v) => v + 0.05);
  const G = ringPerimeter(s.rb) + 0.06;
  const r = solveRing({ ...s, prev: wide, G, kappa: 0 });
  assert.equal(r.gathered, true);
  near(r.perimeter, G, 1e-4);
  for (let i = 0; i < N; i++) assert.ok(r.r[i] >= s.rb[i] - 1e-9);
});

test("pieghe: l'ampiezza dipende dall'ease medio (capo aderente = nessuna piega), le pieghe consumano tessuto e non entrano nel corpo", () => {
  const s = setup();
  const per = ringPerimeter(s.rb);
  const spec = { gain: 0.35, max: 0.012 };
  assert.equal(foldAmplitude(per, per, spec), 0, "ease zero: nessuna piega");
  assert.ok(foldAmplitude(per + 0.05, per, spec) < foldAmplitude(per + 0.3, per, spec), "piu' ease, pieghe piu' profonde");
  assert.ok(foldAmplitude(per + 5, per, spec) <= 0.012 + 1e-12, "con un massimo");
  const amp = foldAmplitude(per + 0.3, per, spec);
  const fold = { pattern: foldPattern(N, 16), amp };
  const loose = solveRing({ ...s, G: per + 0.3, fold });
  const smooth = solveRing({ ...s, G: per + 0.3 });
  const ripple = Math.max(...loose.r.map((v, i) => v - loose.base[i]));
  assert.ok(ripple > 0.003, `pieghe visibili con molto eccesso (${ripple})`);
  near(loose.perimeter, per + 0.3, 1e-4);
  assert.ok(loose.base[N / 4] < smooth.base[N / 4], "le pieghe consumano tessuto: la base e' meno espansa");
  for (let i = 0; i < N; i++) assert.ok(loose.r[i] >= s.rb[i] - 1e-9);
});

test("pieghe: piu' marcate ai fianchi che davanti/dietro", () => {
  const p = foldPattern(N, 16);
  let side = 0, front = 0;
  for (let i = 0; i < N; i++) { const th = (i * TWO_PI) / N; if (Math.abs(Math.sin(th)) > 0.9) side = Math.max(side, p[i]); if (Math.abs(Math.sin(th)) < 0.2) front = Math.max(front, p[i]); }
  assert.ok(side > front * 2, `fianco ${side} vs davanti ${front}`);
});

test("pieghe simmetriche destra/sinistra", () => {
  const p = foldPattern(N, 16, 0.4);
  for (let i = 1; i < N / 2; i++) near(p[i], p[N - i], 1e-9);
});

test("orlo: dritto se aderente, piu' alto ai fianchi e piu' lungo dietro se ampio", () => {
  const flat = hemHeights(N, 0.8, { sideRise: 0.02, backDrop: 0, loose: 0 });
  assert.ok(flat.every((v) => Math.abs(v - 0.8) < 1e-9), "capo aderente: orlo dritto");
  const h = hemHeights(N, 0.8, { sideRise: 0.02, backDrop: 0.01, loose: 1 });
  near(h[N / 4], 0.82, 1e-9);
  near(h[0], 0.8, 1e-9);
  assert.ok(h[N / 2] < 0.8, "dietro piu' lungo");
});
