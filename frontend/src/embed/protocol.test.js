import test from "node:test";
import assert from "node:assert/strict";
import { acceptHostMessage, connectToHost, parseAllowedOrigins } from "./protocol.js";

const parent = { name: "parent" };
const msg = (type, extra = {}) => ({ ns: "tryon", v: 1, from: "host", type, payload: {}, ...extra });
const ev = (data, origin = "https://shop.test", source = parent) => ({ data, origin, source });

test("accetta init dal genitore", () => {
  const r = acceptHostMessage(ev(msg("init")), { parent, hostOrigin: null, allowedOrigins: [] });
  assert.equal(r.ok, true);
});

test("rifiuta messaggi che non vengono dalla finestra genitore", () => {
  assert.equal(acceptHostMessage(ev(msg("init"), "https://shop.test", { other: 1 }), { parent, hostOrigin: null }).reason, "not_parent");
});

test("rifiuta messaggi di altre librerie, versioni diverse e tipi sconosciuti", () => {
  const st = { parent, hostOrigin: null };
  assert.equal(acceptHostMessage(ev({ hello: 1 }), st).reason, "not_tryon");
  assert.equal(acceptHostMessage(ev("stringa"), st).reason, "not_tryon");
  assert.equal(acceptHostMessage(ev(msg("init", { v: 2 })), st).reason, "version_mismatch");
  assert.equal(acceptHostMessage(ev(msg("hack")), st).reason, "unknown_type");
  assert.equal(acceptHostMessage(ev(msg("init", { from: "widget" })), st).reason, "not_tryon");
});

test("elenco di origini consentite: init da un'altra origine e' rifiutato", () => {
  const st = { parent, hostOrigin: null, allowedOrigins: ["https://shop.test"] };
  assert.equal(acceptHostMessage(ev(msg("init"), "https://evil.test"), st).reason, "origin_not_allowed");
  assert.equal(acceptHostMessage(ev(msg("init"), "https://shop.test"), st).ok, true);
});

test("prima di init nessun altro comando; dopo init solo la stessa origine", () => {
  assert.equal(acceptHostMessage(ev(msg("setSize")), { parent, hostOrigin: null }).reason, "not_initialized");
  const st = { parent, hostOrigin: "https://shop.test" };
  assert.equal(acceptHostMessage(ev(msg("setSize")), st).ok, true);
  assert.equal(acceptHostMessage(ev(msg("setSize"), "https://evil.test"), st).reason, "origin_mismatch");
});

test("parseAllowedOrigins", () => {
  assert.deepEqual(parseAllowedOrigins("https://a.com, https://b.com/ ,"), ["https://a.com", "https://b.com"]);
  assert.deepEqual(parseAllowedOrigins(undefined), []);
});

// finestra finta: raccoglie listener e messaggi inviati
function fakeEnv() {
  const listeners = [], sent = [];
  const win = { addEventListener: (t, f) => listeners.push(f), removeEventListener: (t, f) => listeners.splice(listeners.indexOf(f), 1) };
  const par = { postMessage: (m, origin) => sent.push({ m, origin }) };
  return { win, par, listeners, sent, deliver: (e) => listeners.forEach((f) => f(e)) };
}

test("connectToHost: ready senza dati verso '*', poi risposte solo all'origine di init", () => {
  const env = fakeEnv();
  const calls = [];
  const c = connectToHost({ handlers: { init: (p) => calls.push(["init", p]), setSize: (p) => calls.push(["setSize", p]) }, parent: env.par, win: env.win });
  assert.deepEqual(env.sent.map((s) => [s.m.type, s.origin]), [["ready", "*"]]);
  c.send("fit", { secret: 1 });                                       // prima di init: nessun invio
  assert.equal(env.sent.length, 1);
  env.deliver({ data: msg("init", { payload: { a: 1 } }), origin: "https://shop.test", source: env.par });
  env.deliver({ data: msg("setSize", { payload: { size: "L" } }), origin: "https://evil.test", source: env.par });   // ignorato
  env.deliver({ data: msg("setSize", { payload: { size: "M" } }), origin: "https://shop.test", source: env.par });
  assert.deepEqual(calls, [["init", { a: 1 }], ["setSize", { size: "M" }]]);
  c.send("fit", { ok: 1 });
  assert.deepEqual([env.sent[1].m.type, env.sent[1].origin], ["fit", "https://shop.test"]);
  c.destroy();
  assert.equal(env.listeners.length, 0);
});

test("connectToHost: versione non supportata -> errore esplicito alla stessa origine", () => {
  const env = fakeEnv();
  connectToHost({ handlers: {}, parent: env.par, win: env.win });
  env.deliver({ data: msg("init", { v: 9 }), origin: "https://shop.test", source: env.par });
  const err = env.sent.find((s) => s.m.type === "error");
  assert.equal(err.m.payload.code, "version_mismatch");
  assert.equal(err.origin, "https://shop.test");
});
