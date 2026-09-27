# Zephyr on ESP32-C3

A Docker-based development environment for the Zephyr 4.4.0 firmware. The default
target is `spaghettilab_core_v1/esp32c3`. Physical Backbone boards use
`spaghettilab_backbone_v1/esp32s3/procpu`.

Docker provides Zephyr, West, the RISC-V toolchain, modules, and dependencies.
The source code and generated `build/` directory stay on the host computer.

## Requirements

- Docker Desktop with Docker Compose
- An ESP32-C3 board connected over USB
- About 15 GB of free disk space for the first Docker image build
- `make` on Linux, macOS, or Windows for the common shortcuts below
- The host flashing program required by the Zephyr runner selected for the board
- `screen` for the raw console on Linux/macOS
- PySerial and Rich for the styled cross-platform monitor

The current ESP32-C3 build uses `esptool`. Install it on macOS:

```sh
brew install esptool
```

Install it on Windows from PowerShell:

```powershell
py -m pip install esptool
```

On Linux, install it with your package manager or in a Python environment:

```sh
python3 -m pip install esptool
```

The first styled-monitor run creates an ignored `.venv/` and installs its host-only
dependencies there automatically:

```sh
make monitor
```

To prepare the virtual environment without opening the serial port, run
`make host-tools`. Nothing is installed in the global Python environment.

## Quick start

Build the Docker image once:

```sh
make image
```

Create the local development signing key once, then build the firmware:

```sh
make signing-key
make build
```

The ECDSA P-256 private key is created in the ignored `.keys/` directory. Back it
up securely: replacing it also requires provisioning a new MCUboot image over USB.

The default target is the physical Core V1. Build the simulated second topology
without changing common firmware code with:

```sh
BOARD=spaghettilab_core_v2_build_only/esp32c3 make build
```

Flash the same application on a Backbone ESP32-S3-MINI-1 with:

```sh
BOARD=spaghettilab_backbone_v1/esp32s3/procpu make build
BOARD=spaghettilab_backbone_v1/esp32s3/procpu make flash
```

After the first USB flash, type SLUP on the USB master only. The other
Backbones stay on CAN and need no console. `slup list` assigns idx 1=master,
2..N=peers. Then `slup load 2` or `slup load 0xNODE`. Details:
[`subsys/services/ota/SLUP.md`](subsys/services/ota/SLUP.md).

```text
slup list
slup blink 2
slup load 2
```

To push a **file on the Mac** (not the image already running on the master),
close the monitor and run:

```sh
make slup-list
make slup-load TARGET=2 IMAGE=build/app/zephyr/zephyr.signed.bin
```

`slup load` sends EnterUpdate to that node, then the running signed image on
the SN65HVD230 TWAI bus (500 kbit/s). `slup espnow` sends the existing `BNOW`
datagram on Wi-Fi channel 1 / UDP 1339. Peers write the secondary MCUboot slot
and reboot into a trial image. Status LED D5 stays solid red while the firmware
is running; it is a single-color LED, not RGB.

Core V2 is build-only: its pin and connector assignments are intentionally simulated
and it intentionally defines no default flash runner.

Every firmware build runs [`validator`](VALIDATOR.md) before compilation. It
reports objective errors in red and review warnings in orange, including the
file, line, correction, and implementation-guide section. Convention findings
do not stop compilation. Run `make validate` for the same check without building,
or `make build VALIDATOR_QUIET=1` to run it without printing its report.

On Windows, where `make` may not be installed, use these PowerShell commands:

```powershell
docker compose build
docker compose run --rm --entrypoint sh dev -lc \
  'imgtool keygen -k .keys/mcuboot-dev-ecdsa-p256.pem -t ecdsa-p256'
docker compose run --rm dev sh -lc \
  'west build --sysbuild -p auto -b "$BOARD" -d build . -- \
  -DBOARD_ROOT=/opt/zephyrproject/app -DDTS_ROOT=/opt/zephyrproject/app'
```

Sysbuild generates the bootloader and signed application at:

```text
build/mcuboot/zephyr/zephyr.bin
build/app/zephyr/zephyr.signed.bin
```

The default image is Wi-Fi only (`CONFIG_BT` is off). A BLE-only artifact, without
Wi-Fi or IP, is `make build-ble` (`build-ble/`). Core V1 cannot compile both radios
into one binary. Why, and what 97% DRAM means:
[Diary — ESP32-C3 SRAM](DIARIO_PROBLEMI_SOLUZIONI_E_DECISIONI.md).

The first image build can take a while because it downloads Zephyr, the West
modules, the toolchain, and Espressif binary blobs. Docker caches completed
steps, so later builds are much faster.

## Flash and serial console

The same commands work on Linux, macOS, and Windows when `make` is available:

```sh
make flash
make monitor
```

The commands select the port automatically when exactly one supported USB serial
port is connected. List the detected ports with:

```sh
make ports
```

If more than one port is present, or automatic detection cannot identify it,
provide the port explicitly. The same override is accepted by both commands:

```sh
make flash PORT=/dev/cu.usbserial-110
make monitor PORT=/dev/cu.usbserial-110
```

To keep the selection, copy `.env.example` to `.env` and set `PORT` there.
A value passed on the command line takes precedence over `.env`.

Linux example:

```sh
make flash PORT=/dev/ttyACM0
make monitor PORT=/dev/ttyACM0
```

Windows example from a terminal that provides `make`:

```powershell
make flash PORT=COM3
make monitor PORT=COM3
```

Override the console or flashing speed only when necessary:

```sh
make monitor BAUD=9600
make flash FLASH_BAUD=115200
```

`make monitor` shows a calm Rich header, color-coded Zephyr levels and aligned
module names. Structured Shell output such as `wifi scan` is rendered as a responsive
Rich table with signal-strength colors. It preserves interactive input, reconnects
after a USB reset, and exits
with `Ctrl-X` (`Ctrl-]` also works on compatible layouts); `Ctrl-C` is forwarded to
the Zephyr Shell. `make screen` remains the
unformatted fallback: on Linux and macOS, exit it with `Ctrl-A`, then `\`, then `y`;
on Windows, miniterm exits with `Ctrl-]`. Only one program can use the serial port at
a time, so close either console before flashing.

On connection, the styled monitor sends `Ctrl-C` so an already-running Zephyr Shell
immediately redraws `uart:~$` without adding an empty command to its history. The
same byte also leaves USB Protocol V1 framed mode, so `make monitor` works after
React Flow or `spaghetti --transport serial` without a reboot. Close the protocol
client before opening the monitor: only one program can own `/dev/cu.usbmodem*`.

Protocol V1 on the same cable, with the monitor closed:

```sh
make ARGS='--transport serial status' spaghetti
```

Safari cannot open USB (no Web Serial). From `software/micro-flow-editor`,
`make up-d` starts the localhost USB bridge on this machine and then Docker.
Keep the monitor closed. Chrome and Edge can keep using Web Serial directly.
The bridge, the monitor, and React Flow still cannot share the same cable at
once.

Low-level (without React Flow):

```sh
make usb-bridge
```

`tools/device.py` reads `build/domains.yaml` and each domain's generated
`runners.yaml`; the image order, microcontroller, addresses and flash parameters
therefore come from sysbuild rather than from hard-coded Makefile values. For Core
V1, one `make flash` writes MCUboot and the signed primary application. It directly
supports the generated Espressif runner. Other
Zephyr runners are delegated to a compatible host `west` installation and may
require their own host utility or debug-probe driver. A board without a serial
console can still be flashed by its runner, but `make screen` naturally requires
a serial port.

### Remote console credentials during development

The final board provisions over the GPIO-based Maintenance Link. While the USB
connector is available, the development Shell can enter the same Maintenance mode
and install the remote-console credential without exposing its PSK in command-line
arguments or Shell history:

```sh
make remote-console-credential \
  CREDENTIALS=.keys/core-v1-console.json IDENTITY=core-v1
make remote-console-provision PORT=/dev/cu.usbmodem1101 \
  CREDENTIALS=.keys/core-v1-console.json
```

For first-time onboarding, prefer the single command:

```sh
make remote-console-enable
```

It creates the protected host credential when absent, provisions it through local
Maintenance, preserves an existing valid Config or installs a safe empty Config,
reboots into Normal mode, verifies the TLS listener, and requests connection when a
saved Wi-Fi profile exists. It never invents Modules or overwrites a valid Config.

Provisioning automatically requests a one-shot Maintenance reboot when necessary.
Reboot the device afterwards to return to Normal mode. Then locate authenticated
devices on an explicitly routed LAN or VPN subnet and connect:

```sh
make remote-console-list SUBNET=192.168.1.0/24 \
  CREDENTIALS=.keys/core-v1-console.json
make monitor TRANSPORT=network HOST=192.168.1.42 \
  CREDENTIALS=.keys/core-v1-console.json
```

Revoke the device credential locally with `make remote-console-clear
PORT=/dev/cu.usbmodem1101`. The generated JSON is mode `0600`, is never overwritten,
and must be kept private. Do not expose TCP port 1338 directly to the Internet; use
an authenticated VPN with a route to the device subnet.

On Linux, your user may need serial-port access. On many distributions, add the
user to the `dialout` group and then sign out and back in:

```sh
sudo usermod -aG dialout "$USER"
```

## Common commands

| Command | Description |
|---|---|
| `make image` | Build the Docker development image |
| `make signing-key` | Create and preserve the ignored development ECDSA signing key |
| `make validate` | Check firmware writing conventions without compiling |
| `make build` | Run an incremental firmware build |
| `make pristine` | Reconfigure and rebuild from scratch |
| `make shell` | Open a shell in the Zephyr environment |
| `make ports` | List host USB serial ports detected automatically |
| `make flash [PORT=...]` | Flash using the runner selected by the build |
| `make screen [PORT=...]` | Open the raw serial console at 115200 baud |
| `make monitor [PORT=...]` | Open the styled, reconnecting Rich monitor |
| `make host-tools` | Create `.venv/` and install monitor dependencies |
| `make spaghetti ARGS='…'` | Run the Spaghetti CLI V1 (catalog / config / update). Close `make monitor` first for `--transport serial` |
| `make usb-bridge` | USB Protocol V1 → `ws://127.0.0.1:8766` (low-level). React Flow: `make up-d` in `software/micro-flow-editor` |
| `make config-validate CONFIG=path.json` | Validate a local Config JSON against the Core catalog |
| `make config-apply CONFIG=path.json` | Validate then apply Config (generation/hash CAS) |
| `make remote-console-credential CREDENTIALS=...` | Create a protected TLS-PSK file |
| `make remote-console-provision CREDENTIALS=...` | Install it through local USB Maintenance |
| `make remote-console-enable` | Complete safe onboarding and enter Normal mode |
| `make remote-console-list SUBNET=... CREDENTIALS=...` | Find authenticated consoles |
| `make remote-console-clear [PORT=...]` | Revoke the device console credential |
| `make update-qualification-manifest ...` | Print hashes and candidate metadata without secrets |
| `make update-qualification-check` | Reject an incomplete or failed hardware report |
| `make clean` | Remove the CMake build artifacts |

Useful Windows equivalents:

```powershell
# Flash and open the console without make
py -3 tools/device.py flash
py -3 tools/device.py screen
py -3 tools/device.py monitor

# Open the Zephyr shell
docker compose run --rm dev

# Rebuild from scratch
docker compose run --rm dev sh -lc \
  'west build --sysbuild -p always -b "$BOARD" -d build . -- \
  -DBOARD_ROOT=/opt/zephyrproject/app -DDTS_ROOT=/opt/zephyrproject/app'

# Remove build artifacts
docker compose run --rm dev west build -d build -t pristine
```

## Project layout

```text
.
├── src/                                    application entry point
├── include/spaghetti/                      public firmware contracts
├── subsys/                                 common subsystem implementations
├── spaghetti_modules/                      removable-module drivers
├── boards/                                 board definitions and overlays
├── dts/bindings/spaghetti/                 project Devicetree schemas
├── templates/firmware/                     copyable implementation skeletons
├── validator                               pre-build firmware convention checker
├── tools/device.py                         host port detection, flash, and console helper
├── tools/spaghetti.py                      Spaghetti CLI V1 (JSON Config / Protocol)
├── FILE_MAP.md                             what to read before each kind of change
├── prj.conf                                Zephyr/Kconfig settings
├── CMakeLists.txt                          build configuration
├── Dockerfile                              Zephyr development image
├── compose.yaml                            common container configuration
├── compose.linux.yaml                      optional manual Linux USB passthrough
└── Makefile                                command shortcuts
```

The `build/` directory is generated locally and can be safely recreated.

## Documentation

Start from the [documentation index](DOCUMENTATION_INDEX.md) when you want the complete
reading order for architecture, implementation tasks, Module/Core extensions,
Node-RED, troubleshooting, and release material.

For the planned USB-free provisioning, A/B update and remote-console work, start from
[the Maintenance Link hardware contract](UPDATE_HARDWARE_CONTRACT.md) and the
[OTA roadmap](roadmap/OTA-REMOTE-MAINTENANCE.md). GPIO and controller selection belong
to each board/overlay; the common update architecture does not contain pin numbers.

Start with the architecture overview, then open a component document only when
you need its detailed contract.

| Guide | Use it for |
|---|---|
| [Documentation index](DOCUMENTATION_INDEX.md) | Single ordered entry point for every documentation path |
| [Extension guide](EXTENDING_SPAGHETTI_LAB.md) | Module, Core, and Config how-to, Zephyr templates, and firmware-specific caveats |
| [V1 platform closure](roadmap/V1-PLATFORM-CLOSURE.md) | Planned generic contracts and tasks required before the main Node-RED work |
| [Firmware architecture](ARCHITECTURE.md) | Generic model, ownership, data flow, and practical examples |
| [Connectivity and resource contract](CONNECTIVITY_AND_RESOURCE_CONTRACT.md) | Frozen BLE-first, on-demand Wi-Fi, resource-profile, update, and TLS-memory decisions |
| [Implementation guide](FIRMWARE_IMPLEMENTATION_GUIDE.md) | Mandatory coding rules, decisions, workflow, and copyable templates |
| [Problem and decision journal](DIARIO_PROBLEMI_SOLUZIONI_E_DECISIONI.md) | Symptoms encountered, verified causes, fixes, checks, and lasting lessons |
| [Hardware and finalization reminder](PROMEMORIA_HARDWARE_E_FINALIZZAZIONE.md) | Deferred hardware decisions, production gaps, and the prompt for completing them |
| [File map](FILE_MAP.md) | What each file contains and what to read before each kind of task |
| [Firmware validator](VALIDATOR.md) | Pre-build checks, commands, severities, scope, and corrections |
| [Public interfaces](include/spaghetti/README.md) | Shared types and public API boundaries |
| [Board support](boards/spaghettilab/README.md) | Core variants and static hardware descriptions |
| [Devicetree bindings](dts/bindings/spaghetti/README.md) | Spaghetti-specific hardware schemas |
| [Module implementations](spaghetti_modules/README.md) | External sensor and actuator drivers |
| [Optional services](subsys/services/README.md) | Replaceable timing, persistence, or transport capabilities |

### Subsystem reference

| Foundation | Runtime model | Boundaries |
|---|---|---|
| [Core](subsys/core/README.md) | [Module Manager](subsys/module_manager/README.md) | [Config](subsys/config/README.md) |
| [Port](subsys/port/README.md) | [Data](subsys/data/README.md) | [Communication adapters](subsys/communication/README.md) |
| [Driver Registry](subsys/driver_registry/README.md) | [Runtime](subsys/runtime/README.md) | [Optional Discovery](subsys/discovery/README.md) |

## Licensing and third-party software

This firmware uses the Zephyr Project RTOS, which is primarily licensed under
the Apache License 2.0. Zephyr also includes modules and optional binary blobs
that may use other licenses.

Before redistributing a firmware binary, Docker image, or product containing the
firmware, read [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) and include the
applicable license and attribution material with the distribution. A local copy
of Zephyr's primary license is provided in
[`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt).

The license for original SpaghettiLAB source code is separate from the licenses
of Zephyr and its dependencies; the third-party notices do not relicense that
code.

## Troubleshooting

### The serial port is busy

Close `screen`, miniterm, IDE serial monitors, and any other program using the
same port.

### No serial port is detected

Run `make ports`, reconnect the board with a data-capable USB cable, and try a
different direct USB port. If several devices are listed, select one with
`PORT=...`. Automatic detection deliberately refuses to guess between multiple
devices.

### `esptool` cannot connect

- Check that the selected serial port is still correct.
- Close any open serial monitor.
- Hold **BOOT**, press and release **RESET**, release **BOOT**, and retry.
- If necessary, change the flash baud rate from `460800` to `115200`.

### The serial console is empty

- Use `115200` baud.
- Press **RESET** after opening the monitor.
- Check the console and serial settings in the board overlay and `prj.conf`.

### A configuration change is ignored

Run a pristine build:

```sh
make pristine
```

On Windows, use the equivalent command shown above.

`make build` also detects an incomplete `build/` directory. If the directory
exists but `build/build.ninja` is missing, it removes only those generated build
artifacts and regenerates the build system. `make pristine` always performs the
same clean regeneration explicitly.

### The validator reports convention findings

Review each `ERROR` and `WARNING` using the reported guide section, then run:

```sh
make validate
```

Neither severity blocks a normal build. To scan without displaying the
convention report, use `make build VALIDATOR_QUIET=1`. See
[`VALIDATOR.md`](VALIDATOR.md) for colors, strict mode, scope, and selected-file
commands.
