# TASK-340-01 — Generalizzare Data, Runtime e regole

**Stato:** ✅ DONE
**Fase:** 340 — Data, Runtime e regole V2

## Cosa devo fare

### 1. Fare di Data un bus di record generici

Apri `include/spaghetti/data.h` e `subsys/data/data.c`. Sostituisci
`spaghetti_electrical_message` con `struct spaghetti_record` e rinomina l'API:

```c
int spaghetti_data_publish(
	const struct spaghetti_record *record,
	k_timeout_t timeout);
int spaghetti_data_get_stats(struct spaghetti_data_stats *out);
```

Il canale diventa `spaghetti_record_chan`; logger, Runtime, MQTT e test ricevono copie.
Data valida shape/capacità ma non conosce schema INA219. Queue-full conserva la policy
attuale bounded e incrementa `delivery_errors`. Il logger stampa source, schema,
version, boot ID, timestamp, sequence e field ID/type senza inventare nomi. Dopo la
pubblicazione zbus, passa una copia al confine Record Delivery che verrà completato
nella fase 345; nessun adapter MQTT/BLE legge direttamente memoria del Runtime.

### 2. Pianificare più letture indipendenti

Apri `include/spaghetti/runtime.h` e `subsys/runtime/runtime.c`. Runtime possiede un
array di job pari a `SPAGHETTI_CONFIG_MAX_SCHEDULES`:

```c
struct spaghetti_runtime_job {
	bool enabled;
	spaghetti_module_key_t source_key;
	spaghetti_module_id_t source_id;
	uint32_t period_ms;
	int64_t next_deadline_ms;
	uint32_t sequence;
};

int spaghetti_runtime_configure(
	const struct spaghetti_runtime_schedule_config *schedules,
	size_t schedule_count,
	const struct spaghetti_rule_config *rules,
	size_t rule_count);
```

Input è borrowed e copiato prima del ritorno. Config chiama configure mentre Runtime è
stopped. Start risolve ogni key con Manager. Un singolo worker attende la deadline più
vicina, legge tutti i job scaduti, completa source/timestamp/sequence e pubblica. Un
errore di un Module non ritarda gli altri; il prossimo deadline avanza dal valore
precedente per evitare drift incontrollato.

### 3. Collegare eventi asincroni

Runtime chiama `spaghetti_module_manager_start_events()` sui Module con op start.
L'emit callback copia il payload in una `k_msgq` bounded e ritorna `-ENOSPC` se piena;
non blocca il worker del driver. Il thread Runtime completa metadati e pubblica. Stop
ferma prima gli eventi, poi svuota la coda, così nessuna callback usa Runtime distrutto.

### 4. Implementare istanze di rule plug-in

Runtime possiede al massimo `SPAGHETTI_CONFIG_MAX_RULES` slot con key, descriptor e
context. Configure trova il rule driver, valida e chiama init. Ogni record pubblicato
viene consegnato in ordine a `on_record()`. L'action emessa viene risolta per
`target_key`, quindi applicata con `spaghetti_module_manager_command()`; una rule non
riceve puntatori Manager.

Se init di una rule fallisce, Runtime deinizializza quelle già create in ordine
inverso e conserva la configurazione precedente. Se una action fallisce, registra
stats/error ma continua a processare record e altre rule.

Aggiorna `subsys/config/config.c` nello stesso task: rimuovi il rifiuto temporaneo
`rule_count > 0`, passa tutte le rule a `spaghetti_runtime_configure()` e includi il
loro lifecycle nel rollback Config. Rimuovi anche
`legacy_publish_ina219_record()` introdotto dal task 320: da questo punto ogni schema
attraversa esclusivamente `spaghetti_data_publish()`.

### 5. Spostare la soglia in un plug-in generico

Crea `spaghetti_rules/threshold/threshold.h`, `.c`, `README.md` e aggiungili a CMake e
Kconfig. La config usa field ID, non nomi INA219/Relay:

```c
enum spaghetti_threshold_config_field {
	SPAGHETTI_THRESHOLD_SOURCE_KEY = 1,
	SPAGHETTI_THRESHOLD_SOURCE_FIELD_ID = 2,
	SPAGHETTI_THRESHOLD_LOWER = 3,
	SPAGHETTI_THRESHOLD_UPPER = 4,
	SPAGHETTI_THRESHOLD_TARGET_KEY = 5,
	SPAGHETTI_THRESHOLD_COMMAND_ID = 6,
	SPAGHETTI_THRESHOLD_COMMAND_FIELD_ID = 7,
	SPAGHETTI_THRESHOLD_ABOVE_VALUE = 8,
};
```

Il context slab conserva limiti, target e ultimo stato. `on_record()` ignora source o
field differenti, accetta INT64/UINT64 rappresentabili, applica isteresi ed emette un
comando BOOL solo sulla transizione. Non include header INA219 o Relay. Descriptor:
`type_id = "threshold"`, schema `spaghetti.rule.threshold`, version 1, registrato con
iterable section. Nel descriptor assegna semantic/reference group: source key e source
field al gruppo 1; target key, command ID e command field al gruppo 2. Il Runtime non
riceve un grafo React Flow: riceve la Config normalizzata e risolve questi riferimenti
bounded. L'editor host disegna nodi e archi leggendo la stessa semantica dal catalogo.

### 6. Migrare consumer e test

Aggiorna `tests/data`, `runtime`, `mqtt` solo per compilare il record generico; MQTT
verrà completato nella fase 370. Testa due schedule con periodi differenti, evento
asincrono, coda piena, stop, due schemi diversi, rule threshold su field generico,
target assente e action fallita.

## Perché è fatto così

Data distribuisce fatti, Runtime decide quando acquisirli, rule plug-in applicano
piccole automazioni offline e Node-RED può fare logiche più ricche. Un solo scheduler
bounded evita un thread per Module. Field ID e command ID rendono la soglia riusabile
senza dipendenze da driver. Tenere i riferimenti nella Config canonica, invece di
eseguire codice inviato dall'host, conserva memoria e tempi deterministici.

Le rule restano proprietarie di decisioni e comandi. Le trasformazioni pure o
stateful di valori diventano Block Driver nella fase 342, così filtri, conversioni e
pipeline non vengono moltiplicati come rule ad hoc.

## Come si usa

Config assegna schedule a ogni key leggibile. Un pulsante può emettere eventi senza
polling. Una threshold rule osserva qualunque field numerico e genera qualunque comando
BOOL compatibile. Senza rule, i record raggiungono comunque Node-RED.

## Checklist di completamento

- [x] Data e zbus non contengono campi elettrici concreti.
- [x] Più job usano un solo scheduler con deadline indipendenti.
- [x] Eventi asincroni sono copiati e fermabili.
- [x] Rule Registry crea context bounded e rollbackabile.
- [x] Threshold non include INA219/Relay.
- [x] I collegamenti rule sono risolvibili dal catalogo senza metadati React-specifici.
- [x] Errori di una sorgente/regola non fermano le altre.
- [x] Ogni record porta boot ID e attraversa un solo confine di consegna.

## Verifica e fine task

```sh
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/data -T tests/runtime -T tests/threshold \
  -p native_sim/native/64 --inline-logs --clobber-output'
make pristine
```

Il risultato atteso è vedere due schemi differenti attraversare lo stesso canale e la
rule threshold comandare un fake senza riferimenti a driver concreti.
