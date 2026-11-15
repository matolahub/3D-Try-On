// Prodotti di ESEMPIO per provare il sistema senza backend né URL reali. Non sono dati di un negozio vero:
// nell'interfaccia sono sempre etichettati "esempio". Stessa forma della risposta di /api/extract.

const m = (v, extra = {}) => ({ value_cm: v, raw: String(v), basis: "circumference", ...extra });

export const DEMO_PRODUCTS = {
  tshirt: {
    demo: true,
    url: "esempio://tshirt",
    product: { name: "T-shirt di esempio (misure del capo)", brand: null, images: [], sizes_available: ["S", "M", "L", "XL"], breadcrumbs: [], sources: {} },
    classification: { category: "tshirt", confidence: 1, reasons: ["esempio"] },
    dominant_color: "#3b5b8c",
    warnings: [],
    size_chart: {
      kind: "garment", kind_confidence: 1, kind_reasons: ["esempio"], unit: "cm", warnings: [], source: "esempio",
      columns: [{ key: "chest" }, { key: "length" }, { key: "sleeve" }, { key: "shoulder" }],
      rows: [
        { size: "S", measures: { chest: m(100, { note: "larghezza a piatto x2" }), length: m(68), sleeve: m(21), shoulder: m(45) } },
        { size: "M", measures: { chest: m(104, { note: "larghezza a piatto x2" }), length: m(70), sleeve: m(22), shoulder: m(47) } },
        { size: "L", measures: { chest: m(108, { note: "larghezza a piatto x2" }), length: m(72), sleeve: m(23), shoulder: m(49) } },
        { size: "XL", measures: { chest: m(112, { note: "larghezza a piatto x2" }), length: m(74), sleeve: m(24), shoulder: m(51) } },
      ],
    },
  },
  hoodie: {
    demo: true,
    url: "esempio://hoodie",
    product: { name: "Hoodie di esempio (misure del corpo)", brand: null, images: [], sizes_available: ["S", "M", "L", "XL"], breadcrumbs: [], sources: {} },
    classification: { category: "hoodie", confidence: 1, reasons: ["esempio"] },
    dominant_color: "#5a5f66",
    warnings: [],
    size_chart: {
      kind: "body", kind_confidence: 1, kind_reasons: ["esempio"], unit: "cm", warnings: [], source: "esempio",
      columns: [{ key: "chest" }, { key: "waist" }, { key: "hips" }],
      rows: [
        { size: "S", measures: { chest: m(90, { min_cm: 88, max_cm: 92 }), waist: m(76, { min_cm: 74, max_cm: 78 }), hips: m(94, { min_cm: 92, max_cm: 96 }) } },
        { size: "M", measures: { chest: m(98, { min_cm: 96, max_cm: 100 }), waist: m(84, { min_cm: 82, max_cm: 86 }), hips: m(102, { min_cm: 100, max_cm: 104 }) } },
        { size: "L", measures: { chest: m(106, { min_cm: 104, max_cm: 108 }), waist: m(92, { min_cm: 90, max_cm: 94 }), hips: m(110, { min_cm: 108, max_cm: 112 }) } },
        { size: "XL", measures: { chest: m(114, { min_cm: 112, max_cm: 116 }), waist: m(100, { min_cm: 98, max_cm: 102 }), hips: m(118, { min_cm: 116, max_cm: 120 }) } },
      ],
    },
  },
};

/** Capo senza pagina prodotto: l'utente sceglie la categoria e inserisce le misure a mano (quando l'estrazione non e' possibile). */
export const MANUAL_PRODUCT = {
  manual: true,
  url: "manuale://",
  product: { name: "Capo inserito a mano", brand: null, images: [], sizes_available: [], breadcrumbs: [], sources: {} },
  classification: { category: "unknown", confidence: 0, reasons: [] },
  dominant_color: null,
  warnings: [{ code: "manual", message: "Nessun dato dal prodotto: scegli la categoria e inserisci le misure del capo (altrimenti valgono i default del template)." }],
  size_chart: null,
};
