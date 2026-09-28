# TASK-050-01 — Introdurre Module e Module Driver

**Stato:** ✅ DONE
**Fase:** 050 — Module + Module Driver

## Cosa devo fare

### 1. Definire identità runtime, chiave stabile ed endpoint

Apri `include/spaghetti/module.h`. Prima dichiara in avanti `struct spaghetti_port` e
`struct spaghetti_module_driver`, poi scrivi:

```c
typedef uint8_t spaghetti_module_id_t;
typedef uint32_t spaghetti_module_key_t;

enum spaghetti_module_state {
	SPAGHETTI_MODULE_UNINITIALIZED,
	SPAGHETTI_MODULE_READY,
	SPAGHETTI_MODULE_ERROR,
};

enum spaghetti_module_endpoint_kind {
	SPAGHETTI_ENDPOINT_PORT_EXCLUSIVE,
	SPAGHETTI_ENDPOINT_I2C_ADDRESS,
	SPAGHETTI_ENDPOINT_SPI_CHIP_SELECT,
};

struct spaghetti_module_endpoint {
	enum spaghetti_module_endpoint_kind kind;
	uint32_t value;
};

struct spaghetti_module {
	spaghetti_module_id_t id;
	spaghetti_module_key_t key;
	enum spaghetti_module_state state;
	const struct spaghetti_port *port;
	const struct spaghetti_module_driver *driver;
	struct spaghetti_module_endpoint endpoint;
	void *context;
};
```

- `id` è l’handle runtime assegnato dal futuro Manager e può cambiare al reboot;
- `key` è nonzero, arriva da Config e identifica stabilmente un elemento desiderato;
- `port` è un prestito `const` al catalogo hardware e può essere condiviso da molti
  Module;
- `endpoint` distingue le istanze sulla stessa Port: per INA219 contiene l’indirizzo
  I2C 7-bit;
- `driver` punta al descrittore immutabile condiviso fra tutte le istanze dello stesso
  tipo;
- `context` è opaco e sarà posseduto dal pool statico del driver concreto, non dal
  Manager. In questa fase temporanea può restare `NULL`.

Non aggiungere `occupied` alla Port e non usare `port_id` come Module ID.

### 2. Definire sample e operazioni driver

Sempre in `module.h` conserva il sample elettrico copiabile:

```c
struct spaghetti_sample {
	int32_t bus_voltage_microvolts;
	int32_t current_microamps;
	uint32_t power_microwatts;
};
```

Apri `include/spaghetti/module_driver.h` e scrivi:

```c
struct spaghetti_module_driver_ops {
	int (*validate_config)(const void *config, size_t config_size);
	int (*describe_endpoint)(const void *config, size_t config_size,
				 struct spaghetti_module_endpoint *out);
	int (*init)(struct spaghetti_module *module,
		    const void *config, size_t config_size);
	int (*read)(struct spaghetti_module *module,
		    struct spaghetti_sample *out);
	int (*deinit)(struct spaghetti_module *module);
};

struct spaghetti_module_driver {
	const char *type_id;
	uint32_t required_capabilities;
	const struct spaghetti_module_driver_ops *ops;
};
```

`validate_config()` e `describe_endpoint()` sono pure: non toccano hardware, Module o
context. Il Manager le userà prima del commit. `init()` può modificare Module/context;
`read()` scrive l’output solo al successo; `deinit()` rilascia soltanto quella istanza.

### 3. Adattare temporaneamente INA219

Apri `spaghetti_modules/ina219/ina219.h` e dichiara soltanto qui:

```c
extern const struct spaghetti_module_driver spaghetti_ina219_driver;
```

Apri `spaghetti_modules/ina219/ina219.c`. Aggiungi le due callback pure. Poiché fino al
task 080 INA219 proviene ancora dal nodo Devicetree statico, entrambe accettano solo
`config == NULL` e `config_size == 0U`; `describe_endpoint()` scrive endpoint I2C e
l’indirizzo del nodo statico. Marca questo ramo `TEMPORARY SHORTCUT`.

Definisci la tabella e il descrittore:

```c
static const struct spaghetti_module_driver_ops ina219_ops = {
	.validate_config = ina219_validate_config,
	.describe_endpoint = ina219_describe_endpoint,
	.init = spaghetti_ina219_init,
	.read = spaghetti_ina219_read,
	.deinit = spaghetti_ina219_deinit,
};

const struct spaghetti_module_driver spaghetti_ina219_driver = {
	.type_id = "ina219",
	.required_capabilities = SPAGHETTI_PORT_CAP_I2C,
	.ops = &ina219_ops,
};
```

Il descrittore non contiene address o stato mutabile: lo stesso oggetto servirà in
seguito INA219 `0x40` e `0x41` contemporaneamente.

### 4. Usare la tabella operazioni nel main temporaneo

Apri `src/main.c` e costruisci una sola istanza di bring-up con `key = 1U`, Port 0,
driver INA219 ed endpoint restituito da `describe_endpoint()`. Chiama nell’ordine
validate, describe, init, read e deinit. Questa singola istanza dimostra il contratto,
non limita la Port: il task 070 la sostituirà con il pool Manager.

## Perché è fatto così

Port, chiave, runtime ID ed endpoint rispondono a domande diverse. Separarli permette a
tre Module di condividere Port 0 senza confondere le loro identità. Le callback pure
consentono di scoprire collisioni prima di accedere all’hardware. Il context opaco evita
che il Manager conosca la dimensione privata di ogni driver.

## Come si usa

```c
struct spaghetti_module_endpoint endpoint;
int err = spaghetti_ina219_driver.ops->describe_endpoint(NULL, 0U, &endpoint);
if (err == 0) {
	err = spaghetti_ina219_driver.ops->read(&module, &sample);
}
```

## Checklist di completamento

- [x] Module distingue ID runtime, key stabile, Port ed endpoint.
- [x] Port è documentata come riferimento condivisibile.
- [x] Driver espone validate/describe/init/read/deinit.
- [x] Il descrittore INA219 non contiene stato per istanza.
- [x] Il main definitivo non dipende direttamente da INA219.

## Verifica e fine task

```sh
make validate
make pristine
make flash
make monitor
```

Controlla endpoint `I2C_ADDRESS/0x40`, lettura reale e gestione dei puntatori nulli.
Il task termina quando non esiste alcuna regola “un Module per Port” nei tipi pubblici.
