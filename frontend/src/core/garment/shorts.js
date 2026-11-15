// Boxer/bermuda a quadretti sotto il capo: la parte bassa del corpo non resta nuda sotto la T-shirt.
// E' una shell sottile dei triangoli del corpo (vita -> meta' coscia), come la shell del capo ma senza ease: segue le shape key del corpo.
// Il motivo e' procedurale (vichy), calcolato nel fragment shader con proiezione per asse dominante: nessuna texture, nessuna UV.

import * as THREE from "three";

const TOP = 0.585, HEM = 0.385;       // livelli (frazione dell'altezza del corpo base): vita bassa -> meta' coscia
const GAP = 0.0015;                   // m: distanza dalla pelle. Il capo (parametrico o asset) non scende mai sotto 2,4 mm: i boxer restano sotto

export class Shorts {
  /** @param {import("./mesh.js").GarmentSystem} gs sistema del capo: fornisce geometria del corpo, morph e livelli correnti */
  constructor(gs) {
    this.gs = gs;
    const idx = gs.body.geometry.index.array, base = gs.base;
    const lo = gs.y0 + (HEM - 0.03) * gs.H0, hi = gs.y0 + (TOP + 0.03) * gs.H0;
    const tris = [], used = new Set();
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      if ((gs.armW[a] + gs.armW[b] + gs.armW[c]) / 3 >= 0.5) continue;                       // niente braccia/mani
      const ys = [base[a * 3 + 1], base[b * 3 + 1], base[c * 3 + 1]];
      if (Math.min(...ys) < lo || Math.max(...ys) > hi) continue;
      tris.push(a, b, c); used.add(a); used.add(b); used.add(c);
    }
    this.verts = Int32Array.from(used);
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(gs.n * 3), 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("position", this.pos);
    geo.setAttribute("normal", new THREE.BufferAttribute(gs.nrm, 3));
    geo.setIndex(new THREE.BufferAttribute(Uint32Array.from(tris), 1));
    const planes = [new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Plane(new THREE.Vector3(0, -1, 0), 0)];
    const mat = new THREE.MeshStandardMaterial({ color: "#2f4d7a", roughness: 0.9, metalness: 0, side: THREE.DoubleSide, clippingPlanes: planes });
    mat.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vSP;\nvarying vec3 vSN;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSP = position;\nvSN = normal;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vSP;\nvarying vec3 vSN;")
        .replace("#include <color_fragment>", `#include <color_fragment>
        {
          // vichy: 0 = bianco, .5 = tono medio, 1 = blu. Proiezione frontale (xy) o laterale (zy) secondo la normale, fusione morbida.
          float s = 0.017;
          vec3 w = pow(abs(normalize(vSN)), vec3(6.0));
          vec2 a = step(0.5, fract(vSP.xy / s)), b = step(0.5, fract(vSP.zy / s));
          float lz = (a.x + a.y) * 0.5, lx = (b.x + b.y) * 0.5;
          float l = (lz * w.z + lx * w.x) / max(w.z + w.x, 1e-4);
          diffuseColor.rgb = mix(vec3(0.93, 0.93, 0.90), vec3(0.16, 0.29, 0.52), l);
        }`);
    };
    mat.customProgramCacheKey = () => "shorts-gingham";
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.name = "shorts";
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.planes = planes;
    this.local = planes.map((p) => p.clone());
    this.mesh.onBeforeRender = () => this.planes.forEach((p, i) => p.copy(this.local[i]).applyMatrix4(this.group.matrixWorld));
    this.group = new THREE.Group();          // stesso sistema di coordinate del capo (figlio del pivot del corpo)
    this.group.name = "shorts";
    this.group.add(this.mesh);
    gs.group.parent.add(this.group);
  }

  /** Ricalcola sul corpo corrente (shape key gia' applicate). */
  update() {
    const gs = this.gs;
    gs._computeCurrent();
    const c = gs.cur, n = gs.nrm, p = this.pos.array;
    for (const v of this.verts) for (let k = 0; k < 3; k++) p[v * 3 + k] = c[v * 3 + k] + n[v * 3 + k] * GAP;
    this.pos.needsUpdate = true;
    this.local[0].constant = -gs.yAt(HEM);      // tiene sopra l'orlo
    this.local[1].constant = gs.yAt(TOP);       // tiene sotto la vita
  }

  dispose() {
    this.mesh.geometry.dispose(); this.mesh.material.dispose();
    this.group.parent?.remove(this.group);
  }
}
