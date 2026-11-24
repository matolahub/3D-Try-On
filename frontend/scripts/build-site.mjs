// Completa la build di Vite (dist/) con il negozio di esempio, cosi' un UNICO sito statico contiene tutto:
//   /                 -> rimanda a /demo-shop/
//   /demo-shop/       negozio di esempio (carica l'SDK e il widget dalla stessa origine)
//   /embed.html       widget (iframe)       /sdk/*  SDK        /assets/*  corpo e capi 3D
// Uso:  npm run build:site   poi caricare la cartella dist/ su un hosting statico (vedi VIRTUAL_TRYON_PLAYBOOK.md, sezione "Pubblicazione").
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
if (!fs.existsSync(path.join(dist, "embed.html"))) throw new Error("dist/embed.html non trovato: lanciare prima 'vite build'");
const shop = path.join(dist, "demo-shop");
fs.mkdirSync(shop, { recursive: true });
for (const f of ["index.html", "products.js", "shop.js", "shop.css"]) fs.copyFileSync(path.join(root, "demo-shop", f), path.join(shop, f));
fs.writeFileSync(path.join(dist, "index.html"), '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=demo-shop/"><title>Try-On</title><a href="demo-shop/">Vai al negozio di esempio</a>\n');
const size = (d) => fs.readdirSync(d, { withFileTypes: true }).reduce((s, e) => s + (e.isDirectory() ? size(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
console.log(`Sito pronto in dist/ (${(size(dist) / 1048576).toFixed(1)} MB): index.html -> demo-shop/, embed.html, sdk/, assets/`);
