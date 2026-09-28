# TASK-350-01 — Implementare Discovery multi-provider

**Stato:** ✅ DONE
**Fase:** 350 — Discovery multi-provider V1

## Cosa devo fare

### 1. Separare candidato, metodo e Module configurato

Apri `include/spaghetti/discovery.h`. Un provider propone un candidato; non assegna
una Module key e non chiama Manager:

```c
#define SPAGHETTI_DISCOVERY_PROVIDER_ID_SIZE 24U
#define SPAGHETTI_DISCOVERY_IDENTITY_MAX 16U

typedef uint32_t spaghetti_discovery_candidate_id_t;

enum spaghetti_discovery_method {
	SPAGHETTI_DISCOVERY_METHOD_EEPROM,
	SPAGHETTI_DISCOVERY_METHOD_I2C_REGISTER,
	SPAGHETTI_DISCOVERY_METHOD_ANALOG,
	SPAGHETTI_DISCOVERY_METHOD_W1_ROM,
	SPAGHETTI_DISCOVERY_METHOD_CUSTOM,
};

enum spaghetti_discovery_confidence {
	SPAGHETTI_DISCOVERY_HEURISTIC,
	SPAGHETTI_DISCOVERY_AUTHORITATIVE,
};

enum spaghetti_discovery_probe_flags {
	SPAGHETTI_DISCOVERY_PROBE_READ_ONLY = BIT(0),
	SPAGHETTI_DISCOVERY_PROBE_MAY_CHANGE_STATE = BIT(1),
};

struct spaghetti_discovery_candidate {
	spaghetti_discovery_candidate_id_t id;
	spaghetti_port_id_t port_id;
	spaghetti_flow_id_t flow_id;
	spaghetti_bay_id_t bay_id;
	spaghetti_power_rail_id_t power_rail_id;
	char provider_id[SPAGHETTI_DISCOVERY_PROVIDER_ID_SIZE];
	enum spaghetti_discovery_method method;
	enum spaghetti_discovery_confidence confidence;
	uint32_t probe_flags;
	uint8_t identity_size;
	uint8_t identity[SPAGHETTI_DISCOVERY_IDENTITY_MAX];
	char suggested_type_id[SPAGHETTI_TYPE_ID_MAX];
	struct spaghetti_property_set suggested_properties;
	uint32_t generation;
};
```

Candidate ID è effimero; identity sono byte stabili letti dall'hardware quando
disponibili. `suggested_*` possono essere vuoti per un dispositivo rilevato ma non
identificato. HEURISTIC non viene mai applicato automaticamente. Un Module manuale
continua a entrare direttamente da Config e non richiede un candidate.
Flow deriva sempre dalla Port. Bay e rail valgono `UNSPECIFIED` quando il metodo non
può osservarle; un provider non deduce la posizione dall'ordine degli indirizzi I2C o
dall'ordine temporale della scansione.

### 2. Rendere i provider auto-registranti

```c
typedef int (*spaghetti_discovery_emit_candidate_cb_t)(
	const struct spaghetti_discovery_candidate *candidate,
	void *user_data);

struct spaghetti_discovery_provider_ops {
	int (*scan)(const struct spaghetti_port *port,
		    spaghetti_discovery_emit_candidate_cb_t emit,
		    void *emit_user_data,
		    k_timeout_t timeout);
};

struct spaghetti_discovery_provider {
	const char *provider_id;
	uint16_t api_version;
	enum spaghetti_discovery_method method;
	enum spaghetti_discovery_confidence confidence;
	uint32_t probe_flags;
	uint32_t required_capabilities;
	const struct spaghetti_discovery_provider_ops *ops;
};

#define SPAGHETTI_DISCOVERY_PROVIDER_DEFINE(name) \
	const STRUCT_SECTION_ITERABLE(spaghetti_discovery_provider, name)
```

Discovery itera provider con capability compatibili. Non conserva callback provider.
Ogni candidate emesso viene validato e copiato in una tabella bounded. Duplicati sono
identificati da Port + provider ID + identity, non soltanto dalla Port.

### 3. Esporre scan, lista, accettazione e rifiuto

```c
struct spaghetti_discovery_scan_policy {
	bool allow_read_only;
	bool allow_state_changing;
	k_timeout_t timeout_per_provider;
};

int spaghetti_discovery_scan_port(
	spaghetti_port_id_t port_id,
	const struct spaghetti_discovery_scan_policy *policy);
int spaghetti_discovery_list(
	struct spaghetti_discovery_candidate *out,
	size_t capacity,
	size_t *out_count);
int spaghetti_discovery_accept(
	spaghetti_discovery_candidate_id_t candidate_id,
	spaghetti_module_key_t key,
	uint32_t expected_generation,
	struct spaghetti_module_config *out_module);
int spaghetti_discovery_reject(
	spaghetti_discovery_candidate_id_t candidate_id,
	uint32_t expected_generation);
```

Scan policy è caller-owned e borrowed. `list(NULL, 0, &count)` fa count-only.
`accept()` richiede candidate autorevole con type/config completi, oppure un candidato
euristico esplicitamente scelto dall'utente; copia una module config pronta da inserire
in una nuova Config, inclusa la posizione soltanto quando conosciuta, ma non la
applica. `reject()` rimuove soltanto il candidate.
Generation impedisce di accettare un risultato già sostituito.

### 4. Predisporre metodi senza fingere di avere hardware

Crea `subsys/discovery/providers/README.md` e decoder/test helper:

```c
int spaghetti_identity_record_decode(
	const uint8_t *bytes,
	size_t bytes_size,
	struct spaghetti_discovery_candidate *out);
```

Input è borrowed, output cambia solo dopo magic/version/length/CRC e property set
validi. Restituisce `0`, `-EINVAL`, `-EMSGSIZE`, `-EBADMSG`, `-ENOTSUP` o `-ERANGE`.

- EEPROM: `spaghetti_identity_record_decode(bytes, size, out)` valida magic,
  format version, payload size e CRC. Zephyr offre `eeprom_read()`, ma una EEPROM
  rimovibile con address runtime non deve diventare un device statico nel DTS: il
  provider usa la transazione I2C della Port. L'API EEPROM standard è ammessa solo se
  una futura board possiede davvero una memoria fissa descritta nel Devicetree;
- I2C register: il provider futuro riceverà address/register/mask da policy board o
  Module catalog verificato, mai una scansione distruttiva di tutti gli address;
- analogico: il provider futuro riceverà finestre ADC non sovrapposte derivate dallo
  schema elettrico e tolleranze misurate;
- 1-Wire: Zephyr 4.4 offre `w1_search_rom()` e ROM+CRC autorevoli, ma family code da
  solo suggerisce una famiglia, non necessariamente il Module Spaghetti completo;
- custom: permette un protocollo proprietario futuro.

Non registrare provider hardware nella board V1. Registra soltanto provider fake nelle
build `tests/discovery_providers/`.

### 5. Collegare Config e stato esterno

Core continua a caricare i Module manuali dalla Config. Uno scan produce candidati e
un evento Communication; l'utente/Node-RED chiama accept, inserisce il modulo restituito
in una copia Config e applica l'intera Config. Una futura policy auto-accept usa lo
stesso percorso soltanto per provider AUTHORITATIVE esplicitamente allowlisted.

Testa contemporaneamente: Module manuale, EEPROM fake autorevole, analogico euristico,
due ROM 1-Wire sulla stessa Port, duplicate identity, provider timeout, probe invasivo
rifiutato, candidate stale e pool pieno.

## Perché è fatto così

Rilevare presenza non equivale a conoscere tipo e configurazione. La separazione
candidato → accettazione → Config evita che un probe sbagliato attivi hardware. Nessun
metodo è obbligatorio e più metodi possono convivere sulla stessa Port.

## Come si usa

Un Module senza identità viene scritto direttamente in Config. Un Module con EEPROM o
1-Wire compare tra i candidati. Node-RED mostra metodo/confidence e, dopo accettazione,
invia la Config completa. In futuro una policy può automatizzare soltanto identità
autorevoli conosciute.

## Checklist di completamento

- [x] Provider sono auto-registrati e capability-filtered.
- [x] Manuale funziona senza alcun provider.
- [x] Candidati possiedono identity, suggerimenti e generation.
- [x] Candidate distingue Bay/rail osservate da quelle non conoscibili.
- [x] Probe state-changing richiede policy esplicita.
- [x] Accept produce Config ma non crea direttamente Module.
- [x] Fake coprono EEPROM, I2C register, analogico e 1-Wire.

## Verifica e fine task

```sh
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/discovery -T tests/discovery_providers \
  -p native_sim/native/64 --inline-logs --clobber-output'
make pristine
```

Il risultato atteso è zero provider hardware attivo sulla board V1, Module manuali invariati e
candidati fake multipli gestiti senza assunzione Port = Module.
