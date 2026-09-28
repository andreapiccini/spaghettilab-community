# TASK-370-01 — Collegare MQTT e Node-RED

**Stato:** ✅ DONE
**Fase:** 370 — MQTT per Node-RED V1

## Cosa devo fare

### 1. Definire identità e topic stabili

Estendi `struct spaghetti_mqtt_config` in `include/spaghetti/mqtt.h`:

```c
enum spaghetti_mqtt_security {
	SPAGHETTI_MQTT_SECURITY_TLS_SERVER,
	SPAGHETTI_MQTT_SECURITY_TLS_MUTUAL,
	SPAGHETTI_MQTT_SECURITY_PLAINTEXT_DEVELOPMENT,
};

struct spaghetti_mqtt_config {
	bool enabled;
	char host[SPAGHETTI_MQTT_HOST_SIZE];
	uint16_t port;
	char base_topic[SPAGHETTI_MQTT_BASE_TOPIC_SIZE];
	enum spaghetti_mqtt_security security;
	uint16_t credential_id;
};
```

`core_id` non è configurabile qui: MQTT usa la rappresentazione canonica del
`device_id` immutabile definito nella fase 355. Il nome amichevole resta metadata.
`credential_id`
seleziona un record secure storage senza mettere CA/password/private key nella Config.
Plaintext è compilabile soltanto con
`CONFIG_SPAGHETTI_MQTT_ALLOW_PLAINTEXT_DEVELOPMENT=y`, default `n` nelle board di
produzione.

Topic V1, tutti sotto `<base>/v1/cores/<core_id>`:

```text
/state                         retained QoS 1
/catalog                       retained QoS 1, paginato
/modules/<key>/records         QoS 0, non retained
/discovery                     QoS 1, non retained
/requests/<client_id>          subscribe QoS 1
/responses/<client_id>         publish QoS 1
```

Payload sono gli envelope/eventi CBOR della fase 360. Non creare JSON differente nel
firmware; il flow Node-RED traduce CBOR in oggetti JavaScript.

### 2. Provisionare credenziali senza Config o log

Crea `include/spaghetti/mqtt_credentials.h` e backend PSA ITS simile alle credenziali
console, ma con namespace e lifecycle separati:

```c
int spaghetti_mqtt_credentials_set(
	uint16_t credential_id,
	spaghetti_principal_id_t principal_id,
	const uint8_t *ca,
	size_t ca_size,
	const uint8_t *client_certificate,
	size_t client_certificate_size,
	const uint8_t *private_key,
	size_t private_key_size);
int spaghetti_mqtt_credentials_clear(uint16_t credential_id);
int spaghetti_mqtt_credentials_exists(
	uint16_t credential_id,
	bool *out_exists);
```

`principal_id` passa per valore e lega la credenziale ai ruoli/permessi della fase 355;
la funzione fallisce con `-ENOENT` se il principal non esiste o è revocato. I buffer
sono borrowed e mai loggati; set è ammesso soltanto dalla Maintenance locale.
TLS server richiede CA e hostname verification; mutual richiede anche certificato e
chiave. Output exists cambia solo al successo. Capacità certificate/Kconfig è bounded.

### 3. Rendere MQTT bidirezionale

Apri `subsys/services/mqtt/mqtt.c`. Il worker:

1. connette e sottoscrive request topic;
2. pubblica state/catalog retained dopo ogni reconnect;
3. trasforma record/discovery in eventi Protocol V1;
4. riceve request, verifica topic/client ID/dimensione;
5. risolve la credenziale MQTT nel principal della fase 355 e costruisce il context
   usando l'intersezione fra permessi MQTT e permessi del principal;
6. chiama `spaghetti_communication_handle_request()`;
7. pubblica sempre una response correlata con lo status pubblico V1.

MQTT viene registrato nel Service Manager della fase 294 e avviato soltanto dal
Connectivity Manager. Prima di aprire TLS acquisisce
`SPAGHETTI_SECURE_OWNER_MQTT`; stop chiude socket, rilascia workspace e restituisce le
risorse. Sul profilo Minimal è compilato solo quando la board lo abilita esplicitamente.

Non creare una cache correlation nell'adapter: un duplicato QoS 1 viene riconosciuto
dalla replay cache centrale della fase 360 usando principal e correlation ID, quindi
la risposta viene ripubblicata senza riapplicare Config/comando. Client ID ha limite 32
e viene validato prima di costruire il topic. Nessun callback MQTT esegue Config o
Manager: copia la request nella queue Communication e lascia lavorare il thread owner.

### 4. Gestire rete assente e backpressure

MQTT registra un consumer Record Delivery con ID stabile, lo attiva soltanto mentre il
servizio è operativo e fa ACK per quel consumer solo dopo consegna accettata. L'ACK non
sposta BLE.
Se la coda sovrascrive record vecchi, pubblica il contatore di perdita; non crea una
seconda history privata. State e response QoS 1 hanno pool separato e priorità.
Config/command non vengono mai
silenziosamente scartati. Reconnect usa backoff bounded con jitter. Un certificato
errato, hostname errato o broker non autenticato lascia MQTT DEGRADED senza fermare
Runtime/USB.

### 5. Fornire un flow Node-RED di riferimento

Crea `examples/node_red/spaghetti_v1_flow.json` e README. Il flow:

- sottoscrive state/catalog/records/discovery;
- decodifica CBOR;
- mantiene una mappa schema/field ID → nome/unità;
- mostra due schemi diversi in debug/dashboard;
- genera correlation ID;
- invia GET_STATUS, GET_CONFIG, VALIDATE_CONFIG, APPLY_CONFIG e MODULE_COMMAND;
- mantiene un solo Config Coordinator: i nodi Module producono frammenti desiderati,
  il coordinator legge snapshot/generazione, esegue merge, valida e applica CAS;
- su CONFLICT rilegge Config e ripete il merge, senza forzare una snapshot vecchia;
- abbina response e mostra lo status V1 leggibile;
- memorizza il catalogo usando il fingerprint e lo invalida quando cambia;
- non contiene broker password, PSK o certificati.

Il flow è esempio/importabile, non owner della logica firmware.

## Perché è fatto così

Node-RED usa MQTT come trasporto, non come seconda API. Topic isolano Core/client,
Protocol V1 conserva semantica e correlation, catalogo rende i dati espandibili.
Separare credenziali da Config evita che snapshot, log o payload applicativi contengano
segreti.

## Come si usa

Provisiona credential in Maintenance, applica MQTT Config, importa il flow e imposta
solo broker/core ID nel deployment Node-RED. I nuovi driver compaiono nel catalogo e i
record vengono interpretati senza cambiare `mqtt.c`.

## Checklist di completamento

- [x] Topic V1 e QoS sono documentati e stabili.
- [x] TLS verifica CA e hostname; mutual TLS è supportato.
- [x] Credenziali sono provisionate soltanto localmente.
- [x] Credenziali risolvono principal revocabili e request duplicate non ripetono effetti.
- [x] MQTT ha un consumer record indipendente da BLE.
- [x] Backpressure usa Record Delivery e non blocca response/state.
- [x] Lifecycle e TLS workspace rispettano profilo e Connectivity Manager.
- [x] Flow Node-RED usa un solo Config Coordinator con GET/validate/CAS apply.

## Verifica e fine task

```sh
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/mqtt -T tests/communication \
  -p native_sim/native/64 --inline-logs --clobber-output'
make pristine
```

Con un broker TLS di test, verifica CA/hostname corretti, CA errata, reconnect,
duplicate request e due record schema differenti. Il risultato atteso è Node-RED
operativo senza dipendenze INA219 nel servizio MQTT. Aggiungi due flow che modificano
la Config dalla stessa generazione: il secondo deve ricevere CONFLICT, rileggere,
rifare il merge e non perdere la modifica del primo.
