import test from "node:test";
import assert from "node:assert/strict";
import { assetFor, GARMENT_ASSETS } from "./assets.js";
import { normalizeProduct } from "../contract.js";

test("assetFor: risolve l'URL del GLB e del suo file di metadati solo per taglia e categoria costruite", () => {
  const sz = GARMENT_ASSETS["grillz-tee"].sizes[0];
  const a = assetFor("grillz-tee", "tshirt", sz);
  assert.ok(a.url.endsWith(`tee-${sz}.glb`) && a.metaUrl.endsWith(`tee-${sz}.json`));
  assert.equal(assetFor("grillz-tee", "hoodie", sz), null, "categoria diversa");
  assert.equal(assetFor("grillz-tee", "tshirt", "XXS"), null, "taglia non costruita: si usa il capo parametrico");
  assert.equal(assetFor("inesistente", "tshirt", sz), null);
  assert.equal(assetFor(undefined, "tshirt", sz), null);
});

test("contratto: product.asset e' opzionale e viene mantenuto", () => {
  const base = { id: "1", name: "Tee", category: "tshirt", sizes: [{ label: "M", garmentMeasurements: { chestWidth: 55 } }] };
  const withAsset = normalizeProduct({ ...base, asset: "grillz-tee" });
  assert.equal(withAsset.product.asset, "grillz-tee");
  assert.equal(withAsset.warnings.some((w) => w.includes("asset")), false);
  assert.equal(normalizeProduct(base).product.asset, null);
});
