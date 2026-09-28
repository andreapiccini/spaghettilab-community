# TASK-366-01 — Aggiornare il Core via BLE

**Stato:** ✅ DONE
**Fase:** 366 — OTA tramite BLE

## Cosa devo fare

Crea `subsys/services/ota/ota_ble.c`, aggiorna `include/spaghetti/ota.h`, il Protocollo
360 e `tests/ota_ble/`. Non chiamare direttamente flash API fuori da Update Coordinator.

```c
struct spaghetti_ble_update_begin {
	uint32_t image_size;
	uint8_t image_sha256[32];
	char version[SPAGHETTI_CORE_VERSION_SIZE];
};

int spaghetti_ota_ble_open(
	const struct spaghetti_ble_update_begin *request,
	uint32_t *session_id);
int spaghetti_ota_ble_write(uint32_t session_id, uint32_t offset,
			    const uint8_t *bytes, size_t size);
int spaghetti_ota_ble_finish(uint32_t session_id);
int spaghetti_ota_ble_cancel(uint32_t session_id);
```

Begin request e bytes sono borrowed solo per la chiamata; `session_id` è caller-owned.
`write()` accetta offset esatto atteso e chunk bounded dal MTU. L'adapter passa begin,
write, finish e cancel al coordinatore esistente, che possiede timeout, slot secondario,
hash, firma e reboot trial. Un disconnect avvia un breve timeout di resume; dopo la
scadenza cancella e conserva l'immagine confermata.

Solo un peer BLE autenticato con permission UPDATE può aprire la sessione. Runtime viene
quiesciuto e gli output vanno in safe state prima del primo erase. MQTT, Wi-Fi OTA e
Maintenance UART ricevono `-EBUSY` finché BLE è owner.

## Perché è fatto così

MCUboot e Update Coordinator sono già la sorgente di verità. BLE cambia soltanto come
arrivano i chunk, non verifica, rollback o conferma dell'immagine.

## Come si usa

Il client invia begin, chunk sequenziali, finish e osserva reboot trial. Dopo health
window l'immagine viene confermata; una perdita prima di finish lascia avviabile quella
precedente.

## Checklist di completamento

- [x] BLE usa Update Coordinator senza secondo writer flash.
- [x] Un solo trasporto possiede la sessione.
- [x] Resume/cancel/timeout sono bounded.
- [x] Firma e compatibilità profilo sono verificate.
- [x] Perdita BLE non tocca l'immagine confermata.

## Verifica e fine task

```sh
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/ota_ble -T tests/update \
  -p native_sim/native/64 --inline-logs --clobber-output'
```

La qualifica fisica finale aggiunge reset durante begin/write/finish e rollback MCUboot.
