# Backbone — controllo prima dello sbroglio, 4 novembre 2026

> Aggiornamento successivo del 4 novembre: U4 sostituito con AP63203WU-7 (ingresso da 3,8 V), R36=0R e R37=DNP. Le parti di questo rapporto relative al TPS562201 e al partitore 33k/10k sono storiche. Vedere [correzione alimentazione e studio protezioni/CM5](POWER-CORRECTION-AND-PROTECTION.md). Restano validi i budget condivisi e i punti non modificati.

Le regole di instradamento sono state ripristinate e verificate. Questo controllo **non costituisce un via libera alla produzione**: rimangono criticità elettriche e meccaniche elencate sotto. Revisione limitata alla Backbone; mezzanina invariata.

## Correnti e dimensionamento

La scheda non contiene ancora piste o vias. Non esiste quindi una corrente massima verificata per ciascun tratto fisico: dipenderà anche da lunghezza, restringimenti, caduta di tensione, temperatura, riempimenti, vias e sorgente. I valori seguenti sono obiettivi di progetto, da verificare sul layout finito e sul prototipo.

| Percorso | Budget di progetto | Larghezza preferita esterna / interna L3 | Limite essenziale |
|---|---:|---:|---|
| VBUS USB e dorsale 5V | 3 A per il rame | 2 / 4 mm | Non autorizza 3 A dalla sorgente USB o dai contatti magnetici |
| VCORE 3,3 V | 2 A complessivi | 1,2 / 3 mm | Include ESP, LED, logica, porte e mezzanina |
| N_A0…5, PORT_A0…5 e PWR_DRV_A0…5 | 0,5 A per ramo | 0,5 / 0,8 mm | Budget condiviso, senza limitatore individuale |
| J10/J11, sei contatti paralleli per ciascuna alimentazione | 3 A come obiettivo del collegamento | Ventaglio locale 0,4 mm per contatto | Ripartizione da verificare; VCORE resta limitato a 2 A totali |
| J11.51, VBUS singolo | 0,5 A come budget prudenziale | Uscita locale 0,4 mm | Non usarlo come ingresso ad alta corrente per tutta la scheda |
| GPIO diretti ESP | 8 mA come allocazione preliminare | 0,2 mm | Non è il massimo garantito dal micro né un'alimentazione |
| SHUNT_SENSE_H/L | Nessuna corrente di carico | 0,15 mm | Solo bias/leakage del front-end; instradamento Kelvin |
| GND | Somma dei ritorni reali | Piani continui; 0,5 mm solo default locale | Non concentrare tutta la corrente in una pista da 0,5 mm |

I sei contatti di ogni rail sono J10/J11.1, .2, .5 per 5V e .3, .4, .10 per VCORE. Il costruttore indica 0,8 A per contatto: il prodotto aritmetico 6 × 0,8 = 4,8 A **non è la portata della Backbone**. A 3 A mediamente transiterebbero 0,5 A per contatto, solo con distribuzione adeguata. I 17 contatti GND devono sostenere il ritorno combinato delle alimentazioni. [Amphenol 61082-061402LF](https://www.amphenol-cs.com/product/61082061402lf.html).

Allocazione preliminare VCORE: ESP 0,60 A, sei LED 0,36 A, CAN 0,07 A, logica 0,07 A, margine 0,10 A: totale riservato 1,20 A. Restano **0,80 A complessivi**, non per porta, per porte, mezzanina e altri carichi a 3,3 V. Sono riserve di progetto, non consumi misurati. Un'eventuale riduzione della riserva richiede la caratterizzazione dei carichi reali.

Gli shunt R56–R61 sono 0,1 Ω, 0603, 100 mW: a 0,5 A dissipano 25 mW con 50 mV di caduta. 1 A raggiunge già 100 mW nominali senza margine termico: non è approvato come corrente continua. Non sono stati sostituiti per il budget di 0,5 A. Il rating e il derating del componente acquistato vanno confermati prima dell'ordine definitivo.

Il transistor e il ponte 0 Ω devono sopportare la corrente del ramo. AO6604 montato è **TECH PUBLIC C5182068**: dati di un AO6604 AOS non qualificano automaticamente questo componente, soprattutto a VGS = 3,3 V. Il budget di 0,5 A resta da qualificare termicamente con il componente reale. [Parte LCSC](https://www.lcsc.com/product-detail/C5182068.html).

## Regole applicate

Ripristinate 20 classi totali: prima erano presenti soltanto Default e KELVIN_SENSE, mentre le regole personalizzate richiamavano classi di potenza assenti. Assegnate esplicitamente tutte le 124 net collegate; 30 net non collegate restano Default. Il CSV [net-current-rules.csv](bom/pre-routing-review-20261104/net-current-rules.csv) riporta classe, larghezza, budget elettrico e stima termica separati per ogni net. [power-branches.csv](bom/pre-routing-review-20261104/power-branches.csv) distingue le uscite verso i componenti. Le allocazioni dei piccoli integrati sono preliminari: non sono i massimi del datasheet, né vanno sommate come se ogni pin consumasse quella corrente.

Creati 45 piccoli riquadri di regola intorno alle piazzole interessate di J10/J11 e U4. Le piste si restringono localmente alle piazzole: 0,4 mm ai connettori da 0,5 mm, 0,6 mm a VIN/GND di U4, 0,2 mm a EN. Le uscite di segnale verso U12/U13 restano sottili; non devono trasportare la corrente del carico. I default di potenza valgono sulle dorsali. La corrente di alimentazione dell'ESP entra in VCORE, non attraversa il bus switch verso i GPIO.

Una netclass non distingue automaticamente tutti i rami della stessa net. Le eccezioni locali aiutano l'uscita dalle piazzole; dopo il ventaglio bisogna tornare alla larghezza della dorsale oppure selezionare la larghezza adatta al solo ramo di carico. Il minimo DRC consente i restringimenti: **superare il DRC non certifica la portata** di una lunga pista sottile.

Rame nominale 35 µm su quattro strati; stackup nominale 1,6 mm da confermare con il fabbricante. I CSV usano esclusivamente una stima preliminare IPC-2221 storica: I = k × ΔT^0,44 × A^0,725, A in mil², k = 0,048 esterno / 0,024 interno, ΔT = 10 °C. A 2 mm esterni risultano circa 3,95 A; a 1,2 mm circa 2,73 A; a 0,5 mm circa 1,45 A. Non sono valori garantiti, non sostituiscono un'analisi IPC-2152 e non includono le strozzature. [Riferimento formula](https://docs.kicad.org/5.1/en/pcb_calculator/pcb_calculator.html).

L2 rimane riferimento GND. L3 ospita distribuzione e fondo GND; USB su strati esterni, senza attraversare interruzioni del piano di ritorno. /BUCK_SW solo TOP, corto e largo, lontano da Kelvin/feedback/antenna. I poligoni GND L2/L3 sono stati aggiornati all'ingombro attuale; il riempimento viene ritagliato da Edge.Cuts e dal keepout antenna. La prova di riempimento non introduce nuove violazioni fisiche. Le zone consegnate restano da riempire durante lo sbroglio.

USB 0,18 mm / gap 0,15 mm è un preset preliminare: l'impedenza differenziale 90 Ω deve essere calcolata sullo stackup effettivo. Non assegnare una corrente garantita ai vias senza conoscere metallizzazione e geometria; distribuire le transizioni di potenza su più vias e verificarle nel layout finale. [Regole KiCad 10](https://docs.kicad.org/10.0/en/pcbnew/pcbnew.html).

## Controllo logico: vincoli e punti aperti

1. **LED a 3,3 V:** la variante SK6812MINI-E C5149201 già documentata in LOCAL-DECOUPLING.md richiede 3,7–5,5 V. Resta la scelta preesistente dell'utente, basata anche su prove informali. Il funzionamento a VCORE non è garantito. Per una soluzione entro specifica servono una variante compatibile oppure alimentazione/traslazione di livello adeguate. Non cambiata in questa revisione.
2. **Margine del buck:** TPS562201 richiede VIN almeno 4,5 V. USB → D6 Schottky → 5V può scendere sotto tale valore per cadute su cavo, contatti e diodo. Verificare VIN sotto carico e dissipazione di D6 prima di promettere 2 A. D6 è un simbolo personalizzato: pin 1 anodo, pin 2 catodo; il verso verificato è corretto. Feedback 33 kΩ / 10 kΩ: uscita nominale circa 3,302 V. [TI TPS562201](https://www.ti.com/lit/ds/symlink/tps562201.pdf).
3. **Nessuna protezione individuale di porta:** non attivare contemporaneamente N_GATE alto e P_GATE basso. Disabilitare il driver prima di cambiare configurazione e aprire il bus switch verso ESP quando si applica potenza o uno stimolo esterno. Non fare affidamento sulla sola sequenza software come protezione da cortocircuito. Il limite assoluto 128 mA del SN74CBTLV3125 non è una corrente di potenza utilizzabile. [TI bus switch](https://www.ti.com/lit/ds/symlink/sn74cbtlv3125.pdf).
4. **Arbitraggio alimentazioni:** non alimentare VCORE dall'esterno con il buck attivo; sorgenti 5V multiple richiedono un circuito di selezione/ORing e limitazione appropriato. Un modulo USB-C PD deve consegnare 5V regolati alla rail 5V, mai 9/12/20 V. Le resistenze CC presenti non costituiscono un controllore PD né una verifica della corrente disponibile.
5. **TERM_CTRL_IN non implementato fisicamente:** NT1 è escluso dal PCB e privo di footprint. J11.48 non riceve quindi il collegamento a 5V rappresentato dal net tie nello schematico. Va definito prima di usarlo nella mezzanina. L'autoterminazione esistente tramite Q2, TERM_CTRL_OUT e U8 segue un altro percorso e non richiede NT1. Non aggiungere un ponte 5V senza verificare tutti gli ingressi collegati.
6. **Misure e banda:** i dodici SHUNT_SENSE arrivano ai connettori separati dal percorso di carico. Prelevare dalle piazzole dedicate, tenere vicine le coppie e lontane da SW, gate e LED. R117–R122 montate abilitano il driver; aperte isolano il suo nodo drain ma non eliminano capacità di switch, connettori, stub e front-end. Nessuna banda in MHz è qualificata da questa revisione. Il campionatore/INA è sulla mezzanina; la Backbone contribuisce comunque a rumore, resistenza e capacità parassite.
7. **Compatibilità ESP:** GPIO35–37 non sono spare universali: dipendono dalla variante ESP32-S3 e dall'uso della memoria Octal. R112–R114 vanno configurate per il modulo reale. Preservare i livelli di boot sui pin di strapping. GPIO43/44 utilizzati per SPI non possono contemporaneamente servire la console UART0. [Espressif](https://documentation.espressif.com/esp-hardware-design-guidelines/en/latest/esp32s3/index.html).
8. **Contatti magnetici:** rating non qualificato. J2 ha due contatti 5V, J9 ha un solo contatto 5V e un TERM: non attribuire a entrambi la stessa portata. La chiave meccanica contro inversione resta necessaria.

Per le altre reti: I²C con pull-up 4,7 kΩ assorbe circa 0,70 mA per linea bassa; considerare i pull-up della mezzanina in parallelo. Il partitore VBUS 100 kΩ + 100 kΩ presenta 50 kΩ equivalenti al campionatore: verificare acquisizione/settling. Le linee gate hanno correnti impulsive oltre a quelle statiche. La terminazione CAN 120 Ω richiede verifica di dissipazione nella condizione differenziale peggiore; 100 mW non offre un margine ampio a 3,3 V differenziali.

## Distinta e verifiche

Corretti dati di acquisto incoerenti, senza cambiare valori o footprint: R4 470 kΩ → C23178, R8 120 Ω → C22787, C1 100 nF 0603 → C14663, R15/R16 10 kΩ → C25804. Identità confrontate sulle schede [R4](https://www.lcsc.com/product-detail/C23178.html), [R8](https://www.lcsc.com/product-detail/C22787.html), [C1](https://www.lcsc.com/product-detail/C14663.html), [R15/R16](https://www.lcsc.com/product-detail/C25804.html). Rigenerare la distinta di produzione dal CAD aggiornato: gli export storici non sono automaticamente aggiornati.

Verifiche: connettività schematica invariata; tutti i footprint, pad, posizioni e blocchi conservati. Verificati sei ponti driver e sei coppie Kelvin. Sei piste volutamente errate in una copia di prova hanno attivato le sei regole attese, confermando l'effettiva applicazione delle classi. Nessuna pista di prova consegnata.

ERC: **0 errori, 143 avvisi**. DRC: **155 violazioni fisiche preesistenti**, **69 segnalazioni di parità**, **462 collegamenti da instradare**. Le firme delle violazioni fisiche e di parità coincidono con la baseline precedente: nessuna nuova violazione, ma quelle vecchie restano da risolvere. In particolare: 40 annular ring FlexyPin, 21 distanze rame/bordo presso i magnetici, 11 differenze footprint/libreria e due sovrapposizioni courtyard delle coppie di header J17/J20 e J18/J19, oltre alla serigrafia. Il riempimento di prova lascia 457 collegamenti da instradare, senza nuove violazioni fisiche. Non ignorare queste segnalazioni per ottenere un falso via libera produttivo.

Evidenze: [verification.json](bom/pre-routing-review-20261104/verification.json), [ERC](bom/pre-routing-review-20261104/erc.json), [DRC](bom/pre-routing-review-20261104/drc.json). Restano da verificare ingombri e accoppiamento meccanico con la mezzanina reale. Nessuna qualifica termica, EMC, banda o misura sul prototipo è stata eseguita.
