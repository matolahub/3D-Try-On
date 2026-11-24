// Live Body Scan – schermata guidata (React). Copre il widget a tutto schermo; si carica solo quando l'utente la apre.
// Flusso: intro (altezza, consigli, privacy) -> avvio fotocamera e modello -> scansione dal vivo -> risultato -> misure al modello 3D.

import { useCallback, useEffect, useRef, useState } from "react";
import "./scan.css";
import { ScanSession } from "./session.js";
import { CUES } from "./quality.js";
import { closeCamera, createDetector, createFrameReader, openCamera, requestTiltPermission, watchTilt } from "./vision.js";
import { createVoice } from "./voice.js";

const STEPS = [
  { id: "framing", label: "Inquadratura" },
  { id: "pose", label: "Posizione" },
  { id: "front", label: "Fronte" },
  { id: "side", label: "Fianco" },
];
const stepIndex = (phase) => ({ framing: 0, pose: 1, front: 2, turn: 3, side: 3, done: 4 }[phase] ?? 0);
const ERRORS = {
  denied: { title: "Fotocamera non autorizzata", text: "Per la scansione serve l'accesso alla fotocamera. Puoi consentirlo dalle impostazioni del browser, oppure inserire le misure a mano." },
  notfound: { title: "Nessuna fotocamera trovata", text: "Questo dispositivo non ha una fotocamera utilizzabile. Puoi inserire le misure a mano." },
  busy: { title: "Fotocamera occupata", text: "Un'altra app sta usando la fotocamera. Chiudila e riprova." },
  insecure: { title: "Connessione non sicura", text: "Il browser consente la fotocamera solo su pagine HTTPS." },
  unsupported: { title: "Browser non supportato", text: "Questo browser non permette la scansione. Prova con una versione recente di Chrome o Safari, oppure inserisci le misure a mano." },
  model: { title: "Non riesco ad avviare il riconoscimento", text: "Il modello di riconoscimento del corpo non si è caricato. Controlla la connessione e riprova." },
};
const FIELD_LABEL = { height: "Altezza", chest: "Petto", waist: "Vita", hips: "Fianchi", shoulders: "Spalle" };
const CONF_LABEL = { alta: "Affidabilità alta", media: "Affidabilità media", bassa: "Affidabilità bassa", dichiarata: "Inserita da te" };
// Colore dello stato = quello che dice la voce: verde se la posizione va bene, arancione se c'e' da correggere, azzurro mentre ci
// si gira. Lo stesso colore tinge la persona nel video, il bordo dello schermo e il riquadro dell'istruzione.
const OK_CUES = new Set(["hold_front", "hold_side", "front_done", "done"]);
const toneOf = (cue) => (!cue ? "warn" : OK_CUES.has(cue) ? "ok" : cue === "turn" ? "turn" : "warn");
const TINT = { ok: [63, 191, 119], warn: [240, 163, 58], turn: [86, 166, 240] };

function StatusIcon({ tone }) {
  return (
    <span className={`bs-status is-${tone}`} aria-hidden="true">
      <svg viewBox="0 0 24 24">
        {tone === "ok" && <path d="m5 12.5 4.5 4.5L19 7.5" />}
        {tone === "warn" && <><path d="M12 6.5v7" /><path d="M12 17.5v.01" /></>}
        {tone === "turn" && <><path d="M19 12a7 7 0 1 1-2.05-4.95" /><path d="M19 4.5v4h-4" /></>}
      </svg>
    </span>
  );
}

const round = (v) => Math.round(v);

export default function BodyScan({ initialHeight = 175, heightRange = [140, 210], ranges = {}, onComplete, onCancel }) {
  const [step, setStep] = useState("intro");               // intro | starting | live | result | error
  const [height, setHeight] = useState(String(Math.round(initialHeight)));
  const [voiceOn, setVoiceOn] = useState(true);
  const [loadingText, setLoadingText] = useState("");
  const [errorCode, setErrorCode] = useState(null);
  const [snap, setSnap] = useState(null);
  const [result, setResult] = useState(null);
  const [perf, setPerf] = useState(null);

  const videoRef = useRef(null), overlayRef = useRef(null);
  const live = useRef({});                                  // stream, detector, reader, session, raf, voice, tilt, stopped
  const heightNum = Number(height);
  const heightOk = Number.isFinite(heightNum) && heightNum >= heightRange[0] && heightNum <= heightRange[1];

  const stop = useCallback(() => {
    const L = live.current;
    L.stopped = true;
    if (L.raf) cancelAnimationFrame(L.raf);
    L.stopTilt?.();
    closeCamera(L.stream);
    L.stream = null;
    try { L.detector?.landmarker.close(); } catch { /* gia' chiuso */ }
    L.detector = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  useEffect(() => {
    const L = live.current;
    L.voice = createVoice();
    return () => { stop(); L.voice?.dispose(); };
  }, [stop]);

  useEffect(() => { live.current.voice?.setEnabled(voiceOn); }, [voiceOn]);

  const draw = (f, s) => {
    const cv = overlayRef.current;
    if (!cv || !f) return;
    if (cv.width !== f.w || cv.height !== f.h) { cv.width = f.w; cv.height = f.h; }
    const g = cv.getContext("2d");
    g.clearRect(0, 0, f.w, f.h);
    if (!f.poses || !f.mask) return;
    // la persona si colora con lo stato: il segnale si legge anche da 2 metri
    const L = live.current, [r, gr, b] = TINT[toneOf(s.cue)];
    if (!L.tintImg || L.tintImg.width !== f.w || L.tintImg.height !== f.h) L.tintImg = g.createImageData(f.w, f.h);
    const d = L.tintImg.data, m = f.mask;
    for (let i = 0, j = 0; i < m.length; i++, j += 4) {
      if (m[i] > 0.5) { d[j] = r; d[j + 1] = gr; d[j + 2] = b; d[j + 3] = 115; } else d[j + 3] = 0;
    }
    g.putImageData(L.tintImg, 0, 0);
    // solo sviluppo: righe di misura (petto, vita, fianchi)
    const lw = Math.max(2, f.h / 260);
    if (import.meta.env.DEV && s.sil?.ok && (s.phase === "front" || s.phase === "side")) {
      g.strokeStyle = s.accepted ? "#7ee2a8" : "rgba(255,255,255,.7)"; g.lineWidth = lw * 1.3;
      for (const row of Object.values(s.sil.rows || {})) {
        g.beginPath(); g.moveTo(row.l, row.y); g.lineTo(row.r, row.y); g.stroke();
        for (const x of [row.l, row.r]) { g.beginPath(); g.moveTo(x, row.y - lw * 3); g.lineTo(x, row.y + lw * 3); g.stroke(); }
      }
    }
  };

  const loop = useCallback(() => {
    const L = live.current;
    let lastRun = 0, interval = 90, avg = 60, lastPhase = null, lastCue = null, frames = 0, t0 = performance.now();
    const tick = () => {
      if (L.stopped) return;
      const now = performance.now(), video = videoRef.current;
      if (video && video.readyState >= 2 && now - lastRun >= interval) {
        lastRun = now;
        const a = performance.now();
        let f = null;
        try { f = L.reader.read(video, now); } catch (e) { console.error("[wearIT scan]", e); }
        const took = performance.now() - a;
        avg = avg * 0.85 + took * 0.15;
        interval = Math.max(80, Math.min(220, avg * 1.4));            // dispositivi lenti: meno analisi al secondo, nessun blocco
        frames++;
        if (now - t0 > 2000) { setPerf({ fps: (frames * 1000) / (now - t0), ms: avg, delegate: L.detector?.delegate }); frames = 0; t0 = now; }
        if (f) {
          f.pitchDeg = L.pitch;                          // inclinazione dai sensori: corretta nella misura (null = non disponibile)
          const s = L.session.push(f);
          if (import.meta.env.DEV) { window.__scanPhase = s.phase; window.__scanSnap = s; window.__scanFrame = f; (window.__scanFrames ||= {})[s.phase] = f; }
          // Cio' che si vede (colore, frase) cambia solo se il nuovo stato si conferma per 2 analisi di fila: niente lampeggi
          // quando un controllo e' al limite. La voce ha gia' il suo filtro (voice.js).
          if (s.cue === L.candCue) L.candN++; else { L.candCue = s.cue; L.candN = 1; }
          if (L.candN >= 2 || L.shownCue === undefined) L.shownCue = s.cue;
          const shown = { ...s, cue: L.shownCue };
          draw(f, shown);
          const v = L.voice;
          if (s.phase !== lastPhase) {
            if (lastPhase && s.phase !== "framing" && stepIndex(s.phase) > stepIndex(lastPhase)) v.beepStep();
            lastPhase = s.phase;
          }
          if (s.phase === "done") {
            v.beepDone(); v.update(CUES.done, { urgent: true });
            setResult(s.result); setSnap(s); stop(); setStep("result");
            return;
          }
          const urgent = s.cue === "front_done" || s.cue === "turn_slow";
          if (s.cue) v.update(CUES[s.cue], { urgent: urgent && s.cue !== lastCue });
          lastCue = s.cue;
          setSnap(shown);
        }
      }
      L.raf = requestAnimationFrame(tick);
    };
    L.raf = requestAnimationFrame(tick);
  }, [stop]);

  const start = async (heightOverride) => {
    const L = live.current;
    const hCm = Number.isFinite(heightOverride) ? heightOverride : heightNum;
    if (hCm !== heightNum) setHeight(String(hCm));
    L.voice.unlock();
    L.voice.setEnabled(voiceOn);
    requestTiltPermission();
    L.stopped = false;
    setErrorCode(null); setSnap(null); setResult(null);
    setStep("starting");
    try {
      setLoadingText("Apro la fotocamera…");
      L.stream = await openCamera(videoRef.current);
      L.videoDims = [videoRef.current.videoWidth, videoRef.current.videoHeight];      // a fine scansione il video e' gia' chiuso
      setLoadingText("Preparo il riconoscimento del corpo…");
      try { L.detector = await createDetector(); } catch (e) { throw Object.assign(e, { code: "model" }); }
      if (L.stopped) return;
      L.reader = createFrameReader(L.detector.landmarker);
      L.session = new ScanSession({ heightCm: hCm });
      L.pitch = null;
      L.shownCue = undefined; L.candCue = null; L.candN = 0;
      L.stopTilt = watchTilt((p) => { L.pitch = p; });
      setStep("live");
      L.voice.say("Appoggia il telefono in verticale e allontanati di circa due metri.");
      loop();
    } catch (e) {
      stop();
      setErrorCode(e.code || "unsupported");
      setStep("error");
    }
  };

  const cancel = () => { stop(); onCancel?.(); };
  const skipSide = () => {
    const L = live.current;
    const r = L.session?.skipSide();
    if (r) { L.voice.beepDone(); setResult(r); stop(); setStep("result"); }
  };
  const restart = () => { stop(); setStep("intro"); };

  // solo sviluppo: ?scanAuto avvia da sola la scansione (prove ripetibili con la fotocamera sintetica, altezza da scanBody)
  const autoRef = useRef(false);
  useEffect(() => {
    if (!import.meta.env.DEV || autoRef.current) return;
    const q = new URLSearchParams(window.location.search);
    if (!q.has("scanAuto")) return;
    autoRef.current = true;
    const h = Number((q.get("scanBody") || "").split(",")[3]) || heightNum;
    live.current.voice.setEnabled(false);
    start(h);
  });

  const apply = () => {
    const m = result.measures;
    onComplete?.({
      body: { height: heightNum, chest: round(m.chest.value), waist: round(m.waist.value), hips: round(m.hips.value) },
      scan: {
        at: Date.now(), confidence: result.overall.confidence, sideView: result.overall.sideView,
        fields: Object.fromEntries(["chest", "waist", "hips"].map((k) => [k, { uncertainty: Math.round(m[k].uncertainty), confidence: m[k].confidence, method: m[k].method }])),
      },
    });
  };

  // ── stato visivo della scansione ─────────────────────────────────────────
  const phase = snap?.phase ?? "framing";
  const cue = snap?.cue ? CUES[snap.cue] : "Mettiti davanti alla fotocamera, a circa due metri.";
  const tone = toneOf(snap?.cue);
  const si = Math.min(STEPS.length - 1, stepIndex(phase));

  return (
    <div className="bs" role="dialog" aria-modal="true" aria-label="Scansione del corpo">
      {/* il video esiste sempre: la fotocamera ci si aggancia prima che la schermata dal vivo sia visibile */}
      <div className={`bs-live${step === "live" ? " on" : ""} t-${tone}`}>
        <div className="bs-frame">
          <video ref={videoRef} className="bs-video" playsInline muted />
          <canvas ref={overlayRef} className="bs-overlay" />
        </div>

        {step === "live" && (
          <>
            <div className="bs-top">
              <p className="bs-phase">Passo {si + 1} di {STEPS.length} · {STEPS[si].label}</p>
              <div className="bs-top-actions">
                <button type="button" className="bs-icon" aria-pressed={voiceOn} aria-label={voiceOn ? "Disattiva la guida vocale" : "Attiva la guida vocale"} onClick={() => setVoiceOn((v) => !v)}>
                  {voiceOn ? <svg viewBox="0 0 20 20"><path d="M3 8v4h3l4 3.5v-11L6 8H3Z" /><path d="M13.5 7a4 4 0 0 1 0 6M15.5 5a7 7 0 0 1 0 10" /></svg>
                    : <svg viewBox="0 0 20 20"><path d="M3 8v4h3l4 3.5v-11L6 8H3Z" /><path d="m13.5 8 4 4m0-4-4 4" /></svg>}
                </button>
                <button type="button" className="bs-icon" aria-label="Chiudi la scansione" onClick={cancel}><svg viewBox="0 0 20 20"><path d="m5 5 10 10M15 5 5 15" /></svg></button>
              </div>
            </div>

            <div className="bs-bottom">
              <div className={`bs-cue t-${tone}`} aria-live="assertive">
                <StatusIcon tone={tone} />
                <p>{cue}</p>
              </div>
              <div className="bs-bar" aria-hidden="true"><span style={{ width: `${Math.round((snap?.overall ?? 0) * 100)}%` }} /></div>
              {snap?.canSkipSide && <button type="button" className="bs-link" onClick={skipSide}>Salta la vista di fianco (misure meno precise)</button>}
              {import.meta.env.DEV && perf && (
                <p className="bs-perf">
                  {perf.fps.toFixed(1)} analisi/s · {perf.ms.toFixed(0)} ms · {perf.delegate}
                  {snap?.metrics?.arms && ` · braccia ${snap.metrics.arms.map((a) => a.toFixed(0)).join("°/")}°`}
                  {Number.isFinite(snap?.metrics?.angle) && ` · rotazione ${snap.metrics.angle.toFixed(0)}° (serve ≥65°)`}
                  {` · telefono ${Number.isFinite(live.current.pitch) ? `${live.current.pitch.toFixed(0)}°` : "n.d."}`}
                  {snap?.sil?.merged && ` · unito: ${Object.entries(snap.sil.merged).filter(([, v]) => v).map(([k]) => k).join(",") || "no"}`}
                  {snap?.issues?.length ? ` · ${snap.issues.join(",")}` : ""}
                  {snap?.metrics?.score !== undefined && ` · q ${snap.metrics.score.toFixed(2)} mov ${(snap.metrics.motion ?? 0).toFixed(3)}${snap.accepted ? " ✓" : ""}`}
                </p>
              )}
            </div>
          </>
        )}
      </div>

      {step === "intro" && (
        <div className="bs-sheet">
          <button type="button" className="bs-close" aria-label="Chiudi" onClick={cancel}><svg viewBox="0 0 20 20"><path d="m5 5 10 10M15 5 5 15" /></svg></button>
          <p className="bs-kicker">Scansione del corpo</p>
          <h2 className="bs-title">Misure con la fotocamera, in circa 30 secondi</h2>
          <ol className="bs-tips">
            <li><b>1</b><span><strong>Appoggia il telefono in verticale</strong>, all'altezza dei fianchi, con la fotocamera verso di te.</span></li>
            <li><b>2</b><span><strong>Allontanati di circa 2 metri</strong>, davanti a una parete libera e ben illuminata.</span></li>
            <li><b>3</b><span><strong>Indossa abiti aderenti</strong>: quelli larghi aumentano le misure.</span></li>
            <li><b>4</b><span><strong>Segui la voce</strong>: prima di fronte, poi di fianco.</span></li>
          </ol>
          <label className="bs-height">
            <span>La tua altezza<small>Senza scarpe: serve a convertire l'immagine in centimetri</small></span>
            <span className="bs-height-input">
              <input inputMode="numeric" aria-label="Altezza in centimetri" value={height} aria-invalid={!heightOk} onChange={(e) => setHeight(e.target.value.replace(/[^0-9]/g, "").slice(0, 3))} />cm
            </span>
          </label>
          {!heightOk && <p className="bs-error-text">Inserisci un'altezza tra {heightRange[0]} e {heightRange[1]} cm.</p>}
          <label className="bs-toggle"><input type="checkbox" checked={voiceOn} onChange={(e) => setVoiceOn(e.target.checked)} />Guida vocale</label>
          <p className="bs-privacy"><svg viewBox="0 0 20 20"><rect x="4.5" y="9" width="11" height="8" rx="1.8" /><path d="M7 9V6.8a3 3 0 0 1 6 0V9" /></svg>Il video viene elaborato solo su questo dispositivo: non viene salvato né inviato. Restano soltanto le misure.</p>
          <button type="button" className="wi-btn bs-primary" disabled={!heightOk} onClick={() => start()}>Avvia la fotocamera</button>
        </div>
      )}

      {step === "starting" && (
        <div className="bs-sheet is-center">
          <div className="wi-loader"><span /><span /><span /></div>
          <p className="bs-title is-small">{loadingText}</p>
          <p className="bs-muted">La prima volta può richiedere qualche secondo.</p>
          <button type="button" className="wi-btn is-ghost" onClick={cancel}>Annulla</button>
        </div>
      )}

      {step === "error" && (
        <div className="bs-sheet is-center">
          <p className="bs-title is-small">{(ERRORS[errorCode] || ERRORS.unsupported).title}</p>
          <p className="bs-muted">{(ERRORS[errorCode] || ERRORS.unsupported).text}</p>
          <div className="bs-actions">
            <button type="button" className="wi-btn is-ghost" onClick={cancel}>Inserisci a mano</button>
            {errorCode !== "notfound" && errorCode !== "insecure" && <button type="button" className="wi-btn" onClick={() => start()}>Riprova</button>}
          </div>
        </div>
      )}

      {step === "result" && result && (
        <ScanResult result={result} height={heightNum} ranges={ranges} onApply={apply} onRetry={restart} onCancel={cancel}
          diag={{ perf, video: live.current.videoDims ?? null }} />
      )}
    </div>
  );
}

function ScanResult({ result, height, ranges, onApply, onRetry, onCancel, diag }) {
  const m = result.measures;
  const complete = result.overall.complete;
  const low = result.overall.confidence === "bassa";
  const outOfRange = ["chest", "waist", "hips"].filter((k) => m[k] && ranges[k] && (m[k].value < ranges[k][0] || m[k].value > ranges[k][1]));
  return (
    <div className="bs-sheet">
      <p className="bs-kicker">Scansione completata</p>
      <h2 className="bs-title">{complete ? "Ecco le tue misure stimate" : "Scansione incompleta"}</h2>
      <p className="bs-muted">{result.overall.sideView ? "Calcolate dalla vista di fronte e di fianco." : "Calcolate solo dalla vista di fronte: la profondità del corpo è stimata, quindi i giri sono meno precisi."}</p>
      <ul className="bs-results">
        <li><span>{FIELD_LABEL.height}</span><strong>{height} cm</strong><em className="c-dichiarata">{CONF_LABEL.dichiarata}</em></li>
        {["chest", "waist", "hips"].map((k) => (
          <li key={k}>
            <span>{FIELD_LABEL[k]}<small>giro</small></span>
            {m[k] ? <><strong>≈ {round(m[k].value)} cm<small>tra {round(m[k].low)} e {round(m[k].high)}</small></strong><em className={`c-${m[k].confidence}`}>{CONF_LABEL[m[k].confidence]}{m[k].depthRejected ? " · vista di fianco non usabile, stimata di fronte" : ""}</em></>
              : <><strong>–</strong><em className="c-bassa">Non misurata</em></>}
          </li>
        ))}
        {m.shoulders && <li className="is-info"><span>{FIELD_LABEL.shoulders}<small>indicativa</small></span><strong>≈ {round(m.shoulders.value)} cm</strong><em className="c-bassa">Solo informativa</em></li>}
      </ul>
      {low && complete && <p className="wi-note is-warn">L'affidabilità è bassa: per un risultato migliore ripeti con più luce, abiti aderenti e completando la vista di fianco.</p>}
      {outOfRange.length > 0 && <p className="wi-note is-warn">{outOfRange.map((k) => FIELD_LABEL[k]).join(", ")}: valore fuori dall'intervallo del modello 3D, verrà rappresentato al limite.</p>}
      <p className="bs-small">Sono stime ottenute dall'immagine, non misure con il metro. Potrai sempre correggerle a mano.</p>
      {import.meta.env.DEV && <CalibrationPanel result={result} height={height} diag={diag} />}
      <div className="bs-actions">
        <button type="button" className="wi-btn is-ghost" onClick={onRetry}>Ripeti</button>
        {complete ? <button type="button" className="wi-btn" onClick={onApply}>Usa queste misure</button> : <button type="button" className="wi-btn" onClick={onCancel}>Chiudi</button>}
      </div>
    </div>
  );
}

/**
 * SOLO SVILUPPO: raccolta dati per la calibrazione sul campo. Si inseriscono le misure prese con il metro; il pannello calcola
 * l'errore e prepara un JSON di soli numeri (nessuna immagine) da copiare. Le prove si accumulano in localStorage
 * ("wearit.dev.calibration") per poterle copiare tutte insieme.
 */
const CALIB_KEY = "wearit.dev.calibration";
function CalibrationPanel({ result, height, diag }) {
  const [tape, setTape] = useState({ chest: "", waist: "", hips: "" });
  const [note, setNote] = useState("");
  const [status, setStatus] = useState("");
  const [text, setText] = useState("");
  const m = result.measures;
  const tapeNum = Object.fromEntries(Object.entries(tape).map(([k, v]) => [k, Number(v.replace(",", ".")) || null]));
  const record = () => ({
    at: new Date().toISOString(),
    note,
    device: { ua: navigator.userAgent.slice(0, 120), video: diag?.video, fps: diag?.perf && +diag.perf.fps.toFixed(1), ms: diag?.perf && Math.round(diag.perf.ms), delegate: diag?.perf?.delegate },
    height,
    tape: tapeNum,
    scan: Object.fromEntries(["chest", "waist", "hips"].map((k) => [k, m[k] && {
      value: +m[k].value.toFixed(1), unc: +m[k].uncertainty.toFixed(1), method: m[k].method, widthCm: +m[k].widthCm.toFixed(1),
      depthCm: m[k].depthCm && +m[k].depthCm.toFixed(1), depthRejected: m[k].depthRejected,
      err: tapeNum[k] && +(m[k].value - tapeNum[k]).toFixed(1),
    }])),
    shoulders: m.shoulders && +m.shoulders.value.toFixed(1),
    stats: result.stats && { frames: result.stats.frames, front: result.stats.frontFrames, side: result.stats.sideFrames, rejected: result.stats.rejected },
    raw: result.raw,
  });
  const copy = async (payload) => {
    const json = JSON.stringify(payload);
    setText(json);
    try { await navigator.clipboard.writeText(json); setStatus("Copiato negli appunti."); } catch { setStatus("Copia automatica non disponibile: seleziona il testo qui sotto."); }
  };
  const save = async () => {
    let all = [];
    try { all = JSON.parse(localStorage.getItem(CALIB_KEY) || "[]"); } catch { /* storage non disponibile */ }
    all.push(record());
    try { localStorage.setItem(CALIB_KEY, JSON.stringify(all)); } catch { /* idem: si copia comunque */ }
    await copy(all);
    setStatus((s) => `Prova salvata (${all.length} in totale). ${s}`);
  };
  return (
    <details className="bs-calib" open>
      <summary>Calibrazione (sviluppo)</summary>
      <p className="bs-small">Misure con il metro, abiti come durante la scansione:</p>
      <div className="bs-calib-row">
        {["chest", "waist", "hips"].map((k) => (
          <label key={k}>{FIELD_LABEL[k]}
            <input inputMode="decimal" value={tape[k]} placeholder="cm" onChange={(e) => setTape((t) => ({ ...t, [k]: e.target.value.replace(/[^0-9.,]/g, "").slice(0, 5) }))} />
            {tapeNum[k] && m[k] && <small>{m[k].value - tapeNum[k] >= 0 ? "+" : ""}{(m[k].value - tapeNum[k]).toFixed(1)} cm</small>}
          </label>
        ))}
      </div>
      <input className="bs-calib-note" value={note} placeholder="Note (abiti, luce, telefono…)" onChange={(e) => setNote(e.target.value.slice(0, 120))} />
      <div className="bs-actions">
        <button type="button" className="wi-btn is-ghost" onClick={() => copy(record())}>Copia questa prova</button>
        <button type="button" className="wi-btn" onClick={save}>Salva e copia tutte</button>
      </div>
      {status && <p className="bs-small">{status}</p>}
      {text && <textarea className="bs-calib-out" readOnly value={text} onFocus={(e) => e.target.select()} />}
    </details>
  );
}
