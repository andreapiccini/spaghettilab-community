# TASK-170-01 — Implementare Discovery 1:N

**Stato:** ✅ DONE
**Fase:** 170 — Discovery

## Cosa devo fare

### 1. Definire result ed eventi per key

Apri `include/spaghetti/discovery.h` e scrivi:

```c
enum spaghetti_discovery_source {
	SPAGHETTI_DISCOVERY_SOURCE_CONFIG,
	SPAGHETTI_DISCOVERY_SOURCE_PROVIDER,
};

struct spaghetti_discovery_result {
	spaghetti_module_key_t key;
	spaghetti_port_id_t port_id;
	char type_id[SPAGHETTI_TYPE_ID_MAX];
	uint8_t driver_config[SPAGHETTI_DRIVER_CONFIG_MAX];
	size_t driver_config_size;
	enum spaghetti_discovery_source source;
	uint32_t generation;
};

enum spaghetti_discovery_event_type {
	SPAGHETTI_DISCOVERY_UPSERT,
	SPAGHETTI_DISCOVERY_REMOVE,
};

struct spaghetti_discovery_event {
	enum spaghetti_discovery_event_type type;
	struct spaghetti_discovery_result result;
};
```

Result/event sono copiabili e possiedono stringa/config. `key` è l’identità stabile;
Port può ripetersi. `generation` protegge quella key, non l’intera Port. REMOVE usa key
e generation esatte e non rimuove fratelli.

### 2. Definire provider che può emettere più risultati

```c
typedef int (*spaghetti_discovery_sink_t)(
	const struct spaghetti_discovery_event *event,
	void *user_data);
typedef int (*spaghetti_discovery_emit_t)(
	const struct spaghetti_discovery_result *result,
	void *user_data);

struct spaghetti_discovery_provider_ops {
	int (*scan)(spaghetti_port_id_t port_id,
		    spaghetti_discovery_emit_t emit,
		    void *emit_user_data,
		    k_timeout_t timeout);
};

int spaghetti_discovery_init(spaghetti_discovery_sink_t sink, void *user_data);
int spaghetti_discovery_submit_manual(
	const struct spaghetti_discovery_result *result);
int spaghetti_discovery_scan_port(spaghetti_port_id_t port_id,
				  k_timeout_t timeout);
int spaghetti_discovery_invalidate(spaghetti_module_key_t key,
				   uint32_t expected_generation);
```

Sink/emit sono callback prese in prestito con lifetime firmware. Ogni result vale solo
durante la callback e va copiato se trattenuto. `scan()` può chiamare emit zero o più
volte; timeout è per valore e limita il lavoro provider.

### 3. Implementare stato bounded per key

Apri `subsys/discovery/discovery.c`. Usa un array privato di
`CONFIG_SPAGHETTI_DISCOVERY_MAX_RESULTS`, inizialmente uguale a
`SPAGHETTI_CONFIG_MAX_MODULES`. Ogni slot contiene used, key, generation e result.

`submit_manual()` valida key nonzero, Port, type/config/size/source e generation. Cerca
per key: nuova key usa uno slot libero; key esistente accetta solo una generation
maggiore. Copia il result, emette UPSERT e ripristina la copia precedente se il sink
fallisce. Non cercare “lo slot della Port”.

`invalidate(key, expected_generation)` trova la key esatta, confronta generation,
emette REMOVE e cancella lo slot solo se il sink accetta.

### 4. Collegare sink e Manager

Il sink di riconciliazione traduce UPSERT in `spaghetti_module_request` e chiama
Manager configure. Per REMOVE risolve la snapshot con
`spaghetti_module_manager_get_by_key()` e chiama remove con ID/revision correnti.

Config produce un result per ogni elemento. Una nuova Config con key 10/0x40 e
11/0x41 invia due UPSERT sulla stessa Port. Se la Config successiva omette key 10,
invia REMOVE 10; key 11 resta READY.

### 5. Implementare scan provider senza inventare identificazione

`spaghetti_discovery_scan_port()` chiama il provider registrato e gli passa un emit
interno che riusa la stessa validazione/copia. Un provider con presence pin, EEPROM o
identità verificata può emettere più risultati. Sulla board senza tale hardware,
restituisci `-ENOTSUP`: uno scan di address I2C da solo non identifica il driver.

## Perché è fatto così

Una generazione per Port faceva sì che il risultato più recente cancellasse gli altri
dispositivi del bus. Indicizzare per key rende update/remove indipendenti. La callback
emit consente a una singola scansione di produrre molti Module mantenendo memoria e
tempo bounded.

## Come si usa

```c
struct spaghetti_discovery_result result = {
	.key = 11U,
	.port_id = 0U,
	.type_id = "ina219",
	.source = SPAGHETTI_DISCOVERY_SOURCE_CONFIG,
	.generation = 2U,
};
memcpy(result.driver_config, &ina219_41, sizeof(ina219_41));
result.driver_config_size = sizeof(ina219_41);
int err = spaghetti_discovery_submit_manual(&result);
```

## Checklist di completamento

- [x] Result ed eventi contengono key e buffer owned.
- [x] Stato e generation sono per key, non per Port.
- [x] Il contratto provider può emettere zero o più risultati.
- [x] UPSERT/REMOVE modificano soltanto una key.
- [x] Due risultati sulla stessa Port raggiungono il sink di riconciliazione.
- [x] Senza provider reale scan restituisce ENOTSUP.

## Verifica e fine task

```sh
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/discovery -p native_sim/native/64 --inline-logs'
make pristine
```

Il test invia key 10/0x40 e 11/0x41 sulla Port 0, poi invalida una sola key. Verifica
anche generation stale, pool pieno, sink fallito e chiamata rientrante sulla stessa
key. La build hardware conferma che Discovery è incluso nel firmware. Non compare
ancora un flusso Discovery nella Shell: il sink completo Config → Manager viene
composto nel task 200 dell'Engine.
