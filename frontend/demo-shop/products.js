// Catalogo del negozio di ESEMPIO, nel formato "interno" di un e-commerce qualsiasi (nomi e unita' scelti dal negozio).
// NON e' il formato del Try-On: la traduzione e' in shop.js (toTryOnProduct).
window.SHOP_CATALOG = [
  {
    sku: "GRILLZ-TEE-WHT", title: "Grillz Tee", kind: "T-shirt", colorHex: "#eeeeee", price: "39,00 €", asset: "grillz-tee",
    variants: [   // tabella taglie del prodotto (cm): larghezza petto a piatto, lunghezza dal colletto, manica dal punto spalla, spalla
      { size: "S",   stock: 10, spec: { chest_flat_cm: 55.5, length_cm: 70, sleeve_cm: 20.9, shoulder_cm: 53.7 }, fits: { chest: "88-96", height: "165-175" } },
      { size: "M",   stock: 14, spec: { chest_flat_cm: 57.5, length_cm: 72, sleeve_cm: 21.4, shoulder_cm: 55.2 }, fits: { chest: "94-102", height: "170-180" } },
      { size: "L",   stock: 9,  spec: { chest_flat_cm: 60,   length_cm: 74, sleeve_cm: 22,   shoulder_cm: 57 },   fits: { chest: "100-108", height: "175-185" } },
      { size: "XL",  stock: 6,  spec: { chest_flat_cm: 62.5, length_cm: 76, sleeve_cm: 22.6, shoulder_cm: 58.8 }, fits: { chest: "106-114", height: "180-190" } },
      { size: "2XL", stock: 3,  spec: { chest_flat_cm: 65,   length_cm: 78, sleeve_cm: 23.2, shoulder_cm: 60.6 }, fits: { chest: "112-120", height: "185-195" } },
    ],
  },
  {   // tabella taglie del negozio (assets/products/kermit-tee/Source/tabella_taglie.csv); le fasce "fits" sono indicative (non fornite)
    sku: "KERMIT-TEE-GRN", title: "Kermit Tee", kind: "T-shirt", colorHex: "#1fb089", price: "45,00 €", asset: "kermit-tee",
    variants: [   // tabella taglie del prodotto (cm): larghezza petto a piatto, lunghezza dal colletto, manica dal punto spalla, spalla
      { size: "S",   stock: 10, spec: { chest_flat_cm: 59, length_cm: 70, sleeve_cm: 21, shoulder_cm: 58 }, fits: { chest: "88-96", height: "165-175" } },
      { size: "M",   stock: 14, spec: { chest_flat_cm: 61, length_cm: 72, sleeve_cm: 22, shoulder_cm: 60 }, fits: { chest: "94-102", height: "170-180" } },
      { size: "L",   stock: 9,  spec: { chest_flat_cm: 63, length_cm: 74, sleeve_cm: 23, shoulder_cm: 62 }, fits: { chest: "100-108", height: "175-185" } },
      { size: "XL",  stock: 6,  spec: { chest_flat_cm: 65, length_cm: 76, sleeve_cm: 24, shoulder_cm: 64 }, fits: { chest: "106-114", height: "180-190" } },
      { size: "2XL", stock: 3,  spec: { chest_flat_cm: 67, length_cm: 78, sleeve_cm: 25, shoulder_cm: 66 }, fits: { chest: "112-120", height: "185-195" } },
    ],
  },
  {   // raglan; tabella taglie del negozio (assets/products/drivingMato-tee/source/tabella_taglie.csv): niente spalla (non esiste in una raglan).
      // La manica di tabella (39-43 cm) e' misurata dal colletto: non e' la "manica dal punto spalla" di questo catalogo, quindi qui non e'
      // riportata (sleeve_from_neck_cm e' solo informativo); il report di vestibilita' usa la misura presa sulla mesh 3D del capo.
    sku: "DRIVINGMATO-TEE-RED", title: "DrivingMato Tee", kind: "T-shirt", colorHex: "#d9d9e2", price: "42,00 €", asset: "drivingmato-tee",
    variants: [
      { size: "S",   stock: 10, spec: { chest_flat_cm: 55, length_cm: 69, sleeve_from_neck_cm: 39 }, fits: { chest: "88-96", height: "165-175" } },
      { size: "M",   stock: 14, spec: { chest_flat_cm: 57, length_cm: 71, sleeve_from_neck_cm: 40 }, fits: { chest: "94-102", height: "170-180" } },
      { size: "L",   stock: 9,  spec: { chest_flat_cm: 59, length_cm: 73, sleeve_from_neck_cm: 41 }, fits: { chest: "100-108", height: "175-185" } },
      { size: "XL",  stock: 6,  spec: { chest_flat_cm: 61, length_cm: 75, sleeve_from_neck_cm: 42 }, fits: { chest: "106-114", height: "180-190" } },
      { size: "2XL", stock: 3,  spec: { chest_flat_cm: 63, length_cm: 77, sleeve_from_neck_cm: 43 }, fits: { chest: "112-120", height: "185-195" } },
    ],
  },
];
