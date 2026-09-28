# Diary of problems, solutions and decisions

[← README](README.md) · [Architecture](ARCHITECTURE.md) · [Connectivity and resource
contract](CONNECTIVITY_AND_RESOURCE_CONTRACT.md) · [Hardware
reminder](PROMEMORIA_HARDWARE_E_FINALIZZAZIONE.md)

This document preserves the technical incidents encountered during the development of
the Spaghetti LAB firmware, the actual cause, the solution adopted and the architectural
decision derived from it. It is an operational record updated through 14 August 2026, not
a substitute for testing or documentation of components.

## How to read this record

Each entry uses one of these states:

| State | Meaning |
|---|---|
| **Fixed** | Cause and correction are implemented or documented with repeatable verification. |
| **Expected** | The observed behavior is correct and requires no correction. |
| **Mitigated** | The system works, but the cause or final solution requires further evidence. |
| **Planned** | The decision is frozen, but implementation is not complete. |
| **Deferred** | Real hardware or unavailable production decisions are required. |

Do not turn a **Mitigated**, **Planned**, or **Deferred** entry into a product
promise. Before changing a solution already adopted, read the “Result and permanent
rule” field: often explains what regression the solution was avoiding.

## Quick diagnosis

When a new problem appears, use this order:

1. preserve the first complete error, not only Ninja's final line;
2. run `make validate` to check exactly the sources selected by CMake;
3. if Kconfig, CMake or Devicetree have changed, run `make pristine`;
4. for a hardware error, distinguish “driver compiled” from “physically connected and ready
   device”;
5. for network or TLS, save Wi-Fi status, service status and first handshake error;
6. for a crash or `-ENOMEM`, measure stacks and memory under the real workload, not only
   at boot;
7. for OTA, never delete the image confirmed during diagnosis.

First diagnosis commands:

```sh
make validate
make pristine
make ports
make monitor
make screen
```

Shell commands on the device:

```text
spaghetti status
spaghetti wifi scan
spaghetti wifi list
wifi status
spaghetti remote status
kernel thread stacks
```

## Formatting and validator

### Space indentation, trailing whitespace, and header contracts

**State:** Fixed.

**Observed symptoms:**

```text
ERROR [C001] ... Block indentation uses spaces
ERROR [FMT001] ... Trailing whitespace
ERROR [HDR004] ... Public function parameter is undocumented
ERROR [HDR005] ... Public function return contract is incomplete
```

**Cause:** the firmware follows Zephyr C style: each block level uses a real tab, while
spaces are reserved for continuation alignment. Public headers must also document
parameters, direction, ownership, lifetime, and results. Pressing the Tab key is not enough
if the editor automatically converts it to spaces.

**Solution:** configure the editor to insert tabs in C files, remove trailing whitespace, and
complete Doxygen with `@param`, `@retval` or `@return`. To see the invisible characters
of a row:

```sh
sed -n '33l' spaghetti_modules/ina219/ina219.c
```

`\t` represents a real tab; spaces or tabs before `$` indicate trailing whitespace. The
authoritative guide is
[FIRMWARE_IMPLEMENTATION_GUIDE.md](FIRMWARE_IMPLEMENTATION_GUIDE.md).

**Check:** `make validate` and, during a local change, `./validator path/to/file`.

**Result and permanent rule:** fix first structural error, because a confused parser can
produce other secondary HDR errors. Do not disable a rule to bypass the editor
configuration.

### The validator checked files that the build didn't build

**State:** Fixed.

**Problem:** a recurring scan of the folder reported future, incomplete or unselected
files from the build. The result was not what `make` would compile.

**Solution:** CMake evaluates `SOURCES` and `INCLUDE_DIRECTORIES` properties of `app`
target and passes them to validator. Headers enter through the real graph of include.
`make validate`, `make build`, `make pristine` and a direct `west build` therefore share
the same source set.

**Result and permanent rule:** the validator should not return to scan the whole
repository by default. To explicitly check roadmap, overlay or unfinished file, you pass
the path to `./validator`. Details in [VALIDATOR.md](VALIDATOR.md).

## Compiling and linking

### INA219 header not found

**State:** Fixed.

**Symptom:**

```text
fatal error: spaghetti_modules/ina219/ina219.h: No such file or directory
```

**Cause:** the form of the `#include` did not correspond to the directories exported to
the compiler. Adding `spaghetti_modules/ina219` to the include path makes `<ina219.h>`
available, not automatically `<spaghetti_modules/ina219/ina219.h>`.

**Adopted solution:** concrete drivers expose their own private include directory
from the application `CMakeLists.txt` and callers use:

```c
#include <ina219.h>
```

**Check:** read the full compiler or `compile_commands.json` command, then check that
the desired path is present between `-I` options.

**Result and permanent rule:** do not fix an include by copying headers into arbitrary
folders. Decide first whether the contract is public under `include/spaghetti/` or
private to the driver, then keep includes and CMake consistent.

### `undefined reference to spaghetti_ina219_driver`

**State:** Fixed.

**Symptom:** header compilation completed, but the linker could not find the
`spaghetti_ina219_driver` descriptor used by the Registry.

**Root cause:** a linker error means that the statement is visible, but the
definition did not enter the image with the same name and linkage. The causes to check
are: source absent from `target_sources`, symbol declared `static`, different name or
non-active conditional compilation.

**Adopted solution:** `spaghetti_modules/ina219/ina219.c` is an explicit source of the
`app` target; `ina219.h` declares the descriptor with `extern` and `.c` defines it with
external linkage.

**Result and permanent rule:** always distinguish:

- `No such file or directory`: include or compilation problem;
- `undefined reference`: object or symbol problem at the link.

Do not add a second definition in the Registry to make the error disappear.

## Hardware and Module

### INA219 initialization failed with `-19`

**State:** Expected when the sensor is not connected.

**Symptom:**

```text
INA219 initialization failed: -19
```

**Cause:** `-19` is `-ENODEV`: the expected controller or device is not available. In
the case observed INA219 was not physically connected.

**Solution:** connect power, mass, SDA and SCL, check pull-ups and I2C address, or run
firmware without configuring that Module. Do not turn physical absence into a false
success.

**Result and permanent rule:** a successful build shows that the driver has been
compiled; it does not show that the hardware responds. An absent Module must fail in
isolation without stopping Communication or making Core unusable.

### The incorrect assumption “one Port equals one Module”

**State:** Fixed.

**Problem:** an I2C Port can host multiple devices simultaneously, such as INA219
`0x40`, INA219 `0x41`, and SHT40 `0x44`. Marking the Port “occupied” made it impossible to
represent a shared bus.

**Solution:** the relationship is Port 1:N Module. A Module is identified by a persistent key
and a Port, driver, and normalized configuration/endpoint. The Manager offers `get_by_key()`
and `list_by_port()`; the old single search for Port is ambiguous. Each driver has slabs
typed for their contexts instead of a universal buffer.

**Result and permanent rule:** Port serializes the controller, but does not own the
Module and does not artificially limit the bus to one instance. The full report is in
[PORT-MODULE-1-N-MIGRATION.md](roadmap/PORT-MODULE-1-N-MIGRATION.md).

## Config, storage and credentials

### Wi-Fi password in the repository or Shell history

**State:** Fixed for development path; physical safety of postponed production.

**Problem:** pass the password as an argument makes it visible in history, logs and
host processes. Insert it into `prj.conf` or overlay the port into the repository and
image.

**Solution:** `spaghetti wifi add` reads the password with hidden input. Wi-Fi Profiles
stores it in PSA ITS with AES-GCM encryption inside the NVS partition. Lists,
status and logs only expose non-secret metadata. Remote console and OTA credentials are
separated because they grant different permissions.

**Result and permanent rule:** Config of Module and network credentials have different
owners. The current storage key derived from the ID device is not a root of trust
against a physical attack: eFuse, Secure Boot, Flash Encryption and industrial
provisioning remain explicit and potentially irreversible.

### Wi-Fi profile survives reboot but may not survive flashing

**State:** Fixed as documented behavior.

**Behavior:** a reboot and a normal `make flash` are not factory-reset commands, and
the NVS partition continues to contain profiles, except incompatible modification of the
flash map or complete chip cancellation. `make pristine` deletes and rebuilds host
artifacts, not device flash.

**Check:** after reboot run:

```text
spaghetti wifi list
```

**Result and permanent rule:** always distinguish build pristine, flash of images and
chip erase. A future factory-reset function must declare exactly which records
it deletes.

### `spaghetti wifi connect` fails but the profile exists

**State:** Mitigated with state and deterministic worker.

**Correct diagnosis:** `spaghetti wifi list` separates the saved profile, visible network,
worker status and last error. `wifi status` shows the Zephyr interface. A persistent
profile does not mean that a connection request was accepted in that mode or that the
access point is visible.

**Adopted solutions:** a single worker owns scan and association; the visible preferred
profile is tried first, otherwise the known networks in order RSSI are tested. An
initial delay avoids starting the cycle while network and other services are still
completing the boot.

**Result and permanent rule:** do not interpret an isolated numeric errno without the
status of the service. In `UNPROVISIONED` and `MAINTENANCE` the profiles are editable
but the network remains intentionally offline. Nearby networks are listed with
`spaghetti wifi scan`; that command does not connect.

### `spaghetti wifi` had no catalog scan

**State:** Fixed.

**Problem:** `spaghetti wifi list` showed only saved profiles. Nearby access points were
visible only through Zephyr `wifi scan`, so the product shell could not provision a
network by itself.

**Solution:** `spaghetti wifi scan` runs a station scan, including in unprovisioned
mode, and prints SSID, RSSI, security (`open`/`wpa2`/`other`), and whether a profile
is already saved. At most eight strongest SSIDs are kept. The radio may power for the
scan duration and is taken down afterwards when no worker is running. `wifi connect`
still returns `-ENOTSUP` until Normal mode.

**Permanent rule:** discover with `spaghetti wifi scan`, save with `wifi add`, connect
only after the device is in Normal mode.

## Serial console and host tools

### `make screen` and `make monitor`

**State:** Fixed and documented.

`make screen` is the raw serial terminal. `make monitor` uses `tools/device.py`,
pyserial and Rich for autodetect, reconnection, colors and tables. They are not the same
program, even if they read the same UART. Only one process can open the port at a time.

**Permanent rule:** use `screen` as a minimal fallback and `monitor` for normal
development. Close the monitor before flashing when the runner requires the same port.

### USB Shell and Protocol V1 share one Serial/JTAG pipe

**State:** Fixed.

**Problem:** React Flow needs framed Protocol V1 on USB. The Core already exposes
USB Serial/JTAG as the Zephyr Shell. Two host programs cannot open the port, and
binary frames would be eaten by the Shell ASCII filter.

**Solution:** the firmware intercepts UART IRQ after Shell init. A `0x02` length
prefix is a Protocol request; other bytes go to the Shell. While a protocol
session is active, Shell TX (prompt and logs) is dropped so the host decoder
stays aligned. `Ctrl-C` or 30 s idle restores the Shell. No USB Device stack and
no BLE-sized 2048 B reassembly. After buffer reuse (decoder doubles as TX
scratch) the default image is 362368 B DRAM (99.19%), slack 2960 B.

**Permanent rule:** `make monitor` and `spaghetti --transport serial` / React Flow
are exclusive on the same cable by choice, not a second USB gadget.

### Safari cannot open USB (no Web Serial)

**State:** Fixed.

**Problem:** React Flow on Safari (and Tauri WKWebView) has no `navigator.serial`.
Waiting for a native app is not required for local USB on this Mac.

**Solution:** `make usb-bridge` opens Serial/JTAG with Protocol V1 stream framing
and exposes `ws://127.0.0.1:8766`. `/list` returns JSON cores; `/core/<id>` uses
the existing React Flow WebSocket shape (raw request envelope in, kind + envelope
out). Chrome can keep using Web Serial. Close `make monitor` first.

**Permanent rule:** do not teach Safari to speak USB length-prefixed frames; the
bridge is a host adapter. Do not reuse the BLE gateway JSON/token control plane
for this path.

### Missing Rich/pyserial dependencies

**State:** Fixed.

**Symptom:** `make monitor` asked to install `pyserial` and `rich` globally.

**Solution:** use the virtual environment of the repository:

```sh
make host-tools
source .venv/bin/activate
make monitor
```

**Result and permanent rule:** do not install project Python dependencies in
the Python system. `tools/requirements.txt` is the source of host dependencies.

### Prompt `uart:~$` absent until the first Enter

**State:** Fixed.

**Observed causes:** Zephyr did not always redraw the prompt after a reconnection;
opening the USB Serial/JTAG could also change DTR/RTS and reset ESP32-C3. Sending a
return to head to wake up Shell added an empty line to history and contributed to the
loss of the previous command.

**Solution:** the monitor opens the port without toggling DTR/RTS boot/reset lines, disables
`HUPCL` where available, and sends `Ctrl-C` with bounded attempts until it sees
the prompt. The `--no-wake` option preserves a future binary protocol.

**Result and permanent rule:** synchronize an interactive Shell with a signal that does
not become a historical command. Do not assume that opening a serial port is an
electrically neutral operation on USB Serial/JTAG.

### Prompt color and output difficult to read

**State:** Fixed.

**Problems:** artificially colored `uart:~$` produced color changes after reset or
controls; `wifi scan`, `wifi status` and multiline help were unreadable.

**Solution:** the prompt is forwarded as terminal bytes without imposing a style.
The formatter recognizes known structures and uses Rich tables with neutral borders, columns, and
colors only for the data they benefit from. The firmware output remains textual and can
also be used with `make screen`.

The `*float*` literal value shown by `wifi status` was not a PHY measurement: it was the
`cbprintf` placeholder when floating-point formatting support was unavailable. The build
enables `CONFIG_CBPRINTF_FP_SUPPORT`; the monitor also retains an explicit “unavailable”
fallback instead of presenting `*float*` as valid data.

**Result and permanent rule:** the presentation belongs to the host tool, not to the
firmware protocol. Do not change the meaning of messages to make them beautiful.

### Remote console arrows and history

**State:** Fixed in the current host tool.

**Problem:** remote console is a small parser, not Zephyr Shell. ANSI arrow sequences
moved the local cursor or left a different line on the device than the one shown.

**Solution:** `NetworkLineEditor` maintains a host history bounded to 32 elements,
interprets up/down arrows, replaces both the visible line and the line already sent to the
peer and manages fragmented ANSI sequences. Unsupported left/right arrows are ignored
instead of corrupting the command.

**Result and permanent rule:** the restricted network console should not pretend to be a
complete Shell. Editing and history remain in the client, while the firmware receives a
consistent and bounded line.

## Authenticated remote console

### Provisioning timeout or unrecognized mode

**State:** Fixed.

**Symptoms:**

```text
Timed out waiting for device response
The USB Shell did not return a recognizable Core mode
The Core did not accept Normal-mode activation
```

**Cause:** prompt remnants could prematurely end response reading; sending the PSK all
together could saturate the small RX path; the tool had to explicitly manage Normal,
Maintenance and Unprovisioned, including reboot and reconnection USB.

**Solutions:** synchronization on the prompt, bounded cleaning of the buffer before the
first command, paced transmission of the hidden PSK, and the compound
`make remote-console-enable`
flow. It preserves a valid Config or installs a secure blank Config,
enters Maintenance, provisions the credential, and returns to Normal.

**Result and permanent rule:** provisioning a credential should not depend on a random
prompt and should not copy the PSK into argv or history.

### TLS `-113` errors, repeated handshake and exhausted sockets

**State:** Fixed for current implementation; TLS memory to be redesigned.

**Symptoms:**

```text
TLS client accept failed: -113
TLS handshake error
Cannot allocate a new TCP connection
```

**Confirmed combined causes:** accept/send failures did not always close the client
through the same path; the loop could reuse stale socket descriptors immediately after
an accept; the host client retried too quickly. The mbedTLS library also required a
sufficiently large arena for real load.

**Adopted solution:** centralized client closure on every error, a new loop cycle after
accept, propagated send/receive errors, bounded pause before the host reconnection and
mbedTLS arena dedicated by 60,000 bytes.

**Check:** direct authenticated connection:

```sh
make monitor TRANSPORT=network HOST=192.168.1.23
```

The console must show `network:~$`, accept `help` and `spaghetti status`, then release
the client after `Ctrl-X` without a socket storm.

**Result and permanent rule:** 60 KiB cannot be removed by ignoring why they were added.
Future replacement must repeat handshake, disconnections, retry and failed allocations
under load.

### Device not found by `remote-console-list`

**State:** Mitigated.

**Diagnosis:** before checking on your device:

```text
spaghetti wifi list
wifi status
spaghetti remote status
```

`state=listening`, a present credential, and a reachable IP address are distinct
prerequisites. Scanning requires a truly routed CIDR subnet and the same identity/PSK.
When IP is known, direct connection is the simplest proof.

**Result and permanent rule:** the discovery of the console accepts only peers who
complete authentication; it must not clearly announce the presence of the service and
does not replace routing, firewall or VPN.

## Boot, MCUboot and updates

### Core mode not visible in logs

**State:** Fixed.

The boot now reports separately operating mode, image status, slot, confirmation and
version, for example:

```text
boot: mode=unprovisioned image=confirmed slot=0 confirmed=1 version=0.1.0+0
```

**Result and permanent rule:** `NORMAL/MAINTENANCE/UNPROVISIONED` and `TRIAL/CONFIRMED`
are independent sizes. `NORMAL + TRIAL` is valid during the health window; do not
introduce a unique mode that mixes the two things.

### MCUboot and A/B images verification

**State:** Fixed for build and boot development.

Sysbuild produces MCUboot and the signed application. `tools/device.py flash --dry-run`
showed real offsets extracted from runners generated instead of copied addresses in the
Makefile. A new image starts as a trial and becomes confirmed only after Core reaches
RUNNING and exceeds the window health. A previous reset allows rollback.

**Result and permanent rule:** the application running does not confirm an image during
upload. MCUboot checks the signature before the execution and Update writes only the
secondary slot.

### `update-qualification-check` lists all Pending cases

**State:** Expected until physical evidence is recorded.

The manifest with hashes, versions, and metadata shows that artifacts are identified; it does
not show interruptions, rollback and recovery. `Final results: 0` followed by `Q-*`
pending cases is therefore the gate that refuses an incomplete qualification, not a
firmware error.

**Result and permanent rule:** does not mark the completed 290 phase using fake or an
empty manifest. Hardware evidence is added progressively while ESP32-C3 boards and prototypes are
available.

## Crash, stack and RAM

### Instruction Access fault immediately after boot

**State:** Mitigated; the pressure on the stacks has been measured.

**Symptom:** CPU exception with an invalid program counter/return address while the log
indicated the idle thread. This pattern is compatible with memory corruption, but the
only crash dump does not show which buffer caused it.

**Subsequent evidence:** the PSA initialization path during boot required several
stacks larger than the previous defaults. Wi-Fi Profiles documents that 2048 bytes were insufficient and could
corrupt the adjacent stack. The stacks were made explicit and the `kernel thread stacks`
command is used to measure the watermark.

**Result and permanent rule:** does not automatically attribute each Instruction Access
fault to the idle thread shown in the dump. The current thread can be the victim of
corruption. Store call trace, temporarily increase margins and measure the path that
uses crypto, network and logging.

### Shell to 96% and stack reduction

**State:** Fixed for tested loads, to be repeated when BLE and MQTT TLS arrive.

Observed measurements:

```text
shell_uart 4096 bytes: 3972 used, 96%
shell_uart 5120 bytes: 3972 used, 77%
wifi_profiles_worker 4096 bytes: 2440 used, 59%
spaghetti_remote 6144 bytes: observed peaks between 33% and 66%
logging 768 bytes: about 384-400 used in the observed tests
```

Shell was brought to 5120 bytes instead of reducing it. The logging stack was reduced
after measurement. Stack OTA and MQTT seemingly empty were not reduced, because heavy
routes had not yet been exercised.

**Result and permanent rule:** size for the maximum path actually executed, including adequate
margin, not from the boot percentage. Repeat measurements with Wi-Fi, TLS, OTA, errors,
log flood, BLE and maximum Module number.

### IRQ stack 100%

**State:** Mitigated; measurement not used as a single test.

The IRQ watermark on ESP32-C3/RISC-V has been 100% even increasing the stack a lot,
indicating that initialization/instrumentation can touch the whole area and make the
watermark little representative of normal use. The experimental override was removed.

**Result and permanent rule:** does not continue to increase RAM on the basis of the IRQ
watermark alone. We need reproducible crash, reliable canary or supported by the Zephyr
port.

### Static RAM at about 85%

**State:** Planning an architectural solution.

The ESP32-C3 build showed about 307 KiB used on 365 KiB available, leaving about 58
static KiBs. A first review of stacks recovered about 4.6 KiB, but also showed that
micro-optimizing unexercised stacks would be dangerous.

The main blocks identified are:

- private 60,000-byte mbedTLS arena;
- additional heap required by Wi-Fi Espressif;
- static stacks of services that do not always work;
- buffer and network code, Shell, MQTT, OTA and remote console.

**Result and permanent rule:** the problem is not solved by cutting blindly. We need
Core profiles, service lifecycle, bounded capacity and worst case testing.

### Why the 60 KiB mbedTLS arena exists and how it will be replaced

**State:** Planned, not yet implemented.

The arena was added to stabilize TLS. It does not contain the complete OTA firmware and
is not a feature: it is exclusive work memory for handshake, record, encryption and
contexts. However, it remains unavailable to the rest of the firmware even when no connection is active.

The frozen decision is to retain mbedTLS and TLS/DTLS functionality, but replace the
arena always resident with a bounded workspace acquired when needed. On the Minimal
profile only one heavy secure operation is allowed: MQTT disconnects before OTA and
the remote production console is not compiled.

**Mandatory tests before removal:**

- console and MQTT TLS with correct and incorrect credentials;
- repeated handshakes and disconnections during the handshake;
- OTA Wi-Fi complete, timeout and network loss;
- failed allocation without loss of Config or confirmed image;
- Wi-Fi and BLE logically connected in the same load;
- absence of leak or fragmentation after repeated cycles.

The complete contract is in
[CONNECTIVITY_AND_RESOURCE_CONTRACT.md](CONNECTIVITY_AND_RESOURCE_CONTRACT.md).

## Connectivity and derived energy decisions

### BLE-first and Wi-Fi on-demand

**State:** Mitigated on Core V1 (compile-time radio split); runtime XOR remains the
policy inside each image.

For a low consumption Core, the result is:

```text
NORMAL + LOW_ENERGY
    Runtime active
    BLE according to policy, and only if this image compiled CONFIG_BT
    Wi-Fi, MQTT, OTA IP, and TLS off

NORMAL + ONLINE
    Runtime active
    Wi-Fi/MQTT if this image compiled CONFIG_WIFI
    BLE off
```

On ESP32-C3 these two policies cannot share one binary: Wi-Fi and BLE both fit
separately, not together. Default `make build` is Wi-Fi. `make build-ble` is BLE.
React Flow talks to the radio that the flashed artifact advertises in capabilities.
Switching medium is a reflash, not a Config field. USB Shell stays on both images.

An authenticated peer can still request a temporary Wi-Fi lease **only on a Wi-Fi
image**. Enable Wi-Fi does not automatically open OTA or remote console.
Maintenance and Update have timeout and do not become persistent Config.

**Result and permanent rule:** BLE is a common CBOR protocol adapter, not a second
Config model. Node-RED can communicate directly via BLE on a local host or through a
base; MQTT on Core is not mandatory. Do not compile both radios into one Core V1
image. Do not treat linker `dram0_0_seg` ~97% as a runtime crash warning: almost all
of that SRAM is reserved tables and the ~51 KiB Wi-Fi heap. The runtime risk is that
shared heap at Wi-Fi+MQTT(+OTA) peak, not the unused linker slack.

See the 2026-08-14 RAM entry below.

### ESP32-C3 SRAM: Wi-Fi and BLE do not fit in one image

**State:** Fixed (product decision). Measured 14 August 2026 on
`spaghettilab_core_v1/esp32c3`, Zephyr 4.4.0, region `dram0_0_seg` 365328 B.

**Observed symptoms:**

```text
region `dram0_0_seg' overflowed by 15952 bytes   # CONFIG_BT on top of Wi-Fi, heap 51480
region `dram0_0_seg' overflowed by 13552 bytes   # same after ~2 KiB field cuts
```

Wi-Fi-only and BLE-only both link:

| Image | Command | DRAM used | Free | Kernel heap |
|---|---|---:|---:|---:|
| Wi-Fi + MQTT (default) | `make build` | 362368 B (99.19%) | 2960 B | 51480 |
| BLE only | `make build-ble` | 288528 B (78.98%) | 76800 B | 25600 |

Wi-Fi is about 65 KiB more DRAM than BLE (Espressif heap add 51200 vs 25600, plus
IP/MQTT/OTA DTLS). Cutting Zephyr `wifi` shell, TLS contexts 4→1, INF logs, and
printf `%f` saved ~2.4 KiB and did **not** make room for BLE beside Wi‑Fi. Those
lab conveniences are restored on the default image.

**Cause:** ESP32-C3 shares one 2.4 GHz radio *and* one internal SRAM pool. The Wi-Fi
blobs and `CONFIG_HEAP_MEM_POOL_ADD_SIZE_ESP_WIFI` already fill the board. BLE
controller BSS plus `ADD_SIZE_ESP_BT` (25600) does not fit on top. Linker occupancy
is not “free RAM for malloc”: the 51 KiB system heap is already inside the used
region.
`current_config` and `config_workspace` (18 KiB each) and `live_plan` /
`work_plan` (10 KiB each) are live-plus-scratch copies so apply/validate do not
corrupt the running graph or overflow the 5 KiB Shell stack.

**Solution adopted:**

- Default artifact: Wi-Fi, `CONFIG_BT` off (`prj.conf`).
- BLE artifact: `overlay-ble.conf`, `make build-ble`, Wi-Fi/IP/MQTT off.
- Stubs: `wifi_profiles_disabled.c`, `mqtt_disabled.c`, `ota_dtls_disabled.c`.
- Capability bits follow `CONFIG_WIFI` / `CONFIG_BT` / `CONFIG_MQTT_LIB`.
- ESP-NOW is Wi-Fi, not a low-energy BLE substitute, and was not added.

**Result and permanent rule:**

1. Measure `dram0_0_seg` and heap add-size before enabling a second radio.
2. Do not use runtime free-heap as an installability gate.
3. Do not shrink Shell below 5120 B (measured ~4 KiB used).
4. Do not persist empty Config with `spaghetti maintenance finish` on an
   unprovisioned Core (boots Normal with radios).
5. Future Cores with more SRAM (S3/C6) may revisit a single image; V1 C3 does not.
6. Dual Config and dual processing plan stay: they are commit/scratch, not two
   live systems.

### ESP32-C3, S3, C6, Matter and Zigbee

**State:** Hardware decision open; architectural boundary frozen.

- ESP32-C3 offers Wi-Fi and BLE, but not IEEE 802.15.4; Wi-Fi and BLE share radio and
  can be logically active while RF access is alternating.
- ESP32-S3 offers more SRAM and can have PSRAM. Supports Matter over Wi-Fi, but does not
  Matter over Thread without an external 802.15.4 radio.
- ESP32-C6 integrates Wi-Fi, BLE and IEEE 802.15.4 for Thread/Zigbee, but availability
  and RAM of the concrete stack must be verified with Zephyr and the hardware chosen.

**Result and permanent rule:** Matter, Thread and Zigbee are not V1 requirements. A base
can act as a BLE-MQTT/Matter/Zigbee bridge without loading these stacks onto every Core. Do
not declare a capability only because the SoC could support it.

## Remaining open problems

These items do not yet have an implemented solution:

| Area | Current state |
|---|---|
| Hardware discovery | Deferred until EEPROM, registers, analog, 1-Wire, or presence detection is defined on real hardware. |
| Update qualification | Phase 290 is ready, but physical evidence and `Q-*` results are still pending. |
| Root of trust | Development-only device-ID provider; eFuse, Secure Boot, Flash Encryption, and debug policy remain to be designed. |
| Production MQTT | Current transport is insecure; TLS, broker authentication, and the bidirectional protocol are future work. |
| BLE | Two Core V1 images (Wi-Fi default, `make build-ble`); physical radio smoke still OPEN. |
| Dynamic TLS memory | Static arena still present; replacement and stress tests are not yet implemented. |
| Low power | No final statement until consumption and timing are measured on the final PCB. |
| Matter/Zigbee | Outside V1; evaluate ESP32-C6 or a later gateway. |

The detail of the hardware decisions postponed is in
[hardware and firmware finalization reminder](PROMEMORIA_HARDWARE_E_FINALIZZAZIONE.md).

## Template for recording a new incident

When a new problem is solved, add an entry using this template:

```text
### Title recognizable from the symptom

State: Fixed / Expected / Mitigated / Planned / Deferred
Symptom: complete output and the conditions in which it appears
Cause: only what has been demonstrated
Solution: adopted change or procedure
Verification: command, load, and expected result
Result and permanent rule: what must not be forgotten
```

If the cause has not been demonstrated, write **Mitigated** and retain the hypotheses as
such. A time coincidence after a change is not a root cause.
