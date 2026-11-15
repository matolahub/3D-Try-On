// Le misure del CORPO restano nel browser dell'utente (localStorage dell'origine del widget): non passano dal negozio
// e non vanno a nessun server. Ogni accesso e' protetto: lo storage puo' essere bloccato (privacy, iframe di terze parti).
import { clampBody } from "../core/bodyMeasures.js";

const KEY = "tryon.body.v1";

export function loadBody() {
  try {
    const raw = window.localStorage.getItem(KEY);
    return raw ? clampBody(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function saveBody(body) {
  try { window.localStorage.setItem(KEY, JSON.stringify(body)); } catch { /* storage non disponibile: si continua senza */ }
}

export function clearBody() {
  try { window.localStorage.removeItem(KEY); } catch { /* idem */ }
}
