# Live Body Scan

Scansione guidata dalla fotocamera frontale che stima petto, vita e fianchi (giri) partendo dall'altezza dichiarata dall'utente
e li passa al corpo 3D del Try-On. Tutto gira nel browser: il video non viene salvato né inviato a nessun server.

## Flusso

`Le tue misure → Misurati con la fotocamera` apre `src/scan/BodyScan.jsx`, caricato solo su richiesta.

1. **Intro**: altezza, consigli (telefono in verticale, 2 m, parete libera, abiti aderenti), guida vocale, nota privacy.
2. **Inquadratura**: una sola persona, testa e piedi visibili, distanza, centratura, luce, inclinazione del telefono.
3. **Posizione**: di fronte, braccia aperte in posa "A" e corpo fermo.
4. **Fronte**: raccolta di 24 letture valide (larghezze).
5. **Rotazione e fianco**: un quarto di giro, braccia tese in avanti, poi 18 letture valide (profondità). Dopo 25 s compare «Salta la vista di fianco».
6. **Risultato**: valore ≈, intervallo, affidabilità per misura. «Usa queste misure» aggiorna il corpo 3D. Le misure restano sempre correggibili a mano.

## Pipeline

| Modulo | Ruolo |
|---|---|
| `vision.js` | fotocamera, MediaPipe Pose Landmarker *lite* (VIDEO, GPU → CPU), maschera di segmentazione, luce, sensori |
| `quality.js` | controlli per fotogramma con un codice per problema; un solo messaggio alla volta, per priorità |
| `measure.js` | scala, larghezze a sub-pixel, scarto delle righe toccate dalle braccia, mediana robusta, circonferenze, incertezza |
| `session.js` | macchina a stati `framing → pose → front → turn → side → done` (pura, testata in Node) |
| `voice.js` | Web Speech API in italiano e segnali sonori (Web Audio) |
| `shapePriors.json` | priori geometrici misurati sulla mesh (`blender/scripts/scan_shape_priors.py`) |

### Come si misura

- **Scala**: si usa l'altezza dichiarata, dalla sommità della testa (maschera) al pavimento stimato sotto la media delle due caviglie (+4,5% H). Non si usa il bordo inferiore della silhouette: la fotocamera sta più in alto del pavimento, quindi le punte dei piedi (di fronte) e il piede più vicino (di profilo) appaiono più in basso. Sul corpo 3D questo errore spostava la scala del 5% tra le due viste.
- **Quote**, le stesse della calibrazione del modello 3D:

  | Misura | Larghezza (di fronte) | Profondità (di profilo) | Giro di riferimento |
  |---|---|---|---|
  | Petto | 0,70 H, sotto le ascelle | 0,75 H | 0,75 H |
  | Vita | 0,635 H | 0,635 H | 0,635 H |
  | Fianchi | 0,52 H | 0,52 H | 0,52 H |

  Il petto si legge di fronte a 0,70 H perché da 0,72 in su la silhouette include il tessuto dell'ascella.
- **Giro** = k · perimetro dell'ellisse (larghezza, profondità). k e il rapporto profondità/larghezza (usato quando manca la vista laterale) sono misurati sulla mesh, su 81 corpi per livello. Le regressioni lineari sono più precise sulla mesh, ma si adattano a un solo modello anatomico e non sono state adottate.
- **Difese**:
  - di fronte e di profilo si scartano le righe in cui un braccio tocca il busto;
  - di profilo si rifiuta il petto se è più profondo di oltre l'8% rispetto a 5 cm più in basso (braccio nella banda);
  - una profondità fuori dal range umano viene scartata e la misura ricade sulla stima frontale (`depthRejected`).

### Cosa è misurato e cosa è stimato

- **Misurato direttamente**: larghezze frontali, profondità laterali, distanza tra le spalle (landmark: è solo informativa e non va al modello 3D, che non ha un morph per le spalle).
- **Stimato con un modello geometrico**: i giri di petto, vita e fianchi.
- **Ipotesi**: senza vista laterale la profondità è `r · larghezza`, con r preso dalla mesh. In questo caso l'affidabilità dichiarata è bassa o media.
- **Dichiarata**: l'altezza.

### Incertezza e affidabilità

Per ogni misura l'incertezza si calcola a partire da tre termini:

- la dispersione statistica delle letture;
- metà dell'errore massimo del modello geometrico sulla mesh;
- un 3% di effetti del mondo reale (abiti, postura, segmentazione), da ricalibrare.

Affidabilità alta ≤ 2,5 cm, media ≤ 5 cm, bassa oltre. Finché mancano dati reali nessuna misura arriva ad «alta», ed è voluto.

## Validazione

**Test automatici** (`npm test`, `src/scan/scan.test.js`, 15 test): geometria su una figura sintetica a misure note, controlli di qualità, sessione completa, fallback.

**Corpo 3D renderizzato** (solo sviluppo: `src/scan/dev/`). Il modello wearIT viene renderizzato con misure note e ripreso da 2,1 m a 1 m d'altezza (FOV 62°). La pipeline reale è MediaPipe → sessione → misure. Errore in cm rispetto al giro vero:

| Corpo (petto/vita/fianchi/h) | Fronte + fianco | Solo fronte |
|---|---|---|
| 88/74/92/162 | +2,6 / −0,6 / −1,4 | +8,4 / +1,6 / −1,0 |
| 95/82/98/172 | +2,7 / +0,6 / −0,8 | +5,1 / +0,4 / −1,8 |
| 100/88/102/178 | +3,8 / +1,8 / +1,0 | +3,3 / 0,0 / −1,8 |
| 108/98/108/184 | +0,6\* / +3,2 / +4,5 | +0,6 / −1,0 / −1,1 |
| 116/106/114/190 | −5,0\* / +8,8 / +10,4 \*\* | −5,0 / −1,2 / +0,1 |

- Fronte + fianco, corpi da 88 a 108: 11 misure su 12 entro l'incertezza dichiarata (1σ), 12 su 12 entro 2σ.
- \* La profondità laterale del petto è stata scartata perché implausibile, quindi quel valore è la stima frontale.
- \*\* Caso aperto. Alzando le braccia del modello 3D, il rigging (skinning lineare insieme al morph del petto) gonfia spalle e fianchi in modo irrealistico: sul corpo più grande il profilo risulta più profondo della mesh già sotto il cavallo (+8 cm a 0,46 H). Le larghezze frontali sono invece corrette (±1 cm). Finché questo artefatto c'è, il banco di prova non può dire se l'errore di profilo dipenda dalla scansione: va verificato su persone reali con corporatura robusta.

Prove di sviluppo:

- In console (embed in `npm run dev`): `await (await import('/src/scan/dev/validate.js')).validateScan({ chest: 100, waist: 88, hips: 102, height: 178 })`
- Interfaccia completa con la «fotocamera» sintetica: `embed.html?scan=1&scanAuto=1&scanSource=model&scanBody=100,88,102,178`
- Dentro l'iframe del negozio demo: `localStorage['wearit.dev.scanBody'] = '100,88,102,178'` sull'origine del widget.

Nessuno di questi file entra nella build di produzione.

## Provare dal telefono

I browser danno accesso alla fotocamera solo su HTTPS, oppure su `localhost`.

1. Avvia il server in rete locale con HTTPS (certificato autofirmato, `@vitejs/plugin-basic-ssl`, solo in sviluppo):

   ```bash
   npm --prefix frontend run dev:phone
   ```

   Vite stampa l'indirizzo `Network`, per esempio `https://192.168.1.127:5173/`.
2. Collega il telefono alla **stessa rete Wi-Fi** del Mac e apri `https://<indirizzo>/embed.html?scan=1`. Il parametro apre direttamente la scansione e vale solo in sviluppo.
3. Il browser avvisa che il certificato non è attendibile:
   - **iPhone (Safari):** «Mostra dettagli» → «visita questo sito web»;
   - **Android (Chrome):** «Avanzate» → «Procedi».

   È normale per un server di sviluppo.
4. Consenti la fotocamera e, su iPhone, l'accesso a movimento e orientamento (serve per controllare se il telefono è dritto).

In sviluppo, sotto l'istruzione c'è una riga di diagnostica: analisi al secondo, apertura delle braccia in gradi (sinistro/destro), le bande in cui il braccio risulta unito al busto (`chest`, `waist`, `hips`) e i problemi attivi. Se la scansione si blocca, quella riga dice perché.

Se il telefono non raggiunge il Mac, controlla che il firewall di macOS accetti le connessioni in entrata per `node`.

## Fermezza e oscillazioni

Una persona in piedi non sta mai perfettamente ferma, e ogni fotogramma viene misurato da solo. Per questo «Resta fermo un momento» scatta solo per movimenti veri:

- si considerano solo spalle, fianchi, ginocchia e caviglie (testa e polsi tremano sempre, soprattutto con le braccia tese);
- il movimento è mediato nel tempo, su circa 0,3 s;
- la soglia è l'1,5% dell'altezza ogni 100 ms, cioè circa 25 cm/s.

Con un'oscillazione di ±1 cm e polsi che tremano di ±3 cm, la regola precedente (0,6% istantaneo, polsi compresi) fermava 57 fotogrammi su 59. Quella attuale lascia completare tutta la scansione (test `oscillazioni naturali`).

**Braccia.** Conta solo la silhouette: dove si misura, il braccio deve essere staccato dal busto. Non c'è un angolo minimo. Un braccio che tocca il busto in una zona non blocca la scansione: le altre zone continuano a raccogliere letture, e «Allarga le braccia» compare solo se a quella zona mancano ancora letture. Se il braccio copre la quota del petto (0,70 H), la larghezza si legge a 0,685 o 0,67 H e si riporta a 0,70 con il rapporto misurato sulla mesh (±3,3% e ±7%), con incertezza dichiarata più alta. La fase di fronte si chiude comunque dopo 15 s se ogni misura ha almeno 8 letture.

La raccolta conta le letture per singola misura: un fotogramma in cui il petto non si legge serve comunque per vita e fianchi. Una banda attraversata da un braccio però non viene ignorata: fa scattare l'istruzione sulle braccia.

## Limiti noti

- **Non ancora provato su persone reali né su un telefono fisico.** Nel pannello di sviluppo la fotocamera è bloccata. I numeri sopra vengono da un corpo sintetico senza abiti, con luce e sfondo ideali.
- L'altezza dichiarata è la scala: 1 cm di errore sull'altezza vale circa lo 0,6% su ogni giro.
- Gli abiti larghi aumentano le misure e non vengono rilevati.
- Il modello 3D è maschile: per il busto femminile i priori della mesh non sono rappresentativi.
- La fotocamera richiede HTTPS. Per provare dal telefono in rete locale serve un tunnel o `vite --https`.
- Peso: MediaPipe aggiunge circa 4,2 MB gzip (wasm) + 5,8 MB di modello, scaricati solo quando si apre la scansione.

## Prima prova sul campo (2026-11-24)

Una persona (metro: petto 91, vita 85, fianchi 94 cm), iPhone 14 Pro, 5 scansioni. Errore in cm rispetto al metro, con il fattore di forma attuale (k = 1):

| Abiti | Petto | Vita | Fianchi |
|---|---|---|---|
| Pigiama (3 prove) | +23 … +38 | +17 … +23 | +9 … +11 |
| Aderenti (2 prove) | +3,7 / +0,9 | +2,7 / +1,6 | +1,1 / −1,3 |

Cosa ne abbiamo ricavato:

- **Gli abiti larghi sono il primo fattore d'errore.** Il tessuto aggiunge centimetri alla silhouette. Di profilo, con le braccia tese, una maglia larga pende davanti al petto (profondità letta 36 cm invece di circa 24). Gli abiti aderenti vanno chiesti come requisito, non solo consigliati.
- **Con abiti aderenti larghezze e profondità sono corrette**, e la scala che deriva dall'altezza è giusta.
- **Il fattore di forma della mesh era sbagliato per un corpo reale.** Valeva 1,13 per il petto e 1,04 per vita e fianchi, contro 0,96–1,01 misurato. Con il valore della mesh l'errore era +12/+15 cm sul petto e +5/+6 cm sulla vita. Ora `FIELD_K` in `measure.js` vale 1,0, il valore fisico: il giro coincide con il perimetro dell'ellisse. Non è stato adattato ai dati di una sola persona.
- Di conseguenza, sul corpo 3D di sviluppo (`dev/validate.js`) i giri escono ora qualche centimetro sotto i valori della mesh. Il banco di prova resta valido per larghezze, profondità, scala e flusso, ma non come riferimento assoluto per i giri.
- **Attrito:** nella vista di profilo l'istruzione «braccia in avanti» ha scartato da 145 a 526 fotogrammi per scansione. Ora la vista di profilo funziona come quella frontale:
  - le braccia non bloccano più il fotogramma: ogni zona raccoglie letture appena è libera dal braccio;
  - è tollerato un braccio che scende fino al 15% dell'altezza sotto le spalle;
  - l'istruzione compare solo se a una zona mancano letture, e dopo 4 s diventa «Alza un po' le braccia, sopra il petto»;
  - la fase si chiude dopo 12 s se ogni misura ha almeno 6 letture.

  Con le braccia lungo i fianchi non entra nessuna lettura attraversata dal braccio (test dedicato).

### Seconda serie (stesso giorno, 3 scansioni con abiti aderenti)

Errore in cm sulle 5 scansioni con abiti aderenti, con k = 1 e profondità dal 25° percentile:

| Scansione | Petto | Vita | Fianchi |
|---|---|---|---|
| 1 | +3,1 | +2,1 | +0,5 |
| 2 | +0,4 | +1,2 | −1,8 |
| 3 | +3,0 | +0,8 | +2,6 |
| 4 | +1,5 (solo fronte) | −1,0 | +3,6\* |
| 5 | +2,5 | +2,0 | +4,5 |
| **Media** | **+2,1** | **+1,0** | **+1,9** |

\* Rispetto a 94 cm: in quella prova il metro dei fianchi era stato scritto come 91.

- **Profondità di profilo.** Mentre ci si gira la profondità letta scende (fianchi da ~27,4 a ~25,6 cm) e si stabilizza solo a profilo pieno. Le letture a rotazione incompleta gonfiano la misura in un solo verso, quindi si usa il 25° percentile (`SIDE_DEPTH_QUANTILE`). Nei dati di calibrazione ora c'è anche l'angolo di ogni lettura laterale.
- **Fianchi.** La larghezza frontale delle ultime tre prove (35,3–36,3 cm) è più alta di quella delle prime due (34,6). È da capire: abiti diversi, mani vicine ai fianchi o posizione dei piedi.
- **Errore costante (+1,7 cm sui giri in media).** Non dipende dalla scala: l'altezza di 175 cm è confermata. La causa è il bordo della maschera di MediaPipe, che nasce a bassa risoluzione e viene ingrandita, quindi alla soglia 0,5 «sborda» verso l'esterno. Si corregge togliendo `MASK_EDGE_BIAS_PX` = 0,7 px per lato (circa 0,25 cm), solo sulle maschere di MediaPipe.

  Errore dopo la correzione, sulle stesse 5 scansioni:

  | | Media | Singole scansioni |
  |---|---|---|
  | Petto | +0,6 | +1,5 / −0,8 / +1,4 / +0,1 / +0,9 |
  | Vita | −0,6 | +0,5 / −0,4 / −0,8 / −2,6 / +0,5 |
  | Fianchi | +0,3 | −1,0 / −3,3 / +1,0 / +2,0 / +3,0 |

  Tutte le 15 misure sono entro ±3,3 cm. La correzione è calibrata su una sola persona: va confermata con altre corporature.

## Calibrazione sul campo (prossimo passo)

1. Misurare almeno 15–20 persone con il metro (petto, vita, fianchi, altezza), seguendo le stesse definizioni del modello.
2. Fare la scansione con abiti aderenti; salvare in locale (solo per il test) larghezze, profondità e giri stimati.
3. Ricalcolare `REAL_WORLD_REL` e, se emerge un errore sistematico, un fattore correttivo per misura.
4. Ricalcolare k e `depthRatio` mescolando i dati reali ai priori della mesh, e alzare le soglie di affidabilità solo se i dati lo giustificano.
