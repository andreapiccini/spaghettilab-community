# Backbone senza mezzanina, 8+8

J17 e J20 condividono otto linee superiori. J18 e J19 condividono otto
linee inferiori. In ogni coppia il contatto n del primo connettore è
cablato al contatto n del secondo. Ogni linea ha uno switch di isolamento
per il GPIO, un ramo a 3,3 V e un ramo a GND. Disattivando tutti e tre si
ottiene l'alta impedenza.

| Contatto in ciascuna coppia | GPIO superiore | GPIO inferiore |
| --- | --- | --- |
| 1 | 6 | 7 |
| 2 | 12 | 8 |
| 3 | 13 | 9 |
| 4 | 21 | 10 |
| 5 | 39 | 1 |
| 6 | 40 | 2 |
| 7 | 41 | 16 |
| 8 | 42 | 38 |

I quattro connettori Hanxia 1x8 hanno un passo di 2,54 mm. La distanza
tra le file della singola coppia è di 6,85 mm. Le due file centrali
(J20 e J18) distano 7,62 mm da centro a centro, compatibili con la
geometria di un DIP stretto a 16 pin. L'innesto nei contatti va verificato con
un componente reale. I sei indicatori esistenti corrispondono alle
prime sei linee inferiori. I sei shunt sono stati sostituiti da connessioni
dirette. Lo schema conserva i 16 AO6604 e i quattro switch quad.

## Connettori utente

- J4 Qwiic usa GPIO4 per SDA e GPIO5 per SCL, con pull-up propri.
- J21 SPI a 3,3 V. Pin 1 GND, 2 VCORE, 3 SCLK (GPIO14), 4 MOSI
  (GPIO43), 5 MISO (GPIO44), 6 CS (GPIO11). R442 tiene CS alto all'avvio.
  GPIO43 può trasmettere i messaggi di boot UART0. La velocità SPI
  va verificata con il modulo e il cavo effettivi.

## Controllo interno

Il bus interno usa GPIO47 (SDA) e GPIO48 (SCL) con pull-up separati.
Comanda U25, U73, U74 e il driver degli indicatori U70.
U25, U73 e U74 sono TCA9535RTWR in WQFN da 4 × 4 mm.
Il pinout assume un ESP32-S3-WROOM-1 N8R8 e GPIO47/48 a 3,3 V.

| Linee | Controllo MOSFET | Controllo isolamento |
| --- | --- | --- |
| Superiori 1–6 | U73, P00–P07 e P10–P13, coppie P/N | U74, P12–P17 |
| Superiori 7–8 | U73, P14–P17, coppie P/N | U74, P04 e P05 |
| Inferiori 1–4 | U25, P00–P07, coppie P/N | U25, P14–P17 |
| Inferiori 5–6 | U25, P10–P13, coppie P/N | U74, P10 e P11 |
| Inferiori 7–8 | U74, P00–P03, coppie P/N | U74, P06 e P07 |

U73 è a 0x22, U74 a 0x23. Le resistenze lasciano i tre comandi in stato
passivo all'accensione. RN1–RN12 contengono ciascuna quattro resistenze
isolate da 100 kΩ. Nel firmware, aprire l'isolamento e spegnere
entrambi i MOSFET prima di commutare modalità. Inizializzare i registri
di uscita degli expander in stato sicuro prima di impostarne la direzione.

Il PCB è uno studio di piazzamento con tutti gli SMD sul top. Il socket
FlexyPin passante e l’orientamento del modulo ESP32 restano quelli originali.
Restano lo sbroglio, il firmware e il collaudo meccanico ed elettrico.
