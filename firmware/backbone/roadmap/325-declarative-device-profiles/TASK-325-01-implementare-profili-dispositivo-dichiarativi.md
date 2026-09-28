# TASK-325-01 — Implementare profili dispositivo e acquisition plan

**Stato:** ✅ DONE
**Fase:** 325 — Profili dispositivo dichiarativi

## Cosa devo fare

### 1. Separare capability firmware, profilo dispositivo e istanza

Crea `include/spaghetti/device_profile.h`, `subsys/device_profiles/` e
`tests/device_profiles/`. Un Device Profile descrive un modello di dispositivo; non
contiene Port, Bay, label o indirizzo scelti per una singola installazione. Config
conserva soltanto `profile_id`, versione/hash e le proprietà di istanza.

Definisci identificatori stabili e owned, una revisione SHA-256 e limiti Kconfig per
numero profili persistiti, byte totali, operazioni per piano, temporanei, output e
dimensione di una singola transazione. Un profilo ricevuto è decodificato in staging,
validato completamente, scritto atomicamente e diventa visibile al Registry soltanto
al commit. Upload interrotto, hash errato o profilo incompatibile non modifica il set
attivo.

Mantieni due origini equivalenti dietro la stessa API:

- profili built-in `const`, compilati nell'immagine;
- profili installabili persistiti come dati, senza codice eseguibile.

Un ID/versione duplicato con hash diverso è un conflitto. Config deve poter dichiarare
una versione o hash esatti per evitare che un profilo aggiornato cambi silenziosamente
il significato di un'installazione esistente.

### 2. Definire un acquisition plan dichiarativo e bounded

Il profilo dichiara:

- trasporto e capability Port richieste;
- vincoli elettrici selezionabili soltanto fra quelli certificati dalla Function Bay;
- probe/identificazione opzionale;
- sequenza `init`, `sample`, evento/command e `safe_stop`;
- schemi dei record e dei comandi prodotti;
- timeout, frequenza massima e budget di operazioni.

Il set iniziale di istruzioni deve coprire almeno:

```text
I2C_WRITE, I2C_READ, I2C_WRITE_READ
SPI_TRANSCEIVE
UART_WRITE, UART_READ_UNTIL
GPIO_GET, GPIO_SET
ADC_READ
DELAY_BOUNDED, WAIT_FIELD_MASK
LOAD_CONST, COPY_BYTES, CONCAT, BYTE_SWAP
MASK, SHIFT, SIGN_EXTEND
CRC8, CRC16
EMIT_FIELD, EMIT_RECORD
```

Niente puntatori, salti arbitrari, ricorsione, loop non bounded, accesso a memoria o
funzioni C per indirizzo. Ogni branch deve avere un massimo staticamente calcolabile;
il validatore calcola prima dell'apply numero peggiore di transazioni, byte, attese e
tempo totale. Port continua a possedere controller, lock e chip-select: il piano non
accede direttamente a device Zephyr.

`WAIT_FIELD_MASK` effettua polling con tentativi e intervallo espliciti. Le operazioni
di conversione necessarie alla lettura possono produrre valori INT64/UINT64 fixed-point;
elaborazioni successive appartengono alla fase 342.

### 3. Aggiungere il Module Driver generico dei profili

Implementa un driver auto-registrato `declarative-device` che:

1. risolve profilo e revisione;
2. verifica trasporto, Bay, rail e limiti del profilo;
3. riserva da pool condivisi soltanto lo stato delle istanze presenti nel Config;
4. esegue `init` con rollback e `safe_stop` bounded;
5. esegue `sample` o eventi e pubblica record conformi agli schemi dichiarati;
6. espone esclusivamente i comandi elencati dal profilo.

I profili non possono dichiarare tensioni, pull-up, gain, excitation o isolamento non
supportati dall'hardware. Configurazione elettrica significa selezione di una modalità
già esposta e validata dalla Bay, non modifica delle sue caratteristiche fisiche.

### 4. Definire wire, storage e catalogo firmware

Crea un CBOR canonico versionato per i profili. Rifiuta float e usa fixed-point con
unità/scala dichiarate. Il catalogo enumera profili built-in e persistiti con ID,
versione, hash, trasporto, capability richieste, schemi, dimensioni e disponibilità.

Aggiungi operazioni firmware bounded per `LIST/GET/VALIDATE/INSTALL/REMOVE_PROFILE`.
Rimozione è rifiutata se il Config attivo o quello persistito riferisce il profilo.
Install/remove richiedono permesso di manutenzione e non permettono di installare
nuove istruzioni: un opcode assente richiede un Capability Pack firmware della fase
348.

### 5. Provare dispositivi diversi senza nuovi driver

Nei test crea almeno:

- due sensori I2C con mappe registri/endian differenti;
- un sensore SPI con chip-select e mode dichiarati;
- un ingresso ADC con scala fixed-point;
- un dispositivo con init, polling ready, CRC e più field;
- profilo con opcode assente, loop invalido, timeout eccessivo, schema incoerente,
  capability/Bay incompatibile e upload interrotto.

Tutti devono usare lo stesso driver generico. Verifica reboot, storage atomico,
rollback, due istanze dello stesso profilo e aggiornamento profilo rifiutato quando
cambia hash sotto una Config attiva.

## Perché è fatto così

Il firmware implementa trasporti e primitive sicure una volta; i dettagli ripetitivi
dei registri diventano dati condivisibili. Separare profilo e istanza evita di copiare
sequenze grandi nel Config e permette di aggiungere sensori compatibili senza OTA.

## Checklist di completamento

- [x] Profili built-in e persistiti usano la stessa API e lo stesso catalogo.
- [x] Il validatore dimostra limiti di operazioni, byte e tempo prima dell'I/O.
- [x] Il driver generico non accede a controller fuori da Port.
- [x] Config riferisce profilo con revisione/hash stabile.
- [x] Installazione dati non introduce codice o opcode nuovi.
- [x] Un profilo in uso non può essere rimosso o sostituito incompatibilmente.
- [x] Cinque profili fake funzionano senza nuovi sorgenti driver.

## Verifica e fine task

```sh
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/device_profiles -p native_sim/native/64 --inline-logs --clobber-output'
make pristine
```

