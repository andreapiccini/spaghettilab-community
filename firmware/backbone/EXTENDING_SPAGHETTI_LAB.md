# Practical guide to extend Spaghetti LAB

[← README](README.md) · [Architecture](ARCHITECTURE.md) · [Firmware implementation
guide](FIRMWARE_IMPLEMENTATION_GUIDE.md) · [File map](FILE_MAP.md) ·
[Diario](DIARIO_PROBLEMI_SOLUZIONI_E_DECISIONI.md)

This guide is the starting point for adding a Module, Rule, Discovery provider,
board layout, transport, Protocol operation, Device Profile, Block, Capability
Pack, or host Node-RED node after the Module Driver V2 and Protocol V1 freeze.

You do not need to know Zephyr already, but you need the component datasheet or
the new board schematic: addresses, registers, pins, and polarities cannot be
inferred from the firmware.

> [!IMPORTANT]
> New plug-ins register through iterable `SPAGHETTI_*_DEFINE` macros. Do **not**
> patch central Registry tables, and do **not** reintroduce V0 APIs
> (`void *config`/`size_t`, `struct spaghetti_sample` as the Module contract, or
> central `drivers[]` lists). Prefer the templates under
> [`templates/firmware/`](templates/firmware/) and the compile suite in
> `tests/templates/`.

## Choose first what you are adding

| Objective | Extension | Where it runs |
|---|---|---|
| Sensor/actuator on a Port | **Module Driver** (sync and/or async) | Core firmware |
| Record-driven automation | **Rule Driver** | Core firmware |
| Hardware probe that suggests Config | **Discovery Provider** | Core firmware |
| New MCU / Core board | **Core/board variant** | Board DTS/Kconfig |
| New host link (Shell/TLS/BLE/MQTT) | **Transport adapter** | Communication/services |
| New machine request/response | **Protocol V1 operation handler** | Communication |
| Host orchestration / UI node | **Node-RED node via host SDK** | Host (not Zephyr) |
| More Flows, Bays, rails | **Board topology only** | Board DTS |
| Declarative peripheral without C | **Device Profile** (+ declarative Module) | Data / optional ROM |
| Processing graph node | **Block Driver** (+ optional pack) | Core firmware |
| Publish a feature set | **Compose packs + resource profile** | Build / manifest |

A Port is a physical termination and can expose a shared bus. It is not a single
occupied slot: distinct endpoints may share one Port. The persistent identity is
the Config `key`; collisions are Port + normalized endpoint.

Before coding:

```sh
make signing-key       # only if .keys/mcuboot-dev-ecdsa-p256.pem does not exist
make pristine
make validate
```

`make pristine` uses Zephyr 4.4 in the container and also compiles MCUboot. Never
edit `build/`: it contains generated results, not sources.

---

## 1. Module Driver (sync and async)

**Contracts:** [`include/spaghetti/module_driver.h`](include/spaghetti/module_driver.h),
[`include/spaghetti/schema.h`](include/spaghetti/schema.h),
[`include/spaghetti/port.h`](include/spaghetti/port.h).

**Templates:**
[`templates/firmware/module_driver.h.template`](templates/firmware/module_driver.h.template),
[`templates/firmware/module_driver.c.template`](templates/firmware/module_driver.c.template).

**Reference:** [`spaghetti_modules/ina219/ina219.c`](spaghetti_modules/ina219/ina219.c)
(sync meter), [`spaghetti_modules/relay/relay.c`](spaghetti_modules/relay/relay.c)
(sync actuator).

### Files

```text
spaghetti_modules/<name>/
├── <name>.h          # field IDs + config decode helper
├── <name>.c          # schemas, slab, ops, SPAGHETTI_MODULE_DRIVER_DEFINE
└── README.md         # transport, endpoint, units, safe state
```

Also edit application [`CMakeLists.txt`](CMakeLists.txt) (`target_sources` +
include dir) and [`Kconfig`](Kconfig) (log module + `*_MAX_INSTANCES`). Optionally
list `type_id` in a Capability Pack under `subsys/feature_registry/`.

**Do not edit** `subsys/driver_registry/driver_registry.c`.

### Header, schema, slab

Config arrives as a borrowed `struct spaghetti_property_set`. Publish a
`spaghetti_schema_descriptor`, validate with `spaghetti_property_validate()`, and
copy retained fields into a driver-owned `K_MEM_SLAB` context.

```c
SPAGHETTI_MODULE_DRIVER_DEFINE(spaghetti_<name>_driver) = {
	.type_id = "<name>",
	.api_version = SPAGHETTI_MODULE_DRIVER_API_VERSION,
	.required_capabilities = SPAGHETTI_PORT_CAP_I2C,
	.transport = SPAGHETTI_PORT_TRANSPORT_I2C,
	.power_requirement = { .declared = false },
	.config_schema = &config_schema,
	.record_schemas = record_schemas,
	.record_schema_count = ARRAY_SIZE(record_schemas),
	.commands = NULL,
	.command_count = 0U,
	.ops = &ops,
};
```

### Ops order

1. `validate_config` — pure; no hardware, no allocation.
2. `describe_endpoint` — after validation; fills `spaghetti_module_endpoint`
   (`kind` + `value_size` + `value[]`).
3. `init` — Manager already acquired Port transport; allocate slab; bounded Port
   I/O via `spaghetti_port_i2c_transfer()` / SPI / GPIO helpers; publish
   `module->context` only on success.
4. `read` and/or `command` — at least one required; write
   `spaghetti_record_payload` or apply `spaghetti_module_command` only on success.
5. `start` / `stop` — **both NULL** for sync; **both non-NULL** for async event
   emission. Emit only from thread context through the borrowed callback; never
   from ISR/timer.
6. `deinit` — safe state, free slab, clear `module->context`.

### Async note

Pair `start` with `stop`. Registry rejects unpaired callbacks. `stop` must prevent
future emits before returning. Cleanup order is reverse of start: stop → deinit.

### Config / catalog

Schema field IDs and `type_id` are the wire contract. Hosts discover types through
Protocol `GET_CATALOG` / pack catalog after the image links the driver. Do not add
central CBOR type switches for new Modules: properties are generic.

### Test and verify

```sh
# Prefer a dedicated native suite modeled on tests/ina219_runtime or tests/relay.
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/<name> -p native_sim/native/64 --inline-logs --clobber-output'
make validate
BOARD=spaghettilab_core_v1/esp32c3 make pristine   # hardware path when ready
```

Template compile gate (clean room):

```sh
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/templates -p native_sim/native/64 --inline-logs --clobber-output'
```

---

## 2. Rule Driver

**Contract:** [`include/spaghetti/rule_driver.h`](include/spaghetti/rule_driver.h).

**Template:** [`templates/firmware/rule_driver.c.template`](templates/firmware/rule_driver.c.template).

**Reference:** [`spaghetti_rules/threshold/threshold.c`](spaghetti_rules/threshold/threshold.c).

### Files

```text
spaghetti_rules/<name>/
├── <name>.h
├── <name>.c          # SPAGHETTI_RULE_DRIVER_DEFINE
└── README.md
```

Add sources to `CMakeLists.txt` / `Kconfig`. Use field semantics
(`MODULE_KEY_REF`, `RECORD_FIELD_REF`, `COMMAND_REF`) and `reference_group` so
hosts can wire React Flow without UI-specific firmware. Emit
`spaghetti_rule_action` copies; Runtime applies commands.

**Do not edit** `subsys/rule_registry/rule_registry.c`.

### Verify

```sh
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/rule_registry -T tests/threshold -p native_sim/native/64 --inline-logs --clobber-output'
```

---

## 3. Discovery Provider

**Contract:** [`include/spaghetti/discovery.h`](include/spaghetti/discovery.h).

**Template:** [`templates/firmware/discovery_provider.c.template`](templates/firmware/discovery_provider.c.template).

**Reference fakes:** [`tests/discovery_providers/src/fake_providers.c`](tests/discovery_providers/src/fake_providers.c).

### Files

```text
subsys/discovery/providers/<name>.c   # SPAGHETTI_DISCOVERY_PROVIDER_DEFINE
```

Wire the `.c` into CMake (and optional Kconfig). `scan()` emits candidates only;
Discovery copies them. Accept copies a Module Config fragment — providers never
apply Config or create Manager instances.

**Do not edit** `subsys/discovery/discovery.c` for registration.

### Verify

```sh
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/discovery_providers -p native_sim/native/64 --inline-logs --clobber-output'
```

---

## 4. Core / board variant

**Docs:** [`boards/spaghettilab/README.md`](boards/spaghettilab/README.md).

**Templates:** `board.yml.template`, `board.dts.template`, `board_defconfig.template`.

### Files

```text
boards/spaghettilab/spaghettilab_core_<name>/
├── board.yml
├── Kconfig.spaghettilab_core_<name>
├── Kconfig.defconfig          # optional
├── spaghettilab_core_<name>.dts
├── spaghettilab_core_<name>_defconfig
└── board.cmake                # only if a runner is required
```

Describe MCU, flash, controllers, pinctrl, Ports, Flows, rails, Maintenance Link,
and resource profile. Removable Modules never appear as permanent DTS children.

### Verify

```sh
BOARD=spaghettilab_core_<name>/<soc> make pristine
rg -n "spaghettilab,port|spaghettilab,flow|maintenance-link" build/app/zephyr/zephyr.dts
rg -n "CONFIG_BOARD|CONFIG_SOC|CONFIG_SPAGHETTI_RESOURCE_PROFILE" build/app/zephyr/.config
```

---

## 5. Transport adapter

Protocol adapters call `spaghetti_communication_handle_request()` and carry CBOR
envelopes. They do not own product rules.

| Adapter | Paths |
|---|---|
| USB Shell | `subsys/communication/communication_shell.c` |
| Remote Console TLS | `remote_console.c`, `remote_console_tls.c` |
| BLE | `subsys/communication/ble.c`, `include/spaghetti/ble.h` |
| MQTT | `subsys/services/mqtt/`, `include/spaghetti/mqtt.h` |

### Files

New `.c` under `subsys/communication/` or `subsys/services/`, public header if
needed, CMake/Kconfig, and a host-visible capability bit in
`include/spaghetti/capabilities.h` when the transport is product-visible.

Port **electrical** transports (`SPAGHETTI_PORT_TRANSPORT_*`) are board/pinctrl
facts selected by Config; do not confuse them with host Protocol adapters.

### Verify

```sh
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/communication -T tests/ble_protocol -T tests/mqtt -p native_sim/native/64 --inline-logs --clobber-output'
```

---

## 6. Protocol V1 operation handler

**Contract:** [`include/spaghetti/protocol.h`](include/spaghetti/protocol.h)
(`SPAGHETTI_OPERATION_HANDLER_DEFINE`).

**Template:** [`templates/firmware/operation_handler.c.template`](templates/firmware/operation_handler.c.template).

**Reference:** `subsys/communication/operations/*.c`.

### Files

```text
subsys/communication/operations/<name>_ops.c
```

Freeze a new `spaghetti_protocol_operation` ID in the catalog docs/enums before
shipping. Never reuse retired IDs. Declare `required_permissions`,
`execution` class (`IMMEDIATE_READ` / `SERIALIZED_MUTATION` / `ASYNC_JOB`),
request/response schemas, and `execute`.

Return internal `-errno` from `execute`; Communication maps with
`spaghetti_protocol_status_from_errno()` and owns replay. Do not invent a
parallel status domain.

### Verify

```sh
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/protocol -p native_sim/native/64 --inline-logs --clobber-output'
make host-tools && .venv/bin/pytest tools/tests/test_protocol_vectors.py
```

---

## 7. Node-RED node via host SDK

Hardware and real-time stay in Zephyr plug-ins. Host nodes **orchestrate**:
connect, read catalog, merge Config fragments, subscribe to records, and call
catalogued operations.

| Path | Role |
|---|---|
| `tools/sdk/typescript/` | `@spaghettilab/protocol` codec, client, ConfigCoordinator |
| `examples/node_red/` | MQTT and BLE flow examples |
| `tools/spaghetti_gateway/` | BLE → WebSocket bridge |

Node layout (see [`examples/node_red/README.md`](examples/node_red/README.md)):
`spaghetti-core`, `spaghetti-config`, `spaghetti-module`, `spaghetti-record`,
`spaghetti-command`, `spaghetti-discovery`, `spaghetti-connectivity`,
`spaghetti-update`.

Rules:

- Module nodes emit Config **fragments** only; only `spaghetti-config` owns
  `ConfigCoordinator.synchronize()` (GET → merge → VALIDATE → APPLY CAS).
- Credentials stay outside flows, Config, logs, argv, and the repository.
- Do not reimplement CBOR, retry, or catalog parsing in a node.

### Verify

```sh
make host-tools
make node-red-mqtt-smoke
# optional BLE path:
SPAGHETTI_GATEWAY_FAKE=1 make node-red-ble-smoke
```

---

## 8. Core layout: multi-Flow / Bay / rails

Add topology in board DTS only. Protocol and the host editor consume
`GET_TOPOLOGY`; they do not need new opcodes for additional Flows.

Bindings:

- [`dts/bindings/spaghetti/spaghettilab,port.yaml`](dts/bindings/spaghetti/spaghettilab,port.yaml)
- [`dts/bindings/spaghetti/spaghettilab,flow.yaml`](dts/bindings/spaghetti/spaghettilab,flow.yaml)
- [`dts/bindings/spaghetti/spaghettilab,power-rail.yaml`](dts/bindings/spaghetti/spaghettilab,power-rail.yaml)
- [`dts/bindings/spaghetti/spaghettilab,bay-power.yaml`](dts/bindings/spaghetti/spaghettilab,bay-power.yaml)

Each Flow has `signal-count = <5>`. Bay count is ordered from the field connector.
`available-rails` lists rail **IDs**, not phandles. Zero voltage/current limits
mean **unknown** — never invent electrical limits in firmware.

Template sketch: [`templates/firmware/board.dts.template`](templates/firmware/board.dts.template).

### Verify

```sh
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/topology -T tests/templates -p native_sim/native/64 --inline-logs --clobber-output'
```

---

## 9. Declarative Device Profile (no C / no OTA driver)

A Device Profile is **data**: acquisition opcodes, sample schema, budgets, hash.
Instance Port, Bay, label, and bus address live in Module config for type
`declarative-device`.

Paths:

- Host CBOR install via `INSTALL_DEVICE_PROFILE` (preferred; no new C).
- Optional ROM built-in: [`templates/firmware/device_profile.c.template`](templates/firmware/device_profile.c.template)
  + `SPAGHETTI_DEVICE_PROFILE_DEFINE`.
- Runtime Module: [`spaghetti_modules/declarative_device/`](spaghetti_modules/declarative_device/).

Unknown opcodes require a firmware Capability Pack that extends the interpreter;
install never invents opcodes.

Port families the generic `declarative-device` Module can already execute
(profile data only — no per-chip C):

| Port transport | Profile opcodes | Instance Config |
|---|---|---|
| I2C | `I2C_WRITE`, `I2C_READ`, `I2C_WRITE_READ` | `i2c_address` |
| SPI | `SPI_TRANSCEIVE` (`imm3` = mode 0..3; `0` is Mode 0) | `spi_cs`, `spi_frequency_hz` |
| UART | `UART_WRITE`, `UART_READ_UNTIL`, `UART_READ` | (baud/pins = Port/DTS) |
| GPIO | `GPIO_GET`, `GPIO_SET`, `WAIT_GPIO` | (one digital line per Port) |
| ADC | `ADC_READ` | `adc_channel` |
| 1-Wire | `W1_WRITE_READ` | `w1_rom` (8 bytes) |

Not Port families, not profile-installable: CAN, USB host, Ethernet, PWM.

`GET_TOPOLOGY` flow key 5 is the Port's `spaghetti_port_capability` mask
(DTS pin mux). The host must offer only those peripherals on that connector.

### Verify

```sh
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/device_profiles -T tests/templates -p native_sim/native/64 --inline-logs --clobber-output'
```

---

## 10. Block Driver + optional Capability Pack

**Contracts:** [`include/spaghetti/block_driver.h`](include/spaghetti/block_driver.h),
[`include/spaghetti/feature_pack.h`](include/spaghetti/feature_pack.h).

**Templates:** `block_driver.c.template`, `feature_pack.c.template`.

**References:** `spaghetti_blocks/blocks_*.c`,
`subsys/feature_registry/pack_*.c`.

### Files

```text
spaghetti_blocks/<file>.c                 # SPAGHETTI_BLOCK_DRIVER_DEFINE
subsys/feature_registry/pack_<name>.c     # SPAGHETTI_FEATURE_PACK_DEFINE
```

`process()` receives copied inputs and writes bounded outputs. No hardware I/O,
no Module Manager calls. Graphs must stay acyclic; state exists only for active
instances within CPU/RAM budgets.

A Capability Pack is a **signed image feature set**, never a dynamic library.
Installing a pack means flashing an MCUboot image that links it.

### Verify

```sh
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/processing -T tests/feature_packs -T tests/templates -p native_sim/native/64 --inline-logs --clobber-output'
```

---

## 11. Compose, measure, publish a firmware variant

Composition knobs:

1. Board + resource profile (`SPAGHETTI_RESOURCE_PROFILE_*` in Kconfig).
2. Linked Module/Rule/Block sources and `SPAGHETTI_FEATURE_PACK_DEFINE` objects.
3. Capability bits and budgets in `include/spaghetti/capabilities.h` /
   `image_manifest`.
4. Host visibility via `GET_FEATURES`, `GET_RESOURCES`, `GET_CAPABILITIES`.

Measure stacks and workspaces on the target profile; publish only **verified**
capabilities, not theoretical SoC features. Track flash headroom vs static RAM,
pools, current use, and high-water marks. After OTA, catalog fingerprint changes
and hosts must invalidate caches.

### Verify

```sh
make validate
BOARD=spaghettilab_core_v1/esp32c3 make pristine
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/resources -T tests/capabilities -T tests/feature_packs -p native_sim/native/64 --inline-logs --clobber-output'
```

---

## Config apply (all extension paths)

Config is a desired persistent snapshot. Validate is side-effect free. Apply uses
compare-and-swap on generation; identical content is a flash no-op. Keys are
persistent; Manager IDs are ephemeral. Property sets carry values — never
pointers — into storage and CBOR.

```c
err = spaghetti_config_get_snapshot(&current, &generation);
err = spaghetti_config_validate(&candidate, &error);
err = spaghetti_config_apply(&candidate, generation); /* CAS */
```

Wire format and CDDL live under `subsys/config/`. Prefer catalog-driven host
tooling over hand-edited hex once available.

---

## Caveat Spaghetti LAB

Read with [`FIRMWARE_IMPLEMENTATION_GUIDE.md`](FIRMWARE_IMPLEMENTATION_GUIDE.md)
and [`DIARIO_PROBLEMI_SOLUZIONI_E_DECISIONI.md`](DIARIO_PROBLEMI_SOLUZIONI_E_DECISIONI.md).

- **Port 1:N.** One Port may host many Modules at distinct endpoints. Endpoint
  collisions are Port + normalized endpoint; shared controllers serialize through
  Port, not through private driver locks (see Diario Port 1:N notes).
- **Flow vs Port vs Bay.** Flow is the five-signal physical path; Port is the
  firmware termination; Bay is an ordered position along the Flow. Config may
  leave Bay unspecified (`SPAGHETTI_BAY_ID_UNSPECIFIED`).
- **Five-signal connector.** Logical indices are 0–4. Never treat them as raw MCU
  GPIO numbers; board pinctrl maps signals.
- **Pinctrl vs Config.** Board DTS declares which transports a Port can support.
  Runtime Config selects the active transport among those capabilities.
- **Power UNVERIFIED vs ENFORCED.** Passive/jumper rails are unmanaged → admission
  `UNVERIFIED`. Switched/measured backends may `ENFORCE` limits before enable.
- **Unknown electrical limits are zero.** Firmware must not invent volts/amps.
- **Key vs ID.** Persist `key`; never persist ephemeral Manager/`id` handles.
- **Ownership / lifetime.** Zephyr `struct device` and Port descriptors have
  firmware lifetime. Driver context lives from `init` to `deinit`. Schemas and
  DEFINE descriptors are immutable ROM.
- **No pointers in Config.** Persist values and IDs only; copy borrowed property
  sets into owned slabs.
- **ISR / timer callbacks.** Capture or signal only; never blocking I/O, apply,
  or flash in ISR/timer context.
- **Port owns the lock.** Drivers call Port transfer APIs; they do not take the
  bus mutex themselves.
- **Start/stop and inverse cleanup.** Arm with `start`, disarm with `stop` before
  `deinit`. Free resources in reverse acquisition order.
- **Iterable sections.** A descriptor not referenced by any object file can be
  dropped by the linker; keep DEFINE in a compiled `.c` listed in CMake.
- **Schema / field / operation versioning.** Never reuse retired field IDs or
  operation IDs; bump versions for incompatible changes.
- **Uptime / boot ID.** Records carry boot ID and monotonic timestamps. V1 has no
  durable flash history; queues may drop under backpressure.
- **Record Delivery cursors.** Transport ACK does not advance other consumer
  cursors; each consumer owns its cursor.
- **Config generation / hash.** Validate without effects; apply is CAS; identical
  snapshots skip flash writes.
- **Protocol status vs errno.** Internals use errno; wire uses
  `spaghetti_protocol_status`. Replay is centralized in Communication.
- **Principals / roles / permissions.** An authenticated link is not sufficient;
  operations declare `required_permissions` bits.
- **INT64 / UINT64 lossless.** Preserve full width across C, CBOR, Python, and
  JavaScript (use BigInt / typed codecs — see protocol vectors).
- **Catalog fingerprint.** After OTA or pack changes, hosts must drop cached
  catalogs when the fingerprint changes.
- **Resource profiles.** Stacks, TLS workspaces, and pool budgets are measured per
  profile; do not copy EXTENDED numbers into MINIMAL boards.
- **Device Profile vs compiled drivers.** Profiles are data referencing opcode
  vocabulary + hash/version. New opcodes need firmware packs, not CBOR alone.
- **Block graphs.** Acyclic only; CPU/RAM budgets enforced; state only for active
  instances.
- **Capability Packs.** Signed image contents, never `dlopen`-style runtime libs.
- **Flash headroom vs RAM.** Track slot budget, static RAM, pools, workspaces,
  current use, and high-water separately.
- **Heartbeat / watchdog / Update windows.** Update and flash run in bounded
  windows; keep heartbeats alive within those bounds.
- **Real capabilities only.** Advertise what the image and schematic verify, not
  theoretical SoC marketing features.
- **Field semantic / reference_group.** UI-neutral contract for host graph editors
  (React Flow); firmware does not embed UI layout.
- **Credentials.** Outside Config, logs, argv, flows, and git. Use mode-0600 files
  and environment paths such as `SPAGHETTI_BLE_KEY_FILE`.
- **Maintenance vs connectivity vs trial.** Distinct states: Maintenance session,
  connectivity policy/lease, and MCUboot image trial/confirm/rollback.
- **`make pristine`, generated DTS, `.config`, linker, validator.** When something
  “disappears”, check CMake source lists, iterable sections, generated
  `zephyr.dts` / `.config`, linker maps, and run
  `./validator` / `make validate` before chasing runtime ghosts.

---

## End-to-end checklist for a new Module

- Linked with `SPAGHETTI_MODULE_DRIVER_DEFINE` (no Registry patch).
- Schemas publish config/records/commands; field IDs stable.
- Invalid Config never touches hardware.
- Distinct endpoints share a Port; collisions return `-EADDRINUSE`.
- No heap; slab capacity visible in Kconfig.
- Sync or paired async `start`/`stop`; ISR-safe rules held.
- Pack catalog lists the type when the variant should advertise it.
- `tests/templates` still passes; dedicated driver tests pass; `make validate` is
  clean; hardware smoke done when a physical Core exists.
