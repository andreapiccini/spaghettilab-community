# Pulizia del circuito

Funzioni confermate mantenute: ESP32/FlexyPin, USB, alimentazione, Qwiic, ringRGB, selezioneVCC3V3/GND/GPIO/Hi-Z, CAN e terminazione automatica.

- Eliminato U55 e il suo C243: quattro canali superflui; ridistribuite le16righe su U50/U51/U53/U54, quattro canali ciascuno.
- Eliminati16ponti0Ω e unificate le rispettive net di potenza delle righe; resta da realizzare il rame.
- Conservati16doppiMOSFET e48resistori di polarizzazione per mantenere MOSFET spenti e isolamento aperto all'avvio.
- Conservati3FCA9539Q:48uscite per16righe×3controlli. Nessun expander in eccedenza.
- Conservati U60/U61 e componenti del reset: interblocco all'avvio.
- Conservati32RGB,32bypass, adattatore di livello dati e relativo circuito di alimentazione.
- Conservati regolatore, passiviUSB, pull-upI2C, transceiverCAN e rilevamento/terminazione automatica; necessari alle funzioni confermate.

Totale221footprint,18in meno. Reset/POR, corrente, otticaFR4 e montaggio da provare fisicamente. Non sbrogliato.
