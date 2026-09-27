# Host tools

Python helpers that run on the developer machine (not inside Zephyr). Create the
local virtualenv with `make host-tools` — nothing is installed globally.

## Spaghetti CLI V1

`tools/spaghetti.py` speaks Communication Protocol V1. User Config files use
readable JSON; the CLI loads the Core catalog, resolves property names to field
IDs, and exchanges CBOR envelopes. Credentials stay in a `chmod 600` JSON file
(or an interactive prompt) — never on the command line.

```sh
make host-tools

# In-memory fake Core (no hardware)
make spaghetti ARGS='catalog --fake --json'
make spaghetti ARGS='topology --fake'
make spaghetti ARGS='config validate configs/lab.json --fake'
make spaghetti ARGS='config apply configs/lab.json --fake --json'

# Makefile wrappers (CONFIG is a filesystem path, not Kconfig)
make config-validate CONFIG=configs/lab.json
make config-apply CONFIG=configs/lab.json

# Connectivity lease / factory reset (confirmation required)
make spaghetti ARGS='connectivity lease --services wifi --duration 120s --fake'
make spaghetti ARGS='factory-reset --scope config --yes --fake'
```

Machine output uses `--json` (stable key order). `--quiet` returns only the exit
status. Protocol status codes map directly to process exit codes (`conflict` → 4).

Update clients (`update uart|wifi|ble`) verify the signed image locally, stream
bounded chunks with progress, cancel on Ctrl+C, and finalize as **trial** only.

## SLUP host load (PC file → USB master → CAN peer)

Close `make monitor`. From `firmware/core`:

```sh
make slup-list
make slup-load TARGET=2
make slup-load TARGET=0x112233 IMAGE=build/app/zephyr/zephyr.signed.bin
```

Default `IMAGE` is the last signed sysbuild image. `TARGET` is a `slup list`
index or a `0xNODE` MAC suffix.

## USB Protocol V1 (same Serial/JTAG as the Shell)

Close `make monitor` first. The CLI and React Flow own the port exclusively.

```sh
make ARGS='--transport serial status' spaghetti
```

## USB bridge for Safari

Safari (and Tauri-on-macOS WKWebView) has no Web Serial. This process opens
Core USB ports with Protocol V1 stream framing and exposes
`WebSocketProtocolTransport` on loopback only (`127.0.0.1:8766`). Do not reuse
the BLE gateway JSON/token control plane.

React Flow starts it with `make up-d` in `software/micro-flow-editor`. Low-level:

```sh
make usb-bridge
```

| Path | Payload |
|---|---|
| `/list` | text JSON `{cores:[{deviceIdHex,deviceName,version,port}]}` then close |
| `/core/<device_id>` | binary: browser → raw request envelope; bridge → USB `0x02`+length+envelope; USB → browser kind+envelope (`0x00`/`0x01`) |

React Flow Auto / Core via cavo probes this URL automatically. Chrome can keep
using `navigator.serial` without the bridge.
