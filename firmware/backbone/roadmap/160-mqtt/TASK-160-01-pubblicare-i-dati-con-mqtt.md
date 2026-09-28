# TASK-160-01 — Pubblicare i dati con MQTT

**Stato:** ✅ DONE
**Fase:** 160 — MQTT

## Cosa devo fare

Apri questi file:

- `include/spaghetti/mqtt.h`: API pubblica, configurazione copiata, pubblicazione e stato;
- `subsys/services/mqtt/mqtt.c`: callback IPv4, adapter zbus e worker MQTT;
- `subsys/data/data.c`: subscriber MQTT del channel elettrico;
- `include/spaghetti/config.h` e `subsys/config/config.c`: impostazioni MQTT validate e applicate;
- `subsys/config/config_cbor.c` e `subsys/config/spaghetti_config_v1.cddl`: Config wire V1;
- `subsys/core/core.c`: inizializzazione iniziale del servizio disabilitato;
- `CMakeLists.txt`, `Kconfig` e `prj.conf`: sorgente, limiti e opzioni Zephyr;
- `tests/mqtt/`: test nativi senza rete reale.

Il percorso di sviluppo è Wi-Fi station ESP32-C3, DHCPv4, DNS, TCP non cifrato e
MQTT 3.1.1 QoS 0. SSID e password non entrano nel codice. La fase 165 aggiunge
profili persistenti; il comando attuale è:

```text
spaghetti wifi add "YOUR_SSID" wpa2
Password (input is hidden):
```

`NET_EVENT_IPV4_ADDR_ADD`, non la sola associazione Wi-Fi, indica al worker che può
provare DNS e connessione.

Scrivi in `include/spaghetti/mqtt.h` questi contratti pubblici:

```c
#define SPAGHETTI_MQTT_HOST_SIZE 64U
#define SPAGHETTI_MQTT_TOPIC_SIZE 96U
#define SPAGHETTI_MQTT_TOPIC_SUFFIX_SIZE 32U
#define SPAGHETTI_MQTT_PAYLOAD_SIZE 128U

struct spaghetti_mqtt_config {
	bool enabled;
	char host[SPAGHETTI_MQTT_HOST_SIZE];
	uint16_t port;
	char base_topic[SPAGHETTI_MQTT_TOPIC_SIZE];
};

struct spaghetti_mqtt_publication {
	char topic_suffix[SPAGHETTI_MQTT_TOPIC_SUFFIX_SIZE];
	size_t payload_size;
	uint8_t payload[SPAGHETTI_MQTT_PAYLOAD_SIZE];
};

enum spaghetti_mqtt_state {
	SPAGHETTI_MQTT_STOPPED,
	SPAGHETTI_MQTT_WAIT_NETWORK,
	SPAGHETTI_MQTT_CONNECTED,
	SPAGHETTI_MQTT_ERROR,
};

struct spaghetti_mqtt_status {
	enum spaghetti_mqtt_state state;
	uint32_t queued;
	uint32_t published;
	uint32_t dropped;
	int last_error;
};

int spaghetti_mqtt_init(const struct spaghetti_mqtt_config *config);
int spaghetti_mqtt_start(void);
int spaghetti_mqtt_stop(k_timeout_t timeout);
int spaghetti_mqtt_publish(
	const struct spaghetti_mqtt_publication *publication);
int spaghetti_mqtt_get_status(struct spaghetti_mqtt_status *out);
```

`config` e `publication` sono puntatori `const` perché il servizio legge oggetti del
chiamante senza modificarli. Entrambi vengono copiati: il chiamante può riusare o
distruggere l'originale al ritorno. `timeout` è passato per valore perché è una piccola
durata Zephyr; limita l'attesa dell'ack di stop. `out` è un puntatore scrivibile perché
il servizio vi copia una snapshot che poi appartiene al chiamante.

Le funzioni fanno questo:

1. `spaghetti_mqtt_init()` valida e copia Config, abilita/disabilita il subscriber e
   avvia le due thread statiche soltanto alla prima chiamata. Restituisce `-EINVAL` per
   campi invalidi e `-EBUSY` se si tenta di riconfigurare un servizio non fermo.
2. `spaghetti_mqtt_start()` accoda il comando di avvio senza aprire socket nel
   chiamante. Restituisce `-EACCES` se disabilitato, `-EALREADY` se già avviato e
   `-ENOMSG` se la coda comandi è piena.
3. `spaghetti_mqtt_stop()` chiede stop, disconnessione e purge della coda. Restituisce
   `-EAGAIN` se il worker non risponde entro `timeout`.
4. `spaghetti_mqtt_publish()` valida e copia con `K_NO_WAIT`. Restituisce `-ENOMSG` e
   incrementa `dropped` quando la coda è piena; non chiama mai socket o DNS.
5. `spaghetti_mqtt_get_status()` copia stato e contatori sotto mutex breve.

In `mqtt.c` usa due thread statiche. L'adapter attende
`spaghetti_electrical_message` da zbus, crea questo JSON bounded:

```json
{"module_key":10,"bus_uv":12000000,"current_ua":125000,"power_uw":1500000}
```

e lo accoda con suffisso `modules/10/electrical`. Il worker possiede
`struct mqtt_client`, buffer RX/TX da 512 byte, DNS, socket, connect, poll, input,
keepalive, publish e disconnect. Dopo un errore riprova dopo 1 secondo e raddoppia il
ritardo fino a 30 secondi. La callback di rete modifica solo flag atomici e segnala un
semaforo.

Aggiungi a `struct spaghetti_config` il campo owned
`struct spaghetti_mqtt_config mqtt`. La Config interna passa da versione 2 a 3. Il
wire V0/versione 1 resta decodificabile con MQTT disabilitato; il wire V1/versione 2
aggiunge la mappa MQTT con `enabled`, `host`, `port` e `base_topic`. Config applica le
modifiche MQTT insieme a Module e Runtime e ripristina lo stato precedente se un passo
fallisce. Non usare endpoint o topic fissi nel sorgente: la scorciatoia temporanea è
stata eliminata nello stesso task.

## Perché è fatto così

Runtime deve continuare a campionare anche quando Wi-Fi, DNS o broker sono lenti. La
coda bounded rende memoria e backpressure deterministiche; il worker unico impedisce
accessi concorrenti al client MQTT. Il topic usa la Module key stabile e non la Port,
perché più Module possono condividere Port 0.

Il topic completo è:

```text
<base_topic>/modules/<source_key>/electrical
```

MQTT è opzionale e la Config disabilitata canonica contiene `enabled=false`, stringhe
vuote e porta zero. Questa fase usa TCP/1883 senza TLS: non inviare credenziali o dati
sensibili finché una fase successiva non aggiunge autenticazione e cifratura.

## Come si usa

Config crea e applica la configurazione; normalmente non serve pubblicare a mano:

```c
const struct spaghetti_mqtt_config mqtt = {
	.enabled = true,
	.host = "192.0.2.10",
	.port = 1883U,
	.base_topic = "spaghetti/dev",
};

int err = spaghetti_mqtt_init(&mqtt);
if (err == 0) {
	err = spaghetti_mqtt_start();
}
```

Un producer generico può accodare direttamente una copia:

```c
const struct spaghetti_mqtt_publication publication = {
	.topic_suffix = "modules/10/electrical",
	.payload_size = sizeof("{\"module_key\":10}") - 1U,
	.payload = "{\"module_key\":10}",
};

int err = spaghetti_mqtt_publish(&publication);
```

## Concetto Zephyr da sapere

Il Device Wi-Fi è selezionato a build-time dal driver ESP32, mentre associazione,
DHCP, DNS e MQTT avvengono a runtime. `net_mgmt` consegna eventi sull'interfaccia di
rete; `k_msgq` copia elementi di dimensione fissa senza heap; zbus copia il campione
dal channel nelle FIFO dei subscriber. Il file reale delle opzioni prodotto è
`prj.conf`; la configurazione risolta è verificabile in `build/zephyr/.config`.

## Checklist di completamento

- [x] Wi-Fi ESP32, DHCPv4, DNS e MQTT Zephyr sono abilitati.
- [x] Le credenziali vengono inserite dalla shell e non sono versionate nel repository.
- [x] La callback considera pronta la rete solo dopo un indirizzo IPv4.
- [x] Socket e reconnessione appartengono al worker MQTT.
- [x] Queue, buffer, stack e backoff hanno limiti fissi.
- [x] Topic e JSON distinguono la sorgente tramite Module key.
- [x] Endpoint e base topic arrivano da Config/CBOR V1.
- [x] Queue piena, lifecycle, formatter e adapter zbus hanno test nativi.

## Verifica e fine task

Esegui:

```sh
make validate
make pristine
docker compose run --rm dev west twister -T tests -p native_sim/native/64 \
  --inline-logs --no-clean
make flash
make monitor
```

Nella shell seriale salva il profilo col comando mostrato sopra, poi usa `wifi status`
e `net iface`. Configura un broker raggiungibile e osserva i messaggi da un PC:

```sh
mosquitto_sub -h BROKER_HOST -p 1883 \
  -t 'spaghetti/dev/modules/+/electrical' -v
```

Il risultato atteso è un JSON elettrico per ogni sample. Se spegni il broker o perdi
la rete, Runtime continua e MQTT passa in errore/attesa; al ritorno della connettività
si riconnette. La coda non è uno storico offline: può scartare campioni e incrementare
`dropped`.
