# TASK-294-01 — Rendere i servizi attivabili

**Stato:** ✅ DONE
**Fase:** 294 — Lifecycle e memoria dei servizi

## Cosa devo fare

Crea `include/spaghetti/service.h`, `subsys/services/service_manager.c`,
`subsys/services/service_thread.c`, `subsys/services/service_registry.c` e
`tests/service_manager/`. Migra poi Wi-Fi Profiles, MQTT, OTA e Remote Console senza
cambiare il loro protocollo pubblico.

```c
enum spaghetti_service_state {
	SPAGHETTI_SERVICE_STOPPED,
	SPAGHETTI_SERVICE_STARTING,
	SPAGHETTI_SERVICE_RUNNING,
	SPAGHETTI_SERVICE_STOPPING,
	SPAGHETTI_SERVICE_DEGRADED,
};

struct spaghetti_service_ops {
	int (*start)(void);
	int (*stop)(k_timeout_t timeout);
};

struct spaghetti_service_descriptor {
	const char *id;
	uint32_t required_capabilities;
	const struct spaghetti_service_ops *ops;
};

int spaghetti_service_start(const char *id);
int spaghetti_service_stop(const char *id, k_timeout_t timeout);
int spaghetti_service_get_state(const char *id,
				enum spaghetti_service_state *out);
int spaghetti_service_manager_init(
	const struct spaghetti_service_descriptor *descriptors,
	size_t descriptor_count);
int spaghetti_service_get_resource_snapshot(
	struct spaghetti_service_resource_snapshot *out);
```

Descriptor, ID e ops hanno lifetime firmware. Il Manager non conserva il puntatore ID
del chiamante: lo usa soltanto per lookup. Start ripetuto restituisce `-EALREADY`; stop
garantisce che socket, callback, delayed work e subscriber siano chiusi prima di
pubblicare STOPPED.

Rimuovi `K_THREAD_DEFINE` dai servizi opzionali. Dove basta, usa una workqueue condivisa;
dove serve un thread bloccante, usa `k_thread_create()` con stack ottenuto dal pool
bounded del profilo e restituito dopo `k_thread_join()`. Runtime essenziale mantiene
risorse statiche deterministiche. Nessun servizio conserva puntatori a stack o request
dopo lo stop.

In Zephyr 4.4 `k_thread_stack_alloc()` usa il system heap, non il common-libc heap di
mbedTLS. Configura quindi `CONFIG_HEAP_MEM_POOL_SIZE` per profilo con margine per
metadata e allineamento: 20.480 B Minimal, 28.672 B Standard e 36.864 B Extended.
L'admission Spaghetti resta più bassa: 16.384, 24.576 e 32.768 byte richiesti.

Connectivity Manager è l'unico chiamante normale di start/stop. I test possono
chiamare direttamente il Service Manager. Registra stack peak e risorse restituite.

## Perché è fatto così

Un thread sospeso continua a occupare il proprio stack. Il lifecycle deve quindi
distinguere “non sta lavorando” da “non possiede più risorse opzionali”.

## Come si usa

```c
int rc = spaghetti_service_start("wifi");
if (rc == 0) {
	(void)spaghetti_service_stop("wifi", K_SECONDS(3));
}
```

## Checklist di completamento

- [x] Ogni servizio ha un solo owner del lifecycle.
- [x] STOPPED non conserva socket, callback o thread opzionali.
- [x] Stop ha timeout e stato DEGRADED su cleanup incompleto.
- [x] Minimal esclude i servizi vietati dal profilo.
- [x] Il test esegue 100 cicli start/stop e controlla la baseline.

## Verifica e fine task

```sh
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/service_manager -T tests/mqtt -T tests/ota \
  -p native_sim/native/64 --inline-logs --clobber-output'
```

Esegui almeno 100 cicli fake start/stop; conteggi di stack, socket e work pending devono
tornare alla baseline.
