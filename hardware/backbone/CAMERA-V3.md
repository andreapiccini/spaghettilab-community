# Espansione FPC, alimentazioni ausiliarie e Qwiic — Backbone V3

Aggiornamento 2026-10-27. Implementazione nello **schema** `backbone.kicad_sch`; PCB, routing, firmware e prove fisiche non aggiornati da questa modifica.

## Circuito aggiunto

| Riferimenti | Funzione |
|---|---|
| U9 ME6211C28M5G-N | VAUX 3,3 V → +2V8, alimentazione ausiliaria J5.4/J5.11 |
| U10 ME6211C15M5G-N | VAUX 3,3 V → +1V5, alimentazione ausiliaria J5.10 |
| C75–C78 | 4,7 µF / 10 V X7R, ingresso e uscita di ciascun LDO |
| C79, C80, C81 | 100 nF presso J5, rispettivamente pin 4, 11, 10 |
| R24, R25 | Pull-up 4,7 kΩ a VCORE 3,3 V, condivise da Qwiic e camera |
| R30 | 0 Ω sul clock, senza buffer, come R55 nel riferimento Espressif |
| R28, R29 | FPC_PULLUP a +2V8 e FPC_PULLDOWN a GND, entrambi con 10 kΩ |
| C83 | 100 nF presso l'alimentazione Qwiic |

Tutti i nuovi componenti hanno footprint assegnato. I simboli attivi sono anche nella libreria SpaghettiLAB; BSS138 resta disponibile in libreria ma non è più usato nel circuito. `#FLG0105` dichiara VAUX alimentata da U5: il simbolo AP2112 importato ha pin elettrici generici, quindi KiCad non riconosce da solo l'uscita di U5 come sorgente. Non è un componente fisico.

## J5: espansione FPC 24 poli — esempio di utilizzo camera

Il connettore usa ora nomi generici nello schema. La tabella conserva le funzioni camera come esempio applicativo, basato sulla piedinatura ESP32-S3-EYE-MB V2.2. I pin 6 e 8 mantengono le polarizzazioni FPC_PULLUP e FPC_PULLDOWN; i ponticelli JP4/JP5 abilitano controlli opzionali con le restrizioni sotto. Tutti i ponticelli sono aperti di default. I numeri indicano i contatti J5; non vanno interpretati come GPIO. La mappatura GPIO è specifica spaghettiLAB e conserva tutte le assegnazioni esistenti.

| J5 | Funzione | Rete / GPIO |
|---|---|---|
| 1 | 3,3 V opzionale | FPC_3V3 da VCORE tramite JP1; NC con JP1 aperto |
| 2 | AGND | GND |
| 3 | SCCB SDA | IO4 / GPIO4 (collegamento diretto) |
| 4 | AVDD | +2V8 |
| 5 | SCCB SCL | IO5 / GPIO5 (collegamento diretto) |
| 6 | RESET_N | Pull-up 10 kΩ a +2V8; GPIO3 opzionale tramite JP4 |
| 7 | VSYNC | IO6 / GPIO6 |
| 8 | PWDN | Pull-down 10 kΩ a GND; GPIO46 opzionale tramite JP5 |
| 9 | HREF | IO1 / GPIO1 |
| 10 | DVDD | +1V5 |
| 11 | DOVDD | +2V8 |
| 12 | Y9 / D7 | IO21 / GPIO21 |
| 13 | XCLK | FPC_CLK ← R30 (0 Ω) ← IO15 / GPIO15 |
| 14 | Y8 / D6 | IO18 / GPIO18 |
| 15 | DGND | GND |
| 16 | Y7 / D5 | IO17 / GPIO17 |
| 17 | PCLK | IO2 / GPIO2 |
| 18 | Y6 / D4 | IO42 / GPIO42 |
| 19 | Y2 / D0 | IO38 / GPIO38 |
| 20 | Y5 / D3 | IO41 / GPIO41 |
| 21 | Y3 / D1 | IO39 / GPIO39 |
| 22 | Y4 / D2 | IO40 / GPIO40 |
| 23 | UART TX / GPIO43 opzionale | FPC_TX tramite JP2; NC con JP2 aperto |
| 24 | UART RX / GPIO44 opzionale | FPC_RX tramite JP3; NC con JP3 aperto |

Ordine firmware D0..D7: **38, 39, 40, 41, 42, 17, 18, 21**. XCLK=15, PCLK=2, VSYNC=6, HREF=1, SDA=4, SCL=5. Con JP4/JP5 aperti, RESET/PWDN non sono pilotati da GPIO: configurare il driver di conseguenza (tipicamente `-1`). Non abilitare JP4/JP5 senza verificare livelli e gestione firmware indicati sotto. Non copiare la configurazione GPIO della S3-EYE.

## J4: Qwiic

| J4 | Funzione | Rete |
|---|---|---|
| 1 | GND | GND |
| 2 | 3,3 V | VCORE, uscita U4 |
| 3 | SDA | IO4 / GPIO4 |
| 4 | SCL | IO5 / GPIO5 |

Qwiic e camera condividono direttamente IO4/IO5, con pull-up a VCORE 3,3 V; Q3/Q4 e R26/R27 sono stati rimossi su richiesta dell’utente. Il firmware deve gestire un unico bus I2C e verificare indirizzi, frequenza e capacità complessiva; evitare inizializzazioni concorrenti indipendenti del medesimo controller. Le pull-up sui moduli Qwiic si sommano a R24/R25: verificare il valore equivalente nella catena reale.

## Reti preservate e limiti

- Nessun pin precedentemente collegato ha cambiato connessione nella netlist; le rinomine generiche sono elencate sotto. Conservati A0–A7/GPIO7–14, ALED/GPIO16, CAN/GPIO47–48, USB/GPIO19–20, UART, BOOT e reset MCU.
- GPIO35–37 restano riservati alla PSRAM; GPIO45 non usato. GPIO3 e GPIO46 hanno connessioni opzionali tramite ponticelli aperti: sono pin di strap, non GPIO senza restrizioni.
- Questa implementazione ha rail **fissi 2,8 V e 1,5 V**. L'obiettivo dell'utente resta supportare più camere; non è una certificazione universale OV2640/OV3660/OV5640. Verificare pinout, tensioni e verso del flat del modulo concreto. Moduli con DVDD diversa richiedono una variante di alimentazione/adattatore prima di collegarli.
- Il clock arriva direttamente dall’ESP32 a 3,3 V attraverso R30 da 0 Ω, come nel riferimento Espressif; U11 e C82 sono rimossi. SCCB è invece collegato direttamente al bus a 3,3 V, come nel riferimento S3-EYE: il modulo scelto deve ammettere questi livelli sugli ingressi SDA/SCL. Le uscite DVP vanno direttamente all'ESP32, come nel riferimento: margini logici e timing vanno qualificati sul modulo scelto.
- VAUX alimenta già i LED: controllare picchi, dissipazione e margine di U5 con camera e LED simultanei. Verificare anche il budget VCORE con i dispositivi Qwiic. Nessuna misura di corrente o temperatura effettuata.
- Sul PCB: condensatori presso i pin indicati, massa continua, percorsi DVP brevi, R30 sul percorso del clock, separazione dai ritorni dei LED. Il PCB esistente deve ancora essere aggiornato dallo schema e sbrogliato.

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


## Collegamento SCCB diretto — 2026-10-27

Su richiesta dell’utente, rimossi Q3/Q4 BSS138 e R26/R27 (pull-up a 2,8 V). J5.3 e J5.5 sono ora collegati direttamente a IO4 e IO5, condivisi con J4 e con le pull-up R24/R25 a 3,3 V. Il circuito resta cablato per la camera di riferimento S3-EYE; il collegamento diretto non costituisce qualifica di tutte le varianti di modulo camera. Qwiic conserva alimentazione, pull-up e GPIO precedenti. U11 sul clock resta presente.

Verifica netlist: le sole variazioni elettriche sono la rimozione dei quattro componenti e l’unione CAM_SDA→IO4 / CAM_SCL→IO5. Tutte le altre reti preservate. Nessun aggiornamento PCB o firmware. La descrizione dei sette blocchi e il conteggio ERC nella sezione precedente documentano la revisione prima della rimozione: il blocco level-shift è ora eliminato.


## Espansione generica e simboli di alimentazione — 2026-10-27

Su richiesta dell’utente, rimossa la dicitura CAM/CAMERA dalla presentazione dello schema. Blocchi e commenti inglesi descrivono ora un’espansione FPC generica. Le annotazioni dei segnali indicano i GPIO effettivi; i due pin polarizzati restano esplicitamente PULLUP/PULLDOWN.

| Nome precedente | Nome attuale |
|---|---|
| CAM_2V8 | +2V8 |
| CAM_1V5 | +1V5 |
| CAM_XCLK | FPC_CLK |
| CAM_XCLK_DRV | FPC_CLK_DRV |
| CAM_RESET_N | FPC_PULLUP |
| CAM_PWDN | FPC_PULLDOWN |

Le alimentazioni della sezione usano simboli di potenza KiCad: frecce VCC con valore VAUX/VCORE, simboli +2V8 e +1V5, e simboli GND. Le reti mantengono esattamente gli stessi pin dopo le sei rinomine; nessun componente fisico o valore è cambiato. La denominazione generica non rende universali tensioni e piedinatura: verificare la periferica concreta prima del collegamento. PCB e firmware restano da aggiornare separatamente.

Esportazione KiCad, confronto completo delle netlist e revisione visiva superati. ERC: 178 segnalazioni, inclusi gli stessi 27 errori preesistenti. Le sezioni precedenti sulle revisioni riportano intenzionalmente i nomi storici. Il nome di questo documento resta invariato per preservare i collegamenti esistenti.


## Clock conforme al collegamento Espressif — 2026-10-27

Requisito confermato: evitare stadi aggiunti dall’assistente rispetto al circuito camera Espressif. Rimossi U11 SN74LVC1G125 e C82; R30 passa da 33 Ω a 0 Ω, corrispondente alla funzione di R55 nello schema ESP32-S3-EYE-MB V2.2, pagina 4. GPIO15 raggiunge J5.13 attraverso il solo ponticello resistivo. Eliminata FPC_CLK_DRV e rimosso il cablaggio di alimentazione del buffer. Il blocco inglese diventa DIRECT CLOCK - 3.3 V. Q3/Q4 e R26/R27 restano assenti; non introdotti altri componenti fisici.

Questa revisione sostituisce le precedenti scelte di buffer e adattamento del clock a 2,8 V. R28/R29 da 10 kΩ hanno invece una funzione presente nel riferimento (R57/R63) e restano. Conservati GPIO spaghettiLAB, nomi generici e simboli di potenza. La revisione riproduce il percorso del clock Espressif; non dichiara una copia integrale della scheda S3-EYE: alimentazione a monte, disaccoppiamento e ponticelli sugli altri segnali restano quelli già documentati per Backbone.

Confronto completo delle netlist: sole differenze rimozione U11/C82 e connessione di R30.1 a IO15; tutte le altre connessioni preservate. PCB e firmware non modificati, nessuna prova al banco.


## Estensione opzionale del flat — 2026-10-27

Richiesta confermata: 3,3 V, segnali aggiuntivi e controllo periferica, con possibilità di isolamento. Aggiunti cinque ponticelli saldabili **aperti di default**, simbolo `Jumper:SolderJumper_2_Open`, footprint `Jumper:SolderJumper-2_P1.3mm_Open_Pad1.0x1.5mm`. Chiudere significa unire i due pad con stagno; riaprire significa rimuovere il ponte a scheda disalimentata. Non sono interruttori comandati dal firmware e non limitano la corrente.

| Ponticello | Lato Backbone | Lato flat | Condizioni di utilizzo |
|---|---|---|---|
| JP1 | VCORE, 3,3 V | J5.1, FPC_3V3 | Uscita di alimentazione; non collegare un’altra sorgente a questo pin. Corrente disponibile da qualificare con U4, carichi esistenti, piste e cavo. |
| JP2 | TXD0 / GPIO43 | J5.23, FPC_TX | Condiviso con TP19 e UART0; il boot può trasmettere messaggi prima del firmware. |
| JP3 | RXD0 / GPIO44 | J5.24, FPC_RX | Condiviso con TP18 e UART0; evitare più trasmettitori sullo stesso ingresso. |
| JP4 | GPIO3 | J5.6, FPC_PULLUP | Solo open-drain: portare basso o rilasciare. Pull-up R28 a 2,8 V conservata. Non pilotare alto push-pull a 3,3 V. |
| JP5 | GPIO46 | J5.8, FPC_PULLDOWN | Solo per periferiche che accettano controllo a 3,3 V; R29 da 10 kΩ a massa conservata. Per camera non verificata lasciare aperto. |

**Profilo camera di riferimento:** JP1–JP5 aperti; J5.1/23/24 non alimentati/non collegati al MCU, RESET alto a 2,8 V, PWDN basso. Chiudere JP1 solo per una periferica che richiede 3,3 V sul pin 1. I nomi NC nel riferimento non garantiscono che i pin siano liberi in ogni modulo.

**Profilo scheda esterna:** chiudere singolarmente i ponticelli necessari dopo controllo pinout e tensioni. JP2/JP3 possono essere usati come UART o GPIO riconfigurati, ma non sono due risorse indipendenti dal debug UART0; disabilitare/rimappare la console quando necessario. I segnali logici 3,3 V non sono ingressi a 5 V. Con alimentazione esterna evitare retroalimentazione attraverso VCORE e segnali, inclusa la pull-up a 2,8 V. Nessuna connessione a caldo prevista.

**Strapping e controllo:** GPIO3 determina una selezione JTAG in funzione delle eFuse; chiudendo JP4 la pull-up a 2,8 V imposta il livello al reset. GPIO46 influenza download boot e messaggi ROM: mantenerlo basso durante reset e campionamento strap (hold minimo 3 ms dopo CHIP_PU alto). La periferica deve lasciare questi segnali in alta impedenza all’avvio. Non cambiare eFuse per rendere utilizzabili i collegamenti. La modalità open-drain di JP4 deve essere configurata prima di pilotare il pin; non si presume che il driver camera lo faccia automaticamente. GPIO46 può pilotare alto a 3,3 V solo dopo l’avvio e solo verso una periferica compatibile.

**Scelta dei pin:** 35–37 esclusi per PSRAM, 45 escluso per VDD_SPI, 0/EN preservati per avvio/reset Backbone; USB19/20, CAN47/48, A0–A7, LED e segnali FPC esistenti preservati. Non esistevano quattro GPIO completamente liberi e privi di restrizioni: UART43/44 e strap3/46 sono estensioni opzionali, non una promessa di quattro GPIO generici sempre disponibili.

Fonti: netlist attuale Backbone; [datasheet ESP32-S3 v2.2, sezioni 2 e 3](https://www.espressif.com/sites/default/files/documentation/esp32-s3_datasheet_en.pdf); [guida GPIO Espressif](https://docs.espressif.com/projects/esp-idf/en/latest/esp32s3/api-reference/peripherals/gpio.html). KiCad: esportazione e revisione visiva superate; confronto completo netlist conferma soltanto i nuovi collegamenti ai cinque ponticelli e ai tre pin precedentemente NC. Tutte le reti precedenti preservate. PCB, firmware e qualifica elettrica sul banco non aggiornati.

ERC di questa revisione: 176 → 172 segnalazioni; restano gli stessi 27 errori preesistenti (16 pin non connessi e 11 fili scollegati). Nessun nuovo errore.
