import test from "node:test";
import assert from "node:assert/strict";
import { normalizeProduct, pickSize } from "./contract.js";

const valid = () => ({
  id: "TSH-001", name: "Tee", category: "tshirt", color: "#1f2937", images: ["https://cdn.shop.test/a.jpg"],
  sizes: [
    { label: "S", garmentMeasurements: { chestWidth: 50, length: 68, sleeve: 21, shoulder: 45 } },
    { label: "M", garmentMeasurements: { chest: 104, length: 70, sleeve: 22 }, bodyFit: { chest: [96, 100] } },
  ],
});

test("prodotto valido: normalizzato, larghezza a piatto convertita in giro con nota", () => {
  const r = normalizeProduct(valid());
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
  const [s, m] = r.product.sizes;
  assert.equal(s.garment.chest, 100);
  assert.match(s.notes.chest, /x2/);
  assert.equal(m.garment.chest, 104);
  assert.deepEqual(m.bodyFit, { chest: [96, 100] });
  assert.equal(r.product.color, "#1f2937");
});

test("chest come larghezza a piatto e' un errore che spiega come correggere", () => {
  const p = valid();
  p.sizes[0].garmentMeasurements = { chest: 52 };
  const r = normalizeProduct(p);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /larghezza a piatto.*chestWidth/);
});

test("torace mancante", () => {
  const p = valid();
  p.sizes[1].garmentMeasurements = { length: 70 };
  const r = normalizeProduct(p);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(" "), /manca il torace/);
});

test("chest e chestWidth incoerenti", () => {
  const p = valid();
  p.sizes[0].garmentMeasurements = { chest: 100, chestWidth: 60 };
  assert.match(normalizeProduct(p).errors.join(" "), /non coincidono/);
  p.sizes[0].garmentMeasurements = { chest: 100, chestWidth: 50 };
  assert.equal(normalizeProduct(p).ok, true);
});

test("categoria, id, nome e taglie obbligatori", () => {
  const r = normalizeProduct({ sizes: [] });
  assert.equal(r.ok, false);
  const t = r.errors.join(" | ");
  assert.match(t, /product\.id/); assert.match(t, /product\.name/); assert.match(t, /product\.category/); assert.match(t, /almeno una taglia/);
  assert.equal(normalizeProduct({ ...valid(), category: "jeans" }).ok, false);
});

test("taglie duplicate e senza etichetta", () => {
  const p = valid();
  p.sizes.push({ label: "S", garmentMeasurements: { chest: 100 } }, { garmentMeasurements: { chest: 100 } });
  const t = normalizeProduct(p).errors.join(" | ");
  assert.match(t, /duplicata/); assert.match(t, /label mancante/);
});

test("valori non numerici o fuori range", () => {
  const p = valid();
  p.sizes[1].garmentMeasurements = { chest: 104, length: "70cm", sleeve: 300 };
  const t = normalizeProduct(p).errors.join(" | ");
  assert.match(t, /length deve essere un numero/); assert.match(t, /sleeve = 300/);
});

test("stringhe numeriche accettate (CMS/JSON)", () => {
  const p = valid();
  p.sizes[1].garmentMeasurements = { chest: "104", length: "70,5" };
  const r = normalizeProduct(p);
  assert.equal(r.ok, true);
  assert.equal(r.product.sizes[1].garment.length, 70.5);
});

test("campi sconosciuti e dati opzionali assenti: avvisi, non errori", () => {
  const p = valid();
  p.extra = 1; p.color = "rosso"; p.sizes[0].garmentMeasurements.foo = 3; delete p.sizes[1].garmentMeasurements.sleeve;
  const r = normalizeProduct(p);
  assert.equal(r.ok, true);
  const t = r.warnings.join(" | ");
  assert.match(t, /product\.extra/); assert.match(t, /rosso/); assert.match(t, /"foo"/); assert.match(t, /sleeve assente/);
  assert.equal(r.product.color, null);
});

test("immagini non http(s) ignorate; units diverso da cm rifiutato", () => {
  const p = valid();
  p.images = ["javascript:alert(1)", "https://ok.test/x.png"];
  assert.deepEqual(normalizeProduct(p).product.images, ["https://ok.test/x.png"]);
  assert.equal(normalizeProduct({ ...valid(), units: "in" }).ok, false);
});

test("input non oggetto", () => {
  assert.equal(normalizeProduct(null).ok, false);
  assert.equal(normalizeProduct("x").ok, false);
  assert.equal(normalizeProduct([]).ok, false);
});

test("pickSize: richiesta, altrimenti prima disponibile", () => {
  const r = normalizeProduct({ ...valid(), sizes: [{ label: "S", available: false, garmentMeasurements: { chest: 100 } }, { label: "M", garmentMeasurements: { chest: 104 } }] });
  assert.equal(pickSize(r.product, "S").label, "S");
  assert.equal(pickSize(r.product, "XL").label, "M");
});
