## Proposta successiva: LED nascosti

Questa variante conserva i LED visibili della prima prova, con il canale centrale serigrafico ripristinato. Per la nuova intenzione ottica vedere `display-optical-study.kicad_pcb` e `display-optical-study.md`.

# Display sud: studio meccanico40x5

Variante esplorativa, non parte dello schema/backbone attuale.

200LED rossi0402 nominali1x0.5x0.4mm, inclinati45gradi, passo1.30mm. Matrice40colonne e5righe. Ingombro rame circa52.26x6.76mm con il footprint KiCad genericoLED_0402_1005Metric (il land pattern del fornitore e ancora da verificare). Corpo complessivo circa51.76x6.26mm. Stesso PCB70x66mm, magnetici invariati.

Per liberare il centro, SW1 e SW2 si spostano ai lati aX216 e154.5mm,Y115mm. Matrice fraY112.55 e117.75mm (centri), immediatamente sopra le mezzanine. I200nuovi LED sono sul lato breadboard B.Cu, visibili direttamente: non sono reverse-mount e non usano finestre attraverso il PCB. Nessuna rimozione dei connettori della mezzanina.

La variante display-study.kicad_pcb serve solo a vedere gli ingombri. Nessuna connessione della nuova matrice e stata aggiunta allo schema. Il driver esistente ha144posizioni e48gia usate:96libere non bastano per200LED. Occorre un driver aggiuntivo e progettare l'allocazione dei canali, alimentazione, correnti e instradamento.

DRC variante:199sovrapposizioni courtyard,20distanze bordo magnetici,10PTH nei courtyard dei connettori ausiliari. Nessun nuovo corto, errore di clearance tra reti, ponte soldermask o serigrafia fuori bordo. Restano499collegamenti della backbone da sbrogliare. I nuovi LED non hanno net assegnate; la geometria e una proposta, non una validazione produttiva.

Simulazione: selezione/configurazione di riga, guida resistenza+LED, lettureADC e grafico qualitativo, CAN TX/RX, messaggi e animazioni, avviso dimostrativo. Tutti i valori e le animazioni sono simulati; nessun firmware implementato. L'avviso non implica rilevamento automatico dei corti, assente nell'hardware attuale. Mascherina scura opzionale nella simulazione: proposta ottica, non componente gia progettato.

LED di riferimento: https://www.lcsc.com/product-detail/C25503345.html
