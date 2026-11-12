# Backbone V3

Aprire `backbone-v3.kicad_pro` in KiCad. Il progetto contiene lo schema gerarchico e il PCB da **68,5 × 63,5 mm**. L’[anteprima interattiva](anteprima-interattiva.html) simula i quattro comandi, Play/Stop, il blocco e le quattro memorie. Le modalità delle righe sono 3.3V, GND, MCU e X (scollegata). I tasti in basso hanno solo le icone.

## Touch

Due Holtek BS812A-1 (LCSC C81747) alimentati a 3,3 V leggono due elettrodi ciascuno. I quattro elettrodi sono anulari e coperti da solder mask sul lato breadboard, con i LED sul lato opposto. I condensatori di taratura da 10 pF sono predisposti DNP. Le uscite attive basse sono lette dal TCA9536 (I²C interno, indirizzo 0x41). La lettura è digitale sia con ESP32-S3 sia con ESP32-S31 sul socket FlexyPin.

| Bit | Comando |
| --- | --- |
| P0 | Play/Stop |
| P1 | + |
| P2 | Mode |
| P3 | Load/Save |

Il firmware deve leggere il registro di ingresso 0x00, con P3 configurato come ingresso. Il comportamento dei comandi è simulato nell’anteprima. I tre segmenti della batteria sono indipendenti e attendono il dato di carica dal modulo batteria.

## Frontale e LED

Il driver IS31FL3731 (I²C interno, 0x74) pilota 105 LED. La [mappa del frontale](layout.json) riporta le reti di anodo e catodo, il registro PWM e il codice LCSC per ciascun emettitore. Le 16 righe hanno 64 LED 0402 a ±45°. I 0603 sono stati usati dove le piazzole rispettano le aperture e lo spazio disponibile. In totale ci sono 86 LED 0402 e 19 LED 0603. Il logo usa 20 LED blu (16 da 0402 e 4 da 0603) distribuiti su simbolo e lettere.

Le finestre sono aperture nelle due solder mask con esclusione di rame sui quattro strati. Rimane FR-4 pieno. I LED sono componenti a emissione frontale, piazzati sul Top per la prova di montaggio rivolto verso il laminato. Servono un campione per verificare saldabilità, uniformità della luce e sensibilità degli elettrodi, e il routing del PCB prima della fabbricazione. J32 e J33 sono stati riposizionati per liberare le finestre.

## Verifica KiCad

Lo schema ha superato l’ERC senza errori. Sono state confrontate 1.065 associazioni piazzola–rete tra schema e PCB. Il DRC non segnala cortocircuiti o piazzole nelle aree ottiche. Restano 499 connessioni da instradare e segnalazioni su courtyard, serigrafia e distanze del PCB, comprese quelle dei contatti magnetici al bordo.

## Variante RGB

L’[anteprima RGB con MODE](anteprima-rgb-mode.html) conserva il confronto con la proposta precedente.
