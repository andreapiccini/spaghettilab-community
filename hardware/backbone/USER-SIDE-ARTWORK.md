# Lato utente (Bottom): grafica e icone di stato — 2026-11-19

Il Bottom è il lato rivolto all'utente: nessun componente montato, solo serigrafia B.SilkS, aperture B.Mask e gli elettrodi touch. Le coordinate sotto sono quelle del PCB (vista KiCad dall'alto); guardando fisicamente il Bottom l'immagine è specchiata.

## Icone di stato illuminate

Quattro icone in colonna, in alto a destra guardando il lato utente, vicino al bordo (x = 149,7 mm sul PCB), passo 6 mm:

| Icona | Centro (x; y) | LED | Canale driver U70 |
|---|---|---|---|
| MASTER (corona) | 149,7; 65,5 | D804 | anodo CB6, catodo CB3 |
| WI-FI | 149,7; 71,5 | D805 | anodo CB7, catodo CB3 |
| BLE (Bluetooth) | 149,7; 77,5 | D806 | anodo CB8, catodo CB3 |
| LOCK (lucchetto) | 149,7; 83,5 | D807 | anodo CB9, catodo CB3 |

- Stesso metodo dei tasti touch: LED XL-1608UWC-04 bianco (LCSC C965808, footprint `TouchUI:LED_0603_Logo_Optical`) sul Top sotto il centro dell'icona; icona come apertura B.Mask (FR4 esposto, illuminato dal LED); contorno arrotondato 3,6 mm e etichetta in B.SilkS.
- Icone piccole, circa 1,8–1,9 mm (tratto 0,18 mm), vicine alle dimensioni del LED, per un'illuminazione uniforme.
- Zone per ogni icona: `Icon <nome> lens Dxxx` (r 0,3 mm, nessun rame su tutti e 4 gli strati), `Icon <nome> optical target` (2,6 × 2,6 mm, nessun rame su B.Cu/In1/In2), `Icon <nome> front no pours` (3,2 × 3,2 mm su F.Cu).
- Nessun GPIO aggiunto: i LED usano canali liberi della matrice CB del driver LED esistente (come D800–D803). Il firmware deve pilotare i quattro nuovi canali.
- Icone disegnate specchiate in x per essere lette correttamente dal Bottom (rilevante per il simbolo Bluetooth).
- Per far posto agli 8 LED (stato + memoria) sono stati ricollocati sul Top 35 componenti. Chip e MOSFET restano entro 9 mm (U12 8,7 mm, Q5 5,5, U2 4,0, U8 1,9, U75 1,6; U73 invariato). Più lontani solo passivi lenti o di disaccoppiamento generico: R15 (pull-up BOOT) 21,8 mm, R443 (pull-up CS di J26) 17,6 mm, C88/C410 (100 nF VCORE) 10–11,5 mm, RN11 11,1 mm; e componenti senza effetto elettrico: R112/R113/R114 (ponticelli 0 Ω verso reti AUX con un solo nodo), R124/R125/R127/R130 (un solo pad collegato).

## Finestre MEMORY 1–4

Colonna speculare alle icone di stato rispetto al centro della scheda (x = 185,8 mm sul PCB, stesse y 65,5 / 71,5 / 77,5 / 83,5), in alto a sinistra guardando il lato utente, titolo MEMORY. Solo illuminate, senza touch: indicano lo slot di memoria usato da LOAD/SAVE.

| Numero | LED | Canale driver U70 |
|---|---|---|
| 1 | D810 | anodo CB5, catodo CB4 |
| 2 | D811 | anodo CB6, catodo CB4 |
| 3 | D812 | anodo CB7, catodo CB4 |
| 4 | D813 | anodo CB8, catodo CB4 |

- Il numero è l'apertura B.Mask (testo vettoriale 1,6 mm, tratto 0,25 mm), cornice B.SilkS 3,6 mm come le icone di stato; stesse zone ottiche (lens, optical target, front no pours).

## Altra grafica

- **Logo SPAGHETTI LAB** in serigrafia bianca (alto 12 mm) sotto la rientranza dell'antenna, al posto dei titoli BACKBONE / ESP32-S3 · CAN / EXPANSION SPI + I2C. Rimosso il logo luminoso in basso con i suoi 16 LED (D780–D795) e le relative zone ottiche: sotto il modulo ESP non si possono montare LED.
- **J26 EXPANSION SPI + I2C**: anelli B.SilkS r 0,72 mm (tratto 0,16) sugli 8 fori, pillola r 1,05 mm (tratto 0,18) con stacco di 0,16 mm dagli anelli, nomi dei pin verticali GND, 3V3, SCK, MOSI, MISO, CS, SDA, SCL.
- **Tasti touch**: PLAY/STOP con i due simboli ridotti all'80 % e raccolti sopra il LED centrale D802; LOAD/SAVE ridisegnato con due icone semplici (vassoio con freccia in uscita = LOAD, freccia in entrata = SAVE), coppia centrata nel tasto (x 152,5), dentro l'anello touch (rame da r 2,06 mm); il LED D803 resta spostato di 1,15 mm verso il simbolo SAVE perché accanto c'è U70, quindi SAVE riceve un po' più luce di LOAD. Un LED per tasto: due LED richiederebbero di spostare U70, Q22 e Q23 di 15–25 mm.
- Legenda PORT STATUS rimossa.
- **Contorno del bordo**: linea B.SilkS da 0,35 mm che segue tutto il profilo esterno della scheda (orecchie, rientranze e raccordi), rientrata di 0,5 mm dal bordo; interrotta con 0,3 mm di margine dove passerebbe sopra pad scoperti sul Bottom o aperture della maschera (contatti magnetici, pogo).
- **Connettori SLOT A / SLOT B**: pillole verticali per colonna (i 3 fori di una colonna sono collegati in parallelo) ridisegnate con la stessa geometria di J26: anelli r 0,72 mm, pillola r 1,05 mm, stacco anello–pillola 0,16 mm, spazio fra pillole vicine 0,26 mm. Numeri 1–8 e scritte SLOT A/B invariati.
- **Lettere a–f** ai due lati di ogni fila di fori, come in una breadboard (a b c nel blocco superiore, d e f in quello inferiore); numeri 1–8 per le colonne invariati. Scritte SLOT A e SLOT B scambiate: SLOT A è ora il blocco inferiore.
- **Linea di divisione** da 0,35 mm a metà del canale centrale (y 109,41), tra le due file di numeri.
- **Canale DIP**: le due file affacciate (y 105,6 e 113,22) distano 7,62 mm con passo 2,54 mm: un integrato DIP stretto (0,3") si inserisce a cavallo del canale. Un DIP largo (0,6") non entra (le file distano 4,3 mm all'interno dello slot e 16,22 mm tra slot).
- **Finestre degli indicatori**: ogni porta è un unico oggetto verticale in serigrafia, senza elementi orizzontali che uniscano le colonne: pillola dei 3 fori → asticella sull'asse della colonna → "coppa" arrotondata (r 1,05 mm) che accoglie le 4 spie VCC/GND/MCU/X → piccolo arco di chiusura dopo l'ultima spia. Stesso tratto delle pillole (0,18 mm). La spia accesa si legge subito come stato di quella colonna. Rimosse le linee di raccordo con gomito.
- Tutte le scritte nuove rispettano l'altezza minima della scheda (0,8 mm, tratto 0,13 mm).

## Verifiche

- ERC: invariato (nessuna violazione nuova con D804–D807).
- DRC rispetto al commit precedente: nessun errore nuovo (24 errori preesistenti); warning da 70 a 68 (cambiano solo sovrapposizioni di serigrafia sul Top tra componenti ricollocati); parità schema/PCB invariata.
- ERC invariato con D804–D807 e D810–D813.
- Da verificare su prototipo: trasmissione della luce attraverso il FR4 e diffusione tra icone vicine (passo 6 mm).
