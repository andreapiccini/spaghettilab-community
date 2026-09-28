# TASK-360-01 — Implementare il protocollo macchina V1

**Stato:** ✅ DONE
**Fase:** 360 — Communication Protocol V1

## Cosa devo fare

### 1. Definire envelope e operazioni indipendenti dal trasporto

Crea `include/spaghetti/protocol.h`, `subsys/communication/protocol_cbor.c` e aggiorna
`include/spaghetti/communication.h`:

```c
#define SPAGHETTI_PROTOCOL_VERSION 1U
#define SPAGHETTI_PROTOCOL_PAYLOAD_ABSOLUTE_MAX 2048U
#define SPAGHETTI_PROTOCOL_PAYLOAD_MAX \
	CONFIG_SPAGHETTI_PROTOCOL_PAYLOAD_MAX

enum spaghetti_protocol_operation {
	SPAGHETTI_PROTOCOL_GET_CATALOG = 1,
	SPAGHETTI_PROTOCOL_GET_STATUS = 2,
	SPAGHETTI_PROTOCOL_APPLY_CONFIG = 3,
	SPAGHETTI_PROTOCOL_LIST_DISCOVERY = 4,
	SPAGHETTI_PROTOCOL_SCAN_DISCOVERY = 5,
	SPAGHETTI_PROTOCOL_ACCEPT_DISCOVERY = 6,
	SPAGHETTI_PROTOCOL_MODULE_COMMAND = 7,
	SPAGHETTI_PROTOCOL_GET_UPDATE_STATUS = 8,
	SPAGHETTI_PROTOCOL_GET_CAPABILITIES = 9,
	SPAGHETTI_PROTOCOL_GET_CONNECTIVITY_STATUS = 10,
	SPAGHETTI_PROTOCOL_ACQUIRE_CONNECTIVITY_LEASE = 11,
	SPAGHETTI_PROTOCOL_RELEASE_CONNECTIVITY_LEASE = 12,
	SPAGHETTI_PROTOCOL_OPEN_NETWORK_MAINTENANCE = 13,
	SPAGHETTI_PROTOCOL_OPEN_WIFI_UPDATE = 14,
	SPAGHETTI_PROTOCOL_FACTORY_RESET = 15,
	SPAGHETTI_PROTOCOL_GET_CONFIG = 16,
	SPAGHETTI_PROTOCOL_VALIDATE_CONFIG = 17,
	SPAGHETTI_PROTOCOL_GET_AUDIT_LOG = 18,
	SPAGHETTI_PROTOCOL_GET_JOB_STATUS = 19,
	SPAGHETTI_PROTOCOL_GET_TOPOLOGY = 20,
	SPAGHETTI_PROTOCOL_GET_RESOURCES = 21,
	SPAGHETTI_PROTOCOL_LIST_DEVICE_PROFILES = 22,
	SPAGHETTI_PROTOCOL_GET_DEVICE_PROFILE = 23,
	SPAGHETTI_PROTOCOL_VALIDATE_DEVICE_PROFILE = 24,
	SPAGHETTI_PROTOCOL_INSTALL_DEVICE_PROFILE = 25,
	SPAGHETTI_PROTOCOL_REMOVE_DEVICE_PROFILE = 26,
	SPAGHETTI_PROTOCOL_GET_FEATURES = 27,
};

enum spaghetti_protocol_status {
	SPAGHETTI_PROTOCOL_STATUS_OK = 0,
	SPAGHETTI_PROTOCOL_STATUS_INVALID_ARGUMENT = 1,
	SPAGHETTI_PROTOCOL_STATUS_UNSUPPORTED = 2,
	SPAGHETTI_PROTOCOL_STATUS_UNAUTHORIZED = 3,
	SPAGHETTI_PROTOCOL_STATUS_CONFLICT = 4,
	SPAGHETTI_PROTOCOL_STATUS_BUSY = 5,
	SPAGHETTI_PROTOCOL_STATUS_UNAVAILABLE = 6,
	SPAGHETTI_PROTOCOL_STATUS_TIMEOUT = 7,
	SPAGHETTI_PROTOCOL_STATUS_RESOURCE_EXHAUSTED = 8,
	SPAGHETTI_PROTOCOL_STATUS_MALFORMED_REQUEST = 9,
	SPAGHETTI_PROTOCOL_STATUS_INTERNAL_ERROR = 10,
};

struct spaghetti_protocol_payload {
	size_t size;
	uint8_t bytes[SPAGHETTI_PROTOCOL_PAYLOAD_MAX];
};

struct spaghetti_protocol_request {
	uint16_t version;
	uint32_t correlation_id;
	enum spaghetti_protocol_operation operation;
	struct spaghetti_protocol_payload payload;
};

struct spaghetti_protocol_response {
	uint16_t version;
	uint32_t correlation_id;
	enum spaghetti_protocol_status status;
	struct spaghetti_protocol_payload payload;
};

enum spaghetti_protocol_status spaghetti_protocol_status_from_errno(int error);
```

Ogni envelope possiede il payload. `correlation_id` viene copiato esattamente nella
risposta anche quando l'operazione fallisce. Gli enum C non vengono serializzati: il
codec usa i numeri espliciti mostrati sopra. Lo status pubblico non è un errno Zephyr:
aggiungi una funzione centrale che traduce gli errori interni nel dominio V1 e non
cambiare tale mapping fra board o release. Un errno opzionale può comparire soltanto
nel payload diagnostico autorizzato, mai come significato principale per Node-RED.

Congela il mapping: `0→OK`; `-EINVAL/-ERANGE→INVALID_ARGUMENT`;
`-ENOTSUP/-EPROTONOSUPPORT/-ENOSYS→UNSUPPORTED`; `-EACCES/-EPERM→UNAUTHORIZED`;
`-ESTALE/-EEXIST→CONFLICT`; `-EBUSY/-EAGAIN→BUSY`;
`-ENODEV/-ENETDOWN/-ENOTCONN→UNAVAILABLE`; `-ETIMEDOUT→TIMEOUT`;
`-ENOMEM/-ENOSPC/-EMSGSIZE→RESOURCE_EXHAUSTED`;
`-EBADMSG/-EILSEQ→MALFORMED_REQUEST`; ogni altro errore negativo→INTERNAL_ERROR.
La funzione è pura, riceve il piccolo intero per valore e non modifica stato.

Il CBOR canonico è:

```cddl
request  = { 0: 1, 1: uint, 2: uint, 3: bstr }
response = { 0: 1, 1: uint, 2: uint, 3: bstr }
event    = { 0: 1, 1: uint, 2: uint, 3: bstr }
```

Esponi encode/decode request/response con buffer, capacity e written size. V1 ammette
al massimo 2048 byte, mentre la capability del profilo può dichiarare un limite minore;
aggiungi `BUILD_ASSERT(SPAGHETTI_PROTOCOL_PAYLOAD_MAX <=
SPAGHETTI_PROTOCOL_PAYLOAD_ABSOLUTE_MAX)`. Rifiuta versione sconosciuta, payload oltre
la capability, chiavi duplicate/extra, trailing bytes e correlation zero. Gli output
cambiano solo al successo.

### 2. Registrare operation handler come plug-in

```c
struct spaghetti_request_context {
	spaghetti_principal_id_t principal_id;
	uint32_t permissions;
	bool local;
	enum spaghetti_core_mode core_mode;
};

enum spaghetti_operation_execution {
	SPAGHETTI_OPERATION_IMMEDIATE_READ,
	SPAGHETTI_OPERATION_SERIALIZED_MUTATION,
	SPAGHETTI_OPERATION_ASYNC_JOB,
};

struct spaghetti_operation_handler {
	enum spaghetti_protocol_operation operation;
	uint32_t required_permissions;
	enum spaghetti_operation_execution execution;
	const struct spaghetti_schema_descriptor *request_schema;
	const struct spaghetti_schema_descriptor *response_schema;
	int (*execute)(const struct spaghetti_request_context *context,
		       const struct spaghetti_protocol_payload *request,
		       struct spaghetti_protocol_payload *response);
};

#define SPAGHETTI_OPERATION_HANDLER_DEFINE(name) \
	const STRUCT_SECTION_ITERABLE(spaghetti_operation_handler, name)
```

Handler, schema e descriptor hanno lifetime firmware. Context e payload request sono
borrowed; response è caller-owned e scritto solo al successo. Communication trova
l'handler in iterable section, verifica il principal e i permessi tramite Access
Control prima di chiamarlo e non conosce il trasporto. `principal_id` identifica il
peer autenticato anche dopo un reconnect; l'adapter non può inventare permessi maggiori
di quelli persistiti per quel principal.

### 3. Implementare i ventisette handler bounded

Dividi `subsys/communication/operations/` per owner:

- catalog: pagina driver/rule/block/provider/operation/opcode, Device Profile e
  Capability Pack con relativi schemi, cursor+limit, versioni Protocol/Config
  supportate e fingerprint SHA-256 dell'intero catalogo;
- status: Core, Port, Module, schedule, service, health, reset cause e stale component;
- get config: restituisce Config CBOR canonica, generation e hash della fase 330;
- validate config: esegue validazione completa senza effetti e restituisce il failure
  path tipizzato quando non è valida;
- apply config: payload contiene `expected_generation` e Config CBOR V2 completa;
  restituisce `changed`, nuova generation e hash; `-ESTALE` diventa CONFLICT;
- list discovery: pagina candidati;
- scan: Port più policy non invasiva/invasiva;
- accept: candidate ID, key, generation; costruisce/applica nuova Config completa;
- module command: stable target key, command ID e property arguments;
- update status: snapshot read-only.
- capabilities: profilo, variante, trasporti, OTA path e limiti immutabili;
- resources: report build/runtime della fase 348 con capacità, uso e high-water
  separati; lettura non resetta i contatori;
- features: feature-set hash, pack/versioni, dipendenze e tipi forniti;
- device profiles: list/get read-only e validate/install/remove autorizzati come
  definito dalla fase 325; install/remove sono mutazioni serializzate;
- topology: pagina Flow con direzione, Port, cinque segnali e Bay ordinate; per ogni
  Bay include rail disponibili, assurance e limiti dichiarati, più Module key,
  endpoint e admission correnti quando presenti;
- connectivity status: policy, servizi attivi, lease/deadline e ultimo errore;
- acquire/release lease: servizi richiesti e durata bounded;
- network maintenance e Wi-Fi update: operazioni distinte, mai implicite;
- factory reset: scope esplicito e solo con permission PROVISION.
- audit log: pagina metadata principal/operazione/esito/uptime senza payload o segreti;
- job status: legge stato/progresso/risultato di un job asincrono tramite job ID.

La paginazione evita risposte oltre 2048 byte. Ogni pagina restituisce `next_cursor` o
zero. Ogni pagina del catalogo ripete il fingerprint: un host invalida la propria cache
se cambia dopo OTA. Module command risolve key in ID soltanto durante la chiamata; non
espone ID effimeri come identità persistente. Il Core non effettua merge della Config:
il client legge, modifica la copia desiderata e applica con compare-and-swap.
Topology non restituisce GPIO MCU né presume una sola board. Distingue sempre
`UNVERIFIED` da `ENFORCED`, così l'interfaccia non mostra un jumper passivo come
protezione automatica.

### 4. Dare a ogni adapter una policy costante

Sostituisci il vecchio `spaghetti_request` V0 con:

```c
int spaghetti_communication_handle_request(
	const struct spaghetti_request_context *context,
	const struct spaghetti_protocol_request *request,
	struct spaghetti_protocol_response *response);
```

Le policy massime non arrivano dalla rete. Sono `static const` nell'adapter e vengono
intersecate con i permessi del principal autenticato:

- USB Shell in Maintenance: tutti i permessi;
- USB Shell in Normal: read/configure/command/discover/update, provisioning sensibile
  continua a richiedere transizione Maintenance;
- Remote Console TLS: read/configure/command/discover, mai provision;
- futuro MQTT: read/configure/command/discover secondo principal della credenziale;
- futuro BLE autenticato: permessi associati alla credenziale applicativa del peer;
- Maintenance UART SMP: update/provision soltanto per i command group dedicati.

Mantieni i comandi Shell umani, ma falli costruire request Protocol V1. La Remote
Console può mantenere la grammatica testuale per debug, ma usa gli stessi handler.

### 5. Centralizzare replay, concorrenza e operazioni lunghe

Crea in Communication una replay cache bounded da
`CONFIG_SPAGHETTI_MAX_INFLIGHT_REQUESTS`. La chiave è
`principal_id + correlation_id`; la entry conserva operation, hash SHA-256 della
request canonica e response completa. Se arriva la stessa request, restituisci la
response salvata senza eseguire di nuovo l'handler. Se lo stesso principal riutilizza
il correlation ID con byte o operation differenti, restituisci CONFLICT. La cache ha
TTL `CONFIG_SPAGHETTI_PROTOCOL_REPLAY_WINDOW_MS` e sostituzione deterministica; la
capability pubblica tale finestra e non contiene segreti in chiaro. Il client usa un
timeout/retry complessivo minore della finestra. La cache vive soltanto nel boot
corrente: se cambia `boot_id`, il client non ripete automaticamente command/reset/update
rimasti senza risposta; deve rileggere stato e decidere esplicitamente. MQTT, BLE, USB
e gateway non implementano cache proprie.

Documenta per ogni operation se è read-only, mutazione serializzata o job asincrono.
Le letture immediate usano snapshot e non bloccano callback di rete. Config, command,
lease e reset entrano in una sola queue bounded posseduta da Communication e vengono
eseguiti dal worker, mai nel callback MQTT/BLE. Scan invasiva, Maintenance e Update
restituiscono un `job_id` e proseguono nel rispettivo owner; `GET_JOB_STATUS` permette
polling fino a `completed`, `failed`, `cancelled` o `expired`. Pool e queue pieni
restituiscono RESOURCE_EXHAUSTED, non scartano richieste.

Ogni job conserva principal owner, operation, stato, protocol status, progresso e
deadline; non conserva un puntatore al payload ricevuto. Un principal diverso può
leggerlo soltanto con ruolo Administrator. Timeout e cancellazione chiamano l'owner e
rilasciano lo slot. Aggiungi test con MQTT e BLE simultanei, response persa, retry e
una scan lenta mentre GET_STATUS continua a rispondere.

### 6. Pubblicare eventi macchina

Aggiungi:

```c
enum spaghetti_protocol_event_type {
	SPAGHETTI_PROTOCOL_EVENT_RECORD = 1,
	SPAGHETTI_PROTOCOL_EVENT_STATUS = 2,
	SPAGHETTI_PROTOCOL_EVENT_DISCOVERY = 3,
	SPAGHETTI_PROTOCOL_EVENT_CONNECTIVITY = 4,
};

int spaghetti_protocol_encode_event(
	enum spaghetti_protocol_event_type type,
	uint32_t sequence,
	const struct spaghetti_protocol_payload *payload,
	uint8_t *buffer,
	size_t capacity,
	size_t *written_size);
```

Record, status, connectivity e candidate hanno codec payload separati e bounded. Stato
include device ID pubblico, boot ID, metriche queue/drop, stack/heap high-water esposte
senza indirizzi o segreti. Il catalogo spiega
field ID/schema; gli eventi non ripetono descrittori completi.

### 7. Testare indipendenza dal trasporto

Aggiorna `tests/communication` e crea `tests/protocol`. Lo stesso request encoded deve
produrre byte response identici attraverso fake USB, fake TLS e fake MQTT. Copri
permission denied, handler duplicato, operation unknown, paginazione, payload massimo,
malformed CBOR, command stable key, mapping errori stabile, correlation preservation,
retry cross-transport, correlation riutilizzata con payload diverso, Config stale,
Config identica, queue piena e job timeout.

## Perché è fatto così

Protocollo, operazione e trasporto sono tre livelli diversi. Un envelope comune evita
che MQTT, USB e app acquisiscano semantiche divergenti. Handler iterable consentono
nuove operazioni senza un grande switch; context costante impedisce al peer di
auto-assegnarsi permessi.

## Come si usa

Un client legge catalogo e fingerprint, legge Config e generazione, costruisce la nuova
Config usando nomi e field ID, la valida, quindi la applica con la generazione letta.
Invia gli stessi byte CBOR su ogni adapter e abbina la risposta tramite correlation ID.
In caso di CONFLICT rilegge e rifà il merge; non forza una scrittura cieca. La Shell
resta comoda per una persona ma non è più il protocollo dell'app.

## Checklist di completamento

- [x] Envelope V1 ha encoding canonico, limite assoluto 2048 e capacità dichiarata dal profilo.
- [x] Ventisette operation ID e status pubblici sono congelati.
- [x] Handler e relativi schema request/response sono auto-registrati e catalogati.
- [x] GET_TOPOLOGY descrive più Flow/Port/Bay e stato power senza hardcode host.
- [x] GET_RESOURCES separa capacità, uso e high-water e GET_FEATURES espone i pack.
- [x] Device Profile installabili hanno operazioni bounded e autorizzate.
- [x] Permessi derivano da principal e limite dell'adapter, non dalla richiesta.
- [x] GET/VALIDATE/APPLY Config espongono hash, CAS e conflitti senza scritture cieche.
- [x] Replay cache centrale impedisce doppi effetti su ogni trasporto.
- [x] Mutazioni e job lunghi non vengono eseguiti nei callback degli adapter.
- [x] Shell e Remote Console passano da Communication V1.
- [x] Eventi record/status/discovery hanno codec bounded.
- [x] Capability, connettività, diagnostica e reset hanno contratti macchina.
- [x] Catalog fingerprint e versioni permettono cache host invalidabile dopo OTA.
- [x] Tre fake transport producono lo stesso risultato.

## Verifica e fine task

```sh
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/protocol -T tests/communication \
  -T tests/remote_console -p native_sim/native/64 \
  --inline-logs --clobber-output'
make pristine
```

Il risultato atteso è un protocollo macchina stabile che non espone Zephyr Shell né
dettagli C nei payload.
