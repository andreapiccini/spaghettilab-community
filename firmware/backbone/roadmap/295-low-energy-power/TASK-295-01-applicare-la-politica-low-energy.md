# TASK-295-01 — Applicare la politica low-energy

**Stato:** ✅ DONE
**Fase:** 295 — Politica low-energy

## Cosa devo fare

Crea `include/spaghetti/energy.h`, `subsys/power/energy.c`, aggiorna gli overlay solo
quando una wake source esiste realmente e crea `tests/energy/`.

```c
enum spaghetti_ble_availability {
	SPAGHETTI_BLE_OFF,
	SPAGHETTI_BLE_ADVERTISING,
	SPAGHETTI_BLE_WINDOWED,
};

struct spaghetti_energy_policy {
	enum spaghetti_ble_availability ble_availability;
	uint32_t advertising_window_ms;
	uint32_t advertising_period_ms;
};

int spaghetti_energy_init(const struct spaghetti_energy_policy *policy);
int spaghetti_energy_apply_connectivity(
	enum spaghetti_connectivity_policy connectivity);
int spaghetti_energy_notify_local_event(void);
```

`policy` è borrowed durante `init()` e viene copiata. Valida che una finestra sia
minore del periodo e che i limiti rientrino in Kconfig. `notify_local_event()` apre una
finestra BLE soltanto con policy WINDOWED. La fase 365 collegherà il backend BLE reale.

In `LOW_ENERGY`: Runtime e regole restano attivi, Wi-Fi/MQTT sono STOPPED, il workspace
TLS è libero e BLE segue la policy. In `ONLINE`: non forzare sleep mentre un servizio
ha una lease. Abilita Zephyr runtime PM solo per device che lo supportano e non sospendere
un controller con transazione Port attiva. Non configurare wake GPIO inesistenti.

Registra uptime attivo, tempo radio attiva, numero finestre e wake reason in una snapshot
interna esposta poi dal Protocollo 360. Il consumo in microampere rimane una prova
hardware della fase di qualifica, non un valore simulato.

## Perché è fatto così

Disconnettere MQTT non spegne automaticamente il Wi-Fi e “BLE-first” non significa
trasmettere continuamente. Una policy esplicita permette di scegliere reperibilità e
consumo senza cambiare Runtime o Config dei Module.

## Come si usa

```c
const struct spaghetti_energy_policy policy = {
	.ble_availability = SPAGHETTI_BLE_WINDOWED,
	.advertising_window_ms = 10000U,
	.advertising_period_ms = 300000U,
};
(void)spaghetti_energy_init(&policy);
```

## Checklist di completamento

- [x] LOW_ENERGY arresta realmente i servizi IP.
- [x] BLE off/advertising/windowed sono stati distinti.
- [x] Runtime continua quando la radio è spenta.
- [x] PM non sospende device o Port occupati.
- [x] Metriche software sono separate dalle future misure elettriche.

## Verifica e fine task

```sh
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/energy -T tests/connectivity \
  -p native_sim/native/64 --inline-logs --clobber-output'
```

Il risultato atteso è una sequenza fake ripetibile di radio on/off e nessuna promessa
di consumo non misurata.
