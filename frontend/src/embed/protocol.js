// Protocollo postMessage tra l'SDK (pagina del negozio) e il widget (iframe). Versione 1.
//
// Envelope:  { ns: "tryon", v: 1, from: "host" | "widget", type, payload }
//
// host -> widget:   init { product, size?, body?, options?{ shareBody } }   setSize { size }   setProduct { product, size? }   setBody { body }
// widget -> host:   ready { protocol }   initialized { productId, size, recommendedSize, warnings }   sizeChange { size, source }
//                   fit { productId, size, zones, recommendedSize }   bodyChange { body }  (solo con options.shareBody)   error { code, message, details? }
//
// Sicurezza:
//  - il widget accetta messaggi SOLO dalla finestra genitore (event.source === window.parent);
//  - dopo `init` accetta solo l'origine che ha inviato `init` e risponde a quella (mai "*", tranne il messaggio `ready`, che non contiene dati);
//  - se la configurazione ha un elenco di origini consentite (VITE_TRYON_ALLOWED_ORIGINS), `init` da altre origini e' rifiutato;
//  - le misure del corpo dell'utente non escono dal widget salvo `options.shareBody: true` richiesto esplicitamente dal negozio.

export const NS = "tryon";
export const PROTOCOL_VERSION = 1;
const HOST_TYPES = new Set(["init", "setSize", "setProduct", "setBody"]);

export function makeMessage(type, payload) {
  return { ns: NS, v: PROTOCOL_VERSION, from: "widget", type, payload };
}

/**
 * Valida un messaggio ricevuto dal negozio.
 * @param event  MessageEvent-like: { data, origin, source }
 * @param state  { parent, hostOrigin, allowedOrigins }
 * @returns {{ ok: true, message } | { ok: false, reason: string }}
 */
export function acceptHostMessage(event, state) {
  if (event.source !== state.parent) return { ok: false, reason: "not_parent" };
  const d = event.data;
  if (!d || typeof d !== "object" || d.ns !== NS || d.from !== "host" || typeof d.type !== "string") return { ok: false, reason: "not_tryon" };
  if (d.v !== PROTOCOL_VERSION) return { ok: false, reason: "version_mismatch" };
  if (!HOST_TYPES.has(d.type)) return { ok: false, reason: "unknown_type" };
  if (d.type === "init") {
    const list = state.allowedOrigins || [];
    if (list.length && !list.includes(event.origin)) return { ok: false, reason: "origin_not_allowed" };
  } else if (!state.hostOrigin) {
    return { ok: false, reason: "not_initialized" };
  } else if (event.origin !== state.hostOrigin) {
    return { ok: false, reason: "origin_mismatch" };
  }
  return { ok: true, message: d };
}

/** "https://a.com, https://b.com" -> ["https://a.com","https://b.com"] */
export function parseAllowedOrigins(value) {
  return String(value || "").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
}

/**
 * Collega il widget al negozio. Ritorna { send, destroy }.
 * @param handlers  { init(payload), setSize(payload), setProduct(payload), setBody(payload) }
 */
export function connectToHost({ handlers, allowedOrigins = [], parent = window.parent, win = window }) {
  const state = { parent, hostOrigin: null, allowedOrigins };
  const send = (type, payload) => {
    if (!state.hostOrigin) return;                          // niente dati verso origini non identificate
    parent.postMessage(makeMessage(type, payload), state.hostOrigin);
  };
  const onMessage = (event) => {
    const r = acceptHostMessage(event, state);
    if (!r.ok) {
      if (r.reason === "origin_not_allowed" || r.reason === "version_mismatch") console.warn(`[tryon] messaggio rifiutato: ${r.reason} (${event.origin})`);
      if (r.reason === "version_mismatch" && event.origin && event.source === parent) {
        parent.postMessage(makeMessage("error", { code: "version_mismatch", message: `Versione del protocollo non supportata (attesa ${PROTOCOL_VERSION}).` }), event.origin);
      }
      return;
    }
    const { type, payload } = r.message;
    if (type === "init") state.hostOrigin = event.origin;
    handlers[type]?.(payload || {});
  };
  win.addEventListener("message", onMessage);
  // `ready` non contiene dati: puo' essere inviato senza conoscere l'origine del negozio
  if (parent !== win) parent.postMessage(makeMessage("ready", { protocol: PROTOCOL_VERSION }), "*");
  return { send, destroy: () => win.removeEventListener("message", onMessage), state };
}
