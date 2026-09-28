# TASK-296-01 — Implementare health supervisor e watchdog

**Stato:** ✅ DONE
**Fase:** 296 — Health supervisor e watchdog

## Cosa devo fare

### Capire il watchdog Zephyr prima di usarlo

Un watchdog hardware è un timer periferico che riavvia il microcontrollore se il
firmware non lo alimenta entro una finestra. Il driver Zephyr espone `struct device` e
le funzioni di `zephyr/drivers/watchdog.h` a runtime; Devicetree descrive l'eventuale
periferica e la chosen node `zephyr,watchdog` permette alla board di indicare quale
istanza usare. Kconfig compila l'API. Il watchdog non dimostra che il sistema è sano se
ogni thread può alimentarlo: per questo solo Health Supervisor chiamerà `wdt_feed()`.

Apri il DTS della board reale sotto `boards/spaghettilab/`, poi verifica l'output in
`build/app/zephyr/zephyr.dts`. Usa `DT_HAS_CHOSEN(zephyr_watchdog)` soltanto se la chosen
esiste davvero; non inventare il nodo su Core V1. Se manca, compila il monitor software,
pubblica capability `hardware_watchdog=false` e non chiama `DEVICE_DT_GET()`.

### Creare il contratto health

Crea `include/spaghetti/health.h`, `subsys/core/health.c`, il relativo CMake/Kconfig e
`tests/health/`. Scrivi:

```c
typedef uint16_t spaghetti_health_component_id_t;
typedef uint32_t spaghetti_health_window_token_t;

enum spaghetti_health_state {
	SPAGHETTI_HEALTH_STARTING,
	SPAGHETTI_HEALTH_HEALTHY,
	SPAGHETTI_HEALTH_DEGRADED,
	SPAGHETTI_HEALTH_STALE,
};

struct spaghetti_health_component_descriptor {
	spaghetti_health_component_id_t id;
	const char *name;
	uint32_t maximum_silence_ms;
	uint32_t required_core_modes;
};

struct spaghetti_health_status {
	enum spaghetti_health_state state;
	bool hardware_watchdog_available;
	spaghetti_health_component_id_t stale_component_id;
	uint32_t last_reset_cause;
	uint32_t watchdog_feed_count;
};

#define SPAGHETTI_HEALTH_COMPONENT_DEFINE(name) \
	const STRUCT_SECTION_ITERABLE( \
		spaghetti_health_component_descriptor, name)

int spaghetti_health_init(void);
int spaghetti_health_start(void);
int spaghetti_health_heartbeat(spaghetti_health_component_id_t component_id);
int spaghetti_health_window_acquire(
	spaghetti_health_component_id_t component_id,
	k_timeout_t duration,
	spaghetti_health_window_token_t *out_token);
int spaghetti_health_window_release(spaghetti_health_window_token_t token);
int spaghetti_health_get_status(struct spaghetti_health_status *out);
```

I descriptor sono `const`, appartengono al componente e vivono per tutta l'immagine.
`component_id` passa per valore perché è piccolo e non viene conservato come puntatore.
Ogni owner chiama `heartbeat()` dal proprio worker dopo aver completato lavoro utile,
non da un timer cieco. `out_token` e `out` sono caller-owned e cambiano solo al
successo. Una window estende temporaneamente la deadline del solo componente per OTA,
Storage o flash; ha durata massima Kconfig, token non zero e scade automaticamente.

Registra almeno Runtime, Communication, Connectivity Manager e Update. Un componente è
richiesto soltanto nelle modalità indicate dal descriptor: MQTT fermo in LOW_ENERGY
non è stale. Il numero dei descriptor e delle finestre deriva dal profilo 291.

### Implementare il supervisor

`spaghetti_health_start()` crea un solo thread owner. A ogni intervallo:

1. acquisisce una snapshot degli heartbeat;
2. determina i componenti richiesti nella modalità Core corrente;
3. applica eventuali finestre non scadute;
4. marca STALE il primo componente oltre deadline e registra ID/uptime;
5. alimenta il watchdog soltanto se tutti i componenti richiesti sono sani;
6. pubblica DEGRADED se non esiste watchdog hardware, senza fingere protezione;
7. non prova recovery distruttive dal callback watchdog.

Quando la board ha `zephyr,watchdog`, ottieni il device con
`DEVICE_DT_GET(DT_CHOSEN(zephyr_watchdog))`, verifica `device_is_ready()`, installa un
timeout con `wdt_install_timeout()`, abilita con `wdt_setup()` e conserva il channel ID
privatamente in `health.c`. Solo il thread supervisor usa `wdt_feed()`.

All'avvio leggi la causa reset con `hwinfo_get_reset_cause()` quando supportato e poi
chiama `hwinfo_clear_reset_cause()`. Esponi il valore grezzo soltanto insieme a una
classificazione stabile nel Protocol V1; non scrivere continuamente NVS per ogni
heartbeat.

### Collegare Core e Protocollo

Core inizializza Health dopo Storage/mode e prima dei worker sorvegliati, avvia i
worker, poi avvia il supervisor. Il task 360 aggiunge reset cause, health state e stale
component a GET_STATUS. Il task 390 deve simulare un worker fermo e verificare che il
fake watchdog scada.

Errori: `-EINVAL` per ID/token/durata non validi, `-ENOENT` per componente sconosciuto,
`-EALREADY` per start doppio, `-ENOMEM` quando il pool finestre bounded è pieno,
`-ETIMEDOUT` per token già scaduto, errore driver se setup/feed hardware fallisce.

## Perché è fatto così

Un watchdog alimentato da Runtime potrebbe continuare a essere alimentato mentre
Communication o Update sono bloccati. Il supervisor combina più heartbeat e rende il
riavvio una conseguenza misurabile. Le finestre bounded permettono operazioni lente
senza trasformare OTA in una disabilitazione permanente della sicurezza.

## Come si usa

```c
SPAGHETTI_HEALTH_COMPONENT_DEFINE(runtime_health) = {
	.id = 1U,
	.name = "runtime",
	.maximum_silence_ms = 3000U,
	.required_core_modes = BIT(SPAGHETTI_CORE_MODE_NORMAL),
};

/* Nel worker Runtime, dopo un ciclo completato: */
(void)spaghetti_health_heartbeat(runtime_health.id);
```

## Checklist di completamento

- [x] Descriptor e stato sono statici, bounded e derivati dal profilo.
- [x] Solo il supervisor chiama `wdt_feed()`.
- [x] Worker inattivi per policy non vengono considerati stale.
- [x] Window OTA/flash è limitata, tracciata e scade automaticamente.
- [x] Board senza chosen watchdog compila e dichiara la capability corretta.
- [x] Reset cause e componente stale sono leggibili senza indirizzi o segreti.

## Verifica e fine task

```sh
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/health -p native_sim/native/64 \
  --inline-logs --clobber-output'
make pristine
```

Il fake deve provare boot sano, heartbeat mancante, modalità in cui un componente non è
richiesto, window valida/scaduta, pool pieno, reset cause e garanzia che nessun owner
diverso dal supervisor alimenti il watchdog.
