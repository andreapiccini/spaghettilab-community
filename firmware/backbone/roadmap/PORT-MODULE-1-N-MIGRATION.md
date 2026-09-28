# Migrazione architetturale: una Port, più Module

[← Indice roadmap](README.md) · [Architettura](../ARCHITECTURE.md)

**Stato:** ✅ IMPLEMENTATA

## Problema corretto

La roadmap precedente usava la Port sia come connessione fisica sia come identità del
Module. Da questa sovrapposizione derivavano quattro regole errate:

1. una Port veniva marcata occupata dopo il primo Module;
2. `get_by_port()` prometteva un solo risultato;
3. Config rifiutava due elementi con lo stesso `port_id`;
4. Discovery conservava una sola proposta e una sola generazione per Port.

Una Port I2C è invece un accesso condiviso al controller. INA219 `0x40`, INA219 `0x41`
e INA219 `0x44` sono tre istanze diverse sulla stessa Port 0. La Port serializza le
transazioni sul bus; non possiede né limita il numero di Module.

## Nuovo modello

### Identità logica e identità hardware

Ogni elemento Config riceve una chiave stabile non nulla:

```c
typedef uint32_t spaghetti_module_key_t;
```

La `module_key` identifica l’elemento desiderato fra reboot e riconciliazioni. Non è il
Module ID: `spaghetti_module_id_t` resta un handle runtime assegnato dal Manager e può
cambiare quando uno slot viene ricreato.

Il driver traduce la propria Config in un endpoint confrontabile:

```c
enum spaghetti_module_endpoint_kind {
	SPAGHETTI_ENDPOINT_PORT_EXCLUSIVE,
	SPAGHETTI_ENDPOINT_I2C_ADDRESS,
	SPAGHETTI_ENDPOINT_SPI_CHIP_SELECT,
};

struct spaghetti_module_endpoint {
	enum spaghetti_module_endpoint_kind kind;
	uint32_t value;
};
```

Per INA219 `kind` è `I2C_ADDRESS` e `value` è l’indirizzo 7-bit. Due Module possono
condividere `port_id` se gli endpoint non collidono. Un endpoint `PORT_EXCLUSIVE`
confligge con qualsiasi altra istanza sulla stessa Port. Due endpoint con stesso
`port_id`, `kind` e `value` confliggono anche se i `type_id` sono diversi.

La coppia chiave/tuple ha due scopi diversi:

- `module_key` è il riferimento stabile usato da Config, regole e Discovery;
- Port + driver + Config normalizzata descrivono l’istanza fisica; l’endpoint estratto
  dai parametri impedisce di rappresentare due volte lo stesso dispositivo.

### Context deterministico senza buffer universale

`SPAGHETTI_MODULE_CONTEXT_SIZE` viene eliminato. Una dimensione massima globale spreca
RAM per i driver piccoli, deve cambiare quando arriva un driver più grande e accoppia il
Manager ai dettagli privati dei driver.

Ogni driver definisce invece un pool statico tipizzato, preferibilmente con
`K_MEM_SLAB_DEFINE`:

```c
struct ina219_context {
	const struct device *i2c;
	struct spaghetti_ina219_config config;
	uint16_t calibration;
	bool initialized;
};

K_MEM_SLAB_DEFINE(ina219_context_slab,
		  sizeof(struct ina219_context),
		  CONFIG_SPAGHETTI_INA219_MAX_INSTANCES,
		  __alignof__(struct ina219_context));
```

`init()` alloca con `k_mem_slab_alloc(..., K_NO_WAIT)`, copia la Config e assegna
`module->context` solo dopo la validazione. `deinit()` azzera i dati sensibili, libera
il blocco e rimette il puntatore a `NULL`. Un fallimento parziale di `init()` libera il
blocco prima di restituire. La capacità è nota a build-time, il tempo è limitato e non
c’è heap né frammentazione.

Il Manager conserva un pool statico di soli slot Module:

```c
struct spaghetti_module_slot {
	bool used;
	bool reserved;
	bool busy;
	spaghetti_port_id_t port_id;
	uint32_t revision;
	struct spaghetti_module module;
};

static struct spaghetti_module_slot slots[CONFIG_SPAGHETTI_MAX_MODULES];
```

`reserved` impedisce collisioni durante init; `busy` serializza read/remove della
singola istanza mentre il mutex non viene trattenuto durante l'I/O. Nessuno dei due
flag è visibile fuori dal Manager.

### API Manager finali

```c
struct spaghetti_module_request {
	spaghetti_module_key_t key;
	spaghetti_port_id_t port_id;
	const char *type_id;
	const void *driver_config;
	size_t driver_config_size;
	uint32_t revision;
};

int spaghetti_module_manager_configure(
	const struct spaghetti_module_request *request,
	spaghetti_module_id_t *out_id);
int spaghetti_module_manager_remove(spaghetti_module_id_t id,
				    uint32_t expected_revision);
int spaghetti_module_manager_get_by_id(
	spaghetti_module_id_t id,
	struct spaghetti_module_snapshot *out);
int spaghetti_module_manager_get_by_key(
	spaghetti_module_key_t key,
	struct spaghetti_module_snapshot *out);
int spaghetti_module_manager_list_by_port(
	spaghetti_port_id_t port_id,
	struct spaghetti_module_snapshot *out,
	size_t capacity,
	size_t *out_count);
```

`get_by_port()` viene rimosso perché il suo risultato singolo è ambiguo. Le letture e i
comandi continuano a usare il Module ID runtime. Config e Runtime risolvono riferimenti
persistenti con `get_by_key()`; diagnostica e UI usano `list_by_port()`.

### Operazioni pure richieste al driver

```c
int (*validate_config)(const void *config, size_t config_size);
int (*describe_endpoint)(const void *config, size_t config_size,
			 struct spaghetti_module_endpoint *out);
```

Queste callback non accedono all’hardware e non modificano stato. Permettono a Config e
Manager di validare dimensione, range e collisioni prima di occupare uno slot o
allocare un context. Registry rifiuta un driver privo di queste operazioni.

## Modifiche applicate

| Area | Implementazione verificata |
|---|---|
| Tipi pubblici | `module.h` distingue key persistente, ID runtime, Port ed endpoint. |
| Module Driver | `validate_config()` e `describe_endpoint()` sono callback pure obbligatorie. |
| Module Manager | Slot privati, query per key e lista 0:N per Port; nessun `get_by_port()` singolare. |
| Collisioni | Stessa key o stesso endpoint sulla stessa Port vengono rifiutati; indirizzi diversi sono indipendenti. |
| Endpoint esclusivo | `PORT_EXCLUSIVE` confligge con qualunque endpoint della Port, in entrambi gli ordini. |
| Context | INA219 e Relay usano slab statici tipizzati, senza buffer universale o heap. |
| INA219 runtime | Device I2C dalla Port e indirizzo dalla Config; nessun nodo INA219 statico. |
| Registry | Catalogo fisso, type ID unici e descrittori completi validati prima dell’uso. |
| Config e Discovery | Desired state e proposte indicizzati per key; più record ripetono `port_id`. |
| Runtime e Communication | Riferimenti persistenti per key e diagnostica 0:N per Port. |

La migrazione è stata completata progressivamente nelle fasi 050–200.
`tests/module_manager` verifica tre endpoint simultanei, collisioni e rimozione di un
solo fratello. `tests/ina219_runtime` usa due istanze vere del driver INA219 sullo
stesso device I2C fake con indirizzi e context separati. `tests/config` e
`tests/discovery` verificano riconciliazione e generazioni per key.

## Flusso runtime 1:N

1. Port 0 espone un controller I2C condiviso e un lock di transazione.
2. Config contiene tre chiavi distinte con Port 0 e config driver `0x40`, `0x41`,
   `0x44`.
3. Discovery produce tre eventi UPSERT distinti, indicizzati per chiave.
4. Manager risolve driver e Port per ogni richiesta.
5. `describe_endpoint()` produce tre endpoint I2C distinti; nessuna Port è occupata.
6. Manager riserva tre slot Module e ogni driver riserva un blocco dal proprio slab.
7. Le tre init accedono allo stesso device I2C attraverso Port, una transazione alla
   volta, e diventano READY indipendentemente.
8. Runtime risolve le chiavi nei Module ID correnti e richiede read/command per ID.
9. Ogni driver acquisisce il bus tramite Port, usa il proprio address e restituisce il
   proprio sample.
10. Una Config che rimuove solo la chiave del Module `0x41` esegue deinit e libera quel
    context/slot; `0x40` e `0x44` restano READY sulla stessa Port.

## Checklist finale

- [x] Nessuna Port contiene flag occupied o owner Module.
- [x] Nessuna API pubblica restituisce un solo Module per Port.
- [x] Key stabile e ID runtime sono tipi e responsabilità differenti.
- [x] Collisioni calcolate con Port ed endpoint normalizzato.
- [x] Endpoint I2C distinti convivono sulla stessa Port.
- [x] Endpoint esclusivo e condiviso confliggono in entrambi gli ordini.
- [x] Ogni driver possiede un pool context tipizzato e bounded.
- [x] Config, Discovery, Runtime e Communication conservano la cardinalità 1:N.
- [x] Registry rifiuta type ID duplicati e descrittori incompleti.

## Verifica

```sh
./validator
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests -p native_sim/native/64 --inline-logs --clobber-output'
make pristine
```

Il validator deve terminare senza errori, tutti i test native devono passare e la build
ESP32-C3 deve includere gli stessi sorgenti elencati dal CMake applicativo.
