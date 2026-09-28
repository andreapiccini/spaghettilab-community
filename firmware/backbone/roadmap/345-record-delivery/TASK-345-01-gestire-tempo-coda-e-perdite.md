# TASK-345-01 — Gestire tempo, coda e perdite dei record

**Stato:** ✅ DONE
**Fase:** 345 — Consegna dei record e disconnessioni

## Cosa devo fare

Apri `include/spaghetti/data.h`, `subsys/data/data.c`, crea
`include/spaghetti/record_delivery.h`, `subsys/data/record_delivery.c` e
`tests/record_delivery/`.

Il record della fase 310 deve contenere `boot_id`, `timestamp_ms` monotono e `sequence`.
`timestamp_ms` deriva da `k_uptime_get()` e riparte dopo reboot; `boot_id` cambia a ogni
boot e permette a Node-RED di non confondere due timeline.

```c
struct spaghetti_record_cursor {
	uint64_t boot_id;
	uint32_t sequence;
};

typedef uint16_t spaghetti_record_consumer_id_t;

struct spaghetti_record_consumer_descriptor {
	spaghetti_record_consumer_id_t id;
	const char *name;
};

struct spaghetti_record_consumer_status {
	spaghetti_record_consumer_id_t id;
	bool active;
	size_t pending;
	uint32_t delivered;
	uint32_t lost;
};

int spaghetti_record_delivery_init(uint64_t boot_id);
int spaghetti_record_delivery_push(const struct spaghetti_record *record);
int spaghetti_record_delivery_set_consumer_active(
	spaghetti_record_consumer_id_t consumer_id,
	bool active);
int spaghetti_record_delivery_peek(
	spaghetti_record_consumer_id_t consumer_id,
	struct spaghetti_record *out,
	struct spaghetti_record_cursor *out_cursor);
int spaghetti_record_delivery_ack(
	spaghetti_record_consumer_id_t consumer_id,
	const struct spaghetti_record_cursor *cursor);
int spaghetti_record_delivery_get_consumer_status(
	spaghetti_record_consumer_id_t consumer_id,
	struct spaghetti_record_consumer_status *out);

#define SPAGHETTI_RECORD_CONSUMER_DEFINE(name) \
	const STRUCT_SECTION_ITERABLE( \
		spaghetti_record_consumer_descriptor, name)
```

Ogni adapter registra un descriptor immutabile con ID stabile non zero; la registrazione
usa iterable sections e `init()` fallisce se i consumer compilati superano
`CONFIG_SPAGHETTI_MAX_RECORD_CONSUMERS`. Lo stato dei cursori appartiene a Record
Delivery, non agli adapter, ed è allocato staticamente dal profilo.

La coda è una ring RAM bounded configurata dal profilo, possiede copie complete e non
usa heap. Un record viene liberato quando tutti i consumer attivi lo hanno confermato.
Se la ring è piena, elimina il record più vecchio, incrementa `lost` soltanto per i
consumer attivi che non lo avevano confermato e conserva il nuovo. Un consumer non
attivo non trattiene la coda; quando torna attivo parte dal record più vecchio ancora
presente. Se nessun consumer è attivo, la ring conserva comunque gli ultimi record
fino alla capacità configurata.

`peek(consumer_id, ...)` restituisce il prossimo record di quel consumer senza
rimuoverlo; l'adapter chiama `ack()` soltanto dopo consegna accettata. Record, cursor e
status sono caller-owned e cambiano solo al successo. Un ACK di MQTT non sposta BLE e
viceversa. ID sconosciuto restituisce `-ENOENT`, consumer inattivo `-EACCES`, cursor
diverso dal record pending `-ESTALE`, puntatore nullo `-EINVAL`.

La V1 non promette storico dopo reboot e non scrive sample in flash: Node-RED deve
trattare `boot_id` cambiato o `lost` aumentato come una discontinuità esplicita.

## Perché è fatto così

Con BLE intermittente un bus live-only perderebbe silenziosamente ogni misura. Una
coda RAM bounded offre finestre di pubblicazione utili senza usurare flash né inventare
un database embedded.

## Come si usa

```c
struct spaghetti_record record;
struct spaghetti_record_cursor cursor;

if (spaghetti_record_delivery_peek(MQTT_CONSUMER_ID,
				    &record, &cursor) == 0) {
	/* Invia; dopo conferma chiama ack per lo stesso consumer. */
}
```

## Checklist di completamento

- [x] Uptime e boot ID hanno semantica documentata.
- [x] Ring RAM è bounded e non usa heap.
- [x] MQTT, BLE e futuri adapter hanno cursori e ACK indipendenti.
- [x] Overflow è visibile nel contatore del consumer che perde il record.
- [x] Reboot è una discontinuità esplicita.
- [x] MQTT e BLE non cambiano il contenuto del record.
- [x] Capacità ring e consumer provengono dal profilo 291.

## Verifica e fine task

```sh
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/data -T tests/record_delivery \
  -p native_sim/native/64 --inline-logs --clobber-output'
```

Prova wrap della ring e della sequence, ack errato, due boot ID, queue capacity uno,
due consumer a velocità diverse, consumer fermato/riavviato e overflow che incrementa
soltanto il relativo contatore `lost`.
