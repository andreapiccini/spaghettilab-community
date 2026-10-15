# Tool Display

Stato: sviluppo sospeso su richiesta dell’utente. La sezione Tool è nascosta dalla navigazione e dalla ricerca comandi; codice e dati sono conservati come base da completare in futuro.

Display è un tool laterale, separato dal protocollo del driver. La prima versione offre un editor monocromatico con punti, linee, rettangoli e testo bitmap 5×7.

## Driver e adapter

Salvare prima un driver in Dispositivi. Il selettore del tool legge i driver creati nel progetto, comprese le bozze salvate e i driver già generati. Non carica driver predefiniti.

In **Driver e adapter**, scegliere il driver e mappare ogni funzione grafica a una o più azioni ordinate. Per ciascun ingresso selezionare la variabile del driver e scrivere esplicitamente la conversione. Il collegamento usa l'identificatore stabile della variabile, quindi una rinomina non cambia la mappatura.

Esempi di espressioni manuali:

- `x1`, `y1`, `x2`, `y2` per gli estremi di una linea.
- `[lo(x1), hi(x1)]` oppure `le16(x1)` per una coordinata su due byte.
- `concat([0x40], chunk)` per aggiungere un prefisso a un blocco del framebuffer.
- `utf8(text)` o `ascii(text)` per il testo.
- `rx0[0] + 256 * rx0[1]` per convertire una risposta reale dell'azione.

Sono disponibili aritmetica, operatori bit a bit, array, indicizzazione e funzioni dichiarate nell'aiuto. Le formule non eseguono JavaScript e non accedono al browser. Ogni valore deve essere nel formato e nell'intervallo dichiarato: non viene troncato automaticamente.

Per display che ricevono un framebuffer, mappare **Aggiorna**, scegliere la ripetizione per blocchi e configurare dimensione e ordine dei byte. Il tool prepara un framebuffer 1 bit/pixel a pagine verticali da 8 pixel oppure a righe. Prefissi, indirizzamento della memoria e comandi restano responsabilità dell'adapter manuale. Le conversioni delle risposte sono eseguite nel tool.

## Prova e generazione

L'anteprima mostra i byte delle chiamate prima dell'invio. La prova hardware attuale richiede un driver I²C a 7 bit. Installa un profilo temporaneo, applica una sola configurazione e invia le azioni parametrizzate in sequenza. L'inizializzazione del driver è facoltativa ed è eseguita una sola volta. Alla fine, anche dopo un errore o un'interruzione, viene ripristinata la configurazione precedente. Se il ripristino fallisce, il profilo ancora in uso viene conservato e l'errore è mostrato.

**Genera azione nel driver** converte il disegno corrente in passi concreti riutilizzabili in Dispositivi e nel canvas. Non genera formule arbitrarie per il microcontrollore. Il programma deve rispettare i limiti del compilatore firmware; un disegno grande può essere provato dal tool in streaming ma superare lo spazio disponibile per una singola azione salvata. In questo caso la generazione segnala il limite prima di modificare il driver.

Programma grafico e adapter vengono salvati nel progetto con **Salva tool**.
