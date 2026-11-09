# Percorso riga a 500 mA — revisione 8 novembre 2026

Esito: la scelta dei MOSFET è compatibile con un obiettivo di 500 mA continuativi su una singola riga configurata come 3V3 o GND. La portata del PCB assemblato non è ancora validata: il file non contiene piste né piani. Questa analisi non attribuisce500mA alla modalitàGPIO/ADC e non abilita tensioni esterne superiori a quelle ammesse. AggiuntoU63 come limitatore condiviso del solo ramo3V3 delle righe:1A nominale, non limitazione individuale500mA.

## Percorso elettrico verificato

Alimentazione: ingresso 5V dai magnetici J2/J9 (oppure USB VBUS tramite D6 SS54) → U4 SY8089AAAC → L1 3,3 µH → rete3V3 → U63SY6280AAAC → rete3V3_ROWS → source pin2 del P-MOSFET AO3401A → drain pin3 → ROW_Lxx/ROW_Rxx → uno dei tre contatti Hanxia della riga. Ritorno: altra riga configurata GND → drain pin3 AO3400A → source pin2 → GND. Le tre prese della stessa riga sono in parallelo, non tre uscite indipendenti da500mA. Tabella completa in row-power-map.csv.

In VCC: PG=0, NG=0, ISO_N=1. In GND: PG=1, NG=1, ISO_N=1. Il percorso di potenza non attraversa il Nexperia74CBTLV3125 né l'ESP32. Il percorso GPIO/ADC resta disconnesso durante alimentazione e ritorno di potenza. Prima di cambiare modalità aprire lo switch analogico, spegnere i MOSFET, attendere lo spegnimento reale e solo dopo attivare il nuovo ramo. PG=0/NG=1 cortocircuiterebbe le rail ed è vietato.

## MOSFET e cadute

Dati massimi RDS(on) a25°C e |VGS|=2,5V, scelta conservativa rispetto al comando nominale3,3V; non usare le correnti assolute di copertina come portata della scheda.

| Ramo | Componente | RDS(on) max | Corrente | Caduta | Dissipazione |
|---|---|---:|---:|---:|---:|
| 3V3 | AO3401A, C15127 | 85mΩ | 0,5A | 42,5mV | 21,25mW |
| GND | AO3400A, C20917 | 48mΩ | 0,5A | 24mV | 12mW |
| Coppia alimentazione/ritorno | P+N | 133mΩ | 0,5A | 66,5mV | 33,25mW |

Il carico tra due righe vede circa3,2335V considerando soltanto i MOSFET a25°C, prima di piste, contatti e tolleranza del regolatore. Raddoppiando prudenzialmente la resistenza per uno scenario caldo, la coppia perde133mV e dissipa66,5mW. È un margine di calcolo, non una garanzia termica né una previsione di temperatura. Il rame effettivo e il riscaldamento dei componenti vicini vanno misurati sul prototipo.

AO3401A source3V3_ROWS, gate pull-up100k sulla stessa rail protetta; AO3400A sourceGND, gate pull-down100k. I dispositivi rimangono spenti quando gli expander sono in reset e ad alta impedenza. I pull-up OE tengono aperti gli switch GPIO. Conservati reset U60 e tutti i48comandi. Sono invariati i limiti già documentati in FCA9539-reset-review.md: POR, brownout e comportamento del firmware devono essere qualificati sul prototipo. Nessuna nuova resistenza o protezione aggiunta.

## Alimentazione e contatti

- U4 SY8089AAAC: nominalmente2A complessivi, non2A per riga. Il budget include ESP32, CAN e altri carichi3V3. Con500mA alla riga occorre riservare il resto ai consumi reali della scheda. La scheda produttore identifica il vecchio SY8089AAAC come SY20149AAAC; mantenuto il componente esistente, nessuna sostituzione implicita.
- L1 XRTC404012S3R3MBCA: catalogo LCSC riporta4,5A nominali,5A di saturazione e67mΩ. Non è il collo di bottiglia per500mA singoli. Questi valori di catalogo sono da ricontrollare sul datasheet della fornitura prima della produzione; il download del PDF esatto non è riuscito durante questa verifica.
- Socket Hanxia HX PM2.54-1x8P TP-YQ C42380985: catalogo riporta3A per contatto, sufficiente come selezione nominale per500mA. Restano resistenza del contatto, qualità del pin inserito e saldatura da verificare sul campione. Non estendere questa valutazione ai socket generici della mezzanina J26/J27, la cui coppia commerciale è ancora da scegliere.
- Magnetico J2 PR5L4015-5P-C-F C41361292: catalogo riporta2A; la portata della coppia e il ritornoGND condiviso vanno rispettati. La corrente5V è condivisa anche con LED ed eventuali moduli. Non interpretare2A come corrente disponibile su ogni riga.
- Ingresso USB: la possibilità di erogare500mA al carico oltre ai consumi della scheda dipende dall'alimentatore/porta e dal cavo. I soli resistori CC non rendono disponibile qualunque corrente; il firmware attuale non implementa una gestione del budget USB. Per qualificare il funzionamento a500mA usare un'alimentazione5V esterna regolata adeguata, con budget per ESP32/RGB/CAN e la riga.
- Non aggiunta limitazione per riga: un corto, lo spunto di un modulo o l'accensione contemporanea dei due MOSFET possono superare500mA. Il valore500mA è la corrente del carico prevista, non una soglia di intervento.

## Prescrizioni per lo sbroglio

Classe PORT_IO_POWER impostata a0,80mm preferiti, via0,80mm/foro0,40mm. Regola minima0,25mm per brevi escape dalle piazzole; i rami che portano500mA devono allargarsi subito. Usare rame esterno nominale35µm almeno0,80mm lungo il percorso di potenza; feeder3V3 preferito1,20mm e pianoGND continuo. Evitare colli di bottiglia, lunghi neck-down e thermal-relief sottili. Via di potenza almeno0,4mm finito con metallizzazione da confermare al fabbricante; preferire due vie in parallelo dove lo spazio lo consente. Le specifiche della via non sono una portata già qualificata.

Controllo resistivo: con resistività rame1,724e−8Ωm a20°C,35µm e larghezza0,8mm, una pista da50mm ha circa30,8mΩ:15,4mV e7,7mW a500mA. Due percorsi da50mm aggiungono circa30,8mV di caduta; insieme ai due MOSFET circa97,3mV a25°C, prima dei contatti e della rail condivisa. È un esempio dimensionale, non una misura di piste esistenti. La portata termica e i picchi richiedono controllo dello stackup e prova.

## Chiusura necessaria prima di dichiarare 500 mA garantiti

Completare lo sbroglio di alimentazione e righe, estrarre resistenze/lunghezze reali e verificare strozzature/vie. Sul prototipo caricare una riga3V3 verso una rigaGND a500mA, misurare tensioni ai contatti e temperatura a regime alla temperatura ambiente massima prevista, con ESP32 e LED nelle condizioni di consumo peggiori. Ripetere sul percorso più lungo e con spunto dei moduli previsti, poi verificare transizioni, reset e brownout. Criteri e limite termico del prodotto da fissare prima della produzione. Non dichiarare questa verifica già eseguita.

Fonti consultate:
- https://www.aosmd.com/res/data_sheets/AO3400A.pdf — RDS(on) a2,5V e pinout, copia in references.
- https://www.aosmd.com/res/data_sheets/AO3401A.pdf — RDS(on) a−2,5V e pinout, copia in references.
- https://www.silergy.com/productsview/SY20149AAAC — SY8089AAAC,2A continui.
- https://www.lcsc.com/product-detail/C39846848.html — catalogo induttore.
- https://www.lcsc.com/product-detail/C42380985.html — catalogo socket3A; disegno meccanico associato.
- https://www.lcsc.com/product-detail/C41361292.html — catalogo magnetico2A; disegno meccanico associato.

Aggiornamento8novembre2026: adottatiNexperia74CBTLV3125PW,118 bidirezionaliTSSOP14, conOEalto eIOFF. Percorso500mA continua ad attraversare solo i MOSFET, non gli switchGPIO.16RGB Xinglight consumano tipicamente245,6mA complessivi a5V al bianco massimo; includere il consumo nel budget di ingresso condiviso.

## Aggiornamento: limitatore comuneU63

U63 divide3V3 logica da3V3_ROWS alimentazione righe. R3006,8k imposta1A nominale; min/max0,75..1,25A nelle condizioni datasheet5V/25°C, da verificare a3,3V e sulla temperatura reale. R301100k mantieneENbasso a riposo, ENconnessoEXP_RESET_N: avvio/abilitazione condivisi colreset degli expander. C300/C30110µF localmente suIN/OUT. I16sourceP e i4arrayPG RN1..RN4 sono gli unici carichi originali spostati sulla rail protetta; nessunGPIO oGND modificato.

La protezione comune limita i corti alimentati dalle righe3V3; non protegge GPIO, rail dirette dei connettori o5V esterni. Nessuna protezione per-riga e nessunFAULT disponibile. Corto persistente: arresto termico delchip e riprova. VersioneA senza scarica attiva. Non dichiarare un500mA garantito o la tenuta al corto già collaudati. Caduta preliminare aggiuntiva a500mA31,5mV e15,75mW con63mΩtipici; valore reale a3,3V/temperatura da misurare.

La sequenza di prova deve includere il passanteP in regime di caduta della rail durante il corto, entrambi i MOSFET delle righe coinvolte, spunto dei moduli, riprova termica e transitori a monte versoESP32. Le piste non sono presenti; rispettare layout e rame richiesti dal produttore prima di finalizzare una portata.
