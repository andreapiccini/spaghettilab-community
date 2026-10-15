# Driver I²C e Run Deploy

Nome, protocollo, indirizzo del dispositivo e bit indirizzo si impostano nella
barra superiore. I passi contengono solo il messaggio che segue l’indirizzo:
per un registro, il primo byte del messaggio è il registro; non è l’indirizzo
I²C del dispositivo. Le vecchie impostazioni di indirizzo nei passi non
scavalcano la connessione condivisa.

## Due schede a sinistra

**Blocco Flow del sensore** contiene le interfacce e l’elenco delle variabili:
Ingresso acquisisce un parametro, Encoder lo converte in byte, Decoder converte
una risposta del sensore, Uscita espone la variabile nel canvas. Le variabili si
possono trascinare nei messaggi o richiamare con `$nome`. Le interfacce condivise
vengono compilate insieme alle azioni che le utilizzano; i vecchi driver vengono
riorganizzati conservando l’associazione dei decoder e delle uscite.

**Azioni del sensore** contiene l’elenco delle azioni nominate. **+ Azione** crea
un’azione vuota; la libreria «Aggiungi un passo a…» inserisce letture, scritture e
attese solo nell’azione selezionata. Nome, duplicazione, rimozione ed esposizione
nel canvas sono disponibili nell’elenco. Ogni azione esposta genera un blocco
con più ingressi e uscite, condividendo un’unica istanza fisica del dispositivo.

Il grafico resta in alto. Ogni byte ha una larghezza minima; scorrimento
orizzontale e zoom mantengono leggibili i messaggi lunghi. I titoli mostrano
indirizzo, write/read, numero di byte e risposta effettivamente acquisita.
START, STOP, ACK e NACK restano nella sequenza del bus. Il grafico è una
rappresentazione del protocollo, non una misura con analizzatore logico.

**Incolla sequenza** accetta byte HEX separati da spazi, virgole o punti e virgola,
oppure una stringa HEX continua. Incollare più byte in una casella sostituisce
l’intero messaggio e crea automaticamente tutte le caselle. Incollare un byte o
`$variabile` modifica solo quella casella. Errori di sintassi non applicano una
sequenza parziale.

## Prova e deploy

**Testa azione** esegue la selezione; **con Init** antepone l’inizializzazione.
Le risposte RX reali e la decodifica appaiono nell’editor. La prova applica una
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
