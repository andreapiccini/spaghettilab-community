# TASK-090-01 — Implementare Config

**Stato:** ✅ DONE
**Fase:** 090 — Config interna

## Cosa devo fare

### 1. Definire uno snapshot generico con key

Apri `include/spaghetti/config.h` e scrivi:

```c
#define SPAGHETTI_CONFIG_VERSION 1U
#define SPAGHETTI_CONFIG_MAX_MODULES 8U
#define SPAGHETTI_CONFIG_TYPE_ID_SIZE 24U
#define SPAGHETTI_DRIVER_CONFIG_MAX 64U

struct spaghetti_module_config {
	spaghetti_module_key_t key;
	spaghetti_port_id_t port_id;
	char type_id[SPAGHETTI_CONFIG_TYPE_ID_SIZE];
	size_t driver_config_size;
	uint8_t driver_config[SPAGHETTI_DRIVER_CONFIG_MAX];
};

struct spaghetti_runtime_sampling_config {
	bool enabled;
	spaghetti_module_key_t source_key;
	uint32_t period_ms;
};

struct spaghetti_config {
	uint32_t version;
	size_t module_count;
	struct spaghetti_module_config modules[SPAGHETTI_CONFIG_MAX_MODULES];
	struct spaghetti_runtime_sampling_config sampling;
};
```

Tutte le struct sono pubbliche, bounded, prive di puntatori e interamente possedute
dallo snapshot. `key` è il riferimento persistente; `source_key` seleziona un elemento
Config e verrà tradotta nel Module ID corrente dopo apply. `port_id` può ripetersi.
`driver_config` contiene una copia dei byte concreti, ma Config non include header
INA219/Relay.

### 2. Dichiarare le API

Sempre in `config.h` dichiara:

```c
int spaghetti_config_init(const struct spaghetti_config *defaults);
int spaghetti_config_validate(const struct spaghetti_config *candidate,
			      struct spaghetti_config_error *error);
int spaghetti_config_apply(const struct spaghetti_config *candidate,
			   uint32_t expected_generation);
int spaghetti_config_get_snapshot(struct spaghetti_config *out,
				  uint32_t *generation);
```

Gli input `const` sono prestiti validi per la chiamata. Config copia il candidato solo
dopo successo. `out` appartiene al chiamante e cambia solo al successo. Le funzioni
restituiscono `0`, `-EINVAL`, `-ENOTSUP`, `-EEXIST`, `-EADDRINUSE` oppure l’errore del
componente durante apply/rollback.

### 3. Implementare validazione 1:N pura

Apri `subsys/config/config.c`. `spaghetti_config_validate()` controlla nell’ordine:

1. puntatore, versione e `module_count <= MAX`;
2. key nonzero e uniche;
3. Port esistenti, type string terminata, size entro il buffer;
4. driver esistente nel Registry;
5. `driver->ops->validate_config()` per ogni elemento;
6. `driver->ops->describe_endpoint()` per ogni elemento;
7. collisioni: stessa Port è valida; stessa Port + stesso kind/value è
   `-EADDRINUSE`; `PORT_EXCLUSIVE` confligge con qualunque altro elemento sulla Port;
8. sampling disabilitato oppure key sorgente presente e periodo nonzero.

Non confrontare l’intero `driver_config` con `memcmp()` per definire identità: padding e
campi non-endpoint non sono una chiave hardware. Usa l’endpoint normalizzato del driver.
La funzione non modifica Manager, Runtime, Storage o snapshot corrente.

### 4. Applicare e riconciliare per key

Implementa `spaghetti_config_apply()` con una copia del vecchio snapshot:

1. valida completamente il candidato;
2. per ogni vecchia key assente chiama remove sul suo runtime ID;
3. per una key nuova costruisce `spaghetti_module_request` con Port/type/config;
4. per una key esistente e invariata conserva il Module corrente;
5. per una key esistente con Port, type, endpoint o config cambiati esegue
   remove+configure della sola key;
6. dopo le configure risolve `source_key` con
   `spaghetti_module_manager_get_by_key()`; in questa fase verifica così che il
   Module sia vivo, mentre il passaggio del runtime ID al Runtime verrà aggiunto nel
   task 120, quando quel componente esisterà;
7. committa la copia Config solo dopo tutti i successi;
8. su errore ricrea esattamente lo snapshot precedente per key. Non rimuove mai tutti i
   Module di una Port come scorciatoia.

### 5. Costruire la Config positiva minima 1:N

In `src/main.c` o `subsys/core/core.c`, solo come harness temporaneo, costruisci due
INA219 sulla stessa Port:

```c
static const struct spaghetti_config initial_config = {
	.version = SPAGHETTI_CONFIG_VERSION,
	.module_count = 2U,
	.modules = {
		{
			.key = 10U,
			.port_id = 0U,
			.type_id = "ina219",
			.driver_config_size = sizeof(struct spaghetti_ina219_config),
		},
		{
			.key = 11U,
			.port_id = 0U,
			.type_id = "ina219",
			.driver_config_size = sizeof(struct spaghetti_ina219_config),
		},
	},
	.sampling = {
		.enabled = true,
		.source_key = 10U,
		.period_ms = 1000U,
	},
};
```

Poiché `driver_config` è un byte array, costruisci la variabile non-const in una
funzione e usa `memcpy()` per copiare config INA219 `0x40` e `0x41` nei due elementi.
Non fare cast di inizializzatori dentro l’array e non conservare puntatori alle struct
locali.

## Perché è fatto così

La Port descrive il percorso fisico condiviso; la key descrive il desired Module;
l’endpoint descrive la risorsa hardware selezionata dai parametri del driver. Config
può quindi rappresentare molti Module sulla stessa Port e riconciliare soltanto quello
cambiato. Array e limiti fissi mantengono RAM e tempi prevedibili senza heap.

## Come si usa

```c
struct spaghetti_config candidate;
struct spaghetti_config current;
uint32_t generation;
build_two_ina219_config(&candidate);
int err = spaghetti_config_validate(&candidate, NULL);
if (err == 0) {
	err = spaghetti_config_get_snapshot(&current, &generation);
}
if (err == 0) {
	err = spaghetti_config_apply(&candidate, generation);
}
```

## Checklist di completamento

- [x] Ogni Module Config ha una key stabile e config bounded generica.
- [x] Port ripetute sono accettate.
- [x] Key duplicate ed endpoint collidenti sono rifiutati.
- [x] Sampling riferisce una key, non una Port o un vecchio runtime ID.
- [x] Apply e rollback operano per key e preservano i fratelli sulla Port.
- [x] Due INA219 `0x40`/`0x41` vengono applicati insieme.

## Verifica e fine task

```sh
make validate
make pristine
make flash
make monitor
```

Prova due Port uguali con address diversi (successo), key duplicata, address duplicato,
source key assente e secondo init fallito. Dopo ogni fallimento snapshot e Module
precedenti devono restare invariati.
