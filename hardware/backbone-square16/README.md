# Backbone a 16 righe — variante separata

Stato: assegnazione GPIO e circuito a 16 porte applicati e verificati sulla netlist. PCB sincronizzato, disposizione preliminare 68 × 68 mm, non sbrogliato e non pronto per produzione. La Backbone originale non è stata sovrascritta.

Aprire `backbone.kicad_pro`. Il secondo foglio `ports16.kicad_sch` contiene i dieci canali aggiunti e i nuovi comandi. `gpio16-allocation.csv` è la tabella completa; `connectivity-checks.json` riporta le verifiche di collegamento.

## Righe configurabili

| Posizione | Sinistra: GPIO | Destra: GPIO |
|---|---:|---:|
| 1 | 7 | 12 |
| 2 | 8 | 15 |
| 3 | 9 | 16 |
| 4 | 10 | 38 |
| 5 | 1 | 39 |
| 6 | 2 | 40 |
| 7 | 6 | 41 |
| 8 | 11 | 42 |

Sinistra: J18/J19/J21, contatti 1–8, reti PORT_A0–PORT_A7. Destra: J22/J23/J24, contatti 1–8, reti PORT_A8–PORT_A15. Ogni riga ha tre contatti comuni. Le due metà sono indipendenti: nessuna matrice di collegamento fra righe.

Ogni riga dispone di selezione VCORE (3,3 V), GND, GPIO o alta impedenza mediante MOSFET e switch analogico. I GPIO non sono tolleranti a 5 V. Le nuove porte riprendono la topologia delle sei esistenti: shunt 0,1 Ω con prese Kelvin e collegamento 0 Ω rimovibile verso lo stadio di potenza. Il valore dello shunt non costituisce una specifica di corrente o di accuratezza già validata per la futura mezzanina.

L1–L7 hanno ADC1; L8 e R1–R3 hanno ADC2, con le limitazioni del relativo driver/modalità di acquisizione. R4–R8 non hanno ADC diretto. Tutti i 16 segnali restano GPIO reali del micro; gli expander comandano solo le selezioni e i servizi lenti.

## Funzioni conservate

| Funzione | GPIO conservati |
|---|---|
| I²C | 4, 5 |
| CAN | 17, 18 |
| USB | 19, 20 |
| LED RGB | 21 |
| Collegamento SPI e relativi segnali di controllo | 13, 14, 43, 44 |
| UART di programmazione AG32 | 47, 48 |

I GPIO 0, 3, 45 e 46 non sono assegnati alle righe; GPIO35–37 sono esclusi perché riservati alla PSRAM della variante ESP32 prevista. Gli eventuali collegamenti storici di questi segnali sulla vecchia interfaccia mezzanina non li rendono disponibili: andranno trattati come riservati nella revisione del connettore.

Le reti preesistenti dei servizi arrivano ancora ai rispettivi connettori. I comandi prima attestati ai dieci GPIO recuperati ora fanno capo agli expander. Il vecchio firmware non è compatibile con questa variante senza aggiornamento.

## Comandi aggiunti

Tre TCA9535 della famiglia già usata, U32/U33/U34, indirizzi I²C a 7 bit 0x21/0x22/0x23. U25 resta a 0x20. Gli indirizzi 0x20–0x23 devono essere riservati sulla rete I²C condivisa.

- U32: comandi P/N delle porte A6–A13, alternati su P00…P07 e P10…P17.
- U33: P/N delle porte A14–A15, dieci enable degli switch A6–A15 e ESP_ISO4_N/ESP_ISO5_N.
- U34: P00=MEAS_S0, P01=MEAS_S1, P02=MEAS_S2, P03=MEAS_INHIBIT, P04=EXT_SPI_CS_N, P05=ESP_AG_BOOT0, P06=ESP_AG_RESET_N, P07=MEZZ_PRESENT_N (ingresso). P10–P17 sono collegati a GND e devono restare ingressi.

La selezione EXT_SPI_CS_N ora richiede una transazione I²C: utilizzarla ai confini di una transazione SPI, mantenendola attiva durante il trasferimento. Non è più un chip-select commutabile direttamente a ogni parola tramite periferica ESP. Clock e dati del collegamento SPI conservano i GPIO diretti. Boot/reset dell'AG32 restano disponibili con il nuovo comando I²C.

## Contratto firmware da implementare

Gli expander partono come ingressi a freddo. Pull-up dei gate P e degli enable, e pull-down dei gate N, tengono disattivati i dieci nuovi stadi. Il reset del solo ESP32 non resetta gli expander: non garantisce il ritorno automatico in alta impedenza. Le sei porte esistenti conservano anche la loro logica di ownership.

Prima di rendere gli expander uscite, scrivere i latch nello stato sicuro. Per i nuovi componenti:

| Expander | Output port 0 | Output port 1 | Configuration port 0 | Configuration port 1 |
|---|---|---|---|---|
| U32 | 0x55 | 0x55 | 0x00 | 0x00 |
| U33 | 0xF5 | 0xFF | 0x00 | 0x00 |
| U34 | 0x58 | 0x00 | 0x80 | 0xFF |

Per U34 abilitare le uscite soltanto dopo aver assegnato l'ownership dei segnali condivisi: l'AG32 deve lasciare in alta impedenza i pin che l'expander pilota. In assenza di accordo lasciare i bit condivisi come ingressi. I selettori MEAS_S0–S2 hanno pull-down: non possono generare il livello alto con la sola emulazione open-drain. Occorre pilotaggio push-pull con un solo proprietario alla volta. Anche l'accesso I²C da due controllori richiede arbitraggio/ownership nel firmware.

Ogni cambio funzione deve passare da uno stato intermedio spento: disabilitare lo switch GPIO, spegnere entrambi i MOSFET, attendere l'assestamento, quindi abilitare una sola funzione. Non abilitare mai contemporaneamente P e N. Non alimentare una riga mentre ESP/FPGA o un dispositivo esterno la pilotano. Per ricevere/generare un segnale dalla futura mezzanina: P e N spenti, percorso ESP disabilitato, interfaccia esterna compatibile con tensioni e alimentazioni.

Questa tabella è una specifica di inizializzazione, non firmware già compilato o collaudato. Verificare limiti logici e stato di accensione anche con il modello esatto di expander acquistato e con la futura mezzanina collegata.

## Cosa resta per mezzanina e misure

La revisione del connettore è rinviata come concordato. Le sei porte storiche conservano i collegamenti esistenti. I dieci nuovi segnali e le venti nuove prese Kelvin non sono ancora esportati su J10/J11. Non è quindi ancora possibile usare tutte le 16 righe dall'FPGA della mezzanina attuale. Non sono stati aggiunti INA o DAC alla Backbone.

L'alta impedenza degli switch non elimina capacità parassite, leakage o collegamenti dello stadio di potenza: non è una garanzia di banda analogica. I link 0 Ω permettono di scollegare lo stadio di potenza per configurazioni dedicate; la banda va verificata con la mezzanina e il layout definitivo.

## Meccanica e controlli

PCB preliminare 68 × 68 mm, con magnetici ai lati e antenna ESP al bordo superiore. Tre socket per banco, interasse fra copie 5,08 mm, gap centrale 7,62 mm. Gli interassi delle prime sei posizioni fra J17/J18 e J20/J19 restano 33,02 mm. J10/J11 mantengono 24,175 mm tra centri; la posizione assoluta della mezzanina cambia e va verificata sul suo PCB. I nuovi componenti sono sul top; il modulo ESP/FlexyPin conserva il lato di montaggio originale.

La disposizione è una verifica preliminare di ingombro, non un layout ottimizzato e approvato per integrità di segnale, dissipazione o produzione. Sono ancora da qualificare l'inserimento dal bottom dei socket Hanxia, gli ingombri dei moduli e del case, la regione reale dell'antenna e gli accessi per manutenzione. Non è stato generato uno STEP completo del modulo ESP.

Il controllo della netlist verifica 16 GPIO distinti, 48 contatti di riga, collegamenti nuovi, preservazione delle funzioni e corrispondenza di 930 piazzole del PCB. Sono stati eliminati dalla copia i footprint duplicati e i due header campione fuori scheda. L'ERC mantiene avvisi dei simboli importati (pin non tipizzati) e delle prese di misura non ancora collegate. Il DRC non è pulito: rimangono soprattutto serigrafie, cinque sovrapposizioni dei courtyard dei socket a interasse fisso, anelli FlexyPin da qualificare e rame al bordo dei magnetici. Tutti i collegamenti sono ancora da sbrogliare. Vedere `erc.json` e `drc.json` per l'elenco completo, senza soppressione degli errori.

Il progetto di partenza conteneva soltanto la netclass Default: nella variante sono state ripristinate le 20 classi del controllo di sbroglio precedente ed estese alle nuove reti. Le larghezze sono impostazioni di progetto, non nuove certificazioni della corrente ammessa. Tutti i nuovi R/C usano 0603.

## Reversibilità

Questa cartella è una variante indipendente. Per tornare alla scheda precedente aprire il progetto originale `hardware/backbone/backbone.kicad_pro`. Nessun commit o push è stato eseguito per questa variante.
