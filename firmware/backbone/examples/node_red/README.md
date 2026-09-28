# Node-RED Spaghetti Protocol V1 examples

## Future node package layout

Host nodes import `@spaghettilab/protocol` from `firmware/backbone/tools/sdk/typescript`
(local compile; not published to npm). They must not reimplement CBOR, retry, or
Config merge:

```text
spaghetti-core          connessione, credenziale, client e catalogo
spaghetti-config        unico Config Coordinator
spaghetti-module        produce un fragment, non scrive il Core
spaghetti-record        sottoscrive record tipizzati
spaghetti-command       invia un comando dichiarato dal catalogo
spaghetti-discovery     scan/list/accept
spaghetti-connectivity  policy e lease
spaghetti-update        job update e progresso
```

`spaghetti-module` never calls `applyConfig()` directly. Only `spaghetti-config`
owns `ConfigCoordinator.synchronize()`. Credentials stay outside exported flows.

## MQTT path

Import `spaghetti_v1_flow.json` into Node-RED. Configure only the MQTT broker host
and the Core `core_id` (canonical lowercase hex of the device identity). The flow
contains **no** broker passwords, PSKs, or certificates.

### Topic layout

All topics are under `<base>/v1/cores/<core_id>/`:

| Topic | Role |
|---|---|
| `state` | Retained device status events |
| `catalog` | Retained catalog fingerprint / placeholder |
| `modules/+/records` | Per-module record events |
| `discovery` | Discovery candidate events |
| `requests/<client_id>` | Host → Core Protocol V1 requests |
| `responses/<client_id>` | Correlated Protocol V1 responses |

Payloads are Protocol V1 CBOR envelopes. The flow decodes CBOR into JavaScript
objects for debug/dashboard use.

## BLE gateway path

Import `spaghetti_ble_v1_flow.json` when the Core speaks BLE (MQTT optional on the
device). Run the host gateway from `firmware/backbone`:

```sh
make host-tools
# 32-byte key in a mode-0600 file outside the repo — never pass the key on argv
export SPAGHETTI_BLE_KEY_FILE="$HOME/.spaghetti/ble.key"
export SPAGHETTI_GATEWAY_WS_TOKEN=local-dev-token
# Local smoke / CI without a radio:
SPAGHETTI_GATEWAY_FAKE=1 .venv/bin/spaghetti-gateway serve --fake --listen 127.0.0.1:8765
# Or: python tools/spaghetti_ble_gateway.py serve --fake --listen 127.0.0.1:8765
```

Point the flow WebSocket client at `ws://127.0.0.1:8765/?token=…` and set
`SPAGHETTI_CORE_ID` to the 64-char hex device id. Binary WebSocket messages are the
same Protocol V1 CBOR envelopes as MQTT. Text messages are control only
(`select_device`, `boot_id_changed`).

Optional MQTT bridge on the gateway publishes those same bytes on the V1 topics
above (`SPAGHETTI_GATEWAY_MQTT=1`).

Catalog, status, records, and discovery arrive as gateway events/responses. Config
uses the same **Config Coordinator** GET → merge → VALIDATE → APPLY (CAS) pattern
as the MQTT flow. Module nodes emit fragments only; on `CONFLICT` the coordinator
re-reads and retries. The flow seeds two fake schemas (`fake_temp_v1`,
`fake_counter_v1`) for debug UI only — it does **not** hardcode INA219.

## Config Coordinator

Module nodes emit desired Config fragments only. A single **Config Coordinator**:

1. `GET_CONFIG` for the current snapshot and generation
2. merges fragments into a candidate
3. `VALIDATE_CONFIG`
4. `APPLY_CONFIG` with compare-and-swap on the generation

On `CONFLICT`, the coordinator re-reads Config and retries the merge. It never
forces a stale snapshot. Catalog fingerprints are cached and invalidated when the
retained catalog event changes.

## Client ID

Set `client_id` to a stable Node-RED instance name (max 32 characters,
`[A-Za-z0-9._-]`). On MQTT, responses are published to `responses/<client_id>`.
On BLE gateway, correlation is carried inside the V1 envelope over the WebSocket.

## Host verification

```sh
make host-tools
npm --prefix tools/sdk/typescript ci
npm --prefix tools/sdk/typescript test
.venv/bin/python -m unittest discover -s tools/tests -v
make node-red-mqtt-smoke
make node-red-ble-smoke
```
