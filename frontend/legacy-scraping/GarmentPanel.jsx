import { useEffect, useMemo, useRef, useState } from "react";
import { extractProduct } from "./api.js";
import { DEMO_PRODUCTS, MANUAL_PRODUCT } from "./demoProducts.js";
import { TEMPLATES } from "./garmentTemplates.js";
import { KIND_LABEL, ORIGIN_LABEL, effectiveKind, findRow, recommendSize, resolveGarment } from "./garmentFit.js";

const css = `
  .gp-row { display: flex; gap: 6px; margin-bottom: 8px; }
  .gp-input, .gp-select {
    width: 100%; min-width: 0; background: var(--input-bg, #111); border: 1px solid var(--border); color: var(--text);
    border-radius: 6px; padding: 7px 8px; font: inherit; font-size: 11px; outline: none;
  }
  .gp-input:focus, .gp-select:focus { border-color: rgba(255,255,255,.3); }
  .gp-btn {
    background: var(--accent); color: #000; border: 1px solid var(--accent); border-radius: 6px; padding: 7px 10px;
    font: inherit; font-size: 11px; font-weight: 500; cursor: pointer; white-space: nowrap;
  }
  .gp-btn:disabled { opacity: .45; cursor: default; }
  .gp-btn.ghost { background: transparent; color: var(--muted); border-color: var(--border); font-weight: 400; }
  .gp-btn.ghost:hover:not(:disabled) { color: var(--text); border-color: rgba(255,255,255,.25); }
  .gp-small { font-size: 10px; color: var(--muted); line-height: 1.5; }
  .gp-err { font-size: 11px; color: #f87171; background: rgba(248,113,113,.08); border: 1px solid rgba(248,113,113,.25); border-radius: 6px; padding: 8px; margin-bottom: 8px; line-height: 1.5; }
  .gp-warn { font-size: 10px; color: #fbbf24; line-height: 1.5; margin: 2px 0; }
  .gp-product { display: flex; gap: 10px; margin: 10px 0 8px; }
  .gp-thumb { width: 52px; height: 64px; object-fit: cover; border-radius: 6px; background: #151515; flex-shrink: 0; border: 1px solid var(--border); }
  .gp-name { font-size: 12px; line-height: 1.35; color: var(--text); }
  .gp-label { font-size: 10px; color: var(--muted); margin: 8px 0 4px; letter-spacing: .04em; }
  .gp-badge { display: inline-block; font-size: 9px; padding: 1px 5px; border-radius: 4px; border: 1px solid var(--border); color: var(--muted); margin-left: 4px; vertical-align: 1px; }
  .gp-badge.prodotto { color: #4ade80; border-color: rgba(74,222,128,.35); }
  .gp-badge.manuale { color: #60a5fa; border-color: rgba(96,165,250,.35); }
  .gp-badge.derivato { color: #fbbf24; border-color: rgba(251,191,36,.35); }
  .gp-badge.template { color: #a3a3a3; border-color: rgba(163,163,163,.3); border-style: dashed; }
  .gp-table { width: 100%; border-collapse: collapse; font-size: 10.5px; }
  .gp-table td { padding: 4px 0; border-bottom: 1px solid var(--border); vertical-align: top; }
  .gp-table td:first-child { white-space: nowrap; padding-right: 8px; }
  .gp-table td:last-child { text-align: right; }
  .gp-verdict { font-weight: 500; }
  .gp-verdict.stretto { color: #f87171; } .gp-verdict.aderente { color: #fbbf24; }
  .gp-verdict.regular { color: #4ade80; } .gp-verdict.morbido { color: #60a5fa; } .gp-verdict.oversize { color: #a78bfa; }
  details.gp-details summary { cursor: pointer; font-size: 10px; color: var(--muted); margin: 8px 0 4px; }
  .gp-grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .gp-field { font-size: 9.5px; color: var(--muted); display: flex; flex-direction: column; gap: 3px; }
  .gp-color { width: 100%; height: 26px; padding: 0; border: 1px solid var(--border); border-radius: 6px; background: none; cursor: pointer; }
`;

const KEY_LABEL = { chest: "Torace", hem: "Orlo", waist: "Vita", length: "Lunghezza", sleeve: "Manica", sleeveOpening: "Apertura manica", bicep: "Bicipite", shoulder: "Spalle" };
const MANUAL_FIELDS = [["chest", "Torace (giro)"], ["hem", "Orlo (giro)"], ["length", "Lunghezza"], ["sleeve", "Manica"]];
const fmt = (v) => (Number.isFinite(v) ? (Math.round(v * 10) / 10).toString() : "–");

function Badge({ origin }) {
  const title = {
    prodotto: "Dato letto dalla pagina prodotto", manuale: "Inserito da te",
    derivato: "Ricavato da dati del prodotto con una regola dichiarata", template: "Valore di default del template: il prodotto non lo fornisce",
  }[origin];
  return <span className={`gp-badge ${origin}`} title={title}>{ORIGIN_LABEL[origin] || origin}</span>;
}

export default function GarmentPanel({ body, report, onGarmentChange }) {
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [ext, setExt] = useState(null);
  const [category, setCategory] = useState("");
  const [kindOverride, setKindOverride] = useState(null);
  const [size, setSize] = useState("");
  const [manual, setManual] = useState({});
  const [color, setColor] = useState(null);
  const abortRef = useRef(null);

  const template = category ? TEMPLATES[category] : null;
  const chart = ext?.size_chart || null;
  const kind = chart ? effectiveKind(chart, kindOverride) : null;
  const { chest, waist, hips } = body;
  const rec = useMemo(() => (chart && template ? recommendSize(chart, kind, template, { chest, waist, hips }) : null), [chart, template, kind, chest, waist, hips]);

  const resolved = useMemo(
    () => (template ? resolveGarment({ template, chart, kind, sizeLabel: size, manual, body: { chest } }) : null),
    [template, chart, kind, size, manual, chest],
  );

  const effectiveColor = color || ext?.dominant_color || template?.color;
  useEffect(() => {
    onGarmentChange(template && resolved ? { template, resolved, color: effectiveColor, category } : null);
  }, [template, resolved, effectiveColor, category, onGarmentChange]);

  const load = (data) => {
    setError(null);
    setExt(data);
    setKindOverride(null);
    setManual({});
    setColor(null);
    const cat = data.classification.category;
    setCategory(cat === "tshirt" || cat === "hoodie" ? cat : "");
    const c = data.size_chart;
    const t = TEMPLATES[cat];
    const k = c ? effectiveKind(c, null) : null;
    const r = c && t ? recommendSize(c, k, t, { chest, waist, hips }) : null;
    setSize(r?.label || c?.rows?.[0]?.size || data.product.sizes_available?.[0] || "");
  };

  const clear = () => { setExt(null); setCategory(""); setError(null); setSize(""); setManual({}); setColor(null); };

  const analyze = async () => {
    if (!url.trim() || loading) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true); setError(null);
    try {
      load(await extractProduct(url.trim(), ac.signal));
    } catch (e) {
      if (e.name !== "AbortError") { clear(); setError(e.message); }   // niente prodotto vecchio accanto a un URL fallito
    } finally {
      setLoading(false);
    }
  };

  const row = findRow(chart, size);
  const sizeOptions = chart ? chart.rows.map((r) => r.size) : (ext?.product.sizes_available || []);

  return (
    <>
      <style>{css}</style>
      <div className="gp-row">
        <input className="gp-input" placeholder="URL della pagina prodotto" value={url} onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && analyze()} spellCheck={false} />
        <button className="gp-btn" onClick={analyze} disabled={loading || !url.trim()}>{loading ? "…" : "Analizza"}</button>
      </div>
      <div className="gp-row" style={{ marginBottom: 0 }}>
        <button className="gp-btn ghost" onClick={() => load(DEMO_PRODUCTS.tshirt)}>Esempio T-shirt</button>
        <button className="gp-btn ghost" onClick={() => load(DEMO_PRODUCTS.hoodie)}>Esempio hoodie</button>
        <button className="gp-btn ghost" onClick={() => load(MANUAL_PRODUCT)}>Inserisci a mano</button>
        {ext && <button className="gp-btn ghost" onClick={clear}>Rimuovi</button>}
      </div>
      {error && <div className="gp-err" style={{ marginTop: 8 }}>{error}<div className="gp-small" style={{ marginTop: 4 }}>Puoi comunque provare il capo con «Inserisci a mano».</div></div>}

      {ext && (
        <>
          <div className="gp-product">
            {ext.product.images?.[0] && <img className="gp-thumb" src={ext.product.images[0].url} alt="" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
            <div>
              <div className="gp-name">{ext.product.name || "Prodotto senza nome"}</div>
              <div className="gp-small">
                {ext.demo ? "esempio (non è un prodotto reale)" : ext.manual ? "misure inserite da te" : (ext.product.brand || new URL(ext.final_url || ext.url).hostname)}
              </div>
            </div>
          </div>

          {ext.warnings.map((w) => <div className="gp-warn" key={w.code + w.message}>⚠ {w.message}</div>)}

          <div className="gp-label">CATEGORIA {ext.classification.confidence > 0 && !ext.demo && <span className="gp-small" title={ext.classification.reasons.join("; ")}>· rilevata {Math.round(ext.classification.confidence * 100)}%</span>}</div>
          <select className="gp-select" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">— scegli —</option>
            <option value="tshirt">T-shirt</option>
            <option value="hoodie">Hoodie</option>
          </select>

          {template && (
            <>
              <div className="gp-label">TAGLIA</div>
              <div className="gp-row" style={{ marginBottom: 4 }}>
                <select className="gp-select" value={size} onChange={(e) => setSize(e.target.value)}>
                  {sizeOptions.map((s) => <option key={s} value={s}>{s}{rec && findRow(chart, s)?.size === rec.label ? "  ★ consigliata" : ""}</option>)}
                  {!sizeOptions.length && <option value="">—</option>}
                </select>
              </div>
              {rec && <div className="gp-small">Consigliata: {rec.label} ({rec.reason}).</div>}

              {chart && (
                <>
                  <div className="gp-label">TIPO DI MISURE DELLA TABELLA</div>
                  <select className="gp-select" value={kindOverride || kind} onChange={(e) => setKindOverride(e.target.value)}>
                    <option value="garment">{KIND_LABEL.garment}</option>
                    <option value="body">{KIND_LABEL.body}</option>
                  </select>
                  <div className="gp-small" style={{ marginTop: 3 }}>
                    {kindOverride ? "Scelto da te." : chart.kind === "unknown" ? `Non dichiarato dalla pagina: ipotesi «${KIND_LABEL[kind]}».` : `Dichiarato dalla pagina${chart.kind_reasons?.length ? ` (${chart.kind_reasons[0]})` : ""}.`}
                    {chart.unit_assumed && " Unità assunta."}
                  </div>
                </>
              )}

              {resolved && (
                <>
                  <div className="gp-label">MISURE DEL CAPO USATE</div>
                  <table className="gp-table"><tbody>
                    {Object.entries(resolved.measures).map(([k, v]) => (
                      <tr key={k} title={v.note || ""}><td>{KEY_LABEL[k] || k}</td><td>{fmt(v.value)} cm <Badge origin={v.origin} /></td></tr>
                    ))}
                    {resolved.missing.filter((k) => !["waist", "bicep", "shoulder", "sleeveOpening"].includes(k)).map((k) => (
                      <tr key={k}><td>{KEY_LABEL[k]}</td><td className="gp-small">non nel prodotto <Badge origin="template" /></td></tr>
                    ))}
                  </tbody></table>
                  {resolved.notes.map((n) => <div className="gp-small" style={{ marginTop: 4 }} key={n}>ℹ {n}</div>)}
                  {row && chart.warnings.map((w) => <div className="gp-warn" key={w}>⚠ {w}</div>)}
                </>
              )}

              {report.length > 0 && (
                <>
                  <div className="gp-label">VESTIBILITÀ SUL TUO CORPO</div>
                  <table className="gp-table"><tbody>
                    {report.map((r) => (
                      <tr key={r.id} title={r.note || ""}>
                        <td>{r.label}<Badge origin={r.origin} /></td>
                        <td>
                          {r.easeCm !== undefined ? (
                            <>{fmt(r.garmentCm)} vs {fmt(r.bodyCm)} cm · <span className="gp-small">{r.easeCm >= 0 ? "+" : ""}{fmt(r.easeCm)}</span> {r.verdict && <span className={`gp-verdict ${r.verdict}`}>{r.verdict}</span>}</>
                          ) : (
                            <>{fmt(r.garmentCm)} cm{r.text ? <div className="gp-small">{r.text}</div> : null}{r.warn ? <div className="gp-warn">⚠ {r.warn}</div> : null}</>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody></table>
                </>
              )}

              <details className="gp-details">
                <summary>Correggi/inserisci misure del capo (cm)</summary>
                <div className="gp-grid2">
                  {MANUAL_FIELDS.map(([k, label]) => (
                    <label className="gp-field" key={k}>{label}
                      <input className="gp-input" type="number" min="0" step="0.5" placeholder={resolved?.measures[k] ? fmt(resolved.measures[k].value) : "—"}
                        value={manual[k] ?? ""} onChange={(e) => setManual((m) => ({ ...m, [k]: e.target.value }))} />
                    </label>
                  ))}
                </div>
                <div className="gp-small" style={{ marginTop: 4 }}>Le misure inserite qui sono marcate «manuale». Il torace è la circonferenza completa, non la larghezza a piatto.</div>
              </details>

              <div className="gp-label">COLORE {ext.dominant_color && !color && <span className="gp-small">· dall'immagine del prodotto</span>}</div>
              <input className="gp-color" type="color" value={effectiveColor} onChange={(e) => setColor(e.target.value)} />
            </>
          )}
        </>
      )}
    </>
  );
}
