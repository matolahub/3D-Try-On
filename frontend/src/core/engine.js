// Motore del Try-On: scena Three.js + corpo parametrico + capo. Nessuna dipendenza da React ne' dall'e-commerce.
//
//   const engine = new TryOnEngine(container, { modelUrl: "/assets/man-model.glb" });
//   await engine.load();
//   engine.setBody({ chest: 100, waist: 85, hips: 100, height: 178 });   // misure del CORPO in cm
//   engine.setGarment({ template, resolved, color });                    // capo (vedi garment/fit.js)  -> ritorna la geometria misurata

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls";
import { GarmentSystem } from "./garment/mesh.js";
import { Shorts } from "./garment/shorts.js";
import { AssetGarment } from "./garment/asset.js";
import { LEVELS } from "./garment/templates.js";
import { BODY_KEYS, bodyToInfluences, clampBody, defaultBody } from "./bodyMeasures.js";

const AUTO_ROTATE_DEG_PER_SEC = 25;

// Corpo segnaposto, visibile mentre il GLB si carica
function buildPlaceholder() {
  const mat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.6 });
  const g = new THREE.Group();
  const add = (geo, px = 0, py = 0, pz = 0, rx = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(px, py, pz);
    m.rotation.set(rx, 0, rz);
    g.add(m);
  };
  add(new THREE.SphereGeometry(0.135, 32, 32), 0, 1.48);
  add(new THREE.CylinderGeometry(0.055, 0.065, 0.12, 20), 0, 1.3);
  add(new THREE.CylinderGeometry(0.19, 0.165, 0.65, 32), 0, 0.93);
  add(new THREE.CylinderGeometry(0.18, 0.16, 0.28, 32), 0, 0.56);
  add(new THREE.CylinderGeometry(0.072, 0.058, 0.58, 24), -0.1, 0.25, 0, 0, 0.04);
  add(new THREE.CylinderGeometry(0.072, 0.058, 0.58, 24), 0.1, 0.25, 0, 0, -0.04);
  add(new THREE.CylinderGeometry(0.055, 0.042, 0.52, 24), -0.1, -0.29);
  add(new THREE.CylinderGeometry(0.055, 0.042, 0.52, 24), 0.1, -0.29);
  add(new THREE.CylinderGeometry(0.052, 0.042, 0.52, 24), -0.28, 0.92, 0, 0, 0.16);
  add(new THREE.CylinderGeometry(0.052, 0.042, 0.52, 24), 0.28, 0.92, 0, 0, -0.16);
  add(new THREE.CylinderGeometry(0.04, 0.033, 0.44, 24), -0.34, 0.42, 0, 0, 0.12);
  add(new THREE.CylinderGeometry(0.04, 0.033, 0.44, 24), 0.34, 0.42, 0, 0, -0.12);
  return g;
}

export class TryOnEngine {
  /**
   * @param {HTMLElement} container elemento che ospitera' il canvas (deve avere una dimensione)
   * @param {{ modelUrl: string, onAngle?: (deg:number)=>void, onGeom?: (geom:object)=>void }} opts
   *   onGeom: chiamato quando un capo 3D reale (GLB) finisce di caricarsi: la geometria misurata e' disponibile solo allora
   */
  constructor(container, { modelUrl, onAngle, onGeom } = {}) {
    if (!modelUrl) throw new Error("TryOnEngine: modelUrl obbligatorio");
    this.container = container;
    this.modelUrl = modelUrl;
    this.onAngle = onAngle;
    this.onGeom = onGeom;
    this.loaded = false;
    this.disposed = false;
    this.angle = 0;
    this.autoRotate = false;
    this.body = defaultBody();
    this.garmentSpec = null;
    this.geom = null;
    this.morphMap = {};
    this.garment = null;
    this.model = null;
    this._lastAngleEmit = 0;
    this._assetFailed = new Set();                       // url dei capi 3D che non si sono caricati: per quelli vale il capo parametrico

    const W = container.clientWidth || 1, H = container.clientHeight || 1;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.shadowMap.enabled = true;
    renderer.localClippingEnabled = true;                 // tagli del capo (orlo, collo, fine manica)
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, W / H, 0.01, 100);
    camera.position.set(0, 1.0, 3.8);
    this.scene = scene;
    this.camera = camera;

    // Controlli: solo zoom con la rotella; la rotazione e' guidata dall'interfaccia
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(0, 0.9, 0);
    controls.enablePan = false;
    controls.enableRotate = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.5;
    controls.maxDistance = 7;
    this.controls = controls;

    scene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(1.5, 3.5, 2.5);
    key.castShadow = true;
    // ombre: la mappa inquadra solo la figura (2 m), non i 10 m di default: 2048 px su ~2,6 m = ~1,3 mm per texel, ombre nitide sotto
    // maniche e orlo. normalBias evita l'effetto "a righe" sulle superfici che ricevono la propria ombra.
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -1.3; key.shadow.camera.right = 1.3; key.shadow.camera.top = 1.4; key.shadow.camera.bottom = -1.2;
    key.shadow.camera.near = 1; key.shadow.camera.far = 9;
    key.target.position.set(0, 1.0, 0);
    scene.add(key.target);
    key.shadow.bias = -0.0005;
    key.shadow.normalBias = 0.012;
    key.shadow.radius = 3;
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xc8d8ff, 0.4);
    fill.position.set(-2, 1.5, -1);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0xfff0d0, 0.6);
    rim.position.set(0, 2.5, -3);
    scene.add(rim);

    this.placeholder = buildPlaceholder();
    scene.add(this.placeholder);
    this.model = this.placeholder;

    this._last = performance.now();
    const loop = (t) => {
      if (this.disposed) return;
      this._raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (t - this._last) / 1000);
      this._last = t;
      if (this.autoRotate) {
        this.angle = (this.angle + AUTO_ROTATE_DEG_PER_SEC * dt) % 360;
        if (this.onAngle && t - this._lastAngleEmit > 100) { this._lastAngleEmit = t; this.onAngle(this.angle); }
      }
      controls.update();
      if (this.model) this.model.rotation.y = this.angle * (Math.PI / 180);
      renderer.render(scene, camera);
    };
    this._raf = requestAnimationFrame(loop);

    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(container);
  }

  /** Carica il GLB del corpo. Risolve quando il modello e' pronto; rifiuta se il caricamento fallisce. */
  load() {
    return new Promise((resolve, reject) => {
      new GLTFLoader().load(this.modelUrl, (gltf) => {
        if (this.disposed) return;
        const root = gltf.scene;

        // Shape key: il corpo ha Chest/Waist/Hips/Altezza, gli occhi solo Altezza (seguono la testa). Ogni morph va
        // applicato a TUTTE le mesh che lo hanno.
        root.traverse((node) => {
          if (node.isMesh && node.morphTargetDictionary) {
            node.morphTargetInfluences = node.morphTargetInfluences || [];
            for (const k of BODY_KEYS) {
              const idx = node.morphTargetDictionary[k.morphName];
              if (idx !== undefined) (this.morphMap[k.morphName] ||= []).push({ mesh: node, index: idx });
            }
          }
        });
        if (!this.morphMap.Chest) return reject(new Error("Il modello non contiene gli shape key attesi (Chest/Waist/Hips/Altezza)."));

        // pivot: il GLB e' gia' Y-up (esportato da blender/scripts/export_glb.py); wrapper: riceve la rotazione Y
        const pivot = new THREE.Group();
        pivot.add(root);
        const wrapper = new THREE.Group();
        wrapper.add(pivot);
        wrapper.updateMatrixWorld(true);

        // scala per normalizzare l'altezza a ~2 unita', poi centra e poggia i piedi su Y=0
        const size = new THREE.Box3().setFromObject(wrapper).getSize(new THREE.Vector3());
        wrapper.scale.setScalar(2.0 / Math.max(size.y, 0.001));
        wrapper.updateMatrixWorld(true);
        const box2 = new THREE.Box3().setFromObject(wrapper);
        const ctr = box2.getCenter(new THREE.Vector3());
        wrapper.position.set(-ctr.x, -box2.min.y, -ctr.z);
        // il corpo riceve l'ombra del capo (sotto l'orlo, sotto le maniche, attorno al colletto): e' cio' che fa sembrare il capo indossato.
        // Prima le mappe d'ombra venivano calcolate ma nessun oggetto le riceveva.
        wrapper.traverse((c) => { if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; } });

        this.scene.remove(this.placeholder);
        this.scene.add(wrapper);
        this.model = wrapper;
        this.garment = new GarmentSystem(this.morphMap.Chest[0].mesh, pivot);
        this.shorts = new Shorts(this.garment);
        // capo 3D reale (GLB), nello stesso sistema di coordinate del corpo: riceve la geometria del corpo per legarsi ad essa
        const gs = this.garment;
        this.assetGarment = new AssetGarment(pivot, () => ({
          position: gs.base, index: gs.body.geometry.index.array, armW: gs.armW,
          morphs: Object.fromEntries(Object.entries(gs.morphDict).map(([name, i]) => [name, gs.morphs[i]])),
        }));
        // inquadratura di partenza: figura intera ma piu' vicina (occupa ~3/4 dell'altezza invece di ~3/5), cosi' il capo si legge subito
        this.camera.position.set(0, 1.08, 3.5);
        this.controls.target.set(0, 1.02, 0);
        this.controls.update();

        this.loaded = true;
        this._applyBody();
        if (this.garmentSpec) this._applyGarment();
        resolve();
      }, undefined, (err) => reject(err instanceof Error ? err : new Error("Caricamento del modello 3D non riuscito.")));
    });
  }

  _applyMorph(name, influence) {
    const v = Math.max(-1, Math.min(1, influence));
    (this.morphMap[name] || []).forEach((e) => { e.mesh.morphTargetInfluences[e.index] = v; });
  }

  _applyBody() {
    if (!this.loaded) return;
    const infl = bodyToInfluences(this.body);
    for (const [name, v] of Object.entries(infl)) this._applyMorph(name, v);
    this.shorts?.update();                                 // i boxer seguono il corpo anche senza capo
    this.assetGarment?.setInfluences(infl);                // il capo 3D reale segue gli stessi valori del corpo
  }

  _applyGarment() {
    if (!this.loaded) return null;
    const spec = this.garmentSpec;
    if (spec?.asset && !this._assetFailed.has(spec.asset.url)) {      // capo 3D reale: sostituisce quello parametrico
      this.garment.setSpec(null);
      const ready = this.assetGarment.bind && this.assetGarment.asset?.url === spec.asset.url;
      this.assetGarment.show(spec.asset, bodyToInfluences(this.body)).then((ok) => {
        if (!ok && this.assetGarment.failed === spec.asset.url) {
          // il GLB del capo non si e' caricato (rete, file mancante): si ripiega sul capo parametrico costruito dalle misure del negozio,
          // invece di lasciare il corpo senza capo e senza avviso
          console.warn(`[tryon] capo 3D non caricabile (${spec.asset.url}): uso il capo parametrico`);
          this._assetFailed.add(spec.asset.url);
          if (this.garmentSpec === spec) { this.geom = this._applyGarment(); this.onGeom?.(this.geom); }
          return;
        }
        if (!ok || ready || this.garmentSpec !== spec) return;
        this.geom = this._assetGeom(spec);                 // appena caricato: ora le misure sulla mesh ci sono
        this.onGeom?.(this.geom);
      });
      this.geom = this._assetGeom(spec);
      return this.geom;
    }
    this.assetGarment?.hide();
    this.garment.setSpec(this.garmentSpec);
    this.geom = this.garmentSpec ? this.garment.update() : null;      // le influence dei morph sono gia' applicate
    return this.geom;
  }

  /**
   * Valori per il report di vestibilita' quando il capo e' un asset. Le misure del capo sono quelle MISURATE SULLA MESH 3D dell'asset
   * (metadati scritti da blender/garment/check_tee.py), non quelle dichiarate dal negozio; quelle del corpo e la quota dell'orlo vengono
   * dal deformatore sul corpo corrente. Finche' il GLB non e' caricato si ripiega sui dati del negozio (`pending`).
   */
  _assetGeom(spec) {
    const R = spec.resolved.measures;
    const shop = (k) => (R[k] ? R[k].value : null);
    const ag = this.assetGarment, info = ag?.bind ? ag.info : null, m = info && ag.meta ? ag.meta.measured : null;
    if (!info || !m) {
      return { gChest: shop("chest"), gWaist: null, gHem: null, bHem: null, lengthCm: shop("length"), lengthClamped: false, lengthRequestedCm: shop("length"),
        hemVsHipsCm: null, sleeveCm: shop("sleeve"), sleeveEndRatio: null, fromAsset: true, pending: true };
    }
    return { gChest: m.chest_circ_cm, gWaist: null, gHem: m.hem_circ_cm, bHem: info.bodyAtHemCm, lengthCm: m.length_cm, lengthClamped: false, lengthRequestedCm: m.length_cm,
      hemVsHipsCm: (info.hemY - this.garment.yAt(LEVELS.hips)) * 100, sleeveCm: m.sleeve_cm, sleeveEndRatio: null, fromAsset: true, pending: false,
      tightCm: info.tightCm, bodyAtChestLineCm: info.bodyAtChestLineCm };
  }

  /** Imposta le misure del CORPO (cm). Ritorna la geometria del capo misurata sul nuovo corpo (o null senza capo). */
  setBody(body) {
    this.body = clampBody({ ...this.body, ...body });
    this._applyBody();
    return this._applyGarment();
  }

  /** Imposta il capo ({ template, resolved, color }) oppure null per toglierlo. Ritorna la geometria misurata. */
  setGarment(spec) {
    this.garmentSpec = spec;
    return this._applyGarment();
  }

  /** Aggiorna corpo e capo insieme con un solo ricalcolo del capo. `garment` undefined = invariato, null = nessun capo. */
  apply({ body, garment }) {
    if (body) this.body = clampBody({ ...this.body, ...body });
    if (garment !== undefined) this.garmentSpec = garment;
    this._applyBody();
    return this._applyGarment();
  }

  setAngle(deg) { this.angle = ((deg % 360) + 360) % 360; }
  setAutoRotate(on) { this.autoRotate = !!on; }

  resize() {
    if (this.disposed) return;
    const W = this.container.clientWidth, H = this.container.clientHeight;
    if (!W || !H) return;
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(W, H);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this._raf);
    this._ro?.disconnect();
    this.garment?.dispose();
    this.shorts?.dispose();
    this.assetGarment?.dispose();
    this.controls.dispose();
    this.scene.traverse((o) => {
      if (o.isMesh) { o.geometry?.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m?.dispose()); }
    });
    this.renderer.dispose();
    if (this.container.contains(this.renderer.domElement)) this.container.removeChild(this.renderer.domElement);
  }
}
