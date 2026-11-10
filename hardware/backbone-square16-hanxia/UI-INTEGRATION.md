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

## Revisione: quattro colonne per banco

Aggiunti J30 eJ31, Hanxia HX PM2.54-1x8P TP-YQ C42380985: quattro connettori per banco, otto righe per banco e64contatti accessibili complessivi. I quattro contatti della stessa riga condividono la reteROW_Lxx oROW_Rxx; restano16righe programmabili e gli stessiGPIO/driver. Passo tra righe2,54mm; passo tra colonne dello stesso banco4mm, mantenuto per l’ingombro Hanxia. Separazione tra le due colonne interne7,62mm per gli integratiDIP.

La scheda passa da70x66 a78x66mm, con magnetici a metà altezza eUSB laterale. Indicatori laterali e serigrafia breadboard spostati e allungati. Due soli connettori aggiunti alla distinta; costo totale da aggiornare. Bottom access del connettore resta da qualificare sul campione fisico.

Schema ePCB aggiornati e confrontati:64pad dei connettori sulle16reti corrette, nessun cambiamento alle reti preesistenti, ERC0errori. Restano avvisiDRC e routing rame incompleto; la scheda non è ancora pronta per produzione. L’anteprima accesa è una simulazione ottica, il firmware dei comandi resta da implementare. Le sezioni seguenti descrivono revisioni precedenti.

## Revisione: logo, configurazione e selezione globale

Logo con16LED blu su griglia4x4, mantenendo il disegno vettoriale. Aggiunti CONFIG ON verde/OFF rosso, DELETE rosso accanto aLOAD/SAVE eALL verde accanto alle selezioniA/B. BUS identifica i contatti magnetici; EXP e i nomiGND/DET/CANL/CANH/5V/3V3/SDA/SCL distinguono gli attacchi laterali dalla breadboard. ESP EXP e il marcatore1 identificano il connettore sud. La serigrafia informa, ma non impedisce meccanicamente inserimenti errati.

112LED complessivi,109canali del driver usati,35liberi: nessun driver aggiunto. Il logo passa da9a16LED; gli altri4nuoviLED sonoON/OFF/DELETE/ALL. Ingombro invariato70x66mm. Prezzo totale da ricalcolare.

Comandi proposti, NON implementati nel firmware: tenere RIGHE1s selezionaALL (maschera0xffff), cioè tutte le16righe, senza collegarle elettricamente tra loro. Nei menu la pressione lungaRIGHE mantiene la funzione annulla. Tenere entrambi i tasti1s commutaON/OFF, con priorità sulla lettura dei singoli clic. OFF disattiva i percorsi delle righe mettendole inHi-Z e conserva la configurazione in memoria; ESP32, USB e alimentazioni fisse dei connettori di espansione rimangono alimentati. ON indica l’applicazione software riuscita, non una misura elettrica. In anteprimaOFF, lampeggiare o attenuare le modalità per distinguerle dall’uscita applicata.

Tre clicRIGHE aprono il menu slot1..4; RIGHE sceglie lo slot eMODO scorreLOAD/SAVE/DELETE. DoppioMODO confermaLOAD/SAVE; perDELETE richiedereMODO1.5s. DELETE cancella solo lo slot persistente, senza alterare uscite e configurazione attiva. LOAD confermato deve prima disarmare le uscite, caricare il profilo come bozzaOFF e richiedere una successiva confermaON. Navigare gli slot non modifica le uscite. SAVE conserva modalità, profiloMCU, pull e parametri in formato versionato. ADC non ammesso suALL perché il bancoB non dispone diADC interno; le risorsePWM vanno validate. Nessun aggiornamento firmware incluso.

Anteprima accesa ideale: ALL selezionato, CONFIG ON, tutte le righeMCU IN conPULL UP, SAVE e slot2 selezionati. Le luci simulano le aperture reali della maschera, non la resa fotometrica. QualificareFR4, orientamento ottico e diffusione con un prototipo. Routing ancora incompleto eDRC generale non risolto: non pronto per produzione. Verifiche attuali in ui-integration-verification.json; seguono note storiche delle revisioni precedenti.

## PIN MODE: indicazione globale della riga selezionata

Aggiunti D554..D559, sei LED verdi XINGLIGHT XL-3216UGC-FB C3646937 sul driver esistente. Pannello sotto il logo, separato dagli stati di comunicazione: ADC/PWM/IN/OUT sulla prima fila, UP/DOWN con didascalia PULL sulla seconda. Il chip verde della riga indica il collegamento al micro; il nuovo pannello dettaglia la funzione della sola riga selezionata A1..A8/B1..B8, non mostra contemporaneamente le funzioni di tutte le righe.

ADC, PWM, IN eOUT sono quattro scelte dirette mutuamente esclusive: nessun ulteriore LED o sottomenu GPIO. Con IN, UP eDOWN sono opzionali e alternativi; entrambi spenti significa ingresso flottante, ma IN e chip restano accesi. Questo NON e la riga fisicamente scollegata inHi-Z. Con ADC/PWM/OUT le spie pull sono spente. Per impostazione di questa interfaccia i pull sono modificabili soltanto in IN; eventuale open-drain e altre opzioni avanzate sono fuori da questa revisione. I pull sono quelli interni all’ESP32: nessun resistore di pull esterno aggiunto. Sono polarizzazioni deboli, non alimentazioni per moduli.

ADC sulle righe: S3 A1-A5 e B1-B4 (9 ADC1); S31 A1/A6-A8 e B1/B5-B8 (6 ADC1 + 3 ADC2). Comuni A1 e B1. Banco A: 5/4; banco B: 4/5 (S3/S31). DAC S31 su A3/A4. I2C_INT_SDA spostato al pad35 (S3 GPIO42 / S31 GPIO55); il pad4 diventa A5. Vedere dual-mcu-rows.csv. I GPIO delle derivazioni J26/J27 e FFC60 J32 seguono le nuove righe. GPIO3 resta uno strap: nessuna configurazione riga prima del boot sicuro.

PWM è un profilo di uscita assegnato da software. Con la perifericaLEDC dell’ESP32-S3 sono disponibili8canali, con allocazione di canali/timer/frequenze da progettare senza alterare le altre righe. Non è una dichiarazione del limite totale di tutte le altre periferiche PWM possibili del chip. Parametri di frequenza e duty, livello inizialeOUT, scala/attenuazione e calibrazioneADC restano da implementare e qualificare. OUT è un GPIO logico dell’ESP32, NON la modalità alimentazione a500mA: il percorso di potenza3V3/GND esistente resta separato.

## Proposta di comandi, firmware non implementato

Nel funzionamento normale, selezionare la riga con RIGHE e la modalità primaria con MODO. Quando la scelta primaria è MCU, una pressione lunga MODO apre PIN MODE. Nel pannello MODO scorre ADC/PWM/IN/OUT ammessi per quella riga; RIGHE scorre FLOAT/UP/DOWN soltanto se IN è selezionato. Doppio MODO conferma il profilo intero ed esce; pressione lunga RIGHE annulla. Il triplo RIGHE per il menu configurazioni deve essere interpretato solo nel contesto normale, non contemporaneamente al sottomenu pin. Distinguere le sequenze di clic prima di applicare azioni singole.

Fuori dalla modalità MCU tutte le sei spie sono spente. Durante una modifica il firmware potrà far lampeggiare la scelta in anteprima e renderla fissa solo dopo applicazione riuscita. Prima di cambiare funzione: scollegare la riga dal GPIO, disabilitare i percorsi3V3/GND, configurare direzione/periferica/pull e valori iniziali, quindi ricollegare il GPIO con break-before-make. All’avvio tutte le righeHi-Z. I quattro slot LOAD/SAVE dovranno conservare anche funzioneMCU, pull e parametri del profilo in un formato versionato; caricamenti incompatibili vanno rifiutati senza attivare la riga. Nessun codice firmware o acquisizione effettiva è stato aggiunto.

## Fonti e stato di verifica

Espressif GPIO/pull e tabella ADC per pin: https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/peripherals/gpio.html . LEDC ESP32-S3: https://docs.espressif.com/projects/esp-idf/en/v5.5.6/esp32s3/api-reference/peripherals/ledc.html . Queste fonti supportano le capacità del chip, non certificano la precisione del circuito o un firmware non ancora scritto.

98canali del driver usati,46liberi,101LED totali; sei LED aggiunti senza GPIO, chip o resistori di pull esterni. Collegamenti dei pad confrontati con la netlist del progetto principale, nessuna differenza; ERC0errori e54avvisi. Nessun corto, violazione net-to-net, ponte di maschera o pad in riserva ottica. Il DRC generale non passa e il routing resta incompleto: vedere il riepilogo aggiornato sotto e ui-integration-verification.json. I componenti di servizio sono stati ricompattati per mantenere70x66mm; il driverU70 e i tre condensatori sono stati mantenuti in un gruppo. Le altre alimentazioni, disaccoppiamenti e tolleranze meccaniche richiedono ulteriore rifinitura nel routing. Non pronto per produzione.

Anteprima pcb-ui-lit.png: rigaA3 selezionata con chipverde e ADCverde, UP/DOWN spenti; si tratta di illuminazione simulata delle aperture B.Mask, non misura fotometrica. La resa attraversoFR4 richiede prototipo e possibile diffusore. Seguono le altre funzioni mantenute, aggiornate nei conteggi.

# Interfaccia corrente: connettività, progresso e configurazioni

Aprire backbone.kicad_sch e backbone.kicad_pcb. Tutte le nuove spie sono componenti e reti del progetto principale, non solo disegni. Contorno70x66mm, USB laterale, magnetici centrati, logo vettoriale con9LED blu e selettoriA/B compatti mantenuti. J26/J27 completamente fuori bordo eDNP.

## Gruppo di stato allineato vicino all’ESP32

Nella zona opposta al logo, centroX205mm: prima fila MASTER/WI-FI/BT aY71.3, seconda fila USB/AIR centrata aY76, alimentazioni5V/3.3V aY82 e barra5segmenti aY85.8. Capsule e simboli coerenti con gli altri indicatori, didascalie dritte. MASTER/WIFI/AIR verdi, Bluetooth eUSB blu. I cinque LED blu della barra sono ruotati90gradi per ottenere2.8mm tra i segmenti senza sovrapporre le piazzole. Sorgenti suF.Cu e finestreB.Mask attraverso FR4; nessun taglio fisico nel PCB.

D544 MASTER=ruolo master definito dal software/protocollo applicativo; non si deduce dai connettori magnetici o dalla terminazione CAN. D545 WIFI=collegamento radio secondo lo stato dello stack. D546 BT=statoBluetooth/BLE; nessuna promessa di BluetoothClassic. D547 USB_LINK=dispositivoUSB enumerato/configurato dall’host, NON semplice presenzaVBUS. D548 AIRPLANE=modalità aereo richiesta e radio disabilitate: in tale stato WIFI eBT devono essere spenti. USB/CAN possono restare utilizzabili. Gli stati vanno aggiornati solo quando noti al firmware, non mostrati come collegamenti reali all’avvio senza conferma.

D549..D553: barra di5segmenti. Con avanzamento noto,0..5segmenti rappresentano0..100% a passi20%; senza un totale reale usare un’animazione di attività, non una percentuale inventata. Casi previsti: OTA, trasferimenti di codice gestiti dall’applicazione, operazioni a passi ed esecuzioni con progresso noto. Non visualizza automaticamente la percentuale del bootloaderROM/USB: durante quel percorso non è in esecuzione l’applicazione che controlla U70. Servono firmware/protocollo appropriati; nessuna funzione implementata in questa revisione hardware.

## Cortocircuito: nessuna spia ingannevole

La protezione esistente U63 SY6280AAAC ha solamente IN,OUT,GND,EN eISET. ISET programma il limite, non è un’uscita di misura; non esistono pinFAULT o current-monitor verso il micro. La backbone non misura la corrente del rail. Per questo NON è stata aggiunta una spia di corto/intervento: una caduta del rail da sola non prova il superamento del limite e l’intervento. Non sono stati aggiunti shunt, comparatori, sensori o altri componenti di protezione.

Fonte primaria: datasheet Silergy SY6280/SY6280A Rev1.0C, pinout e descrizione ISET: https://datasheet.lcsc.com/szlcsc/Silergy-Corp-SY6280AAAC_C207620.pdf . Copia locale references/SY6280-SY6280A.pdf. Le caratteristiche del circuito di protezione preesistente restano da qualificare a3.3V e durante i corti reali; il limite condiviso non identifica la singola riga guasta.

## Funzioni mantenute

Fila RUN–STOP–DEBUG(insetto verde)–TERM sopra la breadboard. DEBUG indica la modalità laboratorio con espansione e software adeguati: non aggiunge AFE/ADC/DAC/shunt alla backbone. TERM segue il pilotaggio PhotoMOS automatico, non misura continuità del resistore né posizione primo/ultimo nodo.5V e3.3V sono spie dirette;3.3V indica il rail principale, non certifica3V3_ROWS protetto.

Fascia inferiore LOAD blu, SAVE verde e numeri1..4 verdi, separati dalla selezioneA/B. Menu previsto: triploRIGHE entra; RIGHE cambia slot, MODO alternaLOAD/SAVE, doppioMODO conferma, pressione lungaRIGHE esce. Distinguere i clic prima di applicare azioni singole/doppie/triple. Nessun caricamento automatico che attivi rail all’avvio; iniziare con tutte le righeHi-Z, applicare solo dopo conferma e break-before-make. Persistenza e firmware non implementati.

## Budget e verifica

Aggiunti10LED, nessun nuovo GPIO, driver o chip.101LED complessivi:48funzioni righe,16sigleA/B,9logo,4RUN/STOP/DEBUG/TERM,2alimentazioni,6configurazione,5connettività,5progresso e6funzioni pin.98canali del driverU70 IS31FL3731 usati e46liberi. Tre spie dirette5V/3V3/TERM tramiteR510/R511/R512 sono fuori matrice. Tutte le reti preesistenti restano invariate; la mappa è in ui-indicator-map.csv, con angoli e dettagli in ui-indicator-map.json.

ERC0errori,54avvisi; pad del PCB confrontati con la netlist esportata, nessuna differenza. Nessun corto, clearance tra net, ponte di maschera o pad in riserva ottica aggiunto. DRC generale NON passato:199courtyard sovrapposti,10PTH in courtyard,20clearance bordo magnetici,22sovrapposizioni serigrafia,33serigrafie su maschera e1serigrafia troppo vicina al bordo. Routing rame ancora incompleto,499elementi non connessi riportati.128componenti di servizio ricompattati, conU70/C400/C401/C402 raggruppati, da rifinire elettricamente nel routing, incluse alimentazioni e disaccoppiamenti. Non produrre questa revisione.

Resa luminosa, montaggio reverse, uniformità del logo e barretta richiedono prototipo e possibile diffusore nel case. pcb-ui-lit.png e connectivity-panel-detail.png sono colorazioni simulate delle formeB.Mask effettive: MASTER,WiFi,BT,USB e tre segmenti accesi; AIR spento perché le radio sono attive. Firmware e controlli fisici non implementati. Le quotazioni precedenti sono marcate da ricalcolare per l’attuale distinta.
