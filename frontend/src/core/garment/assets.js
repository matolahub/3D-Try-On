// Registro dei capi 3D REALI (asset modellati e drappeggiati offline in Blender, vedi blender/garment/).
//
// Un asset e' identificato da un id che il negozio passa in `product.asset`. Per ogni taglia c'e' un GLB con:
//   - la mesh del capo gia' drappeggiata sul corpo base (texture dalla foto del prodotto), UNA cloth sim per taglia
//   - un file .json con le misure del capo misurate sulla mesh (usate dal report di vestibilita') e la provenienza di ogni dato
// L'adattamento al corpo dell'utente e' calcolato a runtime (bound.js), non con shape key del capo.
// Se il prodotto non ha un asset per la taglia scelta, il motore torna al capo parametrico del template.

// taglie costruite (sh blender/garment/build_all.sh), dal cartamodello graduato con la tabella
const ALL_SIZES = ["S", "M", "L", "XL", "2XL"];

export const GARMENT_ASSETS = {
  "grillz-tee": { category: "tshirt", base: "/assets/garments/grillz-tee/", sizes: ALL_SIZES, file: (size) => `tee-${size}.glb` },
  // tabelle taglie dei negozi in blender/garment/products.py (assets/products/<id>/[Ss]ource/tabella_taglie.csv)
  "kermit-tee": { category: "tshirt", base: "/assets/garments/kermit-tee/", sizes: ALL_SIZES, file: (size) => `tee-${size}.glb` },
  "drivingmato-tee": { category: "tshirt", base: "/assets/garments/drivingmato-tee/", sizes: ALL_SIZES, file: (size) => `tee-${size}.glb` },
};

/** Descrittore dell'asset per (id, categoria, taglia) oppure null se non esiste. */
export function assetFor(id, category, sizeLabel) {
  const a = id ? GARMENT_ASSETS[id] : null;
  if (!a || a.category !== category || !a.sizes.includes(sizeLabel)) return null;
  const url = a.base + a.file(sizeLabel);
  return { id, size: sizeLabel, url, metaUrl: url.replace(/\.glb$/, ".json") };
}
