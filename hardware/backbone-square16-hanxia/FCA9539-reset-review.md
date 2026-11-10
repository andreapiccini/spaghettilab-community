# Revisione dual MCU — 10 novembre 2026

Riferimento: backbone-square16-hanxia salvato su disco. Questa revisione conserva le posizioni di tutti i componenti preesistenti, tutte le 16 righe, piste e zone; aggiunge R923 10k 0603. Schema e PCB sono sincronizzati. Nessun MEZZ_PRESENT_N esiste in questa versione: il pad31 è ora la riga R05.

Moduli previsti: ESP32-S3-WROOM-1-N8R2 e ESP32-S31-WROOM-1-N16R16V, antenna PCB, socket perimetrale a40contatti. Altre varianti richiedono revisione: in particolare S3 con PSRAM octal usa i pad28–30 e non garantisce le16righe. Nomi rete GPIOxx e pin del simbolo sono alias S3, non numeri S31. Usare dual-mcu-pinout.csv e dual-mcu-profiles.json.

ADC sulle righe: S3 A1-A5 e B1-B4 (9 ADC1); S31 A1/A6-A8 e B1/B5-B8 (6 ADC1 + 3 ADC2). Comuni A1 e B1. Banco A: 5/4; banco B: 4/5 (S3/S31). DAC S31 su A3/A4. I2C_INT_SDA spostato al pad35 (S3 GPIO42 / S31 GPIO55); il pad4 diventa A5. Vedere dual-mcu-rows.csv. I GPIO delle derivazioni J26/J27 e FFC60 J32 seguono le nuove righe.

Correzioni: R201 diventa10k tra3V3 e pad21/STRAP_SPI_VOLTAGE; nessun pull esterno sul pad26, che segue i diversi default interni dei due moduli. U91 SDA passa al pad8, VBUS sense al pad24. ROW_ARM_N usa pad22 con nuovo pull-upR923 e pilota U60. BOOT pad27 non abilita più le righe. Non usare GPIO hold su ROW_ARM_N; rispettare almeno3ms dopo il rilascio EN prima di modificare gli strap.

J25.7/.8/.12, J26.22/.24 e J27.22 sono NC riservati: rimosso l'accesso esterno a strap flash e segnali riservati. Restano quattroGPIO ausiliari sui pad9/25/36/37; TX UART0 può emettere log al boot. Connettori aggiornati in dual-mcu-connectors.csv. Non collegare mai direttamente GPIO eROW sulla mezzanina.

USB: programmazione e seriale/JTAG comuni sui pad13/14. USB OTG/host applicativo disponibile sul socket solo conS3; S31 High-Speed richiede pad54/55 inferiori non contattati. CAN resta classico con SN65HVD230; non attivare CAN-FD bitrate switching. I2C interno ed esterno restano separati; U91 resta su softwareI2C dedicato.

Alimentazione: SY8089AAAC nominale2A, 3,31V circa (150k/33,2k), bypass22uF e EN10k/1uF presenti. Budget condiviso: riservare almeno600mA al moduloS31, oltre a transceiver, logica e carichi; non considerare1A delle righe sommabile senza limiti ai carichi dei connettori. Termica, transitori e contatti FlexyPin da misurare.

Firmware: i profili JSON sono il contratto della nuova scheda, non un firmware funzionante. Il firmware presente nel repository usa una precedente mappa di scheda; non è stato portato su Hanxia/S31. Implementare inizializzazione controls16.json, selezione capacità per riga, USB host disabilitato su S31, ADC calibrato secondo SDK per target e reset fail-safe. Nessuna prova su hardware fisico eseguita.

NON PRONTA PER PRODUZIONE: zero errori ERC, 66avvisi; 1207pad verificati senza differenze di rete schema/PCB. Restano499connessioni da sbrogliare e problemi DRC preesistenti (incluse sovrapposizioni, fori/maschera/clearance, keepout). R923 non introduce rilievi DRC. Le variazioni nel numero di coppie di fori segnalate non derivano da spostamenti: la geometria originale è stata verificata identica. Completare sbroglio, DRC, controllo meccanico del socket e prove di alimentazione/reset/USB/ADC prima di ordinare PCB assemblati.

Le sezioni storiche seguenti non prevalgono su questa revisione; studi e immagini precedenti non rappresentano la mappa attuale. Vedere dual-mcu-review.html e dual-mcu-verification.json.

---

# FCA9539Q — verifica documentale di avvio e reset

Verifica del 7 novembre 2026 sul datasheet Nyfea FCA9539 (22 pagine), fornito da LCSC C55318342. Copia esaminata: references/Nyfea-FCA9539.pdf. URL: https://www.lcsc.com/datasheet/C55318342.pdf

## Risultati documentati

- Pagina 4: le sedici porte sono configurabili ingresso/uscita; all'accensione sono tutte ingressi. Il package Q è WQFN24 4 × 4 mm.
- Pagina 5: pinout QFN verificato indipendentemente: P00..P07 sui pin 1..8, GND 9, P10..P17 sui pin 10..17, A0 18, SCL 19, SDA 20, VCC 21, INT 22, A1 23, RST 24.
- Pagina 7: in modo ingresso entrambi i FET d'uscita sono spenti, quindi l'uscita è in alta impedenza.
- Pagine 8–9: registri OUTPUT 0x02/0x03; POLARITY 0x04/0x05; CONFIG 0x06/0x07. CONFIG=1 seleziona ingresso/Hi-Z, CONFIG=0 abilita l'uscita.
- Pagina 16, sezione 7.5: RST basso, mantenuto per tW, ripristina macchina di comunicazione e tutti i registri al default di accensione.
- Pagina 11: la tabella effettiva usa A1/A0 e quattro indirizzi, scritti con bit R/W incluso (0xE8..0xEF). Gli indirizzi a 7 bit sono quindi 0x74..0x77. Sono usati 0x75, 0x76 e 0x77, 0x74 ora è libero dopo la rimozione del display.
- Pagina 21: corpo 4 ±0,1 mm, passo 0,5 mm, pad esposto 2,5 × 2,5 mm. Footprint locale con 24 contatti e pad 25; modello 3D generico QFN4x4, non un modello del fabbricante.

## Applicazione alla scheda

Restano le 48 resistenze esterne di default: pull-up sui gate PG dei PMOS, pull-down sui gate NG degli NMOS, pull-up sugli ISO_N dei bus switch. Quando gli expander sono in ingresso, questa rete richiede PMOS spenti, NMOS spenti e GPIO scollegati.

RST dei tre expander segue EXP_RESET_N = ESP_EN AND NOT GPIO0. GPIO0 rilasciato/alto mantiene il reset; soltanto il firmware dopo il boot può portarlo basso in open-drain per armare. R203 è ridotta da 100 kΩ a **10 kΩ** per rendere più forte il default basso di EXP_RESET_N durante l'avvio della logica. Il pin RST non è lasciato flottante.

La corrente di ingresso dichiarata a pagina 6 è ±1 µA (VI=VCC o GND, nel campo operativo). Come controllo d'ordine di grandezza, 1 µA su una resistenza da 100 kΩ produce 0,1 V; ciò non sostituisce la verifica analogica dei transitori di alimentazione.

Inizializzazione richiesta: rilasciare il reset solo dopo il boot, leggere e verificare che CONFIG=FF/FF per tutti e tre i dispositivi, scrivere POLARITY=00/00 e quindi OUTPUT=55/55 per U40/U41 e FF/FF per U42; solo dopo configurare le uscite con CONFIG=00/00. Su NACK o stato inatteso disarmare rilasciando GPIO0 e fermare l'abilitazione. La mappa nuova è controls16.json e fca9539-controls.csv; non usare i registri MCP23017 OLAT/IODIR.

Durante i cambi modo: prima aprire ISO_N, poi disattivare il vecchio percorso di alimentazione, quindi impostare il nuovo stato. Non rendere attivi contemporaneamente i due MOSFET di una riga. Bus I2C mantenuto prudenzialmente a massimo 400 kHz per i dispositivi condivisi con Qwiic.

## Limiti della documentazione e prove ancora necessarie

Il documento usa il simbolo **tW**, ma non ne dà un minimo numerico nella tabella elettrica. Non fornisce limiti quantitativi completi di POR, rampe o brownout, né una descrizione temporale completa degli I/O durante tutto il mantenimento/rilascio del reset. Pertanto la verifica documentale supporta la scelta del componente per il prototipo, ma non certifica l'assenza di impulsi in tutte le condizioni.

Il paragrafo degli indirizzi dice erroneamente tre pin/otto dispositivi, mentre pinout e tabella mostrano due pin/quattro dispositivi: il progetto segue pinout e tabella, da confermare sul campione. Il datasheet non esplicita chiaramente il collegamento elettrico del pad esposto: è collegato a GND nel progetto e va confermato con il produttore/assemblatore prima della produzione.

Servono misure su EXP_RESET_N, PG, NG e ISO_N con accensione lenta/rapida, alimentazione via USB/modulo, spegnimento parziale e brownout, reset EN, reset software e watchdog, GPIO0/BOOT cortocircuitato a massa tramite TP1 e cicli di sleep. Verificare con carichi limitati che le righe restino scollegate e che non si creino sovrapposizioni VCC/GND. La limitazione preesistente di GPIO0 resta: GPIO0 mantenuto fisicamente basso tramite TP1 può impedire il disarmo tramite rilascio software di GPIO0; il reset EN deve forzare il reset hardware. Non usare GPIO hold su GPIO0.

Non sono state eseguite prove su hardware fisico. Il PCB è preliminare e non sbrogliato.


Aggiornamento2026-11-08: U60 SN74LVC1G97 sostituisce U60 inverter+U61 AND; formula EXP_RESET_N=ESP_EN AND NOT GPIO0 invariata. IN0/pin3 aGND,IN1/pin1 aESP_EN,IN2/pin6 aGPIO0. R203 e un bypassC200 conservati. Le48polarizzazioni100k sono ora12reti isolate YC164: collegamenti elettricamente equivalenti. Restano le limitazioni di qualificazione POR/brownout già documentate.

## Aggiornamento limitatore comune delle righe

EXP_RESET_N pilota anche EN diU63SY6280AAAC, conR301100k versoGND. La formula U60 e i comandi degli expander restano invariati. Quando ilreset è asserito, U63è disabilitato e gli expander rilasciano le uscite. I pull-upPG RN1..RN4 seguono ora3V3_ROWS, la stessa rail dei sourceP; i pull-upOE restano sulla3V3 logica. Questo preserva lo stato di riposo ma non sostituisce le prove POR/brownout/transizione richieste sopra. SY6280A non scarica attivamente il rail, quindi non assumere una caduta istantanea a0V. Le condizioni di500mA e di corto devono essere qualificate sul prototipo dopo lo sbroglio.
