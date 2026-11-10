# Revisione attuale PANEL16 / FFC60 — 10 novembre 2026

Schema e PCB aggiornati:78×78mm,16touch su U91,STOP/LOCK,61LED pannello,FFC60 J32 e asola. Leggere [PANEL16-FFC60.md](PANEL16-FFC60.md) e panel16-ffc60-verification.json. Firmware non portato; routing,DRC e ottica ancora da completare. Le sezioni precedenti sul pannello32touch/U90 non descrivono più il circuito attivo. Mappa dual-MCU aggiornata a 9/9 ADC: vedere ADC99-WIRING.md.

---

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

# Current applied revision

Native schematic and PCB: 16 rows, 78 x57.2mm, magnetic connectors centred; no SW1/SW2 physical buttons. Row status apertures at45 degrees; MCU glyphs reduced28%; status LED columns compacted to2.9mm with true rounded capsules and shorter dividers, maintaining2.54mm row pitch and independent row touch targets.

Two BS8116A-3 controllers: U90 uses internal I2C for16 row electrodes; U91 uses separate software I2C on GPIO21(SCL, historical UI_BANK_N net) and GPIO13(SDA), with4.7k pull-ups R921/R922 and100nF C921. Neither bus is the user I2C bus. U91 serves10 system command electrodes (including CLEAR ALL) and6 programmable user electrodes.

Touch firmware is not implemented. Intended interaction: tap Play/Pause; hold2s Stop/Hi-Z; select Load/Save then slot; Delete requires holding the chosen slot2s. Debug requests host/measurement mode; this backbone alone does not implement external measurement/DAC functions.

D523 separate STOP LED removed;77 IS31FL3731 channels populated,67 free. Sixteen blue logo emitters at45degrees: four retained and twelve added. Optical uniformity remains unqualified.

All new footprints and schematic nets are present, but full PCB routing, remaining DRC findings, touch sensitivity and optical qualification remain open. This is not manufacturing-ready. The measurement expansion connector proposal has not been added.

Row-indicator refinement preserves all components and pad nets. A2.7mm trial failed pad clearance;2.9mm passes the row LED pad clearance checks. Package courtyard overlaps and other existing DRC findings still require layout qualification.

## Six programmable user touch keys and CLEAR ALL

T1–T6 occupy the upper-left user-facing area in an aligned3x2 grid. CLEAR is grouped with LOAD/SAVE/DELETE at bottom right. Covered4.4mm copper electrodes,5.8mm pitch, no additional ICs or LEDs. U91 keys10–16 (pins8–14) are connected to TE30–TE36. All32 touch inputs across U90/U91 are occupied. No default actions are assigned to T1–T6; CLEAR ALL is reserved for clearing the working row configuration. Firmware must configure U91 key16 as touch rather than IRQ, using the documented complete configuration protocol.

See user-touch-verification.json: zero ERC errors, no DRC violations involving the seven new electrodes. Full board routing and touch sensitivity remain unqualified.

## Corrected logo and denser backlight

Logo geometry traced directly from logo_sfondo_bianco copia.png supplied by the user, preserving aspect ratio and original LED-ray placement.16 blue XL-3216UBC-FB (C3646941) emitters on the service side,4x4grid,3mm pitch,45degrees;12additional channels, no extra driver. Active logo schematic is sheet11, logo16.kicad_sch. All schematic/PCB nets match; no logo pad-clearance, keepout or courtyard errors. Service components repacked to preserve board dimensions. Uniformity and optical assembly must be qualified on the prototype.

## Dedicated CLEAR ALL

TE36 / U91 key16 pin14 is reserved for CLEAR ALL (net TOUCH_CLEAR_ALL), not user T7. The PCB is labelled CLEAR. Hold2seconds: stop execution, disable all row connections to Hi-Z, clear the working configuration; do not erase stored slots. The earlier long Play/Pause gesture only stops/disconnects while retaining the working configuration. IRQ must be disabled on key16 during initialization as already documented. Firmware remains to be implemented.

Browser simulation verified: short Clear does not clear; held Clear disarms all16 rows and preserves a populated saved slot. See clear-all-verification.json for native schematic/PCB checks; these checks are not physical hardware qualification.

## Configuration-control grouping

LOAD, SAVE, DELETE and CLEAR share the same row at native y112mm. Slots1–4 are directly beneath their columns at y117mm; x positions173.4/167.6/161.8/156mm. User T1–T6 form an aligned3x2 grid; the USER caption is centred. No circuit, GPIO, component count, board dimensions or gesture behavior changed. Schema/PCB net parity verified; moved controls have no clearance/shorting/courtyard conflicts. Routing and firmware remain incomplete.
