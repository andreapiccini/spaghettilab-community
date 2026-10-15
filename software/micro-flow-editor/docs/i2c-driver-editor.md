# Driver I²C e Run Deploy

Nome, protocollo, indirizzo del dispositivo e bit indirizzo si impostano nella
barra superiore. I passi contengono solo il messaggio che segue l’indirizzo:
per un registro, il primo byte del messaggio è il registro; non è l’indirizzo
I²C del dispositivo. Le vecchie impostazioni di indirizzo nei passi non
scavalcano la connessione condivisa.

## Schede a sinistra

**Blocco Flow del sensore** contiene le interfacce e l’elenco delle variabili:
Ingresso acquisisce un dato in una variabile oppure attiva un’azione come trigger; Uscita espone una variabile
nel canvas. I blocchi del canvas preparano il tipo richiesto. Il formato in byte
dell’ingresso resta configurabile nei dettagli. Encoder e Decoder non sono più
interfacce aggiungibili; i dati dei driver precedenti restano compatibili. Le variabili si
possono trascinare nei messaggi o richiamare con `$nome`. Le interfacce condivise
vengono compilate insieme alle azioni che le utilizzano; restano possibili
variabili interne con valori iniziali numerici o HEX e riferimenti `$nome`.

**Azioni del sensore** contiene l’elenco delle azioni nominate. **+ Azione** crea
un’azione vuota; la libreria «Aggiungi un passo a…» inserisce letture, scritture e
attese solo nell’azione selezionata. Nome, duplicazione e rimozione sono disponibili nell’elenco. Le azioni sono
esposte automaticamente nel canvas, senza un pannello di opzioni separato. Il sensore genera un solo blocco iniziale: ogni istanza sceglie un’azione,
un ingresso e un’uscita, condividendo un’unica istanza fisica del dispositivo.

Le schede aperte mantengono l’altezza del contenuto e le colonne laterali scorrono
indipendentemente: interfacce, passi e librerie restano raggiungibili. I passi
sono selezionabili anche sotto l’azione nella colonna sinistra. I pannelli destri
usano la stessa gerarchia grafica di quelli sinistri.

Al centro, in alto, l’editor mostra il diagramma dell’azione o dell’inizializzazione
selezionata. Se si modifica «Blocco Flow del sensore», lo sostituisce con
l’anteprima schematica dei pin. La configurazione dell’interfaccia o del passo
selezionato compare sotto, nella stessa colonna centrale. A destra resta solo
la lista delle variabili interne, con creazione e modifica.

Il grafico temporale resta in alto durante la modifica delle sequenze. Ogni byte ha una larghezza minima; scorrimento
orizzontale e zoom mantengono leggibili i messaggi lunghi. I titoli mostrano
indirizzo, write/read, numero di byte e risposta effettivamente acquisita.
START, STOP, ACK e NACK restano nella sequenza del bus; legenda e didascalia
inferiori sono rimosse per guadagnare spazio. Il grafico è una
rappresentazione del protocollo, non una misura con analizzatore logico.

**Incolla sequenza** accetta byte HEX separati da spazi, virgole o punti e virgola,
oppure una stringa HEX continua. Incollare più byte in una casella sostituisce
l’intero messaggio e crea automaticamente tutte le caselle. Incollare un byte o
`$variabile` modifica solo quella casella. Errori di sintassi non applicano una
sequenza parziale.

## Prova e deploy

**Testa azione** esegue la selezione; **con Init** antepone l’inizializzazione.
L’esito, le risposte RX reali e la decodifica appaiono direttamente sotto i passi
dell’azione selezionata, senza popup. Il grafico in alto mostra le risposte ricevute. La prova applica una
configurazione temporanea e ripristina quella precedente. La prova di scrittura
richiede messaggi costanti, senza riferimenti a variabili non risolti.

Con firmware **0.3.6**, Run Deploy:

1. Compila il driver completo in un profilo installabile con azioni e schema.
2. Installa e verifica i profili prima di validare/applicare la configurazione.
3. Traduce attivazioni, timer, fili dei parametri e uscite in regole e collegamenti
   del runtime. Mantiene le impostazioni di connessione già presenti sul Core.
4. Memorizza i parametri ricevuti separatamente. Un’attivazione con parametri
   mancanti rimane in attesa, senza transazioni parziali. Con un filo Esegui i
   parametri aggiornano la memoria; senza Esegui l’arrivo dei parametri attiva
   l’azione quando tutti quelli necessari sono disponibili.
5. Pubblica i risultati reali per i blocchi successivi. Le variabili pubblicate
   possono essere richiamate da altre azioni dello stesso sensore.

L’identità del profilo dipende dalla sua logica, non dal nome o dalla posizione.
L’editor tiene traccia dei profili che ha installato su quel Core e rimuove le
vecchie versioni inutilizzate. I profili sono salvati in memoria persistente e ricaricati al riavvio.
Il firmware impedisce la rimozione di profili
ancora referenziati dalla configurazione attiva. Nessun profilo esterno viene
rimosso per convenzione di nome.

## Limiti verificati prima del deploy

Messaggi fino a 32 byte in una transazione; letture fino a 8 byte; massimo 8
azioni e 8 uscite, 16 operazioni compilate per inizializzazione e 16 per tutte le
azioni insieme. Il Core corrente dispone di 4 istanze declarative complessive
(inclusi i timer), 4 regole, 16 blocchi e 24 fili runtime. Le operazioni non
compilabili, gli ingressi sconosciuti e i cicli producono un errore esplicito.

Il runtime numerico usa interi a 64 bit. Scala e codifica controllano overflow,
segno e ordine dei byte; moltiplicatore e offset sono interi, il divisore è un
intero positivo e la divisione tronca verso zero. La prova nell’editor può
mostrare decodifiche frazionarie; il deploy non promette aritmetica floating point.

## Verifica sul Core

OLED a 0x3C su SDA GPIO38 / SCL GPIO37: il profilo prodotto dal compilatore ha
inviato la sequenza completa di 28 byte con due parametri del canvas. Validazione,
lettura di conferma della configurazione e nuova esecuzione dopo riavvio sono
riuscite. La configurazione originale è stata ripristinata e i profili di prova
rimossi. Una scrittura non produce byte RX: una risposta vuota è normale.

L’inizializzazione è una scheda autonoma sotto «Azioni del sensore». È facoltativa
e contiene i passi eseguiti una volta all’avvio del programma sul microcontrollore.
Non compare come azione nel canvas; ha una propria libreria di passi e prova.

Accanto all’indirizzo sono visibili velocità condivisa (100 kHz predefinito,
400 kHz opzionale) e pin SDA/SCL del Module Function. Modificare la velocità
aggiorna la configurazione fisica del progetto e la marca da applicare;
il pulsante SDA/SCL apre Module Function per configurare e applicare il bus.
La prova usa la velocità selezionata nella configurazione temporanea.
«8 bit» nei datasheet indica l’indirizzo a 7 bit con R/W, non un terzo modo
I²C: 0xD0/0xD1 corrispondono a 0x68, 0x78/0x79 a 0x3C.
Pull-up e filtri non sono parametri configurabili nel protocollo fisico attuale.

## Istanze del sensore nel canvas

La libreria espone un unico blocco per sensore. La generazione iniziale crea una
sola istanza; per altre azioni o altri pin si trascina di nuovo lo stesso sensore.
Un clic sul blocco apre un popup con tre scelte: azione, ingresso, uscita. Ogni
istanza espone al massimo un ingresso e un’uscita. Cambiare un pin scollega solo
i fili del pin che non è più disponibile. Le istanze condividono un solo modulo
fisico e l’inizializzazione resta unica.

L’anteprima del driver mostra tutti i pin disponibili come terminali esterni di
un simbolo schematico. Il simbolo del canvas mostra quelli selezionati.

Un ingresso ha due modalità:
- **Dato → variabile**: conserva il valore ricevuto, senza avviare operazioni I²C.
- **Trigger → azione**: attiva l’azione selezionata nell’istanza del canvas.

L’uscita espone una variabile come dato. Per acquisire dati e poi attivare una
transazione si usano più istanze dello stesso sensore. I parametri collegati sono
condivisi e obbligatori: l’attivazione resta in attesa finché sono disponibili.
Il trigger generico «Esegui azione» è disponibile anche senza un’interfaccia trigger
esplicita. Le variabili interne e i riferimenti `$nome` restano utilizzabili.
I vecchi progetti conservano i blocchi precedenti; rigenerare il driver aggiorna
le istanze al nuovo modello di selezione.
