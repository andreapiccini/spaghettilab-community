# TASK-297-01 — Descrivere Flow, Bay e connettori

**Stato:** ✅ DONE
**Fase:** 297 — Topologia fisica dei Flow

## Cosa devo fare

Un `Flow` è un percorso fisico di cinque segnali fra il lato field e il Core. Un Core
base può avere un Flow di ingresso e uno di uscita; un Core più grande ne espone di
più. Una Function Bay è una posizione ordinata lungo il Flow. La `Port` è soltanto
la terminazione controllabile dal firmware: non coincide con una Bay e continua a
supportare più Module sullo stesso bus.

Devicetree descrive a build-time ciò che esiste sulla board. Config sceglie a runtime
come usarlo, ma non può creare Flow, Bay o pin assenti. Apri
`dts/bindings/spaghetti/spaghettilab,flow.yaml`, crea
`include/spaghetti/topology.h`, `subsys/topology/topology.c`,
`subsys/topology/README.md` e `tests/topology/`; aggiungi il sottosistema ai file
CMake/Kconfig dell'applicazione.

Scrivi il contratto pubblico:

```c
#define SPAGHETTI_FLOW_SIGNAL_COUNT 5U
#define SPAGHETTI_BAY_ID_UNSPECIFIED UINT8_MAX

typedef uint8_t spaghetti_flow_id_t;
typedef uint8_t spaghetti_bay_id_t;

enum spaghetti_flow_direction {
	SPAGHETTI_FLOW_FIELD_TO_CORE,
	SPAGHETTI_FLOW_CORE_TO_FIELD,
	SPAGHETTI_FLOW_BIDIRECTIONAL,
};

struct spaghetti_flow_descriptor {
	spaghetti_flow_id_t id;
	spaghetti_port_id_t port_id;
	enum spaghetti_flow_direction direction;
	uint8_t signal_count;
	uint8_t function_bay_count;
};

struct spaghetti_bay_descriptor {
	spaghetti_flow_id_t flow_id;
	spaghetti_bay_id_t id;
	uint8_t ordinal_from_field;
};

int spaghetti_topology_init(void);
size_t spaghetti_topology_flow_count(void);
const struct spaghetti_flow_descriptor *spaghetti_topology_flow_get(
	spaghetti_flow_id_t id);
const struct spaghetti_flow_descriptor *spaghetti_topology_flow_for_port(
	spaghetti_port_id_t port_id);
int spaghetti_topology_bay_get(
	spaghetti_flow_id_t flow_id,
	spaghetti_bay_id_t bay_id,
	struct spaghetti_bay_descriptor *out);
```

Gli ID sono piccoli valori copiati, stabili per una variante Core e mai puntatori.
I descrittori Flow sono `const`, posseduti dal sottosistema e validi per tutta la vita
del firmware. `out` della Bay è caller-owned e cambia solo al successo. `ordinal_from_field`
vale zero per la Bay più vicina al connettore field, indipendentemente dalla direzione
elettrica. `SPAGHETTI_BAY_ID_UNSPECIFIED` permette una Config valida quando il Core
attuale non può conoscere la posizione fisica.

`init()` verifica ID univoci, esistenza della Port, una sola associazione Flow→Port,
`signal_count == 5` e limiti del profilo; restituisce `0`, `-EALREADY`, `-EINVAL`,
`-ENOENT` o `-E2BIG`. Le lookup restituiscono un puntatore borrowed oppure `NULL`.
`bay_get()` restituisce `0`, `-EINVAL` o `-ENOENT`.

Apri `subsys/core/core.c` e chiama `spaghetti_topology_init()` subito dopo
`spaghetti_port_init_all()` e prima di Power, Registry, Config e Discovery. Se fallisce,
esegui lo stesso unwind usato dal boot per i sottosistemi già inizializzati e non
avviare Runtime: Config non deve osservare una topologia parziale.

Nel binding usa `reg` come Flow ID, un phandle `port`, la stringa `direction` con i
tre valori precedenti, `signal-count = <5>` e `function-bay-count`. Genera i
descrittori con macro `DT_FOREACH_STATUS_OKAY`; non analizzare il DTS a runtime.
Non inserire numeri di GPIO: appartengono al nodo Port e ai pinctrl della board.

La board ESP32-C3 di sviluppo può dichiarare un Flow per la Port 0 con
`function-bay-count = <0>` se il prototipo non possiede ancora il backbone. Il test
`native_sim` deve invece dichiarare almeno due Flow con numeri diversi di Bay per
provare che l'API non assume un solo percorso.

Esempio d'uso:

```c
const struct spaghetti_flow_descriptor *flow =
	spaghetti_topology_flow_for_port(0U);

if (flow != NULL) {
	LOG_INF("flow=%u direction=%u signals=%u bays=%u",
		flow->id, flow->direction, flow->signal_count,
		flow->function_bay_count);
}
```

## Perché è fatto così

Flow descrive la forma sostituibile del Core; Port descrive l'accesso hardware;
Module descrive una funzione runtime. Separarli evita di trasformare una board con
più percorsi in una serie di eccezioni e permette all'interfaccia host di disegnare
la topologia reale senza conoscere il modello di Core.

## Come si usa

Core chiama `spaghetti_topology_init()` dopo Port. Config e Discovery possono
associare una posizione opzionale a un Module. Il Protocollo V1 esporrà gli stessi
descrittori; React Flow li userà per creare corsie e Bay, senza hardcode per ESP32-C3.

## Checklist di completamento

- [x] Flow, Bay, direzione e terminazione Port hanno API bounded.
- [x] Ogni Flow dichiara esattamente cinque segnali.
- [x] Devicetree contiene topologia ma non decisioni runtime o GPIO duplicati.
- [x] Port resta condivisibile da più Module.
- [x] Board attuale non dichiara Bay inesistenti.
- [x] Fake con più Flow supera lookup e validazione negativa.

## Verifica e fine task

```sh
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/topology -p native_sim/native/64 \
  --inline-logs --clobber-output'
make pristine
```

Il risultato atteso è una topologia enumerabile con soli descrittori statici, cinque
segnali per Flow e nessuna dipendenza da un driver concreto.
