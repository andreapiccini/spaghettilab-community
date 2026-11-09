## Current main project — touch controls applied

Open `backbone.kicad_pro` in this folder. SW1/SW2 are removed from the native schematic and PCB; U91 and nine global touch electrodes are present. See `CURRENT-REVIEW-STATE.md` and `touch-applied-verification.json` for the current status. Routing and firmware remain unfinished. Earlier sections below describe historical design stages.

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

## Revisione attuale: PIN MODE e pull interni

Pannello sotto il logo per la riga selezionata in modalità MCU: ADC/PWM/IN/OUT, più UP/DOWN per gli ingressi. Sei nuovi LED verdi,98canali usati e46liberi; nessun GPIO o chip aggiunto. ADC interno disponibile sul bancoA, nonB. Vedere `pinmode-panel-detail.png`, `pcb-ui-lit.png`, `pin-function-capabilities.csv` e `UI-INTEGRATION.md`.

Aprire `backbone.kicad_sch` e `backbone.kicad_pcb`. Indicatori e reti integrati; menu/firmware, routing rame e qualificazione ottica/produttiva ancora incompleti. Le sezioni seguenti sono storico delle revisioni precedenti.

## Revisione attuale: pannello connettività e barra di progresso

Integrati nel progetto principale MASTER,WiFi,Bluetooth,USB-host e modalità aereo, con barra luminosa a5segmenti in un gruppo allineato accanto all’ESP32.92canali usati,52liberi. Nessuna spia corto: il SY6280A attuale non fornisceFAULT né misura di corrente al micro. Nessun nuovo chip o GPIO.

Aprire `backbone.kicad_sch` e `backbone.kicad_pcb`; anteprime `pcb-ui-lit.png` e `connectivity-panel-detail.png`. Leggere `UI-INTEGRATION.md` per significato degli stati e limiti della barra nel bootloaderUSB. Firmware, routing e qualificazione ottica/produttiva ancora incompleti. Le sezioni seguenti sono storico delle revisioni precedenti.

## Revisione attuale: LOAD/SAVE e quattro slot illuminati

Nel progetto principale aggiunti LOAD blu, SAVE verde e numeri1..4 verdi nella fascia inferiore, opposta a RUN/STOP/DEBUG/TERM. Sei LED nuovi sul driver esistente:82canali usati,62liberi, nessun GPIO o chip aggiuntivo. Vedere `configuration-slots-detail.png`, `pcb-ui-lit.png` e `UI-INTEGRATION.md`.

Aprire `backbone.kicad_pcb` e `backbone.kicad_sch`. Firmware del menu/persistenza e routing rame ancora da completare; ottica e produzione non qualificate. Le sezioni seguenti documentano revisioni precedenti.

## Aggiornamento: DEBUG verde

Indicatore DEBUG con insetto aggiunto accanto a RUN/STOP nel progetto principale.76canali del driver usati,68liberi. Aprire `backbone.kicad_pcb` e `backbone.kicad_sch`; anteprima `pcb-ui-lit.png`. Spia di modalità laboratorio, non hardware di misura aggiuntivo: firmware, routing e qualificazione ottica restano da completare. Vedere `UI-INTEGRATION.md`.

## Revisione attuale: A/B compatti, logo vettoriale e stato semplificato

Aprire **backbone.kicad_sch** e **backbone.kicad_pcb**. SigleA/B a4.2mm, logo con9LED blu e contorni vettoriali, RUN/STOP/TERM raggruppati; mantenute5V/3.3V. Rimosse luci tasti,CAN ACT,LOAD eSAVE. J26/J27 completamente fuori bordo eDNP, conservati come promemoria.75canali usati,69liberi.

Vedere **UI-INTEGRATION.md**, **ui-integration-verification.json** e **pcb-ui-lit.png**. Routing, firmware, ottica e verifica di produzione restano incompleti. I file study sono soltanto storico; la revisione attiva e il progetto principale. Le sezioni seguenti riguardano versioni precedenti.

## Revisione attuale: indicatori integrati nel progetto principale

Aprire **backbone.kicad_sch** e **backbone.kicad_pcb**. Aggiunti32LED e3resistenze, inclusi LOAD/SAVE illuminati, logo blu, tasti e stato. Driver U70:77canali usati,67liberi. Dimensioni70x66mm. Nuova pagina08 nello schema.

Vedere **UI-INTEGRATION.md**, **ui-integration-verification.json** e **pcb-ui-lit.png**. Footprint e reti sono integrati; routing rame e firmware non completati, DRC non passato, ottica non qualificata. Non pronto per produzione. I costi precedenti vanno aggiornati per i nuovi componenti.

Le sezioni seguenti descrivono iterazioni precedenti; i file study sono conservati come storico e non sono la revisione principale corrente.

## Proposta attuale: contorni luminosi tasti e stato

Catena rimossa. Finestre5V/3.3V/CAN TERM/CAN ACT/RUN/STOP, logo blu e tasti.76canali matrice previsti,68liberi;2spie rail con resistenze esterne. Aprire `row-selection-study.kicad_pcb`; vedere `row-selection-lit.png`. Proposta ottica, cablaggio e firmware non implementati; dettagli in `row-selection-study.md`.

## Aggiornamento: logo, catena e legenda

Proposta ottica aggiornata in `row-selection-study.kicad_pcb`: 72 canali previsti, 72 liberi. Leggere `row-selection-study.md` per nuova logica pulsanti e limiti; nessun nuovo LED ancora cablato nel circuito principale.

## Proposta attuale:16sigle di selezione, nessuno schermo

La matriceLED e rimossa dalla proposta. Restano16sigleA1..A8/B1..B8 retroilluminate su due file, indicatori laterali e serigrafia breadboard invariati. Driver esistente:64posizioni previste utilizzate,80libere; nessun driver aggiuntivo. Aprire `row-selection-study.kicad_pcb` per la proposta ottica. Montaggio e ottica ancora da qualificare; schema ePCB principale invariati.

## Canale centrale ripristinato e proposta display nascosto

Ripristinata la serigrafia centrale della breadboard sul PCB principale: canale arrotondato1,4×19,6mm, tratto0,14mm. Nessuna modifica a impronte, reti, piste, zone, dimensioni o distinta. DRC principale invariato.

Nuova proposta separata `display-optical-study.kicad_pcb`:200 finestrelle a45gradi nella maschera visibile e aperture reali nella serigrafia bianca, FR4intatto. E uno studio ottico, non una sostituzione elettrica approvata: gli emettitori reverse-mount non sono selezionati ne collocati; la precedente scelta0402non e qualificata per il montaggio rovesciato. La regione senza rame richiesta su4strati interferisce con componenti di servizio ancora presenti. Nessuna promessa di contrasto o separazione dei pixel senza campione reale. Vedere `display-optical-study.md`. La variante con LED visibili e conservata separatamente per confronto.

## Revisione attuale:70×66mm, pulsanti e icone MCU

Scheda ridotta da74×66 a70×66mm (larghezza−4mm; area−5,4%). Magnetici centrati a33mm dalle estremita, USB sul lato sinistro nella vista breadboard. Sei Hanxia mantenuti, passo4mm tra le colonne dello stesso banco;2,54mm tra righe e7,62mm tra colonne interne dei due banchi. Terminali sfalsati mantenuti; adattamento meccanico e accesso dal basso richiedono campione reale.

48LED a45gradi, tre colori e driver5V mantenuti. Il passo orizzontale2,85mm non e stato ulteriormente ridotto per conservare la clearance elettrica.16icone MCU native in B.Mask sostituiscono SIG, con tre pin per lato, corpo0,8mm, ingombro1,44mm e tratto0,14mm. Finestre senza rame su tutti i quattro strati; scritte dritte. L'icona significa collegamento al pin ESP32, anche ADC sulle righe compatibili; non indica che tutte le righe abbiano ADC. Trasmissione del FR4 e separazione ottica da qualificare.

SW1/SW2 XKB TS-1187A-B-A-B C318884 sul lato breadboard B.Cu, sotto le righe. Il datasheet verifica corpo5,1×5,1mm, altezza1,5mm, piazzole raccomandate1×0,75mm aX±3mm/Y±1,875mm. A/B sono lo stesso contatto, C/D l'altro. SW1 usaGPIO21 (pad23); SW2 GPIO13, condiviso con J25.7 che ora e riservato al pulsante. GPIO14/pad22 e USB_VBUS_PRESENT, non libero: corretta la precedente documentazione che lo indicava libero. RestanoGPIO15,16,43,44,47,48 liberi suJ25.8..13. Pull-up interni e debounce firmware, nessun chip/resistore aggiunto. Componenti di servizio suF.Cu; ESP32 e due pulsanti suB.Cu.

Interazione prevista:SW1 banco A/B, SW2 riga1..8, pressione simultanea prolungata cicloHi-Z/MCU/3.3V/GND, rilascio prima di eseguire singole azioni e break-before-make. E una specifica: firmware non implementato. Reset sicuro dei comandi di potenza invariato.

Verifiche:195impronte, tutte le reti dei pad confrontate con la netlist; ERC0errori/52avvisi. DRC:89sovrapposizioni courtyard,20distanze bordo dei magnetici e10PTH dentrocourtyard dei connettori ausiliari. Nessun corto, errore di clearance tra reti diverse, ponte soldermask o interferenza della serigrafia. Rimangono499connessioni da sbrogliare. Non e un PCB pronto alla produzione; le sovrapposizioni dei margini LED/connettori richiedono verifica del montaggio. Il modello3D dei pulsanti e un proxy dimensionale locale, non un modello ufficiale XKB.

## Serigrafia attuale degli indicatori

Aggiunte sul lato breadboard 16 cornici a capsula, una per riga, che raggruppano le tre indicazioni luminose. Cornici alte 2 mm con tratto da 0,12 mm; piccoli separatori e raccordi alle etichette A1–A8/B1–B8. Nessuna nuova scritta e nessun inchiostro nelle aperture luminose. Geometria del PCB, componenti, finestre, reti elettriche e distinta invariati.

# Revisione attuale: 74 × 66 mm, LED a 45°, scritte orizzontali e driver a 5 V

Le 16 righe hanno tre indicatori ciascuna: 16 LED rossi XL-3216SURC-FB (C3646938) per **3.3V**, 16 blu XL-3216UBC-FB (C3646941) per **GND** e 16 verdi XL-3216UGC-FB (C3646937) per **SIG**. I LED sono sul top a 45°, con passo orizzontale di 2,85 mm; le righe mantengono 2,54 mm. Le scritte sul bottom restano orizzontali, con caratteri da 0,40 × 0,60 mm e tratto da 0,10 mm.

Le 48 finestre escludono il rame su tutti e quattro gli strati: quadrati da 1,85 × 1,85 mm ruotati con i LED. L'apertura F.Mask è da 1,8 × 1,4 mm, mentre B.Mask contiene le lettere orizzontali. Il FR4 rimane integro: non sono fori fresati. Verificato che gli ingombri delle lettere rientrino nelle zone senza rame; trasmissione della luce, uniformità e compatibilità del montaggio reverse richiedono una prova fisica.

Il driver U70 IS31FL3731 e i LED sono alimentati a 5 V; I2C e SDB rimangono a 3,3 V. Nessun componente o GPIO aggiuntivo. Il gruppo CA pilota i 16 rossi e il gruppo CB i 32 blu e verdi; R_EXT da 47 kΩ resta invariata. La corrente tipica calcolata è circa 24,2 mA con un'indicazione per riga e 68,2 mA con tutti i 48 LED accesi, a PWM massimo. Il firmware, ancora da implementare, deve azzerare enable e PWM prima di uscire dallo shutdown e bilanciare i colori. Hi-Z lascia tutte le scritte spente: non si distingue dall'assenza di alimentazione. Le indicazioni mostrano la configurazione, non misurano lo stato elettrico della riga.

Restano i sei Hanxia centrali, tre colonne per banco e canale centrale da 7,62 mm. I magnetici sono a Y = 95,3 mm, esattamente a metà altezza, a 33 mm da entrambi gli estremi. L'USB rimane a sinistra nella vista breadboard; il profilo raccordato misura 74 × 66 mm.

Validazione: 193 footprint, ERC senza errori. Il DRC riporta 110 rilievi: 20 distanze rame-bordo dei magnetici, 10 PTH condivisi, 6 sovrapposizioni courtyard già presenti e 74 nuove sovrapposizioni dei margini courtyard tra LED. Non risultano corti, violazioni della distanza rame di 0,20 mm o nuovi conflitti dei componenti di servizio. I corpi nominali si incastrano con circa 0,196 mm di separazione; le tolleranze generali del disegno (±0,25 mm) e i margini di montaggio non sono qualificati. Questa revisione non è pronta per la produzione. Restano 499 elementi non connessi e soltanto 10 piste locali tra magnetici e socket: occorre sbrogliare e collaudare il PCB.

Il modello 3D dei LED è un generico KiCad castellated ruotato, non un modello esatto Xinglight. L'anteprima accesa è illustrativa, non una misura della trasmissione ottica. I paragrafi seguenti descrivono revisioni storiche.

# Revisione attuale: 48 indicazioni retroilluminate,77×66mm

Tre LED rossi XINGLIGHT XL-3216SURC-FB C3646938 per ciascuna delle16righe:3.3V,GND,SIG. LED orizzontali suF.Cu, passo verticale2,54mm;seiHanxia centrali invariati,trecolonne per banco e canale7,62mm. Magnetici e socket laterali spostati simmetricamente verso l'esterno mantenendo il centroY95,3mm,33mm da entrambi gli estremi. USB rimane a sinistra nella vista breadboard.

48finestreFR4 da1,8×1,4mm: rame escluso suF.Cu,In1.Cu,In2.Cu,B.Cu;apertura rettangolareF.Mask e scritte specchiate suB.Mask (altezza0,65mm,larghezza caratteri0,43mm,tratto0,10mm). Non sono fori fresati:ilFR4rimane. Leggibilità,trasmissione,diafonia,compatibilità del montaggio reverse conFR4integro e tolleranze della maschera richiedono campioni. Ilmodello3DLEDèun genericoKiCad1206castellated ruotato,non un modello esattoXinglight.

Revisione alimentazione:driver eLED sulla rail5V;nessun componente aggiunto. C400 eC401 restano invariati,ripresi sui5V. I2C eSDB mantengono livelli3,3V;nota applicativaLumissil,Q8:sogliaSDB1,4V. Corrente tipica calcolata24,2mAcon16indicazioni accese,68,2mAcon tutte48;non sottratta alla rail3V3. Le tensioni indicate dalle scritte rimangono3.3V/GND/SIG:non diventano uscite5V.

U70IS31FL3731-QFLS2-TR suI2C_INT a0x74,senza conflitto conFCA9539a0x75..77. Non occupa nuoviGPIO. Alimentazione5V,I2C e shutdownhardwareESP_EN a3,3V,software shutdown attivo dopo reset;firmware da implementare:azzerareenable/PWMprima di attivare. Matricecharlieplex48LEDsulgruppoCA;CBnon usato. R40047k limita circa14,5mApicco/1,38mAmedio perLED aPWM255;circa22mALEDseunaindicazione perriga,66mAcon tutte48accese,piùdriver. Indicazioni rappresentano la configurazione software,non misurano lo stato elettrico. Hi-Z=tutte spente,indistinguibile da alimentazioneassente.

Schema aggiornato,193footprint,ERC0errori. DRC36rilievi preesistenti:20rame-bordo magnetici,10PTHcondivisi dentrocourtyard socket,6courtyard intenzionali;nessun corto o nuova interferenza. PCBancora da sbrogliare,499elementi nonconnessi;solo10piste locali magnetici/socket. Il percorso500mAriga e ilprototipoottico nonsono qualificati. I paragrafi seguenti documentano revisioni storiche e possono riportare componenti/dimensioni superati.

# Breadboard programmabile — 16 RGB sul lato visibile,57×66mm

Aprire backbone.kicad_pro e ricaricare da disco.173 componenti. Altezza ridotta da97 a60mm (−37mm,−38,1%), larghezza57mm invariata. ContornoX156,75…213,75/Y62,3…122,3mm. Entrambi i magnetici hanno centroY92,3mm, esattamente a30mm dalle estremità. USB a sinistra nella vista breadboard, rivolta verso sinistra (U3 suF.Cu a90°, a destra nella vista componenti). ForoH2 già liberato dall'USB; TP3 spostato aX169/Y80 per liberare i nuovi magnetici centrati.

## Breadboard e indicatori

16 righe A1…A8/B1…B8, tre socket collegati per riga. Header Hanxia top/bottom da8, passo righe2,54mm; corridoioC–D7,62mm. RigheY92,11…109,89mm. Le sole scritte serigrafiche restano gli identificativi A/B; contorni e segmenti mostrano i collegamenti.

Ring rimosso.16 XINGLIGHT XL-1615RGBC-2812B addressable C2890035 da1,5×1,5×0,65mm:8 per lato in colonne diritte, allineati alle righe a passo2,54mm. Montati sullo stesso lato visibile dei fori, cioè il top nell'uso del prodotto; il nome del layer nel progetto attuale èB.Cu. Tutte le32 finestrelle ottiche, aperture maschera e keepout degli exLED sono rimosse, nessuna fresatura. Restano solo le asole meccaniche FlexyPin e il keepoutRF originale. Il blu del modello3D è rappresentativo del componente, non una simulazione di accensione.

Pinout SK6805 dal datasheetA1:1DIN,2VDD,3DOUT,4GND. Alimentazione5V e adattatore AHCTU62 mantenuti. Un100nF per pixel sul lato componentiF.Cu, immediatamente dietro il rispettivo LED, con collegamenti tramitevia da realizzare nello sbroglio. Catena LED1…8,LED15…22; DOUTultimo NC. Rimossi LED23…38 eC300…315. Mappe in rgb-indicator-map.csv; rgb-ring-map.csv resta alias compatibile, senza ring.

Firmware da implementare:GRB,T0H/T0L0,3/0,9us,T1H/T1L0,9/0,3us,reset basso>200us; nero all'avvio e limite luminosità. I soli16 RGB consumano tipicamente248mA a5V al bianco pieno (circa1,24W). Specifica massima dei canali6,3mA:302,4mA più logica. Consumi ESP32, sensori ed elettronica si aggiungono.

Prezzi LCSC consultati2026-11-08:0,0956USD(5+),0,0769USD(50+),0,0665USD(150+),0,0602USD(500+). Costo16LED circa1,53USD al prezzo piccoli volumi; multiplo d'acquisto5:20 pezzi circa1,91USD. Esclusi montaggio/imposte/spedizione. Fonte:https://www.lcsc.com/product-image/C2890035.html. Datasheet:references/XL-1615RGBC-2812B-C2890035.pdf.

## Funzioni mantenute

ESP32-S3 N8R2/FlexyPin,USB,alimentazione,Qwiic,CAN con terminazione automatica e fori passanti sui magnetici. Quattro modalità per riga:3V3,GND,GPIO,Hi-Z. BancoA conADC1; bancoB digitale.16 MOSFET AO3401A P +16 AO3400A N singoli e4 interruttori bidirezionali 74CBTLV3125PW,118 TSSOP mantenuti, tutti16 canali usati. Per ADC:entrambi i MOSFET spenti,solo percorsoGPIO abilitato. Nessuna matrice di connessione arbitraria fra righe.500mA su una singola riga VCC/GND è un obiettivo verificato sui componenti, ancora da validare dopo sbroglio e prova termica. Budget alimentazione complessivo condiviso.

12 reti Yageo YC164-FR-07100KL sostituiscono48 resistori100k. Quattro elementi indipendenti, coppie1–5,2–6,3–7,4–8 verificate sul datasheet. Mappa resistor-array-map.csv. Tre Nyfea FCA9539Q generano48 comandi. U60 SN74LVC1G97 realizzaEXP_RESET_N=ESP_EN AND NOT GPIO0, conR203 eC200. Registri sicuri e sequenza invariati. Qualificazione avvio/reset/brownout ancora necessaria:vedi FCA9539-reset-review.md.

GPIO liberi senza altri collegamenti:11,12,13,15,16,43,44,47,48. GPIO45/46 hanno già polarizzazioni di avvio e non sono inclusi. Ora esposti su J25; J17/J20 restano rimossi.

## Schema e verifica

Sette fogli con rettangoli tratteggiati,fili e sole etichette globali documentate. Il file rgb-ring.kicad_sch conserva il nome per compatibilità, ma ora contiene solo16 indicatori. Schema e PCB confrontati pin per pin:zero discrepanze. ERC0errori/69avvisi residui. DRC24rilievi già noti:20clearance al bordo magnetici e4margini Hanxia sovrapposti; nessun nuovo corto o conflitto ottico/serigrafico. Confermati centraggio dei magnetici,pitch2,54mm,16LED e0finestrelle. Le modifiche alle reti resistive e al reset restano inalterate.

PCB ancora non sbrogliato:nessuna pista o piano,non pronto per produzione. Firmware non implementato; qualificazione fisica necessaria. Backup della precedente versione conservato.

## Espansione sud J25 — BOOMELE C52105

Socket femmina THT a90° 2x8, passo e distanza tra file2,54mm. Aperture verso sud, 16 contatti. Pin1 quadrato; numerazione dispari nella fila vicina al corpo/presa, pari nella fila arretrata. Pinout per colonne:1/2GND/GND,3/4 3V3/5V,5/6GPIO11/12,7/8GPIO13/15,9/10GPIO16/43,11/12GPIO44/47,13/14GPIO48/GND,15/16I2C_SDA/I2C_SCL. Mappa numerata con coordinate in south-expansion-pinout.csv. Vista F:pin1 a sinistra; vista breadboard B:pin1 a destra. L'ordine di fila visto dalla presa dipende dalla vista:usare sempre pin1 e numeri, non dedurlo da alto/basso.

GPIO diretti3,3V, non tolleranti5V e senza protezione/commutazione delle16righe. SDA/SCL condivisi con Qwiic ed expander:controllare gli indirizzi dei moduli. Rail3V3/5V condivise, nessuna protezione di ingresso aggiuntiva. Tutti9GPIO liberi esposti; nessun nuovo GPIO assegnato. Le quattro modalità, gli ADC e il circuito di reset delle righe restano invariati.

PCB invariato57x66mm. AnchorJ25 X176,36/Y125,8mm; fila fori posterioreY123,26,anterioreY125,8. Presa esterna sporgente circa7,8mm verso sud; ingombro assemblato complessivo circa73,8mm esclusi antenna e cavetti.

Verifica meccanica:la pagina LCSC C52105 non pubblica un PDF quotato. Sono stati verificati footprint e modello3D della **JLCEDA/EasyEDA Official Library** associati al codiceC52105 (https://lceda.cn/ e https://easyeda.com). Dati archiviati in references/C52105-official-easyeda.json e references/C52105-official-model.obj. Passo2,54mm/file2,54mm, pad1,60mm, foro finito1,10mm (origineCAD raggio2,1654unità x0,254mm). Pin1 quadrato. CorpoCAD20,0x9,0mm; modello3D20,82x8,5mm, altezza5,0mm e terminali3,2mm sotto piano. Le due rappresentazioni differiscono:il courtyard riserva l'unione delle sagome con margine0,25mm. Il modello3D è convertito preservando la geometria, allineando i terminali ai16fori; non è un disegno produttivo con tolleranze. Accoppiamento e saldabilità da confermare con campione fisico prima della produzione.

Fonte prodotto:https://www.lcsc.com/product-detail/C52105.html. Prezzi consultati8novembre2026:5+0,25USD,50+0,1963USD,400+0,1393USD; esclusi tasse/spedizione. Nessuna compatibilità elettrica implicita con Flipper, PMOD o altri standard.

## Mezzanina passiva J26/J27 — aggiunti solo due connettori

Due socket femmina THT 2x16, passo1,27mm, suF.Cu (lato componenti, opposto alla faccia breadboard visibile). PCB sempre57x66mm. PosizioniJ26 X163,6/Y119,2 eJ27 X187,6/Y119,2; rotazione90°, assi paralleli, distanza ancoraggi24mm. Connettori nella fascia sud sopra ilBOOMELEJ25, non sul lato di inserimento dei componenti della breadboard.

Esportati separatamente16ROW (nodi fisici dei fori, dopo lo switch) e16GPIO corrispondenti (latoESP, prima dello switch). Inoltre9GPIO condivisi conJ25, I2C_SDA/SCL condivisi conQwiic/expander, ESP_EN, EXP_RESET_N,3V3,5V e16contattiGND.64contatti totali; pinout completo e coordinate in mezzanine-pinout.csv e foglio07 mezzanine.kicad_sch. I contatti GPIO duplicati non sono nuove risorse indipendenti. Sincronizzazione/abilitazione assegnabili aiGPIO disponibili mediante firmware futuro; nessun segnale dedicato inventato e nessun componente per crearli.

Non aggiunti ADC,DAC,shunt,selettori,buffer,resistenze,protezioni o nuovi circuiti. Reti e componenti preesistenti invariati elettricamente; elettronicaF riposizionata per liberare l'ingombro. Breadboard,16RGB,Qwiic,USB,magnetici,J25 e dimensioni invariati. La mezzanina futura dovrà contenere tutti i circuiti di strumentazione e la relativa disconnessione sicura a riposo/senza alimentazione. Non ponticellare GPIO eROW:si bypasserebbero gli switch della backbone. EXP_RESET_N è uscitaU60, da osservare e non pilotare; ESP_EN è resetESP condiviso, non un'abilitazione dedicata.

La scheda aggiuntiva deve essere rialzata e sostenuta per non urtare headerHanxia e altri componenti esistenti. Altezza di accoppiamento, coppia socket/pin maschio, portata dei contatti e fissaggio da definire sulla futura mezzanina; non è stato progettato un PCB figlio né verificato un modello a basso profilo. Footprint e3D nativiKiCad generici, componente commerciale ancora da scegliere. Prese non destinate a innesto a caldo. Le rail condividono il budget della scheda, senza alimentazione o protezione dedicata aggiunta.

Le tensioni ammissibili delle righe restano quelle del circuito originale; esporre iROW non permette di applicare tensioni esterne arbitrarie. GPIO diretti3,3V, non5V. La corrente tra due righe richiede il percorso in serie sulla mezzanina; nessuno shunt sulla base. I tre fori di ogni riga restano lo stesso nodo. Piste verso i nuovi connettori da sbrogliare:il PCB rimane senza piste né piani, non pronto per produzione.

Verificato:173footprint, aggiunti soltantoJ26/J27,0discrepanze di rete schema/PCB,ERC0errori/69avvisi,DRC24rilievi originali e nessuno nuovo. Le interconnessioni analogiche della mezzanina introducono capacità/induttanza:le prestazioni strumentali e la banda non sono ancora definite.

## Revisione MOSFET singoli 57 × 66 mm

Sostituiti i 16 AO6604 con 16 AO3401A (C15127, Q30..Q37 e Q44..Q51) e 16 AO3400A (C20917, Q100..Q115), package SOT-23 con pin1=G,2=S,3=D. Retine gate, expander, reset e switch TSSOP invariati elettricamente. Nessun canale GPIO/ADC sostituito con un semplice MOSFET: il percorso analogico resta bidirezionale. La condizione PG=0/NG=1 resta vietata.

Contorno X156,75..213,75/Y62,3..128,3:57×66mm. Magnetici centrati aY95,3,33mm da entrambe le estremità. Breadboard spostata di3mm verso sud e16indicatori riallineati alle posizioni reali dei fori, passo righe2,54mm e distanzaC-D7,62mm invariati. J25 riportato al bordo sud, J26/J27 reinseriti nella fascia sud (nel file di partenza erano parcheggiati fuori bordo). Tutti173componenti inclusi nel layout, salvo la prevista sporgenza dei connettori di bordo e dell'antenna.

Valutazione completa della singola riga a500mA in row-current-review.md; mappa MOSFET in row-power-map.csv. Classe PORT_IO_POWER aggiornata a0,8mm preferiti e via0,8/0,4mm; regola larghezza minima0,25mm per gli escape. Non aggiunte piste né piani: la portata della scheda completa non è ancora qualificata. Non è una limitazione elettronica di corrente. La verifica copre dimensionamento e reti dei componenti; sbroglio, budget reale del carico e prova termica rimangono necessari. I500mA non si applicano alla modalità GPIO/ADC, né a ogni riga simultaneamente.

## Revisione Nexperia / Xinglight — 8 novembre 2026

U50/U51/U53/U54 sono ora Nexperia74CBTLV3125PW,118 (C456149),TSSOP14 SOT402-1, tutti16canali bidirezionali conservati. Stesso pinout OE1/4/10/13, A2/5/9/12, B3/6/8/11, GND7,VCC14. Alimentazione3V3 e tutti i pull-up OE100k esistenti invariati: OEalto scollega, IOFF gestisce lo spegnimento dell'alimentazione. Nessun cambiamento alla logica del reset degli expander, alle reti gate o ai MOSFET. Le verifiche POR/brownout/firmware già richieste restano da fare sul prototipo; non dichiarate già superate.

16RGB ora XinglightXL-1615RGBC-2812B (C5349954),documento del produttore intitolatoXL-1615RGBC-WS2812B. Nuovo simbolo Board28:XL1615_2812B_Chain e nuovo footprint Breadboard28:LED_XINGLIGHT_XL1615_2812B. Pinout1GND,2DIN,3VDD,4DOUT: non è compatibile come numerazione col precedenteOPSCO, quindi schema ePCB sono stati rimappati esplicitamente. CatenaLED1..8,LED15..22 invariata; ultimoDOUT non collegato. Body1,6×1,5×0,6mm. Piazzole consigliate0,45×0,65mm, interassi1,25×0,95mm, come pagina11 del datasheet conservato in references/XL1615-C5349954.pdf. Nel modello3D è usata una rappresentazione generica scalata agli ingombri, non un modello del produttore.

LED sul lato visibileB.Cu, nelle stesse posizioni e con allineamento esatto ai fori; nessuna finestra nelPCB. Conservati condensatori100nF e U62SN74AHCT1G125 con uscita5V. Dati GRB,24bit, circa800kbit/s; tempi indicativi datasheet T0H0,3µs/T0L0,9µs/T1H0,9µs/T1L0,3µs. Reset basso specificato>200µs, impostazione prevista300µs per margine. Firmware non ancora implementato. Il datasheet riporta PWM1,5kHz nelle caratteristiche e4,5kHz nella tabellaAC: non assumere una frequenza garantita senza conferma/campione.

Consumo tipico:5mA per colore più0,35mA di quiescenza per pixel.16LED bianchi al massimo circa245,6mA a5V (1,23W), spenti circa5,6mA (28mW). Sono valori tipici, non massimi garantiti; prevedere margine nell'alimentazione. Conservato obiettivo500mA sulla singola riga VCC/GND e relative condizioni in row-current-review.md.

173footprint; nessuna modifica a dimensioni57×66mm, magnetici al centro, posizioni, header, FlexyPin40contatti o mezzanine. Verificati tutti i pin contro la netlist e il cambio di numerazione dei16RGB. ERC0errori/69avvisi. DRC24rilievi preesistenti (20contatti magnetici sul bordo e4courtyard Hanxia), nessuno nuovo. PCB ancora senza piste/piani e firmware non implementato: non pronto per produzione.

### Costo materiali aggiornato, esclusiJ26/J27

| Lotto | USD/scheda | EUR/scheda | Totale lottoEUR | RisparmioEUR/scheda |
|---|---:|---:|---:|---:|
|10schede|19,39|17,37|173,66|con protezione|
|1000schede|13,47|12,06|12060,73|con protezione|

Cambio BCE6novembre2026:1EUR=1,1165USD. Include40FlexyPin/ESP32,magnetici,Hanxia e tutti i componenti della base; escludeJ26/J27,PCB,montaggio,case,collaudo,spedizione,IVA e commissioni cambio. Prezzi verificatiLCSC8novembre2026 eFlexyPinLectronz. Quota passivi stimata mantenuta per confronto:0,3956USD/scheda su10,0,1465USD su1000; alcuni passivi non hanno ancora un codice esatto e ai piccoli lotti incidono i minimi d'ordine. Valori di consumo dei pezzi, non importo esatto del carrello o preventivo con disponibilità garantita. Snapshot completo e scaglioni in cost-summary.json.

## Protezione condivisa da corto3V3→GND sulle righe

Aggiunti soltantoU63SY6280AAAC (C207620),R3006,8k1% (C23212),R301100k (C25803),C300/C30110µF25V0805 (C15850). Cinque nuovi componenti, totale173footprint, PCB sempre57×66mm. Gruppo compatto suF.Cu, circa10,2×5,6mm inclusi courtyard. Condensatori vicino aIN/OUT e resistenzaISET vicino alchip. Posizioni in placement16.json. Meccanica, magnetici centrati,16LED/header,USB,Qwiic,J25/J26/J27 invariati; elettronicaF circostante riposizionata dove necessario per fare spazio.

IlregolatoreU4 continua ad alimentare direttamente ESP32,CAN,expander e rail3V3 dei connettori. Solo le16source deiP-MOSFET e i relativi pull-upgateRN1..RN4 passano sulla nuova rete3V3_ROWS, alimentata daU63. GND non viene interrotto e rimane comune. Pull-upOE degli switchGPIO e tutte le reti GPIO/ADC restano sulla logica originale. Non aggiunti diodi, resistenze serieGPIO, comparatori o protezione da5V esterni. Le prese dirette3V3 suJ25/Qwiic/J26/J27 sono a monte e non protette daU63.

EN diU63 segue EXP_RESET_N diU60 con pull-down100k: reset comune basso tiene U63spento e gli expander in reset. L'abilitazione segue la sequenza firmware esistente basata suGPIO0, ancora da implementare e validare. La versioneSY6280A non scarica attivamente l'uscita: il rail può restare carico, non assumere0V istantanei all'arresto. Non c'è un'uscitaFAULT e non viene implementato un rilevamento software dei corti.

R300 imposta1A nominale condiviso, non1A per riga e non un limite preciso500mA. Datasheet:RSET6,8kΩ→0,75/1/1,25A aVIN5V e25°C; considerare tolleranzaR1% e validare a3,3V e agli estremi termici del prodotto. L'obiettivo resta500mA su una singola riga VCC/GND, entro il budget condiviso. I500mA non si applicano aGPIO/ADC.

In sovraccarico U63 limita la corrente; con guasto persistente il proprio arresto termico spegne il passante circa130°C e riprova quando scende a110°C. La temperatura misurata è quella del chip, non quella dei MOSFET/sensori. Un corto può far calare tutte le righe. La capacità d'uscita scarica comunque la propria energia nel corto prima/durante l'intervento; non è una soglia istantanea ideale. Questo non è un sistema di protezione universale.

A500mA, RON tipica63mΩ diU63 corrisponde a31,5mV e15,75mW (dato di datasheet a5V/25°C, non massimo qualificato a3,3V). Con la coppiaP/N delle righe il carico vede una caduta preliminare di circa98mV prima di piste e contatti. I dati vanno confermati nella realizzazione. Raccomandazioni di layout del produttore: collegamenti corti/largi, pianoGND e rame di potenza2oz; stackup e prestazioni con il rame effettivo della scheda devono essere approvati al momento dello sbroglio, senza dichiarare già qualificato il progetto1oz.

Verificato:173footprint,5aggiunti, corretta separazione3V3/3V3_ROWS,16sourceP e4arrayPG a valle, nessun altro cambio di rete sui componenti originali,0discrepanze schema/PCB,ERC0errori/69avvisi eDRC24rilievi preesistenti (20magnetici sul bordo+4courtyardHanxia). Nessuna pista/piano aggiunto, nessun test fisico eseguito. Prima della produzione: sbroglio e prova500mA/corto, temperatura a regime, transitori sul3V3 del micro, spunto dei moduli, reset/POR/brownout e riprova termica.

Costo componenti aggiornato:circa17,37€/scheda sulotto10 e12,06€ su1000, incremento rispettivamente0,15€ e0,09€. IncludeFlexyPin; esclusiJ26/J27,PCB,montaggio,case,collaudo,spedizione,IVA e commissioni. Snapshot aggiornato in cost-summary.json; i passivi senza codice e i piccoli lotti sottoMOQ restano stimati come descritto nel file.

Datasheet verificato: https://datasheet.lcsc.com/datasheet/pdf/0bb6d32dcc3617db282edbab086c64b5.pdf?productCode=C207620

## Profilo stondato e serigrafia a capsule

Revisione estetica: ingombro massimo57×66mm conservato, angoli superioriR2,2mm, inferioriR3mm e spalle esterne dei magneticiR0,65mm. Sono stati raccordati soltanto vertici convessi, rimuovendo materiale; le pareti e gli angoli interni delle sedi magnetiche rimangono invariati. Fori, asole del modulo, magnetici,USB,header,LED e fori di fissaggio mantengono posizioni e dimensioni. U51 è spostato di1,2mm verso l'interno per rispettare la distanza dal nuovo arco; tutti gli altri componenti rimangono fermi.

Sul lato visibile: cornice arrotondata della zona breadboard, capsule identiche per i tre fori connessi di ogni riga, collegamenti grafici solo fra i fori della stessa riga, cornici deiLED raccordate e brevi linee verso A1..A8/B1..B8. Un canale centrale grafico separa i banchi; è serigrafia, non un'asola reale. Cornici leggere per modulo e prese inferiori; nessuna scritta ulteriore aggiunta. Colore soldermask invariato.

Nessun componente, rete, funzione, pinout o costo della distinta modificato. Verificati173footprint e tutte le reti contro la netlist precedente. Profilo chiuso valido nel controlloKiCad;DRC24rilievi preesistenti, nessuno nuovo (20contatti magnetici sul bordo e4courtyardHanxia). Nessuna nuova lavorazione interna: restano i ritagli del progetto precedente. Il PCB rimane da sbrogliare e collaudare; modifiche estetiche non equivalgono a qualifica di produzione. Dettagli geometrici in aesthetic_revision neiJSON di progetto.

### Minimal row silkscreen revision
Removed ESP32, south connector, work-area and RGB halo frames; retained row capsules, links, A/B labels and center channel. Rounded magnetic inner and outer shoulders with 0.30 mm radii (0.15 mm lower-right beside CAN), enlarging recesses only. Board stays 57 x 66 mm; no components moved or electrical changes; DRC remains 20 magnetic copper-edge exceptions and 4 Hanxia courtyard overlaps.

### Magnetic bus expansion: J28 / J29
Added two Hanxia C42380985 sockets on the electronics face (F.Cu), opposite the visible RGB/breadboard face, centered on the existing magnetic PTH apertures. Pins 1..5 from north to south are GND, DET (existing respective termination-control net), CAN_L, CAN_H, 5V; pins 6..8 are upstream 3V3, I2C_SDA, I2C_SCL. See magnetic-expansion-pinout.csv. The connector footprint intentionally omits its first five NPTH apertures because the matching 1.1mm plated holes already belong to J9/J2. Do not use it independently without supplying those holes. Ten local F.Cu links connect socket pads to magnetic PTHs; the remainder of the board is still unrouted.

Board remains 57x66mm; magnetics, USB, breadboard and expansion/mezzanine headers are fixed. RGB columns moved inward 1.2mm while preserving row alignment. D6, Q45, Q9 and C86 moved to B.Cu to clear the extra apertures. No existing electrical pin/net assignments changed. DET is part of automatic CAN termination and is not a spare GPIO. New connectors carry direct upstream power and I2C: row current limiting does not protect them; CAN modules require their own transceiver and power-source isolation belongs on feeding modules.

ERC:0 errors,69 existing warnings. DRC:20 existing magnetic edge exceptions and4 existing Hanxia courtyard overlaps, plus12 intentional shared-hole assembly reports (10 magnetic PTHs inside their socket courtyard and2 magnetic/socket pad courtyards). No new shorts, copper/hole clearance, mask or silk violations. Physical assembly and insertion from either face still require a sample, particularly the shared plated apertures. No display has been added.

The two extra sockets add about EUR0.58/board at10boards or EUR0.35 at1000boards (C42380985 pricing checked2026-11-08). Updated consumed-material estimates excluding J26/J27 and all fabrication/assembly/tax/shipping: EUR17.94 and EUR12.41/board respectively. Other component prices and FX retained from the previous estimate; see cost-summary.json.

### Opposite-face correction for magnetic sockets
J28 and J29 now mount on F.Cu, opposite the visible RGB/breadboard face, with the same aperture centers and physical north-to-south pin order. Their ten local links are now on F.Cu. Components near their solder tails were relocated: L1/U2/U60/RN12 now on B.Cu, R204/R128/C84/R15 and seven RGB decoupling capacitors adjusted on F.Cu; Q45/Q9 moved slightly on B.Cu. No parts added or removed, no signal assignments changed, cost unchanged. Board remains57x66mm, magnetics centered and RGB positions unchanged. DRC remains the same36 documented reports (20 magnetic-edge,4 breadboard socket courtyard and12 intentional shared-hole magnetic/socket assembly reports); no new shorts, clearance, mask, silk or hole violations. Final hardware fit and full routing remain to be done.

### Separate internal and user I2C buses
Internal I2C_INT_SDA/SCL uses ESP32 GPIO4/GPIO5 and connects only U40/U41/U42, with newly added R302/R3034.7k pull-ups to direct logic3V3. User I2C_USER_SDA/SCL uses GPIO11/GPIO12, with existing Qwiic R24/R25 pull-ups4.7k to3V3; reaches Qwiic J4, Hanxia J28/J29pins7/8, south J25 and passive mezzanine connectors. The user bus has no direct SDA/SCL connection to the row-control bus; ground and supply remain common. Firmware must configure two independent ESP32 I2C controllers; no firmware implementation is included.

J25 pin5 and15 are the same user SDA; pin6 and16 are the same user SCL. J26 pin18 and28 duplicate user SDA, while J26pin20 and J27pin26 duplicate user SCL. These GPIO11/12 contacts are now reserved for user I2C; seven other GPIO remain available (13,15,16,43,44,47,48). The former shared I2C net names are removed. See updated connector CSVs and schematic-signals.csv. All I2C levels are3.3V. An external device holding SDA/SCL low cannot directly hold the internal bus lines low; common-power faults are not isolated.

177 footprints, two extra0603 resistors only; existing placement,57x66mm outline, magnetics and opposite-face Hanxia unchanged. No new ERC/DRC issues:0 ERC errors/69 existing warnings;36 documented DRC reports remain. Exact exported net node sets for all four I2C signals and all PCB pad connections checked. The PCB remains generally unrouted apart from ten magnetic/socket links; full routing, firmware and sample validation remain.

### Uniform visible rounding of the full outer perimeter
All12 outer corners checked:8 magnetic recess/shoulder corners now use1.0mm radius, upper board corners2.2mm and lower corners3mm. All24 line/arc junctions checked for tangency and a closed outer loop. The recesses were enlarged by removing material; no material added in the magnetic connector clearance. Board bounds remain57x66mm; magnetics and Hanxia fixed. Functional internal ESP slots and silk unchanged. R18 moved to B.Cu at159,80.8 and rotated0; L1 shifted south0.8mm, Q45south0.6mm, CAN U2south0.9mm to keep copper/assembly clearances. No electrical/BOM/cost changes; all177PCB footprints match the current independent-I2C schematic netlist. DRC remains36 documented baseline/shared-hole reports; no new issues. Full routing and physical qualification remain pending.

### Service electronics exclusively on top / F.Cu
All service components now mount on F.Cu. Returned C86,U60,L1,R18,RN12,U2,Q45,Q9,D6 from B.Cu; B.Cu contains exactly U1ESP32 and16RGB indicators. Repacked the service electronics to preserve57x66mm, all rounded edges, magnetic midpoints, Hanxia/shared apertures, south/mezzanine connectors, USB/Qwiic, test points, ESP/FlexyPin and RGB positions. Buck U4/L1/C5/C86/R36/R37/C84, row limiter U63/C300/C301/R300/R301, reset U60/C200/R203 and CAN U2/C74 are packed as local functional groups. See top-service-layout.json for exact positions and sides.

177footprints:160top and17bottom. All pad-net mappings match the independent internal/user I2C schematic; no parts added, no electrical/BOM/cost changes. DRC remains36 documented baseline/shared-hole reports; no new shorts, clearances, courtyard, mask, silk or hole violations. This is a placement revision: only ten local magnetic/socket links are routed; full routing, decoupling/power-loop/EMC qualification and hardware validation remain pending.
