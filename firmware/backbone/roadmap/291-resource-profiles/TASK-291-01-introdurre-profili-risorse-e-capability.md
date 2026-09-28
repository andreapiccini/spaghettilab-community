# TASK-291-01 — Introdurre profili di risorse e capability

**Stato:** ✅ DONE
**Fase:** 291 — Profili di risorse e capability

## Cosa devo fare

Apri `Kconfig`, i `*_defconfig` sotto `boards/spaghettilab/`, crea
`include/spaghetti/capabilities.h`, `subsys/core/capabilities.c` e i test
`tests/capabilities/`.

In Kconfig crea una `choice SPAGHETTI_RESOURCE_PROFILE` con una sola selezione fra
`MINIMAL`, `STANDARD` ed `EXTENDED`. La board ESP32-C3 seleziona `MINIMAL`; una board
non può cambiare profilo a runtime. Ogni scelta imposta default bounded per Module,
schedule, rule, proprietà per schema, record in coda, consumer dei record, peer BLE,
principal, richieste in volo, sessioni TLS, Flow, Function Bay, rail e servizi
opzionali. Riserva inoltre limiti unici per Device Profile persistiti e relativi byte,
operazioni di acquisition plan, Block/edge del processing graph, context attivi e
workspace condiviso; le fasi 325, 342 e 348 li useranno senza introdurre capacità
parallele. Le costanti pubbliche
continuano a provenire da `CONFIG_SPAGHETTI_*`; non duplicare numeri nei `.c`, negli
header, nei CDDL o nei test.

Scrivi il contratto:

```c
enum spaghetti_resource_profile {
	SPAGHETTI_RESOURCE_PROFILE_MINIMAL,
	SPAGHETTI_RESOURCE_PROFILE_STANDARD,
	SPAGHETTI_RESOURCE_PROFILE_EXTENDED,
};

enum spaghetti_build_capability {
	SPAGHETTI_BUILD_CAP_BLE = BIT(0),
	SPAGHETTI_BUILD_CAP_WIFI = BIT(1),
	SPAGHETTI_BUILD_CAP_MQTT = BIT(2),
	SPAGHETTI_BUILD_CAP_OTA_BLE = BIT(3),
	SPAGHETTI_BUILD_CAP_OTA_WIFI = BIT(4),
	SPAGHETTI_BUILD_CAP_REMOTE_CONSOLE = BIT(5),
	SPAGHETTI_BUILD_CAP_EXTERNAL_RAM = BIT(6),
	SPAGHETTI_BUILD_CAP_HARDWARE_WATCHDOG = BIT(7),
	SPAGHETTI_BUILD_CAP_RUNTIME_PORT_MUX = BIT(8),
	SPAGHETTI_BUILD_CAP_POWER_SWITCHING = BIT(9),
	SPAGHETTI_BUILD_CAP_POWER_MEASUREMENT = BIT(10),
};

struct spaghetti_capabilities {
	enum spaghetti_resource_profile resource_profile;
	uint32_t build_capabilities;
	uint16_t max_modules;
	uint16_t max_schedules;
	uint16_t max_rules;
	uint16_t max_device_profiles;
	uint16_t max_profile_operations;
	uint16_t max_processing_blocks;
	uint16_t max_processing_edges;
	uint16_t max_properties_per_set;
	uint16_t max_protocol_payload;
	uint16_t max_record_queue;
	uint8_t max_record_consumers;
	uint8_t max_ble_peers;
	uint8_t max_principals;
	uint8_t max_inflight_requests;
	uint8_t max_secure_sessions;
	uint8_t max_flows;
	uint8_t max_function_bays_per_flow;
	uint8_t max_power_rails;
	uint32_t replay_window_ms;
	char core_variant[32];
};

int spaghetti_capabilities_get(struct spaghetti_capabilities *out);
bool spaghetti_capabilities_support(uint32_t required);
```

`out` è caller-owned e viene scritto solo al successo. La snapshot non contiene stato
mutevole: descrive esclusivamente ciò che l'immagine ha compilato e che la board
dichiara. `support()` riceve una bitmask per valore perché non ne conserva l'indirizzo.
Core chiama `get()` per status e Update usa la stessa informazione per rifiutare un
artefatto destinato a variante/profilo incompatibile.

Definisci una sola macro di capacità per ogni dimensione, per esempio
`CONFIG_SPAGHETTI_MAX_MODULES`, e usala direttamente per Config, Module Manager, codec,
pool e capability pubblicata. Il task 310 dovrà usare
`CONFIG_SPAGHETTI_MAX_PROPERTIES_PER_SET`; i task 345 e 360 useranno rispettivamente
consumer e richieste in volo; le fasi 297 e 305 useranno Flow, Bay e rail. Un profilo
non è valido se due owner vedono limiti
diversi.

Aggiungi `BUILD_ASSERT` per relazioni impossibili, per esempio capacità Config diversa
dalla capacità Module Manager, consumer record minori dei transport compilati o
sessioni sicure maggiori del workspace disponibile. Imposta
`CONFIG_SPAGHETTI_MAX_POWER_RAILS <= 32`, perché la fase 305 usa una mask `uint32_t`
per dichiarare le rail che raggiungono una Bay. Aggiungi inoltre un test che
compila deliberatamente una combinazione incoerente e si aspetta un errore di build.
Crea `verification/resources/BASELINE.md` con flash, RAM statica, stack, pool,
workspace e limiti di ogni build, senza ancora promettere valori del PCB finale. Il
profilo dichiara capacità; la telemetria corrente/high-water e il manifest dei
Capability Pack appartengono alla fase 348. Non usare RAM libera istantanea per
selezionare un profilo o accettare una feature.

## Perché è fatto così

La memoria libera dipende dal momento in cui viene osservata e non è una capability.
Un artefatto Minimal deve avere limiti ripetibili e non deve compilare servizi che non
potrà sostenere. Devicetree continua a descrivere l'hardware; il profilo descrive il
budget software.

## Come si usa

```c
struct spaghetti_capabilities caps;

if (spaghetti_capabilities_get(&caps) == 0 &&
    spaghetti_capabilities_support(SPAGHETTI_BUILD_CAP_BLE)) {
	/* Il trasporto BLE è realmente compilato per questa board. */
}
```

## Checklist di completamento

- [x] Ogni board seleziona esattamente un profilo.
- [x] Capability e limiti derivano dalla build, non dalla RAM libera.
- [x] Config, Manager, codec, queue, slab e cataloghi usano le stesse macro del profilo.
- [x] Minimal non compila la console remota di produzione.
- [x] Update può confrontare variante, profilo e capability richieste.
- [x] Consumer, principal, richieste in volo e sessioni sicure sono bounded.
- [x] Flow, Bay e rail hanno limiti unici condivisi da firmware e protocollo.
- [x] Device Profile, acquisition plan, Block, edge e context hanno limiti unici.
- [x] Pin mux e controllo/misura power compaiono solo se la board ha backend reali.
- [x] Build assert, test negativo e baseline coprono ogni variante disponibile.

## Verifica e fine task

```sh
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/capabilities -p native_sim/native/64 --inline-logs --clobber-output'
make pristine
```

Il task termina quando due build con profili differenti producono snapshot differenti
e una combinazione statica incompatibile fallisce durante la build.
