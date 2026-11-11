# Frontale retroilluminato · studio KiCad

Aprire `frontale-retroilluminato-studio.kicad_pcb` in KiCad e `anteprima-interattiva.html` nel browser. Contorno nominale **62,5 × 57,5 mm**. Il passo verticale delle righe è 2,54 mm. I quattro indicatori di ogni riga sono a 45°, distanziati orizzontalmente di 1,70 mm. La tacca bianca indica OFF.

I tratti dei quattro simboli di riga sono finestrelle su entrambe le facce della solder mask. Le aree di esclusione mantengono il rame libero sotto i tratti su tutti e quattro gli strati. I comandi in basso sono LOAD, NEXT, MODE e SAVE. Il logo originale e le cinque spie di stato si trovano in alto a destra. Il maggior contrasto nell’anteprima rappresenta una simulazione.

## Verifica geometrica

Le 64 posizioni di riga sono state verificate con un inviluppo da 1,58 × 0,65 mm, che include le piazzole dei 0402 originali. Nessuna sovrapposizione fra inviluppi e almeno 0,15 mm di margine dalle piazzole già presenti. Le sagome dei comandi e degli indicatori di stato conservano il loro ingombro di riferimento XL-1606.

Gli inviluppi rimangono su Cmts.User. I 0402 originali emettono in direzione opposta al FR-4 se saldati normalmente sul retro. Il montaggio degli emettitori e la luminosità reale attraverso il laminato restano da verificare. L'area del logo incontra ancora J33 e U51. Restano da controllare J4 e R300 rispetto a bordo e intagli. Per lo schema elettrico fare riferimento alla variante LED singoli.
