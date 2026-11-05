> Aggiornamento 2026-11-05: la configurazione U4/R36/R37/C84 descritta sotto e storica; vedere [revisione SY8089 applicata](POWER-ECONOMY-20261105.md). Le proposte di protezione e CM5 restano separate.

# Alimentazione, protezioni porte e CM5 — 2026-11-04

## Correzione implementata sulla Backbone

U4 passa da TPS562201DDCR a **AP63203WU-7, LCSC C780769**, uscita fissa 3,3 V / 2 A, ingresso raccomandato da 3,8 V. Il regolatore usa modalità a basso dropout quando l'ingresso si avvicina all'uscita. Il vecchio richiedeva 4,5 V. D6 SS54 rimane: non viene ponticellato, quindi resta il blocco del ritorno dalla rail 5V verso VBUS USB. Questa revisione corregge il margine del regolatore, non elimina la caduta del diodo sulla rail chiamata 5V. [Datasheet Diodes](https://www.diodes.com/assets/Datasheets/AP63200-AP63201-AP63203-AP63205.pdf).

AP63203 non è pin-compatible con TPS562201: aggiornati simbolo di libreria, simbolo nello schematico e reti sulle piazzole PCB. Pin AP63203: 1 FB, 2 EN, 3 VIN, 4 GND, 5 SW, 6 BST. Pin 2 e 3 a 5V; 4 a GND; 5 a BUCK_SW; 6 a BUCK_BOOT. R36 ora è **0 Ω obbligatoria**, portando il feedback all'uscita. R37 è **DNP**, non montata: non serve più il partitore esterno. Lasciato il footprint come opzione di assemblaggio, senza muovere componenti bloccati o gli altri circuiti. Aggiornate le tre aree locali di larghezza ai nuovi pin EN/VIN/GND.

L1 rimane 3,3 µH: nella specifica applicazione con ingresso non superiore a 5,25 V il ripple calcolato resta circa 0,45 A con L ridotta del 20% e frequenza ridotta del 6%. Picco stimato a carico 2 A: circa 2,23 A. Il componente esistente XRTC404012S3R3MBCA è catalogato 4,5 A / Isat 5 A / DCR 67 mΩ. Nessuna estensione ad alimentazioni superiori a 5V: anche gli altri componenti della scheda lo impediscono. [Induttore LCSC](https://www.lcsc.com/product-detail/C39846848.html?is_substitute=1&original_product_code=C5307598&original_unit_price=0.0925).

C5 nominale 22 µF, C9+C86 nominali 44 µF e bootstrap 100 nF sono mantenuti. Il costruttore propone 10 µF d'ingresso, 2×22 µF d'uscita e 100 nF bootstrap. Verificare capacità effettiva sotto polarizzazione e temperatura, ringing, transitorio e dissipazione sul PCB finito; rame 35 µm non equivale alla raccomandazione termica di layout a 2 oz. Il valore 3,8 V minimo non garantisce qualunque caduta di cavo o qualunque carico a ogni temperatura. Obiettivo pratico: ingresso al buck almeno 4,0 V sotto carico, da qualificare sul prototipo. Non aumenta i 2 A totali condivisi di VCORE.

Prezzo indicativo consultato: **1,20 USD a un pezzo / 1,07 USD da dieci**, tasse e spedizione escluse, da ricontrollare all'ordine. [LCSC C780769](https://www.lcsc.com/product-image/C780769.html).

Verifica: solo quattro associazioni pin/net di U4 cambiano; tutte le altre connessioni restano uguali. Valore R36 e DNP R37 controllati in schematico e PCB. ERC 0 errori / 143 avvisi; DRC 155 fisiche preesistenti, zero nuove; parità 69; 462 collegamenti da instradare. Nessuna pista, via o mezzanina aggiunta. Le note precedenti sul TPS562201 sono storiche e superate da questa revisione. Evidenze in `bom/power-correction-20261104/`.

## Protezione economica: proposta, non ancora inserita nel CAD

Un solo limitatore sull'alimentazione del MOSFET P protegge il percorso che parte da VCORE, ma non il MOSFET N quando il carico è alimentato dall'esterno. Un PTC non garantisce intervento abbastanza rapido per il corto fra i due MOSFET. Per questo vanno distinti due livelli.

**Livello minimo: sei SY6280AAAC, uno per porta, tra VCORE e source del P.** Il pull-up del gate P deve seguire la source protetta. Aggiungere RSET e disaccoppiamento secondo datasheet. Formula nominale 6800/RSET: 16,9 kΩ dà circa 0,40 A; 13,7 kΩ circa 0,50 A. Considerare tolleranze del limitatore: non promettere 500 mA esatti. Versione A senza scarica automatica dell'uscita. Limitazione/termica riducono le conseguenze del corto verso massa e dell'accensione contemporanea, ma non costituiscono un interblocco e non proteggono tutte le correnti iniettate dall'esterno. Evitare condensatori grandi dopo il limitatore: possono scaricarsi nel guasto senza essere limitati. [Silergy, datasheet distribuito da LCSC](https://datasheet.lcsc.com/lcsc/Silergy-Corp-SY6280AAAC_C207620.pdf).

Costo indicativo chip **0,10 USD ciascuno**, circa 0,60 USD per sei, più resistenze/condensatori. [LCSC C207620](https://www.lcsc.com/product-image/C207620.html). Questa è l'opzione minima, non una protezione universale delle porte.

**Soluzione preferita per evitare il corto interno: driver protetto al posto di ogni AO6604**, per esempio DRV8210DRLR C3681297, più il limitatore precedente se si vuole contenere la corrente erogata intorno a 0,4–0,5 A. Il DRV8210 integra dead time (500 ns tipico), protezione di sovracorrente e termica; la soglia OCP tipica è circa 1,76 A, quindi non sostituisce un limite da 0,5 A. La resistenza del singolo MOSFET è circa 0,475 Ω tipica: a 0,5 A circa 0,24 V di caduta, prima di shunt e limitatore. [TI DRV8210](https://www.ti.com/lit/ds/symlink/drv8210.pdf).

Proposta di collegamento PWM: OUT1 al ponte rimovibile R117…R122; OUT2 non collegata; VM dalla rail protetta della porta; IN1 = NOT(P_GATE), IN2 = N_GATE. Un SN74LVC04A a sei inverter mantiene la semantica attiva-bassa dei P_GATE esportati. Pull-up P_GATE e pull-down N_GATE assicurano il comando di riposo; garantire ingressi definiti anche durante la rampa di alimentazione.

| P_GATE | N_GATE | Comando | OUT1 |
|---:|---:|---|---|
| 1 | 0 | Nessun driver | Hi-Z |
| 0 | 0 | Source | Alto |
| 1 | 1 | Sink | Basso |
| 0 | 1 | Entrambi richiesti | Basso, senza corto interno fra i MOSFET |

Questo evita lo shoot-through interno tramite driver dedicato, ma lo stato basso può comunque assorbire corrente da una sorgente esterna. L'OCP del driver tutela il componente entro le condizioni del datasheet, **non certifica shunt 0603, sensore, cablaggio o connettore a 0,5 A**. Per ingressi esterni non limitati serve anche una protezione bidirezionale del percorso di porta o una specifica esplicita della sorgente esterna.

Budget indicativo IC: 6×DRV8210 a 0,33 USD + 6×SY6280A a 0,10 USD + un inverter esaplo circa 0,18 USD = **circa 2,76 USD per tutta la scheda**, esclusi passivi, assemblaggio, tasse e spedizione; non è un preventivo. [DRV8210 LCSC](https://www.lcsc.com/product-image/C3681297.html), [inverter TI C352968](https://lcsc.com/product-detail/Inverters_Texas-Instruments_C352968.html).

Compromessi prima di implementare: caduta e leakage del driver sono maggiori rispetto a MOSFET discreti; il datasheet riporta leakage Hi-Z non trascurabile in alcune condizioni. Per misure analogiche sensibili aprire fisicamente R117–R122. Tempi di risveglio e commutazione devono essere considerati negli stimoli; non è una sorgente analogica di precisione né un driver RF. La proposta richiede una nuova disposizione locale e verifica termica/pulsata degli shunt. Il resto della catena, in particolare lo switch verso ESP, deve restare escluso dal percorso di potenza.

## Compute Module 5 su mezzanina

**Fattibile come nuova scheda adattatrice**, non innestabile direttamente nei BergStak della Backbone. La verifica del file ufficiale `CM5IO.kicad_pcb`, scaricato dal [portale Raspberry Pi](https://pip.raspberrypi.com/categories/1098-design-files), dà interasse **34,00 mm** tra i due connettori da 100 contatti. Backbone J10/J11: **24,175 mm**, entrambi a y=101,15 mm, centri x=155,6625 / 179,8375. Passi e pinout diversi: occorrono entrambi i sistemi di connettori sull'adattatrice.

CM5 misura **55×40 mm**. Fori M2.5 su rettangolo **48×33 mm**. Distanza fra PCB CM5 e PCB adattatrice: **1,5 mm** con 10164227-1001A1RLF oppure **4,0 mm** con 10164227-1004A1RLF; spazio disponibile sotto i componenti del modulo rispettivamente nullo oppure circa 2,5 mm. L'altezza totale montata dichiarata è circa 4,94 / 7,44 mm sopra la carrier, senza dissipatore. [Datasheet CM5](https://datasheets.raspberrypi.com/cm5/cm5-datasheet.pdf).

L'ingombro rettangolare massimo della Backbone è circa 42,5×78,7 mm: orientando i 40 mm del CM5 sulla larghezza e i 55 mm sulla lunghezza, l'inviluppo geometrico è compatibile. Questo **non dimostra** assenza di collisioni: restano header neri, incavi della Backbone, fissaggi, antenna ESP, componenti e dissipatore CM5. La soluzione sensata è CM5 sulla faccia superiore dell'adattatrice, esposto per raffreddamento; componenti Backbone sotto. Preferibile altezza CM5 4 mm dove serve spazio, verificando separatamente anche l'altezza Backbone–adattatrice. Le due altezze non sono intercambiabili.

Non è necessario esportare tutti i 200 contatti CM5 sulla Backbone: HDMI, MIPI, USB3, PCIe, Ethernet e relativo routing rimangono sulla mezzanina. Backbone può offrire I²C/SPI/UART, controlli e porte tramite circuiti di interfaccia appropriati; i segnali analogici/Kelvin richiedono ADC/front-end, non entrano direttamente nei GPIO CM5. Evitare contese con ESP e sequenze che alimentino un CM5 spento attraverso i segnali.

**Alimentazione consigliata: ingresso 5V dedicato sulla mezzanina CM5.** Il modulo richiede 4,75–5,25 V ai propri pin; il budget ufficiale prevede fino a 2,5 A per il modulo, oltre ai carichi esterni. La USB-C può negoziare 5V/5A tramite i segnali CC del CM5. Il progetto Backbone non esporta quei CC e la sua rail dopo D6 non garantisce 4,75 V. Il cambio del buck a 3,3 V non cambia questo fatto.

Con CM5 a 2,5 A più il consumo Backbone, la dorsale di progetto 3 A può essere insufficiente; i sei contatti paralleli non bastano da soli a garantire il sistema. Un unico ingresso sulla mezzanina può alimentare CM5 direttamente e fornire **solo la corrente necessaria alla Backbone** attraverso i contatti 5V, con limitazione e selezione delle sorgenti. In tale architettura i 5 A complessivi non devono attraversare la Backbone. Non unire l'uscita 3,3 V del CM5 a VCORE. Prevedere isolamento dei segnali a scheda spenta, alimentazione monotona e spegnimento ordinato del sistema Linux. L'eventuale antenna integrata CM5 richiede keepout dedicato; antenna esterna consigliabile se la sovrapposizione lo impedisce.

Nessuna scheda CM5 o protezione delle porte è stata aggiunta al CAD in questa revisione: sono soluzioni documentate per la prossima scelta progettuale. La sola modifica implementata è la correzione dell'alimentazione Backbone.
