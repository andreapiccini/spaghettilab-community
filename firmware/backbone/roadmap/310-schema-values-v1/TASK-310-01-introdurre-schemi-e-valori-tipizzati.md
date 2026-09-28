# TASK-310-01 — Introdurre schemi e valori tipizzati

**Stato:** ✅ DONE
**Fase:** 310 — Schemi e valori V1

## Cosa devo fare

### 1. Creare il vocabolario comune

Crea `include/spaghetti/schema.h`, `subsys/schema/schema.c` e
`subsys/schema/README.md`; aggiungi `schema.c` al `CMakeLists.txt` applicazione.

Scrivi questi limiti pubblici:

```c
#define SPAGHETTI_SCHEMA_ID_SIZE 32U
#define SPAGHETTI_FIELD_NAME_SIZE 24U
#define SPAGHETTI_UNIT_NAME_SIZE 16U
#define SPAGHETTI_VALUE_BYTES_MAX CONFIG_SPAGHETTI_VALUE_BYTES_MAX
#define SPAGHETTI_VALUE_TEXT_MAX CONFIG_SPAGHETTI_VALUE_TEXT_MAX
#define SPAGHETTI_PROPERTY_MAX_FIELDS \
	CONFIG_SPAGHETTI_MAX_PROPERTIES_PER_SET
```

Poi definisci:

```c
enum spaghetti_value_type {
	SPAGHETTI_VALUE_BOOL,
	SPAGHETTI_VALUE_INT64,
	SPAGHETTI_VALUE_UINT64,
	SPAGHETTI_VALUE_TEXT,
	SPAGHETTI_VALUE_BYTES,
};

struct spaghetti_bytes_value {
	size_t size;
	uint8_t bytes[SPAGHETTI_VALUE_BYTES_MAX];
};

struct spaghetti_text_value {
	size_t size;
	char text[SPAGHETTI_VALUE_TEXT_MAX + 1U];
};

struct spaghetti_value {
	uint16_t field_id;
	enum spaghetti_value_type type;
	union {
		bool boolean;
		int64_t signed_integer;
		uint64_t unsigned_integer;
		struct spaghetti_text_value text;
		struct spaghetti_bytes_value bytes;
	} data;
};

struct spaghetti_property_set {
	size_t field_count;
	struct spaghetti_value fields[SPAGHETTI_PROPERTY_MAX_FIELDS];
};
```

La union è tagged da `type`: si legge soltanto il membro selezionato. `field_id` è
stabile nello schema e viene codificato come unsigned esplicito sul wire. INT64 e
UINT64 coprono fixed-point, timestamp e contatori senza float. TEXT contiene UTF-8
owned, `size` non include il terminatore e `text[size]` deve essere `\0`; serve per
proprietà configurabili che Node-RED deve mostrare come testo. BYTES contiene piccoli
blob opachi e non viene interpretato come stringa. I limiti vengono dal profilo 291 e
nessun valore contiene puntatori.

### 2. Descrivere i campi senza inserirli in ogni messaggio

```c
enum spaghetti_field_flags {
	SPAGHETTI_FIELD_REQUIRED = BIT(0),
	SPAGHETTI_FIELD_WRITABLE = BIT(1),
	SPAGHETTI_FIELD_HAS_DEFAULT = BIT(2),
	SPAGHETTI_FIELD_ENUM = BIT(3),
};

enum spaghetti_field_semantic {
	SPAGHETTI_FIELD_SEMANTIC_VALUE,
	SPAGHETTI_FIELD_SEMANTIC_MODULE_KEY_REF,
	SPAGHETTI_FIELD_SEMANTIC_RECORD_FIELD_REF,
	SPAGHETTI_FIELD_SEMANTIC_COMMAND_REF,
	SPAGHETTI_FIELD_SEMANTIC_PORT_REF,
	SPAGHETTI_FIELD_SEMANTIC_FLOW_REF,
	SPAGHETTI_FIELD_SEMANTIC_BAY_REF,
	SPAGHETTI_FIELD_SEMANTIC_POWER_RAIL_REF,
	SPAGHETTI_FIELD_SEMANTIC_DURATION_MS,
};

struct spaghetti_enum_option {
	struct spaghetti_value value;
	const char *name;
	const char *description;
};

struct spaghetti_field_descriptor {
	uint16_t field_id;
	enum spaghetti_value_type type;
	enum spaghetti_field_semantic semantic;
	uint8_t reference_group;
	uint32_t flags;
	int64_t signed_minimum;
	int64_t signed_maximum;
	uint64_t unsigned_minimum;
	uint64_t unsigned_maximum;
	uint8_t bytes_min_size;
	uint8_t bytes_max_size;
	const char *name;
	const char *description;
	const char *unit;
	const struct spaghetti_value *default_value;
	const struct spaghetti_enum_option *enum_options;
	size_t enum_option_count;
};

struct spaghetti_schema_descriptor {
	const char *schema_id;
	uint16_t version;
	const struct spaghetti_field_descriptor *fields;
	size_t field_count;
};
```

Descrittori, stringhe, default e array sono `const` con lifetime firmware e
appartengono al plug-in che li definisce. `name` è l'identificatore macchina stabile
usato da JSON e Node-RED; `description` è testo umano breve; `unit` è vuota se non
applicabile. `default_value` è NULL senza default e deve avere lo stesso field ID e
tipo del descrittore. Le enum sono ammesse soltanto su INT64/UINT64, hanno nomi stabili
e valori univoci; ogni `value` usa field ID e type del relativo descrittore. Ogni tipo
usa la propria coppia di limiti; i campi non applicabili
sono zero.
`schema_id` è una stringa stabile come `"spaghetti.ina219.sample"`; `version` cambia
quando cambia un field ID, tipo o significato incompatibile.

`semantic` non cambia il tipo sul wire: dice a validatore e host che un `UINT64`
rappresenta, per esempio, una Module key o una Bay invece di un numero generico.
`reference_group` unisce riferimenti composti: source Module key e record field ID
usano lo stesso gruppo nonzero; target Module key e command ID ne usano un altro.
React Flow può quindi mostrare handle e collegamenti usando il catalogo, senza nomi
speciali per INA219 o threshold. `VALUE` usa gruppo zero. Il firmware rifiuta semantica
incompatibile col tipo e riferimenti che Config non riesce a risolvere.

Congela anche la rappresentazione host: INT64/UINT64 vengono decodificati come
`BigInt`; nell'output JSON e nei messaggi Node-RED diventano stringhe decimali quando
sono fuori da `Number.MIN_SAFE_INTEGER..Number.MAX_SAFE_INTEGER`. Il catalogo conserva
sempre il tipo originale, quindi il client può ricostruirli senza perdita. Non
convertire silenziosamente un intero a `Number`.

### 3. Definire record e comando generici

Apri `include/spaghetti/module.h` e lascia identità/lifecycle. Sposta il vecchio
sample elettrico nel percorso legacy e aggiungi in `schema.h`:

```c
enum spaghetti_record_kind {
	SPAGHETTI_RECORD_SAMPLE,
	SPAGHETTI_RECORD_EVENT,
};

struct spaghetti_record_payload {
	enum spaghetti_record_kind kind;
	char schema_id[SPAGHETTI_SCHEMA_ID_SIZE];
	uint16_t schema_version;
	struct spaghetti_property_set values;
};

struct spaghetti_record {
	spaghetti_module_id_t source_id;
	spaghetti_module_key_t source_key;
	uint64_t boot_id;
	int64_t timestamp_ms;
	uint32_t sequence;
	struct spaghetti_record_payload payload;
};

struct spaghetti_module_command {
	uint16_t command_id;
	struct spaghetti_property_set arguments;
};
```

Payload e record possiedono tutti i byte. Il driver produce soltanto payload; Manager
e Runtime aggiungono key, ID, boot ID, timestamp e sequence formando il record copiabile
in zbus. `timestamp_ms` è uptime monotono da `k_uptime_get()`, non Unix time; `boot_id`
cambia a ogni boot e rende esplicita la discontinuità. Sequence è per sorgente, parte da
uno e il rollover `UINT32_MAX` è valido se boot ID e ordine di consegna coincidono.
Il comando è borrowed durante una chiamata sincrona e contiene valori owned,
quindi non porta puntatori a stack attraverso code o trasporti.

Per descrivere più comandi nello stesso driver aggiungi:

```c
struct spaghetti_command_descriptor {
	uint16_t command_id;
	const char *name;
	const struct spaghetti_schema_descriptor *argument_schema;
};
```

Ogni command ID è stabile nel driver; lo schema argomenti può essere diverso dagli
altri comandi.

### 4. Implementare lookup e validazione una sola volta

Esponi:

```c
const struct spaghetti_value *spaghetti_property_find(
	const struct spaghetti_property_set *properties,
	uint16_t field_id);
int spaghetti_property_validate(
	const struct spaghetti_property_set *properties,
	const struct spaghetti_schema_descriptor *schema);
int spaghetti_record_payload_validate(
	const struct spaghetti_record_payload *payload,
	const struct spaghetti_schema_descriptor *schema);
int spaghetti_record_validate(
	const struct spaghetti_record *record,
	const struct spaghetti_schema_descriptor *schema);
```

`find()` restituisce un puntatore immutable borrowed con lifetime della property set o
NULL. `property_validate()` rifiuta puntatori nulli, count oltre capacità, field ID
zero/duplicati/sconosciuti, type mismatch, required assenti, flag sconosciuti, range e
TEXT UTF-8/terminazione, BYTES oltre limite, default incoerenti ed enum non ammesse.
`payload_validate()` verifica kind, schema ID/version e valori;
`record_validate()` aggiunge source, timestamp e sequence. Le funzioni restituiscono
`0`, `-EINVAL`, `-ENOENT`, `-EEXIST`, `-EMSGSIZE`, `-ERANGE` o
`-EPROTONOSUPPORT`; non modificano input.

### 5. Aggiungere test indipendenti

Crea `tests/schema/` con CMake, Kconfig, prj.conf, testcase e ztest. Copri ogni tipo,
min/max, required, default, enum, UTF-8, duplicati, schema sbagliato, buffer massimo e
semantica/reference group incoerenti. Copri inoltre riferimenti Module/Flow/Bay/rail
validi e mancanti tramite resolver fake e output immutato.
Misura con `sizeof(struct spaghetti_record)` e documenta in `subsys/schema/README.md`
la RAM consumata da un elemento zbus prima di scegliere le capacità della fase 340.

## Perché è fatto così

I messaggi non possono contenere una union centrale per ogni sensore futuro e non
possono serializzare struct C. Una property set bounded offre tipi comuni; lo schema
immutabile aggiunge nomi, unità e limiti senza ripeterli in ogni sample. Node-RED può
leggere il catalogo una volta e interpretare i field ID successivi.

## Come si usa

Un driver definisce staticamente lo schema e produce `{field_id=1, UINT64=5000000}`.
Un adapter risolve field 1 nel catalogo come `bus_voltage_microvolts`. Un futuro
sensore definisce un altro schema senza modificare `schema.c`. Un editor Node-RED usa
enum, default, descrizione, unità e writable per costruire il campo corretto senza una
tabella specifica INA219.

## Checklist di completamento

- [x] Property set contiene solo valori owned e bounded.
- [x] Descrittori hanno lifetime firmware e schema/version stabili.
- [x] Testo, enum, default e descrizioni sono rappresentabili senza puntatori nei valori.
- [x] Record e comandi non contengono tipi INA219/Relay.
- [x] Timestamp, boot ID, sequence e rollover hanno semantica non ambigua.
- [x] Lookup e validazione coprono duplicati, required, tipi e range.
- [x] Il mapping lossless INT64/UINT64 per JavaScript è documentato.
- [x] Semantic e reference group permettono a un editor di costruire collegamenti senza hardcode.
- [x] Tutte le capacità provengono dal profilo 291.
- [x] Dimensione RAM del record è documentata.

## Verifica e fine task

```sh
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/schema -p native_sim/native/64 \
  --inline-logs --clobber-output'
make build
```

Il risultato atteso è uno schema completamente indipendente da driver e trasporti,
con zero allocazioni dinamiche.
