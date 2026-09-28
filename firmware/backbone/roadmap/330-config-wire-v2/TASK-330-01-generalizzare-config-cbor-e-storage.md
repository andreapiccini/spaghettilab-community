# TASK-330-01 — Generalizzare Config, CBOR e Storage

**Stato:** ✅ DONE
**Fase:** 330 — Config e wire V2

## Cosa devo fare

### 1. Rendere Config completamente tipizzata ma non concreta

Apri `include/spaghetti/config.h`. Porta la versione in-memory a 4 e sostituisci i
byte driver con property set:

```c
#define SPAGHETTI_CONFIG_VERSION 4U
#define SPAGHETTI_CONFIG_MAX_MODULES CONFIG_SPAGHETTI_MAX_MODULES
#define SPAGHETTI_CONFIG_MAX_SCHEDULES CONFIG_SPAGHETTI_MAX_SCHEDULES
#define SPAGHETTI_CONFIG_MAX_RULES CONFIG_SPAGHETTI_MAX_RULES

struct spaghetti_module_config {
	spaghetti_module_key_t key;
	spaghetti_port_id_t port_id;
	spaghetti_bay_id_t bay_id;
	spaghetti_power_rail_id_t power_rail_id;
	char type_id[SPAGHETTI_CONFIG_TYPE_ID_SIZE];
	struct spaghetti_property_set properties;
};

struct spaghetti_runtime_schedule_config {
	bool enabled;
	spaghetti_module_key_t source_key;
	uint32_t period_ms;
};

struct spaghetti_rule_config {
	spaghetti_module_key_t key;
	char type_id[SPAGHETTI_CONFIG_TYPE_ID_SIZE];
	struct spaghetti_property_set properties;
};

struct spaghetti_config {
	uint32_t version;
	size_t module_count;
	struct spaghetti_module_config modules[SPAGHETTI_CONFIG_MAX_MODULES];
	size_t schedule_count;
	struct spaghetti_runtime_schedule_config
		schedules[SPAGHETTI_CONFIG_MAX_SCHEDULES];
	size_t rule_count;
	struct spaghetti_rule_config rules[SPAGHETTI_CONFIG_MAX_RULES];
	enum spaghetti_connectivity_policy connectivity_policy;
	struct spaghetti_energy_policy energy_policy;
	struct spaghetti_mqtt_config mqtt;
};
```

Config possiede ogni valore e non conserva puntatori. `port_id` seleziona la
terminazione firmware e determina il Flow; `bay_id` descrive la posizione fisica
oppure vale `SPAGHETTI_BAY_ID_UNSPECIFIED`; `power_rail_id` dichiara la selezione
desiderata oppure vale `SPAGHETTI_POWER_RAIL_UNSPECIFIED`. Su hardware passivo questi
campi descrivono ciò che l'utente deve impostare col jumper, ma non lo certificano.
Più schedule sostituiscono la
singola sorgente. La vecchia `threshold_rule` concreta sparisce dal modello centrale;
la fase 340 la migra in un rule driver. Connectivity policy ed energy policy sono
desiderio persistente; lease, connessioni e deadline restano stato runtime del
Connectivity Manager e non entrano in Config.

Il Module Driver `declarative-device` della fase 325 usa proprietà tipizzate per
`profile_id`, versione/hash e parametri di istanza: non copia acquisition plan o
profilo completo nel Config. La validazione risolve la revisione esatta e restituisce
`-ENOTSUP` se il profilo richiede opcode/Capability Pack non installati. Riserva il
percorso di migrazione alla versione Config introdotta dalla fase 342 per block/edge;
decoder e Storage non devono assumere che `rules` sia l'ultima sezione possibile.

### 2. Definire il contratto dei rule driver prima di validarli

Crea `include/spaghetti/rule_driver.h` e `subsys/rule_registry/` con Registry basato
su iterable sections, come i Module Driver:

```c
struct spaghetti_rule_action {
	spaghetti_module_key_t target_key;
	struct spaghetti_module_command command;
};

typedef int (*spaghetti_rule_emit_action_cb_t)(
	const struct spaghetti_rule_action *action,
	void *user_data);

struct spaghetti_rule_driver_ops {
	int (*validate_config)(const struct spaghetti_property_set *config);
	int (*init)(const struct spaghetti_property_set *config, void **out_context);
	int (*on_record)(void *context,
			 const struct spaghetti_record *record,
			 spaghetti_rule_emit_action_cb_t emit,
			 void *emit_user_data);
	int (*deinit)(void *context);
};

struct spaghetti_rule_driver {
	const char *type_id;
	uint16_t api_version;
	const struct spaghetti_schema_descriptor *config_schema;
	const struct spaghetti_rule_driver_ops *ops;
};
```

`init()` assegna context da una slab posseduta dal rule driver e scrive `out_context`
solo al successo. Runtime possiede l'istanza logica e chiama `deinit()`. `on_record()`
non comanda Manager direttamente: emette una action copied e Runtime decide come
applicarla. Aggiungi macro `SPAGHETTI_RULE_DRIVER_DEFINE(name)` e lookup/count/get. In
questa fase un fake prova il Registry; la soglia concreta arriva nella fase 340.

### 3. Definire il wire CBOR V2 canonico

Conserva i decoder legacy wire 1/2 in `subsys/config/config_cbor_legacy.c`. Crea
`subsys/config/spaghetti_config_v2.cddl` con wire version 3:

```cddl
spaghetti-config-v2 = {
  0: 3,
  1: [* module],
  2: [* schedule],
  3: [* rule],
  4: mqtt,
  5: uint,             ; connectivity policy
  6: energy-policy
}
module = {
  0: uint,             ; stable Module key
  1: uint,             ; Port ID, quindi Flow
  2: tstr,             ; driver type ID
  3: properties,
  4: uint / nil,       ; optional Function Bay ID
  5: uint / nil        ; optional power rail ID
}
schedule = { 0: uint, 1: uint, 2: bool }
rule = { 0: uint, 1: tstr, 2: properties }
properties = { * uint => (bool / int / uint / tstr / bstr) }
energy-policy = { 0: uint, 1: uint, 2: uint }
```

Chiavi property sono field ID; tipo CBOR viene convertito nel relativo
`spaghetti_value_type`. Rifiuta float, mappe annidate, duplicati, più di
`CONFIG_SPAGHETTI_MAX_PROPERTIES_PER_SET` campi e trailing bytes. TEXT accetta soltanto
UTF-8 valido entro il limite del profilo; BYTES resta opaco. Dopo il decode, Config
trova driver/rule descriptor e
valida con lo schema e `ops->validate_config()`; `config_cbor.c` non include header di
driver concreti.

Aggiorna `include/spaghetti/config_codec.h`:

```c
#define SPAGHETTI_CONFIG_CBOR_MAX_SIZE CONFIG_SPAGHETTI_CONFIG_CBOR_MAX_SIZE

int spaghetti_config_decode_cbor(
	const uint8_t *bytes,
	size_t length,
	struct spaghetti_config *out);
int spaghetti_config_encode_cbor(
	const struct spaghetti_config *config,
	uint8_t *buffer,
	size_t buffer_capacity,
	size_t *written_size);
```

Encode valida prima, produce sempre wire V2 canonico, ordina root/field ID in modo
deterministico e scrive buffer/written solo al successo. Restituisce `-EINVAL`,
`-EMSGSIZE`, `-EBADMSG`, `-ENOTSUP`, `-ENOENT`, `-EEXIST`, `-EADDRINUSE`, `-ERANGE`.

### 4. Esporre snapshot, revisione e validazione senza effetti

Sostituisci le firme V0 in `include/spaghetti/config.h` con:

```c
#define SPAGHETTI_CONFIG_HASH_SIZE 32U

struct spaghetti_config_revision {
	uint32_t generation;
	uint8_t sha256[SPAGHETTI_CONFIG_HASH_SIZE];
};

struct spaghetti_config_commit_result {
	struct spaghetti_config_revision revision;
	bool changed;
};

int spaghetti_config_validate(const struct spaghetti_config *candidate,
			      struct spaghetti_config_failure *failure);
int spaghetti_config_get_snapshot(
	struct spaghetti_config *out,
	struct spaghetti_config_revision *out_revision);
int spaghetti_config_apply(
	const struct spaghetti_config *candidate,
	uint32_t expected_generation,
	struct spaghetti_config_commit_result *out_result);
```

`candidate` è borrowed e non viene modificata. Snapshot, revision e result sono
caller-owned e cambiano solo al successo. L'hash è SHA-256 dei byte CBOR canonici,
quindi due Config equivalenti hanno lo stesso valore indipendentemente dal layout C.
`validate()` esegue l'intera validazione server-side ma non ferma Runtime, non modifica
Module e non scrive Storage. Protocollo e Node-RED useranno la generazione come
compare-and-swap: un client applica soltanto la Config derivata dalla revisione che ha
letto.

Se il candidato canonico è identico alla Config corrente, `apply()` restituisce `0`,
`changed=false`, stessa generazione e stesso hash. Non ferma Runtime e non scrive NVS.
Questo comportamento evita usura flash quando un flow Node-RED ripete il proprio stato
desiderato. Se `expected_generation` non coincide restituisce `-ESTALE`, non modifica
output o stato e obbliga il client a rileggere e rifare il merge.

### 5. Riconciliare Module, schedule e rule in una transazione

Apri `subsys/config/config.c`. Moduli invariati per key restano vivi solo se Port,
type e property set coincidono. Schedule riferiscono una key esistente con op `read`;
rule type deve esistere nel Rule Registry. Valida tutto prima del primo cambiamento.

Prima di ogni effetto valida Port→Flow, Bay, rail, collisione di Bay quando entrambe
le configurazioni dichiarano una posizione, compatibilità transport e
`spaghetti_power_validate_binding()`. `UNVERIFIED` è uno stato valido e deve comparire
nel risultato/status; non diventa errore soltanto perché la base usa jumper.

Apply esegue: stop Runtime, prepara nuovi Module, applica la policy tramite Connectivity
Manager, commit Config e Storage, configura le schedule e riavvia Runtime. Su qualsiasi
errore ripristina policy, Module e schedule
precedenti. Generation aumenta una sola volta al commit realmente diverso. Nessuna
Port viene considerata occupata. Limita e misura anche la frequenza massima delle
scritture persistenti: il no-op non consuma il budget, mentre richieste differenti
troppo rapide restituiscono `-EBUSY` senza iniziare la transazione.

In questa fase Config decodifica, valida e conserva anche le rule, ma rifiuta con
`-ENOTSUP` un apply con `rule_count > 0`: il lifecycle dei context e il rollback delle
rule appartengono a Runtime e vengono implementati integralmente nel task 340
immediatamente successivo. È una limitazione intermedia esplicita, non un fallback
silenzioso. I payload senza rule e la migrazione della vecchia threshold restano
utilizzabili; il task 340 rimuove il rifiuto e completa la transazione.

### 6. Persistire byte canonici, non `struct spaghetti_config`

Apri `subsys/services/storage/storage.c`. Il record diventa:

```c
#define SPAGHETTI_STORAGE_RECORD_MAGIC_V2 0x53504732U

struct spaghetti_storage_record_v2 {
	uint32_t magic;
	uint16_t record_version;
	uint16_t payload_size;
	uint32_t payload_crc32;
	uint8_t payload[SPAGHETTI_CONFIG_CBOR_MAX_SIZE];
};
```

Write usa encoder, `crc32_ieee()`, azzera byte non usati e salva. Read verifica
lunghezza/CRC e decodifica in una temporanea. Non fa `loaded_record.config = ...`.

Isola il vecchio layout in `storage_legacy_v3.c`: riconosce esattamente magic/version
precedenti, converte INA219, Relay, sampling, threshold e MQTT nel nuovo modello e
risalva V2 solo dopo validazione. Se trova tipo/layout non convertibile restituisce
`-EPROTONOSUPPORT` e Core entra in Maintenance senza cancellare il record. Questo è il
solo file autorizzato a conoscere il vecchio layout concreto e va rimosso dopo una
release di migrazione documentata.

### 7. Testare compatibilità, concorrenza e perdita di alimentazione logica

Aggiorna `tests/config`, `config_codec`, `storage` e aggiungi `rule_registry`. Copri
round-trip deterministico, INA219/Relay generici, due schedule, fake rule, legacy
migration, CRC errato, record troncato, payload massimo, unknown type, rollback e
output immutato. Aggiungi due client fake che leggono la stessa generazione: il primo
commit riesce, il secondo riceve `-ESTALE`; dopo nuova lettura e merge riesce. Prova
anche validate senza effetti, apply identica senza scrittura Storage né incremento,
hash stabile dopo reboot e rate limit delle scritture differenti.

## Perché è fatto così

Il modello interno è condiviso da ogni trasporto, mentre CBOR è soltanto la forma
canonica wire/storage. Persistendo CBOR si eliminano padding, endianness e ABI delle
struct. Driver e rule validano le proprie proprietà; Config possiede soltanto il set
desiderato e la transazione.

## Come si usa

Un adapter legge snapshot e revisione, decodifica CBOR, valida e chiama
`spaghetti_config_apply(candidate, revision.generation, &result)`. Storage usa lo
stesso encoder. Un nuovo driver assegna field ID nel proprio schema e non richiede
modifiche al codec centrale.

## Checklist di completamento

- [x] Config contiene Module, schedule, rule e policy connettività/energia generici.
- [x] Un Module dichiarativo riferisce profilo e revisione senza duplicarne i byte.
- [x] Ogni Module può dichiarare Bay e rail senza duplicare Flow o GPIO MCU.
- [x] Power passivo resta valido ma visibilmente `UNVERIFIED`.
- [x] CBOR V2 non contiene switch su driver/rule concreti.
- [x] Encoder e decoder fanno round-trip canonico.
- [x] Snapshot restituisce generazione e hash canonico.
- [x] Validate non produce effetti e apply usa compare-and-swap.
- [x] Apply identica non incrementa generazione e non scrive flash.
- [x] Storage salva payload versionato con CRC.
- [x] Il record precedente migra oppure fallisce senza perdita.
- [x] Apply effettua rollback completo per Module/schedule e rifiuta rule non ancora eseguibili.
- [x] Tutti i limiti derivano dal profilo 291.

## Verifica e fine task

```sh
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/config -T tests/config_codec -T tests/storage \
  -T tests/rule_registry -p native_sim/native/64 \
  --inline-logs --clobber-output'
make pristine
```

Il risultato atteso è nessun riferimento concreto in `config_cbor.c`, Config corrente
preservata dalla migrazione e record corrotto mai applicato.
