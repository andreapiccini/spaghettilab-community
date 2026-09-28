# Spaghetti BLE → Node-RED gateway

Use this when a Core exposes Protocol V1 over BLE and you want Node-RED (local
or remote) to consume the same CBOR envelopes without requiring Wi-Fi/MQTT on
every ESP32-C3.

The gateway lives in **Firmware**, not in this Docker image. This page only
documents how to wire Node-RED to it.

## Prerequisites

- Node-RED running from this directory (`docker compose up -d`)
- Firmware host tools on the machine that has BLE (or `--fake` for CI/smoke):

```sh
cd firmware/backbone
make host-tools
```

## Key material

Provision a 32-byte application BLE key into a file with mode `0600` **outside**
the repository (or use the host keychain). Point the gateway at it with an
environment variable — never put the key on the command line:

```sh
umask 077
mkdir -p "$HOME/.spaghetti"
# 32 raw bytes or 64 hex chars
head -c 32 /dev/urandom > "$HOME/.spaghetti/ble.key"
chmod 600 "$HOME/.spaghetti/ble.key"
export SPAGHETTI_BLE_KEY_FILE="$HOME/.spaghetti/ble.key"
export SPAGHETTI_GATEWAY_WS_TOKEN=local-dev-token
```

## Start the gateway

```sh
cd firmware/backbone
# Real radio (requires bleak from make host-tools):
.venv/bin/spaghetti-gateway serve --listen 127.0.0.1:8765
# Or module form:
# PYTHONPATH=. .venv/bin/python -m tools.spaghetti_gateway serve --listen 127.0.0.1:8765
# Or wrapper:
# ./tools/spaghetti-gateway serve --listen 127.0.0.1:8765
```

Fake BLE (no radio) for local bring-up:

```sh
SPAGHETTI_GATEWAY_FAKE=1 .venv/bin/spaghetti-gateway serve --fake --listen 127.0.0.1:8765
```

Optional MQTT bridge of the **same** V1 bytes:

```sh
export SPAGHETTI_GATEWAY_MQTT=1
export SPAGHETTI_GATEWAY_MQTT_HOST=127.0.0.1
```

## Import the example flow

1. Open http://127.0.0.1:1880
2. Menu → Import → select
   `firmware/backbone/examples/node_red/spaghetti_ble_v1_flow.json`
3. Confirm the WebSocket client URL matches the gateway
   (`ws://127.0.0.1:8765/?token=…`)
4. Set `SPAGHETTI_CORE_ID` (64-char lowercase hex device id) if your runtime
   injects env into function nodes; otherwise edit the init node

Also see `firmware/backbone/examples/node_red/README.md`.

## Behaviour notes

- Binary WebSocket messages = Protocol V1 CBOR envelopes (catalog, status,
  records, discovery, requests/responses). No alternate Config API.
- Text WebSocket messages = control (`select_device`, `boot_id_changed`, errors).
- Host WebSocket identity does **not** escalate the BLE principal’s permissions.
- Config uses the same Coordinator GET → merge → VALIDATE → APPLY (CAS) pattern
  as the MQTT example; handle `CONFLICT` by re-read/merge.
- The example seeds two fake schemas for debug UI only; it does not hardcode
  INA219 — real field maps come from the catalog.

## Smoke (Firmware)

```sh
cd firmware/backbone
make host-tools
.venv/bin/python -m unittest discover -s tools/tests -v
make node-red-ble-smoke
```
