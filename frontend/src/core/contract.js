// Contratto dati v1 tra e-commerce e Try-On.
//
// Il negozio passa un `product` con le sue `sizes`; ogni taglia porta le MISURE DEL CAPO (garmentMeasurements).
// Le misure del CORPO dell'utente sono un'altra cosa (vedi bodyMeasures.js): non le fornisce il negozio.
//
// Principi:
//  - nessuna ambiguita': `chest` e' il GIRO completo, `chestWidth` e' la larghezza a piatto (ascella-ascella, meta' giro);
//  - nessun dato inventato: le misure assenti restano assenti e il fitting usa il template, segnalandolo;
//  - errori chiari: un valore non plausibile e' rifiutato con un messaggio che dice come correggere;
//  - compatibilita' futura: i campi sconosciuti producono un avviso, non un errore.

export const CONTRACT_VERSION = 1;
export const CATEGORIES = ["tshirt", "hoodie"];

// Misure del capo accettate. `full` = giro completo; `width` = variante a piatto (x2 = giro); range plausibili in cm.
const GIRTH = {
  chest:         { label: "torace",              full: [70, 200],  width: "chestWidth", widthRange: [35, 100] },
  hem:           { label: "orlo",                full: [60, 200],  width: "hemWidth",   widthRange: [30, 100] },
  waist:         { label: "vita",                full: [55, 200],  width: "waistWidth", widthRange: [27, 100] },
  sleeveOpening: { label: "apertura manica",     full: [15, 60] },
  bicep:         { label: "bicipite",            full: [20, 70] },
};
const LENGTH = {
  length:   { label: "lunghezza (dal punto alto della spalla all'orlo)", range: [30, 110] },
  shoulder: { label: "larghezza spalle (da cucitura a cucitura)",         range: [30, 75] },
  sleeve:   { label: "lunghezza manica",                                  range: [5, 95] },
};
const OTHER_SIZE_KEYS = ["sleeveFrom"];
const BODYFIT_FIELDS = ["chest", "waist", "hips", "height"];
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Accetta numeri e stringhe numeriche ("52", "52.5", "52,5"); tutto il resto e' NaN. */
function num(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string" && /^\s*\d+(?:[.,]\d+)?\s*$/.test(v)) return Number(v.replace(",", "."));
  return NaN;
}

function normalizeGarment(raw, sizeLabel, errors, warnings) {
  const where = `taglia "${sizeLabel}"`;
  const g = {};                                   // valori normalizzati (cm): chest, hem, waist (giri), length, shoulder, sleeve, ...
  const notes = {};                               // note di interpretazione (es. larghezza a piatto x2)
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    errors.push(`${where}: garmentMeasurements mancante o non valido (atteso un oggetto con le misure del capo in cm).`);
    return { g, notes };
  }
  const known = new Set([...Object.keys(GIRTH), ...Object.values(GIRTH).map((d) => d.width).filter(Boolean), ...Object.keys(LENGTH), ...OTHER_SIZE_KEYS]);
  for (const k of Object.keys(raw)) if (!known.has(k)) warnings.push(`${where}: misura sconosciuta "${k}" ignorata.`);

  for (const [key, def] of Object.entries(GIRTH)) {
    const hasFull = raw[key] !== undefined && raw[key] !== null;
    const hasWidth = def.width && raw[def.width] !== undefined && raw[def.width] !== null;
    if (!hasFull && !hasWidth) continue;
    let full = NaN, fromWidth = NaN;
    if (hasFull) {
      full = num(raw[key]);
      if (!Number.isFinite(full) || full <= 0) { errors.push(`${where}: ${key} deve essere un numero positivo in cm (ricevuto ${JSON.stringify(raw[key])}).`); continue; }
      if (full < def.full[0] || full > def.full[1]) {
        const hint = def.width && full >= def.widthRange[0] && full <= def.widthRange[1]
          ? ` Il valore sembra una larghezza a piatto (ascella-ascella): usa "${def.width}" invece di "${key}".` : "";
        errors.push(`${where}: ${key} = ${full} cm non e' plausibile come circonferenza (${def.full[0]}-${def.full[1]} cm).${hint}`);
        continue;
      }
    }
    if (hasWidth) {
      fromWidth = num(raw[def.width]);
      if (!Number.isFinite(fromWidth) || fromWidth <= 0) { errors.push(`${where}: ${def.width} deve essere un numero positivo in cm (ricevuto ${JSON.stringify(raw[def.width])}).`); continue; }
      if (fromWidth < def.widthRange[0] || fromWidth > def.widthRange[1]) {
        errors.push(`${where}: ${def.width} = ${fromWidth} cm non e' plausibile come larghezza a piatto (${def.widthRange[0]}-${def.widthRange[1]} cm).`);
        continue;
      }
    }
    if (hasFull && hasWidth) {
      if (Math.abs(full - 2 * fromWidth) > 2) { errors.push(`${where}: ${key} (${full}) e ${def.width} (${fromWidth}) non coincidono (${def.width} x 2 = ${2 * fromWidth}). Fornisci una sola delle due.`); continue; }
      g[key] = full;
    } else if (hasFull) {
      g[key] = full;
    } else {
      g[key] = 2 * fromWidth;
      notes[key] = `larghezza a piatto ${fromWidth} cm x2`;
    }
  }
  for (const [key, def] of Object.entries(LENGTH)) {
    if (raw[key] === undefined || raw[key] === null) continue;
    const v = num(raw[key]);
    if (!Number.isFinite(v) || v <= 0) { errors.push(`${where}: ${key} deve essere un numero positivo in cm (ricevuto ${JSON.stringify(raw[key])}).`); continue; }
    if (v < def.range[0] || v > def.range[1]) { errors.push(`${where}: ${key} = ${v} cm fuori dal range plausibile (${def.range[0]}-${def.range[1]} cm) per ${def.label}.`); continue; }
    g[key] = v;
  }
  if (raw.sleeveFrom !== undefined) {
    if (raw.sleeveFrom === "shoulder" || raw.sleeveFrom === "centerBack") g.sleeveFrom = raw.sleeveFrom;
    else errors.push(`${where}: sleeveFrom deve essere "shoulder" o "centerBack".`);
  }
  if (g.chest === undefined && !errors.some((e) => e.startsWith(where))) {
    errors.push(`${where}: manca il torace. Fornisci "chest" (giro completo, cm) oppure "chestWidth" (larghezza a piatto, cm).`);
  }
  return { g, notes };
}

function normalizeBodyFit(raw, sizeLabel, warnings) {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object" || Array.isArray(raw)) { warnings.push(`taglia "${sizeLabel}": bodyFit ignorato (atteso un oggetto).`); return null; }
  const out = {};
  for (const f of BODYFIT_FIELDS) {
    const r = raw[f];
    if (r === undefined) continue;
    const lo = Array.isArray(r) ? num(r[0]) : NaN, hi = Array.isArray(r) ? num(r[1]) : NaN;
    if (Array.isArray(r) && r.length === 2 && Number.isFinite(lo) && Number.isFinite(hi) && lo <= hi) out[f] = [lo, hi];
    else warnings.push(`taglia "${sizeLabel}": bodyFit.${f} ignorato (atteso [min, max] in cm).`);
  }
  for (const k of Object.keys(raw)) if (!BODYFIT_FIELDS.includes(k)) warnings.push(`taglia "${sizeLabel}": bodyFit.${k} sconosciuto, ignorato.`);
  return Object.keys(out).length ? out : null;
}

/**
 * Valida e normalizza un prodotto ricevuto dall'e-commerce.
 * @returns {{ ok: boolean, product: object|null, errors: string[], warnings: string[] }}
 *   product normalizzato: { id, name, category, color, images[], sizes:[{ label, available, garment:{...cm}, notes, bodyFit }] }
 */
export function normalizeProduct(input) {
  const errors = [], warnings = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, product: null, errors: ["product mancante o non valido (atteso un oggetto)."], warnings };
  }
  const id = typeof input.id === "string" || typeof input.id === "number" ? String(input.id) : "";
  if (!id) errors.push('product.id mancante (stringa qualsiasi, serve solo a te per riconoscere il prodotto).');
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) errors.push("product.name mancante.");
  if (!CATEGORIES.includes(input.category)) errors.push(`product.category deve essere uno tra: ${CATEGORIES.join(", ")} (ricevuto ${JSON.stringify(input.category)}).`);

  let color = null;
  if (input.color !== undefined && input.color !== null) {
    if (typeof input.color === "string" && HEX.test(input.color.trim())) color = input.color.trim();
    else warnings.push(`product.color "${input.color}" non e' un esadecimale (#rrggbb): uso il colore di default del template.`);
  } else {
    warnings.push("product.color assente: uso il colore di default del template.");
  }
  const images = [];
  for (const u of Array.isArray(input.images) ? input.images : []) {
    if (typeof u === "string" && /^https?:\/\//i.test(u)) images.push(u);
    else warnings.push(`product.images: "${String(u).slice(0, 60)}" ignorata (serve un URL http/https).`);
  }
  const knownTop = new Set(["id", "name", "category", "color", "images", "sizes", "units", "version", "asset"]);
  for (const k of Object.keys(input)) if (!knownTop.has(k)) warnings.push(`product.${k} sconosciuto, ignorato.`);
  if (input.units !== undefined && input.units !== "cm") errors.push('product.units: la versione 1 supporta solo "cm".');

  const sizes = [];
  if (!Array.isArray(input.sizes) || input.sizes.length === 0) {
    errors.push("product.sizes deve contenere almeno una taglia.");
  } else {
    const seen = new Set();
    input.sizes.forEach((s, i) => {
      const label = s && typeof s.label === "string" ? s.label.trim() : "";
      if (!label) { errors.push(`sizes[${i}].label mancante.`); return; }
      if (seen.has(label)) { errors.push(`taglia "${label}" duplicata.`); return; }
      seen.add(label);
      const { g, notes } = normalizeGarment(s.garmentMeasurements, label, errors, warnings);
      if (g.chest !== undefined) {
        if (g.length === undefined) warnings.push(`taglia "${label}": length assente, il fitting usa la lunghezza del template (segnalata come tale).`);
        if (g.sleeve === undefined) warnings.push(`taglia "${label}": sleeve assente, il fitting usa la manica del template (segnalata come tale).`);
      }
      sizes.push({ label, available: s.available !== false, garment: g, notes, bodyFit: normalizeBodyFit(s.bodyFit, label, warnings) });
    });
  }
  const ok = errors.length === 0;
  const asset = typeof input.asset === "string" && input.asset.trim() ? input.asset.trim() : null;   // id di un capo 3D reale ospitato dal Try-On (opzionale)
  return { ok, product: ok ? { id, name, category: input.category, color, images, asset, sizes } : null, errors, warnings };
}

/** Sceglie la taglia da mostrare: quella richiesta se esiste, altrimenti la prima disponibile. */
export function pickSize(product, requested) {
  return product.sizes.find((s) => s.label === requested) || product.sizes.find((s) => s.available) || product.sizes[0];
}
