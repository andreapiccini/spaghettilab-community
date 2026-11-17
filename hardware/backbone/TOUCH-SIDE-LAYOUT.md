> Revisione corrente: SLOT-A-B-LAYOUT.md. Le descrizioni seguenti riguardano revisioni precedenti.

> Disposizione corrente: un touch sopra e uno sotto ogni connettore, su entrambi i lati. TE1 (+) e TE3 (PLAY/STOP) a y90,50; TE2 (MODE) e TE4 (LOAD/SAVE) a y108,75. Spostati insieme LED e finestre. Femmine sul Top invariate. Coordinate correnti in touch-side-placement.json. R4/R129 ricollocati sul fronte. DRC invariato a 121.

# Touch laterali e femmine sul Top

J24/J25 sono ora montati sul fronte F.Cu, sulle stesse coordinate e sugli stessi fori: nessuno scambio di pin o variazione dell’interasse 30 mm. Non occupano più il retro.

Touch sul retro: due a sinistra e due a destra appena sopra i connettori. Centri: TE1 (+) x183,25 y83,75; TE2 (MODE) x183,25 y90,50; TE3 (PLAY/STOP) x151,75 y83,75; TE4 (LOAD/SAVE) x151,90 y90,50. Spostati insieme anelli, contorni, icone B.Mask, LED sul fronte e tutte le esclusioni ottiche.

I courtyard dei magnetici frontali seguono ora il corpo e la zona dei terminali originali, con terminali circa 1,5 mm secondo la misura già documentata. I lunghi tratti interni dei pad sono condivisi intenzionalmente con i fori delle femmine e non costituiscono un secondo corpo del magnetico. Le tolleranze del montaggio reale restano da provare.

Ricompattati sul fronte i componenti vicini senza cambiarne connessioni o distinta. Sagoma PCB, ESP32 rimovibile, pinout delle porte, SPI, I2C e terminazione CAN preservati. Corretti gli identificativi CAD univoci dei quattro LED touch; schema e PCB restano coerenti.

Verifiche: netmap dei pad invariata; femmine F.Cu; DRC 121 / 499 elementi non connessi / 20 avvisi di parità, ERC 196 come prima. Verifica su riempimento: 84 centri delle lenti senza rame su tutti e quattro gli strati. Rimangono lo sbroglio e i rilievi preesistenti: non è una scheda pronta alla produzione.
