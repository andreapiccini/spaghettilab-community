# TASK-200-01 — Comporre e avviare l’engine

**Stato:** ✅ DONE
**Fase:** 200 — Engine completo

## Concetto Zephyr da sapere

In Zephyr `main()` viene già eseguita in un thread. Può inizializzare il firmware e
restituire `0`: i thread della Shell, di Runtime e dei servizi continuano a vivere. Non
serve un `while (1)` vuoto in `main`, e non bisogna fare I2C in callback timer o ISR.

Una riconfigurazione ricevuta dalla Shell viene invece eseguita nel thread Shell. La
transazione deve essere limitata e serializzata con un `k_mutex`: il mutex protegge la
Config e la riconciliazione a runtime, non deve essere preso da ISR.

## Cosa devo fare

### 1. Rendere generica la Config dei Module

Apri `include/spaghetti/config.h`, `subsys/config/config.c` e
`subsys/config/config_cbor.c`. Sostituisci l’eventuale campo INA219 incorporato nella
Config interna con questo contenitore generico:

```c
#define SPAGHETTI_CONFIG_VERSION 3U
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

struct spaghetti_threshold_rule_config {
	bool enabled;
	spaghetti_module_key_t source_key;
	int32_t lower_current_microamps;
	int32_t upper_current_microamps;
	spaghetti_module_key_t relay_key;
	bool relay_on_above;
};

struct spaghetti_config {
	uint32_t version;
	size_t module_count;
	struct spaghetti_module_config modules[SPAGHETTI_CONFIG_MAX_MODULES];
	struct spaghetti_runtime_sampling_config sampling;
	struct spaghetti_threshold_rule_config threshold_rule;
	struct spaghetti_mqtt_config mqtt;
};
```

- `port_id` è un valore copiato perché identifica un connettore stabile e piccolo;
- `type_id` è un array posseduto dalla Config, non un puntatore a una stringa del
  decoder che smetterebbe di esistere dopo la chiamata;
- `driver_config` è un array di byte perché Config non deve includere gli header di
  INA219, Relay o futuri driver;
- `driver_config_size` dichiara quanti byte iniziali sono validi;
- `key` identifica stabilmente ogni elemento anche quando più elementi ripetono Port;
- `source_key` è persistente, mentre un Module ID viene assegnato dal Manager a runtime
  e può cambiare dopo reboot o riconfigurazione;
- `threshold_rule` usa due key persistenti; Config le traduce nei Module ID correnti
  prima di costruire `spaghetti_runtime_threshold_rule`;
- `mqtt` possiede host e topic in array terminati da NUL; non contiene credenziali.

Usa la `struct spaghetti_config` completa mostrata sopra al posto delle forme
intermedie dei task precedenti. È pubblica, priva di puntatori e interamente copiata da
Config. `struct spaghetti_mqtt_config` è già definita nell'API pubblica
`include/spaghetti/mqtt.h` e non va duplicata. Il decoder CBOR V0 continua ad accettare
il payload INA219 del task 150 con MQTT disabilitato; il decoder V1 aggiunge la mappa
MQTT. Entrambi costruiscono una
`struct spaghetti_ina219_config` temporanea e la copia in `driver_config`:

```c
temporary.modules[0].driver_config_size = sizeof(ina219_config);
memcpy(temporary.modules[0].driver_config,
	&ina219_config, sizeof(ina219_config));
```

Incrementa la versione dello snapshot interno e del record persistente. Non trattare i
64 byte come ABI di rete: ogni versione CBOR decodifica campi espliciti e produce la
config binaria richiesta dal driver compilato.

### 2. Completare la transazione Config

Apri `include/spaghetti/config.h` e usa queste firme finali:

```c
enum spaghetti_config_error_field {
	SPAGHETTI_CONFIG_ERROR_ROOT,
	SPAGHETTI_CONFIG_ERROR_MODULE,
	SPAGHETTI_CONFIG_ERROR_SAMPLING,
	SPAGHETTI_CONFIG_ERROR_THRESHOLD_RULE,
	SPAGHETTI_CONFIG_ERROR_MQTT,
};

enum spaghetti_config_error_reason {
	SPAGHETTI_CONFIG_ERROR_REQUIRED,
	SPAGHETTI_CONFIG_ERROR_RANGE,
	SPAGHETTI_CONFIG_ERROR_DUPLICATE,
	SPAGHETTI_CONFIG_ERROR_UNKNOWN_TYPE,
	SPAGHETTI_CONFIG_ERROR_INCONSISTENT,
};

struct spaghetti_config_error {
	enum spaghetti_config_error_field field;
	size_t index;
	enum spaghetti_config_error_reason reason;
};

int spaghetti_config_init(const struct spaghetti_config *defaults);
int spaghetti_config_validate(const struct spaghetti_config *candidate,
			      struct spaghetti_config_error *error);
int spaghetti_config_apply(const struct spaghetti_config *candidate,
			   uint32_t expected_generation);
int spaghetti_config_get_snapshot(struct spaghetti_config *out,
				  uint32_t *generation);
```

`defaults` e `candidate` sono prestiti `const` validi solo durante la chiamata; Config
ne conserva una copia. `error` è un output opzionale del chiamante e viene riempito con
campo, indice e motivo solo in caso di validazione fallita. I tre campi dell’errore
sono valori copiati e non contengono stringhe o puntatori con lifetime esterna.
`expected_generation` è
passato per valore e impedisce a due richieste concorrenti di sovrascriversi: restituisci
`-ESTALE` se non coincide. `out` e `generation` ricevono copie coerenti.

In `subsys/config/config.c` implementa `spaghetti_config_apply()` in questo ordine:

1. valida tutto il candidato senza effetti collaterali;
2. prende il mutex Config e controlla `expected_generation`;
3. copia snapshot e generazione correnti per il rollback;
4. legge lo stato Runtime e lo ferma con timeout se era RUNNING;
5. rimuove dal Manager le istanze non più richieste;
6. per ogni key nuova o cambiata costruisce un `spaghetti_discovery_result`, copia key
   e `driver_config_size` byte e chiama
   `spaghetti_discovery_submit_manual()`;
7. risolve con `spaghetti_module_manager_get_by_key()` i nuovi Module ID e carica il
   programma Runtime usando quei valori runtime;
8. applica le sezioni di servizio già presenti, incluso MQTT quando abilitato;
9. salva il candidato con `spaghetti_storage_write_config()`;
10. solo dopo tutti i successi copia il nuovo snapshot, incrementa la generazione e
    avvia Runtime se il nuovo sampling è abilitato;
11. a ogni errore ripristina moduli, programma Runtime e servizi dallo snapshot copiato,
    riscrive il vecchio record se il nuovo era già stato salvato, non cambia generazione
    e restituisce l’errore originale; se anche il rollback fallisce, restituisce `-EIO`
    e registra entrambi gli errori.

Per il cambio MQTT a runtime, apri `include/spaghetti/mqtt.h` e
`subsys/services/mqtt/mqtt.c` e conserva l'API già implementata:

```c
int spaghetti_mqtt_init(const struct spaghetti_mqtt_config *config);
```

`config` è un prestito `const` copiato dal servizio e valido solo durante la chiamata.
La funzione è chiamata da Config con MQTT fermo, valida host/porta/topic, sostituisce la
copia privata e restituisce `0`, `-EINVAL` o `-EBUSY`. La transazione Config esegue
`stop → init → start` quando cambia MQTT e ripristina la configurazione precedente
se uno dei passaggi successivi fallisce.

Il Manager resta l’unico proprietario delle `struct spaghetti_module`; Config conserva
solo descrizioni e ID Port. Non mantenere puntatori ai buffer del candidato, ai
risultati Discovery o agli slot Manager.

### 3. Completare bootstrap e start in Core

Apri `include/spaghetti/core.h` e conserva queste firme pubbliche:

```c
int spaghetti_core_init(void);
int spaghetti_core_start(void);
enum spaghetti_core_state spaghetti_core_get_state(void);
```

Apri `subsys/core/core.c`. Crea una Config vuota privata, sicura anche quando INA219
non è collegato:

```c
static const struct spaghetti_config empty_config = {
	.version = SPAGHETTI_CONFIG_VERSION,
	.module_count = 0U,
	.sampling = {
		.enabled = false,
		.source_key = 0U,
		.period_ms = 1000U,
	},
};

static struct spaghetti_config startup_config;
static bool startup_config_present;
```

La Config vuota è `static` perché appartiene solo a Core e `const` perché viene usata
come valore di fallback, mai modificata. `startup_config` è invece una copia privata
scritta da Storage e valida per tutta l’inizializzazione; il bool dice se va applicata
durante start. Nessuna delle due contiene puntatori.

Implementa `spaghetti_core_init()` passo-passo:

1. passa da UNINITIALIZED a INITIALIZING;
2. inizializza Port, Power solo se la board lo espone, Driver Registry e Module Manager;
3. inizializza Data e Runtime, senza avviare il timer;
4. inizializza Storage;
5. inizializza Discovery con il sink che inoltra richieste al Manager;
6. chiama `spaghetti_config_init(&empty_config)`;
7. legge Storage in `startup_config`; `-ENOENT` significa primo avvio e lascia
   `startup_config_present = false`, mentre un record corrotto viene segnalato e lascia
   attiva la Config vuota;
8. se la lettura e la validazione riescono imposta `startup_config_present = true`, ma
   non applicare ancora lo snapshot e non avviare thread asincroni dentro init;
9. inizializza Wi-Fi Profiles dopo Settings: il servizio carica le credenziali senza
   inserirle nella Config e avvia la selezione automatica nella propria thread;
10. inizializza Communication per rendere disponibile la Shell seriale, inclusi i
    comandi di provisioning Wi-Fi;
11. inizializza gli adattatori opzionali configurati e passa a READY.

Un errore di infrastruttura obbligatoria porta Core a FAILED e viene restituito.
L’assenza di una Config o di un modulo rimovibile non è un errore di infrastruttura.

Implementa `spaghetti_core_start()` così:

1. accetta solo lo stato READY;
2. legge la generazione Config corrente e, se `startup_config_present`, chiama
   `spaghetti_config_apply(&startup_config, generation)`; se il modulo salvato non è
   fisicamente presente, registra l’errore, mantiene live la Config vuota e continua
   ad accettare nuove richieste senza sovrascrivere Storage;
3. se non esiste uno snapshot, lascia Runtime e MQTT fermi: è il normale stato idle;
4. passa a RUNNING quando l’infrastruttura è disponibile. Runtime e MQTT sono già stati
   avviati dalla transazione Config soltanto se abilitati.

`spaghetti_core_get_state()` restituisce l’enum per valore e non modifica nulla. Le tre
funzioni sono chiamate dal main thread; Core coordina l’ordine ma non possiede Module,
socket, code o thread degli altri componenti.

### 4. Ridurre main al vero entry point

Apri `src/main.c` e sostituisci ogni prova diretta di Port, INA219, Manager, Config,
Runtime o MQTT con questo contenuto logico:

```c
#include <zephyr/logging/log.h>

#include <spaghetti/core.h>

LOG_MODULE_REGISTER(spaghetti_app, LOG_LEVEL_INF);

int main(void)
{
	int err = spaghetti_core_init();

	if (err < 0) {
		LOG_ERR("Spaghetti LAB initialization failed: %d", err);
		return err;
	}

	err = spaghetti_core_start();
	if (err < 0) {
		LOG_ERR("Spaghetti LAB start failed: %d", err);
		return err;
	}

	LOG_INF("Spaghetti LAB engine running");
	return 0;
}
```

`err` è locale e passato per valore. `main()` non conserva oggetti, non legge sensori,
non dorme e non contiene un loop: dopo il ritorno, Zephyr continua a eseguire i thread
già avviati.

### 5. Collegare una nuova Config ricevuta

Apri `subsys/communication/communication.c`. Nell’handler SET_CONFIG esegui soltanto:

1. decodifica i byte in una `struct spaghetti_config candidate` locale;
2. ottieni snapshot/generazione correnti;
3. chiama `spaghetti_config_apply(&candidate, generation)`;
4. restituisce l’errno nella risposta con lo stesso correlation ID.

Communication possiede la richiesta solo durante il dispatch. Il decoder non applica;
Config non interpreta CBOR; il Manager non conosce Shell o MQTT.

Per la rimozione, Config confronta le key: una key omessa ferma il relativo lavoro,
chiama `spaghetti_module_manager_remove()` e lascia intatti gli altri Module sulla
stessa Port. Una Config con `module_count = 0` li rimuove tutti. Per una
presenza fisica automatica usa soltanto
`spaghetti_discovery_scan_port(port_id, timeout)` e
`spaghetti_discovery_invalidate(key, generation)` da un provider reale. Se la board
non ha presence pin, EEPROM o probe identificativo verificato, queste API restituiscono
`-ENOTSUP`: non scandire indirizzi I2C fingendo di conoscere il tipo del modulo.

## Perché è fatto così

Core decide l’ordine di vita, Config possiede il desired state, Discovery normalizza
l’origine dell’assegnazione, Manager possiede i Module, Runtime usa soltanto ID e Data,
Communication riceve nuove configurazioni. La Config vuota rende il Core utilizzabile
anche senza INA219; il payload driver generico permette di aggiungere nuovi tipi senza
modificare Config, Manager, Core o Runtime.

## Come si usa

Dopo il boot esegui `spaghetti status`. Collega INA219 e invia con
`spaghetti apply <hex>` il payload CBOR valido del task 150. Communication lo decodifica,
Config lo applica, Discovery lo normalizza, Manager crea il Module e Runtime inizia a
pubblicare campioni. Invia poi una Config valida con array moduli vuoto per rimuoverlo.

Per aggiungere in futuro un nuovo tipo: implementa il suo Module Driver, registra il
descrittore, aggiungi al codec la variante CBOR che produce i byte della sua config e
invia il nuovo `type_id`. Nessuna modifica deve essere necessaria in Core, Manager,
Runtime o Data se il nuovo modulo usa contratti già esistenti.

## Checklist di completamento

- [x] La Config interna usa type ID e driver config bounded generici.
- [x] Apply è serializzata, generazionale e ripristina lo stato precedente su errore.
- [x] Core inizializza tutte le dipendenze nell’ordine indicato.
- [x] Boot senza Config o INA219 arriva a RUNNING e accetta comandi.
- [x] `main()` contiene soltanto init, start, log degli errori e ritorno.
- [x] I test riconciliano due endpoint sulla stessa Port e ne rimuovono uno.
- [x] Discovery automatico resta disabilitato senza un provider hardware reale.

## Verifica e fine task

```sh
make validate
make pristine
make flash
make monitor
```

Controlla prima il boot senza INA219: deve comparire `Spaghetti LAB engine running` e
`spaghetti status` deve rispondere. Collega due moduli a `0x40`/`0x41`, invia la Config
CBOR e verifica entrambi. Cambia il periodo senza reboot, invia un payload errato e
verifica che il periodo precedente continui, quindi ometti solo key 11: key 10 deve
continuare sulla stessa Port. Riavvia e controlla lo snapshot persistito.

Il task è finito quando `main` non contiene logica applicativa e l’intero ciclo
Config → Discovery → Manager → driver → Runtime → Data funziona a firmware acceso.
