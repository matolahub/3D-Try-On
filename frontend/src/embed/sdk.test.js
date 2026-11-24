// Test dell'SDK con un DOM finto (nessun browser): creazione dell'iframe, handshake, sicurezza sull'origine, aggiornamenti.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const listeners = {};
const posted = [];
const iframeWin = { postMessage: (m, origin) => posted.push({ m, origin }) };
const makeEl = (tag) => ({ tag, style: {}, attrs: {}, children: [], setAttribute(k, v) { this.attrs[k] = v; }, appendChild(c) { this.children.push(c); c.parentNode = this; return c; },
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; }, addEventListener() {}, focus() {}, contentWindow: tag === "iframe" ? iframeWin : null });
globalThis.window = globalThis;
globalThis.self = globalThis;                 // in un browser `self` e la finestra
globalThis.location = { href: "https://shop.test/p/1" };
globalThis.document = { createElement: makeEl, body: makeEl("body"), addEventListener() {}, removeEventListener() {}, activeElement: null };
globalThis.addEventListener = (t, f) => (listeners[t] ||= []).push(f);
globalThis.removeEventListener = (t, f) => { listeners[t] = (listeners[t] || []).filter((x) => x !== f); };
const deliver = (data, origin = "https://tryon.test", source = iframeWin) => (listeners.message || []).forEach((f) => f({ data, origin, source }));
const w = (type, payload) => ({ ns: "tryon", v: 1, from: "widget", type, payload });

const TryOn = createRequire(import.meta.url)("../../public/sdk/tryon-sdk.js");
const product = { id: "1", name: "Tee", category: "tshirt", sizes: [{ label: "M", garmentMeasurements: { chest: 104 } }] };
const opts = (extra = {}) => ({ product, size: "M", widgetUrl: "https://tryon.test/embed.html", ...extra });

test("mount crea un iframe sandboxed che punta al widget", () => {
  const box = makeEl("div");
  const c = TryOn.mount(box, opts());
  assert.equal(box.children.length, 1);
  assert.equal(c.iframe.src, "https://tryon.test/embed.html");
  assert.match(c.iframe.attrs.sandbox, /allow-scripts/);
  assert.ok(!/allow-top-navigation|allow-popups|allow-forms/.test(c.iframe.attrs.sandbox));
  assert.match(c.iframe.attrs.allow, /camera/);           // scansione del corpo
  assert.ok(!/microphone|geolocation|payment/.test(c.iframe.attrs.allow));
  c.destroy();
  assert.equal(box.children.length, 0);
});

test("handshake: alla 'ready' del widget invia init con prodotto, taglia e opzioni, solo all'origine del widget", () => {
  posted.length = 0;
  const events = [];
  const c = TryOn.mount(makeEl("div"), opts({ onReady: (p) => events.push(["ready", p.protocol]) }));
  assert.equal(posted.length, 0);                                     // niente prima di 'ready'
  deliver(w("ready", { protocol: 1 }));
  assert.equal(posted.length, 1);
  assert.equal(posted[0].origin, "https://tryon.test");
  assert.deepEqual([posted[0].m.type, posted[0].m.payload.size, posted[0].m.payload.product.id, posted[0].m.payload.options.shareBody], ["init", "M", "1", false]);
  assert.deepEqual(events, [["ready", 1]]);
  c.destroy();
});

test("ignora messaggi da altre origini, da altre finestre o non del Try-On", () => {
  const events = [];
  const c = TryOn.mount(makeEl("div"), opts({ onSizeChange: (s) => events.push(s) }));
  deliver(w("sizeChange", { size: "L" }), "https://evil.test");
  deliver(w("sizeChange", { size: "L" }), "https://tryon.test", { other: true });
  deliver({ hello: 1 });
  deliver({ ns: "tryon", v: 1, from: "host", type: "sizeChange", payload: { size: "L" } });
  assert.deepEqual(events, []);
  deliver(w("sizeChange", { size: "L" }));
  assert.deepEqual(events, ["L"]);
  c.destroy();
});

test("setSize/setProduct/setBody: in coda finche' il widget non e' pronto, poi inviati", () => {
  posted.length = 0;
  const c = TryOn.mount(makeEl("div"), opts());
  c.setSize("L");
  assert.equal(posted.length, 0);
  deliver(w("ready", { protocol: 1 }));
  assert.equal(posted[0].m.payload.size, "L");                        // l'init porta gia' la taglia aggiornata
  c.setSize("XL"); c.setBody({ chest: 100 }); c.setProduct({ ...product, id: "2" }, "M");
  assert.deepEqual(posted.slice(1).map((p) => p.m.type), ["setSize", "setBody", "setProduct"]);
  assert.ok(posted.slice(1).every((p) => p.origin === "https://tryon.test"));
  c.destroy();
});

test("eventi fit/error/initialized e on() con unsubscribe", () => {
  const got = [];
  const c = TryOn.mount(makeEl("div"), opts({ onFit: (e) => got.push(["fit", e.size]) }));
  const off = c.on("error", (e) => got.push(["error", e.code]));
  deliver(w("fit", { size: "M", zones: {} }));
  deliver(w("error", { code: "invalid_product", message: "x" }));
  off();
  deliver(w("error", { code: "again", message: "x" }));
  assert.deepEqual(got, [["fit", "M"], ["error", "invalid_product"]]);
  c.destroy();
});

test("un errore in un callback del negozio non rompe l'SDK", () => {
  const c = TryOn.mount(makeEl("div"), opts({ onFit: () => { throw new Error("boom"); } }));
  const origErr = console.error; console.error = () => {};
  assert.doesNotThrow(() => deliver(w("fit", { size: "M", zones: {} })));
  console.error = origErr;
  c.destroy();
});

test("dopo destroy non risponde piu' e non invia", () => {
  posted.length = 0;
  const events = [];
  const c = TryOn.mount(makeEl("div"), opts({ onSizeChange: (s) => events.push(s) }));
  c.destroy();
  deliver(w("sizeChange", { size: "L" }));
  c.setSize("S");
  assert.deepEqual(events, []);
  assert.equal(posted.length, 0);
  assert.equal((listeners.message || []).length, 0);
});

test("senza widgetUrl configurato: errore chiaro; configure() lo risolve", () => {
  assert.throws(() => TryOn.mount(makeEl("div"), { product }), /widgetUrl non configurato/);
  TryOn.configure({ widgetUrl: "https://tryon.test/embed.html" });
  const c = TryOn.mount(makeEl("div"), { product });
  assert.equal(c.iframe.src, "https://tryon.test/embed.html");
  c.destroy();
});

test("open: modale accessibile con pulsante di chiusura; close() rimuove tutto", () => {
  const body = globalThis.document.body;
  const before = body.children.length;
  let closed = 0;
  const c = TryOn.open(opts({ onClose: () => closed++ }));
  assert.equal(body.children.length, before + 1);
  const overlay = body.children[body.children.length - 1];
  assert.equal(overlay.attrs.role, "dialog");
  assert.equal(overlay.attrs["aria-modal"], "true");
  c.close();
  assert.equal(body.children.length, before);
  assert.equal(closed, 1);
  c.close();                                                            // idempotente
  assert.equal(closed, 1);
});

test("lo script classico e' generato dal sorgente ESM e non diverge (npm run build:sdk)", async () => {
  const fs = await import("node:fs");
  const { classicFromEsm } = await import("../../scripts/build-sdk.mjs");
  const esm = fs.readFileSync(new URL("../../public/sdk/tryon-sdk.mjs", import.meta.url), "utf8");
  const classic = fs.readFileSync(new URL("../../public/sdk/tryon-sdk.js", import.meta.url), "utf8");
  assert.equal(classicFromEsm(esm), classic, "tryon-sdk.js non e' aggiornato: esegui `npm run build:sdk`");
});

test("l'SDK si importa anche come modulo ESM con la stessa API", async () => {
  const esm = await import("../../public/sdk/tryon-sdk.mjs");
  assert.equal(typeof esm.default.mount, "function");
  assert.equal(typeof esm.default.open, "function");
  assert.equal(esm.default.version, TryOn.version);
  assert.deepEqual(Object.keys(esm.default).sort(), Object.keys(TryOn).filter((k) => k !== "default").sort());
});
