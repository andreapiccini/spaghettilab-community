# Modelli e finestre ottiche

Modelli LCSC/EasyEDA scaricati dai codici esatti C42420609 (U25/U73/U74), C546431 (U12/U13/U72/U75) e C39846848 (L1), salvati localmente in LCSCModels.3dshapes. Modelli QFN ruotati -90° rispetto agli assi del CAD originale per allineare i terminali alle impronte esistenti; impronte elettriche non sostituite. Ripristinati i percorsi dei modelli esistenti di U8, U2, Q2 e passivi.

Le finestre NON sono fresature o fori nel materiale: il FR4 rimane. Sono aperture F.Mask sotto la lente dei LED, esclusioni del rame su F.Cu/In1.Cu/In2.Cu/B.Cu, e aperture B.Mask con i simboli VCC/GND/MCU/X e il logo. Sul retro e sui due interni il rame è escluso anche sotto la sagoma completa dei simboli; sul fronte rimangono disponibili i pad necessari ai LED. Il 3D standard non simula la traslucenza e non mostra la luce accesa.

Verifica con riempimento delle zone su copia del PCB e generazione dei sei Gerber rame/maschera: tutti gli 80 centri delle lenti liberi da rame su tutti e quattro gli strati. Da verificare sul prototipo la trasmissione del FR4 e la contaminazione luminosa tra finestre.
