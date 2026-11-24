# Virtual Try-On — Manuale operativo e tecnico

Manuale di trasferimento delle conoscenze per chi (persona o agente AI) deve creare un nuovo capo 3D, adattarlo al corpo, correggere un
difetto o estendere il sistema **senza aver partecipato allo sviluppo**. Descrive il progetto com'è, non il Virtual Try-On in generale.

Legenda usata in tutto il documento:

- **[VERIFICATO]** procedura o fatto implementato e controllato (script, test o misura).
- **[CONSIGLIATO]** buona pratica non ancora implementata o non verificata.
- **[FUTURO]** sviluppo possibile, non iniziato.
- **[MANCANTE]** informazione che il repository non contiene.

Stato di riferimento: novembre 2026, tre prodotti (Grillz Tee, Kermit Tee, DrivingMato Tee), taglie S–2XL, `npm test` 74/74.

## Indice

1. [Il progetto in 5 minuti](#1-il-progetto-in-5-minuti)
2. [Prima di toccare qualcosa: procedura di orientamento](#2-prima-di-toccare-qualcosa-procedura-di-orientamento)
3. [Architettura e directory](#3-architettura-e-directory)
4. [Creazione del modello 3D di un capo](#4-creazione-del-modello-3d-di-un-capo)
5. [Armonizzazione del capo con il corpo](#5-armonizzazione-del-capo-con-il-corpo)
6. [Pipeline operativa: nuovo prodotto in 9 fasi](#6-pipeline-operativa-nuovo-prodotto-in-9-fasi)
7. [Standard qualitativi e validazione](#7-standard-qualitativi-e-validazione)
8. [Parametri di riferimento](#8-parametri-di-riferimento)
9. [Troubleshooting: difetti già incontrati e soluzioni](#9-troubleshooting-difetti-già-incontrati-e-soluzioni)
10. [Regole per agenti con risorse limitate](#10-regole-per-agenti-con-risorse-limitate)
11. [Esempi di riferimento](#11-esempi-di-riferimento)
12. [Manutenzione ed evoluzione](#12-manutenzione-ed-evoluzione)
13. [Informazioni mancanti e limiti noti](#13-informazioni-mancanti-e-limiti-noti)
14. [Pubblicazione online gratuita](#14-pubblicazione-online-gratuita)

---

## 1. Il progetto in 5 minuti

**Cosa fa.** Un e-commerce incorpora un widget (iframe). Il negozio passa prodotto, taglia e misure del capo; l'utente inserisce petto, vita,
fianchi e altezza; il widget mostra il capo su un corpo 3D parametrico e un report di vestibilità.

**Cosa NON è.** Non c'è Computer Vision a runtime: nessuna foto dell'utente, nessuna stima di posa, nessuna composizione 2D. Il corpo è una
mesh con 4 shape key calibrati in centimetri. Il capo è una mesh 3D vera. Tutta la «elaborazione di immagini» avviene offline e riguarda
solo la **foto del prodotto**, usata per misurare il taglio e come texture.

**Le due metà del sistema.**

```
OFFLINE (Blender + Python)                                   RUNTIME (browser, Three.js)
foto prodotto + tabella taglie + scheda                      corpo: man-model.glb + 4 shape key (cm reali)
   │ pattern.py        cartamodello 2D graduato              capo:  tee-<taglia>.glb (drappeggiato sul corpo NEUTRO)
   │ prep_texture.py   texture davanti / retro                  │ bound.js   adatta il capo al corpo dell'utente
   │ build_tee.py      cloth sim + rifinitura + colletto        │ engine.js  scena, luci, ombre
   │ check_tee.py      criteri misurati                         │ fit.js     report di vestibilità
   ▼                                                            ▼
frontend/public/assets/garments/<prodotto>/tee-<taglia>.glb + .json      widget (EmbedApp.jsx) dentro il negozio
```

**Idea centrale da non perdere.** Si fa **una sola cloth sim per taglia, sul corpo neutro**. Per ogni altro corpo il capo NON viene
risimulato e NON ha shape key: `bound.js` lo ricalcola dalla forma vera del corpo (§5). La sim diretta su un corpo molto diverso dal neutro
è stata provata ed è inaffidabile (petto 120: capo accartocciato).

**Tecnologie.** Blender 4.5 LTS in batch (`-b`), Python 3.9 di sistema con numpy, opencv-python, Pillow; Node 22, Vite 8, Three.js 0.183,
React 19 (solo interfaccia del widget). Nessuna dipendenza va aggiunta senza motivo.

---

## 2. Prima di toccare qualcosa: procedura di orientamento

Esegui nell'ordine. Tempo: circa 10 minuti. Non saltare il passo 4.

1. Leggi questo file fino al §5.
2. Leggi `blender/garment/README.md` (provenienza di ogni misura, taratura del tessuto, limiti misurati). È la fonte di dettaglio: questo
   manuale non lo duplica.
3. Leggi l'intestazione (commento iniziale) di: `blender/garment/products.py`, `blender/garment/pattern.py`,
   `blender/garment/build_tee.py`, `frontend/src/core/garment/bound.js`. Non leggere i file interi: sono lunghi.
4. Verifica che il punto di partenza sia sano:

```bash
cd frontend && npm test          # atteso: 74 pass, 0 fail
```

```bash
cd frontend && npx eslint .      # atteso: nessun output
```

5. Guarda lo stato dei capi installati:

```bash
grep -h "^CHECK\|  FAIL" blender/out/garment/check_*.log blender/out/garment/*/check_*.log
```

   Se `blender/out/` non esiste (non è versionata), gli archivi `.npz` vanno rigenerati con un bake completo (§6, fase 5).
6. Avvia il viewer e guarda un capo **con il corpo di partenza del widget**, non col neutro esatto:

```bash
cd frontend && npm run dev       # poi apri /lab.html?asset=grillz-tee&size=M&body=95,79,96,173
```

**Vincoli permanenti del committente** (non negoziabili senza chiedere):

- Lingua di lavoro e dei commenti: italiano.
- Nessun commit né push se non richiesto.
- Non modificare `backend/`, `frontend/public/sdk/`, `frontend/src/embed/protocol.js` né il contratto dati (`frontend/src/core/contract.js`).
- Non inventare dati mancanti: marcarli come ASSUNTO/MANCANTE in `products.py` (finiscono nel JSON di ogni taglia) e chiederli.
- Un parametro alla volta; bake lunghi in background con log su file; controllare che il processo esista prima di dire «in corso».
- Non rompere ciò che funziona: ogni prova si fa in sandbox (§6, fase 5), mai direttamente sugli asset installati.

---

## 3. Architettura e directory

| Percorso | Contenuto | Si modifica? |
|---|---|---|
| `assets/products/<cartella>/source/` (o `Source/`) | foto del davanti, `tabella_taglie.csv` o `size-chart.md`, scheda `*detail*.md` | sì, dati del negozio |
| `assets/products/<cartella>/textures/` | `front.png`, `back.png`, `mask.png` generati da `prep_texture.py` | no, sono generati |
| `blender/man-model.blend` | corpo + armatura + shape key | solo via `blender/build_body.sh` |
| `blender/scripts/` | costruzione e misura del corpo | raramente |
| `blender/garment/` | **pipeline dei capi** (tabella sotto) | sì |
| `blender/tools/` | contact sheet e misure di controllo (tabella §7.3) | sì |
| `blender/out/` | risultati, log, archivi `.npz`, sandbox. **Non versionata** | generata |
| `frontend/public/assets/garments/<id>/tee-<taglia>.glb` + `.json` | capi installati | solo via `install.sh` |
| `frontend/public/assets/man-model.glb` | corpo per il browser | solo via `build_body.sh` |
| `frontend/src/bodyCalibration.json` | curva cm → influence per ogni shape key | generato |
| `frontend/src/core/` | motore (`engine.js`), corpo (`bodyMeasures.js`), contratto (`contract.js`) | con cautela |
| `frontend/src/core/garment/` | `bound.js` (adattamento), `asset.js` (caricamento GLB), `assets.js` (registro), `fit.js` (report), `mesh.js`/`drape.js` (capo parametrico di ripiego) | con cautela |
| `frontend/src/embed/` | interfaccia del widget wearIT (`EmbedApp.jsx`, stile e design system in `wearit.css`) e protocollo | solo interfaccia |
| `frontend/src/lab/lab.js` + `frontend/lab.html` | pagina di sviluppo per ispezionare un capo | sì |
| `frontend/demo-shop/` | negozio di esempio (catalogo in `products.js`) | sì |
| `frontend/scripts/deform-asset.mjs` | applica `bound.js` offline a un GLB | sì |
| `docs/integration.md` | contratto dati, SDK, sicurezza | solo se cambia il comportamento |
| `docs/reference/` | contact sheet di riferimento (§11) | rigenerabili |

File della pipeline dei capi (`blender/garment/`):

| File | Ruolo |
|---|---|
| `products.py` | **unico punto in cui si descrive un prodotto**: tabella taglie, taglio misurato sulla foto, calibrazione della foto, scheda, assunzioni |
| `pattern.py` | cartamodello 2D: pezzi, catene, cuciture, graduazione, UV dalla foto |
| `prep_texture.py` | texture davanti (colore esteso oltre la sagoma) e retro segnaposto |
| `build_tee.py` | cloth sim, rifinitura, colletto, strati, export GLB + JSON + archivio `.npz` |
| `check_tee.py` | criteri di accettazione misurati sulla mesh finale; scrive `measured` e `checks` nel JSON |
| `build_all.sh` | bake di tutte le taglie di un prodotto direttamente negli asset (usare solo per un prodotto nuovo o quando tutto è già validato) |
| `sandbox.sh` | una taglia in sandbox (`blender/out/eval/work/<tag>/`) senza toccare gli asset |
| `refinish_all.sh` | sola rifinitura (niente sim, ~30 s a taglia) di più taglie in sandbox |
| `bake_install.sh` | bake completo di più taglie, staccato dalla sessione, con installazione di ogni taglia appena pronta |
| `install.sh` | copia dalla sandbox agli asset, con backup automatico |

**Convenzioni di naming.** Id prodotto in minuscolo con trattini (`kermit-tee`); file `tee-<taglia>.glb` e `tee-<taglia>.json`; archivi
`tee_<taglia>_sim.npz` (posizioni della sim) e `tee_<taglia>_build.npz` (mesh finale, per i controlli). Coordinate Blender: metri, Z in
alto, fronte verso −Y, +X = sinistra del corpo. Nel browser: Y in alto, fronte verso +Z, modello scalato a 2 unità di altezza.

---

## 4. Creazione del modello 3D di un capo

Il capo **non si modella a mano**. Si descrive come cartamodello e lo si fa cadere sul corpo con una cloth sim. Questo garantisce che le
misure della mesh siano quelle della tabella taglie, cosa che la modellazione a mano non garantisce.

### 4.1 Dalla foto al cartamodello [VERIFICATO]

1. **Scala della foto** = larghezza del petto in pixel / petto di tabella della taglia base (S). Esempi: Grillz 776 px / 55,5 cm =
   13,98 px/cm; Kermit 1269 / 59; DrivingMato 538 / 55. Va scritta in `photo.K`.
2. **Riferimento**: origine sulla linea del punto alto della spalla (HPS), al centro; x verso destra nella foto; y verso il basso; cm.
3. **Misure dalla tabella** (fonte primaria, per taglia): petto, lunghezza, spalla, manica.
4. **Misure dalla foto** (solo taglia base, poi scalate col petto): semi-larghezza e profondità dello scollo, larghezza della costina,
   pendenza della spalla, curva del giromanica (o cucitura raglan), punta e fondo manica, profondità dell'ascella.
5. Se la scala della foto cambia dopo aver misurato (es. arriva la tabella vera), non rimisurare: usare `_scale_cut(taglio, fattore)` in
   `products.py`.
6. **La foto è un mockup e può essere sbagliata.** Lunghezze misurate sulla foto contro tabella: Grillz 66,4 vs 70; Kermit 67,3 vs 70;
   DrivingMato 73,6 vs 69. **Vale sempre la tabella**; la parte liscia sotto la stampa viene allungata o accorciata nelle UV.
7. Controllo obbligatorio: il cartamodello deve coincidere con la tabella per costruzione.

```bash
TRYON_PRODUCT=kermit-tee python3 blender/garment/pattern.py     # ogni cella deve essere "valore/valore" uguali
```

### 4.2 Tipologie di capo supportate

| Costruzione | `style` | Pezzi | Note |
|---|---|---|---|
| Spalla scesa, manica a giro | `set_in` | davanti, dietro, 2 maniche | Grillz, Kermit. La manica è la metà visibile nella foto più la sua riflessa sulla piega |
| Raglan | `raglan` | davanti, dietro, 2 maniche che salgono al colletto | DrivingMato. La manica porta la sua parte di costina; davanti e dietro della manica non sono uguali |
| Hoodie, felpe, altro | — | — | **[FUTURO]** oggi solo capo parametrico (`mesh.js`), nessun asset reale |

Orlo e polsini: `hem_fold > 0` crea il risvolto ribattuto (strato interno); `hem_fold = 0` è il taglio vivo (Kermit).

### 4.3 Mesh e topologia [VERIFICATO]

- Triangoli, passo 1,2 cm, reticolo esagonale simmetrico; cuciture come coppie di vertici con lo stesso numero di punti per catena.
- Mesh finale: 9.200–11.000 vertici a taglia, GLB 0,6–1,2 MB (texture JPEG qualità 90 incluse).
- Simmetria esatta sinistra/destra: la metà destra è lo specchio della sinistra (pieghe vere, non una media).
- I triangoli degeneri del cartamodello (tre vertici allineati sul bordo, es. linea della spalla tra colletto e spalla) restano nella sim ma
  **vanno esclusi dal mesh esportato**: nel capo finale sono lame.

### 4.4 Colletto [VERIFICATO] — la parte più delicata

La cloth sim non sa fare una costina: la arriccia. Il colletto viene **ricostruito in rifinitura** (`rebuild_collar` + `collar_grid`):

1. La cucitura dello scollo (anello chiuso) viene resa una curva regolare tenendo le prime 3 armoniche di Fourier.
2. Se il collo del corpo è più grosso dell'apertura, lo scollo si allarga quanto basta perché la costina stia stesa (obiettivo 50°), con la
   cucitura al massimo l'8% più lunga del cartamodello. Il valore effettivo è in `neckline` nel JSON.
3. Profilo della fascia in 4 tratti, dalla cucitura verso il collo: ogni tratto parte a 25° sull'orizzontale e, dove entrerebbe nel corpo,
   si appoggia alla pelle a 4 mm. Poi ogni fila viene lisciata lungo l'anello e resa simmetrica.
4. Lo strato visibile è un **guscio a griglia** (4 file × 3 colonne per lato di cucitura): faccia esterna a `collar_mm`, smussata alla
   cucitura (35% e 85% dello spessore nei primi due tratti), bordo arrotondato verso il collo, faccia interna 0,6 mm sopra il profilo.
5. I triangoli del pezzo dentro la fascia vengono tolti dal mesh esportato.
6. La fascia si ricostruisce **per ultima**, dopo aver riportato le lunghezze al cartamodello; se crea auto-intersezioni viene scartata e
   resta quella della prima passata (riga `SCARTATO` nel log: è previsto, non è un errore).

Cosa NON fare: tratti rigidi inclinati (si staccano dal collo ai lati), offset dei triangoli grossi del pezzo (texture a zig-zag, bordo
irregolare), gradino verticale alla cucitura (attraversa il tessuto della spalla), lembo nascosto sotto il tessuto (provato: crea centinaia
di intersezioni).

### 4.5 Texture, colori, stampe [VERIFICATO]

- **Davanti**: la foto stessa, mappata 1:1 sul cartamodello della taglia base. Fuori dalla sagoma il colore viene esteso, così i bordi della
  mesh non prendono lo sfondo.
- **Sagoma**: se la foto ha il canale alpha usare `mask='alpha'` (soglia ≥ 250). `mask='white_bg'` solo per foto senza trasparenza. Errore
  già fatto: con `white_bg` su una foto con alpha, lo sfondo trasparente (nero) e l'alone colorato attorno al capo entravano nella texture.
- **Costina**: campiona solo la fascia centrale della costina fotografata (dal 20% al 75% della larghezza). Oltre il bordo interno la foto
  mostra l'interno del retro: sul capo sembrava uno scollo a V.
- **Raglan**: la manica campiona sempre dalla propria parte della cucitura, con margine 2,5 cm (`Garment.sample_point`). Le foto non sono
  simmetriche: sulla DrivingMato il confine tra i colori sta circa 2 cm oltre la cucitura a destra. Il busto resta com'è nella foto:
  spostarne il campionamento rende il confine a denti.
- **Altre taglie**: stessa foto scalata in larghezza col petto; la grafica scala col petto (ASSUNTO).
- **Retro**: segnaposto finché manca la foto. Colore di fondo riga per riga, letto nelle fasce laterali del davanti senza grafica, più la
  sola grana del tessuto. Non ripetere a piastrelle la zona liscia: lascia righe orizzontali.
- **Materiale**: Principled, roughness 0,92, non metallico, doppia faccia. Colore per vertice 0,88–0,97 sulle cuciture.

### 4.6 Tessuto e pieghe [VERIFICATO]

Le pieghe vengono dalla sim, mai da rumore aggiunto. La taratura (unità della cloth sim di Blender, non fisiche) è in §8.1. Regola della
grammatura (`fabric_overrides`): massa ∝ gsm, flessione ∝ gsm², rispetto a 250 gsm. È una regola dichiarata, non misurata su una prova di
caduta: l'effetto (350 gsm più rigido e con meno pieghe) è stato solo verificato a occhio.

### 4.7 Cosa deve restare fedele al prodotto

| Caratteristica | Come è garantita | Verifica |
|---|---|---|
| Petto, orlo, lunghezza, manica, spalla | cartamodello dalla tabella + rifinitura | `check_tee.py` |
| Forma dello scollo e della costina | misure dalla foto + ricostruzione del colletto | vista ravvicinata nel viewer |
| Tipo di manica e cuciture | `style` + catene del cartamodello | viewer, davanti e dietro |
| Colore, stampa, contrasti | texture dalla foto | viewer |
| Orlo ribattuto o a taglio vivo | `hem_fold` | viewer |
| Peso del tessuto | regola della grammatura | confronto affiancato (§7.3) |

---

## 5. Armonizzazione del capo con il corpo

### 5.1 Il corpo [VERIFICATO]

- 4 misure in cm reali: petto 80–130 (neutro 95,18), vita 65–120 (78,55), fianchi 84–124 (96,2), altezza 155–200 (173,44).
- La curva cm → influence di ogni shape key è **misurata sulla mesh** e sta in `frontend/src/bodyCalibration.json`. Non scriverla a mano.
- Livelli anatomici come frazione dell'altezza (`LEVELS` in `templates.js`): fianchi 0,52; vita 0,635; petto 0,75; ascella 0,785; spalla
  0,815; HPS 0,855.
- Posa: «naturale», braccia a circa 18° dalla verticale. Per la sim il corpo alza le braccia all'angolo della manica del cartamodello e poi
  le riabbassa.

### 5.2 Vestizione offline (cloth sim) [VERIFICATO]

1. Corpo neutro con le braccia all'angolo della manica: i pezzi stesi combaciano senza tensioni.
2. Davanti e dietro piani ai due lati del busto, maniche a U sopra le braccia; molle di cucitura fino a scarto ≤ 4 mm.
3. Saldatura delle cuciture, lunghezze riportate al cartamodello.
4. Le braccia scendono in due tempi (sosta a 14° dalla posa naturale) e il tessuto si assesta: 50 + 50 + 30 + 15 + 70 fotogrammi.
5. Rifinitura numerica: levigatura lungo la normale, simmetria, lunghezze = cartamodello con il corpo come vincolo, distanza minima 4 mm,
   colletto, giro dell'orlo riportato al cartamodello, strati (costina, risvolti).

### 5.3 Adattamento a runtime (`bound.js`) [VERIFICATO]

Tre regole per zona, sfumate tra loro. Con il corpo neutro il risultato è esattamente la sim.

| Zona | Regola |
|---|---|
| Spalle, trapezio, colletto (`follow`) | il tessuto segue la pelle sottostante |
| Busto sotto l'ascella | pende dalle spalle: raggio = corpo «drappeggiato» (guscio convesso, rientro massimo `KAPPA`) + `s` × ease della sim |
| Maniche | nel riferimento del braccio (spalla → gomito), conservando il giro della manica |

`s` è scelto fetta per fetta perché **il giro del tessuto resti quello della sim**: corpo più grande → `s` < 1, le pieghe si consumano;
`s` = 0 → capo teso, segnalato «stretto» nel report. Con l'altezza il capo sale con le spalle e non si allunga.

Passi che rendono il risultato credibile (tutti necessari, ognuno ha corretto un difetto visibile):

1. **Griglia delle fette che scorre con le spalle.** Lo spostamento verticale è un numero intero di fette. Con la griglia fissa il capo
   seguiva le spalle a scatti di 1,2 cm e tra uno scatto e l'altro si deformava.
2. **Lisciatura dello spostamento rispetto alla sim** (`DISP_SMOOTH`): le pieghe della sim passano, il rumore alla scala della maglia no.
3. **Strati aggiunti legati al tessuto base**: i vertici con `_layer` > 0 (guscio della costina, risvolti) copiano lo spostamento dei 3
   vertici base più vicini. Adattati per conto proprio scorrevano e lungo la cucitura si apriva una fessura.
4. **Vertici duplicati riuniti**: nel GLB i vertici sono doppi dove cambia texture o materiale; le lisciature lavorano sulla mesh saldata e
   a fine calcolo i duplicati tornano coincidenti. Altrimenti il capo si apre lungo la cucitura della spalla.
5. **Sicurezza sulla pelle sulla forma corrente**: ogni vertice guarda la pelle direttamente sotto (scarto laterale < 1,5 cm) con la
   normale corrente; soglia per vertice = mai più vicino di quanto fosse nella sim, e comunque non oltre 3 mm. Le spinte trascinano i vicini.
6. **Sicurezza sui vicini a riposo spenta** (`REST_SAFETY = false`): confrontava col piano tangente di punti lontani 2,5 cm e su zone
   convesse vedeva violazioni di 6–9 mm inesistenti. Non riaccenderla.

### 5.4 Sovrapposizioni, occlusione, profondità [VERIFICATO]

- Il capo è geometria vera: l'occlusione la risolve il depth buffer. Non ci sono maschere né livelli 2D.
- Distanza capo–pelle ≥ 2 mm in ogni punto della sim; nessun triangolo del capo che ne attraversa un altro.
- Sotto il capo il corpo indossa i boxer (`shorts.js`), che seguono il corpo.
- Gli strati doppi (costina, risvolti) sono gusci separati a 0,6–4,6 mm dallo strato base: mai complanari, altrimenti z-fighting.

### 5.5 Luce, ombre, colore [VERIFICATO]

- Luci in `engine.js`: ambiente 0,45; chiave 1,6 da (1,5; 3,5; 2,5); riempimento freddo 0,4; controluce caldo 0,6. Tone mapping ACES,
  esposizione 1,2.
- Ombre: la luce chiave proietta; **corpo e capo ricevono**. Mappa 2048 px su un riquadro di 2,6 × 2,6 m, `bias` −0,0005, `normalBias`
  0,012. Sono le ombre sotto orlo e maniche a far sembrare il capo indossato. Con la mappa di default (10 m) le ombre sono sfocate; senza
  `normalBias` compaiono righe.
- Il colore del capo è quello della foto: non applicare correzioni cromatiche al materiale.

### 5.6 Regola pratica contro l'effetto «immagine appoggiata»

Un capo sembra indossato quando: (a) i fianchi scendono quasi verticali e l'orlo non fa la campana; (b) le maniche si appoggiano al braccio
con il polsino aperto e pulito; (c) la costina segue la base del collo senza staccarsi; (d) ci sono ombre sotto orlo e maniche; (e) cambiando
le misure il tessuto non si riempie di bozzi. Ognuno di questi punti ha una misura o una vista di controllo in §7.

---

## 6. Pipeline operativa: nuovo prodotto in 9 fasi

Esempio con un prodotto `nuova-tee`. Ogni fase ha un controllo: **non passare alla successiva se fallisce**.

### Fase 1 — Raccolta dei dati

- **Obiettivo**: avere tutto ciò che serve, sapere cosa manca.
- **Input**: foto del davanti stesa (meglio PNG con trasparenza), tabella taglie in cm, scheda (vestibilità, manica, composizione, GSM).
- **Operazioni**: creare `assets/products/nuova-tee/source/` con `front.png`, `tabella_taglie.csv`, `nuova-tee-details.md`.
- **Controllo**: la tabella ha petto, lunghezza, manica (e spalla, se non è raglan) per ogni taglia.
- **Se manca qualcosa**: NON inventare. Assumere il valore del prodotto più simile, marcarlo `ASSUNTO` in `chart_source`/`sources_extra` e
  chiederlo. Dati da chiedere sempre: foto del retro, profondità dello scollo dietro, GSM confermata, come è misurata la manica.

### Fase 2 — Calibrazione della foto

- **Obiettivo**: scala e riferimento della foto.
- **Operazioni**: misurare in pixel la larghezza del petto (riga 2,5 cm sotto l'ascella), il centro, la riga dell'HPS, la riga dell'orlo,
  dove finisce la stampa. Con la trasparenza:

```python
import cv2, numpy as np
im = cv2.imread('assets/products/nuova-tee/source/front.png', cv2.IMREAD_UNCHANGED)
a = im[..., 3] >= 250
xs = np.where(a[RIGA_PETTO])[0]; print(xs.min(), xs.max(), xs.max() - xs.min())   # larghezza del petto in px
```

- **Output**: `photo=dict(file, K, cx, hps_y, w, h, hem_y, print_end, mask, plain_cm)` in `products.py`. `plain_cm` = rettangolo (x0, x1,
  y0, y1 in cm) di tessuto senza grafica, usato per la grana del retro.
- **Errori comuni**: `K` calcolato su una riga dove la sagoma include le maniche; `mask` sbagliata (vedi §4.5).

### Fase 3 — Taglio e voce in `products.py`

- **Operazioni**: copiare la voce del prodotto più simile; riusare `DROP_SHOULDER_CUT` o `RAGLAN_CUT` se la foto coincide entro 0,5 cm,
  altrimenti misurare i punti del taglio in cm. Compilare `chart`, `chart_source`, `cut`, `cut_source`, `details` (con `gsm`),
  `assumed=dict(hem_fold, fabric_mm, collar_mm)`, `sources_extra`.
- **Valori di partenza**: `hem_fold` 2,0 (0 se taglio vivo); `fabric_mm` 0,9 a 250 gsm, 1,3 a 350; `collar_mm` 4,0 (4,6 se pesante).
- **Controllo**: `TRYON_PRODUCT=nuova-tee python3 blender/garment/pattern.py` → cartamodello = tabella in ogni cella. Sovrapposizione
  del contorno alla foto: `python3 blender/garment/pattern.py foto.png out.png` (solo `set_in`).

### Fase 4 — Texture

```bash
python3 blender/garment/prep_texture.py nuova-tee
```

- **Controllo visivo**: aprire `assets/products/nuova-tee/textures/front.png` e `back.png`. Davanti: nessun alone, nessuno sfondo dentro la
  sagoma. Retro: uniforme o con la stessa sfumatura del davanti, senza righe.

### Fase 5 — Bake in sandbox

- **Obiettivo**: una taglia (M) per validare, poi tutte.
- **Operazioni**:

```bash
sh blender/garment/sandbox.sh prova nuova-tee M        # sim completa, ~3-4 minuti; risultato in blender/out/eval/work/prova/nuova-tee/
```

```bash
nohup sh blender/garment/bake_install.sh prova "nuova-tee:S nuova-tee:L nuova-tee:XL nuova-tee:2XL" > blender/out/eval/work/prova.log 2>&1 < /dev/null &
```

- **Tempi**: ~3,5 minuti di sim a taglia su Intel i5 4 core, 2 in parallelo. La sola rifinitura (`--refinish`) ~30 s: usarla per ogni
  modifica che non tocca la sim (colletto, texture, UV, strati, orlo).
- **Attenzione**: un processo lanciato senza `nohup … < /dev/null &` muore quando la sessione si chiude (è successo: bake interrotto a
  metà e taglie vecchie rimaste installate senza che nessuno se ne accorgesse). Controllare sempre le date dei GLB installati.
- **Errori comuni**: `FALLITO` → leggere `build_<taglia>.log`; cuciture con numero di vertici diverso → errore nel cartamodello.

### Fase 6 — Criteri misurati

`sandbox.sh` esegue già `check_tee.py`. Leggere l'esito:

```bash
grep -E "^(CHECK|  FAIL)" blender/out/eval/work/prova/nuova-tee/check_M.log
```

Soglie in §7.1. Un `FAIL` non si corregge allargando la tolleranza né aggiustando il numero: si cerca la causa (§9) o lo si documenta.

### Fase 7 — Verifica visiva nel viewer

1. Collegare la sandbox al viewer (cartella temporanea, da rimuovere alla fine):

```bash
mkdir -p frontend/public/assets/garments/_work && ln -sfn "$PWD/blender/out/eval/work/prova/nuova-tee" frontend/public/assets/garments/_work/nuova-tee
```

2. Registrare il prodotto in `frontend/src/core/garment/assets.js` (una riga) e, per il lab, la tabella in `CHARTS` di `lab.js`.
3. Aprire `/lab.html?asset=nuova-tee&size=M&body=95,79,96,173&base=/assets/garments/_work/` e, dalla console, inquadrare:

```js
lab.view(-1.3, 1.5, 3.3, 1.3, 20)     // figura intera 3/4
lab.view(-0.9, 2.05, 2.4, 1.69, 9)    // colletto 3/4
lab.view(1.4, 1.5, -3.3, 1.3, 20)     // retro
```

4. Ripetere con `body=84,79,96,173`, `body=110,79,96,173`, `body=114,95,104,185` (bozzi, colletto, cuciture).
- **Trappola**: lo screenshot subito dopo un cambio di stato può mostrare il fotogramma precedente. `lab.view` renderizza due volte; dopo un
  `navigate` aspettare 5–8 s che il GLB sia caricato (se il capo non c'è ancora si vede il corpo nudo).
- **Trappola**: il render Workbench di Blender (contact sheet) mostra la costina a facce scure e un aspetto lucido: è un artefatto. Per
  colletto e materiali fa fede il viewer.

### Fase 8 — Installazione

```bash
sh blender/garment/install.sh prova "nuova-tee:S nuova-tee:M nuova-tee:L nuova-tee:XL nuova-tee:2XL"
```

Poi rimuovere `frontend/public/assets/garments/_work`, aggiungere il prodotto a `frontend/demo-shop/products.js` (misure della tabella;
per una raglan niente `shoulder_cm` né `sleeve_cm`) e verificare nel negozio di esempio (`npm run demo`, porta 5174, widget su 5173).

### Fase 9 — Regressioni e documentazione

```bash
cd frontend && npm test && npx eslint .
```

```bash
python3 blender/tools/worn_extremes.py --products nuova-tee     # distanza vera dal corpo agli estremi degli slider
```

Aggiornare la tabella dei prodotti e lo stato dei criteri in `blender/garment/README.md`. Riportare cosa passa, cosa no, cosa dipende da
dati mancanti.

---

## 7. Standard qualitativi e validazione

### 7.1 Criteri misurati (automatici, `check_tee.py`) [VERIFICATO]

| Criterio | Soglia | Bloccante? |
|---|---|---|
| Petto (giro, 2,5 cm sotto l'ascella), orlo (giro), lunghezza, manica = tabella | ± 0,3 cm | no, ma va riportato |
| Spalla = tabella | ± 0,5 cm | no, ma va riportato |
| Distanza minima dal corpo, nessun vertice dentro | > 2 mm | **sì** |
| Simmetria sinistra/destra | ≤ 0,5 mm | **sì** |
| Auto-intersezioni | 0 coppie di triangoli | **sì** |
| Quota dell'orlo rispetto al filo teso dall'HPS | ± 2,5 cm | no |
| Spessore del colletto = dichiarato | ± 0,4 mm | no |

### 7.2 Criteri di caduta e di adattamento [VERIFICATO]

| Misura | Strumento | Valore di riferimento |
|---|---|---|
| Larghezza dell'orlo sul corpo neutro | `drape_shape.py` | 43,7–46,2 cm su fianchi di 37–38 cm (era 45,9 con orlo ovale e liscio: «campana») |
| Tessuto in pieghe all'orlo (giro / guscio convesso − 1) | `drape_shape.py` | 4% (S) – 10% (2XL); sotto il 2% il capo è rigido |
| Vertici dentro la pelle agli estremi degli slider | `worn_extremes.py` | 0 con una sola misura all'estremo o quasi; decine solo nel caso combinato grande e alto, nell'ascella |
| Continuità: capo quasi neutro = sim traslata | test «il capo segue le spalle in modo continuo» | ≤ 1% dei vertici oltre 3 mm |
| Strati attaccati, duplicati coincidenti | test «gli strati aggiunti restano attaccati…» | < 2,5 mm; duplicati < 0,01 mm |
| Tempo di adattamento | `deform-asset.mjs` (campo `deformMs`) | ~60 ms col neutro, ~90 ms altrimenti (i5 4 core) |
| Peso dell'asset | dimensione del GLB | ≤ 1,5 MB a taglia |

### 7.3 Strumenti di controllo (`blender/tools/`, Python di sistema)

| Comando | A cosa serve |
|---|---|
| `python3 blender/tools/garment_sheet.py --product X --sizes M,2XL [--bodies "nome=petto,vita,fianchi,altezza;…"]` | contact sheet 9 viste × corpi × taglie, con lo stesso codice del viewer |
| `python3 blender/tools/neck_sheet.py --size M` | collo dei tre prodotti da 6 viste |
| `python3 blender/tools/variant_sheet.py --items "a=x.glb;b=y.glb" --out cartella` | confronto affiancato di varianti (taratura di un parametro) |
| `Blender -b blender/man-model.blend --python blender/tools/drape_shape.py -- nome=tee_M_build.npz` | misura della «campana» |
| `python3 blender/tools/worn_extremes.py [--products …] [--sizes L,2XL]` | distanza vera dal corpo su 8 corpi agli estremi |
| `Blender -b blender/man-model.blend --python blender/tools/check_worn.py -- capo.glb "Chest=0.7"` | distanza vera di un capo adattato |
| `node frontend/scripts/deform-asset.mjs --in X.glb --body 120,,, --out Y.glb` | applica `bound.js` offline |

### 7.4 Checklist visiva (richiede uno sguardo, non è automatizzabile)

Viste: figura intera 3/4, retro, colletto 3/4 e laterale; corpi: partenza del widget (95/79/96/173), petto 84, petto 110, 114/95/104/185.

- [ ] Stampa, colore e contrasti corrispondono alla foto; nessun alone ai bordi.
- [ ] Costina: anello regolare e simmetrico, coste dritte, bordo liscio, aderente alla base del collo, nessuna «orecchia».
- [ ] Dall'apertura del collo non si vede l'interno del capo come macchia di colore diverso.
- [ ] Cuciture (spalla, giromanica o raglan) continue, senza denti di colore.
- [ ] Fianchi quasi verticali; orlo con qualche piega, non un ovale liscio e largo.
- [ ] Maniche appoggiate al braccio, polsino aperto e pulito (non «arrotolato»).
- [ ] Retro senza righe orizzontali, coerente col davanti alle spalle.
- [ ] Cambiando il petto in su e in giù: niente bozzi, niente fessure, niente pelle che buca.
- [ ] Ombre sotto orlo e maniche presenti, senza righe sulle superfici.

### 7.5 Quando un prodotto è pronto

**Pronto** se: tutti i criteri bloccanti di §7.1 passano su tutte le taglie; la checklist §7.4 passa su M e 2XL; `npm test` e eslint verdi;
i criteri non bloccanti falliti sono riportati con il valore; i dati assunti sono marcati.
**Non pronto** se: auto-intersezioni, vertici dentro il corpo sul neutro, fessure o pelle visibile con corpi entro i limiti degli slider
presi uno alla volta, texture con sfondo o alone, colletto irregolare.

---

## 8. Parametri di riferimento

### 8.1 Tessuto (`FABRIC` in `build_tee.py`, `REF_*` in `products.py`) [VERIFICATO]

| Parametro | Valore | Perché |
|---|---|---|
| `bending` | 1,0 a 250 gsm (× (gsm/250)²) | a 20–40 il capo è una campana rigida; sotto 1 non cambia più |
| `hem_bend` | 0,0 | orlo morbido come il tessuto; a 0,6 tiene aperto l'ovale dell'orlo |
| `cuff_bend` | 0,6 | polsino rigido: a 0 si accartoccia sul braccio |
| `mass` | 0,30 a 250 gsm (× gsm/250) | 0,5 non migliora la caduta e allunga il capo |
| `tension` | 40 (DrivingMato 12) | nella raglan a 40 la manica non si inclina; a 12 sì |
| `shear` | 12 | — |
| `collar_tension` | 8 | costina elastica solo a trazione |
| `bend_max` | 40 a 250 gsm | flessione del colletto |
| `dist` + `thick` | 3 + 2 mm | distanza di collisione nella sim |
| `gap` | 4 mm | distanza minima garantita in rifinitura |
| `smooth` | 2 | passate di levigatura lungo la normale |
| passo della mesh | 1,2 cm | — |

**Lezione da ricordare**: per togliere la campana servono **insieme** flessione bassa e orlo morbido. Ognuna delle due rigidezze, da sola,
basta a riaprire le pieghe (prove J, K, L, M nel README).

### 8.2 Colletto (`build_tee.py`)

| Parametro | Valore |
|---|---|
| armoniche della cucitura | 3 |
| inclinazione di riposo del profilo (`rest_deg`) | 25° |
| obiettivo per l'allargamento (`lay_deg`), massimo (`max_open`, `max_stretch`) | 50°, 15 mm, 8% |
| tratti del profilo (`COLLAR_SEG`), colonne per lato (`COLLAR_SUB`) | 4, 3 |
| spessore (`collar_mm`) | 4,0 mm; 4,6 per 350 gsm (ASSUNTO) |

### 8.3 Adattamento a runtime (`bound.js`)

| Costante | Valore | Significato |
|---|---|---|
| `LEVEL_DY`, `N_DIR` | 1,2 cm, 96 | fette verticali e direzioni attorno al busto |
| `KAPPA` | 0,15 | rientro massimo del tessuto in caduta |
| `S_MAX` | 1,2 | l'ease in più non gonfia le pieghe oltre il 20% |
| `DISP_SMOOTH` | 5 | lisciatura dello spostamento rispetto alla sim |
| `SKIN_FOLLOW_SMOOTH` | 6 | lisciatura dello spostamento della pelle seguito dal tessuto |
| `DRAPE_SMOOTH` | 3 | lisciatura verticale della sagoma drappeggiata |
| `SKIN_MIN`, `SKIN_SLACK`, `SKIN_LAT`, `SKIN_CELL` | 3 mm, 0,5 mm, 1,5 cm, 3 cm | sicurezza sulla pelle |
| `SAFETY_SPREAD` | 4 | propagazione delle spinte ai vicini |
| `REST_SAFETY` | false | **non riaccendere** (§5.3) |

---

## 9. Troubleshooting: difetti già incontrati e soluzioni

| Sintomo | Causa | Soluzione | Dove |
|---|---|---|---|
| Scollo che sembra a V | la costina campiona l'interno del retro dalla foto | campionare la fascia centrale della costina | `collar_photo_point` |
| Costina a zig-zag, bordo irregolare | fascia fatta di pochi triangoli grossi | guscio a griglia | `collar_grid` |
| Costina che si stacca ai lati, interno del capo in vista | profilo a tratti rigidi | profilo appoggiato alla pelle | `rebuild_collar` |
| Centinaia di auto-intersezioni dopo aver cambiato il colletto | triangoli della fascia rimasti nel mesh, o triangoli degeneri sulla spalla | escluderli dal mesh esportato | `finish_layers` |
| Alone giallo o sfondo nero ai bordi del capo | sagoma presa col metodo sbagliato | `mask='alpha'` | `products.py` |
| Denti di colore lungo la cucitura raglan | foto non simmetrica, manica che campiona il busto | margine 2,5 cm sulla manica | `sample_point` |
| Righe orizzontali sulla schiena | retro a piastrelle specchiate | fondo per riga + grana | `prep_texture.py` |
| Capo a campana, orlo ovale e liscio | flessione alta e orlo rigido | `bending` 1, `hem_bend` 0 | §8.1 |
| Maniche «arrotolate» | polsino troppo morbido | `cuff_bend` 0,6 | §8.1 |
| Orlo più lungo della tabella di 0,3–0,6 cm | residui delle proiezioni, tutti dello stesso segno | scala orizzontale sfumata, già attiva sotto l'1,2% | `build_tee.py`, «giro dell'orlo» |
| Capo a bozzi col corpo di partenza del widget | spostamento delle spalle seguito a scatti | griglia che scorre con le spalle | `deformGarment` |
| Capo a bozzi riducendo il petto | sicurezza sui vicini a riposo | `REST_SAFETY = false` + lisciatura dello spostamento | `bound.js` |
| Fessura con pelle lungo cucitura della spalla o del colletto | duplicati lisciati separatamente; strati che scorrono | mesh saldata, duplicati riuniti, strati legati al base | `bound.js` |
| Corpo nudo nel viewer | GLB ancora in caricamento, oppure non caricabile | attendere; se fallisce il motore usa il capo parametrico e scrive un avviso in console | `engine.js` |
| Le altre taglie «non sono come la M» | bake interrotto, GLB vecchi ancora installati | controllare le date dei GLB; `bake_install.sh` staccato dalla sessione | §6 fase 5 |
| Un test fallisce dopo aver cambiato un asset | il test misura un invariante che il nuovo asset cambia legittimamente | verificare con la misura vera (`check_worn.py`) prima di toccare la soglia, e scrivere nel test il numero misurato | `bound.test.js` |
| Sim fallita su un corpo non neutro | la vestizione si incaglia | non simulare su altri corpi: è il compito di `bound.js` | — |

**Limiti aperti, non risolti** (non riprovare le strade già fallite senza una nuova idea):

- DrivingMato: petto −0,36…−0,48 cm su M–2XL. È una compressione orizzontale residua della raglan; più iterazioni e trazione 40 non aiutano.
- Kermit S: spalla +1,30 cm (spalla di tabella 58 cm su un manichino stretto, tessuto pesante).
- Caso combinato petto 130 + vita 120 + fianchi 124 + altezza 200: 23–140 vertici dentro la pelle nella piega dell'ascella.
- Deformazione ~90 ms su CPU lenta: profilo in `deformGarment` (ciclo principale e `skinClearance`).

---

## 10. Regole per agenti con risorse limitate

1. **Un obiettivo, un parametro, una misura.** Prima di cambiare qualcosa scrivi quale numero o quale vista deve migliorare.
2. **Misura prima di ipotizzare.** Tre ipotesi plausibili in questo progetto si sono rivelate sbagliate solo dopo la misura (lo scollo a V
   era texture, non geometria; la stampa «schiacciata» era prospettiva; la campana non dipendeva da un solo parametro).
3. **Sandbox sempre.** `sandbox.sh` / `refinish_all.sh` scrivono in `blender/out/eval/work/<tag>/`. Gli asset installati cambiano solo con
   `install.sh`, che fa il backup.
4. **`--refinish` quando basta.** Colletto, texture, UV, strati, orlo: 30 s. Tessuto e cartamodello: sim completa.
5. **Guarda nel viewer con `body=95,79,96,173`**, mai solo col neutro esatto: due difetti gravi si vedevano solo lì.
6. **Non fidarti del render Workbench** per colletto e materiali.
7. **Non allargare una tolleranza per far passare un controllo.** Se un criterio non passa, lo si riporta.
8. **Non leggere i file lunghi per intero.** Cerca il nome della funzione (`rebuild_collar`, `collar_grid`, `finish_layers`,
   `deformGarment`, `bindGarment`) e leggi quel blocco.
9. **Se mancano dati**: assumi il valore del prodotto più simile, marcalo `ASSUNTO`, elenca esattamente cosa serve, prosegui.
10. **Processi lunghi**: `nohup … < /dev/null &`, log su file, e verifica con `pgrep -fl build_tee` prima di dire che è in corso.
11. **Non modificare** backend, SDK, protocollo, contratto dati, calibrazione del corpo.

Cosa è automatizzabile e cosa no:

| Automatico (script, esito numerico) | Richiede valutazione visiva |
|---|---|
| misure contro tabella, simmetria, intersezioni, distanza dal corpo | fedeltà di stampa e colori |
| larghezza e pieghe dell'orlo | regolarità della costina e delle cuciture |
| vertici dentro la pelle agli estremi | naturalezza della caduta, maniche |
| continuità, strati, duplicati (test) | ombre, aspetto del materiale |

Procedura minima per un difetto segnalato dall'utente:

```
1. Riproduci nel viewer con lo stesso corpo e la stessa taglia dell'utente.
2. Stabilisci se il difetto è nel GLB (c'è anche col neutro esatto) o nell'adattamento (compare cambiando il corpo).
3. GLB      -> build_tee.py / pattern.py / prep_texture.py, prova con sandbox.sh ... --refinish
   runtime  -> bound.js, prova con npm test + viewer
4. Trova una misura che cambia col difetto; se non esiste, scrivila (vedi blender/tools/drape_shape.py come modello).
5. Correggi, rimisura, guarda, poi rilancia TUTTI i controlli (regressioni).
6. Installa, aggiorna README e questo manuale se hai imparato una regola nuova.
```

---

## 11. Esempi di riferimento

| Prodotto | Perché è un riferimento | File |
|---|---|---|
| **Grillz Tee M** | prodotto di taratura: tabella reale, tutti i criteri rispettati, caduta approvata dal committente | `frontend/public/assets/garments/grillz-tee/tee-M.glb`, voce `grillz-tee` in `products.py` |
| **Kermit Tee L** | 350 gsm, taglio vivo, costina larga a coste: riferimento per la costina a griglia e per il retro sfumato | `kermit-tee/tee-L.glb` |
| **DrivingMato Tee M** | raglan con maniche e colletto a contrasto: riferimento per cuciture raglan e campionamento dei colori (i criteri di misura NON passano) | `drivingmato-tee/tee-M.glb` |

Contact sheet di riferimento (9 viste × 3 corpi, taglia M), rigenerabili con il comando indicato:

```bash
python3 blender/tools/garment_sheet.py --product grillz-tee --sizes M --bodies "neutro=;partenza_widget=95,79,96,173;petto110=110" --out blender/out/eval/ref/grillz-tee
```

- `docs/reference/grillz-tee_M.jpg`
- `docs/reference/kermit-tee_M.jpg`
- `docs/reference/drivingmato-tee_M.jpg`

Sono render Workbench: servono per **silhouette, caduta e posizione**, non per il colletto né per i materiali (§6 fase 7). Il riferimento
visivo vero è il viewer: `/lab.html?asset=<id>&size=M&body=95,79,96,173`.

Caratteristiche visive da replicare in un prodotto nuovo: fianchi quasi verticali con poche pieghe che arrivano all'orlo; manica aperta che
poggia sul braccio; costina regolare alta circa 2 cm alla base del collo; cuciture leggibili ma sottili; ombra netta sotto l'orlo.

---

## 12. Manutenzione ed evoluzione

**Versioni dei prodotti [VERIFICATO in parte].** Ogni JSON porta `version`, `fabric` (parametri usati), `sources`, `data_quality`,
`measured`, `checks`, `bake_seconds`. Non esiste un numero di versione dell'asset per prodotto. **[CONSIGLIATO]** aggiungere data e hash
dello script al JSON e un controllo che avvisi quando i GLB installati sono più vecchi di `build_tee.py`.

**Riutilizzo.** Tagli condivisi (`DROP_SHOULDER_CUT`, `RAGLAN_CUT`), tabelle condivise, `_scale_cut`, regola della grammatura. Un prodotto
nuovo con lo stesso taglio è una voce di poche righe.

**Dipendenze.** Blender 4.5 LTS (percorso in `BLENDER`, default macOS), Python 3.9 con numpy, opencv-python, Pillow; Node 22. I test di
`bound.js` richiedono gli asset Grillz S e XL (altrimenti vengono saltati).

**Regressioni.** `npm test` (contratto, fitting, drappeggio parametrico, registro, `bound.js`, protocollo, SDK), eslint, `check_tee.py` su
tutte le taglie, `worn_extremes.py`. Dopo ogni modifica a `bound.js` rilanciare anche `worn_extremes.py`: i test non la coprono.

**Performance.** Bind ~0,45 s una volta per capo; deformazione ~60–90 ms; `AssetGarment.setInfluences` non ricalcola se le misure non
cambiano (il motore la chiama due volte). Il ciclo di render gira sempre a 60 fps anche a scena ferma. **[CONSIGLIATO]** render su
richiesta; ottimizzare `skinClearance` (griglia su array tipizzati).

**Da standardizzare o automatizzare [CONSIGLIATO].**

- Un solo comando «nuovo prodotto» che esegua le fasi 4–9 e produca un rapporto.
- Misura automatica del taglio dalla foto (segmentazione dei colori per la raglan, sui due lati).
- Screenshot automatici del viewer (oggi si fanno a mano dal browser).
- Indicatore di caricamento del capo nel widget.
- Test che confronti le misure del catalogo demo con `products.py`.

**Estensioni [FUTURO].**

- Nuove tipologie (hoodie, maniche lunghe, pantaloni): servono nuove funzioni `pieces_*` in `pattern.py`, nuove cuciture, e in `bound.js`
  regole per le zone nuove (cappuccio, gambe). Il nome `build_tee.py` e i file `tee-*.glb` sono specifici delle T-shirt.
- Altri corpi (donna, taglie forti): nuovo `.blend` calibrato con `build_body.sh`, e una sim per taglia su quel corpo neutro.
- Foto del retro vera: sostituire il segnaposto in `prep_texture.py` e la mappatura `back` in `loop_uv`.

---

## 13. Informazioni mancanti e limiti noti

**[MANCANTE] Dati dei prodotti** (da chiedere al negozio, non inventare):

- Foto del retro di tutti e tre i prodotti; profondità dello scollo dietro.
- Conferma della GSM (oggi dalla scheda prodotto) e una prova di caduta del tessuto: la taratura è estetica, non fisica.
- Come è misurata la manica della DrivingMato (assunto: bordo superiore dal colletto all'orlo manica; nella foto 42,1 cm contro 39).
- Altezza della costina finita, altezza dei risvolti, giro dell'orlo e apertura manica per taglia.

**[MANCANTE] Nel repository:**

- `blender/out/` non è versionata: archivi `.npz` e log non esistono su un clone pulito e vanno rigenerati (bake completo, ~45 minuti per
  15 taglie).
- Nessuna prova su hardware diverso da un Intel i5 4 core; nessuna misura su dispositivi mobili.
- Nessun test automatico dell'aspetto (immagini di riferimento confrontate).
- Il ripiego sul capo parametrico in caso di GLB non caricabile è implementato ma non è stato provato con un errore vero.

**Stato dei criteri al momento della scrittura** (dettaglio in `blender/garment/README.md`): Grillz 4/5 taglie (L: lunghezza −0,30 cm);
Kermit 3/5 (S: spalla e lunghezza; M: lunghezza); DrivingMato 0/5 (petto su M–2XL e altri).

---

## 14. Pubblicazione online gratuita

Il Try-On è statico: il widget non chiama il backend (`backend/` serve solo all'estrazione dei dati dai negozi ed è estraneo alla demo).
Basta un hosting di file. [VERIFICATO] la build si serve da un semplice server statico e il widget carica corpo e capi.

```bash
cd frontend && npm run build:site        # produce dist/: index.html -> demo-shop/, embed.html, sdk/, assets/ (~15 MB)
```

Per provarla in locale prima di caricarla: `cd dist && python3 -m http.server 5190`, poi `/demo-shop/?tryon=http://127.0.0.1:5190`
(il parametro serve solo perché `127.0.0.1` è trattato come sviluppo; su un dominio vero non serve).

| Servizio | Come | Note [CONSIGLIATO, verificare i limiti correnti sul sito del servizio] |
|---|---|---|
| Cloudflare Pages | caricare la cartella `dist/` (Direct Upload) oppure collegare il repository GitHub | piano gratuito, file ≤ 25 MB (i GLB sono ≤ 1,5 MB); è la scelta consigliata |
| Netlify | trascinare `dist/` su app.netlify.com/drop | semplice, ha limiti mensili di banda/crediti |
| GitHub Pages | pubblicare `dist/` su un ramo `gh-pages` | il repository deve essere pubblico sul piano gratuito |

Attenzioni prima di rendere pubblico:

- Foto e texture dei prodotti (Grillz, Kermit, DrivingMato) finiscono nei GLB pubblici: assicurarsi di averne il diritto.
- `VITE_TRYON_ALLOWED_ORIGINS` (variabile della build) vuota = il widget accetta di essere incorporato da qualunque sito. Va bene per la
  demo; per un uso reale impostarla con i domini dei negozi.
- Le misure del corpo restano nel browser dell'utente (nessun server le riceve): la demo non raccoglie dati.
- Il primo caricamento scarica ~1–3 MB per capo più il corpo; su connessioni lente il widget resta nero per qualche secondo (non c'è un indicatore di caricamento: [FUTURO]).
