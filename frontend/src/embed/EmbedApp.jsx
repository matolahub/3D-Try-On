import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TryOnEngine } from "../core/engine.js";
import { BODY_KEYS, clampBody, defaultBody } from "../core/bodyMeasures.js";
import { normalizeProduct, pickSize } from "../core/contract.js";
import { TEMPLATES } from "../core/garment/templates.js";
import { assetFor } from "../core/garment/assets.js";
import { ORIGIN_LABEL, buildFitReport, easeVerdict, recommendSize, resolveGarment, summarizeFit } from "../core/garment/fit.js";
import { connectToHost, parseAllowedOrigins } from "./protocol.js";
import { clearBody, saveBody } from "./bodyStore.js";

// Scansione con la fotocamera: modulo separato (MediaPipe ~ qualche MB), caricato solo quando l'utente la apre
const BodyScan = lazy(() => import("../scan/BodyScan.jsx"));
const SCAN_CONF = { alta: "affidabilità alta", media: "affidabilità media", bassa: "affidabilità bassa" };

// Viste rapide sul modello (la rotazione libera si fa trascinando)
const VIEWS = [
  { label: "Fronte", angle: 0 },
  { label: "Lato", angle: 90 },
  { label: "Retro", angle: 180 },
];
const KEY_LABEL = { chest: "Torace (giro)", waist: "Vita (giro)", hem: "Orlo (giro)", length: "Lunghezza", sleeve: "Manica", sleeveOpening: "Apertura manica", bicep: "Bicipite", shoulder: "Spalle" };
const SHOWN_WHEN_MISSING = ["length", "sleeve", "hem"];
const CATEGORY_LABEL = { tshirt: "T-shirt", hoodie: "Felpa con cappuccio" };
// Vestibilita' per l'acquirente (i nomi interni del motore restano invariati: arrivano anche al negozio nell'evento `fit`)
const FIT_WORD = { stretto: "Stretta", aderente: "Aderente", regular: "Regolare", morbido: "Morbida", oversize: "Oversize" };
const FIT_STEPS = ["stretto", "aderente", "regular", "morbido", "oversize"];
const FIT_HINT = {
  stretto: "Il capo è più stretto del tuo corpo: tirerà sul tessuto.",
  aderente: "Segue il corpo da vicino, con poco spazio.",
  regular: "Comoda, con il giusto spazio.",
  morbido: "Ampia e rilassata.",
  oversize: "Molto ampia, volutamente abbondante.",
};
// Ordine e spiegazioni delle misure del corpo, nel linguaggio di chi si misura a casa
const MEASURE_UI = {
  height: { label: "Altezza", help: "Senza scarpe" },
  chest: { label: "Petto", help: "Nel punto più ampio, sotto le ascelle" },
  waist: { label: "Vita", help: "Nel punto più stretto del busto" },
  hips: { label: "Fianchi", help: "Nel punto più ampio del bacino" },
};
const MEASURE_ORDER = ["height", "chest", "waist", "hips"];
const TABS = [
  { id: "fit", label: "Vestibilità" },
  { id: "body", label: "Le tue misure" },
  { id: "details", label: "Dettagli" },
];
const fmt = (v) => (Number.isFinite(v) ? (Math.round(v * 10) / 10).toString() : "–");
const ALLOWED_ORIGINS = parseAllowedOrigins(import.meta.env.VITE_TRYON_ALLOWED_ORIGINS);
const STANDALONE = typeof window !== "undefined" && window.parent === window;

function Badge({ origin }) {
  const title = { prodotto: "Misura fornita dal negozio per questa taglia", derivato: "Ricavata dai dati del negozio con una regola dichiarata", template: "Default del template: il negozio non la fornisce" }[origin];
  return <span className={`tw-badge ${origin}`} title={title}>{ORIGIN_LABEL[origin] || origin}</span>;
}

// ── Icone (tratto 1.6, 20x20) ───────────────────────────────────────────────
const Icon = ({ d, size = 18 }) => (
  <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const IconRotate = (p) => <Icon {...p} d={<><path d="M16.5 9.5a6.5 6.5 0 1 1-2-4.7" /><path d="M16.5 3.5v3.3h-3.3" /></>} />;
const IconHand = (p) => <Icon {...p} d={<><path d="M4 10h12" /><path d="M7 7l-3 3 3 3" /><path d="M13 7l3 3-3 3" /></>} />;
const IconInfo = (p) => <Icon {...p} d={<><circle cx="10" cy="10" r="7.5" /><path d="M10 9v4.5" /><path d="M10 6.4v.1" /></>} />;
const IconAlert = (p) => <Icon {...p} d={<><path d="M10 3.2 2.8 16h14.4L10 3.2Z" /><path d="M10 8.3v3.6" /><path d="M10 13.9v.1" /></>} />;
const IconChevron = (p) => <Icon {...p} d={<path d="m7.5 5 5 5-5 5" />} />;
const IconCamera = (p) => <Icon {...p} d={<><path d="M3 7.2c0-.9.7-1.6 1.6-1.6h2l1.2-1.8h4.4l1.2 1.8h2c.9 0 1.6.7 1.6 1.6v7.6c0 .9-.7 1.6-1.6 1.6H4.6c-.9 0-1.6-.7-1.6-1.6V7.2Z" /><circle cx="10" cy="10.8" r="3" /></>} />;
const IconLock = (p) => <Icon {...p} d={<><rect x="4.5" y="9" width="11" height="8" rx="1.8" /><path d="M7 9V6.8a3 3 0 0 1 6 0V9" /></>} />;

function Wordmark() {
  return <span className="wi-wordmark" aria-label="wearIT"><span className="wi-wordmark-wear">wear</span><span className="wi-wordmark-it">IT</span></span>;
}

/** Scala della vestibilita' a 5 gradini con il segnaposto sul giudizio. */
function FitScale({ verdict }) {
  const i = FIT_STEPS.indexOf(verdict);
  return (
    <div className="wi-scale" role="img" aria-label={`Vestibilità: ${FIT_WORD[verdict] || "non disponibile"}`}>
      <div className="wi-scale-track">
        {FIT_STEPS.map((v, k) => <span key={v} className={`wi-scale-seg${k === i ? " on" : ""}`} />)}
        {i >= 0 && <span className={`wi-scale-dot v-${verdict}`} style={{ left: `${((i + 0.5) / FIT_STEPS.length) * 100}%` }} />}
      </div>
      <div className="wi-scale-labels"><span>Stretta</span><span>Regolare</span><span>Oversize</span></div>
    </div>
  );
}

/** Una misura del corpo: valore modificabile a mano, pulsanti -/+ e cursore. */
function MeasureField({ k, value, onChange }) {
  const [draft, setDraft] = useState(null);
  const ui = MEASURE_UI[k.field];
  const pct = ((value - k.min) / (k.max - k.min)) * 100;
  const commit = () => { if (draft !== null && draft !== "") onChange(k.field, draft); setDraft(null); };
  return (
    <div className="wi-measure">
      <div className="wi-measure-row">
        <label className="wi-measure-label" htmlFor={`m-${k.field}`}>{ui.label}<small>{ui.help}</small></label>
        <div className="wi-stepper">
          <button type="button" className="wi-step" aria-label={`${ui.label}: meno 1 cm`} onClick={() => onChange(k.field, value - 1)} disabled={value <= k.min}>−</button>
          <span className="wi-step-value">
            <input id={`m-${k.field}`} inputMode="numeric" value={draft ?? String(value)} aria-label={`${ui.label} in centimetri`}
              onFocus={(e) => { setDraft(String(value)); e.target.select(); }} onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))}
              onBlur={commit} onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }} />
            <span>cm</span>
          </span>
          <button type="button" className="wi-step" aria-label={`${ui.label}: più 1 cm`} onClick={() => onChange(k.field, value + 1)} disabled={value >= k.max}>+</button>
        </div>
      </div>
      <input type="range" className="wi-range" min={k.min} max={k.max} step={k.step} value={value} style={{ "--p": `${pct}%` }}
        aria-label={`${ui.label}, da ${k.min} a ${k.max} cm`} onChange={(e) => onChange(k.field, e.target.value)} />
    </div>
  );
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
  const [tab, setTab] = useState("fit");
  const [garmentLoading, setGarmentLoading] = useState(false);     // capo 3D in caricamento (il corpo e' gia' visibile)
  const [scanOpen, setScanOpen] = useState(() => import.meta.env.DEV && new URLSearchParams(window.location.search).has("scan"));                  // scansione con la fotocamera aperta
  const [scanInfo, setScanInfo] = useState(null);                   // affidabilita' dell'ultima scansione (finche' l'utente non corregge a mano)
  const [hint, setHint] = useState(true);                           // suggerimento "trascina per ruotare", fino alla prima interazione
  // Il motore riceve le misure al massimo ogni ~110 ms: trascinando un cursore il valore mostrato cambia subito, il capo si ricalcola
  // senza accodare decine di deformazioni (ognuna costa decine di millisecondi, di piu' su un telefono).
  const [engineBody, setEngineBody] = useState(body);
  const lastPush = useRef(0);
  const drag = useRef(null);

  const specRef = useRef(null);
  const bodyRef = useRef(body);                       // ultimo valore, per i gestori dei messaggi
  useEffect(() => { bodyRef.current = body; }, [body]);

  // ── Motore 3D ────────────────────────────────────────────────────────────
  useEffect(() => {
    const onGeom = (geom) => {                          // capo 3D reale appena caricato: il report passa dai dati del negozio alle misure sulla mesh
      const sp = specRef.current;
      if (sp) setReport(buildFitReport({ template: sp.template, resolved: sp.resolved, body: bodyRef.current, geom }));
      setGarmentLoading(false);
    };
    const engine = new TryOnEngine(mountRef.current, { modelUrl, onAngle: setAngle, onGeom, framing: "outfit" });
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
    const wait = Math.max(0, 110 - (performance.now() - lastPush.current));
    const t = setTimeout(() => { lastPush.current = performance.now(); setEngineBody(body); }, wait);
    return () => clearTimeout(t);
  }, [body]);

  useEffect(() => {
    const engine = engineRef.current;
    specRef.current = spec;
    if (!modelReady || !engine) return;
    const geom = engine.apply({ body: engineBody, garment: spec });    // sistema esterno (WebGL): il report ne deriva
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReport(spec ? buildFitReport({ template: spec.template, resolved: spec.resolved, body: engineBody, geom }) : []);
    setGarmentLoading(!!(spec?.asset && geom?.pending));
  }, [modelReady, engineBody, spec]);

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
    setScanInfo(null);
  };
  const resetBody = () => { clearBody(); setBody(defaultBody()); setScanInfo(null); };
  const onScanDone = ({ body: scanned, scan }) => {
    setBody(clampBody({ ...bodyRef.current, ...scanned }));
    setScanInfo(scan);
    setScanOpen(false);
    setTab("fit");
  };
  useEffect(() => { if (import.meta.env.DEV && window.__tryon) window.__tryon.scanDone = onScanDone; });   // solo con ?debug: prova del passaggio scansione -> modello
  const scanRanges = useMemo(() => Object.fromEntries(BODY_KEYS.map((k) => [k.field, [k.min, k.max]])), []);
  const heightKey = BODY_KEYS.find((k) => k.field === "height");
  const rotateTo = (a) => { engineRef.current?.setAngle(a); engineRef.current?.setAutoRotate(false); setAngle(a); setAutoRotate(false); setHint(false); };
  const setView = (i) => { rotateTo(VIEWS[i].angle); setActiveView(i); };
  const toggleAuto = () => { const on = !autoRotate; setAutoRotate(on); engineRef.current?.setAutoRotate(on); setHint(false); if (on) setActiveView(-1); };
  // trascinare il modello lo ruota (un dito o il mouse); il secondo dito lo lascia allo zoom
  const onStageDown = (e) => { if (e.pointerType === "mouse" && e.button !== 0) return; if (!drag.current) drag.current = { id: e.pointerId, x: e.clientX, a: angle }; };
  const onStageMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) < 2) return;
    rotateTo((((d.a + dx * 0.6) % 360) + 360) % 360);
    setActiveView(-1);
  };
  const onStageUp = (e) => { if (drag.current && drag.current.id === e.pointerId) drag.current = null; };

  const isDefaultBody = BODY_KEYS.every((k) => body[k.field] === k.initial);
  const sizeFit = useMemo(() => {             // vestibilita' al torace di ogni taglia (dati del negozio): confronto rapido tra taglie
    if (!product || !template) return {};
    const out = {};
    for (const s of product.sizes) { const c = s.garment.chest; if (Number.isFinite(c)) out[s.label] = easeVerdict(c - body.chest, template); }
    return out;
  }, [product, template, body.chest]);
  const chestRow = report.find((r) => r.id === "chest");
  const lengthRow = report.find((r) => r.id === "length");
  const sleeveRow = report.find((r) => r.id === "sleeve");
  const hemRow = report.find((r) => r.id === "hem");

  // ── Stati che coprono la scena ───────────────────────────────────────────
  let state = null;
  if (modelError) state = { kind: "error", title: "Non riusciamo a mostrare il modello 3D", text: "Controlla la connessione e riapri la prova virtuale.", detail: modelError };
  else if (problem) state = { kind: "error", title: "Questo prodotto non si può provare", text: "Le informazioni del capo inviate dal negozio sono incomplete.", detail: problem.errors.slice(0, 8).join("\n") };
  else if (STANDALONE) state = { kind: "intro", title: "Prova i capi sul tuo corpo, in 3D", text: "wearIT si apre dalla pagina di un prodotto: scegli un capo nel negozio e premi «Prova su di te»." };
  else if (!connected) state = { kind: "wait", title: "Preparo il capo…", text: "" };

  const loading = !modelReady && !state;

  return (
    <div className="wi">
      <header className="wi-top">
        <Wordmark />
      </header>

      <main className="wi-main">
        <section className="wi-stage" aria-label="Anteprima 3D del capo indossato"
          onPointerDown={onStageDown} onPointerMove={onStageMove} onPointerUp={onStageUp} onPointerCancel={onStageUp}>
          <div className="wi-canvas" ref={mountRef} />

          {loading && (
            <div className="wi-stage-cover">
              <div className="wi-loader"><span /><span /><span /></div>
              <p className="wi-cover-title">Preparo il modello</p>
              <p className="wi-cover-text">Pochi secondi e potrai vedere come ti sta.</p>
            </div>
          )}
          {state && (
            <div className={`wi-stage-cover is-${state.kind}`}>
              {state.kind === "intro" ? <Wordmark /> : state.kind === "error" ? <span className="wi-cover-icon"><IconAlert size={22} /></span> : <div className="wi-loader"><span /><span /><span /></div>}
              <p className="wi-cover-title">{state.title}</p>
              {state.text && <p className="wi-cover-text">{state.text}</p>}
              {state.detail && <details className="wi-cover-detail"><summary>Dettagli tecnici</summary><pre>{state.detail}</pre></details>}
            </div>
          )}

          {modelReady && !state && garmentLoading && (
            <div className="wi-chip-status" role="status"><span className="wi-spinner" />Carico il capo…</div>
          )}
          {modelReady && !state && !garmentLoading && hint && (
            <div className="wi-chip-status is-hint"><IconHand size={16} />Trascina per ruotare</div>
          )}

          {modelReady && !state && (
            <div className="wi-views" role="group" aria-label="Vista">
              {VIEWS.map((v, i) => (
                <button key={v.label} type="button" className={`wi-view${activeView === i ? " on" : ""}`} aria-pressed={activeView === i} onClick={() => setView(i)}>{v.label}</button>
              ))}
              <button type="button" className={`wi-view wi-view-icon${autoRotate ? " on" : ""}`} aria-pressed={autoRotate} aria-label="Rotazione automatica" title="Rotazione automatica" onClick={toggleAuto}><IconRotate size={17} /></button>
            </div>
          )}
        </section>

        {(product || !state || state.kind === "wait") && <section className="wi-panel" aria-label="Taglia, vestibilità e misure">
          {product ? (
            <>
              <div className="wi-product">
                {product.images[0] && <img className="wi-thumb" src={product.images[0]} alt="" referrerPolicy="no-referrer" onError={(e) => { e.currentTarget.style.display = "none"; }} />}
                <div>
                  <h1 className="wi-product-name">{product.name}</h1>
                  <p className="wi-product-sub">{CATEGORY_LABEL[product.category]}</p>
                </div>
              </div>

              <nav className="wi-tabs" role="tablist" aria-label="Sezioni">
                {TABS.map((t) => (
                  <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`wi-tab${tab === t.id ? " on" : ""}`} onClick={() => setTab(t.id)}>
                    {t.label}{t.id === "body" && isDefaultBody && <span className="wi-tab-dot" aria-label="da completare" />}
                  </button>
                ))}
              </nav>

              <div className="wi-panel-body" key={tab}>
                {tab === "fit" && (
                  <div className="wi-section" role="tabpanel">
                    <div className="wi-label-row"><span className="wi-label">Taglia</span>{rec && <span className="wi-label-note">★ consigliata per te</span>}</div>
                    <div className="wi-sizes">
                      {product.sizes.map((s) => (
                        <button key={s.label} type="button" className={`wi-size${s.label === size.label ? " on" : ""}${s.available ? "" : " off"}`}
                          aria-pressed={s.label === size.label} disabled={!s.available} onClick={() => chooseSize(s.label)}
                          aria-label={`Taglia ${s.label}${s.available ? "" : ", esaurita"}${rec && rec.label === s.label ? ", consigliata" : ""}${sizeFit[s.label] ? `, vestibilità ${FIT_WORD[sizeFit[s.label]].toLowerCase()}` : ""}`}>
                          <span className="wi-size-label">{s.label}{rec && rec.label === s.label && <i className="wi-size-star">★</i>}</span>
                          <span className="wi-size-fit">{s.available ? (sizeFit[s.label] ? FIT_WORD[sizeFit[s.label]] : "") : "Esaurita"}</span>
                        </button>
                      ))}
                    </div>
                    {rec && rec.tooSmall && <p className="wi-note is-warn"><IconAlert size={16} />Anche la taglia più grande potrebbe starti stretta.</p>}

                    {isDefaultBody && (
                      <button type="button" className="wi-cta-card" onClick={() => setTab("body")}>
                        <span><strong>Vedi come ti sta davvero</strong>Ora vedi un corpo di riferimento. Inserisci le tue misure: bastano 30 secondi.</span>
                        <IconChevron size={18} />
                      </button>
                    )}

                    <div className="wi-fit-card">
                      {garmentLoading || !chestRow ? (
                        <div className="wi-skeleton" aria-label="Calcolo della vestibilità"><span /><span /><span /></div>
                      ) : (
                        <>
                          <div className="wi-fit-head">
                            <span className="wi-label">Vestibilità al petto</span>
                            <strong className={`wi-fit-word v-${chestRow.verdict}`}>{FIT_WORD[chestRow.verdict]}</strong>
                          </div>
                          <FitScale verdict={chestRow.verdict} />
                          <p className="wi-fit-hint">{FIT_HINT[chestRow.verdict]}</p>
                          <ul className="wi-fit-list">
                            {lengthRow && lengthRow.text && <li><span>Lunghezza</span><span>{lengthRow.text.charAt(0).toUpperCase() + lengthRow.text.slice(1)}</span></li>}
                            {sleeveRow && sleeveRow.text && <li><span>Maniche</span><span>{sleeveRow.text.charAt(0).toUpperCase() + sleeveRow.text.slice(1)}</span></li>}
                            {hemRow && hemRow.verdict && <li><span>Fondo</span><span>{FIT_WORD[hemRow.verdict]}</span></li>}
                          </ul>
                          {chestRow.warn && <p className="wi-note is-warn"><IconAlert size={16} />Questa taglia ti sta stretta al petto: prova una taglia in più.</p>}
                        </>
                      )}
                    </div>
                  </div>
                )}

                {tab === "body" && (
                  <div className="wi-section" role="tabpanel">
                    <button type="button" className="wi-cta-card is-scan" onClick={() => setScanOpen(true)}>
                      <span className="wi-cta-icon"><IconCamera size={20} /></span>
                      <span><strong>Misurati con la fotocamera</strong>Ti guidiamo a voce: di fronte e poi di fianco, circa 30 secondi.</span>
                      <IconChevron size={18} />
                    </button>
                    {scanInfo && <p className="wi-note"><IconInfo size={16} />Misure stimate dalla scansione ({SCAN_CONF[scanInfo.confidence]}{scanInfo.sideView ? "" : ", solo vista di fronte"}). Puoi correggerle qui sotto.</p>}
                    <p className="wi-note"><IconLock size={16} />Le tue misure restano su questo dispositivo: il negozio non le riceve.</p>
                    {MEASURE_ORDER.map((f) => { const k = BODY_KEYS.find((x) => x.field === f); return <MeasureField key={f} k={k} value={body[f]} onChange={changeBody} />; })}
                    <div className="wi-row-actions">
                      <button type="button" className="wi-btn is-ghost" onClick={resetBody} disabled={isDefaultBody}>Ripristina</button>
                      <button type="button" className="wi-btn" onClick={() => setTab("fit")}>Vedi la vestibilità</button>
                    </div>
                  </div>
                )}

                {tab === "details" && (
                  <div className="wi-section" role="tabpanel">
                    {resolved && (
                      <>
                        <div className="wi-label-row"><span className="wi-label">Misure del capo · taglia {size.label}</span></div>
                        <table className="wi-table"><tbody>
                          {Object.entries(resolved.measures).map(([k, v]) => <tr key={k}><th scope="row">{KEY_LABEL[k]}</th><td>{fmt(v.value)} cm</td></tr>)}
                        </tbody></table>
                        <p className="wi-small">Misure del capo steso, in centimetri; «giro» è la circonferenza completa.</p>
                      </>
                    )}
                    {report.some((r) => r.easeCm !== undefined) && (
                      <>
                        <div className="wi-label-row"><span className="wi-label">Spazio tra capo e corpo</span></div>
                        <table className="wi-table"><tbody>
                          {report.filter((r) => r.easeCm !== undefined).map((r) => (
                            <tr key={r.id}><th scope="row">{r.label}</th><td>{r.easeCm >= 0 ? "+" : "−"}{fmt(Math.abs(r.easeCm))} cm{r.verdict && <span className={`wi-tag v-${r.verdict}`}>{FIT_WORD[r.verdict]}</span>}</td></tr>
                          ))}
                        </tbody></table>
                        <p className="wi-small">Quanti centimetri di tessuto avanzano rispetto al tuo corpo, sul giro completo.</p>
                      </>
                    )}

                    <details className="wi-advanced">
                      <summary><IconInfo size={16} />Informazioni tecniche</summary>
                      <div className="wi-advanced-body">
                        {rec && <p className="wi-small"><strong>Taglia consigliata {rec.label}:</strong> {rec.reason}.</p>}
                        {resolved && (
                          <table className="wi-table is-dense"><tbody>
                            {Object.entries(resolved.measures).map(([k, v]) => (
                              <tr key={k} title={v.note || ""}><th scope="row">{KEY_LABEL[k]}</th><td>{fmt(v.value)} cm <Badge origin={v.origin} /></td></tr>
                            ))}
                            {resolved.missing.filter((k) => SHOWN_WHEN_MISSING.includes(k)).map((k) => (
                              <tr key={k}><th scope="row">{KEY_LABEL[k]}</th><td>non fornita <Badge origin="template" /></td></tr>
                            ))}
                          </tbody></table>
                        )}
                        {report.length > 0 && (
                          <table className="wi-table is-dense"><tbody>
                            {report.map((r) => (
                              <tr key={r.id}>
                                <th scope="row">{r.label}<Badge origin={r.origin} /></th>
                                <td>
                                  {r.easeCm !== undefined ? <>{fmt(r.garmentCm)} vs {fmt(r.bodyCm)} cm · {r.easeCm >= 0 ? "+" : ""}{fmt(r.easeCm)} {r.verdict ? `(${r.verdict})` : ""}</> : <>{fmt(r.garmentCm)} cm{r.text ? ` · ${r.text}` : ""}</>}
                                  {r.note && <div className="wi-small">{r.note}</div>}
                                  {r.warn && <div className="wi-small is-warn">{r.warn}</div>}
                                </td>
                              </tr>
                            ))}
                          </tbody></table>
                        )}
                        {resolved && resolved.notes.map((n) => <p className="wi-small" key={n}>ℹ {n}</p>)}
                        {warnings.map((w) => <p className="wi-small is-warn" key={w}>⚠ {w}</p>)}
                        <p className="wi-small">Origine dei dati: «{ORIGIN_LABEL.prodotto}» = tabella del negozio; «{ORIGIN_LABEL.derivato}» = calcolata dai dati del negozio; «{ORIGIN_LABEL.template}» = valore predefinito del modello.
                          {spec?.asset ? ` Capo 3D: ${spec.asset.id}, taglia ${spec.asset.size}; i giri sono misurati sul modello 3D.` : " Capo generato dalle misure del negozio."}</p>
                      </div>
                    </details>
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="wi-panel-empty">
              <div className="wi-skeleton"><span /><span /><span /></div>
            </div>
          )}
        </section>}
      </main>

      {scanOpen && (
        <Suspense fallback={<div className="bs-boot"><div className="wi-loader"><span /><span /><span /></div></div>}>
          <BodyScan initialHeight={body.height} heightRange={[heightKey.min, heightKey.max]} ranges={scanRanges}
            onComplete={onScanDone} onCancel={() => setScanOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
