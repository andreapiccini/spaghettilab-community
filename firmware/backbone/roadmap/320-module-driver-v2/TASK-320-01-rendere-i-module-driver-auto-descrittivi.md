# TASK-320-01 — Rendere i Module Driver auto-descrittivi

**Stato:** ✅ DONE
**Fase:** 320 — Module Driver V2

## Cosa devo fare

### 1. Sostituire config/sample/comando specifici nel contratto

Apri `include/spaghetti/module_driver.h` e usa `spaghetti_property_set`,
`spaghetti_record` e `spaghetti_module_command` della fase 310:

```c
typedef int (*spaghetti_module_validate_config_cb_t)(
	const struct spaghetti_property_set *config);
typedef int (*spaghetti_module_describe_endpoint_cb_t)(
	const struct spaghetti_property_set *config,
	struct spaghetti_module_endpoint *out);
typedef int (*spaghetti_module_init_cb_t)(
	struct spaghetti_module *module,
	const struct spaghetti_property_set *config);
typedef int (*spaghetti_module_read_cb_t)(
	struct spaghetti_module *module,
	struct spaghetti_record_payload *out);
typedef int (*spaghetti_module_command_cb_t)(
	struct spaghetti_module *module,
	const struct spaghetti_module_command *command);
typedef int (*spaghetti_module_event_cb_t)(
	const struct spaghetti_record_payload *payload,
	void *user_data);
typedef int (*spaghetti_module_start_cb_t)(
	struct spaghetti_module *module,
	spaghetti_module_event_cb_t emit,
	void *emit_user_data);
typedef int (*spaghetti_module_stop_cb_t)(struct spaghetti_module *module);
typedef int (*spaghetti_module_deinit_cb_t)(struct spaghetti_module *module);
```

`read()` produce un record caller-owned scritto solo al successo. `start()` è
opzionale per pulsanti/IRQ/stream: il driver può conservare callback e context fino a
`stop()`, ma la invoca soltanto da thread/workqueue, mai da ISR. `stop()` deve impedire
callback future prima di restituire. `command()` è sincrona e borrowed.

La operation table diventa:

```c
struct spaghetti_module_driver_ops {
	spaghetti_module_validate_config_cb_t validate_config;
	spaghetti_module_describe_endpoint_cb_t describe_endpoint;
	spaghetti_module_init_cb_t init;
	spaghetti_module_read_cb_t read;
	spaghetti_module_command_cb_t command;
	spaghetti_module_start_cb_t start;
	spaghetti_module_stop_cb_t stop;
	spaghetti_module_deinit_cb_t deinit;
};

struct spaghetti_module_driver {
	const char *type_id;
	uint16_t api_version;
	uint32_t required_capabilities;
	enum spaghetti_port_transport transport;
	struct spaghetti_module_power_requirement power_requirement;
	const struct spaghetti_schema_descriptor *config_schema;
	const struct spaghetti_schema_descriptor *const *record_schemas;
	size_t record_schema_count;
	const struct spaghetti_command_descriptor *commands;
	size_t command_count;
	const struct spaghetti_module_driver_ops *ops;
};
```

`config_schema` è obbligatorio. Gli array record/command sono nullable soltanto con
count zero e relativa op NULL. Read/event possono dichiarare più schemi; ogni comando
ha il proprio argument schema. `start` e `stop` devono essere entrambi presenti o
entrambi NULL. `api_version` vale `SPAGHETTI_MODULE_DRIVER_API_VERSION` e impedisce di
accettare un plug-in con ABI incompatibile.

`transport` dice al Manager quale modo Port acquisire prima di `init()`; un driver non
riconfigura pin o controller. `power_requirement` è copiato nel descriptor immutabile:
se il datasheet non offre ancora dati verificati usa `declared=false`, mai valori
inventati. Su base passiva questo produce admission `UNVERIFIED`; su Core controllato
un requirement dichiarato viene applicato rigidamente dalla fase 305.

### 2. Eliminare la tabella centrale con iterable sections

Le iterable sections sono oggetti raccolti dal linker Zephyr a build-time. Il driver
definisce un descrittore; Registry itera la sezione senza conoscere il file concreto.
Zephyr 4.4 fornisce `STRUCT_SECTION_ITERABLE()` e
`STRUCT_SECTION_FOREACH()` in `<zephyr/sys/iterable_sections.h>`.

Nel public header aggiungi:

```c
#define SPAGHETTI_MODULE_DRIVER_DEFINE(name) \
	const STRUCT_SECTION_ITERABLE(spaghetti_module_driver, name)
```

In ogni driver scrivi:

```c
SPAGHETTI_MODULE_DRIVER_DEFINE(spaghetti_example_driver) = {
	.type_id = "example",
	.api_version = SPAGHETTI_MODULE_DRIVER_API_VERSION,
	.required_capabilities = SPAGHETTI_PORT_CAP_I2C,
	.transport = SPAGHETTI_PORT_TRANSPORT_I2C,
	.power_requirement = { .declared = false },
	.config_schema = &example_config_schema,
	.record_schemas = example_record_schemas,
	.record_schema_count = ARRAY_SIZE(example_record_schemas),
	.commands = NULL,
	.command_count = 0U,
	.ops = &example_ops,
};
```

Apri `subsys/driver_registry/driver_registry.c`: elimina include INA219/Relay e array
`drivers[]`. Init/find/count/get iterano la sezione, validano duplicati e mantengono
l'ordine non significativo. Un nuovo driver modifica soltanto la propria directory e
il CMake/Kconfig che lo abilita.

### 3. Migrare INA219 e Relay

Apri entrambi i driver. Definisci field ID nei rispettivi header:

```c
/* INA219 config */
SPAGHETTI_INA219_CONFIG_ADDRESS = 1,
SPAGHETTI_INA219_CONFIG_SHUNT_MILLIOHM = 2,
SPAGHETTI_INA219_CONFIG_CURRENT_LSB_MICROAMP = 3,

/* INA219 record */
SPAGHETTI_INA219_FIELD_BUS_VOLTAGE_MICROVOLTS = 1,
SPAGHETTI_INA219_FIELD_CURRENT_MICROAMPS = 2,
SPAGHETTI_INA219_FIELD_POWER_MICROWATTS = 3,

/* Relay config/command */
SPAGHETTI_RELAY_CONFIG_ACTIVE_HIGH = 1,
SPAGHETTI_RELAY_CONFIG_SAFE_ON = 2,
SPAGHETTI_RELAY_COMMAND_SET = 1,
SPAGHETTI_RELAY_COMMAND_FIELD_ON = 1,
```

INA219 usa `spaghetti_property_find()` per copiare valori validati nel context e
produce payload schema `spaghetti.ina219.sample`, version 1. Relay non dichiara record,
accetta command ID 1 con un BOOL field 1. Nessun file comune contiene più
`relay_on`, `bus_voltage_microvolts`, `current_microamps` o `power_microwatts`.

### 4. Aggiornare Module Manager

Apri header e `.c`. `spaghetti_module_request.driver_config` diventa una
`const struct spaghetti_property_set *config` e la request aggiunge la posizione e
la scelta power runtime:

```c
struct spaghetti_module_placement {
	spaghetti_bay_id_t bay_id;
	spaghetti_power_rail_id_t power_rail_id;
};
```

Il Flow deriva dalla Port tramite Topology. Entrambi gli ID possono essere
`UNSPECIFIED`; se la Bay è dichiarata deve esistere nel Flow e se la rail è dichiarata
serve anche una Bay. `configure()` presta properties a validate, endpoint e init,
acquisisce nell'ordine Port→Power→context e pubblica in snapshot placement e stato
admission. `read()` restituisce `struct spaghetti_record *`; `command()` riceve il
nuovo comando. Aggiungi:

```c
int spaghetti_module_manager_start_events(
	spaghetti_module_id_t id,
	spaghetti_module_event_cb_t emit,
	void *emit_user_data);
int spaghetti_module_manager_stop_events(spaghetti_module_id_t id);
```

Manager serializza start/stop/read/command/remove per istanza. Read verifica che il
payload prodotto corrisponda a uno degli schemi dichiarati. Remove chiama `stop()`
prima di `deinit()`. Se stop fallisce, non libera un context che potrebbe ancora
emettere callback; marca Module ERROR e restituisce l'errore. Callback e user_data sono
borrowed fino a stop e devono avere lifetime sufficiente.

### 5. Testare un driver aggiunto senza Registry centrale

Aggiorna test INA, Relay, Registry e Manager. Aggiungi nel solo test un driver
`example` tramite macro: deve comparire in count/find senza cambiare
`driver_registry.c`. Copri API version errata, schema incoerente, start senza stop,
evento dopo stop, config type/range errato e output immutato.

Per mantenere ogni fase compilabile, aggiorna anche i chiamanti di
`spaghetti_module_manager_read()` e `command()`. Fino alla fase 340, Runtime estrae i
tre field dello schema INA219 e alimenta il vecchio canale elettrico tramite un helper
privato `legacy_publish_ina219_record()`. Il helper accetta esclusivamente
`spaghetti.ina219.sample`, non entra in header pubblici ed è marcato con commento
`Removed by TASK-340-01`. Relay threshold usa il nuovo comando generico ma conserva
temporaneamente la regola attuale. La fase 340 elimina entrambi gli adapter; non
lasciare la build intermedia con firme incompatibili.

## Perché è fatto così

Il descrittore è il contratto completo del plug-in. Le iterable sections spostano la
registrazione nel file proprietario; gli schemi permettono a Config e client di
validare e descrivere il tipo senza switch centrali. Start/stop aggiunge eventi reali
senza fare I/O in ISR.

## Come si usa

Un nuovo driver crea schema, ops, descriptor e slab privata. CMake compila il file e
il Registry lo trova automaticamente. Il catalogo delle fasi successive enumera gli
stessi descrittori.

Questo percorso resta necessario per hardware, timing o algoritmi che richiedono C
nativo. I normali dispositivi descrivibili come transazioni e registri useranno invece
il solo driver generico e i Device Profile della fase 325, evitando un driver compilato
per ogni sensore.

## Checklist di completamento

- [x] Descriptor contiene API version e tre schemi coerenti.
- [x] Registry non include né elenca driver concreti.
- [x] INA219 e Relay usano proprietà/record/comandi generici.
- [x] Manager gestisce start/stop e impedisce callback dopo remove.
- [x] Manager acquisisce Port e Power prima di init e li rilascia in ordine inverso.
- [x] Snapshot espone Flow/Bay/rail e admission senza fingere controlli passivi.
- [x] Un driver test-only compare senza modifiche centrali.

## Verifica e fine task

```sh
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/driver_registry -T tests/module_manager \
  -T tests/ina219_runtime -T tests/relay -p native_sim/native/64 \
  --inline-logs --clobber-output'
make pristine
```

Il risultato atteso è comportamento INA219/Relay invariato e nessuna conoscenza dei
due tipi dentro Registry o Manager.
