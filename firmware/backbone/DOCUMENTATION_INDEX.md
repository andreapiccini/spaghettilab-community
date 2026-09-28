# Documentation index and reading order

[← README](README.md) · [Technical file map](FILE_MAP.md) ·
[Roadmap](roadmap/README.md)

This is the single entry point for the Spaghetti LAB firmware documentation. You do
not need to read every Markdown file before starting: choose the path that matches your
current work and follow its links in order.

## First reading: understanding the project

For a complete introduction, use this order:

1. [Firmware README](README.md) — prepare the environment, build, flash, and console.
2. [Architecture](ARCHITECTURE.md) — understand owners, boundaries, and the flow
   Port → Module → Runtime → Communication.
3. [Protocol V1 freeze](PROTOCOL_V1.md) — machine contract for Node-RED / SDK / CLI.
4. [Connectivity and resource contract](CONNECTIVITY_AND_RESOURCE_CONTRACT.md) — learn
   about RAM profiles, BLE, on-demand Wi-Fi, TLS, and service lifecycles.
   Core V1 radio images and SRAM lessons:
   [Diary — ESP32-C3 SRAM](DIARIO_PROBLEMI_SOLUZIONI_E_DECISIONI.md).
4. [Update hardware contract](UPDATE_HARDWARE_CONTRACT.md) — separate the Maintenance
   Link, board pins, MCUboot, OTA, and recovery.
5. [V1 platform closure](roadmap/V1-PLATFORM-CLOSURE.md) — shows the
   result necessary before the main work in Node-RED.
6. [Practical extension guide](EXTENDING_SPAGHETTI_LAB.md) — learn how to add Modules,
   Cores, and configurations without breaking the architecture.
7. [Firmware implementation guide](FIRMWARE_IMPLEMENTATION_GUIDE.md) — follow the
   required API, ownership, lifetime, memory, threading, error, logging, and C-style rules.
8. [Technical file map](FILE_MAP.md) — indicates the subset of files to be opened for
   a concrete change.
9. [Roadmap index](roadmap/README.md) — see status, dependencies, and the next task.

If you are starting to program, after step 9 just open the task as indicated
as next by the roadmap. Do not read all future tasks as if they already described the
current code: every checklist distinguishes implemented work from planned work.

## Daily path: implement a task

For each task always use this reduced order:

1. the current `roadmap/<phase>/TASK-*.md` file;
2. [Architecture](ARCHITECTURE.md), to identify the correct owner;
3. [Implementation Guide](FIRMWARE_IMPLEMENTATION_GUIDE.md), to write the
   contract correctly;
4. the README of the component listed below in this index;
5. its header under `include/spaghetti/`;
6. `.c` implementation only when the task requires you to change it;
7. [Validator](VALIDATOR.md), if it reports a finding;
8. [Problem and decision journal](DIARIO_PROBLEMI_SOLUZIONI_E_DECISIONI.md), if builds,
   consoles, networking, TLS, memory, or updates behave unexpectedly.

For a new API, worker, queue, or shared object, also use the
[firmware templates](templates/firmware/README.md) and complete the change contract first.

## Route: add a Module

Read in this order:

1. [Extension Guide](EXTENDING_SPAGHETTI_LAB.md), Module path.
2. [Common Module Driver rules](spaghetti_modules/README.md).
3. [Public APIs](include/spaghetti/README.md), then `port.h`, `module.h`, and
   `module_driver.h` indicated by the guide.
4. [Port](subsys/port/README.md).
5. [Driver Registry](subsys/driver_registry/README.md).
6. [Module Manager](subsys/module_manager/README.md).
7. [Config](subsys/config/README.md).
8. [Data](subsys/data/README.md) and [Runtime](subsys/runtime/README.md).
9. The concrete examples available: [INA219](roadmap/080-runtime-removable-ina219/README.md) and
   [Relay](spaghetti_modules/relay/README.md).
10. [Firmware templates](templates/firmware/README.md).

A Port can contain multiple runtime Modules. Do not add a removable sensor to
Devicetree: Devicetree describes the controller and physical Port present on the Core;
Config describes the connected Module and its endpoint.

## Route: Add a Core or a board

Read in this order:

1. [Extension Guide](EXTENDING_SPAGHETTI_LAB.md), Core path.
2. [Board support](boards/spaghettilab/README.md).
3. [Spaghetti Devicetree bindings](dts/bindings/spaghetti/README.md).
4. [Port](subsys/port/README.md).
5. [Connectivity and Resource Contract](CONNECTIVITY_AND_RESOURCE_CONTRACT.md).
6. [Update hardware contract](UPDATE_HARDWARE_CONTRACT.md).
7. [Firmware templates](templates/firmware/README.md), particularly board YAML, DTS, and
   defconfig.
8. [Hardware reminder](PROMEMORIA_HARDWARE_E_FINALIZZAZIONE.md), before declaring pins,
   rails, flash, radios, or watchdogs verified.

Devicetree contains only schematic and datasheet derivatives. Always check the
result generated in `build/app/zephyr/zephyr.dts`; do not change it directly.

## Route: Node-RED and host applications

Before creating Node-RED flows or nodes, read:

1. [V1 platform closure](roadmap/V1-PLATFORM-CLOSURE.md).
2. [Machine Protocol V1](roadmap/360-communication-protocol-v1/README.md).
3. [MQTT for Node-RED](roadmap/370-mqtt-node-red-v1/README.md).
4. [Gateway BLE](roadmap/375-node-red-ble-gateway/README.md).
5. [Host SDK and Node-RED contract](roadmap/378-host-sdk-node-red/README.md).
6. [Developer tools](roadmap/380-developer-tools-v1/README.md).
7. [Platform finalization](roadmap/390-v1-finalization/README.md).

The `spaghetti-core` node has connection, credentials and catalog. One Config
Coordinator performs read/merge/validate/apply; Module nodes produce fragments and do
not send competing snapshots. Hardware, real-time, safe-state, and offline behavior
remain in Zephyr firmware and are exposed as cataloged operations.

## References of architecture in order of dependence

Open these documents when the task enters its component:

1. [Core](subsys/core/README.md) — order of boot and composition of the engine.
2. [Port](subsys/port/README.md) — static hardware and board-independent access.
3. [Driver Registry](subsys/driver_registry/README.md) — lookup of Module types.
4. [Module Manager](subsys/module_manager/README.md) — instances and lifecycle runtime.
5. [Config](subsys/config/README.md) — desired state, validation, apply, and rollback.
6. [Storage](subsys/services/storage/README.md) — bounded and versioned persistence.
7. [Data](subsys/data/README.md) — copyable records and distribution.
8. [Runtime](subsys/runtime/README.md) — schedule, worker and local rules.
9. [Discovery](subsys/discovery/README.md) — candidates; Discovery proposes, Config decides.
10. [Communication](subsys/communication/README.md) — requests independent of
    transport (USB Protocol V1 on Serial/JTAG; Safari uses
    [host tools](tools/README.md) `make usb-bridge`).
11. [Power](subsys/power/README.md) — physically controllable electrical resources.
12. [Optional services](subsys/services/README.md) — common backend rules.

Service references:

- [Timer](subsys/services/timer/README.md)
- [Wi-Fi profiles](subsys/services/wifi_profiles/README.md)
- [MQTT](subsys/services/mqtt/README.md)
- [Update](subsys/services/update/README.md)
- [OTA](subsys/services/ota/README.md)
- [SLUP field update](subsys/services/ota/SLUP.md)
- [Maintenance Link](subsys/services/maintenance_link/README.md)

## Complete roadmap in order

Each link opens a phase README; from there, open its task. The authoritative status
remains in the [roadmap index](roadmap/README.md).

### Foundation and current engine

1. [000 — Baseline](roadmap/000-baseline/README.md)
2. [010 — Core](roadmap/010-core/README.md)
3. [020 — Board and I2C](roadmap/020-board-i2c/README.md)
4. [030 — Port](roadmap/030-port/README.md)
5. [040 — Vertical slice INA219](roadmap/040-ina219/README.md)
6. [050 — Module and Module Driver](roadmap/050-module-driver/README.md)
7. [060 — Driver Registry](roadmap/060-driver-registry/README.md)
8. [070 — Module Manager](roadmap/070-module-manager/README.md)
9. [080 — INA219 runtime](roadmap/080-runtime-removable-ina219/README.md)
10. [090 — Config](roadmap/090-config/README.md)
11. [100 — Storage](roadmap/100-storage/README.md)
12. [110 — Data and zbus](roadmap/110-data-zbus/README.md)
13. [120 — Runtime V0](roadmap/120-runtime-v0/README.md)
14. [130 — Relay and Runtime V1](roadmap/130-relay-runtime-v1/README.md)
15. [140 — Communication Shell](roadmap/140-communication/README.md)
16. [150 — CBOR](roadmap/150-cbor/README.md)
17. [160 — Initial MQTT](roadmap/160-mqtt/README.md)
18. [165 — Secure Wi-Fi](roadmap/165-secure-wifi/README.md)
19. [170 — Discovery](roadmap/170-discovery/README.md)
20. [180 — Multiple Cores](roadmap/180-multi-core/README.md)
21. [190 — Power](roadmap/190-power/README.md)
22. [200 — Engine](roadmap/200-engine/README.md)
23. [210 — Cleaning and qualification](roadmap/210-finalizzazione/README.md)

### Boot, maintenance and update

1. [220 — Maintenance Link contract](roadmap/220-update-hardware-contract/README.md)
2. [230 — MCUboot and A/B](roadmap/230-mcuboot-ab/README.md)
3. [240 — Update Coordinator](roadmap/240-update-coordinator/README.md)
4. [250 — Safe boot](roadmap/250-safe-boot-mode/README.md)
5. [260 — Maintenance UART](roadmap/260-local-maintenance-uart/README.md)
6. [270 — OTA Wi-Fi](roadmap/270-wifi-ota/README.md)
7. [280 — Remote console](roadmap/280-remote-console/README.md)
8. [290 — Update qualification](roadmap/290-update-qualification/README.md)

For the reasoning behind these phases, also read the
[OTA and maintenance plan](roadmap/OTA-REMOTE-MAINTENANCE.md). Tests and results
are in [verification/update](verification/update/README.md) and its
[Qualification Report](verification/update/QUALIFICATION_REPORT.md).

### V1 platform closure

1. [291 — Resource profiles](roadmap/291-resource-profiles/README.md)
2. [292 — Connectivity Manager](roadmap/292-connectivity-manager/README.md)
3. [293 — Workspace TLS](roadmap/293-secure-workspace/README.md)
4. [294 — Service lifecycle](roadmap/294-service-lifecycle/README.md)
5. [295 — Low-energy power](roadmap/295-low-energy-power/README.md)
6. [296 — Health supervisor and watchdog](roadmap/296-health-supervisor/README.md)
7. [300 — Port and transport V1](roadmap/300-port-transport-v1/README.md)
8. [310 — Schemes and values V1](roadmap/310-schema-values-v1/README.md)
9. [320 — Module Driver V2](roadmap/320-module-driver-v2/README.md)
10. [325 — Declarative device profiles](roadmap/325-declarative-device-profiles/README.md)
11. [330 — Config and wire V2](roadmap/330-config-wire-v2/README.md)
12. [340 — Data, Runtime and V2 rules](roadmap/340-data-runtime-rules-v2/README.md)
13. [342 — Declarative processing blocks](roadmap/342-processing-blocks/README.md)
14. [345 — Record delivery](roadmap/345-record-delivery/README.md)
15. [348 — Capability Packs and resources](roadmap/348-feature-packs-resources/README.md)
16. [350 — Discovery multi-provider](roadmap/350-discovery-providers-v1/README.md)
17. [355 — Identity, security and reset](roadmap/355-identity-security-lifecycle/README.md)
18. [360 — Communication Protocol V1](roadmap/360-communication-protocol-v1/README.md)
19. [365 — BLE protocol](roadmap/365-ble-protocol/README.md)
20. [366 — OTA BLE](roadmap/366-ble-ota/README.md)
21. [367 — Handover BLE/Wi-Fi](roadmap/367-ble-wifi-handover/README.md)
22. [370 — MQTT and Node-RED](roadmap/370-mqtt-node-red-v1/README.md)
23. [375 — Gateway BLE Node-RED](roadmap/375-node-red-ble-gateway/README.md)
24. [378 — Host SDK and Node-RED contract](roadmap/378-host-sdk-node-red/README.md)
25. [380 — Developer tools](roadmap/380-developer-tools-v1/README.md)
26. [385 — Developer handbook](roadmap/385-developer-handbook/README.md)
27. [390 — V1 platform finalization](roadmap/390-v1-finalization/README.md)
28. [391 — Device Profile remote validation](roadmap/391-device-profile-remote-validation/README.md)
29. [392 — Flash/RAM on GET_RESOURCES](roadmap/392-resources-flash-ram-wire-exposure/README.md)
30. [393 — Device Profile Port transports (1-Wire)](roadmap/393-device-profile-port-transports/README.md)

Phases 210 and 290 remain partially open when they require unavailable hardware. Phase
390 distinguishes the software platform freeze from the production hardware release.

## Migration, decisions and historical documents

Read them when you need to understand why there is a choice, not as the first tutorial:

- [1:N Port-to-Module migration](roadmap/PORT-MODULE-1-N-MIGRATION.md) — replaces the
  obsolete “one Port, one Module” assumption.
- [Secure Wi-Fi change contract](roadmap/165-secure-wifi/change_contract.md)
- [Change contract Engine](roadmap/200-engine/change_contract.md)
- [Change contract MCUboot](roadmap/230-mcuboot-ab/change_contract.md)
- [Change contract Update Coordinator](roadmap/240-update-coordinator/change_contract.md)
- [Safe-boot change contract](roadmap/250-safe-boot-mode/change_contract.md)
- [Change contract Maintenance UART](roadmap/260-local-maintenance-uart/change_contract.md)
- [Change contract OTA Wi-Fi](roadmap/270-wifi-ota/change_contract.md)
- [Remote-console change contract](roadmap/280-remote-console/change_contract.md)
- [Retired implementation roadmap](IMPLEMENTATION_ROADMAP.md) — historical document;
  do not use it to implement current firmware.

## Diagnosis, hardware and release

Use this order when something does not work or before a release:

1. [Diary problems, solutions and decisions](DIARIO_PROBLEMI_SOLUZIONI_E_DECISIONI.md).
2. [Validator](VALIDATOR.md).
3. [File map](FILE_MAP.md), if the responsible owner is unclear.
4. [Hardware reminder and finalization](PROMEMORIA_HARDWARE_E_FINALIZZAZIONE.md).
5. [Update qualification](verification/update/README.md).
6. [Third-party notices](THIRD_PARTY_NOTICES.md), before distribution.

Files under `build/` are generated. Inspect them only to answer a precise diagnostic
question, using the table in [FILE_MAP.md](FILE_MAP.md); do not modify them or treat
them as authoritative documentation.

## Rule to maintain this index

When you add a Markdown introducing a new contract, component or route:

1. link it from its owner's README;
2. add it to [FILE_MAP.md](FILE_MAP.md) if you change what a developer needs to open;
3. add it here if the general order of reading changes;
4. add a phase to [roadmap/README.md](roadmap/README.md) if it is executable work;
5. verify links and conventions with `./validator`.
