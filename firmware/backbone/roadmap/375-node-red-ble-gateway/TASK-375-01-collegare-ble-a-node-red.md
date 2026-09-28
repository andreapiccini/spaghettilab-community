# TASK-375-01 — Collegare BLE a Node-RED

**Stato:** ✅ DONE
**Fase:** 375 — Gateway BLE per Node-RED

## Cosa devo fare

Crea `tools/spaghetti_ble_gateway.py`, test in `tools/tests/`, esempio flow in
`examples/node_red/spaghetti_ble_v1_flow.json` e documentazione nel progetto
`software/node-red/`. Aggiungi `bleak` alle dipendenze della `.venv`; non richiedere
installazioni Python globali.

Il gateway possiede connessione BLE, challenge applicativa, frammentazione e retry. Ai
client locali espone WebSocket loopback autenticato con messaggi binari contenenti lo
stesso envelope CBOR V1. Modalità opzionale bridge pubblica gli stessi byte sui topic
MQTT V1; non traduce Config in un formato alternativo.

Il gateway assegna a ogni client WebSocket un identity host ma non amplia mai i
permessi del principal BLE. Conserva correlation ID e byte request durante reconnect;
ritrasmette lo stesso envelope, lasciando alla replay cache del Core la decisione sui
duplicati. Non implementa una seconda cache degli effetti e non traduce gli status V1
in errno.

```text
spaghetti-gateway scan
spaghetti-gateway connect --device-id <id>
spaghetti-gateway serve --listen 127.0.0.1:8765
```

La chiave BLE viene letta da file mode `0600` fuori dal repository o dal keychain host.
Non compare in argv. Il gateway gestisce un numero bounded di Core, backoff, reconnect,
boot ID cambiato e contatori di record persi. Il flow Node-RED legge catalogo, status,
record e discovery. Per Config usa lo stesso Coordinator read/merge/validate/CAS del
percorso MQTT: due nodi non inviano snapshot complete indipendenti.

## Perché è fatto così

BLE non attraversa Internet. Un gateway vicino al Core consente a Node-RED locale o
remoto di usare BLE senza caricare Wi-Fi, TLS e MQTT su ogni ESP32-C3.

## Come si usa

Avvia il gateway sul computer o sulla futura base, importa il flow e seleziona il
device ID. Il flow non contiene schema INA219: costruisce UI e valori dal catalogo.

## Checklist di completamento

- [x] Gateway usa gli envelope V1 senza seconda API.
- [x] Segreti restano fuori da repo e argv.
- [x] Reconnect conserva correlation e segnala nuovo boot ID.
- [x] Retry riusa lo stesso envelope e dipende dalla replay cache centrale.
- [x] Config usa GET/validate/CAS e gestisce CONFLICT senza lost update.
- [x] Flow gestisce almeno due schema fake differenti.
- [x] MQTT sul Core può restare non compilato.

## Verifica e fine task

```sh
.venv/bin/python -m unittest discover -s tools/tests -v
make node-red-ble-smoke
```

Il test fake deve attraversare BLE→gateway→Node-RED; la prova hardware ESP32-C3 viene
registrata separatamente.
