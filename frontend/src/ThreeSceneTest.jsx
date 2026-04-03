import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";

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
  .vto-logo {
    font-size: 13px;
    font-weight: 500;
    letter-spacing: .04em;
    color: var(--text);
  }
  .vto-logo span { color: var(--muted); font-weight: 300; }
  .vto-status {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 11px;
    color: var(--muted);
    letter-spacing: .03em;
  }
  .vto-dot {
    width: 5px; height: 5px;
    border-radius: 50%;
    background: #4ade80;
  }

  /* ── Main area ── */
  .vto-body {
    flex: 1;
    display: flex;
    overflow: hidden;
  }

  /* ── Canvas ── */
  .vto-canvas {
    flex: 1;
    position: relative;
    background: #0a0a0a;
  }
  .vto-canvas canvas {
    display: block;
    width: 100% !important;
    height: 100% !important;
  }

  /* Loading */
  .vto-loading {
    position: absolute; inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 14px;
    background: #0a0a0a;
    z-index: 10;
    transition: opacity .5s;
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
  .vto-loading-label {
    font-size: 11px;
    color: var(--muted);
    letter-spacing: .06em;
    text-transform: uppercase;
  }

  /* ── Sidebar ── */
  .vto-sidebar {
    width: 200px;
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    padding: 20px 16px;
    gap: 24px;
    overflow-y: auto;
    flex-shrink: 0;
  }

  .vto-section-title {
    font-size: 9px;
    font-weight: 500;
    letter-spacing: .1em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 10px;
  }

  /* View buttons */
  .vto-views {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }
  .vto-view-btn {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--muted);
    font-family: 'Inter', sans-serif;
    font-size: 11px;
    padding: 8px 6px;
    cursor: pointer;
    border-radius: 6px;
    transition: all .15s;
    text-align: center;
  }
  .vto-view-btn:hover { border-color: rgba(255,255,255,.2); color: var(--text); }
  .vto-view-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: #000;
    font-weight: 500;
  }

  /* Auto-rotate toggle */
  .vto-auto {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 12px;
    color: var(--muted);
    cursor: pointer;
    user-select: none;
  }
  .vto-auto:hover { color: var(--text); }
  .vto-toggle {
    width: 32px; height: 17px;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 99px;
    position: relative;
    transition: background .2s, border-color .2s;
    flex-shrink: 0;
  }
  .vto-toggle.on { background: var(--accent); border-color: var(--accent); }
  .vto-toggle::after {
    content: '';
    position: absolute;
    width: 11px; height: 11px;
    background: var(--muted);
    border-radius: 50%;
    top: 2px; left: 2px;
    transition: transform .2s, background .2s;
  }
  .vto-toggle.on::after { transform: translateX(15px); background: #000; }

  .vto-sep {
    height: 1px;
    background: var(--border);
  }

  /* Info */
  .vto-info {
    font-size: 11px;
    color: var(--muted);
    line-height: 2;
  }
  .vto-info strong { color: var(--text); font-weight: 400; }

  /* ── Footer / Slider ── */
  .vto-footer {
    height: 60px;
    border-top: 1px solid var(--border);
    display: flex;
    align-items: center;
    padding: 0 24px;
    gap: 16px;
    flex-shrink: 0;
  }
  .vto-angle {
    font-size: 12px;
    font-weight: 500;
    color: var(--text);
    min-width: 40px;
    font-variant-numeric: tabular-nums;
  }
  .vto-slider-wrap {
    flex: 1;
    position: relative;
    height: 20px;
    display: flex;
    align-items: center;
  }
  .vto-track {
    position: absolute;
    left: 0; right: 0;
    height: 1px;
    background: rgba(255,255,255,.12);
  }
  .vto-fill {
    position: absolute;
    left: 0; top: 0; bottom: 0;
    background: var(--accent);
  }
  .vto-thumb {
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    width: 12px; height: 12px;
    background: var(--accent);
    border-radius: 50%;
    pointer-events: none;
    border: 2px solid var(--bg);
  }
  .vto-range {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
    width: 100%;
  }
  .vto-hint {
    font-size: 11px;
    color: var(--muted);
    white-space: nowrap;
  }
`;

// ─── Placeholder body ─────────────────────────────────────────────────────────

function buildPlaceholder() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.6 });
  const g = new THREE.Group();
  const add = (geo, px = 0, py = 0, pz = 0, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px, py, pz);
    m.rotation.set(rx, 0, rz);
    m.castShadow = true;
    g.add(m);
  };
  add(new THREE.SphereGeometry(0.135, 32, 32), 0, 1.48, 0);
  add(new THREE.CylinderGeometry(0.055, 0.065, 0.12, 20), 0, 1.3, 0);
  add(new THREE.CylinderGeometry(0.19, 0.165, 0.65, 32), 0, 0.93, 0);
  add(new THREE.CylinderGeometry(0.18, 0.16, 0.28, 32), 0, 0.56, 0);
  add(new THREE.CylinderGeometry(0.072, 0.058, 0.58, 24), -0.1, 0.25, 0, 0, 0.04);
  add(new THREE.CylinderGeometry(0.072, 0.058, 0.58, 24), 0.1, 0.25, 0, 0, -0.04);
  add(new THREE.CylinderGeometry(0.055, 0.042, 0.52, 24), -0.1, -0.29, 0);
  add(new THREE.CylinderGeometry(0.055, 0.042, 0.52, 24), 0.1, -0.29, 0);
  add(new THREE.CylinderGeometry(0.052, 0.042, 0.52, 24), -0.28, 0.92, 0, 0, 0.16);
  add(new THREE.CylinderGeometry(0.052, 0.042, 0.52, 24), 0.28, 0.92, 0, 0, -0.16);
  add(new THREE.CylinderGeometry(0.04, 0.033, 0.44, 24), -0.34, 0.42, 0, 0, 0.12);
  add(new THREE.CylinderGeometry(0.04, 0.033, 0.44, 24), 0.34, 0.42, 0, 0, -0.12);
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

export default function VirtualTryOn({ modelUrl = "model.glb" }) {
  const mountRef     = useRef(null);
  const modelRef     = useRef(null);
  const rafRef       = useRef(null);
  const autoRef      = useRef(null);
  const angleRef     = useRef(0);
  const destroyedRef = useRef(false);

  const [angle,      setAngle]      = useState(0);
  const [loading,    setLoading]    = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [activeView, setActiveView] = useState(0);

  // ── Scene ────────────────────────────────────────────────────────────────
  useEffect(() => {
    destroyedRef.current = false;
    const el = mountRef.current;
    const W = el.clientWidth, H = el.clientHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, W / H, 0.01, 100);
    camera.position.set(0, 1.0, 3.8);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.9, 0);
    controls.enablePan = false;
    controls.enableRotate = false; // Y gestita dallo slider
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.5;
    controls.maxDistance = 7;

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.4));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1.5, 3.5, 2.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.bias = -0.001;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xc8d8ff, 0.4);
    fill.position.set(-2, 1.5, -1);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xfff0d0, 0.6);
    rim.position.set(0, 2.5, -3);
    scene.add(rim);

    // Ground
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(2, 64),
      new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // Placeholder
    const placeholder = buildPlaceholder();
    scene.add(placeholder);
    modelRef.current = placeholder;

    // Load GLB
    const loader = new GLTFLoader();
    loader.load(
      modelUrl,
      (gltf) => {
        if (destroyedRef.current) return;
        scene.remove(placeholder);
        const model = gltf.scene;

        // pivot: corregge orientamento (testa verso +Z → ruota -90° su X)
        const pivot = new THREE.Group();
        pivot.add(model);
        const GLB_ORIENTATION_FIX = -Math.PI / 2; // cambia se serve: +Math.PI/2 o 0
        pivot.rotation.set(GLB_ORIENTATION_FIX, 0, 0);

        // wrapper: riceve SOLO rotation.Y dallo slider
        const wrapper = new THREE.Group();
        wrapper.add(pivot);
        wrapper.updateMatrixWorld(true);

        const box  = new THREE.Box3().setFromObject(wrapper);
        const size = box.getSize(new THREE.Vector3());
        const scale = 2.0 / Math.max(size.y, 0.001);
        wrapper.scale.setScalar(scale);
        wrapper.updateMatrixWorld(true);

        const box2 = new THREE.Box3().setFromObject(wrapper);
        const ctr  = box2.getCenter(new THREE.Vector3());
        wrapper.position.set(-ctr.x, -box2.min.y, -ctr.z);

        wrapper.traverse((c) => { if (c.isMesh) c.castShadow = true; });
        scene.add(wrapper);
        modelRef.current = wrapper;

        camera.position.set(0, 1.0, 4.5);
        controls.target.set(0, 1.0, 0);
        controls.update();
        setLoading(false);
      },
      undefined,
      () => { if (!destroyedRef.current) setLoading(false); }
    );

    // Render loop
    const render = () => {
      rafRef.current = requestAnimationFrame(render);
      controls.update();
      if (modelRef.current) {
        modelRef.current.rotation.y = angleRef.current * (Math.PI / 180);
      }
      renderer.render(scene, camera);
    };
    render();

    const onResize = () => {
      const W = el.clientWidth, H = el.clientHeight;
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
      renderer.setSize(W, H);
    };
    window.addEventListener("resize", onResize);

    return () => {
      destroyedRef.current = true;
      cancelAnimationFrame(rafRef.current);
      clearInterval(autoRef.current);
      window.removeEventListener("resize", onResize);
      controls.dispose();
      renderer.dispose();
      if (el.contains(renderer.domElement)) el.removeChild(renderer.domElement);
    };
  }, [modelUrl]);

  // ── Auto-rotate ──────────────────────────────────────────────────────────
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

  // ── Handlers ─────────────────────────────────────────────────────────────
  const setView = (idx) => {
    const v = VIEWS[idx].angle;
    angleRef.current = v;
    setAngle(v);
    setActiveView(idx);
    setAutoRotate(false);
  };

  const onSlider = (e) => {
    const v = +e.target.value;
    angleRef.current = v;
    setAngle(v);
    setAutoRotate(false);
    setActiveView(-1);
  };

  const pct = (angle / 360) * 100;

  return (
    <>
      <style>{css}</style>
      <div className="vto">

        <header className="vto-header">
          <div className="vto-logo">Try‑On <span>Studio</span></div>
          <div className="vto-status">
            <div className="vto-dot" />
            Beta
          </div>
        </header>

        <div className="vto-body">

          <div className="vto-canvas" ref={mountRef}>
            <div className={`vto-loading${!loading ? " done" : ""}`}>
              <div className="vto-spinner" />
              <div className="vto-loading-label">Loading</div>
            </div>
          </div>

          <aside className="vto-sidebar">

            <div>
              <div className="vto-section-title">View</div>
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

            <div className="vto-sep" />

            <div>
              <div className="vto-section-title">Playback</div>
              <div className="vto-auto" onClick={() => setAutoRotate(a => !a)}>
                <span>Auto-rotate</span>
                <div className={`vto-toggle${autoRotate ? " on" : ""}`} />
              </div>
            </div>

            <div className="vto-sep" />

            <div>
              <div className="vto-section-title">Controls</div>
              <div className="vto-info">
                <div>Scroll → <strong>zoom</strong></div>
                <div>Slider → <strong>rotate</strong></div>
              </div>
            </div>

          </aside>
        </div>

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
              onChange={onSlider}
            />
          </div>
          <div className="vto-hint">Drag to rotate</div>
        </footer>

      </div>
    </>
  );
}