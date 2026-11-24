// SOLO SVILUPPO: "fotocamera" sintetica per verificare il Live Body Scan senza una persona davanti al telefono.
// Rende il corpo 3D di wearIT (man-model.glb) con misure NOTE (stessi morph calibrati del Try-On), in posa "A",
// ripreso come da un telefono appoggiato in verticale a 1 m da terra e 2 m di distanza, e lo passa alla scansione come
// MediaStream. Copione: fermo di fronte, poi ruota di 90° a 30°/s con le braccia in avanti, poi fermo di fianco.
// Attivazione (solo `npm run dev`): embed.html?scanSource=model&scanBody=petto,vita,fianchi,altezza
// I valori veri (giri a nastro della mesh, calibrati entro 0,1 cm) sono in window.__scanTruth per il confronto.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { bodyToInfluences, clampBody, BODY_KEYS } from "../../core/bodyMeasures.js";

/**
 * Soggetto sintetico: canvas con il corpo 3D. render(yawDeg, side) disegna un fotogramma (sincrono).
 * Usato sia come fotocamera in tempo reale (modelCameraStream) sia dal validatore fotogramma per fotogramma (validate.js).
 */
export async function createModelSubject({ body, w = 720, h = 1280, armDeg = 32, pitchDeg = 0, camY = 1.0, dist = 2.1, fovDeg = 62 } = {}) {
  const b = clampBody(body);
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(w, h, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd9d4cc);                           // parete
  const cam = new THREE.PerspectiveCamera(fovDeg, w / h, 0.05, 20);       // fotocamera frontale in verticale (~62° verticali)
  cam.position.set(0, camY, dist);
  cam.lookAt(0, camY, 0);
  cam.rotateX((pitchDeg * Math.PI) / 180);                               // telefono appoggiato e inclinato: guarda in alto
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8178, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(0.8, 2.5, 3); scene.add(key);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial({ color: 0xb9ad9c }));
  floor.rotation.x = -Math.PI / 2; scene.add(floor);

  const gltf = await new GLTFLoader().loadAsync(`${import.meta.env.BASE_URL}assets/man-model.glb`);
  const root = gltf.scene;
  const inf = bodyToInfluences(b);
  root.traverse((n) => {
    if (n.isMesh && n.morphTargetDictionary) {
      for (const k of BODY_KEYS) { const i = n.morphTargetDictionary[k.morphName]; if (i !== undefined) n.morphTargetInfluences[i] = inf[k.morphName]; }
    }
    if (n.isMesh) n.material = new THREE.MeshStandardMaterial({ color: 0xc89f86, roughness: 0.7 });   // pelle uniforme, come abiti aderenti
  });
  const holder = new THREE.Group();
  holder.add(root);
  scene.add(holder);
  holder.updateMatrixWorld(true);
  // Braccia: rotazioni nello spazio del mondo applicate al braccio a riposo (corpo rivolto alla fotocamera).
  //   posa "A" (di fronte): attorno all'asse della fotocamera (Z), verso l'esterno, di armDeg
  //   braccia in avanti (di profilo): attorno all'asse X, fino all'orizzontale, gomito disteso
  const arms = [];
  for (const side of ["L", "R"]) {
    // GLTFLoader toglie i punti dai nomi dei nodi (upperarm01.L -> upperarm01L)
    const byName = (n) => root.getObjectByName(n) || root.getObjectByName(n.replace(".", ""));
    const bone = byName(`upperarm01.${side}`), elbow = byName(`lowerarm01.${side}`);
    if (bone && elbow) arms.push({ bone, elbow, orig: bone.quaternion.clone(), origElbow: elbow.quaternion.clone() });
  }
  const rotateWorld = (bone, axis, deg) => {
    const parentQ = bone.parent.getWorldQuaternion(new THREE.Quaternion()), worldQ = bone.getWorldQuaternion(new THREE.Quaternion());
    const rq = new THREE.Quaternion().setFromAxisAngle(axis, (deg * Math.PI) / 180);
    bone.quaternion.copy(parentQ.clone().invert().multiply(rq).multiply(worldQ));
    holder.updateMatrixWorld(true);
  };
  /** Applica una posa: tra i due versi di rotazione sceglie quello che porta il gomito dove serve (score piu' alto). */
  const pose = (axis, deg, score, straightElbow) => {
    const ry = holder.rotation.y;
    holder.rotation.y = 0;
    for (const a of arms) {
      const reset = () => { a.bone.quaternion.copy(a.orig); a.elbow.quaternion.copy(straightElbow ? new THREE.Quaternion() : a.origElbow); holder.updateMatrixWorld(true); };
      reset(); rotateWorld(a.bone, axis, deg); const sPlus = score(a.elbow.getWorldPosition(new THREE.Vector3()));
      reset(); rotateWorld(a.bone, axis, -deg); const sMinus = score(a.elbow.getWorldPosition(new THREE.Vector3()));
      if (sPlus > sMinus) { reset(); rotateWorld(a.bone, axis, deg); }
    }
    holder.rotation.y = ry;
    holder.updateMatrixWorld(true);
  };
  const aPose = (deg) => pose(new THREE.Vector3(0, 0, 1), deg, (p) => Math.abs(p.x), false);
  const armsForward = (deg = 80) => pose(new THREE.Vector3(1, 0, 0), deg, (p) => p.z + p.y, true);     // avanti e in alto (non indietro, non in basso)
  aPose(armDeg);
  // piedi a terra e centrato
  const box = new THREE.Box3().setFromObject(root);
  root.position.y -= box.min.y;
  root.position.x -= (box.min.x + box.max.x) / 2;
  root.position.z -= (box.min.z + box.max.z) / 2;

  let forward = false, openDeg = armDeg, liftDeg = 80;
  return {
    canvas,
    truth: b,
    /** yawDeg: rotazione del corpo; side: braccia in avanti (vista di profilo) */
    render(yawDeg, side = false) {
      if (side && !forward) { armsForward(); forward = true; }
      holder.rotation.y = (yawDeg * Math.PI) / 180;
      renderer.render(scene, cam);
    },
    /** Il soggetto "obbedisce" a "apri le braccia". */
    openArms(stepDeg = 8) { if (!forward && openDeg < 70) { openDeg += stepDeg; aPose(openDeg); } return openDeg; },
    /** ... e a "tendi le braccia in avanti, all'altezza delle spalle" (le alza un po' di piu'). */
    raiseArms(stepDeg = 6) { if (forward && liftDeg < 110) { liftDeg += stepDeg; armsForward(liftDeg); } return liftDeg; },
    dispose: () => renderer.dispose(),
  };
}

export async function modelCameraStream({ body, frontSec = 120, turnDegPerSec = 30, ...opts } = {}) {
  const subj = await createModelSubject({ body, ...opts });
  window.__scanTruth = subj.truth;
  // il "soggetto" segue le istruzioni: resta di fronte finche' la scansione non chiede di girarsi (window.__scanPhase, solo DEV),
  // poi tende le braccia in avanti e ruota a turnDegPerSec; frontSec e' solo un limite di sicurezza se la fase non arriva mai
  const t0 = performance.now();
  let raf = 0, stopped = false, turnAt = null;
  const frame = () => {
    if (stopped) return;
    const now = performance.now();
    if (turnAt === null && (window.__scanPhase === "turn" || (now - t0) / 1000 > frontSec)) turnAt = now;
    // obbedisce alle istruzioni sulle braccia (al massimo una correzione ogni mezzo secondo)
    const cue = window.__scanSnap?.cue;
    if (cue?.startsWith("arms_") && now - (frame.lastFix || 0) > 500) {
      frame.lastFix = now;
      if (cue.startsWith("arms_forward")) subj.raiseArms(); else subj.openArms();
    }
    subj.render(turnAt === null ? 0 : Math.min(90, ((now - turnAt) / 1000) * turnDegPerSec), turnAt !== null);
    raf = requestAnimationFrame(frame);
  };
  frame();
  const stream = subj.canvas.captureStream(30);
  const track = stream.getVideoTracks()[0];
  const stop = track.stop.bind(track);
  track.stop = () => { stopped = true; cancelAnimationFrame(raf); subj.dispose(); stop(); };
  return stream;
}
