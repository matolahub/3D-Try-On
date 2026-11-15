// Template parametrici dei capi. Tutti i valori sono DEFAULT DEL TEMPLATE, non dati del prodotto:
// vengono usati solo quando la size chart non fornisce la misura e sono sempre segnalati come tali (origin "template").
//
// Convenzioni: misure in cm; "circonferenza" = giro completo (non larghezza a piatto).
// Livelli verticali come frazione dell'altezza del corpo base (stessi livelli usati per la calibrazione del corpo).
//
// Un template descrive l'ASSET del capo: dimensioni di riferimento, forma del collo, comportamento del tessuto (drappeggio).
// La mesh che ne deriva e' costruita a runtime da garment/mesh.js adattandosi al corpo (vedi garment/drape.js per le regole).

export const LEVELS = {
  hips: 0.52,          // livello di misura dei fianchi
  waist: 0.635,
  chest: 0.75,
  armpit: 0.785,       // ascelle: sopra il capo poggia sul corpo (spalle), sotto pende
  shoulder: 0.815,     // punto della spalla (acromion)
  neck: 0.855,         // punto alto della spalla (HPS, dove il collo si stacca dalla spalla): riferimento della lunghezza del capo
  crotch: 0.49,        // cavallo
  minHem: 0.38,        // limite inferiore rappresentabile per l'orlo (meta' coscia)
};

// Comportamento del tessuto (distanze in metri). Valori scelti a occhio su jersey di cotone: sono i parametri da tarare.
const DRAPE = {
  kappa: 0.08,         // rientro massimo del tessuto scendendo, per metro (0 = cade perfettamente in verticale)
  lateral: 0.5,        // quanto dell'eccesso di tessuto va ai fianchi rispetto a davanti/dietro (0..1)
  foldGain: 0.8,       // ampiezza delle pieghe = ease medio del capo (raggio) x foldGain, fino a foldMax
  foldMax: 0.032,
  foldWave: 0.085,     // lunghezza d'onda delle pieghe attorno al busto
  foldTilt: 2.0,       // inclinazione delle pieghe scendendo (rad/m): convergono verso l'ascella
  relax: 10,           // passate di rilassamento verticale: il tessuto teso e' piu' liscio del corpo che copre
  hullBlend: 0.05,     // sotto il torace il tessuto passa gradualmente dalla superficie del corpo al guscio convesso in questi metri
  foldStart: 0.04,     // le pieghe iniziano a questa distanza sotto la linea del torace...
  foldFull: 0.16,      // ...e sono a pieno regime oltre questa
  foldShade: 0.28,     // quanto si scuriscono le valli delle pieghe (occlusione ambientale approssimata)
  hemWave: 0.6,        // quanto l'orlo segue le pieghe (le creste pendono piu' in basso)
  hemSideRise: 0.02,   // l'orlo di un capo ampio sale ai fianchi
  hemBackDrop: 0.012,  // e scende leggermente dietro (coda)
};

export const TEMPLATES = {
  tshirt: {
    id: "tshirt",
    label: "T-shirt",
    chestEase: 22,               // cm: ease aggiunto alla misura corpo quando la tabella e' "corpo" (vestibilita' regular)
    hemRatio: 0.96,              // orlo = torace (taglio dritto) se manca la misura dell'orlo
    hemBodyEase: null,
    hemLevel: 0.515,             // orlo di default: alla linea dei fianchi
    shoulderEase: 1.8,           // cm di ease sulle spalle (il capo poggia sulle spalle)
    shoulderWidth: 52,           // cm: solo per convertire "manica dal centro schiena" in "manica dalla spalla"
    sleeve: { length: 26, topEase: 14, openingEase: 16, looseFollow: 0.4, sag: 0.55 },   // looseFollow: quanto l'ease del capo oltre il regular allarga la manica; sag: caduta del tessuto sotto il braccio
    thickness: 0.35,             // cm di spessore del tessuto
    verdicts: [0, 6, 14, 22],    // ease al torace: <0 stretto, <6 aderente, <14 regular, <22 morbido, oltre oversize
    hood: false,
    bands: { hem: { width: 0.016, thickness: 0.004 }, sleeve: { width: 0.014, thickness: 0.004 } },   // orlo e fine manica rifiniti (m)
    panels: true,                // costruita a pannelli (busto + maniche + colletto), non dai triangoli del corpo
    neckline: { front: 0.03, back: 0.01, gap: 0.03, epsTop: 0.008, blend: 0.012, collar: { width: 0.026, thickness: 0.009 } },   // girocollo circolare (m): scollatura davanti/dietro, distanza dal collo, colletto a costina
    drape: { ...DRAPE, foldWave: 0.11, foldMax: 0.026, hemSideRise: 0.03, hemBackDrop: 0.02, hemWave: 0.4 },
    color: "#7d8aa0",
  },
  hoodie: {
    id: "hoodie",
    label: "Hoodie",
    chestEase: 14,
    hemRatio: null,
    hemBodyEase: 4,              // orlo a costina: poco piu' largo del corpo all'altezza dell'orlo
    hemLevel: 0.515,
    shoulderEase: 1.5,
    shoulderWidth: 48,
    sleeve: { length: Infinity, topEase: 8, openingEase: 0.5, looseFollow: 0, sag: 0 },   // maniche lunghe fino al polso, polsino aderente
    thickness: 0.6,
    verdicts: [2, 8, 18, 26],
    hood: true,
    neckline: null,              // il collo della hoodie e' il cappuccio
    drape: { ...DRAPE, foldMax: 0.025 },
    color: "#6b7280",
  },
};

export function templateFor(category) {
  return TEMPLATES[category] || null;
}
