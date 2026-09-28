# TASK-110-01 — Distribuire i campioni con zbus

**Stato:** ✅ DONE
**Fase:** 110 — Data / zbus

## Cosa devo fare

### 1. Definire il messaggio elettrico

Apri `include/spaghetti/data.h` e scrivi:

```c
struct spaghetti_electrical_message {
	spaghetti_module_id_t source_id;
	spaghetti_module_key_t source_key;
	int32_t bus_voltage_microvolts;
	int32_t current_microamps;
	uint32_t power_microwatts;
	int64_t timestamp_ms;
	uint32_t sequence;
};

struct spaghetti_data_stats {
	uint32_t published;
	uint32_t rejected;
	uint32_t delivery_errors;
};

int spaghetti_data_init(void);
int spaghetti_data_publish_electrical(
	const struct spaghetti_electrical_message *message,
	k_timeout_t timeout);
int spaghetti_data_get_stats(struct spaghetti_data_stats *out);
```

La struct è pubblica, priva di puntatori e viene copiata:

- `source_id` identifica l’istanza Module, non il tipo INA219;
- `source_key` identifica stabilmente l’elemento Config anche se l’ID cambia al reboot;
- voltage/current/power usano le stesse microunità di `spaghetti_sample`;
- current è firmata perché INA219 è bidirezionale;
- `timestamp_ms` è l’uptime Zephyr al momento della misura;
- `sequence` cresce a ogni pubblicazione e può fare wrap da `UINT32_MAX` a zero.

`message` è un prestito `const` valido per la chiamata: Data lo legge e zbus ne copia
il contenuto. `timeout` è un piccolo valore kernel passato per valore e limita l’attesa.
La funzione restituisce `0`, `-EINVAL` o l’errno di `zbus_chan_pub()`.
`spaghetti_data_get_stats()` copia nel buffer del chiamante i tre contatori atomici;
`out` non può essere `NULL`, non viene conservato e cambia solo al successo.

### 2. Abilitare zbus

Apri `prj.conf` e aggiungi:

```conf
CONFIG_ZBUS=y
CONFIG_ZBUS_MSG_SUBSCRIBER=y
CONFIG_ZBUS_PREFER_DYNAMIC_ALLOCATION=n
CONFIG_ZBUS_MSG_SUBSCRIBER_BUF_ALLOC_STATIC=y
CONFIG_ZBUS_MSG_SUBSCRIBER_NET_BUF_POOL_SIZE=8
CONFIG_ZBUS_MSG_SUBSCRIBER_NET_BUF_STATIC_DATA_SIZE=64
```

zbus è il bus di messaggi interno di Zephyr. Un channel ha un tipo fisso; un message
subscriber possiede una FIFO che riceve copie. Le FIFO condividono 8 buffer statici da
64 byte e non usano heap. Le dichiarazioni e la capacità sono statiche a build-time,
mentre publish e receive avvengono a runtime.

### 3. Creare canale e subscriber

Apri `subsys/data/data.c` e aggiungi:

```c
ZBUS_MSG_SUBSCRIBER_DEFINE(electrical_logger_subscriber);
ZBUS_MSG_SUBSCRIBER_DEFINE_WITH_ENABLE(electrical_test_subscriber, false);

ZBUS_CHAN_DEFINE(
	spaghetti_electrical_chan,
	struct spaghetti_electrical_message,
	NULL,
	NULL,
	ZBUS_OBSERVERS(electrical_logger_subscriber,
		       electrical_test_subscriber),
	ZBUS_MSG_INIT(0)
);
```

Il channel copia l’intera struct. I subscriber hanno FIFO indipendenti, ma in Zephyr
4.4 condividono il pool bounded di `net_buf`. Il subscriber di test parte disabilitato:
se fosse abilitato senza un consumer nel firmware normale, tratterrebbe copie fino a
saturare il pool. Il test lo abilita soltanto mentre lo consuma. I `NULL` indicano che
qui non servono validator zbus o user data; la validazione resta nell’API Data.

### 4. Implementare init e publish

Sempre in `subsys/data/data.c`, implementa:

1. `spaghetti_data_init()`: azzera contatori/diagnostica privati e restituisce `0`;
   Core la chiama una volta al boot e non modifica dati del chiamante.
2. `spaghetti_data_publish_electrical(message, timeout)`: rifiuta `NULL`, poi chiama
   `zbus_chan_pub(&spaghetti_electrical_chan, message, timeout)`. Non conserva il
   puntatore. Propaga `-EBUSY`, `-EAGAIN` e `-ENOMEM` quando channel o pool non accettano
   entro il timeout. Incrementa un contatore diagnostico sugli errori.

Apri `CMakeLists.txt` e aggiungi `subsys/data/data.c` alle sorgenti; apri
`subsys/core/core.c` e chiama `spaghetti_data_init()` durante il boot.

### 5. Pubblicare il sample INA219 senza dipendenza concreta

Apri il chiamante che esegue la lettura periodica (`src/main.c` fino alla fase 120).
Dopo `spaghetti_module_manager_read()` riuscita, scrivi:

```c
const struct spaghetti_electrical_message message = {
	.source_id = module_id,
	.source_key = module_key,
	.bus_voltage_microvolts = sample.bus_voltage_microvolts,
	.current_microamps = sample.current_microamps,
	.power_microwatts = sample.power_microwatts,
	.timestamp_ms = k_uptime_get(),
	.sequence = sequence++,
};
int err = spaghetti_data_publish_electrical(&message, K_NO_WAIT);
```

Il publisher possiede `message` sullo stack fino al ritorno. I subscriber ricevono
copie. Data non include `ina219.h`: conosce solo il contratto elettrico pubblico.

Implementa il logger consumer perché estragga una copia dalla propria coda e chiami:

```c
LOG_INF("electrical seq=%u bus=%d uV current=%d uA power=%u uW",
	message.sequence,
	message.bus_voltage_microvolts,
	message.current_microamps,
	message.power_microwatts);
```

### 6. Provare fan-out e coda piena

Nel test/fake già usato dal progetto pubblica un messaggio noto e verifica che logger e
test subscriber ricevano la stessa `sequence` e gli stessi tre valori. Poi sospendi un
consumer, riempi la sua coda e pubblica con `K_NO_WAIT`: il producer non deve bloccarsi
indefinitamente e il contatore diagnostico deve registrare il drop/errore scelto.

## Perché è fatto così

Runtime produce dati più velocemente o più lentamente dei consumer. Copie limitate
evitano ownership ambigua e heap. Il messaggio descrive grandezze elettriche, quindi
logger e MQTT non dipendono dal driver concreto INA219.

## Come si usa

Runtime legge un `spaghetti_sample`, crea il messaggio e chiama publish. Logger, test e
più avanti MQTT ricevono ciascuno una copia dalla propria coda.

Due sample provenienti dalla stessa Port restano distinti tramite `source_id` e
`source_key`; Data non usa `port_id` come identità.

## Concetto Zephyr da sapere

`zbus_chan_pub()` copia il valore nel channel e notifica gli observer. Un message
subscriber usa internamente una `k_msgq`: capacità e timeout devono essere finiti. Non
pubblicare un puntatore a memoria temporanea come payload.

## Checklist di completamento

- [x] Messaggio e API hanno le firme mostrate.
- [x] Tutte le unità sono dichiarate nei nomi dei campi.
- [x] Source ID e key distinguono Module fratelli sulla stessa Port.
- [x] Channel e due subscriber sono statici e limitati.
- [x] Data non include il driver INA219.
- [x] La policy di coda piena è verificata.

## Verifica e fine task

```sh
make validate
make pristine
make flash
make monitor
```

Controlla copie identiche nei due consumer e righe reali con bus voltage/current/power.
Satura una coda con `K_NO_WAIT`: Runtime deve continuare e il risultato deve seguire la
policy documentata. Il task è finito quando Data espone soltanto il messaggio elettrico
definito qui e nessun vecchio channel del modulo di esempio precedente.
