// Genera public/sdk/tryon-sdk.js (script classico, anche CommonJS) dal sorgente ESM public/sdk/tryon-sdk.mjs.
// Nessuna dipendenza: e' solo una trasformazione di testo. Il test src/embed/sdk.test.js verifica che i due file siano allineati.
//   npm run build:sdk
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public", "sdk");

export function classicFromEsm(esm) {
  const m = esm.match(/^(\/\*![\s\S]*?\*\/\n)([\s\S]*)$/);
  const header = m ? m[1] : "";
  const body = (m ? m[2] : esm)
    .replace(/^export \{ TryOn \};\n/m, "")
    .replace(/^export default TryOn;\n/m, "")
    .replace(/^const root = .*\n\n?/m, "");
  const indented = body.split("\n").map((l) => (l ? "  " + l : l)).join("\n").replace(/\s+$/, "\n");
  return `${header}(function (root) {
  "use strict";
${indented}
  if (typeof module === "object" && module.exports) { module.exports = TryOn; module.exports.default = TryOn; }
  else root.TryOn = TryOn;
})(typeof self !== "undefined" ? self : this);
`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const esm = fs.readFileSync(path.join(dir, "tryon-sdk.mjs"), "utf8");
  fs.writeFileSync(path.join(dir, "tryon-sdk.js"), classicFromEsm(esm));
  console.log("public/sdk/tryon-sdk.js rigenerato da tryon-sdk.mjs");
}
