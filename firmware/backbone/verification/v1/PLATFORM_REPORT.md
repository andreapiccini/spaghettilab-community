# Platform V1 qualification report

**Date:** 2026-08-13  
**Scope:** Firmware `core/` platform V1 freeze (Node-RED host path with fakes).  
**VERSION:** not set to `1.0.0` — hardware release remains OPEN.

## Environment

| Item | Value |
|---|---|
| Tree | `firmware/backbone` |
| Zephyr | 4.4.0 (docker `dev` image) |
| Board under test (fake) | `native_sim/native/64` |
| Build-only board | `spaghettilab_core_v2_build_only/esp32c3` |
| Commit | set at push time for this gate (see `git log -1` on `main`) |
| Twister | `57/57` configs, `149/149` cases on `native_sim/native/64` |
| Host | Python unittest 63 OK; TS SDK 15 OK; MQTT/BLE smoke OK |
| Build-only | `spaghettilab_core_v2_build_only/esp32c3` PASS |

No secrets are stored in this report.

## Commands

```sh
./validator roadmap
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests -p native_sim/native/64 \
  --inline-logs --outdir build/twister-v1 --clobber-output'
make pristine
BOARD=spaghettilab_core_v2_build_only/esp32c3 make build
.venv/bin/python -m unittest discover -s tools/tests -v
npm --prefix tools/sdk/typescript test
make node-red-mqtt-smoke
make node-red-ble-smoke
```

Focused extension proof:

```sh
west twister -T tests/v1_extension -p native_sim/native/64 \
  --inline-logs --outdir build/twister-v1-ext --clobber-output
```

## Extension proof (`tests/v1_extension/`)

Fake plug-ins only under that directory (iterable macros); no patches to
`driver_registry/`, `rule_registry/`, `config/`, `data/`, `runtime/`,
`communication/`, `services/mqtt/`.

| Plug-in | Role |
|---|---|
| fake_temperature | I2C, INT64 sample, sync read |
| fake_button | GPIO, BOOL event, start/stop |
| fake_pwm | output, UINT64 duty permille command |
| fake_rule | observe field → PWM command |
| fake_register_profile_a/b | Device Profiles on `declarative-device` |
| fake_processing_block | bounded stateful transform |
| fake_eeprom_provider | authoritative Discovery |
| fake_analog_provider | heuristic Discovery |

Covered: two Modules same Port, schedules, rule, processing graph, button event,
PWM command, Device Profiles, catalog enumeration, Data + MQTT/BLE Record
Delivery consumers, rollback, two Flows (passive + controlled rails), Bay known/
unspecified, UNVERIFIED/ENFORCED admission, two I2C owners, incompatible
transport reject.

**Result:** PASS on `native_sim/native/64` (2026-08-13 focused twister run).

## Node-RED 25-step gate mapping

Host smokes use fake MQTT / FakeBleRadio (no physical Modules). Mapping:

| # | Step | Evidence |
|--:|---|---|
| 1 | Paginated catalog | Protocol/SDK catalog ops + MQTT smoke catalog path |
| 2 | Config two fake Modules same Port | `tests/v1_extension` apply |
| 3 | Temp sample + button event | `tests/v1_extension` |
| 4 | PWM command + correlation | Module command + Protocol MODULE_COMMAND tests |
| 5–6 | EEPROM vs analog candidates; accept authoritative | Discovery providers + v1_extension list |
| 7 | Reboot retains Config | Config storage unit tests |
| 8–9 | Broker/BLE drop; Runtime continues | MQTT/runtime/connectivity tests |
| 10 | New schema without central patch | v1_extension registration |
| 11 | Capability reject missing feature | capabilities / feature_packs tests |
| 12 | boot_id changes; Config/identity kept | identity + record_delivery tests |
| 13–14 | CAS conflict; identical apply no-op | config tests + v1_extension |
| 15 | MQTT/BLE independent cursors | v1_extension consumers |
| 16 | Cross-transport replay | communication/protocol replay tests |
| 17 | OTA catalog fingerprint invalidate | update/feature pack tests + SDK |
| 18 | int64 beyond safe JS range | golden vectors C/Py/TS |
| 19–20 | React Flow topology-only model; rail semantics | topology/power + host contract |
| 21–23 | Shared declarative driver; pack OTA fingerprint | device_profiles + feature_packs |
| 24 | OTA removing used feature rejected | image_manifest migration policy tests |
| 25 | GET_RESOURCES headroom | resources tests + RESOURCE_BUDGET |

MQTT smoke and BLE gateway smoke exercise the transport glue; full 25-step
orchestration against a live broker/radio remains a host integration checklist.

## Conformance and fuzz

| Suite | Role |
|---|---|
| `contracts/protocol-v1/vectors/v1` | Shared golden vectors |
| `tests/protocol` C | Envelope golden pins |
| `tools/tests/test_protocol_vectors.py` | Python |
| `tools/sdk/typescript/test/vectors.test.ts` | TypeScript |
| `tests/fuzz` | Envelope / Config CBOR / catalog / BLE frame corpus (zero crash) |

## Phase 210 cleanup

software/fake searches re-run: no active TEMPORARY harnesses in production paths;
`src/main.c` is Core bootstrap only. Legacy `config_cbor_legacy.c` and
`storage_legacy_v3.c` retained with **REMOVE AFTER 2026-12-31** notes.

Hardware matrix items (INA219/Relay/fault/PCB) left **OPEN** — see below. They
are not marked PASS via simulation.

## Hardware session 2026-08-14 (Core V1 ESP32-C3)

Board `spaghettilab_core_v1/esp32c3`, USB `/dev/cu.usbmodem2101`, MAC
`90:70:69:ad:75:48`. DRAM after Config workspace: **97.42%**
(`355904 / 365328`). `CONFIG_BT` remains off.

V1 without Modules stays in **unprovisioned** (reduced): UART Maintenance on
GPIO3/4, Runtime / Wi-Fi STA / OTA listener off. Do not use
`spaghetti maintenance finish` on this setup — that persists empty Config and
boots **normal**.

| 210 step | Result |
|---|---|
| 1 Boot empty, no Storage record | **PASS** — `core=3 mode=unprovisioned`, engine running, Shell live |
| 2 Malformed CBOR apply | **PASS** — `status=9` MALFORMED, snapshot/mode unchanged, Shell live |
| 3–8 INA219 / two keys / disconnect | **N/A** — no INA219 on Port 0 |
| 9 MQTT absent | **N/A** — unprovisioned does not start MQTT |
| 10 Second Core variant | **PASS** build-only (`spaghettilab_core_v2_build_only/esp32c3`) |

290: Q-B01 **PASS** (unprovisioned + Maintenance, no operational services). Q-S01
host secret scan **PASS**. Remaining Q-* UART/Wi-Fi/power-fixture cases **NOT RUN**.
365 physical BLE smoke **N/A** until `make build-ble` is flashed. `VERSION` stays `0.1.0+0`.

## Radio split decision 2026-08-14

Core V1 keeps **two artifacts**: default Wi-Fi (`make build`), BLE-only
(`make build-ble`). Wi-Fi+BLE in one image overflows `dram0_0_seg` by ~13–16 KiB.
Trimming logs/shell/TLS/`%f` saved ~2 KiB and was reverted on the default image.
~97% DRAM is reserved SRAM (including the 51 KiB Wi-Fi heap), not a runtime
emergency. Lessons:
[Diary — ESP32-C3 SRAM](../../DIARIO_PROBLEMI_SOLUZIONI_E_DECISIONI.md).

## Explicit OPEN gates (not software contract bugs)

1. **Hardware release 1.0** — do not set `VERSION=1.0.0` until complete.
2. **Phase 290** electrical / PCB qualification incomplete.
3. **Production security** (factory credentials, attestation, final key
   ceremony) incomplete.
4. Physical INA219 / Relay / fault injection / soak on final PCB.
5. Remeasured differential pack flash/RAM on final Core PCB.
6. Hardware watchdog chosen + fault-injection PASS on product Core.

## Result summary

| Gate | Status |
|---|---|
| Extension without central patches | PASS (fake) |
| Protocol V1 freeze doc | PASS (`PROTOCOL_V1.md`) |
| Resource budget recorded | PASS with honest TBD |
| Full `tests` twister | **57/57 configs PASS**, 149/149 cases (5 skipped by design) |
| ESP32-C3 build-only | PASS (`spaghettilab_core_v2_build_only/esp32c3`, ~915 KB app flash region) |
| Host MQTT/BLE smoke | PASS (fake path) |
| Golden vectors multi-language | PASS |
| Fuzz zero-crash | see twister `tests/fuzz` |
| Hardware 1.0 / phase 290 / prod security | **OPEN** |
