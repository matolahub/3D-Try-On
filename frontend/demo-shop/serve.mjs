// Server statico minimale per il negozio di esempio, su un'ORIGINE DIVERSA dal widget (porta 5174 vs 5173):
// cosi' l'integrazione si prova davvero cross-origin, come in produzione. Nessuna dipendenza.
//   node demo-shop/serve.mjs            (widget: npm run dev su :5173)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 5174);
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };

http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const rel = path.normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const file = path.join(root, rel === "/" ? "index.html" : rel);
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404).end("not found"); return; }
    res.writeHead(200, { "Content-Type": types[path.extname(file)] || "application/octet-stream" }).end(data);
  });
}).listen(port, "127.0.0.1", () => console.log(`Negozio demo: http://localhost:${port}  (widget atteso su ${process.env.TRYON_URL || "http://localhost:5173"})`));
