# Verifica integrazione Cursor — 18 ottobre 2026

Baseline: commit 7b17a54. Revisione del codice e correzioni locali; nessun firmware caricato sul banco in questa revisione.

## Riscontri e correzioni

- L'onda quadra sostituiva l'azione scelta con GPIO/DELAY/GPIO; attese lunghe occupavano il worker. Introdotto GPIO_PULSE (opcode 33), con spegnimento differito, annullamento sincrono e ripristino del livello. Il compilatore rispetta polarità e azione HIGH/LOW; rifiuta azioni complesse anziché scartarle silenziosamente. Una sola onda per modulo fisico.
- Il clock di ripiego e OnBoot rivendicavano un endpoint I²C fittizio. Ora sono endpoint LOGICAL, senza acquisizione/rilascio di pin. I profili logici non possono eseguire I/O fisico.
- DELAY_BOUNDED controlla Stop ogni 10 ms. Stop mantiene il canvas e può annullare l'attesa fra scritture di configurazione. Configurazioni ricevute non decodificabili producono un errore esplicito.
- L'avvio cancellava la configurazione persistente al primo errore restituito da apply. Ora la conserva e segnala l'errore, lasciando vuoto il runtime non attivato. Questo non costituisce una prova di recupero da un crash CPU.
- Il bridge NFC scartava node ID CAN a 24 bit e cercava altri nodi/antenne; il percorso memorizzato per UID poteva attraversare master diversi. Ora usa la posizione osservata e il master corretto, senza tentativi su altri lettori.
- Il formato della memoria NFC veniva dato per scontato. Ora vengono controllati CC/prodotto, famiglia supportata, protezione e UID. La scrittura richiede rilettura completa e confronto esatto, anche se la memoria precedente è già disponibile. Timeout e annullamento restano espliciti.
- L'associazione UID→Relè non viene più ricreata automaticamente dalla libreria incorporata. Le associazioni salvate dall'utente restano; la UI distingue riconoscimento in libreria da contenuto del chip.
- Scrittura NFC ridotta a un solo comando «Scrivi e verifica», con annullamento. Nessun blocco del trasporto lasciato aperto mentre si attende un secondo clic.
- Blocchi dispositivo con illustrazione hardware condivisa, nome, azione e pin collegati al bordo. Nascosto il secondo Relè non implementato nella palette. Corrette letture di ref durante render e dipendenze temporali nel canvas, senza sopprimere i controlli.
- Corretto il profilo temporaneo dei test GPIO, prima privo di uno schema campione valido.

## Verifiche

- Applicazione: typecheck e build superati; test applicazione, modello, codec/installazione e SDK verificati separatamente (conteggi nei risultati della sessione).
- Lint dei file modificati: zero errori, sei warning. Il lint generale presenta ancora 28 errori fuori dai file modificati: la qualità dell'intero repository non è certificata da questa revisione.
- Firmware: 15 test device_profiles e 2 test runtime superati; build ESP32-S3 master 0.5.4 riuscita. Test mirati coprono impulso non bloccante, annullamento/ripristino, Stop su attesa lunga e clock senza acquisizione di porte fisiche.
- UI verificata nel progetto demo separato: nuovo tag vuoto, selezione driver, scrittura con verifica nel simulatore, generazione e visualizzazione del blocco GPIO. Simulatore e hardware sono esplicitamente distinti.

## Compatibilità e limiti aperti

Il nuovo impulso e l'endpoint logico richiedono firmware 0.5.4. Un firmware precedente rifiuta i nuovi profili; aggiornare prima di usarli. Il binario preparato è per il master, non per il lettore NFC.

Non qualificati sul banco: write/readback RF su tag reale, scansioni dopo l'ultimo flash, cablaggio GPIO e durata prolungata con onda + NFC + USB. Il nuovo impulso elimina la lunga attesa dal worker ma non dimostra l'assenza di saturazione di ogni coda.

Gli impulsi usano la workqueue di sistema: temporizzazione best effort, non generatore hardware di precisione. Rimane il limite di quattro contesti e quattro impulsi concorrenti; non è stato aumentato senza una verifica delle risorse.

Build master: DRAM statica 382936/384256 byte (99,66%; margine linker 1320 byte). Questo dato NON è la RAM heap libera: heap e stack riservati sono già compresi nelle sezioni statiche. Serve misura runtime per conoscere memoria effettivamente disponibile e picchi. Nessun nuovo thread/stack dedicato agli impulsi.

Catalogo online, asset fotografici, OTA NFC e hardware PCB non implementati da questa revisione. Nessuna prova sul banco è sostituita dai test software.
