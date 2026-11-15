# Capi 3D reali (foto + tabella taglie + scheda prodotto → Blender → GLB → viewer)

```
assets/products/grillz-tee/ (foto davanti, tabella taglie)
        │
        ├─ pattern.py        cartamodello: davanti, dietro, manica separata, colletto; graduato dalla tabella; ogni numero ha una provenienza
        ├─ prep_texture.py   texture dalla foto (retro = segnaposto)
        ├─ build_tee.py      UNA cloth sim per taglia sul corpo neutro + rifinitura → GLB + JSON di metadati
        ├─ check_tee.py      criteri di accettazione misurati sulla mesh finale (scrive "measured" e "checks" nel JSON)
        └─ build_all.sh      tutto con un solo comando
        ▼
frontend/public/assets/garments/grillz-tee/tee-<taglia>.glb + .json
        ▼
frontend/src/core/garment/bound.js   adattamento al corpo dell'utente a RUNTIME (nessuno shape key del capo)
```

## Prodotti (`products.py`)

| Prodotto | Costruzione | Tabella taglie | Scheda prodotto (source/*detail*.md) | Particolarità |
|---|---|---|---|---|
| `grillz-tee` | spalla scesa, manica a giro | **del negozio** | Loose, 100% cotone, **250 gsm**, washed, slight stretch | riferimento della taratura del tessuto |
| `kermit-tee` | spalla scesa, manica a giro (forma del taglio della Grillz, nella scala vera della foto) | **del negozio** (`Source/tabella_taglie.csv`) | Loose, 88,9% cotone, **350 gsm**, thick, washed | orlo e maniche a taglio vivo (nessun risvolto); tessuto più pesante |
| `drivingmato-tee` | **raglan** (`pieces_raglan`): cuciture diagonali dal colletto all'ascella, la manica porta la sua parte di costina | **del negozio** (`source/tabella_taglie.csv`: lunghezza, petto, manica dal colletto; niente spalla) | Loose, 70,1% cotone, **250 gsm** | maniche e colletto a contrasto dalla foto |

- La grammatura della scheda entra nella sim con una regola dichiarata (`fabric_overrides`): massa ∝ gsm, flessione ∝ gsm², rispetto alla
  taratura fatta sulla Grillz a 250 gsm (massa 0,30, flessione 20). Kermit a 350 gsm: massa 0,42, flessione 39,2. È una regola, non una misura
  della caduta del tessuto: l'effetto è stato solo verificato a occhio (Kermit cade più rigida e «scatolata», con meno pieghe).
- La GSM viene dalla scheda prodotto e va **confermata dal negozio**.
- Kermit e DrivingMato hanno ora la **tabella del negozio**. La scala delle foto è ricavata dal petto di tabella (Kermit 59 cm = 1269 px,
  DrivingMato 55 cm = 538 px); i tagli misurati sulla foto con la scala provvisoria sono riportati a quella vera (`_scale_cut`).
  Le foto sono mockup: Kermit è lunga 67,3 cm (tabella 70), DrivingMato 73,6 (tabella 69): vale la tabella, come per la Grillz.
- DrivingMato: la manica di tabella (39 cm in S) è intesa come **bordo superiore della manica, dal colletto all'orlo manica** (ASSUNTO: nella
  foto quel bordo misura 42,1 cm). Se il negozio la misura in un altro modo va cambiato `sleeve_top` in `pattern.garment_measures`.
- Manca per tutti la **foto del retro** (retro = segnaposto liscio; maniche e colletto dietro riusano la foto del davanti).
- Nuovo prodotto: voce in `products.py`, `python3 blender/garment/prep_texture.py <id>`, bake, poi una riga in
  `frontend/src/core/garment/assets.js` e il prodotto nel catalogo.

## Un solo comando

```bash
sh blender/garment/build_all.sh            # S M L XL 2XL: bake (2 in parallelo), verifica dei criteri, contact sheet
sh blender/garment/build_all.sh M          # una taglia sola
PRODUCT=kermit-tee sh blender/garment/build_all.sh    # un altro prodotto (log in blender/out/garment/<prodotto>/)
```

Log e risultati in `blender/out/garment/` (`build_<taglia>.log`, `check_<taglia>.log`, `sheet/sheet_<taglia>.png`).
Una taglia richiede circa 2,5 minuti di sim (Intel i5 4 core) più 10-20 s di rifinitura. Per rifare solo la rifinitura sulla sim già salvata:
`Blender -b blender/man-model.blend --python blender/garment/build_tee.py -- --size S --refinish`.

## Da dove vengono le misure (misurato vs assunto)

| Dato | Fonte |
|---|---|
| lunghezza, spalla, petto, manica (per taglia) | **tabella taglie** (fonte primaria). La manica è intesa «punto spalla → centro del polsino»: sulla foto vale 21,3 cm contro 20,9 di tabella |
| scollo (larghezza cucitura 16,8 cm, profondità davanti 7,3 cm al bordo interno), larghezza costina 1,9 cm, pendenza spalla 20,5°, **curva del giromanica** (rientro fino a 3,1 cm), angolo manica 28,7°, apertura manica, profondità ascella 34,3 cm | **misurati sulla foto del davanti** (scala 13,98 px/cm ricavata da petto 55,5 cm = 776 px) |
| bordo alto del colletto dietro (1,3 cm sotto la linea delle spalle) | **misurato sulla foto** (si vede attraverso lo scollo); la *forma* della curva dietro è assunta |
| giromanica dietro | **ASSUNTO** uguale al davanti |
| altezza dei risvolti di orlo e polsini (2 cm), spessore tessuto (0,9 mm) | **ASSUNTI** (valori tipici) |
| scollo nelle altre taglie | **ASSUNTO** costante (la tabella non lo gradua) |
| grafica nelle altre taglie | **ASSUNTO**: scala con il petto |
| **retro** (grafica, etichetta, scollo reale) | **MANCANTE**: texture segnaposto liscia |
| **grammatura (GSM)** | dalla scheda prodotto (`source/*detail*.md`), **da confermare**; i parametri della sim restano tarati «a occhio» (vedi sotto) |
| spessore del colletto (4,0 mm; Kermit 4,6) | **ASSUNTO** (costina «leggermente più spessa e visibile») |
| allargamento dello scollo sul manichino (fino all'8%) | **ASSUNTO** (jersey leggermente elastico), valore effettivo in `neckline` nel JSON |

La foto è un mockup lungo 66,4 cm mentre la tabella dice 70: la lunghezza segue la tabella (la parte liscia sotto la stampa viene allungata).
Le stesse provenienze sono scritte in ogni `tee-<taglia>.json` (chiave `sources`); la chiave `data_quality` riassume cosa è reale, assunto,
mancante (`size_chart_assumed: true` per Kermit e DrivingMato).

### Cosa serve per togliere i segnaposto

1. **Foto del retro** stesa, stessa inquadratura del davanti (anche senza grafica: serve per colore, etichetta, cuciture).
2. **Scollo dietro**: profondità dal punto alto della spalla alla cucitura del colletto, al centro dietro.
3. **Colletto**: altezza della costina finita e, se possibile, lunghezza della costina tagliata (o il rapporto con la cucitura).
4. **GSM** del tessuto (e composizione, se non è 100% cotone).
5. **Drop spalla / giromanica dietro**: se la cucitura della spalla è spostata in avanti e di quanto; curva del giromanica dietro.
6. **Apertura manica** e **orlo** (giri) per taglia, e altezza dei risvolti: oggi l'apertura è presa dalla foto e scalata, l'orlo è posto uguale al petto (fianco dritto).

## Cartamodello (`pattern.py`)

- Davanti e dietro: spalla inclinata, scollo, **giromanica curvo**, fianco dritto, orlo.
- **Manica separata**: nella foto è piegata lungo il bordo superiore; il pezzo intero è la metà visibile più la sua riflessa. La testa della manica è
  la stessa curva del giromanica (lunghezze identiche: cucitura vertice a vertice).
- **Colletto**: fascia a costina tra bordo interno e cucitura; orlo e polsini con la linea della ribattitura.
- Taglie: `python3 blender/garment/pattern.py` stampa cartamodello contro tabella per S…2XL (coincidono per costruzione); con due argomenti
  (`foto.png out.png`) sovrappone il contorno alla foto.

## Sim e rifinitura (`build_tee.py`)

1. Pezzi triangolati (passo 1,2 cm, reticolo simmetrico), cuciture = coppie di vertici.
2. **Vestizione** col corpo a braccia alzate all'angolo della manica del cartamodello: i pezzi stesi combaciano senza tensioni; le maniche sono
   piegate a U sopra le braccia; le molle di cucitura chiudono le cuciture (scarto finale ≤ 4 mm).
3. Saldatura, poi le braccia scendono nella posa naturale e il tessuto si assesta.
4. **Rifinitura** (numpy, deterministica): levigatura lungo la normale; simmetria esatta (la metà destra è lo specchio della sinistra: pieghe vere,
   non una media); **girocollo ricostruito** (vedi sotto); giro dell'orlo riportato al cartamodello (scala orizzontale sfumata, solo scarti < 1,2%);
   lunghezze dei lati riportate al cartamodello (*strain limiting* con il corpo come vincolo); dove riallungare creerebbe auto-intersezioni
   (tessuto schiacciato tra braccio e busto) quei vertici restano come nella sim; spessore del colletto e risvolti di orlo e polsini come strati.
5. Export: GLB con texture, colore per vertice sulle cuciture, attributo `_SLEEVE` (peso «manica» per il runtime); JSON con misure, provenienze,
   parametri, tempi.

### Girocollo (`rebuild_collar` + `collar_grid`)

- **Cucitura**: resa una curva regolare e simmetrica (prime 3 armoniche di Fourier dell'anello): niente punta al centro davanti.
- **Scollo più piccolo del collo del manichino**: lo scollo si allarga quanto basta perché la costina resti stesa (obiettivo 50°), con la
  cucitura al massimo l'8% più lunga del cartamodello (valore effettivo in `neckline` nel JSON).
- **Profilo della fascia**: dalla cucitura verso il collo in 4 tratti; ogni tratto parte «verso il collo e un po' in su» (25°) e, dove
  entrerebbe nel corpo, si appoggia alla pelle seguendone la curva. Prima erano due tratti rigidi: ai lati e dietro la costina si staccava
  («orecchie») e dall'apertura si vedeva l'interno del capo.
- **Strato visibile = guscio a griglia** (`collar_grid`): 4 file × 3 colonne per lato di cucitura, faccia esterna a `collar_mm` dal profilo
  (smussata alla cucitura), bordo arrotondato verso il collo, faccia interna. I triangoli del pezzo nella fascia (una sola fila, grossi) e
  i triangoli degeneri sulla linea della spalla vengono tolti dal capo esportato: la texture a coste ci «nuotava» sopra a zig-zag, il bordo
  seguiva la triangolazione e in alcune taglie tagliavano il profilo curvo. La fascia viene ricostruita per ULTIMA e resta ferma.
- **Colore**: la costina campiona la parte centrale della costina fotografata (prima il bordo interno prendeva dalla foto l'interno del
  retro: era quello a far sembrare lo scollo «a V»). La costina dietro riusa quella davanti (ASSUNTO).
- **Raglan**: la manica campiona sempre la foto dalla propria parte della cucitura (margine 2,5 cm). La foto della DrivingMato non è
  simmetrica: a destra, vicino al colletto, il confine tra i colori sta ~2 cm oltre la cucitura del cartamodello, e la metà dietro della
  manica riusa la foto del davanti. Prima la manica prendeva il bianco del busto (bordo a denti, toppe chiare dietro).
- `python3 blender/tools/neck_sheet.py` rende il collo di tutti i prodotti; nel render Workbench la costina può apparire a facce scure
  (normali importate): fa fede il viewer, con `lab.view(x, y, z, ty, fov)` per le inquadrature.

### Texture del retro (`prep_texture.py`, segnaposto finché manca la foto)

Colore di fondo per riga (letto nelle fasce laterali del davanti, senza grafica: segue la sfumatura «washed», es. Kermit chiara in alto e
scura in basso) più la sola grana del tessuto. Prima era la zona liscia del davanti ripetuta a specchio: le sue ombre larghe facevano un
salto a ogni piastrella (righe orizzontali sulla schiena) e il retro della Kermit era tutto del colore scuro della parte bassa.

### Tessuto: taratura un parametro alla volta

Unità della cloth sim di Blender (non fisiche). Ogni riga cambia un solo parametro rispetto alla precedente; l'effetto è quello osservato nei render.

| Prova | Cambio | Effetto | Esito |
|---|---|---|---|
| A | partenza: flessione 3, distanza di collisione 6 + 4 mm, costina morbida anche a compressione | grinze piccole ovunque, capo sollevato dal corpo, colletto arricciato | — |
| B | collisione 3 + 2 mm; costina morbida solo a trazione | capo più vicino al corpo, colletto meno arricciato; grinze piccole ancora presenti (asimmetria media 6,2 mm) | tenuto |
| C | flessione 3 → 8 | meno grinze, pieghe più larghe (asimmetria 5,0 mm) | meglio |
| D | flessione 8 → 20 | superficie liscia, poche pieghe ampie sotto il braccio e ai fianchi (asimmetria 3,8 mm) | meglio |
| E | flessione 20 → 40 | più «scatolata», maniche che restano larghe e staccate dal braccio (asimmetria 3,1 mm) | **scelto** |
| F | massa 0,3 → 0,5 (con flessione 20) | tessuto che si affloscia e aderisce, grinze sulle maniche (asimmetria 9,1 mm) | scartato |
| G | flessione 40 → 20 (Grillz M, colletto nuovo) | pieghe dall'ascella all'orlo leggibili, manica che scende sul braccio, spalla senza «spallina»; tutti i criteri rispettati | **scelto** (il capo a 40 era liscio/«plastico») |
| H | flessione 40 → 12 | grinze piccole sulla schiena e trama della mesh visibile | scartato |
| I | DrivingMato: trazione 12 → 40 (con flessione 20) | lunghezza −1,55 cm, orlo +0,72 cm | scartato: resta 12 |
| J | risvolti di orlo e polsini morbidi quanto il tessuto (`hem_bend` 0,6 → 0), flessione 20 | orlo 45,9 → 44,2 cm: la campana resta | da solo non basta |
| K | flessione 20 → 3 (risvolti rigidi) | orlo 46,6 cm | da solo non basta |
| L | flessione 3 + risvolti morbidi | orlo 46,7 cm | non basta |
| M | flessione **1** + risvolti morbidi | orlo 42,0 cm (fianchi 37,8), pieghe all'orlo 1,3% → 6,3%, maniche appoggiate al braccio, tutti i criteri rispettati | **scelto** |
| N | flessione 0,5 e 0,2 | orlo 43,3 e 44,2 cm: nessun guadagno | — |
| O | massa 0,3 → 0,5; trazione 40 → 15 (con M) | orlo 42,9 e 43,7 cm; lunghezza +0,38 e +0,66 cm | scartati |
| P | polsini: risvolto morbido (0) → rigido (`cuff_bend` 0,6), orlo del busto morbido | a 0 il polsino si accartoccia sul braccio (manica «arrotolata»); a 0,6 la manica resta aperta e pulita, orlo 43,3 cm, tutti i criteri rispettati | **scelto** |

Misura della «campana»: `blender/tools/drape_shape.py`. Con la taratura M la semi-larghezza del capo va da 17,8 cm in vita a 21,0 all'orlo
(prima 23,0): quello che resta è la differenza tra vita (28 cm) e fianchi (37 cm) del manichino, attorno a cui il tessuto deve passare.

Valori finali in `FABRIC` dentro `build_tee.py` e `REF_*` in `products.py`. Confronto affiancato: `python3 blender/tools/variant_sheet.py`. **Senza GSM e senza una prova di caduta del tessuto vero questa taratura è estetica, non fisica.**

## Criteri di accettazione (`check_tee.py`)

Misurati sulla mesh 3D finale: ogni misura è la lunghezza, lungo la superficie, della stessa linea che si misura sul capo steso.

| Criterio | Soglia |
|---|---|
| petto (giro, 2,5 cm sotto l'ascella), orlo (giro), lunghezza, manica = tabella | ± 0,3 cm |
| spalla = tabella (criterio aggiuntivo: sul capo indossato quella linea porta il peso del capo) | ± 0,5 cm |
| distanza minima dal corpo, nessun vertice dentro | > 2 mm |
| simmetria sinistra/destra | ≤ 0,5 mm |
| auto-intersezioni | 0 triangoli |
| quota dell'orlo = filo teso lungo quanto il capo, dall'HPS attorno al profilo del petto e poi in verticale | ± 2,5 cm |
| spessore del colletto = dichiarato | ± 0,4 mm |
| tempo di bake | riportato |

## Adattamento al corpo a runtime (`frontend/src/core/garment/bound.js`)

Non c'è uno shape key del capo per ogni misura del corpo: il capo viene ricalcolato dalla forma vera del corpo (tutte le misure insieme).

- **Appoggio**: dove il tessuto poggia dall'alto (spalle, trapezio, colletto) segue la pelle sottostante.
- **Caduta**: il busto pende dalle spalle; raggio = corpo «drappeggiato» (guscio convesso, regola di caduta verticale) + `s` × ease della sim.
  `s` è scelto fetta per fetta perché **il giro del tessuto resti quello della sim**: corpo più grande → ease e pieghe si consumano; `s = 0` →
  capo teso sul corpo, segnalato nel report come «stretto». La lunghezza del meridiano è conservata (una pancia alza l'orlo davanti).
- **Manica**: nel riferimento del braccio (spalla → gomito, dai vertici del corpo), conservando il giro della manica.
- Con l'altezza il capo sale con le spalle e non si allunga. Col corpo neutro il risultato è esattamente la sim.

Strumenti: `node frontend/scripts/deform-asset.mjs --in tee-S.glb --body 120,,, --out x.glb` applica il deformatore offline (stesso codice del
viewer); `python3 blender/tools/garment_sheet.py` produce la contact sheet da 8 viste × corpi × taglie; `python3 blender/tools/compare_hybrid.py`
lo confronta con una sim vera sullo stesso corpo.

### Runtime contro sim vera (taglia XL, `compare_hybrid.py`)

| Corpo | Sim sul corpo modificato | Runtime | Distanza runtime ↔ sim | Capo neutro non adattato ↔ sim |
|---|---|---|---|---|
| vita 95 + fianchi 110 | 297 s, risultato pulito | 36 ms (+ 0,4 s una volta per legare il capo) | media 8,4 mm, 95% entro 21 mm; orlo 78,3 contro 78,9 cm | media 10,9 mm, 95% entro 28 mm |
| petto 120 | 414 s, **sim fallita** (capo accartocciato sul torace, orlo a 97,9 cm) | 36 ms | non confrontabile | — |

La sim diretta su un corpo molto diverso dal neutro non è affidabile (la vestizione si incaglia); il runtime parte dalla sim buona sul corpo
neutro e resta pulito. Immagine affiancata: `blender/out/truth/compare.png`.

### Continuità: corpo quasi neutro (il corpo di partenza del widget)

Il widget parte da misure arrotondate (95/79/96/173 cm), non dal corpo neutro esatto (95,18/78,55/96,2/173,44). Due difetti si vedevano solo lì:

- **Scatti con l'altezza.** Lo spostamento verticale delle spalle veniva seguito a passi di una fetta (1,2 cm): tra un passo e l'altro il capo
  restava indietro e si deformava (0,44 cm di altezza in meno → 2400 vertici spostati di oltre 3 mm, fino a 15-17 mm, in modo irregolare: busto
  a bozzi, colletto e maniche frastagliati). Ora le fette del corpo sono tagliate su una griglia che scorre con le spalle: il capo è la sim
  traslata (scarto orizzontale < 0,3 mm). Test: «il capo segue le spalle in modo continuo».
- **Sicurezza sulla pelle troppo zelante.** Si disattivava solo col corpo esattamente neutro e portava a 3 mm anche i vertici che nella sim
  stavano più vicini (colletto, risvolti). Ora la soglia è per vertice: mai più vicino alla pelle di quanto fosse nella sim.

`blender/tools/garment_sheet.py` e il lab vanno provati anche con `body=95,79,96,173`, non solo col neutro esatto.

### Cambiando il petto (o un'altra misura) il capo non deve riempirsi di bozzi

Misura: variazione della forma locale del tessuto rispetto alla sim (posizione − media dei vicini), in mm. Grillz M:

| Zona | petto 84, prima | petto 84, ora | petto 110, ora |
|---|---|---|---|
| maniche | 0,86 | 0,29 | 0,44 |
| spalle (tessuto che poggia) | 1,20 | 0,34 | 0,27 |
| petto alto (y 1,3-1,4 m) | 0,74-0,87 | 0,24-0,25 | 0,35-0,46 |

Tre cause, tutte nel deformatore (`bound.js`):
- la **sicurezza sui vertici del corpo legati a riposo** confrontava il capo col piano tangente di punti di pelle lontani fino a 2,5 cm: su una
  zona convessa vedeva violazioni di 6-9 mm inesistenti e spingeva 2500 vertici anche con un corpo più piccolo. È spenta (`REST_SAFETY`);
  la distanza vera dal corpo non cambia (S a petto 120: 2 vertici dentro senza, 3 con; M a petto 84: 0 in entrambi i casi);
- le spinte della sicurezza sulla forma corrente ora trascinano i vertici vicini (`SAFETY_SPREAD`) invece di lasciare punte;
- lo **spostamento del capo rispetto alla sim** viene lisciato sulla maglia (`DISP_SMOOTH`): le regole lavorano vertice per vertice e
  lasciavano differenze di qualche millimetro tra vicini. Le pieghe della sim restano, il rumore alla scala della maglia no.

Costo: circa 75-90 ms per aggiornamento quando il corpo non è neutro (49 ms col neutro), su Intel i5 4 core.

### Strati aggiunti e vertici duplicati (runtime)

- Guscio della costina e risvolti (`_layer` > 0) seguono lo spostamento dei 3 vertici dello strato base più vicini: adattati per conto
  proprio scorrevano e lungo la cucitura del colletto si apriva una fessura con la pelle in vista (Kermit M su 114/95/104/185).
- Le lisciature lavorano sulla mesh saldata e a fine calcolo i vertici duplicati (stessa posizione, texture diverse) vengono riuniti:
  lisciati separatamente il capo si apriva lungo la cucitura della spalla. Test: «gli strati aggiunti restano attaccati…».
- `AssetGarment.setInfluences` non ricalcola se le influence non sono cambiate: il motore la chiama due volte a ogni cambio di misura.
- Se il GLB del capo non si carica, il motore ripiega sul capo parametrico (prima restava il corpo senza capo e senza avviso).

### Estremi degli slider (misurati con `python3 blender/tools/worn_extremes.py`, taglie L e 2XL dei tre prodotti)

Il deformatore ha una seconda sicurezza calcolata sulla forma CORRENTE del corpo (vertice del corpo sotto il tessuto e sua normale di adesso):
prima, a petto 130 e altezza 200, restavano fino a 260 vertici dentro la pelle (18 mm). Costo: ~60 ms invece di ~35 quando il corpo non è neutro.

| Corpo | Vertici dentro il corpo (su ~9500-11000), ultima misura |
|---|---|
| neutro, vita 120, altezza 155 | 0 in tutti i 18 casi |
| petto 130 | 0-8 (max 3,2 mm) |
| fianchi 124 | 0-4 (max 1,8 mm) |
| altezza 200 | 0-1 |
| petto 130 + vita 120 + fianchi 124 + altezza 155 | 0-17 |
| petto 130 + vita 120 + fianchi 124 + altezza 200 | 23-140, nella piega dell'ascella, max 7,6 mm |

29 casi su 48 senza alcun vertice dentro.

Nel viewer, sul corpo «grande e alto 200», non si vedono buchi né fasce; resta una piega curva sulla schiena all'altezza delle scapole e, sulla
raglan L a petto 130, la schiena è irregolare vicino alle cuciture (capo segnalato «stretto» di 10-14 cm).

### Limiti noti del runtime (misurati prima della seconda sicurezza)

- **Petto molto più grande del neutro** (120 cm): 15-16 vertici su circa 8000 finiscono dentro il corpo, nell'ascella, fino a 4 mm
  (`blender/tools/check_worn.py`); l'orlo si allarga a punta ai fianchi. Su neutro e su vita 95 + fianchi 110: zero vertici dentro, minimo 2,8 mm.
- **Corpo molto più piccolo e basso del neutro** (82/66/86, 160 cm): l'ease della schiena bassa finisce sopra i glutei e fa un rigonfiamento.

### Stato dei criteri (ultima build: tessuto morbido, tabelle dei negozi per tutti e tre)

| Prodotto | Taglie che passano tutti i criteri | Fuori tolleranza |
|---|---|---|
| Grillz | S M XL 2XL | L: lunghezza −0,30 cm (al limite della tolleranza; era −0,24 prima del colletto nuovo) |
| Kermit | L XL 2XL | S: spalla +1,30 cm (tolleranza 0,5: spalla di tabella 58 cm su un manichino stretto, il tessuto pesante la tende) e lunghezza −0,32; M: lunghezza +0,36 cm |
| DrivingMato | nessuna | petto −0,37…−0,50 cm su M L XL 2XL (compressione orizzontale residua che la rifinitura non scioglie nella raglan); S: manica −0,42; M e XL: quota dell'orlo; XL e 2XL: lunghezza +0,3…0,4 |

Caduta (`blender/tools/drape_shape.py`): orlo largo 43,7-46,2 cm su fianchi di 37-38 cm in tutte le taglie, pieghe all'orlo dal 4% (S) al 10% (2XL).
