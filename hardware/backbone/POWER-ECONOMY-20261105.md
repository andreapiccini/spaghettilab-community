# Backbone: componenti economici applicati — 2026-11-05

Questa revisione sostituisce la precedente configurazione AP63203 del 4 novembre. Le stime AP63200/SY8089 precedenti erano preventivi; ora schematico e PCB usano SY8089AAAC (C78988).

- U4: SY8089AAAC, SOT-23-5 standard, simbolo e pinout aggiornati: 1 EN=5V, 2 GND, 3 LX=BUCK_SW, 4 IN=5V, 5 FB=BUCK_FB.
- R36: 150k 1%, C22807; R37: 33.2k 1%, C23003, ora popolata. Uscita nominale 0.6*(1+150/33.2)=3.31084V. Combinando riferimento +/-2% e resistenze +/-1%, circa 3.192-3.433V prima degli altri errori.
- C84: riutilizzato come 22pF C0G 50V, C1653, in parallelo a R36. Il regolatore non richiede bootstrap; rimossi collegamenti e net BUCK_BOOT.
- 17 condensatori da 100nF: Samsung CL10B104KB8NNNC, C1591, 50V X7R +/-10%, 0603. Inclusi C88/C89 prima senza codice e C74 gia Samsung. Vedere elenco CSV.
- L1 3.3uH e condensatori da 22uF conservati. Ripple induttore nominale circa 0.34A a 5V/3.31V/1MHz; circa 0.43A con L -20%, frequenza nominale. Non e una verifica della saturazione in corto.
- J1, J3, J140 Harwin esterni rimossi dal PCB; simboli di interfaccia conservati, esclusi da PCB e BOM, senza footprint, per evitare reintroduzione durante aggiornamento.
- Riposizionati solo U4, R36, C84, C85 nell'area alimentazione; componenti sul top. ESP32, CAN, mezzanine, shunt e circuiti di misura conservati.

## Alimentazione e sbroglio

Ingresso ammesso dal SY8089: 2.7-5.5V; questo NON significa uscita 3.3V regolata con ingresso 2.7V. Il funzionamento al 100% duty riduce il margine richiesto rispetto al precedente AP63203 (minimo 3.8V), ma restano cadute su D6, MOSFET interno e induttore. D6 SS54 resta per impedire ritorno verso USB. Non applicare tensioni USB-PD superiori a 5V alla rail 5V.

I 2A sono la classe del regolatore e l'inviluppo di progetto delle piste VCORE, NON una corrente continua gia qualificata su questa scheda. Resta necessaria verifica termica, transitori ESP32 e capacita effettiva dei MLCC. Dati termici datasheet: 170 C/W nelle condizioni dichiarate; rame e vie termiche sono determinanti.

Durante sbroglio: collegare C85 e C5 direttamente a IN/GND con loop corto e largo; nodo LX-L1 sul top, corto, lontano da FB e Kelvin; prelevare feedback dopo L1 presso i condensatori di uscita e riportare R37 alla massa quieta. Il partitore assorbe circa 18.1uA. C84 va accanto a R36. Regole locali delle piazzole U4 rigenerate per il nuovo pinout.

Questa modifica non aggiunge limitazione individuale delle porte o interblocco hardware ai MOSFET. Le osservazioni precedenti su LED e protezioni rimangono separate.

## Verifiche

ERC: 0 errori, 143 avvisi come baseline. DRC: 155 violazioni fisiche preesistenti, nessuna nuova; 69 segnalazioni di parita preesistenti; 426 collegamenti da sbrogliare. Confrontati tutti i pad con la netlist; solo U4/C84 cambiano connettivita. Nessuna pista/via esistente. Questo non e un rilascio per produzione.

## Fonti

- [Silergy SY8089/SY8089A, datasheet](https://datasheet.lcsc.com/datasheet/pdf/400ca014d7a690f5be0127468f87fcc6.pdf?productCode=C78988)
- [Samsung 100nF C1591](https://www.lcsc.com/product-detail/C1591.html)
- [Samsung 22pF C1653](https://www.lcsc.com/product-detail/C1653.html)
- [R36 C22807](https://www.lcsc.com/product-detail/C22807.html), [R37 C23003](https://www.lcsc.com/product-detail/C23003.html)

I vecchi preventivi non sono una distinta aggiornata per acquisto: per U4/R36/R37/C84 usare i codici di questa revisione. Nessun ordine o commit/push eseguito.
