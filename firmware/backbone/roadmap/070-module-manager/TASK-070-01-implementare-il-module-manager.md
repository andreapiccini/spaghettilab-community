# TASK-070-01 — Implementare il Module Manager

**Stato:** ✅ DONE
**Fase:** 070 — Module Manager

## Cosa devo fare

### 1. Correggere prima il codice parziale già presente

Apri `include/spaghetti/module_manager.h`. Rimuovi da questo header pubblico
`struct spaghetti_module_slot`, il buffer `driver_context` e
`SPAGHETTI_MODULE_CONTEXT_SIZE`: sono dettagli privati e il context sarà allocato dal
driver concreto nel task 080.

Apri `subsys/module_manager/module_manager.c`. Elimina il blocco che scorre gli slot e
restituisce `-EBUSY` quando `slots[i].module.port == port`. Quell’uguaglianza significa
solo che due Module condividono la connessione; non è una collisione.

### 2. Dichiarare request, snapshot e API 1:N

In `include/spaghetti/module_manager.h` scrivi:

```c
struct spaghetti_module_request {
	spaghetti_module_key_t key;
	spaghetti_port_id_t port_id;
	const char *type_id;
	const void *driver_config;
	size_t driver_config_size;
	uint32_t revision;
};

struct spaghetti_module_snapshot {
	spaghetti_module_id_t id;
	spaghetti_module_key_t key;
	spaghetti_port_id_t port_id;
	char type_id[SPAGHETTI_TYPE_ID_MAX];
	struct spaghetti_module_endpoint endpoint;
	enum spaghetti_module_state state;
	uint32_t revision;
};

int spaghetti_module_manager_init(void);
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
int spaghetti_module_manager_read(spaghetti_module_id_t id,
				  struct spaghetti_sample *out);
```

`request` è prestata per la chiamata; Manager non conserva `type_id` o config. `out_id`
e gli snapshot appartengono al chiamante e cambiano solo al successo. `key` e `revision`
sono valori copiati. Lo snapshot non espone puntatori a Port, driver, context o slot.

Rimuovi `spaghetti_module_manager_get_by_port()`: un risultato singolo è ambiguo.
`get_by_key()` serve Config/Runtime; `list_by_port()` serve diagnostica/UI.

### 3. Creare un pool statico di soli slot

In `module_manager.c` definisci:

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

Il pool è indipendente dal numero di Port. `reserved` protegge uno slot durante init e
partecipa ai controlli di collisione, ma non appare nelle query. `busy` impedisce che
read e remove operino contemporaneamente sulla stessa istanza mentre il mutex è
rilasciato durante l'I/O. `port_id` serve a creare snapshot senza esporre la struct Port
privata. In questa fase imposta il limite Kconfig a `8`: è capacità RAM, non cardinalità
hardware. `module.context` parte `NULL`; non creare union o byte array globali.

### 4. Implementare configure senza Port occupancy

Implementa `configure()` in questo ordine:

1. valida `request`, `out_id`, key nonzero, revision e puntatori/size;
2. risolve Port e driver;
3. verifica le capability richieste;
4. chiama `driver->ops->validate_config()`;
5. chiama `driver->ops->describe_endpoint()` in una variabile locale;
6. scorre gli slot usati: rifiuta la stessa key con `-EEXIST`; sulla stessa Port
   rifiuta endpoint `PORT_EXCLUSIVE` o stessa coppia kind/value con `-EADDRINUSE`;
   non rifiutare la sola uguaglianza della Port;
7. trova uno slot libero, altrimenti `-ENOSPC`;
8. prepara Module provvisorio con ID slot, key, Port, driver, endpoint, context `NULL`;
9. chiama `driver->ops->init()` con config/size originali;
10. solo al successo imposta READY, used/revision e `*out_id`.

Se `init()` fallisce, il suo contratto impone di liberare ogni context parzialmente
allocato; Manager azzera soltanto lo slot provvisorio. Gli altri Module sulla Port non
vengono toccati.

In questa fase lo shortcut statico INA219 accetta config nulla. Per provare due endpoint
diversi usa un fake driver test con `describe_endpoint()` configurabile; il test hardware
con due INA219 arriva nel task 080.

### 5. Implementare query, read e remove

- `get_by_id()` e `get_by_key()` copiano un solo snapshot sotto lock breve;
- `list_by_port()` conta tutti gli slot corrispondenti. Se `out == NULL` e capacity zero
  restituisce il count; se il buffer è piccolo restituisce `-ENOSPC`, scrive il count
  richiesto e non produce output parziale;
- `read(id, out)` seleziona per ID e chiama la read del driver READY;
- `remove(id, revision)` chiama deinit e azzera soltanto quello slot. Non libera la
  Port e non visita i suoi fratelli.

Manager serializza le mutazioni. Non tenere il lock durante callback driver se il
driver può rientrare; usa uno stato provvisorio/busy e rivalida al ritorno.

### 6. Integrare e provare cardinalità

Apri `CMakeLists.txt`, `subsys/core/core.c` e `src/main.c`. Core inizializza Manager dopo
Port e Registry. Il main temporaneo configura key 1/INA219 e legge per ID; verrà rimosso
da Config nel task 090.

Nel test fake configura:

```text
key 10 -> Port 0 -> I2C 0x40
key 11 -> Port 0 -> I2C 0x41
key 12 -> Port 0 -> I2C 0x44
```

Tutti e tre devono essere READY. Poi prova key duplicata, endpoint `0x40` duplicato,
pool pieno, init fallita e rimozione della sola key 11.

## Perché è fatto così

Il Manager possiede istanze, non connessioni fisiche. Key stabile e ID runtime separano
desired state e slot correnti; endpoint normalizzato impedisce collisioni reali senza
interpretare struct driver-specifiche. Il pool fisso limita RAM e numero totale di
Module, mentre Port e driver rimangono condivisibili.

## Come si usa

```c
struct spaghetti_module_request request = {
	.key = 10U,
	.port_id = 0U,
	.type_id = "ina219",
	.driver_config = &ina219_config,
	.driver_config_size = sizeof(ina219_config),
	.revision = 1U,
};
spaghetti_module_id_t id;
int err = spaghetti_module_manager_configure(&request, &id);
```

## Checklist di completamento

- [x] Rimuovere controllo Port occupata e context buffer globale.
- [x] Dichiarare request/snapshot con key ed endpoint.
- [x] Implementare pool statico indipendente dalle Port.
- [x] Configure accetta stessa Port con endpoint diversi.
- [x] Get-by-key e list-by-port sostituiscono get-by-port singolare.
- [x] Remove e rollback preservano i fratelli sulla stessa Port.
- [x] Testare tre endpoint, duplicati, capacità ed errori.

## Verifica e fine task

```sh
make validate
make pristine
docker compose run --rm --entrypoint sh dev -lc \
	'west build -p always -b native_sim/native/64 \
	-d build-tests/module_manager tests/module_manager -t run'
make flash
make monitor
```

Il task termina quando tre Module fake condividono Port 0, `list_by_port()` restituisce
tre snapshot e la rimozione del secondo lascia primo e terzo READY.

Verifica automatica completata con Zephyr 4.4 su `native_sim/native/64`: 1 suite,
1 test, 100% PASS. La verifica hardware resta facoltativa per questo task e appartiene
alla fase 080 per le due istanze INA219 reali.
