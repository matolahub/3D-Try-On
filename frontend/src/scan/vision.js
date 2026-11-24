// Live Body Scan – fotocamera e visione (solo browser).
// MediaPipe Pose Landmarker (modello "lite", servito dal widget stesso: public/models) in modalita' VIDEO:
// 33 landmark 2D + 3D e maschera di segmentazione della persona, tutto sul dispositivo (WebAssembly + WebGL).
// Nessun fotogramma lascia il browser e nessuno viene salvato.

import wasmLoaderPath from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinaryPath from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";
import { MASK_EDGE_BIAS_PX } from "./measure.js";

const MODEL_URL = `${import.meta.env.BASE_URL}models/pose_landmarker_lite.task`;
const ANALYSIS_LONG_SIDE = 640;        // risoluzione di analisi: la maschera ha questa dimensione (~0,35 cm/px su un telefono in verticale)

/** La fotocamera si puo' usare qui? (contesto sicuro + API presente) */
export function cameraSupport() {
  if (typeof window === "undefined") return { ok: false, reason: "unsupported" };
  if (!window.isSecureContext) return { ok: false, reason: "insecure" };
  if (!navigator.mediaDevices?.getUserMedia) return { ok: false, reason: "unsupported" };
  return { ok: true };
}

/** Avvia la fotocamera frontale. Lancia un errore con .code = "denied" | "notfound" | "busy" | "unsupported". */
export async function openCamera(video) {
  if (import.meta.env.DEV) {
    // solo sviluppo: ?scanSource=model sostituisce la fotocamera con il corpo 3D a misure note (vedi dev/modelCamera.js)
    // (dentro l'iframe del negozio demo l'URL non si controlla: vale anche localStorage["wearit.dev.scanBody"])
    const q = new URLSearchParams(window.location.search);
    let devBody = q.get("scanSource") === "model" ? q.get("scanBody") || "100,88,102,178" : null;
    try { devBody ??= window.localStorage.getItem("wearit.dev.scanBody"); } catch { /* storage bloccato */ }
    if (devBody) {
      const [chest, waist, hips, height] = devBody.split(",").map(Number);
      const { modelCameraStream } = await import("./dev/modelCamera.js");
      const stream = await modelCameraStream({ body: { chest, waist, hips, height } });
      video.srcObject = stream; video.muted = true; video.playsInline = true;
      await video.play();
      return stream;
    }
  }
  const sup = cameraSupport();
  if (!sup.ok) throw Object.assign(new Error(sup.reason), { code: sup.reason });
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30, max: 30 } },
    });
  } catch (e) {
    const code = e.name === "NotAllowedError" || e.name === "SecurityError" ? "denied" : e.name === "NotFoundError" || e.name === "OverconstrainedError" ? "notfound" : e.name === "NotReadableError" ? "busy" : "unsupported";
    throw Object.assign(new Error(e.message), { code });
  }
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  await video.play();
  if (!video.videoWidth) await new Promise((r) => video.addEventListener("loadedmetadata", r, { once: true }));
  return stream;
}

export function closeCamera(stream) {
  stream?.getTracks().forEach((t) => t.stop());
}

/** Crea il rilevatore. Prova la GPU (WebGL) e ripiega sulla CPU. */
export async function createDetector() {
  const { PoseLandmarker } = await import("@mediapipe/tasks-vision");
  const fileset = { wasmLoaderPath, wasmBinaryPath };
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: "VIDEO",
    numPoses: 2,                               // 2 per accorgersi se c'e' un'altra persona
    outputSegmentationMasks: true,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  let landmarker, delegate = "GPU";
  try {
    landmarker = await PoseLandmarker.createFromOptions(fileset, options("GPU"));
  } catch {
    delegate = "CPU";
    landmarker = await PoseLandmarker.createFromOptions(fileset, options("CPU"));
  }
  return { landmarker, delegate };
}

/**
 * Analizzatore di fotogrammi: ridimensiona il video, esegue la posa, legge la maschera e misura luce e nitidezza della maschera.
 * Ritorna una funzione frame(video, t) -> oggetto per ScanSession.push, piu' dispose().
 */
export function createFrameReader(landmarker) {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const small = document.createElement("canvas");
  small.width = 48; small.height = 64;
  const sctx = small.getContext("2d", { willReadFrequently: true });
  let lastLumaT = -1e9, luma = null, lastT = 0;

  function read(video, t) {
    const vw = video.videoWidth ?? video.width, vh = video.videoHeight ?? video.height;     // <video> oppure <canvas> (validatore)
    if (!vw || !vh) return null;
    const s = ANALYSIS_LONG_SIDE / Math.max(vw, vh);
    const w = Math.round(vw * Math.min(1, s)), h = Math.round(vh * Math.min(1, s));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    ctx.drawImage(video, 0, 0, w, h);

    // luminosita' media, 2-3 volte al secondo (costa poco su 48x64)
    if (t - lastLumaT > 400) {
      sctx.drawImage(canvas, 0, 0, small.width, small.height);
      const d = sctx.getImageData(0, 0, small.width, small.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      luma = sum / (d.length / 4);
      lastLumaT = t;
    }

    const ts = Math.max(t, lastT + 1);                  // timestamp strettamente crescenti (richiesto dalla modalita' VIDEO)
    lastT = ts;
    const res = landmarker.detectForVideo(canvas, ts);
    try {
      const poses = res.landmarks?.length ?? 0;
      if (!poses) return { t, w, h, poses: 0, luma };
      // la persona piu' grande e' quella da misurare
      let best = 0, bestH = -1;
      res.landmarks.forEach((lm, i) => {
        const ys = lm.map((p) => p.y), hh = Math.max(...ys) - Math.min(...ys);
        if (hh > bestH) { bestH = hh; best = i; }
      });
      const m = res.segmentationMasks?.[best];
      let mask = null, maskSoft = null;
      if (m) {
        mask = new Float32Array(m.getAsFloat32Array());          // copia: la memoria della maschera viene liberata con close()
        maskSoft = softness(mask, m.width, m.height, res.landmarks[best]);
      }
      return { t, w: m?.width ?? w, h: m?.height ?? h, poses, lm: res.landmarks[best], world: res.worldLandmarks?.[best] ?? null, mask, maskSoft, luma, canvas, edgeBiasPx: MASK_EDGE_BIAS_PX };
    } finally {
      res.close?.();
    }
  }
  return { read, canvas };
}

/** Quota di pixel "incerti" (ne' persona ne' sfondo) nel riquadro della persona: alta se la segmentazione e' confusa. */
function softness(mask, w, h, lm) {
  let x0 = 1, x1 = 0, y0 = 1, y1 = 0;
  for (const p of lm) { if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x; if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y; }
  const X0 = Math.max(0, Math.floor(x0 * w)), X1 = Math.min(w - 1, Math.ceil(x1 * w)), Y0 = Math.max(0, Math.floor(y0 * h)), Y1 = Math.min(h - 1, Math.ceil(y1 * h));
  let soft = 0, body = 0;
  for (let y = Y0; y <= Y1; y += 3) for (let x = X0; x <= X1; x += 3) {
    const v = mask[y * w + x];
    if (v > 0.5) body++;
    if (v > 0.15 && v < 0.85) soft++;
  }
  return body ? soft / body : 1;
}

/**
 * Inclinazione dell'asse della fotocamera frontale dai sensori, in gradi: > 0 = guarda in alto (telefono appoggiato e inclinato
 * indietro), < 0 = guarda in basso. E' l'elevazione dell'asse z del dispositivo, asin(cos(beta)·cos(gamma)): vale in verticale
 * e in orizzontale, ed e' indipendente da quanto il telefono e' ruotato nel proprio piano. Media esponenziale contro il rumore.
 * Ritorna stop().
 */
export function watchTilt(onPitch) {
  if (typeof window === "undefined" || !("DeviceOrientationEvent" in window)) return () => {};
  let ema = null;
  const h = (e) => {
    if (e.beta === null || e.gamma === null) return;
    const r = Math.PI / 180;
    const pitch = Math.asin(Math.max(-1, Math.min(1, Math.cos(e.beta * r) * Math.cos(e.gamma * r)))) / r;
    ema = ema === null ? pitch : ema * 0.8 + pitch * 0.2;
    onPitch(ema);
  };
  window.addEventListener("deviceorientation", h);
  return () => window.removeEventListener("deviceorientation", h);
}

/** Su iOS l'accesso ai sensori va chiesto dentro un gesto dell'utente. */
export async function requestTiltPermission() {
  try {
    const D = window.DeviceOrientationEvent;
    if (D && typeof D.requestPermission === "function") return (await D.requestPermission()) === "granted";
  } catch { /* negato o non disponibile: si va avanti senza */ }
  return true;
}
