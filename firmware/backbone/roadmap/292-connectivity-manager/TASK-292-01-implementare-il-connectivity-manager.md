# TASK-292-01 — Implementare il Connectivity Manager

**Stato:** ✅ DONE
**Fase:** 292 — Connectivity Manager

## Cosa devo fare

Crea `include/spaghetti/connectivity.h`, `subsys/connectivity/connectivity.c`, il relativo
`CMakeLists.txt`, aggiorna il `CMakeLists.txt` applicativo e crea `tests/connectivity/`.
In questa fase usa backend fake: non accendere ancora Bluetooth.

```c
enum spaghetti_connectivity_policy {
	SPAGHETTI_CONNECTIVITY_LOW_ENERGY,
	SPAGHETTI_CONNECTIVITY_ONLINE,
};

enum spaghetti_connectivity_service {
	SPAGHETTI_CONNECTIVITY_SERVICE_BLE = BIT(0),
	SPAGHETTI_CONNECTIVITY_SERVICE_WIFI = BIT(1),
	SPAGHETTI_CONNECTIVITY_SERVICE_MQTT = BIT(2),
	SPAGHETTI_CONNECTIVITY_SERVICE_REMOTE_CONSOLE = BIT(3),
};

struct spaghetti_connectivity_lease_request {
	uint32_t services;
	uint32_t duration_ms;
};

struct spaghetti_connectivity_snapshot {
	enum spaghetti_connectivity_policy policy;
	uint32_t active_services;
	uint32_t leased_services;
	int64_t lease_expires_at_ms;
	int last_error;
};

int spaghetti_connectivity_init(enum spaghetti_connectivity_policy boot_policy);
int spaghetti_connectivity_set_policy(enum spaghetti_connectivity_policy policy);
int spaghetti_connectivity_acquire_lease(
	const struct spaghetti_connectivity_lease_request *request);
int spaghetti_connectivity_release_lease(void);
int spaghetti_connectivity_get_snapshot(
	struct spaghetti_connectivity_snapshot *out);
```

`boot_policy` e `policy` sono enum passati per valore. `request` è borrowed solo per la
chiamata; il Manager copia servizi, durata e deadline. `out` è caller-owned. Una lease
accetta solo durate bounded definite in Kconfig, usa `k_uptime_get()` e scade tramite
delayed work. Reboot, release, fallimento di associazione o timeout ripristinano la
policy persistente.

Implementa la transizione in quest'ordine: calcola stato desiderato, verifica capability
del task 291, avvia i backend necessari, pubblica lo stato soltanto al successo; in
errore arresta ciò che ha appena avviato e conserva la policy precedente. Accendere
Wi-Fi non apre OTA né console remota. `LOW_ENERGY` mantiene Runtime ma ferma Wi-Fi e
MQTT; `ONLINE` permette Wi-Fi/MQTT e BLE contemporanei entro i limiti del profilo.

Definisci un backend interno con callback `start(service)` e `stop(service)` per i test.
Le fasi 294, 365 e 370 collegheranno i servizi reali. La fase 330 aggiungerà `policy` al
Config persistente: fino ad allora Core passa il default Kconfig a `init()`.

## Perché è fatto così

Wi-Fi Profiles conosce le reti, MQTT conosce il broker e BLE conosce i peer; nessuno di
loro deve decidere la politica energetica complessiva. Un solo owner impedisce avvii
concorrenti e lease che sopravvivono accidentalmente al reboot.

## Come si usa

```c
const struct spaghetti_connectivity_lease_request lease = {
	.services = SPAGHETTI_CONNECTIVITY_SERVICE_WIFI,
	.duration_ms = 120000U,
};
int rc = spaghetti_connectivity_acquire_lease(&lease);
```

## Checklist di completamento

- [x] LOW_ENERGY e ONLINE hanno transizioni deterministiche.
- [x] Lease ha limite, deadline assoluta e rollback.
- [x] Wi-Fi non abilita implicitamente OTA o console.
- [x] Capability assente restituisce `-ENOTSUP`.
- [x] Backend fake prova errori, timeout, release e reboot logico.

## Verifica e fine task

```sh
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/connectivity -p native_sim/native/64 --inline-logs --clobber-output'
```

Il risultato atteso è una macchina a stati provabile senza radio e senza chiamate di
rete fuori dal suo owner.
