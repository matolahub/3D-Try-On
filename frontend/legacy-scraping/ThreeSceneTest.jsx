import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import GarmentPanel from "./tryon/GarmentPanel";
import { GarmentSystem } from "./tryon/garmentMesh";
import { buildFitReport } from "./tryon/garmentFit";

// ─── Styles ───────────────────────────────────────────────────────────────────

const css = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:      #0f0f0f;
    --surface: #1a1a1a;
    --border:  rgba(255,255,255,.08);
    --text:    #e8e8e8;
    --muted:   #666;
    --accent:  #ffffff;
    --input-bg: #111111;
  }

  html, body, #root { height: 100%; }

  .vto {
    font-family: 'Inter', sans-serif;
    background: var(--bg);
    color: var(--text);
    height: 100vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* ── Header ── */
  .vto-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 24px;
    height: 52px;
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }
  .vto-logo { font-size: 13px; font-weight: 500; letter-spacing: .04em; color: var(--text); }
  .vto-logo span { color: var(--muted); font-weight: 300; }
  .vto-status { display: flex; align-items: center; gap: 7px; font-size: 11px; color: var(--muted); letter-spacing: .03em; }
  .vto-dot { width: 5px; height: 5px; border-radius: 50%; background: #4ade80; }

  /* ── Main area ── */
  .vto-body { flex: 1; display: flex; overflow: hidden; }

  /* ── Canvas ── */
  .vto-canvas { flex: 1; position: relative; background: #0a0a0a; }
  .vto-canvas canvas { display: block; width: 100% !important; height: 100% !important; }

  /* Loading */
  .vto-loading {
    position: absolute; inset: 0;
    display: flex; align-items: center; justify-content: center;
    flex-direction: column; gap: 14px;
    background: #0a0a0a; z-index: 10; transition: opacity .5s;
  }
  .vto-loading.done { opacity: 0; pointer-events: none; }
  .vto-spinner {
    width: 28px; height: 28px;
    border: 1.5px solid rgba(255,255,255,.1);
    border-top-color: rgba(255,255,255,.6);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  .vto-loading-label { font-size: 11px; color: var(--muted); letter-spacing: .06em; text-transform: uppercase; }

  /* ── Sidebar ── */
  .vto-sidebar {
    width: 320px;
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    flex-shrink: 0;
    background: var(--surface);
  }

  .vto-sidebar-section {
    padding: 18px 16px 14px;
    border-bottom: 1px solid var(--border);
  }
  .vto-sidebar-section:last-child { border-bottom: none; }

  .vto-section-title {
    font-size: 9px; font-weight: 500; letter-spacing: .1em;
    text-transform: uppercase; color: var(--muted); margin-bottom: 12px;
  }

  /* View buttons */
  .vto-views { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .vto-view-btn {
    background: #111;
    border: 1px solid var(--border);
    color: var(--muted);
    font-family: 'Inter', sans-serif;
    font-size: 11px; padding: 8px 6px; cursor: pointer;
    border-radius: 6px; transition: all .15s; text-align: center;
  }
  .vto-view-btn:hover { border-color: rgba(255,255,255,.2); color: var(--text); }
  .vto-view-btn.active {
    background: var(--accent); border-color: var(--accent);
    color: #000; font-weight: 500;
  }

  /* Auto-rotate toggle */
  .vto-auto {
    display: flex; align-items: center; justify-content: space-between;
    font-size: 12px; color: var(--muted); cursor: pointer; user-select: none;
  }
  .vto-auto:hover { color: var(--text); }
  .vto-toggle {
    width: 32px; height: 17px; background: #111;
    border: 1px solid var(--border); border-radius: 99px;
    position: relative; transition: all .2s; flex-shrink: 0;
  }
  .vto-toggle.on { background: var(--accent); border-color: var(--accent); }
  .vto-toggle::after {
    content: ''; position: absolute; width: 11px; height: 11px;
    background: var(--muted); border-radius: 50%;
    top: 2px; left: 2px; transition: all .2s;
  }
  .vto-toggle.on::after { transform: translateX(15px); background: #000; }

  /* ── Measure rows ── */
  .vto-measure { margin-bottom: 16px; }
  .vto-measure:last-child { margin-bottom: 0; }

  .vto-measure-header {
    display: flex; align-items: baseline;
    justify-content: space-between; margin-bottom: 6px;
  }
  .vto-measure-name { font-size: 12px; color: var(--text); }
  .vto-measure-input-wrap { display: flex; align-items: center; gap: 4px; }
  .vto-measure-input {
    width: 48px; font-size: 11px; font-family: 'Inter', sans-serif;
    background: var(--input-bg); color: var(--text);
    border: 1px solid var(--border); border-radius: 5px;
    padding: 3px 7px; text-align: right;
    -moz-appearance: textfield;
  }
  .vto-measure-input::-webkit-outer-spin-button,
  .vto-measure-input::-webkit-inner-spin-button { -webkit-appearance: none; }
  .vto-measure-input:focus { outline: none; border-color: rgba(255,255,255,.25); }
  .vto-measure-unit { font-size: 10px; color: var(--muted); }

  /* Custom range track */
  .vto-measure-range {
    -webkit-appearance: none; appearance: none;
    width: 100%; height: 2px; background: rgba(255,255,255,.1);
    border-radius: 99px; outline: none; cursor: pointer;
  }
  .vto-measure-range::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 13px; height: 13px; border-radius: 50%;
    background: var(--accent); border: 2px solid var(--bg);
    cursor: pointer; transition: transform .1s;
  }
  .vto-measure-range::-webkit-slider-thumb:hover { transform: scale(1.2); }
  .vto-measure-range::-moz-range-thumb {
    width: 13px; height: 13px; border-radius: 50%;
    background: var(--accent); border: 2px solid var(--bg);
    cursor: pointer;
  }

  .vto-range-labels {
    display: flex; justify-content: space-between;
    font-size: 9px; color: var(--muted); margin-top: 3px;
  }

  .vto-info { font-size: 11px; color: var(--muted); line-height: 2; }
  .vto-info strong { color: var(--text); font-weight: 400; }

  /* ── Footer / Rotation slider ── */
  .vto-footer {
    height: 60px; border-top: 1px solid var(--border);
    display: flex; align-items: center; padding: 0 24px; gap: 16px; flex-shrink: 0;
  }
  .vto-angle { font-size: 12px; font-weight: 500; color: var(--text); min-width: 40px; font-variant-numeric: tabular-nums; }
  .vto-slider-wrap { flex: 1; position: relative; height: 20px; display: flex; align-items: center; }
  .vto-track { position: absolute; left: 0; right: 0; height: 1px; background: rgba(255,255,255,.12); }
  .vto-fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--accent); }
  .vto-thumb {
    position: absolute; top: 50%; transform: translate(-50%, -50%);
    width: 12px; height: 12px; background: var(--accent); border-radius: 50%;
    pointer-events: none; border: 2px solid var(--bg);
  }
  .vto-range {
    position: absolute; inset: 0; opacity: 0; cursor: pointer; width: 100%;
  }
  .vto-hint { font-size: 11px; color: var(--muted); white-space: nowrap; }
`;

// ─── Shape Key Configuration ──────────────────────────────────────────────────
//
// Le misure sono in centimetri reali. La calibrazione (misura di partenza del corpo, range e curva
// cm → influence) NON è scritta a mano: viene misurata sulla mesh da blender/scripts/build_shape_keys.py
// e salvata in bodyCalibration.json. Per verificarla: blender/scripts/measure_body.py.
//
//   Chest   → circonferenza petto   (a nastro, a 0.75 dell'altezza)
//   Waist   → circonferenza vita    (a 0.635 dell'altezza)
//   Hips    → circonferenza fianchi (a 0.52 dell'altezza)
//   Altezza → statura
//
// I morph target valgono in entrambi i versi: influence negativa restringe / accorcia.
//
import calibration from "./bodyCalibration.json";

const SHAPE_KEYS = [
  { morphName: "Chest",   label: "Petto"   },
  { morphName: "Waist",   label: "Vita"    },
  { morphName: "Hips",    label: "Fianchi" },
  { morphName: "Altezza", label: "Altezza" },
].map((sk) => {
  const c = calibration[sk.morphName];
  return {
    ...sk,
    unit:    "cm",
    step:    1,
    min:     c.min,
    max:     c.max,
    neutral: c.neutral,                 // misura reale del corpo base (influence = 0)
    curve:   c.curve,                   // [[cm, influence], ...] misurata sulla mesh
    initial: Math.round(c.neutral),     // valore mostrato all'avvio
  };
});

// Converte una misura reale in cm nell'influence del morph target (interpolazione sulla curva misurata)
function cmToMorphInfluence(sk, cm) {
  const pts = sk.curve;
  const x = Math.max(sk.min, Math.min(sk.max, cm));
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return pts[pts.length - 1][1];
}

// ─── Placeholder body (visualizzato mentre il GLB non è ancora caricato) ─────
function buildPlaceholder() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6 });
  const g = new THREE.Group();
  const add = (geo, px = 0, py = 0, pz = 0, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px, py, pz);
    m.rotation.set(rx, 0, rz);
    m.castShadow = true;
    g.add(m);
  };
  add(new THREE.SphereGeometry(0.135, 32, 32), 0, 1.48);
  add(new THREE.CylinderGeometry(0.055, 0.065, 0.12, 20), 0, 1.3);
  add(new THREE.CylinderGeometry(0.19, 0.165, 0.65, 32), 0, 0.93);
  add(new THREE.CylinderGeometry(0.18, 0.16, 0.28, 32), 0, 0.56);
  add(new THREE.CylinderGeometry(0.072, 0.058, 0.58, 24), -0.1, 0.25, 0, 0, 0.04);
  add(new THREE.CylinderGeometry(0.072, 0.058, 0.58, 24),  0.1, 0.25, 0, 0, -0.04);
  add(new THREE.CylinderGeometry(0.055, 0.042, 0.52, 24), -0.1, -0.29);
  add(new THREE.CylinderGeometry(0.055, 0.042, 0.52, 24),  0.1, -0.29);
  add(new THREE.CylinderGeometry(0.052, 0.042, 0.52, 24), -0.28, 0.92, 0, 0, 0.16);
  add(new THREE.CylinderGeometry(0.052, 0.042, 0.52, 24),  0.28, 0.92, 0, 0, -0.16);
  add(new THREE.CylinderGeometry(0.04, 0.033, 0.44, 24), -0.34, 0.42, 0, 0, 0.12);
  add(new THREE.CylinderGeometry(0.04, 0.033, 0.44, 24),  0.34, 0.42, 0, 0, -0.12);
  return g;
}

// ─── Constants ────────────────────────────────────────────────────────────────
const VIEWS = [
  { label: "Front", angle: 0 },
  { label: "Right", angle: 90 },
  { label: "Back",  angle: 180 },
  { label: "Left",  angle: 270 },
];

// ─── Component ────────────────────────────────────────────────────────────────
export default function VirtualTryOn({ modelUrl = "man-model.glb" }) {
  const mountRef      = useRef(null);
  const modelRef      = useRef(null);
  const morphMapRef   = useRef({});   // { morphName: [{ mesh, index }, ...] }  (corpo, occhi, ...)
  const rafRef        = useRef(null);
  const autoRef       = useRef(null);
  const angleRef      = useRef(0);
  const destroyedRef  = useRef(false);
  const garmentRef    = useRef(null);   // GarmentSystem (capo derivato dalla mesh del corpo)

  const [angle,      setAngle]      = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [activeView, setActiveView] = useState(0);
  const [garment,    setGarment]    = useState(null);   // { template, resolved, color, category } dal pannello capo
  const [fitReport,  setFitReport]  = useState([]);

  // measureValues: { morphName → cm value }
  const [measureValues, setMeasureValues] = useState(() =>
    Object.fromEntries(SHAPE_KEYS.map(sk => [sk.morphName, sk.initial]))
  );

  // ── Apply a single morph influence to the mesh ───────────────────────────
  const applyMorph = (morphName, influence) => {
    const entries = morphMapRef.current[morphName];
    if (!entries) return;
    const v = Math.max(-1, Math.min(1, influence));
    entries.forEach((e) => { e.mesh.morphTargetInfluences[e.index] = v; });
  };

  // ── Handle measure change (from slider or number input) ──────────────────
  const handleMeasureChange = (morphName, rawValue) => {
    const sk = SHAPE_KEYS.find(s => s.morphName === morphName);
    const cm = Math.max(sk.min, Math.min(sk.max, Number(rawValue)));
    setMeasureValues(prev => ({ ...prev, [morphName]: cm }));
    const influence = cmToMorphInfluence(sk, cm);
    applyMorph(morphName, influence);
  };

  // ── Three.js scene setup ─────────────────────────────────────────────────
  useEffect(() => {
    destroyedRef.current = false;
    const el = mountRef.current;
    const W = el.clientWidth;
    const H = el.clientHeight;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.shadowMap.enabled = true;
    renderer.localClippingEnabled = true;     // tagli del capo (orlo, collo, fine manica)
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    el.appendChild(renderer.domElement);

    // Scene & Camera
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, W / H, 0.01, 100);
    camera.position.set(0, 1.0, 3.8);

    // Controls (solo zoom con scroll, rotazione Y via slider)
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.9, 0);
    controls.enablePan    = false;
    controls.enableRotate = false;
    controls.enableDamping   = true;
    controls.dampingFactor   = 0.08;
    controls.minDistance  = 1.5;
    controls.maxDistance  = 7;

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.45));

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.6);
    keyLight.position.set(1.5, 3.5, 2.5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.bias = -0.001;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xc8d8ff, 0.4);
    fillLight.position.set(-2, 1.5, -1);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xfff0d0, 0.6);
    rimLight.position.set(0, 2.5, -3);
    scene.add(rimLight);

    // Ground
     const ground = new THREE.Mesh(
       new THREE.CircleGeometry(2, 64),
       new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1 })
     );
     ground.rotation.x = -Math.PI / 2;
     ground.receiveShadow = true;
    //scene.add(ground);

    // Placeholder while GLB loads
    const placeholder = buildPlaceholder();
    scene.add(placeholder);
    modelRef.current = placeholder;

    // ── Load GLB ───────────────────────────────────────────────────────────
    const loader = new GLTFLoader();
    loader.load(
      modelUrl,
      (gltf) => {
        if (destroyedRef.current) return;
        scene.remove(placeholder);

        const root = gltf.scene;

        // ── Scan morph targets ────────────────────────────────────────────
        // Corpo ("firstmodel"): Chest, Waist, Hips, Altezza. Occhi ("high-poly"): solo Altezza,
        // così seguono la testa quando la statura cambia. Ogni morph va applicato a TUTTE le mesh che lo hanno.
        const morphMap = {};
        root.traverse((node) => {
          if (node.isMesh && node.morphTargetDictionary) {
            node.morphTargetInfluences = node.morphTargetInfluences || [];
            SHAPE_KEYS.forEach((sk) => {
              const idx = node.morphTargetDictionary[sk.morphName];
              if (idx !== undefined) {
                (morphMap[sk.morphName] ||= []).push({ mesh: node, index: idx });
              }
            });
          }
        });
        morphMapRef.current = morphMap;

        // Applica subito le misure di partenza mostrate nell'interfaccia
        SHAPE_KEYS.forEach((sk) => applyMorph(sk.morphName, cmToMorphInfluence(sk, sk.initial)));

        // ── Wrap → scala → centra ─────────────────────────────────────────
        // pivot: il GLB è già Y-up (esportato da blender/scripts/export_glb.py), nessuna rotazione
        const pivot = new THREE.Group();
        pivot.add(root);

        // wrapper: riceve solo rotation.Y dallo slider di rotazione
        const wrapper = new THREE.Group();
        wrapper.add(pivot);
        wrapper.updateMatrixWorld(true);

        // Scala per normalizzare l'altezza a ~2 unità Three.js
        const box  = new THREE.Box3().setFromObject(wrapper);
        const size = box.getSize(new THREE.Vector3());
        const scale = 2.0 / Math.max(size.y, 0.001);
        wrapper.scale.setScalar(scale);
        wrapper.updateMatrixWorld(true);

        // Centra sull'origine X/Z, poggia su Y=0
        const box2 = new THREE.Box3().setFromObject(wrapper);
        const ctr  = box2.getCenter(new THREE.Vector3());
        wrapper.position.set(-ctr.x, -box2.min.y, -ctr.z);

        // Shadow casting
        wrapper.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = false; } });

        scene.add(wrapper);
        modelRef.current = wrapper;
        if (morphMap.Chest) garmentRef.current = new GarmentSystem(morphMap.Chest[0].mesh, pivot);

        // Riposiziona camera per vedere il modello intero
        camera.position.set(0, 1.1, 4.2);
        controls.target.set(0, 1.0, 0);
        controls.update();

        setLoading(false);
      },
      undefined,
      (err) => {
        console.error("GLB load error:", err);
        if (!destroyedRef.current) setLoading(false);
      }
    );

    // ── Render loop ────────────────────────────────────────────────────────
    const render = () => {
      rafRef.current = requestAnimationFrame(render);
      controls.update();
      if (modelRef.current) {
        modelRef.current.rotation.y = angleRef.current * (Math.PI / 180);
      }
      renderer.render(scene, camera);
    };
    render();

    // ── Resize ────────────────────────────────────────────────────────────
    const onResize = () => {
      const W = el.clientWidth, H = el.clientHeight;
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      renderer.setSize(W, H);
    };
    window.addEventListener("resize", onResize);

    return () => {
      destroyedRef.current = true;
      garmentRef.current?.dispose();
      garmentRef.current = null;
      cancelAnimationFrame(rafRef.current);
      clearInterval(autoRef.current);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, [modelUrl]);

  // ── Capo: si ricalcola quando cambia il capo o una misura del corpo ───────
  const bodyCm = { chest: measureValues.Chest, waist: measureValues.Waist, hips: measureValues.Hips, height: measureValues.Altezza };
  useEffect(() => {
    const gs = garmentRef.current;
    if (!gs || loading) return;
    gs.setSpec(garment);
    if (!garment) { setFitReport([]); return; }
    const geom = gs.update();          // le influence dei morph sono gia' applicate da handleMeasureChange
    setFitReport(buildFitReport({ template: garment.template, resolved: garment.resolved, body: bodyCm, geom }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [garment, measureValues, loading]);

  // ── Auto-rotate effect ───────────────────────────────────────────────────
  useEffect(() => {
    clearInterval(autoRef.current);
    if (!autoRotate) return;
    autoRef.current = setInterval(() => {
      angleRef.current = (angleRef.current + 0.4) % 360;
      setAngle(angleRef.current);
      setActiveView(-1);
    }, 16);
    return () => clearInterval(autoRef.current);
  }, [autoRotate]);

  // ── View presets ─────────────────────────────────────────────────────────
  const setView = (idx) => {
    const v = VIEWS[idx].angle;
    angleRef.current = v;
    setAngle(v);
    setActiveView(idx);
    setAutoRotate(false);
  };

  // ── Rotation slider ──────────────────────────────────────────────────────
  const onRotationSlider = (e) => {
    const v = +e.target.value;
    angleRef.current = v;
    setAngle(v);
    setAutoRotate(false);
    setActiveView(-1);
  };

  const pct = (angle / 360) * 100;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <style>{css}</style>
      <div className="vto">

        {/* Header */}
        <header className="vto-header">
          <div className="vto-logo">Try-On <span>Studio</span></div>
          <div className="vto-status">
            <div className="vto-dot" />
            Beta
          </div>
        </header>

        <div className="vto-body">

          {/* 3D Canvas */}
          <div className="vto-canvas" ref={mountRef}>
            <div className={`vto-loading${!loading ? " done" : ""}`}>
              <div className="vto-spinner" />
              <div className="vto-loading-label">Caricamento modello</div>
            </div>
          </div>

          {/* Sidebar */}
          <aside className="vto-sidebar">

            {/* View presets */}
            <div className="vto-sidebar-section">
              <div className="vto-section-title">Vista</div>
              <div className="vto-views">
                {VIEWS.map((v, i) => (
                  <button
                    key={i}
                    className={`vto-view-btn${activeView === i ? " active" : ""}`}
                    onClick={() => setView(i)}
                  >
                    {v.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Shape key sliders */}
            <div className="vto-sidebar-section">
              <div className="vto-section-title">Misure</div>

              {SHAPE_KEYS.map((sk) => {
                const val = measureValues[sk.morphName];
                return (
                  <div className="vto-measure" key={sk.morphName}>
                    <div className="vto-measure-header">
                      <span className="vto-measure-name">{sk.label}</span>
                      <div className="vto-measure-input-wrap">
                        <input
                          type="number"
                          className="vto-measure-input"
                          value={val}
                          min={sk.min}
                          max={sk.max}
                          step={sk.step}
                          onChange={(e) => handleMeasureChange(sk.morphName, e.target.value)}
                        />
                        <span className="vto-measure-unit">{sk.unit}</span>
                      </div>
                    </div>
                    <input
                      type="range"
                      className="vto-measure-range"
                      min={sk.min}
                      max={sk.max}
                      step={sk.step}
                      value={val}
                      onChange={(e) => handleMeasureChange(sk.morphName, e.target.value)}
                    />
                    <div className="vto-range-labels">
                      <span>{sk.min}</span>
                      <span>{sk.max}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Capo: URL prodotto → estrazione → template parametrico sul corpo */}
            <div className="vto-sidebar-section">
              <div className="vto-section-title">Capo</div>
              <GarmentPanel body={bodyCm} report={fitReport} onGarmentChange={setGarment} />
            </div>

            {/* Auto-rotate */}
            <div className="vto-sidebar-section">
              <div className="vto-section-title">Playback</div>
              <div className="vto-auto" onClick={() => setAutoRotate(a => !a)}>
                <span>Auto-rotate</span>
                <div className={`vto-toggle${autoRotate ? " on" : ""}`} />
              </div>
            </div>

            {/* Controls hint */}
            <div className="vto-sidebar-section">
              <div className="vto-section-title">Controlli</div>
              <div className="vto-info">
                <div>Scroll → <strong>zoom</strong></div>
                <div>Slider → <strong>ruota</strong></div>
                <div>Misure → <strong>forma</strong></div>
              </div>
            </div>

          </aside>
        </div>

        {/* Footer rotation slider */}
        <footer className="vto-footer">
          <div className="vto-angle">{Math.round(angle)}°</div>
          <div className="vto-slider-wrap">
            <div className="vto-track">
              <div className="vto-fill" style={{ width: `${pct}%` }} />
            </div>
            <div className="vto-thumb" style={{ left: `${pct}%` }} />
            <input
              type="range"
              className="vto-range"
              min={0} max={360} step={0.5}
              value={angle}
              onChange={onRotationSlider}
            />
          </div>
          <div className="vto-hint">Trascina per ruotare</div>
        </footer>

      </div>
    </>
  );
}