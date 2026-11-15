// Client dell'API di estrazione (backend FastAPI, proxy Vite su /api).

export class ExtractError extends Error {
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/** URL prodotto → { product, classification, size_chart, dominant_color, warnings, ... }. Solleva ExtractError. */
export async function extractProduct(url, signal) {
  let res;
  try {
    res = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal,
    });
  } catch (e) {
    if (e.name === "AbortError") throw e;
    throw new ExtractError("Backend non raggiungibile. Avvia il server (uvicorn main:app --port 8000).", "backend_unreachable");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const d = data && data.detail;
    // 502/503/504 senza un errore dell'API: il proxy di sviluppo non raggiunge il backend (spento o non avviato)
    if (!d && [500, 502, 503, 504].includes(res.status)) {
      throw new ExtractError("Backend non raggiungibile. Avvia il server: cd backend && source venv/bin/activate && uvicorn main:app --port 8000", "backend_unreachable");
    }
    throw new ExtractError((d && d.message) || (typeof d === "string" ? d : `Errore ${res.status}`), (d && d.code) || "error");
  }
  return data;
}
