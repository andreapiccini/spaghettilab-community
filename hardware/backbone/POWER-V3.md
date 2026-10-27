# Backbone V3 — alimentazioni switching 3,3 V

Aggiornato: 2026-10-27. Richiesta utente: sostituire entrambi gli AP2112 3,3 V, inclusa alimentazione LED, con TPS562201 e componenti economici disponibili. Implementazione progettuale; non qualificata sul banco.

## Configurazione attuale: buck unico U4

Su richiesta utente, dopo verifica del margine LDO, U4/TPS562201 alimenta un'unica rete VCORE 3,3 V: ESP32-S3, sei LED, periferiche e ingressi/EN dei due LDO camera. VAUX eliminata come rete attiva. Rimossi U5, L2, C6, C10, C87, C88, C89, R38, R39 da schema e PCB. Nessun parallelo fra uscite di regolatori. La distinta sotto descrive la precedente revisione: restano solo i componenti associati a U4 (U4,L1,C5,C9,C86,C84,C85,R36,R37). Layout del gruppo U4 ancora provvisorio fuori sagoma; piste da completare. La verifica preserva le altre reti e geometrie.

### Margine dei LDO camera

ME6211C28: dropout TIPICO 110 mV a100mA e220mV a200mA, a25C; la tabella non specifica un massimo. Carico previsto2,8V: AVDD+DOVDD, circa34mA tip perOV3660,39mA tip/52mA somma massimi perOV5640 con DVDD esterna, fino55mA somma massimi perOV2640. Non attribuire tutta la corrente camera al ramo2,8V.

ME6211C15: dropout TIPICO200mV a100mA,400mV a200mA; ramo1,5V fino125mA nel casoOV5640 tabellato. Da3,3V ha circa1,8V di margine nominale. Dissipazione a125mA circa0,225W, da verificare termicamente.

Valutazione conservativa statica buck: VFBmin0,749V e partitore33k/10k con1% sfavorevole ->3,172V; uscita LDO2,8V al+1% ->2,828V: margine circa344mV. Confrontato con110mV TIPICI a100mA, resta un margine indicativo234mV prima di cadute sulle piste e transitori. Non e una garanzia worst-case: dropout massimo/temperatura non specificato e risposta dinamica non misurata. Conclusione progettuale favorevole a mantenere entrambi gli LDO sui3,3V per le camere considerate; obbligatoria qualifica su banco con WiFi/LED/camera simultanei. Non estendere a carichi arbitrari da200-450mA sul2,8V.

Fonte verificata (colonne tabella viste sulPDF): [MicroOne ME6211 V24, pagine7 e9](https://xonstorage.z8.web.core.windows.net/pdf/microone_me6211c33u4agn_sup12manufacturernocatlinknew.pdf). Budget complessivo2A condiviso; LED3,3V ancora da qualificare. Nessuna modificaUSB/ADC/controllerCC.

## Revisione precedente: due buck (superata)

U4 genera VCORE; U5 genera VAUX. Ingressi e EN collegati alla rete 5V esistente, uscite separate e mai in parallelo. I regolatori camera U9/U10 restano invariati. La corrente nominale del singolo convertitore è 2 A, NON una garanzia di 4 A complessivi dalla scheda: ingresso, sorgente, connettori, piste e dissipazione devono supportare il carico.

Per ciascun convertitore: induttore 3,3 uH; partitore 33k/10k 1% (3,3024 V nominali); 22 uF/25 V X5R in ingresso + 100 nF/50 V X7R; due 22 uF/25 V X5R in uscita; bootstrap 100 nF tra VBST e SW. EN sempre attivo con ingresso presente, come prima.

| Funzione | Riferimenti | MPN | LCSC | Footprint |
|---|---|---|---|---|
| Buck | U4, U5 | TPS562201DDCR | C90061 | TSOT-23-6 |
| Induttore | L1, L2 | XRTC404012S3R3MBCA | C39846848 | dedicato, circa 4,1 x 4,1 mm |
| Ingresso 22 uF | C5, C6 | CL21A226MAQNNNE | C45783 | 0805 |
| Uscita 2 x 22 uF | C9, C86; C10, C89 | CL21A226MAQNNNE | C45783 | 0805 |
| Bootstrap 100 nF | C84, C87 | CC0603KRX7R9BB104 | C14663 | 0603 |
| Bypass ingresso 100 nF | C85, C88 | CC0603KRX7R9BB104 | C14663 | 0603 |
| Feedback alto 33k 1% | R36, R38 | 0603WAF3302T5E | C4216 | 0603 |
| Feedback basso 10k 1% | R37, R39 | 0603WAF1002T5E | C25804 | 0603 |

La libreria esistente include un CMI322513U3R3KT, non riutilizzato senza una qualifica di corrente da induttore di potenza. Il convertitore e l'induttore selezionati non erano presenti nella libreria. Il vecchio simbolo AP2112 resta disponibile per altri progetti.

Eccezione al riferimento 0603 richiesto: condensatori da 22 uF in 0805 per maggiore margine di capacita effettiva sotto tensione e per limitare il numero di componenti. Non dedurre la capacita effettiva dalla sola tensione nominale: verificare curva DC-bias del lotto/MPN e mantenere il filtro nel campo raccomandato da TI, considerando anche le capacita distribuite. I piccoli passivi sono 0603.

## Dimensionamento e limiti

- Circuito previsto per la linea 5 V. TPS562201 richiede almeno 4,5 V in condizioni operative raccomandate: verificare cadute lungo USB, diodi e distribuzione sotto carico.
- Con 5,25 V, 3,3024 V, L minimo 2,64 uH e 580 kHz nominali: ripple circa 0,80 A picco-picco; a 2 A uscita il picco stimato e circa 2,40 A. Stima, non simulazione ne prova.
- Induttore: datasheet pagina 3 indica Irms 4,0/4,5 A e Isat 5,0/5,5 A nelle colonne Max/Typical; usare i valori inferiori come riferimento prudente. DCR massimo 80 mOhm. Controllare termica reale.
- La linea VAUX rimane 3,3 V. Questo NON qualifica SK6812MINI-E a 3,3 V: vedere LEDS-V3.md. L'utente ha riferito impieghi precedenti, ma questa scheda resta da provare.
- Il buck ha protezioni proprie; non implementa la protezione per-pin o la matrice GPIO/GND/3V3 discussa, ancora da progettare.

## PCB e verifiche

Footprint e reti aggiunti al PCB. Due gruppi di componenti sono collocati provvisoriamente fuori sagoma, a destra, per il successivo posizionamento: nessun routing di potenza completato. Il PCB di partenza era senza segmenti. Preservati gli oggetti PCB estranei alla modifica.

Nel layout finale seguire TI: CIN accanto a VIN/GND, bootstrap vicino a VBST/SW, nodo SW piccolo, feedback lontano dall'induttore e dal nodo SW, ritorno del partitore a massa quieta. Non realizzare la potenza con piste sottili generiche. Verificare ripple, transitori Wi-Fi/carichi, avvio simultaneo e temperatura.

Footprint induttore derivato dal disegno XR pagina 3: A=4,10 mm esterno, B=1,10 mm spazio fra pad, C=4,10 mm altezza; pad 1,50 x 4,10 mm con centri +/-1,30 mm. Footprint TSOT da libreria KiCad 10 (CC-BY-SA 4.0 con eccezione librerie KiCad).

## Fonti e disponibilita

Consultate il 2026-10-27. Prezzi indicativi in USD, esclusi spedizione/imposte, soggetti a variazioni; nessun ordine effettuato.

- [TI TPS562201 datasheet](https://www.ti.com/lit/ds/symlink/tps562201.pdf): pinout, applicazione, filtro LC e layout.
- [LCSC C90061](https://www.lcsc.com/product-detail/C90061.html): disponibile nelle pagine consultate; circa $0,05-0,06 per chip da 10 pezzi nelle quotazioni reperite, prezzo da ricontrollare.
- [LCSC C39846848](https://www.lcsc.com/product-detail/C39846848.html?is_substitute=1&original_product_code=C5307598&original_unit_price=0.0925): pagina consultata con 1795 pezzi, $0,1483 promozionale da 5 pezzi (listino $0,1977).
- [Datasheet XR](https://datasheet.lcsc.com/datasheet/pdf/f37680829ba0323460d0389c7c08da9a.pdf): disegno e specifiche verificati sul PDF.
- [LCSC C45783](https://www.lcsc.com/product-detail/C45783.html): pagina indicizzata disponibile, circa $0,0244 da 10; disponibilita da ricontrollare all'ordine.
- [LCSC C4216](https://www.lcsc.com/product-detail/C4216.html), [C25804](https://www.lcsc.com/product-detail/C25804.html), [C14663](https://www.lcsc.com/product-detail/C14663.html): passivi comuni.

Stima indicativa della distinta di ciascun alimentatore: circa $0,30-0,40 ai prezzi reperiti, prima di costi di ordine e assemblaggio.

### Esito controlli KiCad 10.0.3

Netlist: verificati tutti i pin dei due circuiti; nessun cambiamento alle reti degli altri componenti. PCB: reti pad conformi allo schema, oggetti estranei preservati. ERC: 13 errori su oggetti originali invariati; warning 129 -> 98. DRC complessivo: 145 violazioni e 150 connessioni mancanti, PCB non pronto produzione; nessuna violazione geometrica nei nuovi gruppi provvisori. Nessuna simulazione o misura fisica.

### Controlli dopo unificazione
Netlist finale conforme alla sola fusione VAUX->VCORE e rimozione del secondo buck. Eliminato #FLG0105 duplicato sulla rete comune. ERC finale13errori preesistenti/97warning; DRC145violazioni/132connessioni mancanti, PCB ancora non sbrogliato.
