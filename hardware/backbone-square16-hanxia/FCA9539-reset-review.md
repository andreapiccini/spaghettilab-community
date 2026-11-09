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
