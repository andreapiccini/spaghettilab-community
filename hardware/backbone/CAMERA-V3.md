# Camera DVP e Qwiic — Backbone V3

Aggiornamento 2026-10-27. Implementazione nello **schema** `backbone.kicad_sch`; PCB, routing, firmware e prove fisiche non aggiornati da questa modifica.

## Circuito aggiunto

| Riferimenti | Funzione |
|---|---|
| U9 ME6211C28M5G-N | VAUX 3,3 V → CAM_2V8, alimenta AVDD e DOVDD |
| U10 ME6211C15M5G-N | VAUX 3,3 V → CAM_1V5, alimenta DVDD |
| C75–C78 | 4,7 µF / 10 V X7R, ingresso e uscita di ciascun LDO |
| C79, C80, C81 | 100 nF presso J5, rispettivamente pin 4, 11, 10 |
| Q3, Q4 BSS138 | Adattamento bidirezionale SCCB tra IO4/IO5 a 3,3 V e camera a 2,8 V |
| R24–R27 | Pull-up 4,7 kΩ, due per ciascun lato del bus |
| U11 SN74LVC1G125DBVR | Buffer XCLK: ingresso GPIO15, uscita a 2,8 V; OE a GND |
| C82, R30 | 100 nF presso U11 e 33 Ω serie su XCLK |
| R28, R29 | RESET_N alto a 2,8 V e PWDN basso, entrambi con 10 kΩ |
| C83 | 100 nF presso l'alimentazione Qwiic |

Tutti i nuovi componenti hanno footprint assegnato. I quattro simboli attivi sono anche nella libreria SpaghettiLAB. `#FLG0105` dichiara VAUX alimentata da U5: il simbolo AP2112 importato ha pin elettrici generici, quindi KiCad non riconosce da solo l'uscita di U5 come sorgente. Non è un componente fisico.

## J5: flat camera 24 poli

Piedinatura di riferimento ESP32-S3-EYE-MB V2.2. I numeri indicano i contatti J5; non vanno interpretati come GPIO. La mappatura GPIO è specifica spaghettiLAB e conserva tutte le assegnazioni esistenti.

| J5 | Funzione | Rete / GPIO |
|---|---|---|
| 1 | NC | Non collegato |
| 2 | AGND | GND |
| 3 | SCCB SDA | CAM_SDA → Q3 → IO4 / GPIO4 |
| 4 | AVDD | CAM_2V8 |
| 5 | SCCB SCL | CAM_SCL → Q4 → IO5 / GPIO5 |
| 6 | RESET_N | Pull-up 10 kΩ a CAM_2V8 |
| 7 | VSYNC | IO6 / GPIO6 |
| 8 | PWDN | Pull-down 10 kΩ a GND |
| 9 | HREF | IO1 / GPIO1 |
| 10 | DVDD | CAM_1V5 |
| 11 | DOVDD | CAM_2V8 |
| 12 | Y9 / D7 | IO21 / GPIO21 |
| 13 | XCLK | CAM_XCLK ← R30 ← U11 ← IO15 / GPIO15 |
| 14 | Y8 / D6 | IO18 / GPIO18 |
| 15 | DGND | GND |
| 16 | Y7 / D5 | IO17 / GPIO17 |
| 17 | PCLK | IO2 / GPIO2 |
| 18 | Y6 / D4 | IO42 / GPIO42 |
| 19 | Y2 / D0 | IO38 / GPIO38 |
| 20 | Y5 / D3 | IO41 / GPIO41 |
| 21 | Y3 / D1 | IO39 / GPIO39 |
| 22 | Y4 / D2 | IO40 / GPIO40 |
| 23 | NC | Non collegato |
| 24 | NC | Non collegato |

Ordine firmware D0..D7: **38, 39, 40, 41, 42, 17, 18, 21**. XCLK=15, PCLK=2, VSYNC=6, HREF=1, SDA=4, SCL=5. RESET/PWDN non sono pilotati da GPIO: configurare il driver di conseguenza (tipicamente `-1`). Non copiare la configurazione GPIO della S3-EYE.

## J4: Qwiic

| J4 | Funzione | Rete |
|---|---|---|
| 1 | GND | GND |
| 2 | 3,3 V | VCORE, uscita U4 |
| 3 | SDA | IO4 / GPIO4 |
| 4 | SCL | IO5 / GPIO5 |

Qwiic e camera condividono lo stesso bus logico tramite Q3/Q4. Il firmware deve gestire un unico bus I2C e verificare indirizzi, frequenza e capacità complessiva; evitare inizializzazioni concorrenti indipendenti del medesimo controller. Le pull-up sui moduli Qwiic si sommano a R24/R25: verificare il valore equivalente nella catena reale.

## Reti preservate e limiti

- Nessun pin precedentemente collegato ha cambiato nome rete o connessione nella netlist. Conservati A0–A7/GPIO7–14, ALED/GPIO16, CAN/GPIO47–48, USB/GPIO19–20, UART, BOOT e reset MCU.
- Non impiegati GPIO35–37, riservati alla PSRAM nelle varianti interessate, né i GPIO di strap liberi 3/45/46.
- Questa implementazione ha rail **fissi 2,8 V e 1,5 V**. L'obiettivo dell'utente resta supportare più camere; non è una certificazione universale OV2640/OV3660/OV5640. Verificare pinout, tensioni e verso del flat del modulo concreto. Moduli con DVDD diversa richiedono una variante di alimentazione/adattatore prima di collegarli.
- La conversione XCLK e SCCB protegge il dominio camera dai livelli nominali 3,3 V. Le uscite DVP vanno direttamente all'ESP32, come nel riferimento: margini logici e timing vanno qualificati sul modulo scelto.
- VAUX alimenta già i LED: controllare picchi, dissipazione e margine di U5 con camera e LED simultanei. Verificare anche il budget VCORE con i dispositivi Qwiic. Nessuna misura di corrente o temperatura effettuata.
- Sul PCB: condensatori presso i pin indicati, massa continua, percorsi DVP brevi, R30 vicino all'uscita U11, separazione dai ritorni dei LED. Il PCB esistente deve ancora essere aggiornato dallo schema e sbrogliato.

## Verifiche

KiCad 10.0.3: apertura ed esportazione schema/netlist riuscite; controllo di tutti i collegamenti nuovi contro la tabella; conservazione di tutte le reti originali; riferimenti componenti univoci; revisione visiva della sezione aggiunta. Gli originali, salvo spostamento di J4/J5 e ampliamento della cornice grafica, sono preservati.

ERC: **233 → 176 segnalazioni; errori 56 → 27**. I 27 errori rimanenti riguardano elementi preesistenti (16 pin del connettore U3 e 11 segnalazioni su fili scollegati). Restano 149 warning, inclusi pin generici delle librerie importate; un warning su VAUX ora coinvolge il nuovo PWR_FLAG. Non dichiarare l'intero schema ERC-clean. Nessuna prova al banco né DRC del nuovo circuito: il PCB non è stato modificato.

## Fonti e provenienza

- [Schema ESP32-S3-EYE-MB V2.2](https://dl.espressif.com/dl/schematics/SCH_ESP32-S3-EYE-MB_20211201_V2.2.pdf), alimentazioni e connettore camera.
- [Datasheet del produttore Microne ME6211, copia distribuita](https://xonstorage.z8.web.core.windows.net/pdf/microone_me6211c33u4agn_sup12manufacturernocatlinknew.pdf), pinout SOT-23-5 e circuito applicativo.
- [TI SN74LVC1G125](https://www.ti.com/lit/ds/symlink/sn74lvc1g125.pdf), adattamento verso VCC.
- [onsemi BSS138](https://www.onsemi.com/pdf/datasheet/bss138-d.pdf), pinout G=1, S=2, D=3.
- [Driver Espressif](https://github.com/espressif/esp32-camera), supporto sensori distinto dalla compatibilità del flat.
- Simboli derivati dalle librerie ufficiali KiCad 10 (`Regulator_Linear`, `Transistor_FET`, `74xGxx`), con MPN e footprint specificati. [Licenza KiCad delle librerie](https://www.kicad.org/libraries/license/): CC-BY-SA 4.0 con eccezione; gli asset derivati mantengono tale provenienza.

## Schematic presentation update — 2026-10-27

The camera/Qwiic section is organized into seven dashed functional blocks with English comments: 2.8 V regulator, 1.5 V regulator, SCCB level shifting, Qwiic expansion, clock buffering, default controls, and the 24-pin camera interface. Local connections now use orthogonal wires, visible junctions, shared power/ground rails and directly connected decoupling capacitors. Labels remain at block interfaces and MCU signal ports.

The full netlist comparison against commit 9110be4 preserves all 63 net names and all 237 connected component pins, including complete net membership. No parts, values, GPIO assignments, footprints or PCB routing were changed. KiCad export and visual inspection passed. ERC still reports the same 27 pre-existing errors; total messages are now 178 (151 warnings). Two additional single-global-label warnings concern VCORE and CAM_XCLK_DRV: their former duplicate labels were replaced with physical wires. These warnings do not indicate disconnected pins; net connectivity was checked independently.
