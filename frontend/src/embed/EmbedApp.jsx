import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TryOnEngine } from "../core/engine.js";
import { BODY_KEYS, clampBody, defaultBody } from "../core/bodyMeasures.js";
import { normalizeProduct, pickSize } from "../core/contract.js";
import { TEMPLATES } from "../core/garment/templates.js";
import { assetFor } from "../core/garment/assets.js";
import { ORIGIN_LABEL, buildFitReport, recommendSize, resolveGarment, summarizeFit } from "../core/garment/fit.js";
import { connectToHost, parseAllowedOrigins } from "./protocol.js";
import { clearBody, saveBody } from "./bodyStore.js";

const VIEWS = [
  { label: "Fronte", angle: 0 },
  { label: "Destra", angle: 90 },
  { label: "Retro", angle: 180 },
  { label: "Sinistra", angle: 270 },
];
const KEY_LABEL = { chest: "Torace (giro)", waist: "Vita (giro)", hem: "Orlo (giro)", length: "Lunghezza", sleeve: "Manica", sleeveOpening: "Apertura manica", bicep: "Bicipite", shoulder: "Spalle" };
const SHOWN_WHEN_MISSING = ["length", "sleeve", "hem"];
const CATEGORY_LABEL = { tshirt: "T-shirt", hoodie: "Hoodie" };
const fmt = (v) => (Number.isFinite(v) ? (Math.round(v * 10) / 10).toString() : "–");
const ALLOWED_ORIGINS = parseAllowedOrigins(import.meta.env.VITE_TRYON_ALLOWED_ORIGINS);
const STANDALONE = typeof window !== "undefined" && window.parent === window;

function Badge({ origin }) {
  const title = { prodotto: "Misura fornita dal negozio per questa taglia", derivato: "Ricavata dai dati del negozio con una regola dichiarata", template: "Default del template: il negozio non la fornisce" }[origin];
  return <span className={`tw-badge ${origin}`} title={title}>{ORIGIN_LABEL[origin] || origin}</span>;
}

export default function EmbedApp({ modelUrl }) {
  const mountRef = useRef(null);
  const engineRef = useRef(null);
  const hostRef = useRef(null);
  const shareBodyRef = useRef(false);

  const [modelReady, setModelReady] = useState(false);
  const [modelError, setModelError] = useState(null);
  const [connected, setConnected] = useState(false);
  const [problem, setProblem] = useState(null);            // { errors: [...] } se i dati del negozio non sono validi
  const [product, setProduct] = useState(null);            // prodotto normalizzato (contratto v1)
  const [warnings, setWarnings] = useState([]);
  const [sizeLabel, setSizeLabel] = useState("");
  // Il widget si apre SEMPRE con le misure di partenza (corpo base): quelle salvate da una visita precedente non vengono ricaricate
  // (si riparte puliti, senza dover premere "Ripristina misure"). Il negozio puo' comunque passarle con init/setBody.
  const [body, setBody] = useState(() => { clearBody(); return defaultBody(); });
  const [report, setReport] = useState([]);
  const [angle, setAngle] = useState(0);
  const [autoRotate, setAutoRotate] = useState(false);
  const [activeView, setActiveView] = useState(0);

  const specRef = useRef(null);
  const bodyRef = useRef(body);                       // ultimo valore, per i gestori dei messaggi
  useEffect(() => { bodyRef.current = body; }, [body]);

  // ── Motore 3D ────────────────────────────────────────────────────────────
  useEffect(() => {
    const onGeom = (geom) => {                          // capo 3D reale appena caricato: il report passa dai dati del negozio alle misure sulla mesh
      const sp = specRef.current;
      if (sp) setReport(buildFitReport({ template: sp.template, resolved: sp.resolved, body: bodyRef.current, geom }));
    };
    const engine = new TryOnEngine(mountRef.current, { modelUrl, onAngle: setAngle, onGeom });
    engineRef.current = engine;
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("debug")) window.__tryon = { engine };
    engine.load().then(() => setModelReady(true)).catch((e) => {
      setModelError(e.message);
      hostRef.current?.send("error", { code: "model_load_failed", message: e.message });
    });
    return () => { engine.dispose(); engineRef.current = null; };
  }, [modelUrl]);

  // ── Comunicazione con il negozio ─────────────────────────────────────────
  const applyProduct = useCallback((input, requestedSize) => {
    const r = normalizeProduct(input);
    if (!r.ok) {
      setProduct(null); setProblem({ errors: r.errors }); setWarnings([]);
      hostRef.current?.send("error", { code: "invalid_product", message: "I dati del prodotto non rispettano il contratto v1.", details: r.errors });
      return;
    }
    setProblem(null); setProduct(r.product); setWarnings(r.warnings);
    const s = pickSize(r.product, requestedSize);
    setSizeLabel(s.label);
    const rec = recommendSize(r.product.sizes, TEMPLATES[r.product.category], bodyRef.current);
    hostRef.current?.send("initialized", { productId: r.product.id, size: s.label, recommendedSize: rec ? rec.label : null, warnings: r.warnings });
  }, []);

  useEffect(() => {
    const host = connectToHost({
      allowedOrigins: ALLOWED_ORIGINS,
      handlers: {
        init: (p) => {
          shareBodyRef.current = !!(p.options && p.options.shareBody);
          if (p.body) setBody(clampBody(p.body));
          setConnected(true);
          applyProduct(p.product, p.size);
        },
        setProduct: (p) => applyProduct(p.product, p.size),
        setSize: (p) => setSizeLabel((cur) => cur === p.size ? cur : (p.size ?? cur)),
        setBody: (p) => setBody(clampBody({ ...bodyRef.current, ...p.body })),
      },
    });
    hostRef.current = host;
    return () => { host.destroy(); hostRef.current = null; };
  }, [applyProduct]);

  // ── Capo: misure del negozio -> template -> motore ───────────────────────
  const template = product ? TEMPLATES[product.category] : null;
  const size = product ? pickSize(product, sizeLabel) : null;
  const resolved = useMemo(() => (template && size ? resolveGarment({ template, size, body: { chest: body.chest } }) : null),
    [template, size, body.chest]);
  const spec = useMemo(() => (template && resolved ? { template, resolved, color: product.color || template.color, category: product.category, asset: assetFor(product.asset, product.category, size.label) } : null), [template, resolved, product, size]);
  const rec = useMemo(() => (product ? recommendSize(product.sizes, template, body) : null), [product, template, body]);

  useEffect(() => {
    const engine = engineRef.current;
    specRef.current = spec;
    if (!modelReady || !engine) return;
    const geom = engine.apply({ body, garment: spec });          // sistema esterno (WebGL): il report ne deriva
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReport(spec ? buildFitReport({ template: spec.template, resolved: spec.resolved, body, geom }) : []);
  }, [modelReady, body, spec]);

  useEffect(() => { saveBody(body); }, [body]);

  // Esito della vestibilita' verso il negozio (senza misure del corpo, salvo shareBody esplicito)
  useEffect(() => {
    if (!product || !size || !report.length) return undefined;
    const t = setTimeout(() => {
      hostRef.current?.send("fit", { productId: product.id, size: size.label, zones: summarizeFit(report), recommendedSize: rec ? rec.label : null });
      if (shareBodyRef.current) hostRef.current?.send("bodyChange", { body });
    }, 250);
    return () => clearTimeout(t);
  }, [report, product, size, rec, body]);

  // ── Azioni dell'utente ───────────────────────────────────────────────────
  const chooseSize = (label) => {
    setSizeLabel(label);
    hostRef.current?.send("sizeChange", { size: label, source: "user" });
  };
  const changeBody = (field, raw) => {
    const k = BODY_KEYS.find((x) => x.field === field);
    const v = Math.max(k.min, Math.min(k.max, Number(raw)));
    setBody((b) => ({ ...b, [field]: Number.isFinite(v) ? v : k.initial }));
  };
  const resetBody = () => { clearBody(); setBody(defaultBody()); };
  const setView = (i) => { const a = VIEWS[i].angle; engineRef.current?.setAngle(a); engineRef.current?.setAutoRotate(false); setAngle(a); setActiveView(i); setAutoRotate(false); };
  const onRotation = (e) => { const a = +e.target.value; engineRef.current?.setAngle(a); engineRef.current?.setAutoRotate(false); setAngle(a); setAutoRotate(false); setActiveView(-1); };
  const toggleAuto = () => { const on = !autoRotate; setAutoRotate(on); engineRef.current?.setAutoRotate(on); if (on) setActiveView(-1); };
  const pct = (angle / 360) * 100;

  // ── Stati che coprono la scena ───────────────────────────────────────────
  let overlay = null;
  if (modelError) overlay = <><strong>Modello 3D non disponibile</strong>{modelError}</>;
  else if (problem) overlay = (<div><strong>Dati del prodotto non validi</strong>Il negozio ha inviato dati che non rispettano il contratto.
    <ul>{problem.errors.slice(0, 8).map((e) => <li key={e}>• {e}</li>)}</ul></div>);
  else if (STANDALONE) overlay = <><strong>Try-On</strong>Questo widget va incorporato nella pagina prodotto di un negozio (vedi docs/integration.md).</>;
  else if (!connected) overlay = <><strong>Try-On</strong>In attesa dei dati del prodotto…</>;

  return (
    <div className="vto">
      <header className="vto-header">
        <div className="vto-logo">{product ? product.name : "Try-On"}{product && <span> · {CATEGORY_LABEL[product.category]}</span>}</div>
        <div className="vto-status"><div className="vto-dot" />{size ? `Taglia ${size.label}` : "Try-On"}</div>
      </header>

      <div className="vto-body">
        <div className="vto-canvas" ref={mountRef}>
          <div className={`vto-loading${modelReady ? " done" : ""}`}>
            <div className="vto-spinner" />
            <div className="vto-loading-label">Caricamento modello</div>
          </div>
          {overlay && <div className="tw-overlay">{overlay}</div>}
        </div>

        <aside className="vto-sidebar">
          {product && (
            <>
              <div className="vto-sidebar-section">
                <div className="tw-product">
                  {product.images[0] && <img className="tw-thumb" src={product.images[0]} alt="" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                  <div><div className="tw-name">{product.name}</div><div className="tw-sub">{CATEGORY_LABEL[product.category]}</div></div>
                </div>
                <div className="vto-section-title">Taglia</div>
                <div className="tw-chips">
                  {product.sizes.map((s) => (
                    <button key={s.label} className={`tw-chip${s.label === size.label ? " active" : ""}${s.available ? "" : " soldout"}`} onClick={() => chooseSize(s.label)} title={s.available ? "" : "Esaurita"}>
                      {s.label}{rec && rec.label === s.label && <span className="tw-star" title="Consigliata per le tue misure">★</span>}
                    </button>
                  ))}
                </div>
                {rec && <div className="tw-small" style={{ marginTop: 8 }}>Consigliata: <strong>{rec.label}</strong> — {rec.reason}.</div>}
                {warnings.length > 0 && (
                  <details style={{ marginTop: 8 }}><summary className="tw-small" style={{ cursor: "pointer" }}>{warnings.length} avvisi sui dati del negozio</summary>
                    {warnings.map((w) => <div className="tw-warn" key={w}>⚠ {w}</div>)}
                  </details>
                )}
              </div>

              {resolved && (
                <div className="vto-sidebar-section">
                  <div className="vto-section-title">Misure del capo · taglia {size.label}</div>
                  <table className="tw-table"><tbody>
                    {Object.entries(resolved.measures).map(([k, v]) => (
                      <tr key={k} title={v.note || ""}><td>{KEY_LABEL[k]}</td><td>{fmt(v.value)} cm <Badge origin={v.origin} /></td></tr>
                    ))}
                    {resolved.missing.filter((k) => SHOWN_WHEN_MISSING.includes(k)).map((k) => (
                      <tr key={k}><td>{KEY_LABEL[k]}</td><td className="tw-small">non fornita <Badge origin="template" /></td></tr>
                    ))}
                  </tbody></table>
                  {resolved.notes.map((n) => <div className="tw-warn" key={n}>ℹ {n}</div>)}
                </div>
              )}

              {report.length > 0 && (
                <div className="vto-sidebar-section">
                  <div className="vto-section-title">Vestibilità sul tuo corpo</div>
                  <table className="tw-table"><tbody>
                    {report.map((r) => (
                      <tr key={r.id} title={r.note || ""}>
                        <td>{r.label}<Badge origin={r.origin} /></td>
                        <td>
                          {r.easeCm !== undefined ? (
                            <>{fmt(r.garmentCm)} vs {fmt(r.bodyCm)} cm · <span className="tw-small">{r.easeCm >= 0 ? "+" : ""}{fmt(r.easeCm)}</span> {r.verdict && <span className={`tw-verdict ${r.verdict}`}>{r.verdict}</span>}</>
                          ) : (
                            <>{fmt(r.garmentCm)} cm{r.text ? <div className="tw-small">{r.text}</div> : null}{r.warn ? <div className="tw-warn">⚠ {r.warn}</div> : null}</>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody></table>
                </div>
              )}
            </>
          )}

          <div className="vto-sidebar-section">
            <div className="vto-section-title">Le tue misure · corpo</div>
            {BODY_KEYS.map((k) => (
              <div className="vto-measure" key={k.field}>
                <div className="vto-measure-header">
                  <span className="vto-measure-name">{k.label}</span>
                  <div className="vto-measure-input-wrap">
                    <input type="number" className="vto-measure-input" value={body[k.field]} min={k.min} max={k.max} step={k.step} onChange={(e) => changeBody(k.field, e.target.value)} />
                    <span className="vto-measure-unit">cm</span>
                  </div>
                </div>
                <input type="range" className="vto-measure-range" min={k.min} max={k.max} step={k.step} value={body[k.field]} onChange={(e) => changeBody(k.field, e.target.value)} />
                <div className="vto-range-labels"><span>{k.min}</span><span>{k.max}</span></div>
              </div>
            ))}
            <div className="tw-small">Le tue misure restano su questo dispositivo: non vengono inviate al negozio.</div>
            <button className="tw-btn" onClick={resetBody}>Ripristina misure</button>
          </div>

          <div className="vto-sidebar-section">
            <div className="vto-section-title">Vista</div>
            <div className="vto-views">
              {VIEWS.map((v, i) => <button key={v.label} className={`vto-view-btn${activeView === i ? " active" : ""}`} onClick={() => setView(i)}>{v.label}</button>)}
            </div>
            <div className="vto-auto" style={{ marginTop: 12 }} onClick={toggleAuto}>
              <span>Rotazione automatica</span><div className={`vto-toggle${autoRotate ? " on" : ""}`} />
            </div>
          </div>
        </aside>
      </div>

      <footer className="vto-footer">
        <div className="vto-angle">{Math.round(angle)}°</div>
        <div className="vto-slider-wrap">
          <div className="vto-track"><div className="vto-fill" style={{ width: `${pct}%` }} /></div>
          <div className="vto-thumb" style={{ left: `${pct}%` }} />
          <input type="range" className="vto-range" min={0} max={360} step={0.5} value={angle} onChange={onRotation} />
        </div>
        <div className="vto-hint">Trascina per ruotare · rotella per lo zoom</div>
      </footer>
    </div>
  );
}
