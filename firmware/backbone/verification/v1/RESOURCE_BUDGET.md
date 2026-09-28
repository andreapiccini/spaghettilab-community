# V1 resource budget

[← PLATFORM_REPORT](PLATFORM_REPORT.md) · [Baseline](../resources/BASELINE.md) ·
[PROTOCOL_V1](../../PROTOCOL_V1.md)

Measured where a pristine ESP32-C3 / native build was available; otherwise marked
**TBD (hardware)** or **build-derived**. Instantaneous free-heap samples are not
used as installability gates.

## Profile limits (from `Kconfig.resources`)

| Resource | Minimal | Standard | Extended |
|---|---:|---:|---:|
| Modules / schedules / rules | 8 / 8 / 4 | 16 / 16 / 8 | 32 / 32 / 16 |
| Device Profiles / ops | 8 / 16 | 16 / 32 | 32 / 64 |
| Processing blocks / edges / contexts | 16 / 24 / 8 | 32 / 64 / 16 | 64 / 128 / 32 |
| Protocol payload | 512 B | 1024 B | 2048 B |
| Record queue / consumers | 8 / 3 | 16 / 4 | 32 / 6 |
| Secure sessions | 1 | 1 | 1 |
| Shared secure workspace | 60 000 B | 60 000 B | 65 536 B |
| Flows / bays / rails | 2 / 3 / 3 | 4 / 5 / 4 | 8 / 8 / 8 |

## Board flash / RAM (ESP32-C3, Minimal, Zephyr 4.4.0)

From `verification/resources/BASELINE.md` (MCUboot sysbuild):

| Variant | App binary | Signed app | MCUboot | Linked SRAM | SRAM region | Headroom |
|---|---:|---:|---:|---:|---:|---:|
| core-v1-esp32c3 | 817 512 | 817 663 | 43 040 | 238 816 | 365 328 | 126 512 |
| core-v2-build-only | 817 180 | 817 330 | 43 040 | 298 224 | 365 328 | 67 104 |

Slot free space and OTA dual-slot margins: **TBD (hardware remeasure on final PCB)**.

## Core V1 radio images (measured 2026-08-14)

Linker region `dram0_0_seg` is 365328 B. These figures are static occupancy, not
free-heap. The Wi-Fi kernel heap (51480 B) is already inside the used column.

| Image | Build | DRAM used | % | Heap | Notes |
|---|---|---:|---:|---:|---|
| Wi-Fi default | `make build` | 362368 B | 99.19% | 51480 | `CONFIG_BT` off; USB Protocol V1 adapter included |
| BLE only | `make build-ble` | 288528 B | 78.98% | 25600 | No IP/MQTT; Protocol V1 over GATT |
| Wi-Fi + `CONFIG_BT` | does not link | overflow 13–16 KiB | — | 51480 | Do not ship |

Largest app BSS (Wi-Fi image): two Config snapshots 18 KiB each, two processing
plans 10 KiB each, device-profile slots 16 KiB. Those doubles are live+scratch.
Runtime peak risk is the shared heap (Wi-Fi driver + MQTT/TLS), not the ~3 KiB
linker slack. Full write-up:
[Diary — ESP32-C3 SRAM](../../DIARIO_PROBLEMI_SOLUZIONI_E_DECISIONI.md).

## Static stacks / pools (Minimal)

| Allocation | Size | Notes |
|---|---:|---|
| Main | 8192 B | Zephyr main |
| Shell UART | 5120 B | Dev/maintenance |
| Runtime sampling / rule | 1536 B each | Bounded workers |
| Update / electrical logger | 1024 B each | |
| Logging | 768 B | Deferred |
| Production remote console | 0 B | Not compiled in Minimal |
| Shared TLS workspace contract | 60 000 B | Admission budget, not a static slab |

## Record / property / envelope

| Item | Bound |
|---|---|
| Envelope absolute max | 2048 B |
| Property set fields | profile `MAX_PROPERTIES` |
| Schema ID | 31 chars + NUL |
| MQTT payload | envelope-sized |

## Differential pack builds (policy)

Target images for comparison (flash / linked SRAM / stack high-water):

| Image | Packs | Policy |
|---|---|---|
| `base` | core-basic + processing-basic | Default candidate for Minimal boards |
| `base+kalman` | + `PACK_PROCESSING_KALMAN` | Optional; enable when graph uses Kalman |
| `base+modbus` | + `PACK_MODBUS` | Optional transport stub |
| `all-supported` | kalman + modbus + device-profile | Not automatic default on Minimal; use when flash/RAM headroom and product need all |

**Measured differential bytes:** TBD on next pristine `BOARD=spaghettilab_core_v2_build_only/esp32c3` matrix; record west/map `_image_ram_size` and app hex size per image in this table when available. native_sim confirms compile/link for each pack variant via `tests/feature_packs/`.

## Fake worst-case timings (native_sim `tests/v1_extension`)

| Scenario | Result |
|---|---|
| Config apply (2 Module + 2 schedule + rule + graph) | PASS (sub-ms class on host) |
| Identical apply no-op | PASS (no Storage write) |
| Empty Config rollback | PASS |
| Discovery scan timeout budget | policy `K_MSEC(10)` per provider |

Hardware apply/rollback/scan under load: **OPEN / phase 290**.

## Connectivity / TLS / OTA scenarios

| Scenario | Status |
|---|---|
| Boot LOW_ENERGY | Covered by connectivity unit tests |
| BLE advertising / connected | Unit + BLE protocol tests; radio hardware OPEN |
| BLE + Wi-Fi/MQTT | Not one Core V1 binary; handover is reflash or a larger SoC |
| MQTT TLS | Host smoke fake; broker TLS hardware OPEN |
| OTA Wi-Fi / OTA BLE | Update qualification docs; production gate OPEN |
| Stop all optional services | Service manager / MQTT stop tests |
| TLS allocation failure | Shared allocator tests (`verification/resources/TLS_ALLOCATOR.md`) |
| Minimal single secure session | Contract enforced (1 session) |
| Production remote console absent on Minimal | PASS (not compiled) |
| 100× start/stop & connect/disconnect | Soft gate on native; hardware soak OPEN |

## Health / watchdog

Health Supervisor worker deadlines, OTA/flash windows, and reset cause are covered
in health unit tests. A Core **without** a chosen hardware watchdog must report the
capability as **absent** — that is not a PASS. Hardware watchdog feed under fault
injection on final PCB remains **OPEN**.

## BUILD_ASSERT policy

Static limit relations fail the build via `BUILD_ASSERT` / Kconfig ranges. Runtime
must not silently shrink profile ceilings.
