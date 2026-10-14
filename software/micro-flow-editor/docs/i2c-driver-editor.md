# Driver I²C: azioni e blocchi nel canvas

La scheda Dispositivi consente di definire una connessione, un’inizializzazione
comune e più azioni nominate. Ogni azione esposta genera un blocco distinto; i
blocchi condividono lo stesso identificatore di dispositivo nel progetto.

## Creazione

1. Impostare nome e indirizzo I²C a 7 bit.
2. Aggiungere un’azione vuota oppure usare **Leggi registro** / **Scrivi registro**.
3. Impostare il registro (indirizzo a 8 o 16 bit) e i byte della transazione.
4. Per una lettura, configurare **Decodifica** e **Pubblica risultato**. Il modello
   di lettura predispone questi passi. Una scrittura non richiede un canale numerico.
5. Scegliere **Esponi questa azione come blocco nel canvas**. Le azioni non esposte
   possono rimanere incomplete e sono conservate nella bozza.
6. **Genera blocchi Flow** mostra l’anteprima e crea i blocchi selezionati. Le
   azioni sono disponibili anche nella palette per creare altre copie.

La rigenerazione conserva gli identificatori, le posizioni e i collegamenti dei
blocchi esistenti. Le azioni eliminate o non più esposte vengono rimosse dal
canvas. Rimuovere il dispositivo dal pannello Backbone rimuove tutti i suoi blocchi.

## Prova sul dispositivo

**Testa azione** esegue esclusivamente l’azione selezionata. **Testa init** prova
solo l’inizializzazione. L’opzione **con Init** la antepone alla prova dell’azione.
Il diagramma SDA/SCL è espandibile e illustra il protocollo; non è una misura dei
segnali elettrici effettuata da un analizzatore logico.

I byte RX arrivano realmente da APPLY_CONFIG (firmware 0.3.4+10). I risultati
numerici della prova sono decodificati nell’editor da quei byte, rispettando
ordine, segno, intervallo di byte e scala. Byte mancanti o valori interi non
rappresentabili esattamente rimangono indisponibili.

Un doppio clic sul blocco nel canvas apre **Testa questo blocco**, che usa la
stessa sequenza completa salvata dal driver. La prova applica una configurazione
temporanea e ripristina quella precedente. Se sono collegate più Backbone, viene
usata quella selezionata; non viene scelta arbitrariamente un’altra scheda.

## Limiti attuali

- Ogni transazione usa al massimo otto byte; la risposta di prova cattura al
  massimo otto letture.
- Le scritture della prova richiedono byte HEX costanti; riferimenti a variabili
  non risolti non vengono trasformati silenziosamente in dati da inviare.
- Questo aggiornamento completa l’authoring dei blocchi e le prove manuali reali.
  Il firmware 0.3.5 supporta profili multi-azione, parametri e dispatch tramite
  regole `device-action`. Run Deploy richiede ancora il collegamento del compilatore
  del canvas a questi profili e regole; i blocchi di authoring da soli non lo attivano.

## Verifica

Sul GY-521, indirizzo 0x68, SDA GPIO38 e SCL GPIO37, il modello di lettura con
registro 0x75 e lunghezza 1 restituisce RX 0x68 e valore decodificato 104.

## Organizzazione dell’editor

Nome, protocollo, indirizzo I²C e bit sono riuniti nella barra compatta superiore.
Il grafico Segnali nel tempo è sempre aperto in cima all’area centrale.
A sinistra si scelgono le azioni del sensore; ogni voce indica se genera un blocco
del canvas. La libreria distingue l’aggiunta di un passo dalla creazione di
un’azione: lettura/scrittura registro in evidenza, operazioni avanzate espandibili.
Il pannello destro configura il passo selezionato; larghezza del registro,
variabili e ingressi sono accessibili nei dettagli. Le impostazioni dell’azione
(nome, identificatore, esposizione e duplicazione) restano disponibili sotto il
grafico senza occupare tutto lo spazio iniziale.

### Azione, passi e porte

L’elenco offre solo **+ Azione**. La libreria dei passi appare nella stessa
scheda dell’azione selezionata, ne riporta il nome e contiene lettura/scrittura
registro, Ingresso, Encoder, Decoder e Uscita. L’indirizzo I²C è condiviso e si
imposta soltanto in alto; eventuali vecchi indirizzi salvati nei passi non
scavalcano questa impostazione nel grafico o nella conversione della ricetta.

L’encoder collega un ingresso Flow alla variabile codificata. L’acquisizione
dell’ingresso precede l’encoder nella sequenza, è riutilizzata quando possibile
e le destinazioni di encoder diversi sono distinte. Il decoder converte i byte
del sensore in una variabile; Uscita pubblica quella variabile all’esterno.
Aggiungendo Uscita si crea una porta distinta quando quelle esistenti sono già
usate. L’anteprima laterale mostra il blocco dell’azione selezionata, con ogni
ingresso e uscita su una riga; la conferma di creazione mostra tutte le azioni.
