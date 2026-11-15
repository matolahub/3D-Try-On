# Integrare il Try-On in un e-commerce

Il Try-On è un **widget in iframe** con un **SDK di poche righe**. Il negozio non deve conoscere Three.js né il modello 3D:
passa i dati del prodotto e riceve eventi. Il Try-On non legge né analizza la pagina del negozio.

```
Pagina prodotto  ──(SDK)──►  iframe (widget)  ──►  corpo parametrico  ──►  capo 3D  ──►  viewer
   dati prodotto + taglia        misure del CORPO (inserite dall'utente)
   ◄── eventi: sizeChange, fit ──
```

**Perché iframe + SDK:** funziona con qualunque stack (React, Vue, Shopify, PHP…), isola il bundle 3D (~840 kB, si scarica solo
all'apertura) e gli stili, e si aggiorna senza toccare i negozi. L'SDK è un file JS senza dipendenze; per React c'è un wrapper sottile.

## Avvio rapido (qualsiasi stack)

```html
<script src="https://TRYON-HOST/sdk/tryon-sdk.js" crossorigin="anonymous"></script>
<button id="tryon">Prova su di te</button>
<script>
  document.getElementById("tryon").onclick = () =>
    TryOn.open({
      product: toTryOnProduct(shopProduct),     // vedi "Contratto dati"
      size: selectedSize,                       // taglia scelta nel negozio
      onSizeChange: (size) => selectSizeInShop(size),
      onFit: (e) => console.log(e.zones),       // es. { chest: { easeCm: 9, verdict: "regular" } }
    });
</script>
```

L'unico codice specifico da scrivere è `toTryOnProduct`: la traduzione del tuo prodotto nel contratto (esempio completo in
`frontend/demo-shop/shop.js`, circa 15 righe).

### React

```jsx
import { TryOnWidget } from "@tryon/sdk/react";     // npm i ../3D-Try-On/frontend/public/sdk   (o pacchetto pubblicato)

<TryOnWidget product={tryOnProduct} size={size} onSizeChange={setSize}
             widgetUrl="https://TRYON-HOST/embed.html" style={{ height: 640 }} />
```

Modale: `import { TryOn } from "@tryon/sdk/react"; TryOn.open({...})`. Tipi TypeScript inclusi (`tryon.d.ts`).

## Contratto dati v1

Il negozio passa un `product` con le sue `sizes`. **Ogni taglia porta le misure del CAPO** (`garmentMeasurements`).
Le misure del **corpo** dell'utente sono un'altra cosa: le inserisce l'utente nel widget (opzionalmente il negozio le precompila con `body`).

```ts
interface TryOnProduct {
  id: string | number;            // opaco per il Try-On
  name: string;
  category: "tshirt" | "hoodie";
  color?: string;                 // #rrggbb: colore del capo nel 3D (default del template se assente)
  images?: string[];              // URL http(s): solo anteprima nell'interfaccia
  sizes: TryOnSize[];             // almeno una
  units?: "cm";                   // v1: solo cm
}
interface TryOnSize {
  label: string;                  // univoca: "S", "M", ...
  garmentMeasurements: {...};     // misure del CAPO, cm  (sotto)
  bodyFit?: { chest?: [min,max], waist?: [min,max], hips?: [min,max], height?: [min,max] };  // misure del CORPO previste (solo per consigliare la taglia)
  available?: boolean;            // default true; le esaurite si possono provare ma non vengono consigliate
}
```

### Misure del capo (`garmentMeasurements`, in cm)

| Campo | Significato | Note |
|---|---|---|
| `chest` **oppure** `chestWidth` | torace: **giro completo** oppure **larghezza a piatto** ascella-ascella | **obbligatorio** uno dei due. `chestWidth` viene raddoppiato dal Try-On: nessuna conversione lato negozio |
| `length` | dal punto alto della spalla (attaccatura del collo) all'orlo | se assente: lunghezza del template, segnalata |
| `sleeve` | lunghezza manica fino al polsino | `sleeveFrom: "shoulder"` (default) oppure `"centerBack"`; se assente: template |
| `shoulder` | larghezza spalle da cucitura a cucitura | mostrata, non ancora usata nel fitting |
| `hem` / `hemWidth` | orlo (giro / a piatto) | se assente: taglio dritto (T-shirt) o orlo a costina (hoodie) |
| `waist` / `waistWidth` | vita (giro / a piatto) | solo per capi sagomati |
| `sleeveOpening`, `bicep` | giro dell'apertura manica / del bicipite | opzionali |

**Regole di validazione** (il widget rifiuta i dati non validi con un messaggio che spiega come correggere, e invia l'evento `error`):
valori numerici positivi (le stringhe numeriche "52,5" sono accettate); range plausibili; se `chest` è troppo piccolo per essere un
giro (es. 52 cm) l'errore suggerisce di usare `chestWidth`; `chest` e `chestWidth` insieme devono coincidere; etichette taglia uniche.
I campi sconosciuti generano un avviso, non un errore (compatibilità con versioni future).

Le misure **mancanti non vengono inventate**: il fitting usa il template e nell'interfaccia sono marcate `template`
(le misure del negozio sono marcate `negozio`, quelle ricavate con una regola dichiarata `derivato`).

### Misure del corpo (le inserisce l'utente)

`chest`, `waist`, `hips` (circonferenze) e `height`, in cm. Restano **nel browser dell'utente**: non vengono inviate al negozio né a un
server. A ogni apertura il widget riparte dalle misure di partenza (corpo base): quelle di una visita precedente non vengono ricaricate. Il negozio può precompilarle con `body` (es. dal profilo) e, solo con `shareBody: true`
esplicito, riceverle nell'evento `bodyChange`.

## API dell'SDK

| | |
|---|---|
| `TryOn.open(options)` | apre il Try-On in un modale (Esc, click fuori, ×). Ritorna il controller + `close()` |
| `TryOn.mount(container, options)` | incorpora il widget nell'elemento (altezza: `height`, default 100%) |
| `TryOn.configure({ widgetUrl })` | URL del widget se l'SDK è incluso da un bundler (con il tag script è dedotto) |
| controller | `setSize(label)`, `setProduct(product, size?)`, `setBody(body)`, `on(evento, fn)` → unsubscribe, `destroy()` |

Opzioni: `product`, `size`, `body`, `widgetUrl`, `height`, `shareBody`, `title` e i callback `onReady`, `onInitialized`, `onSizeChange`, `onFit`, `onBodyChange`, `onError`, `onClose`.

**Sincronizzazione della taglia (due vie):** il selettore del negozio chiama `controller.setSize(label)`; se l'utente cambia taglia nel
widget, il negozio riceve `onSizeChange(label)` e aggiorna il proprio selettore.

**Evento `fit`:** `{ productId, size, zones: { chest: { easeCm, verdict }, hem, ... }, recommendedSize }`. Contiene solo l'esito della
vestibilità (verdetto: `stretto | aderente | regular | morbido | oversize`), mai le misure del corpo.

## Protocollo postMessage v1 (per chi non usa l'SDK)

Envelope: `{ ns: "tryon", v: 1, from: "host" | "widget", type, payload }`.

- host → widget: `init { product, size?, body?, options?: { shareBody } }`, `setSize { size }`, `setProduct { product, size? }`, `setBody { body }`
- widget → host: `ready { protocol }`, `initialized { productId, size, recommendedSize, warnings }`, `sizeChange { size, source }`,
  `fit {...}`, `bodyChange { body }` (solo con `shareBody`), `error { code, message, details? }`

Il widget invia `ready` al caricamento; l'host risponde con `init`. Codici di errore: `invalid_product`, `model_load_failed`, `version_mismatch`
(e, lato SDK, `widget_unreachable`, `post_failed`).

## Sicurezza e privacy

- Il widget accetta messaggi **solo dalla finestra genitore**; dopo `init` solo dall'origine che l'ha inviato, e risponde solo a quella.
  Il messaggio `ready` (che non contiene dati) è l'unico inviato a `*`.
- **Elenco di origini consentite:** in produzione compila `VITE_TRYON_ALLOWED_ORIGINS="https://negozio.it,https://www.negozio.it"`
  al build del widget: `init` da altre origini viene rifiutato. Configura anche `Content-Security-Policy: frame-ancestors <origini>` sul server del widget.
- L'SDK crea l'iframe con `sandbox="allow-scripts allow-same-origin"` (niente navigazione della pagina, popup, form) e accetta messaggi solo dall'iframe e dall'origine del widget.
- Servi `/sdk/*` con `Access-Control-Allow-Origin: *` (sono file pubblici): serve per `crossorigin="anonymous"` e con il server di sviluppo di Vite è obbligatorio.
- Il Try-On non fa richieste di rete verso il negozio e non memorizza dati sul server.

## Hosting

```bash
cd frontend && npm run build          # dist/: embed.html + assets (widget e modello 3D) + sdk/
```
Servi `dist/` su un host statico (es. `https://tryon.tuodominio.it`): `embed.html` è il widget, `sdk/tryon-sdk.js` lo script per i negozi
(`sdk/tryon-sdk.mjs` per gli import ESM). Il sorgente dell'SDK è `public/sdk/tryon-sdk.mjs`: dopo averlo modificato esegui `npm run build:sdk`
per rigenerare lo script classico (un test verifica che non divergano).

## Provare l'integrazione in locale

```bash
cd frontend
npm run dev        # widget su http://localhost:5173
npm run demo       # negozio di esempio su http://localhost:5174  (origine diversa: prova cross-origin vera)
npm test           # contratto, fitting, protocollo, SDK
```
Il negozio demo ha un proprio modello dati (nomi e unità propri) e lo traduce con un adattatore: è il riferimento per il tuo e-commerce.

## Limiti dell'MVP

- Solo `tshirt` e `hoodie`, un solo corpo maschile calibrato in cm (petto, vita, fianchi, altezza).
- Il capo è un template parametrico che segue il corpo (nessuna simulazione cloth): il capo largo non drappeggia.
- Resa: colore. Le immagini prodotto sono mostrate come anteprima ma non usate come texture (lo scopo del campo `images` in v1).
- L'orlo non scende sotto l'inguine (lo segnala il report). Cappuccio semplificato, nessuna tasca/cuciture.
- La larghezza spalle del corpo non è calibrata: `shoulder` del capo è mostrato ma non confrontato.
