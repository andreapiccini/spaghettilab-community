# PANEL16 / FFC60 — 10 novembre 2026

Schema e PCB aggiornati nella variante backbone-square16-hanxia. Dimensioni78×78mm: crescita soltanto verso sud rispetto a78×57,2mm. Antenna, modulo MCU, magnetici e64contatti breadboard mantengono le posizioni precedenti. J28/J29 spostati0,3mm verso l'esterno con adeguamento degli estremi delle piste esistenti. I componenti di servizio interferenti con le nuove luci sono riposizionati; alimentatore U4/L1 invariato. Disaccoppiamenti, loop di potenza e segnali veloci richiedono rifinitura prima del routing.

## Pannello

U90/C920 e16elettrodi di riga rimossi dal progetto attivo. U91 resta sul bus software dedicato;16ingressi: PLAY/PAUSE,DEBUG,LOCK,STOP,5pagine,7tasti condivisi. Il numero di touch non cresce. Key16 deve essere configurato touch, non IRQ. I file global-touch-pinout.json e panel16-behavior.json prevalgono sulle vecchie descrizioni. Il vecchio touch16.kicad_sch non è più referenziato dal foglio principale.

61LED del pannello:4comandi,5pagine,35legende,16frecce,APPLY.9LED preesistenti riutilizzati,52aggiunti. Driver U70 esistente: **129 canali occupati, 15 liberi**. Le coppie anodo/catodo sono uniche e verificate; panel16-led-map.json è la mappa aggiornata. LED di riga/logo/stato restano separati. Le tinte del simulatore non costituiscono una distinta colori: nuovi LED C3646937 verdi, componenti riutilizzati mantengono i colori esistenti.

LOCK spegne tutte le spie dei comandi tranne LOCK e STOP; non cambia uscite né indicazioni di riga/stato. Sblocco mantenendo LOCK2s. STOP ha priorità anche durante LOCK/APPLY: disarma ROW_ARM_N, annulla la richiesta APPLY, conserva bozza e slot e richiede PLAY/YES per ripartire. Le conferme YES/NO sono ai due estremi. SELECT ALL accende tutte le frecce, senza cortocircuitare tra loro le righe.

**Firmware non implementato su questa revisione.** Il simulatore è verificato ma non pilota hardware. Il firmware presente nel repository usa ancora una vecchia mappa. Il protocollo touch e il driver LED vanno integrati con i profili dual-MCU, il reset e il break-before-make di controls16.json. In assenza di firmware compatibile non dichiarare operativi STOP,LOCK o l'interfaccia.

## FFC60

J32 XUNPU FPC-05FB-60PH20 / C2856839, SMD sul lato componenti F.Cu; nessun pin sporge dal lato utente B.Cu. Footprint derivato dal disegno del produttore:passo0,5mm,pad0,3×1,2mm,ancoraggi2×1,8mm,interasse32,6mm,corpo33,5×4,9mm. Nastri spessore estremità0,3mm. Controllare campione fisico, polarità pin1 e orientamento same/reverse prima di acquistare serie. Il nastro citato C2857767 è60poli,5cm,contatti opposti; non collegare soltanto sulla base del numero dei pin.

Asola arrotondata32,5×2mm, larghezza nastro nominale30,5mm. Riserva rame su tutti gli strati. Non usare il nastro come supporto meccanico; case e raggio di piega devono essere qualificati. La mezzanina/accessorio richiede il proprio fissaggio e circuito.

Pin1..48:16triplette ROW/GPIO/GND. ROW è il nodo fisico; GPIO è prima dell'isolamento. **Non ponticellarli sull'accessorio.** Pin49..52:GPIO16/48/44/43, alias S3; consultare profilo S31. UART0 può emettere log all'avvio. Pin53/54:I2C_USER SDA/SCL;55/56:GND;57:3V3;58:EXP_RESET_N;59/60:5V. Mappa dettagliata in ffc60-pinout.csv. Nessuno shunt/ADC/DAC di precisione aggiunto sulla backbone.

Pin58 è uscita della backbone, ingresso dell'accessorio:LOW obbliga a disabilitare tutte le uscite dell'accessorio. Deve agire sull'hardware OE con default OFF anche quando un'alimentazione manca; non basta un messaggio firmware. L'accessorio deve impedire backfeed attraverso I/O non alimentati. STOP non può isolare una sorgente esterna che ignora questo contratto.

I rail sono quelli condivisi esistenti, senza nuove protezioni o isolamento sul FFC.0,5A/contatto è il dato della presa, non una corrente garantita del nastro/PCB: due contatti5V non costituiscono una porta5A. Dimensionare corrente consentita sul cavo realmente acquistato, riscaldamento e budget del regolatore; per moduli batteria di potenza serve il percorso dedicato. Nessuna frequenza/precisione garantita su nastro: mantenere corto, usare i ritorni distribuiti e qualificare con il modulo reale.

## Ottica e fabbricazione

Le aperture maschera rappresentano finestre attraverso FR4, non fori. Il FR4 non garantisce una scritta uniformemente retroilluminata: occorre un overlay traslucido con separazione ottica tra le5legende per tasto. Le35legende fisse B.SilkS sono state spostate sopra le rispettive finestre per evitare il taglio della serigrafia. panel16-label-overlay.svg è una dima della sola striscia di legende: nero opaco, bianco traslucido, da qualificare dimensionalmente/otticamente con il case. Non è un file finale di produzione dell’intero frontalino. La leggibilità dei piccoli caratteri va verificata sul campione. Non approvare una produzione con le sole immagini simulate. La sensibilità touch, soprattutto i grandi tasti a cornice, va provata con il materiale del case/overlay.

## Verifiche e limiti

ERC:0errori,66avvisi. Confrontati1209pad numerati:0differenze schema/PCB. Nessuna modifica elettrica ai pin preesistenti estranei al touch.60contatti J32 verificati. Nessun corto riportato; nessuna nuova violazione di distanza tra net, bordo rame o keepout rispetto alla baseline.

**Non pronta per produzione:** DRC416rilievi rispetto a410nella baseline, con499elementi non connessi riportati dal controllo. Persistono collisioni courtyard,fori/maschera e serigrafia; le nuove frecce richiedono verifica delle tolleranze di montaggio accanto ai LED esistenti. Il controllo può limitare i rilievi per categoria, quindi il conteggio non equivale al numero di difetti fisici. Routing non completato. Nessuna prova elettrica/ottica/termica su prototipo.

Fonti: https://www.lcsc.com/product-detail/C2856839.html e disegno archiviato references/FFC60-C2856839.pdf. Revisione reversibile: copia completa dei file di partenza conservata nella cartella di lavoro del task; nessun commit o push effettuato.
