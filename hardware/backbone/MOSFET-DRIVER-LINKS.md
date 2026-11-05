# Backbone — link rimovibili dei driver MOSFET

Decisione dell'utente: 4 novembre 2026. Implementazione locale in schematico e PCB; nessuna qualifica di banda, nessun commit/push eseguito in questa sessione.

## Scopo e circuito
Gli AO6604 Q3–Q8 restano capacitivamente collegati al segnale anche quando i gate comandano OFF. Aprire il collegamento verso ESP non rimuove quel ramo. Aggiunte sei resistenze 0 Ω rimovibili nel solo ramo driver, comuni a entrambi i drain. Non sono in serie al percorso sensore–shunt e non sono gli shunt R56–R61.

```text
ESP A_i -- switch -- N_Ai -- shunt 0.1R -- PORT_Ai -- sensore
                      |
                     0R R117+i
                      |
                 PWR_DRV_Ai -- drain N + drain P di Q3+i
```

I nodi PWR_DRV sono locali allo schema (prefisso `/` nella netlist). Il pad 1 del link va ai drain, il pad 2 a N_A. Connettori J10/J11, A_i, N_Ai, PORT_Ai e dodici SHUNT_SENSE restano invariati. L'INA226 appartiene al modulo mezzanina di esempio, non alla Backbone. Nessuna modifica alla mezzanina in questa revisione.

| Porta/nodo | Link | Driver | Shunt | Centro PCB X,Y mm |
|---|---|---|---|---|
| N_A0 | R117 | Q3 | R56 | 150.50, 86.75 |
| N_A1 | R118 | Q4 | R57 | 149.25, 76.75 |
| N_A2 | R119 | Q5 | R58 | 186.00, 84.75 |
| N_A3 | R120 | Q6 | R59 | 180.75, 130.65 |
| N_A4 | R121 | Q7 | R60 | 185.00, 112.00 |
| N_A5 | R122 | Q8 | R61 | 160.75, 108.75 |

Componenti tutti sul top, montati di default: YAGEO RC0603JR-070RL, 0603, 0 Ω, LCSC C95177. [Scheda del produttore](https://www.yageogroup.com/component-documentation/download/specsheet/RC0603JR-070RL). Non attribuire a una 0 Ω corrente illimitata: verificare la specifica jumper e il derating della distinta finale; questo intervento non aumenta la corrente ammessa dalla porta o dallo shunt.

## Uso e serigrafia
- Link montato: comportamento driver originale; gate e ownership devono evitare contesa e conduzione simultanea N/P.
- Link rimosso/non montato: entrambi i drain sono separati dal nodo di segnale. Il driver di potenza di quella porta non può più applicare VCORE/GND. Le linee di misura e il percorso shunt rimangono disponibili; una mezzanina può applicare stimoli tramite il proprio front-end entro i limiti elettrici.
- La selezione è manuale, a scheda disalimentata. Non è una funzione firmware, un relè o un isolamento galvanico.
- Serigrafia sul top: `R117-122 OPEN = DRV OFF`. La tabella identifica i sei link; i riferimenti sono anche nel CAD e sul layer Fab. Non si promette una modalità HF qualificata.

## Vincoli per lo sbroglio e limiti
1. Portare il percorso principale N_A fino al pad 2 del link, mantenendo minima la derivazione che resta sul segnale quando la 0 Ω è assente. Il ramo lungo verso i MOSFET deve stare dal lato pad 1. Non creare una lunga T morta dal segnale al link.
2. Le posizioni esistenti sono conservate. Alcuni link, soprattutto R120/R121, non sono immediatamente adiacenti agli shunt: verificare la lunghezza effettiva del percorso durante lo sbroglio. La disposizione non dimostra una banda particolare.
3. SHUNT_SENSE_H/L devono partire dalle rispettive prese Kelvin, viaggiare accoppiate e lontano da buck, gate e correnti commutate. Non far passare corrente di carico nelle prese sense.
4. Per una misura a minimo carico, aprire anche il bus switch verso ESP e mettere gli altri driver in alta impedenza. Restano capacità di switch, connettori, piste, protezioni e ingresso della mezzanina.
5. Rimuovere i link non rende la porta 5 V tolerant e non aumenta i limiti di tensione/corrente dei componenti rimasti. La banda utile dipende anche da impedenza sorgente, cablaggio, ADC/amplificatore e accuratezza richiesta. Nessuna frequenza massima è certificata.
6. Sulla mezzanina FPGA gestisce segnali digitali; per analogico servono ADC/DAC e front-end. I link non aggiungono questi componenti.

Riferimenti tecnici: [AO6604](https://www.aosmd.com/res/datasheets/AO6604.pdf), [SN74CBTLV3125](https://www.ti.com/lit/ds/symlink/sn74cbtlv3125.pdf). Alternativa discussa ma non implementata: relè a bassa capacità, per evitare costo e ingombro aggiuntivi in questa revisione.

## Verifiche
Confronto automatico delle netlist: cambiano soltanto 12 pin drain esistenti e si aggiungono 12 pin dei link. Tutti gli altri nodi, i 120 contatti mezzanina e le prese Kelvin sono invariati. Tutti i footprint preesistenti conservano posizione, rotazione e layer; i sei nuovi componenti sono sul top.

ERC: 0 errori, 143 avvisi (come prima). DRC: stessi 155 rilievi fisici e 69 rilievi di parità schema/PCB, confrontati per tipo e oggetti; nessuno aggiunto. Connessioni da sbrogliare: 456 → 462. Zero piste e zero via. Esaminati anche gli export grafici di schema e PCB. I rilievi preesistenti e lo sbroglio sono ancora aperti: non è un rilascio per produzione.

Rapporti: `bom/mosfet-links-20261104/verification.json`, `erc.json`, `drc.json`. Vedere anche [interfaccia mezzanina V3](MEZZANINE-INTERFACE-V3.md).


## Precisazione del controllo del 4 novembre 2026

Il componente montato AO6604 è TECH PUBLIC C5182068. I dati del datasheet AOS citati come riferimento non qualificano la variante acquistata. Rimuovere il ponte isola il driver, ma non garantisce una banda numerica della Backbone. Budget, limiti e prove sono riportati in [PRE-ROUTING-REVIEW.md](PRE-ROUTING-REVIEW.md).
