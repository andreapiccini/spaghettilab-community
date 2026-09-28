# TASK-365-01 — Aggiungere il trasporto BLE

**Stato:** 🟨 IN PROGRESS
**Fase:** 365 — Protocollo Spaghetti su BLE

## Cosa devo fare

Bluetooth Host e controller Zephyr operano a runtime; Kconfig li compila e Devicetree
seleziona il controller disponibile. Prima di scrivere il codice verifica nel
`build/zephyr/.config` che `CONFIG_BT`, `CONFIG_BT_PERIPHERAL` e il controller ESP32
siano realmente selezionati dalla board. Non dichiarare BLE sulla capability snapshot
se `bt_enable()` non può essere usato.

Crea `subsys/communication/ble.c`, `include/spaghetti/ble.h`, i Kconfig/CMake relativi
e `tests/ble_protocol/`. Congela in `PROTOCOL_V1.md` questi UUID:

```text
service  53504748-4554-5449-4c41-420000000001
request  53504748-4554-5449-4c41-420000000002  write
response 53504748-4554-5449-4c41-420000000003  indicate
event    53504748-4554-5449-4c41-420000000004  notify
```

```c
enum spaghetti_ble_state {
	SPAGHETTI_BLE_STATE_OFF,
	SPAGHETTI_BLE_STATE_ADVERTISING,
	SPAGHETTI_BLE_STATE_AUTHENTICATING,
	SPAGHETTI_BLE_STATE_CONNECTED,
};

struct spaghetti_ble_status {
	enum spaghetti_ble_state state;
	uint16_t negotiated_mtu;
	uint8_t peer_count;
	uint32_t rx_rejected;
	uint32_t event_dropped;
};

int spaghetti_ble_start(void);
int spaghetti_ble_stop(k_timeout_t timeout);
int spaghetti_ble_get_status(struct spaghetti_ble_status *out);
```

Il client frammenta un envelope massimo da 2048 byte usando header
`message_id:uint32, offset:uint16, total:uint16`. Il firmware accetta una sola request
in ricomposizione per peer, rifiuta overlap, total oltre limite, timeout e message ID
duplicato. Indication response fornisce conferma; event usa notify con credito bounded.

Il link usa LE Secure Connections e bonding, ma “Just Works” non è autorizzazione
sufficiente. Provisiona in Maintenance una chiave applicativa da 32 byte in PSA ITS.
Dichiara in `include/spaghetti/ble.h`:

```c
int spaghetti_ble_credential_set(
	uint16_t credential_id,
	spaghetti_principal_id_t principal_id,
	const uint8_t key[32]);
int spaghetti_ble_credential_clear(uint16_t credential_id);
int spaghetti_ble_credential_exists(
	uint16_t credential_id,
	bool *out_exists);
```

`key` è borrowed soltanto durante `set()`, viene copiato nel secure storage e non viene
mai loggato; `principal_id` passa per valore e deve identificare un principal abilitato.
Set/clear sono ammessi soltanto in Maintenance locale. `out_exists` è caller-owned e
cambia solo al successo.

Dopo connect, firmware invia nonce casuale; il client prova possesso con HMAC-SHA256 su
nonce, device ID e session ID. La credenziale risolve il principal persistito nella
fase 355; solo dopo la prova l'adapter crea uno `spaghetti_request_context` con quel
principal ID e con l'intersezione fra permessi BLE e permessi del principal.
Config/update/provision richiedono i permessi del Protocollo 360; la chiave non entra
in advertising o Config. Una revoca chiude immediatamente il peer corrispondente.

Registra un consumer Record Delivery BLE con ID stabile tramite
`SPAGHETTI_RECORD_CONSUMER_DEFINE`. Attivalo soltanto dopo autenticazione e disattivalo
al disconnect: l'ACK BLE non deve avanzare MQTT. Frammenti duplicati possono essere
ricomposti, ma il retry dell'envelope viene gestito esclusivamente dalla replay cache
centrale della fase 360.

## Perché è fatto così

BLE è soltanto un adapter. Frammentazione, pairing e autenticazione non devono cambiare
operazioni, correlation ID o payload CBOR condivisi con USB e MQTT.

## Come si usa

Il client si collega, completa challenge/response, legge catalogo con una request V1 e
riceve la stessa response che otterrebbe su MQTT. Node-RED userà questo adapter tramite
la fase 375.

## Checklist di completamento

- [x] Capability BLE deriva dalla build e da `bt_enable()` riuscito.
- [x] UUID e framing sono congelati.
- [x] Request oltre 2048 byte o incompleta viene scartata.
- [x] Pairing senza prova applicativa non autorizza operazioni.
- [x] La credenziale risolve un principal revocabile con permessi bounded.
- [x] Il consumer Record Delivery BLE ha cursore indipendente da MQTT.
- [x] L'adapter non possiede una seconda replay cache.
- [x] Stop libera connessione, advertising, callback e buffer.
- [x] BLE e Wi-Fi non stanno nello stesso binario Core V1; due immagini (`make build` / `make build-ble`).

## Verifica e fine task

```sh
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/ble_protocol -T tests/protocol \
  -p native_sim/native/64 --inline-logs --clobber-output'
make pristine
```

Su hardware verifica autenticazione valida/errata, MTU minimo, frame fuori ordine,
disconnect a metà request e 100 cicli connect/disconnect.
