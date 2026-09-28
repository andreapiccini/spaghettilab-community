# Hardware reminder and firmware finalization

[← Diary problems and decisions](DIARIO_PROBLEMI_SOLUZIONI_E_DECISIONI.md) ·
[Connectivity and Resource Contract](CONNECTIVITY_AND_RESOURCE_CONTRACT.md)

This document collects what is intentionally incomplete or simulated in the Spaghetti
LAB firmware. Use it when designing the final board and as a prompt to complete the
firmware without inventing hardware details.

**State of the document:** 11 August 2026, after completion of phase 190.

## Before designing the board

Store for every hardware review:

- complete schematic and revision number;
- datasheet and reference design of components;
- table with connectors, pins, voltages, directions, and safe state at reset;
- separate rails, maximum current, power-up sequence, and owners;
- programming method, console, debug and production procedure;
- final flash map, including any partitions for firmware updates;
- list of hardware mechanisms really present to identify and detect Module.

Devicetree must contain only verified facts on these documents. After each change, it
always controls `build/zephyr/zephyr.dts` and `build/zephyr/.config`.

## Work still to complete

### 1. Full engine and final cleaning

**Current status:** Task 200 Engine is implemented. Cleaning 210 is still open; the
300–390 steps make generic schema, protocols, transport, Discovery and Node-RED
integration before the V1 freeze.

**To do:**

- complete
  `roadmap/210-finalizzazione/TASK-210-01-ripulire-e-qualificare-il-firmware.md`;
- remove shortcut, wrappers and temporary values, then try boot, apply, rollback,
  remove, reboot and more Module on the same Port.
- implement in order the `roadmap/V1-PLATFORM-CLOSURE.md`, keeping each phase
  buildable;
- exceed the Node-RED gate with fake before depending on physical Module.

**Done when:** `main()` launches only the final engine; no hidden bring-up configurations
remain and the entire test matrix passes.

### 2. Controllable Port power supply

**Current status:** Core V1 does not declare a controllable rail. Power implements
ownership, reference counting and rollback, but is compiled out of production. Hardware
backend does not exist; `tests/power` uses a fake.

**Required hardware decisions:**

- which Ports share each rail;
- maximum voltage and current;
- chosen load switch or regulator;
- pin enable, polarity and state during reset/boot;
- stabilization time and discharge time;
- short, overcurrent protection, ESD and reverse power supply;
- behavior when a Module is inserted or removed hot.

**To be implemented after the scheme:**

- extend binding under `dts/bindings/spaghetti/` with a verified property;
- add the real descriptor to the DTS of the new board;
- implement the GPIO/regulator backend in `subsys/power/power.c`;
- enable `CONFIG_SPAGHETTI_POWER` only on the variant that owns the rail;
- initialize Power from Core;
- to acquire the Module Manager resource before `driver->ops->init()` and release it
  after `deinit()` or during each rollback;
- use the Module ID as owner: more Module on the same Port remain distinct;
- measure first-on/final-off and experience real failures.

**Done when:** pins and polarities match the schematic; two Modules share the rail and
removal of the first does not remove power to the second.

### 3. Digital Port and real relay

**Current status:** the Relay Driver is recorded and tested with a Port fake, but Core
V1 only exposes I2C. A real Config Relay correctly returns `-ENOTSUP`.

**Required hardware decisions:**

- GPIO physical Port and polarity;
- safe status during reset, boot, crash and update;
- transistor/MOSFET or driver, flyback, insulation and electrical limits;
- type of permissible load and exclusive ownership of Port;
- any feedback that confirms the actual output state.

**To be implemented after the scheme:**

- extend the Port binding with digital-output capability and GPIO reference;
- describe the real Port in the board DTS;
- implement `spaghetti_port_set_output()` on the GPIO Zephyr verified;
- try active-high, active-low, safe state, controller error and reboot;
- check with measuring tools that the load is not activated during boot.

**Done when:** the Relay controls real hardware and always returns to the safe state during init,
deinit and error paths.

### 4. Automatic Module discovery

**Current status:** Discovery accepts manual results and manages multiple key results
for Port, but `spaghetti_discovery_scan_port()` returns `-ENOTSUP`. A I2C scan is not
enough to identify with certainty the type of Module.

**Required hardware decisions:** choose a reliable identity, for example an EEPROM with
a versioned record, an identification component, dedicated pins, or a protocol defined by
the Module. Also define insertion/removal detection, the power needed for reading, and
collisions on the bus.

**To be implemented after choosing the mechanism:**

- document format, version, CRC/authenticity, limits, and Module-key assignment;
- create a board-specific provider that implements `struct
  spaghetti_discovery_provider_ops`;
- issue zero, one, or more results per Port without assuming Port = Module;
- integrate insertion/removal events with bounded generations and timeouts;
- do not perform destructive probes and do not associate an address to a supposition
  driver;
- verify multiple modules, unknown device, corrupt record, timeout, removal and
  reinsertion.

**Done when:** firmware automatically identifies a Module through an authoritative hardware
data and removes only the affected key.

### 5. Wi-Fi security and physical device protection

**Current status:** passwords do not enter the repository or history and are saved with
PSA ITS and AES-GCM. Zephyr 4.4 derives the key from the device ID and warns that it is
not a root of trust that is resistant to a physical attack. Secure Boot, Flash
Encryption, debug policy and eFuse are not configured by firmware.

**Production decisions required:**

- threat model and level of protection required;
- root key hardware/eFuse and provisioning responsibility;
- Secure Boot and image signature;
- Flash Encryption;
- JTAG/UART download, device-recovery, and debug policy;
- rotation, cancellation and reset of credentials;
- safe storage of production keys and traceability.

**To implement:**

- check on official sources Espressif and Zephyr the procedure adapted to the actual
  mounted SoC review;
- replace the device-ID provider with a verified hardware root;
- create a separate, explicit and repeatable manufacturing procedure;
- add a reset factory mode that deletes Config, Wi-Fi profiles and other secrets
  according to a defined policy;
- try update, recovery and power loss during provisioning.

**Warning:** burning eFuses or disabling debug can be irreversible. Never do this
automatically and do not execute these commands without explicit approval.

### 6. Encrypted and authenticated MQTT

**Current status:** MQTT uses QoS 0, retain false and TCP unencrypted, normally on port
1883. TLS and broker authentication are not implemented.

**Required decisions:**

- broker and production port;
- CA trust anchor and hostname verification;
- authentication with username/password or client certificate;
- location and procedure for provisioning and rotating secrets;
- QoS policy, retain, Last Will, expiration and offline behavior;
- unique identity of the Core and final topic format.

**To implement:**

- extend Config and its codecs in a versioned, backward-compatible way;
- use TLS Zephyr transport with obligatory server verification;
- keep secrets out of logs and, if persistent, in secure storage;
- define static limits for certificates, code and buffer;
- test an incorrect or expired certificate, wrong hostname, unavailable broker,
  reconnection, and a full queue without blocking Runtime.

**Done when:** no sample or secret crosses the network in cleartext and an unauthorized broker is
refused.

### 7. Serial protocol for the app

**Current status:** Communication has general requests and answers, but the only adapter
is Zephyr Shell. Shell remains useful for development and provisioning; a machine
protocol for the app is not yet defined.

**Required decisions:**

- USB CDC, UART, BLE, or another transport;
- framing, version, length, checksum and timeout;
- CBOR format of requests and answers;
- correlation ID, errors, retries, and duplicate requests;
- access to sensitive operations and provisioning modes;
- coexistence between console log, Shell and machine protocol.

**To implement:** create an adapter that builds `struct spaghetti_request`, calls
`spaghetti_communication_handle_request()` and serializes the answer, without calling
Config or Manager directly. Make fuzz/test on truncated, oversized, duplicated and
unknown frames. Do not remove the recovery serial until there is a verified alternative
procedure.

**Done when:** the app configures and queries the Core through a versioned protocol, while
the Maintenance Shell remains available according to the policy chosen.

### 8. Core production variant

**Current status:** `spaghettilab_core_v1` describes the current ESP32-C3 hardware.
`spaghettilab_core_v2_build_only` only checks the portability and must not be flashed.

**To do for each final PCB:**

- create a new Zephyr board based on the true pattern, without copying simulated pins;
- check SoC, flash, PSRAM if present, oscillators, antenna, USB, console and runner;
- describe all and only physical Port with real controllers and capabilities;
- verify partitions, storage, alignments and space for the update strategy;
- build and try the variant separately without `#ifdef` on the board name in the common
  C;
- store `zephyr.dts`, `.config`, file map and hardware review results.

**Done when:** each selectable variant represents a real board or is explicitly marked with the
suffix `build_only` and does not have flash runners.

### 9. Electricity and reliability

This part cannot be inferred from the firmware. Before production, define and
test at least:

- pull-up and I2C bus capacity with all Module expected;
- configurable I2C addresses and collision management;
- hot insertion, back-powering, ESD, short circuits, and brownouts;
- boot without Module, Module fault and disconnection during a transaction;
- power loss during writing Config, Wi-Fi and secure storage;
- flash endurance and maximum write frequency;
- consumption in real conditions and thermal limits;
- watchdog, recovery and firmware update, if required by the product;
- prolonged testing with Wi-Fi, MQTT, Runtime, and multiple simultaneous Modules.

OTA and remote console are now planned in phases 220–290. The Maintenance Link is
independent of the Core V1 use of GPIO3/GPIO4 as I2C or UART, while every other
board/overlay must provide the same capability with its own hardware. An absent Config
enters local UART maintenance directly; with a valid Config, maintenance is entered
during a bounded boot window or through a one-shot marker followed by reboot. A global watchdog and
low-power still require dedicated implementation and qualification.

## Recommended order

1. Run the automated part of task 210 and record the deferred physical cases.
2. Implement 300–390 software steps with fake and freeze Protocol V1.
3. Switch to main development Node-RED using catalog and MQTT V1.
4. Draw the schematic and define the final pinout and board requirements.
5. Create new board variant and test Port/capability.
6. Implement Power, Relay and Discovery provider only if present.
7. Complete 210 hardware cases, production safety and physical qualification 290.

## Prompt to use to complete the job

Copy the following text and attach schema, datasheet, pinout and updated requirements.

```text
Complete the hardware-dependent and production-ready parts of the Spaghetti LAB firmware.

Before modifying any file:
1. read FIRMWARE_IMPLEMENTATION_GUIDE.md completely;
2. read PROMEMORIA_HARDWARE_E_FINALIZZAZIONE.md;
3. inspect the repository, git status, roadmap, board DTS/bindings, and current build;
4. inspect the installed Zephyr version and use only APIs and bindings that are
   actually available in that version;
5. compare every pin, polarity, rail, controller, address, and safe state with the
   attached schematics and datasheets;
6. report all missing or contradictory information and do not invent it.

Attached hardware and requirements:
- PCB revision: <INSERT>;
- schematic: <ATTACH OR PROVIDE PATH>;
- datasheets/BOM: <ATTACH OR PROVIDE PATH>;
- pinout and connectors: <ATTACH>;
- shared rails and sequences: <INSERT>;
- Module identification method: <INSERT>;
- Relay/output requirements: <INSERT>;
- protocol required by the app: <INSERT>;
- broker, TLS, and authentication: <INSERT WITHOUT PASTING SECRETS>;
- security model and eFuse process: <INSERT>;
- update/recovery strategy: <INSERT>.

Preserve the architecture:
Port -> Module Driver -> Registry -> Module Manager -> Config -> Runtime -> Data ->
Communication/MQTT.

Preserve Port -> Module as a 1:N relationship. A Module is identified by its key,
driver, Port, and driver endpoint/configuration; an I2C Port is not occupied by a
single Module. Keep deterministic, heap-free memory in Spaghetti code and preserve
explicit ownership, lifetime, errno, timeout, rollback, and thread contexts.

Proceed in this order:
- first complete roadmap tasks 200 and 210 if they are still TODO;
- create or update a Zephyr board for the real hardware revision;
- implement only physically present capabilities;
- connect the real Power backend and Manager only if a controllable rail exists;
- enable Relay only on a verified digital-output Port;
- implement automatic Discovery only with an authoritative hardware identity;
- define and implement the versioned serial adapter for the app;
- replace plaintext MQTT with authenticated TLS;
- replace the Wi-Fi key derived from the device ID with the approved hardware root and
  document the production procedure.

Do not burn eFuses, disable debugging, use real credentials, or perform irreversible
actions without my explicit approval. Do not put secrets in the repository, logs,
commands, or tests.

For every change:
- update the relevant documentation and roadmap;
- add fake/native tests for success, limits, and errors;
- add measurable hardware tests when necessary;
- run the validator, Twister, and a pristine build for every real board;
- inspect zephyr.dts, .config, and the sources actually included by CMake;
- preserve unrelated local changes.

At the end, report:
- what was already implemented and what was missing;
- which hardware facts were verified and from which document;
- modified files;
- implemented APIs and flows;
- tests run and their results;
- remaining limits or open decisions;
- any irreversible production operations that must still be performed manually.
```

Update this reminder when an item is completed: do not erase the history of the hardware
decision; mark it as completed and record the PCB revision, commit, and test performed.
