# TASK-367-01 — Attivare Wi-Fi da BLE

**Stato:** ✅ DONE
**Fase:** 367 — Handover BLE verso Wi-Fi

## Cosa devo fare

Aggiorna `include/spaghetti/protocol.h`, crea
`subsys/communication/operations/connectivity.c` e `tests/ble_wifi_handover/`.

Implementa gli handler degli operation ID già congelati nella fase 360:

```text
ACQUIRE_CONNECTIVITY_LEASE
RELEASE_CONNECTIVITY_LEASE
OPEN_NETWORK_MAINTENANCE
OPEN_WIFI_UPDATE
```

La prima abilita soltanto i servizi richiesti; non arma update. Network Maintenance
apre il Protocol V1 remoto senza esporre Zephyr Shell. Wi-Fi Update riserva Update
Coordinator e workspace sicuro. Tutte ricevono `duration_ms`, richiedono sessione BLE
autenticata e permission adeguata e restituiscono deadline e stato raggiunto.

Sequenza: valida profilo e durata; acquisisci lease dal Connectivity Manager; avvia
Wi-Fi Profiles; attendi associazione bounded; arresta MQTT se serve il workspace;
apri esattamente il servizio richiesto; invia acknowledgement BLE con indirizzo/porta;
sul profilo Minimal disconnetti BLE solo dopo l'ack. Errore o timeout chiude servizio,
Wi-Fi e lease in ordine inverso.

## Perché è fatto così

“Accendi Wi-Fi”, “entra in manutenzione” e “ricevi firmware” hanno privilegi ed effetti
diversi. Separarli evita che una semplice connessione radio apra una superficie remota.

## Come si usa

Un'app BLE richiede una lease di 120 secondi. Per OTA usa l'operazione dedicata, riceve
IP/porta e continua il trasferimento tramite il client Wi-Fi già esistente.

## Checklist di completamento

- [x] Le quattro operazioni hanno permessi separati.
- [x] Wi-Fi generico non apre OTA o console.
- [x] Ack precede l'eventuale disconnect BLE.
- [x] Timeout ripristina LOW_ENERGY.
- [x] MQTT rilascia il workspace prima di Wi-Fi OTA.

## Verifica e fine task

```sh
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/ble_wifi_handover -T tests/connectivity -T tests/ota \
  -p native_sim/native/64 --inline-logs --clobber-output'
```

Prova rete assente, credenziale errata, lease scaduta, BLE perso prima/dopo ack e OTA
già posseduta da un altro trasporto.
