> Montaggio corrente: J24/J25 sul Top (fronte), stessi fori e stesso pinout 5V/CAN_H/CAN_L/GND. La descrizione storica di montaggio sul retro è superata.

# Espansione CAN sotto scheda

J24 e J25: due femmine Kinghelm KH-2.54FH-1X4P-H8.5, LCSC C2905415, passo 2,54 mm, altezza corpo 8,5 mm. Distanza tra gli assi 30,00 mm. Pin 1 a y=104,33; i pin successivi risalgono verso ESP32. Pin 1=5V, 2=CAN_H, 3=CAN_L, 4=GND. Fori metallizzati 1,02 mm; piazzole 1,70 mm.

Le piazzole magnetiche 1–4 sono estese verso l’interno e condividono direttamente il rame con i quattro fori delle femmine. Nuovo ordine su J2/J9: 1=5V, 2=CAN_H, 3=CAN_L, 4=GND, 5=TERM_CTRL_IN/OUT. Rimosse le piste separate del GND. Le schede con il precedente ordine dei magnetici non sono compatibili: aggiornare anche i moduli collegati. Nessuna modifica a terminazione, Hi-Z, SPI o I2C. La corrente disponibile dipende dall’alimentazione e dal percorso 5V esistente; la nuova femmina non aumenta i limiti della scheda.

Modelli 3D locali semplificati dimensionali, non CAD certificato del produttore. Il retro è ora occupato dalle due femmine: non montare contemporaneamente magnetici sul retro. Le impronte magnetiche mantengono il courtyard del montaggio frontale.

Finestre VCC/GND/MCU/X: quattro righe per banco a passo 1,90 mm; dimensione simboli mantenuta. File connettori traslate di 0,60 mm, gap centrale DIP 7,62 mm invariato. Logo completo ridotto a 9,60 mm, 16 LED ordinati 4×4 a 45°. Nessun aumento dell’ingombro PCB. La diffusione e l’eventuale contaminazione luminosa richiedono una prova sul prototipo.

Verifiche: pinmap preesistente invariata; entrambi i nuovi header presenti nella netlist. DRC 121, 499 elementi non connessi, 20 avvisi di parità e ERC 196 come prima della modifica. Il progetto richiede ancora sbroglio e risoluzione delle segnalazioni preesistenti prima della produzione.
