# Frontale retroilluminato · studio KiCad

Aprire `frontale-retroilluminato-studio.kicad_pcb` in KiCad e `anteprima-interattiva.html` nel browser. Contorno nominale **62,5 × 57,5 mm**. Il passo verticale delle righe è 2,54 mm. I quattro indicatori di ogni riga sono a 45°, distanziati orizzontalmente di 1,75 mm. La X bianca indica OFF.

I tratti dei quattro simboli di riga sono finestrelle su entrambe le facce della solder mask. Le aree di esclusione mantengono il rame libero sotto i tratti su tutti e quattro gli strati. I comandi in basso sono LOAD, NEXT, MODE e SAVE. Il logo originale e le cinque spie di stato si trovano in alto a destra. Il maggior contrasto nell’anteprima rappresenta una simulazione.

## Verifica geometrica

Le 64 posizioni sono state verificate con le piazzole reali del footprint LED_0402_1005Metric su F.Cu. Le piazzole rispettano 0,15 mm di distanza da quelle già presenti e dalle altre posizioni LED e 0,035 mm dalle zone di esclusione del rame. Le posizioni posteriori sono sfalsate rispetto ai simboli fino a circa 1,12 mm. Il contorno e i fori magnetici conservano le posizioni originali. Le sagome dei comandi e degli indicatori di stato conservano il loro ingombro di riferimento XL-1606.

Gli inviluppi rimangono su Cmts.User. I 0402 originali emettono in direzione opposta al FR-4 se saldati normalmente sul retro. Il montaggio degli emettitori e il percorso ottico verso le finestrelle sfalsate restano da verificare sul prototipo. L'area del logo incontra ancora J33 e U51. Restano da controllare J4 e R300 rispetto a bordo e intagli. Per lo schema elettrico fare riferimento alla variante LED singoli.
