# ESP32-S3-MINI-1-N4R2 al posto dello zoccolo FlexyPin — 2026-11-19

U1 passa dallo zoccolo FlexyPin per ESP32-S3-WROOM-1/1U al modulo saldato **ESP32-S3-MINI-1-N4R2** (4 MB flash, 2 MB PSRAM quad, antenna PCB; LCSC C3013941). Obiettivo: tutte le 16 linee delle porte centrali su GPIO con ADC.

## Librerie

- Simbolo `ESP32Module:ESP32-S3-MINI-1-N4R2` (`ESP32Module.kicad_sym`): stessa grafica e stesse posizioni dei pin del vecchio simbolo, numerazione dei pad secondo la tabella 3-1 del datasheet MINI-1. IO26, IO33 e IO34 sono pin nuovi (sinistra in alto e lato superiore).
- Footprint `ESP32Module:ESP32-S3-MINI-1_Backbone` (`ESP32Module.pretty`): land pattern di KiCad `RF_Module:ESP32-S2-MINI-1`, che è quello abbinato da KiCad al simbolo `RF_Module:ESP32-S3-MINI-1` (stesso land pattern Espressif MINI). Modifiche: courtyard = corpo modulo + 0,25 mm; keepout antenna limitato alla rientranza tra le orecchie FR4 (18 mm di larghezza); rimossi i disegni Cmts.User del keepout standard ±22,7 mm; serigrafia tolta nella zona antenna; keepout su F.Cu/In1.Cu/In2.Cu/B.Cu.
- Modello 3D `ESP32Module.3dshapes/ESP32-S3-MINI-1.step` (e `.wrl`), scaricato da LCSC/EasyEDA per C3013941 con easyeda2kicad 1.0.1; offset Y −2,55 mm perché l'origine del footprint KiCad è 2,55 mm più in basso di quella LCSC (pad identici).

## PCB

- U1 sul **Top** (F.Cu), bloccato, centro (167,725; 68,33), lato antenna verso Y minori: tutto il montaggio resta su un solo lato (sul Bottom solo gli elettrodi touch). Il bordo del modulo lato antenna coincide con quello del vecchio WROOM (Y = 58,08): l'antenna sporge nella rientranza tra le orecchie, bordo scheda a Y = 62,3; prima fila di pad a Y = 63,88; keepout fino a Y = 63,08.
- 17 componenti Top che occupavano l'area del modulo sono stati ricollocati attorno ad esso (posizione libera più vicina, courtyard/pad reali, bordo e keepout rispettati, poi rifinitura via DRC). Non sbrogliati.

| Ref | Prima | Ora |
|---|---|---|
| U73 | (172,775; 71,663) r90 | (172,75; 81,75) r90 |
| U74 | (172,725; 77,663) | (167,25; 81,75) |
| U25 | (162,625; 74,588) r180 | (161,75; 81,75) r180 |
| U75 | (165,563; 70,25) | (157,75; 70,25) |
| U12 | (174,138; 66,625) | (177,75; 66,5) |
| U13 | (161,813; 68,675) r180 | (157,75; 65,75) r180 |
| Q7 | (162,225; 79,088) | (158,25; 77,0) |
| Q29 | (167,825; 73,703) r−90 | (177,75; 73,75) r−90 |
| RN9 | (169,075; 70,275) | (176,75; 70,25) |
| RN10 | (171,25; 67,625) | (179,0; 69,75) r90 |
| RN12 | (168,65; 67,35) r90 | (158,25; 73,5) r90 |
| C129 | (161,15; 65,325) | (154,25; 63,75) |
| C410 | (167,575; 76,55) r180 | (177,25; 76,5) r180 |
| C412 | (164,95; 79,088) r90 | (157,5; 79,75) r180 |
| C413 | (170,65; 65,25) | (178,25; 63,5) |
| C88 | (165,075; 67,35) | (177,25; 78,0) |
| C89 | (164,425; 65,325) r180 | (155,75; 77,5) r−90 |
- Rimosse le due asole di estrazione FlexyPin (166,2–169,2 × 63,5–66,0 e 77,8–80,3), che cadevano sotto i pad del MINI.
- Zone `ESP_FR4_BUMPER_LEFT/RIGHT` e contorno delle orecchie invariati.

## Assegnazione GPIO

| Linea | Rete lato ESP | GPIO | ADC |
|---|---|---|---|
| PORT_A0–A3 | A0–A3 | IO7–IO10 | ADC1_CH6–CH9 |
| PORT_A4–A5 | A4–A5 | IO1–IO2 | ADC1_CH0–CH1 |
| PORT_A6 | ESP_A6 | IO3 | ADC1_CH2 (strapping JTAG, vedi sotto) |
| PORT_A7 | ESP_A7 | IO4 | ADC1_CH3 |
| UP1 | ESP_UP1 | IO6 | ADC1_CH5 |
| UP2 | ESP_UP2 | IO5 | ADC1_CH4 |
| UP3–UP8 | ESP_UP3–UP8 | IO11–IO16 | ADC2_CH0–CH5 |

| Funzione | Prima | Ora |
|---|---|---|
| Qwiic J4 SDA / SCL | IO4 / IO5 (reti `IO4`/`IO5`) | IO41 / IO42 (reti `QWIIC_SDA`/`QWIIC_SCL`) |
| SPI esterno J21 CS / SCLK | IO11 / IO14 | IO21 / IO38 |
| SPI esterno MOSI / MISO | TXD0 / RXD0 | invariati |
| CAN TX / RX | IO17 / IO18 | invariati (ADC2_CH6/CH7, non usati come ADC) |
| I2C interno | IO47 / IO48 | invariati |
| USB | IO19 / IO20 | invariati |
| AUX R112–R114 | IO35–IO37 | invariati: liberi sulla N4R2 (PSRAM quad) |
| Non connessi | IO15 | IO26 (PSRAM interna), IO33, IO34, IO39, IO40 |

Reti rinominate perché il vecchio nome indicava il GPIO: `GPIO6/12/13/21/39/40/41/42_UPPER` → `ESP_UP1–UP8`, `GPIO16_LOWER` → `ESP_A6`, `GPIO38_LOWER` → `ESP_A7`, `IO4/IO5` → `QWIIC_SDA/SCL`. Il progetto `mezzanine/expansion` non è stato modificato.

## Limiti di ADC2 con Wi-Fi

ADC2 è usato anche dal driver Wi-Fi. Con Wi-Fi attivo `adc_oneshot_read()` su ADC2 può restituire `ESP_ERR_TIMEOUT` e in quel caso il valore non è valido: il firmware deve ritentare o leggere UP3–UP8 a Wi-Fi spento. Le porte che richiedono campionamento continuo o temporizzato vanno messe su PORT_A0–A7, UP1, UP2 (ADC1). Da verificare in ESP-IDF: supporto della modalità continua (DMA) per ADC2 su ESP32-S3.

IO3 (PORT_A6) è uno strapping pin: viene letto solo se è bruciato l'eFuse di selezione della sorgente JTAG, altrimenti è libero. I bus switch delle porte devono restare aperti finché il boot non è completato.

## ESP32-S31

Non esiste un modulo S31 compatibile con questo footprint e questa piedinatura. Il modulo ufficiale è ESP32-S31-WROOM-3 (22 × 30 mm, 99 pin); l'S31 ha GPIO0–GPIO59 e gli ADC su GPIO42–GPIO57 a coppie differenziali. JLCPCB elenca un "ESP32-S31-MINI-1-H16R16V" senza datasheet Espressif pubblicato. Il passaggio all'S31 richiede una nuova revisione o un modulo su adattatore.

## Verifiche

- Netlist: tutte le 16 linee porta raggiungono un GPIO ADC tramite i 74CBTLV3125; 0 discrepanze tra reti dei pad del PCB e schema.
- ERC (kicad-cli 10.0.3): 8 errori `wire_dangling` preesistenti, invariati; nessuna violazione nuova su U1 (i `pin_to_pin` Unspecified/Bidirectional c'erano già).
- DRC (kicad-cli 10.0.3, con parità schema), dopo lo spostamento sul Top: da 121 a 76 violazioni rispetto a HEAD (errori da 67 a 25: −40 `annular_width` FlexyPin, −1 `copper_edge_clearance`, −1 `courtyards_overlap`); warning di serigrafia non aumentati; nessuna violazione su U1 o sui 17 componenti spostati. Restano 499 connessioni da sbrogliare e i rilievi preesistenti.
- Keepout antenna su F.Cu, In1.Cu, In2.Cu, B.Cu.

## Da fare

- Sbroglio dell'area ESP (IO espansori U25/U73/U74 ora sotto il modulo, bus switch ai lati).
- `ARCHITECTURE-MAP.md` / `ESP32-AG32-PROGRAMMING.md` descrivono GPIO15 → BOOT0 e GPIO16 → NRST dell'AG32 sulla mezzanina: con questa revisione IO15/IO16 sono UP7/UP8. Se la mezzanina AG32 torna, va riassegnato il canale di programmazione (es. IO39/IO40 liberi).
- Firmware: mappa porte → canali ADC della tabella sopra; ADC2 con ritentativi o a Wi-Fi spento.

Fonti: [datasheet ESP32-S3-MINI-1](https://documentation.espressif.com/esp32-s3-mini-1_mini-1u_datasheet_en.html), [ESP-IDF ADC oneshot ESP32-S3](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/peripherals/adc/adc_oneshot.html), [datasheet ESP32-S31](https://documentation.espressif.com/esp32-s31_datasheet_en.html), [ESP32-S31-WROOM-3](https://documentation.espressif.com/esp32-s31-wroom-3_wroom-3u_datasheet_en.html), [LCSC C3013941](https://www.lcsc.com/product-detail/C3013941.html).
