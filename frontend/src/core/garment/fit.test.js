// Test della logica pura di fitting e del contratto: `npm test` (node --test, nessuna dipendenza).
import test from "node:test";
import assert from "node:assert/strict";
import { TEMPLATES } from "./templates.js";
import { buildFitReport, easeVerdict, recommendSize, resolveGarment, sleeveEndLabel, summarizeFit } from "./fit.js";

const body = { chest: 96, waist: 80, hips: 98, height: 174 };
const size = (label, garment, extra = {}) => ({ label, available: true, garment, notes: {}, bodyFit: null, ...extra });
const S = size("S", { chest: 100, length: 68, sleeve: 21, shoulder: 45 });
const M = size("M", { chest: 104, length: 70, sleeve: 22, shoulder: 47 }, { notes: { chest: "larghezza a piatto 52 cm x2" } });
const L = size("L", { chest: 108, length: 72, sleeve: 23, shoulder: 49 });
const sizes = [S, M, L];

test("misure del capo dal negozio: provenienza 'prodotto', mancanti dichiarate", () => {
  const r = resolveGarment({ template: TEMPLATES.tshirt, size: M, body });
  assert.equal(r.measures.chest.value, 104);
  assert.equal(r.measures.chest.origin, "prodotto");
  assert.equal(r.measures.chest.note, "larghezza a piatto 52 cm x2");
  assert.equal(r.measures.length.value, 70);
  assert.deepEqual(r.missing.sort(), ["bicep", "hem", "sleeveOpening", "waist"].sort());   // non presentate come dati del negozio
});

test("senza torace (dati non validati): default del template, segnalato", () => {
  const r = resolveGarment({ template: TEMPLATES.tshirt, size: size("X", {}), body });
  assert.equal(r.measures.chest.origin, "template");
  assert.equal(r.measures.chest.value, body.chest + TEMPLATES.tshirt.chestEase);
  assert.ok(r.notes.length > 0);
});

test("manica dal centro schiena convertita e marcata 'derivato'", () => {
  const s = size("M", { chest: 104, sleeve: 80, sleeveFrom: "centerBack", shoulder: 46 });
  const r = resolveGarment({ template: TEMPLATES.tshirt, size: s, body });
  assert.equal(r.measures.sleeve.value, 80 - 23);
  assert.equal(r.measures.sleeve.origin, "derivato");
});

test("manica dal centro schiena senza spalla: usa la spalla del template e lo dichiara", () => {
  const s = size("M", { chest: 104, sleeve: 80, sleeveFrom: "centerBack" });
  const r = resolveGarment({ template: TEMPLATES.tshirt, size: s, body });
  assert.equal(r.measures.sleeve.value, 80 - TEMPLATES.tshirt.shoulderWidth / 2);
  assert.match(r.measures.sleeve.note, /template/);
});

test("taglia consigliata senza bodyFit: ease piu' vicino a quello del template", () => {
  const r = recommendSize(sizes, TEMPLATES.tshirt, body);     // 96 + 10 = 106 -> M (104, ease 8) e L (108, ease 12): stessa distanza
  assert.ok(["M", "L"].includes(r.label));
  assert.equal(r.tooSmall, false);
});

test("taglia consigliata: se nessuna e' abbastanza grande lo dice", () => {
  const r = recommendSize(sizes, TEMPLATES.tshirt, { chest: 120, waist: 100, hips: 110, height: 175 });
  assert.equal(r.label, "L");
  assert.equal(r.tooSmall, true);
  assert.match(r.reason, /nessuna taglia/);
});

test("taglia consigliata con bodyFit: usa le misure CORPO dichiarate dal negozio", () => {
  const withFit = [
    size("S", { chest: 100 }, { bodyFit: { chest: [88, 92], waist: [74, 78] } }),
    size("M", { chest: 104 }, { bodyFit: { chest: [96, 100], waist: [82, 86] } }),
  ];
  assert.equal(recommendSize(withFit, TEMPLATES.tshirt, { chest: 98, waist: 84, hips: 100, height: 175 }).label, "M");
  const near = recommendSize(withFit, TEMPLATES.tshirt, { chest: 90, waist: 90, hips: 100, height: 175 });
  assert.match(near.reason, /piu' vicina/);
});

test("le taglie non disponibili non vengono consigliate", () => {
  const r = recommendSize([{ ...M, available: false }, S], TEMPLATES.tshirt, body);
  assert.equal(r.label, "S");
  assert.equal(recommendSize([{ ...M, available: false }], TEMPLATES.tshirt, body), null);
  assert.equal(recommendSize([], TEMPLATES.tshirt, body), null);
});

test("verdetti di ease secondo le soglie del template", () => {
  const t = TEMPLATES.tshirt;
  assert.equal(easeVerdict(-3, t), "stretto");
  assert.equal(easeVerdict(3, t), "aderente");
  assert.equal(easeVerdict(10, t), "regular");
  assert.equal(easeVerdict(18, t), "morbido");
  assert.equal(easeVerdict(30, t), "oversize");
  assert.equal(easeVerdict(5, TEMPLATES.hoodie), "aderente");
});

test("etichette della fine manica", () => {
  assert.equal(sleeveEndLabel(0.2), "sopra metà bicipite");
  assert.equal(sleeveEndLabel(0.55), "al gomito");
  assert.equal(sleeveEndLabel(1), "al polso");
  assert.equal(sleeveEndLabel(null), null);
});

test("report: ease, verdetti e provenienza di ogni zona", () => {
  const resolved = resolveGarment({ template: TEMPLATES.tshirt, size: M, body });
  const geom = { gChest: 104, gWaist: 104, gHem: 104, bHem: 98, lengthCm: 70, lengthClamped: false, hemVsHipsCm: -2, sleeveCm: 22, sleeveEndRatio: 0.3 };
  const rep = Object.fromEntries(buildFitReport({ template: TEMPLATES.tshirt, resolved, body, geom }).map((r) => [r.id, r]));
  assert.equal(rep.chest.easeCm, 8);
  assert.equal(rep.chest.verdict, "regular");
  assert.equal(rep.chest.origin, "prodotto");
  assert.equal(rep.waist.origin, "derivato");            // il negozio non ha dato la vita: profilo interpolato, senza giudizio
  assert.equal(rep.waist.verdict, null);
  assert.equal(rep.hem.origin, "template");
  assert.equal(rep.length.origin, "prodotto");
  assert.match(rep.length.text, /fianchi/);
  assert.equal(rep.shoulder.origin, "prodotto");
  assert.equal(buildFitReport({ template: TEMPLATES.tshirt, resolved, body, geom: null }).length, 0);
});

test("report: lunghezza non rappresentabile mostra la dichiarata e avvisa", () => {
  const resolved = resolveGarment({ template: TEMPLATES.tshirt, size: M, body });
  const geom = { gChest: 104, gWaist: 104, gHem: 104, bHem: 98, lengthCm: 59, lengthClamped: true, lengthRequestedCm: 70, hemVsHipsCm: -3, sleeveCm: 22, sleeveEndRatio: 0.3 };
  const len = buildFitReport({ template: TEMPLATES.tshirt, resolved, body, geom }).find((r) => r.id === "length");
  assert.equal(len.garmentCm, 70);
  assert.match(len.warn, /rappresentati 59/);
});

test("report: capo piu' piccolo del corpo => ease negativo 'stretto'", () => {
  const big = { ...body, chest: 110 };
  const resolved = resolveGarment({ template: TEMPLATES.tshirt, size: S, body: big });
  const rep = buildFitReport({ template: TEMPLATES.tshirt, resolved, body: big, geom: { gChest: 100, gWaist: 100, gHem: 100, bHem: 100 } });
  assert.equal(rep.find((r) => r.id === "chest").verdict, "stretto");
  assert.equal(rep.find((r) => r.id === "chest").easeCm, -10);
});

test("riepilogo per l'e-commerce: solo esito della vestibilita', nessuna misura del corpo", () => {
  const resolved = resolveGarment({ template: TEMPLATES.tshirt, size: M, body });
  const rep = buildFitReport({ template: TEMPLATES.tshirt, resolved, body, geom: { gChest: 104, gWaist: 104, gHem: 104, bHem: 98, lengthCm: 70, hemVsHipsCm: 0, sleeveCm: 22, sleeveEndRatio: 0.3 } });
  const s = summarizeFit(rep);
  assert.deepEqual(s.chest, { easeCm: 8, verdict: "regular" });
  assert.ok(!("waist" in s));                              // vita derivata: nessun giudizio
  assert.ok(!JSON.stringify(s).includes("bodyCm"));
});

test("capo 3D reale: il report usa le misure prese sulla mesh dell'asset, non quelle copiate dal negozio", () => {
  const s = size("S", { chest: 111, length: 70, sleeve: 20.9, shoulder: 53.7 });
  const resolved = resolveGarment({ template: TEMPLATES.tshirt, size: s, body });
  const geom = { gChest: 110.8, gWaist: null, gHem: 111.0, bHem: 96.3, lengthCm: 70.1, lengthClamped: false, lengthRequestedCm: 70.1, hemVsHipsCm: -5,
    sleeveCm: 20.9, sleeveEndRatio: null, fromAsset: true, pending: false, tightCm: 0 };
  const rep = buildFitReport({ template: TEMPLATES.tshirt, resolved, body, geom });
  const chest = rep.find((r) => r.id === "chest"), hem = rep.find((r) => r.id === "hem");
  assert.equal(chest.garmentCm, 110.8);
  assert.ok(Math.abs(chest.easeCm - (110.8 - body.chest)) < 1e-9, "ease dal giro misurato sulla mesh");
  assert.match(chest.note, /misurato sulla mesh 3D/);
  assert.equal(hem.origin, "derivato", "l'orlo non viene dal negozio ne' dal template: e' misurato sull'asset");
  assert.match(hem.note, /misurato sulla mesh 3D/);
  assert.equal(chest.warn, undefined);
});

test("capo 3D reale: se la mesh differisce dal dato del negozio lo dichiara; se e' teso sul corpo avvisa", () => {
  const s = size("S", { chest: 114, length: 70 });
  const resolved = resolveGarment({ template: TEMPLATES.tshirt, size: s, body });
  const geom = { gChest: 110.8, gWaist: null, gHem: 111, bHem: 118, lengthCm: 70, lengthClamped: false, lengthRequestedCm: 70, hemVsHipsCm: 0, sleeveCm: null, sleeveEndRatio: null,
    fromAsset: true, pending: false, tightCm: 12 };
  const rep = buildFitReport({ template: TEMPLATES.tshirt, resolved, body: { ...body, chest: 120 }, geom });
  const chest = rep.find((r) => r.id === "chest");
  assert.match(chest.note, /il negozio dichiara 114\.0 cm/);
  assert.equal(chest.verdict, "stretto");
  assert.match(chest.warn, /12 cm/);
});

test("capo 3D reale non ancora caricato: si ripiega sui dati del negozio senza spacciarli per misurati", () => {
  const s = size("S", { chest: 111, length: 70 });
  const resolved = resolveGarment({ template: TEMPLATES.tshirt, size: s, body });
  const rep = buildFitReport({ template: TEMPLATES.tshirt, resolved, body, geom: { gChest: 111, gWaist: null, gHem: null, bHem: null, lengthCm: 70, hemVsHipsCm: null, sleeveCm: null, fromAsset: true, pending: true } });
  const chest = rep.find((r) => r.id === "chest");
  assert.equal(chest.origin, "prodotto");
  assert.ok(!chest.note || !/misurato/.test(chest.note));
  assert.equal(rep.find((r) => r.id === "hem"), undefined);
});
