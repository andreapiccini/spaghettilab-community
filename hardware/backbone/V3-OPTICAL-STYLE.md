# Stile ottico originale Backbone V3

Le sagome dei simboli VCC, GND, MCU e X sono copiate direttamente dalle grafiche B.Mask di hardware/backbone-v3/backbone-v3.kicad_pcb nel checkout V3. Conservati geometria, spessori e inclinazione originali a 45 gradi; ripetute nelle quattro righe superiori e nelle quattro inferiori. Il logo precedente non cambia.

I quattro simboli touch +, MODE (frecce), PLAY/STOP e LOAD/SAVE sono copiati dalla stessa V3 e sono aperture B.Mask, non serigrafia. La serigrafia rimane soltanto il contorno del tasto. Copiata e scalata uniformemente a diametro 5 mm l’impronta anulare della V3, con rame coperto dalla maschera e centro libero per l’ottica. Sensibilità e diffusione della luce devono essere verificate su prototipo.

Aggiunti D800/D801/D802/D803: quattro LED bianchi come quelli del logo, sul fronte. Collegati alla matrice CB del driver già esistente: catodo CB3 per tutti; anodi CB1, CB2, CB4, CB5 rispettivamente per +, MODE, PLAY/STOP e LOAD/SAVE. Il firmware dovrà gestire questi quattro canali; nessun GPIO nuovo richiesto. Posizioni esatte in touch-led-placement.json. Le lenti possono essere leggermente decentrate rispetto al simbolo per evitare i componenti vicini.

Per far entrare i LED sono stati riposizionati D7, RN6, RN11, R123, R126 e R5; ingombro PCB e ESP32 rimovibile conservati. Tutti i componenti montati aggiunti sono sul fronte.

Modelli delle resistenze singole e delle 12 reti resistive resi autonomi in PassiveModels.3dshapes, da libreria KiCad ufficiale installata: 0603, 0402 e array 4x0402. Nessuna sostituzione dei componenti elettrici. Modelli KiCad sotto licenza della libreria ufficiale, CC-BY-SA 4.0 con eccezione; commenti di provenienza presenti nei STEP.

DRC: stessi 121 rilievi, 499 elementi non connessi e 20 avvisi di parità preesistenti. ERC invariato a 196. Finestre e anelli touch verificati dopo il riempimento del rame su una copia del PCB: 84 centri lente liberi sui quattro strati. Il progetto richiede ancora sbroglio e risoluzione dei rilievi preesistenti prima della produzione.
