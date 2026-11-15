// Capo 3D reale (GLB): UNA cloth sim per taglia sul corpo neutro, adattata a runtime al corpo corrente dal deformatore "body-bound"
// (bound.js: il capo pende dalle spalle, segue la forma vera del corpo e conserva il giro del tessuto). Nessuno shape key nel GLB del capo:
// le combinazioni di misure non sono somme lineari, il capo viene ricalcolato sulla forma del corpo con tutte le misure insieme.
//
// Qui c'e' solo la parte Three.js: caricamento, unione delle primitive in un'unica numerazione di vertici, scrittura di posizioni e normali.

import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { BodyModel, bindGarment, deformGarment, smoothNormals } from "./bound.js";

export class AssetGarment {
  /**
   * @param {THREE.Object3D} parent stesso genitore del corpo (coordinate condivise)
   * @param {() => { position: Float32Array, index: ArrayLike<number>, morphs: Object<string, Float32Array>, armW: Float32Array }} bodyData
   *   geometria di base del corpo, shape key (delta) per nome e pesi delle braccia: gli stessi dati che usa il capo parametrico
   */
  constructor(parent, bodyData) {
    this.group = new THREE.Group();
    this.group.name = "garment-asset";
    this.group.visible = false;
    parent.add(this.group);
    this.bodyData = bodyData;
    this.bodyModel = null;
    this.cache = new Map();      // url -> Promise<{ root, meta }>
    this.token = 0;
    this.meshes = [];
    this.asset = null;
    this.meta = null;
    this.bind = null;
    this.info = null;
    this.failed = null;          // url dell'ultimo asset che non si e' caricato
    this._inflKey = "";          // influence dell'ultima deformazione calcolata
  }

  _load(asset) {
    if (!this.cache.has(asset.url)) {
      const glb = new Promise((res, rej) => new GLTFLoader().load(asset.url, res, undefined, (e) => rej(e instanceof Error ? e : new Error("GLB del capo non caricabile"))));
      const meta = fetch(asset.metaUrl).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      this.cache.set(asset.url, Promise.all([glb, meta]).then(([gltf, m]) => ({ root: gltf.scene, meta: m })));
    }
    return this.cache.get(asset.url);
  }

  /** Mostra l'asset (carica se serve). Risolve true a caricamento finito, false se nel frattempo e' stato richiesto altro. */
  async show(asset, influences) {
    if (this.asset && this.asset.url === asset.url && this.bind) {     // gia' caricato: solo le influence
      this.group.visible = true;
      this.setInfluences(influences);
      return true;
    }
    const my = ++this.token;
    this.asset = asset;
    this.bind = null;
    let loaded;
    // caricamento fallito: lo si ricorda (`failed`), cosi' il motore puo' ripiegare sul capo parametrico invece di lasciare il corpo nudo
    try { loaded = await this._load(asset); } catch { this.cache.delete(asset.url); if (my === this.token) this.failed = asset.url; return false; }
    if (my !== this.token) return false;
    this.group.clear();
    const root = loaded.root.clone(true);
    this.meshes = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.geometry = o.geometry.clone();                       // le posizioni vengono riscritte: non si tocca la copia in cache
      o.castShadow = true;
      o.receiveShadow = true;                                // ombre proprie del capo (sotto le maniche, sotto le pieghe)
      o.frustumCulled = false;
      o.material = o.material.clone();
      o.material.side = THREE.DoubleSide;
      this.meshes.push(o);
    });
    // primitive unite in un'unica numerazione (davanti e dietro sono due materiali della stessa maglia)
    let n = 0, ni = 0;
    for (const m of this.meshes) { n += m.geometry.attributes.position.count; ni += m.geometry.index.count; }
    const position = new Float32Array(n * 3), sleeve = new Float32Array(n), layer = new Float32Array(n), index = new Uint32Array(ni);
    this.parts = [];
    let v0 = 0, i0 = 0;
    for (const m of this.meshes) {
      const g = m.geometry, c = g.attributes.position.count;
      position.set(g.attributes.position.array.subarray(0, c * 3), v0 * 3);
      if (g.attributes._sleeve) sleeve.set(g.attributes._sleeve.array.subarray(0, c), v0);
      if (g.attributes._layer) layer.set(g.attributes._layer.array.subarray(0, c), v0);
      const ia = g.index.array;
      for (let k = 0; k < ia.length; k++) index[i0 + k] = ia[k] + v0;
      g.attributes.position.setUsage(THREE.DynamicDrawUsage);
      this.parts.push({ mesh: m, start: v0, count: c });
      v0 += c; i0 += ia.length;
    }
    if (!this.bodyModel) this.bodyModel = new BodyModel(this.bodyData());
    this.bind = bindGarment({ position, index, sleeve, layer }, this.bodyModel);
    this._inflKey = "";
    this.out = new Float32Array(n * 3);
    this.nrm = new Float32Array(n * 3);
    this.meta = loaded.meta;
    this.group.add(root);
    this.group.visible = true;
    this.setInfluences(influences);
    return true;
  }

  hide() {
    this.token++;
    this.asset = null;
    this.bind = null;
    this.info = null;
    this.group.visible = false;
  }

  /** infl = { Chest, Waist, Hips, Altezza } (le stesse del corpo). Ritorna le grandezze misurate dal deformatore (o null se non c'e' capo). */
  setInfluences(infl) {
    if (!infl || !this.bind) return null;
    // stesse influence dell'ultima volta: il capo e' gia' quello giusto. Il motore chiama due volte a ogni cambio di misura (corpo, poi capo):
    // senza questo controllo la deformazione (decine di ms) veniva rifatta identica.
    const key = `${infl.Chest || 0}|${infl.Waist || 0}|${infl.Hips || 0}|${infl.Altezza || 0}`;
    if (key === this._inflKey && this.info) return this.info;
    this._inflKey = key;
    const res = deformGarment(this.bind, infl, this.out);
    smoothNormals(this.out, this.bind.index, this.bind.weld, this.nrm);
    for (const p of this.parts) {
      const g = p.mesh.geometry;
      g.attributes.position.array.set(this.out.subarray(p.start * 3, (p.start + p.count) * 3));
      g.attributes.position.needsUpdate = true;
      if (g.attributes.normal) { g.attributes.normal.array.set(this.nrm.subarray(p.start * 3, (p.start + p.count) * 3)); g.attributes.normal.needsUpdate = true; }
    }
    this.info = res.info;
    return res.info;
  }

  dispose() {
    this.token++;
    this.group.removeFromParent();
    this.group.clear();
    this.cache.clear();
  }
}
