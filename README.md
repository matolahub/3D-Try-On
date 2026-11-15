# 3D Try-On

Servizio di prova virtuale di **T-shirt e hoodie** su un corpo 3D parametrico, calibrato in centimetri reali. Si integra nella pagina
prodotto di un e-commerce: il negozio passa prodotto, taglia e misure del capo; l'utente inserisce le proprie misure e vede il capo sul suo modello,
cambiando taglia e misure in tempo reale. Il Try-On **non** legge né analizza le pagine del negozio.

```
E-commerce ──(SDK)──► widget (iframe) ──► corpo parametrico ──► capo 3D ──► viewer Three.js
  prodotto + taglia + misure del CAPO         misure del CORPO (le inserisce l'utente)
```

Guida di integrazione, contratto dati e sicurezza: **[docs/integration.md](docs/integration.md)**.
Manuale operativo per creare e mantenere i capi 3D (anche per agenti AI): **[VIRTUAL_TRYON_PLAYBOOK.md](VIRTUAL_TRYON_PLAYBOOK.md)**.

## Avvio (sviluppo)

```bash
cd frontend && npm install
npm run dev       # widget:                 http://localhost:5173/embed.html   (sviluppo: /demo-shop/ e /sdk/)
npm run demo      # negozio di esempio:     http://localhost:5174               (origine diversa, come in produzione)
npm test          # contratto dati, fitting, protocollo postMessage, SDK
```

## Struttura

| Percorso | Ruolo |
|---|---|
| `frontend/src/core/` | motore Three.js indipendente dal framework (`engine.js`), misure del corpo (`bodyMeasures.js`), contratto dati (`contract.js`) |
| `frontend/src/core/garment/` | capo 3D reale legato al corpo (`asset.js`, `bound.js`), capo parametrico (`mesh.js`, `drape.js`), fitting e report di vestibilità (`fit.js`) |
| `frontend/src/embed/` | interfaccia del widget (React) e protocollo `postMessage` |
| `frontend/public/sdk/` | **SDK per gli e-commerce**: `tryon-sdk.js` (script/CommonJS), `tryon-sdk.mjs` (ESM, sorgente), `react.mjs`, tipi TypeScript |
| `frontend/demo-shop/` | negozio di esempio con un proprio modello dati e l'adattatore verso il contratto |
| `blender/` | corpo calibrato (`scripts/`, `build_body.sh`, `man-model.blend`); **`garment/`**: pipeline dei capi 3D reali (`build_all.sh`), vedi `blender/garment/README.md`; `tools/`: contact sheet e confronti; `out/`: risultati (non versionati) |
| `assets/products/` | sorgenti dei prodotti con capo 3D reale (foto, tabella taglie, texture) |
| `frontend/src/bodyCalibration.json` | calibrazione del corpo (cm → shape key), generata da `blender/scripts/build_shape_keys.py` |
| `docs/integration.md` | contratto dati v1, SDK, protocollo, sicurezza, hosting |

## Corpo calibrato

Petto, vita, fianchi e altezza (cm reali) pilotano quattro shape key del modello, con errore ≤ 0,1 cm misurato sulla mesh, anche in combinazione.

```bash
sh blender/build_body.sh      # shape key -> verifica delle misure -> GLB -> contact sheet (circa 1 minuto)
```

- **Forma anatomica, non fasce.** I tre morph di circonferenza sono parti dello stesso campo di spostamento, preso dai target macro di
  MakeHuman (corpi interi disegnati su riferimenti anatomici, licenza CC0; il nostro corpo è la mesh base di MakeHuman, stesso ordine dei
  vertici). Il campo usato è `minmuscle-maxweight − averagemuscle-averageweight` (sul nostro corpo: +30 / +48 / +34 cm su petto / vita / fianchi,
  cioè l'ordine di grandezza degli slider: nessuna estrapolazione); il petto è un misto 60/40 con `maxmuscle-maxweight` (un torace che cresce
  da solo è soprattutto massa). Tre finestre lisce che si sommano a 1 lo assegnano alle tre misure: insieme ricostruiscono il corpo intero del
  riferimento, da sole sfumano con continuità. Dettagli in `blender/scripts/bodyspec.py` e `extract_mh_reference.py`; il riferimento estratto è
  nel repository (`blender/scripts/data/mh_reference.npz`), MakeHuman serve solo per rigenerarlo.
- **Braccia**: appartengono al petto (non vengono trascinate dalla vita); a petto massimo ruotano in fuori di 8° attorno alla spalla e la faccia
  interna si appiattisce contro il dorso (nessuna compenetrazione in nessuna combinazione).
- **Verifica**: `blender/scripts/measure_body.py` (84 controlli: sweep, indipendenza, combinazioni, compenetrazioni) e
  `python3 blender/tools/body_sheet.py` (contact sheet: neutro, estremi singoli, atletico / sovrappeso / magro e alto) in `blender/out/body/`.
- **Limite noto**: gli slider sono indipendenti, quindi si possono chiedere corpi che non esistono (vita 120 con petto 95 e fianchi 96). La
  forma resta liscia ma non è credibile: la circonferenza dei fianchi deve restare 96 proprio dove una pancia vera scenderebbe. I range non
  sono stati ristretti perché ogni estremo è credibile insieme agli altri (tutto al massimo = corpo obeso del riferimento).

## Capi

- **Capo 3D reale** (prodotti con `asset`): una cloth sim per taglia in Blender dal cartamodello ricavato da foto e tabella taglie, adattata al
  corpo dell'utente a runtime da `frontend/src/core/garment/bound.js` (il giro del tessuto è conservato: se il corpo è più grande del capo, il
  capo è teso e il report dice «stretto»). Pipeline, criteri misurati, provenienza di ogni dato e dati mancanti: **[blender/garment/README.md](blender/garment/README.md)**.
  Il report di vestibilità usa le misure prese sulla mesh dell'asset (`tee-<taglia>.json`, chiave `measured`), non quelle copiate dal negozio.
- **Capo parametrico** (prodotti senza asset, hoodie): shell e gonna costruite a runtime sul corpo dalle misure del negozio (`mesh.js`, `drape.js`).

## Misure del capo vs misure del corpo

Sono sempre distinte: il negozio fornisce solo le **misure del capo** per taglia (`garmentMeasurements`); le **misure del corpo** le inserisce l'utente
nel widget e restano sul suo dispositivo. Ogni misura del capo ha una provenienza (`negozio`, `derivato`, `template`): quelle mancanti non vengono
mai presentate come dati del negozio.

## Codice precedente (non più usato)

Il primo approccio faceva estrazione da URL con scraping. È stato accantonato, non cancellato:
`backend/` (FastAPI: estrazione e size chart, con test) e `frontend/legacy-scraping/` (vecchio pannello e scena monolitica). Non fanno parte del
flusso attuale e possono essere rimossi.
