// Lettura/scrittura minima di file GLB (glTF binario) in node, senza dipendenze: serve agli script offline e ai test del capo "body-bound".
import { readFileSync, writeFileSync } from "node:fs";

const COMP = { 5120: Int8Array, 5121: Uint8Array, 5122: Int16Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };
const SIZE = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

export function readGlb(path) {
  const buf = readFileSync(path);
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${path}: non e' un GLB`);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
  const binStart = 20 + jsonLen + 8;
  const bin = buf.subarray(binStart, binStart + buf.readUInt32LE(20 + jsonLen));
  return { path, json, bin, raw: buf, binStart };
}

/** Copia tipizzata dei dati di un accessor (anche "sparse", come i morph target esportati da Blender). */
export function accessor(glb, i) {
  const a = glb.json.accessors[i];
  const T = COMP[a.componentType], size = SIZE[a.type], out = new T(a.count * size);
  const view = (bvIndex, byteOffset, Ty, n) => {
    const bv = glb.json.bufferViews[bvIndex], off = (bv.byteOffset || 0) + (byteOffset || 0), o = new Ty(n);
    Buffer.from(o.buffer).set(glb.bin.subarray(off, off + n * Ty.BYTES_PER_ELEMENT));
    return o;
  };
  if (a.bufferView !== undefined) {
    const bv = glb.json.bufferViews[a.bufferView];
    if (bv.byteStride && bv.byteStride !== T.BYTES_PER_ELEMENT * size) throw new Error("accessor interlacciato non supportato");
    out.set(view(a.bufferView, a.byteOffset, T, a.count * size));
  }
  if (a.sparse) {
    const idx = view(a.sparse.indices.bufferView, a.sparse.indices.byteOffset, COMP[a.sparse.indices.componentType], a.sparse.count);
    const val = view(a.sparse.values.bufferView, a.sparse.values.byteOffset, T, a.sparse.count * size);
    for (let k = 0; k < a.sparse.count; k++) for (let d = 0; d < size; d++) out[idx[k] * size + d] = val[k * size + d];
  }
  return out;
}

/** Sovrascrive i dati (Float32, VEC3) di un accessor e ne aggiorna min/max. */
export function writeVec3(glb, i, data) {
  const a = glb.json.accessors[i], bv = glb.json.bufferViews[a.bufferView];
  const off = (bv.byteOffset || 0) + (a.byteOffset || 0);
  glb.bin.set(Buffer.from(data.buffer, data.byteOffset, data.byteLength), off);
  if (a.min) {
    const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    for (let v = 0; v < data.length; v += 3) for (let d = 0; d < 3; d++) { mn[d] = Math.min(mn[d], data[v + d]); mx[d] = Math.max(mx[d], data[v + d]); }
    a.min = mn; a.max = mx;
  }
}

export function saveGlb(glb, path) {
  let json = Buffer.from(JSON.stringify(glb.json), "utf8");
  if (json.length % 4) json = Buffer.concat([json, Buffer.alloc(4 - (json.length % 4), 0x20)]);
  const head = Buffer.alloc(20), binHead = Buffer.alloc(8);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(28 + json.length + glb.bin.length, 8);
  head.writeUInt32LE(json.length, 12); head.writeUInt32LE(0x4e4f534a, 16);
  binHead.writeUInt32LE(glb.bin.length, 0); binHead.writeUInt32LE(0x004e4942, 4);
  writeFileSync(path, Buffer.concat([head, json, binHead, glb.bin]));
}

/** Corpo: { position, index, morphs: { nome: delta }, boneNames, skinIndex, skinWeight } dalla mesh con shape key Chest. */
export function loadBody(path) {
  const glb = readGlb(path);
  const mesh = glb.json.meshes.find((m) => (m.extras?.targetNames || []).includes("Chest"));
  if (!mesh) throw new Error("corpo: mesh con shape key Chest non trovata");
  const p = mesh.primitives[0], names = mesh.extras.targetNames, morphs = {};
  names.forEach((n, k) => { morphs[n] = accessor(glb, p.targets[k].POSITION); });
  const node = glb.json.nodes.find((n) => n.mesh === glb.json.meshes.indexOf(mesh));
  const skin = glb.json.skins[node.skin];
  return { position: accessor(glb, p.attributes.POSITION), index: accessor(glb, p.indices), morphs,
    boneNames: skin.joints.map((j) => glb.json.nodes[j].name), skinIndex: accessor(glb, p.attributes.JOINTS_0), skinWeight: accessor(glb, p.attributes.WEIGHTS_0) };
}

/** Capo: primitive concatenate in un'unica numerazione { position, index, sleeve, layer, parts: [{ start, count, posAcc, nrmAcc }] }. */
export function loadGarment(path) {
  const glb = readGlb(path);
  const parts = [], pos = [], idx = [], slv = [], lay = [];
  let start = 0;
  for (const mesh of glb.json.meshes) for (const p of mesh.primitives) {
    const P = accessor(glb, p.attributes.POSITION), n = P.length / 3;
    const I = accessor(glb, p.indices);
    pos.push(P); idx.push(Uint32Array.from(I, (i) => i + start));
    const sa = p.attributes._SLEEVE ?? p.attributes._sleeve, la = p.attributes._LAYER ?? p.attributes._layer;      // Blender li esporta in maiuscolo
    slv.push(sa !== undefined ? Float32Array.from(accessor(glb, sa)) : new Float32Array(n));
    lay.push(la !== undefined ? Float32Array.from(accessor(glb, la)) : new Float32Array(n));
    parts.push({ start, count: n, posAcc: p.attributes.POSITION, nrmAcc: p.attributes.NORMAL });
    start += n;
  }
  const cat = (T, arrs) => { const o = new T(arrs.reduce((s, a) => s + a.length, 0)); let k = 0; for (const a of arrs) { o.set(a, k); k += a.length; } return o; };
  return { glb, parts, position: cat(Float32Array, pos), index: cat(Uint32Array, idx), sleeve: cat(Float32Array, slv), layer: cat(Float32Array, lay) };
}
