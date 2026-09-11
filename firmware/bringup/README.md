# CORE + BACKBONE — USB console on S3, CAN link to C3

The system has two chips and three transport paths with fixed roles:

1. **USB protobuf+COBS: PC ↔ ESP32-S3 CORE only.** `core_util.py` is the
   console for the S3. `/dev/cu.usbmodem*` always identifies the CORE; the PC
   never talks directly to the C3 through that port.
2. **C3 flash/update: UART over the CAN PHY, not TWAI frames.** The S3 removes
   the TWAI driver for the entire transfer. The transceivers provide the
   electrical crossover; software keeps S3 TX on GPIO5 and RX on GPIO4.
3. **Runtime traffic:** once the C3 application is running, ping, status,
   reboot, discovery, and NFC commands use TWAI on the same pins.
4. **Wireless update:** CORE forwards application images to a selected C3
   through ESP-NOW while the normal TWAI interface remains initialized.

## Architecture

```text
PC  --USB CDC protobuf+COBS-->  CORE S3
     flash: UART 115200 GPIO5 TX / GPIO4 RX  --CAN PHY-->  C3 UART0 GPIO21 TX / GPIO20 RX
     runtime: TWAI 500 kbit/s on the same pins (disabled during flashing)
```

| Phase | Encoding | S3 pins | C3 pins |
|---|---|---|---|
| `--rom` / `--slup` | UART 115200, no TWAI | TX GPIO5→D, RX GPIO4←R | TX GPIO21→D, RX GPIO20←R |
| ping / reboot / NFC | TWAI 500 kbit/s | same pins | same pins |

## Multiple BACKBONE nodes on one CAN bus

Starting with `bringup-0.15`, every C3 has a stable 24-bit Node ID derived
from the last three bytes of its factory Wi-Fi MAC. Firmware updates do not
change this identifier.

Discover all addressable nodes:

```sh
python3 scripts/core_util.py --port /dev/cu.usbmodem1101 nodes
```

Select one C3 with the global `--node` option. Global options must appear
before the subcommand:

```sh
python3 scripts/core_util.py --port /dev/cu.usbmodem1101 --node 0x0D6730 status
python3 scripts/core_util.py --port /dev/cu.usbmodem1101 --node 0x0D6730 nfc-scan
python3 scripts/core_util.py --port /dev/cu.usbmodem1101 --node 0x0D6730 \
  flash-c3 --slup --bin .pio/build/backbone/firmware.bin
```

Addressed commands use extended CAN identifiers:

- S3 → C3: `0x12000000 | node_id`
- C3 → S3: `0x13000000 | node_id`
- Legacy single-node mode: standard IDs `0x10` and `0x11`

Before switching from TWAI to UART-over-CAN, CORE broadcasts the selected
Node ID. The target acknowledges and opens SLUP; all other C3 nodes remove
their TWAI driver, hold TX recessive, and remain quiet for the maximum update
window. This is required because CAN error frames from other controllers would
corrupt the raw UART stream.

Firmware older than `bringup-0.15` does not support discovery, addressing, or
quiet mode. Upgrade every existing C3 once while connecting one at a time.
After this baseline migration, an older application release can be discovered
and updated independently without disconnecting the other nodes.

## SLUP application update sequence

The C3 does not reboot before transfer. It stops TWAI and opens UART from the
running application. The only reboot happens after the complete image and its
CRC have been verified.

```mermaid
sequenceDiagram
    participant PC
    participant S3
    participant CAN as CAN pair
    participant C3

    PC->>S3: flash-c3 --slup --node ID
    S3->>CAN: PREPARE_UPDATE broadcast + Node ID
    CAN->>C3: Target enters update; other nodes become quiet
    C3->>CAN: Extended response ID + ACK 0x82
    S3->>S3: Remove TWAI and open UART 115200
    C3->>C3: Stop TWAI and open UART without rebooting
    S3->>C3: SLUP 01 over UART-over-CAN
    C3->>S3: SLOK 01
    S3->>C3: BEGIN with image size and CRC
    C3->>S3: ACK
    loop Every block
        S3->>C3: DATA with offset and up to 256 bytes
        C3->>S3: ACK
    end
    S3->>C3: END
    C3->>C3: Verify CRC and activate the new partition
    C3->>S3: ACK
    C3->>C3: Reboot once into the new firmware
```

If the handshake, transfer, or flash write fails, the C3 closes UART and
returns to TWAI while retaining the previous firmware.

## ESP-NOW application updates

Starting with `bringup-0.19`, BACKBONE keeps TWAI and ESP-NOW initialized at
the same time. ESP-NOW uses Wi-Fi channel 1 and targets the same 24-bit Node ID
used by CAN. The image is written to the inactive OTA partition and checked
with CRC32 before activation.

```sh
python3 scripts/core_util.py \
  --port /dev/cu.usbmodem1101 \
  --node 0x0D6730 \
  flash-c3 --espnow --bin .pio/build/backbone/firmware.bin
```

ESP-NOW update packets currently provide transport retries and CRC integrity,
but are not encrypted or cryptographically signed. Add signed-image
verification and ESP-NOW PMK/LMK provisioning before production deployment.

## C3 boot and UART pins

At application startup the C3 listens for SLUP over UART for about 1.2 s,
then closes UART, starts TWAI, initializes the ST25R100, and starts the RGB
LED behavior.

A blank C3 has no application. Its ROM listens on UART0 at 115200 baud:

- C3 GPIO20 / RXD0 = CAN_RX ← transceiver R
- C3 GPIO21 / TXD0 = CAN_TX → transceiver D

The ROM UART pins cannot be remapped. GPIO8 is a boot strap and must be high;
GPIO9 must be low when reset is released to enter download mode.

**RESET is a pulse, not a held state.** Hold IO9 low, press and release RESET
so EN returns to 3.3 V, keep IO9 low, then run `flash-c3 --rom`. Holding RESET
low leaves the C3 disabled and produces only the S3 transceiver echo.

### CAN connector

| Pin | CORE `J5` TO_NEXT | BACKBONE `J2` FROM_PREVIOUS |
|---|---|---|
| 1 | 5V | 5V |
| 2 | CANH | CAN_H |
| 3 | CANL | CAN_L |
| 4 | TERM_CTRL_OUT | **5V**, not TERM |
| 5 | GND | GND |

CANH and CANL match on pins 2 and 3. If the cable swaps CANH and CANL, the
raw UART polarity is inverted. `--rom` automatically retries with inverted
UART, or inversion can be explicitly requested with `--invert`.

The CORE/BACKBONE connector has no EN or BOOT signal. Once application
firmware exists, `reboot-c3`, `reboot-c3 --rom`, and `reboot-c3 --update`
operate through TWAI. Despite its historical CLI name, `--update` enters SLUP
without a preliminary reboot.

## RGB LEDs

The SN74AHCT1G14 inverts the LED data signal, so RMT uses `invert_out`.
RGB color values themselves must not be inverted.

- CORE: one SK6812 on GPIO34
- BACKBONE: four daisy-chained SK6812MINI-E LEDs on GPIO8
- No tag: smooth continuous RGB fade
- Tag on ANT1: first LED pair green/cyan
- Tag on ANT2: second LED pair purple

The logical antenna-to-LED order is defined in `src/backbone/main.cpp` and can
be reversed if the physical LED chain is wired in the opposite direction.

## NFC: ST25R100 and ST25TN01K

BACKBONE wiring:

| Signal | ESP32-C3 pin |
|---|---|
| SCK | GPIO10 |
| MOSI | GPIO18 |
| MISO | GPIO19 |
| CS | GPIO6 |
| IRQ | GPIO5 |
| RESET | GPIO7 |

SPI runs in mode 1 at 5 MHz. The ST25R100 controls two independent
single-ended antennas: physical ANT1 uses RFO2/RFI2 and physical ANT2 uses
RFO1/RFI1, matching the crossed net routing in the BACKBONE schematic.

Starting with `bringup-0.16`, automatic detection uses GPIO5 IRQ and the
ST25R100 low-power card detection mode. A full NFC-A scan is no longer run
every 250 ms. The internal timer generates an IRQ about every 215 ms only to
move the detector between ANT1 and ANT2. An inductive I/Q load change raises
the IRQ that starts anticollision and UID reading. While a tag is present,
the detector remains on that antenna so a subsequent load-change IRQ can
detect removal.

The ST25R100 can monitor only one antenna at a time, so a periodic antenna
switching IRQ is still required with this dual-antenna design. The C3 no
longer performs continuous SPI polling or continuous anticollision.

`nfc-info` reports `detection_mode`, `wakeup_antenna`, `irq_seen`, and
`wakeup_irq_count`. The count should increase between successive calls. A
count that remains zero indicates that the physical IRQ connection or reader
initialization must be checked.

### Reader diagnostics

```sh
python3 scripts/core_util.py --port /dev/cu.usbmodem1101 nfc-info
python3 scripts/core_util.py --port /dev/cu.usbmodem1101 nfc-reg-read 0x3f
python3 scripts/core_util.py --port /dev/cu.usbmodem1101 nfc-reg-read all
python3 scripts/core_util.py --port /dev/cu.usbmodem1101 nfc-scan
python3 scripts/core_util.py --port /dev/cu.usbmodem1101 nfc-scan --antenna 2
```

Register dumps show the datasheet name, access type, hexadecimal value,
binary value, and interpretation. Reading IRQ registers `0x3C..0x3E` may
consume or clear latched events.

Write and verify an RW register:

```sh
python3 scripts/core_util.py --port /dev/cu.usbmodem1101 nfc-reg-write 0x03 0x28
```

Manual `nfc-scan`, `tag-read`, and `tag-write` commands temporarily suspend
low-power wake-up mode and restore it when the operation finishes.

### ST25TN01K tags

The ST25TN01K is an NFC-A Type 2 tag with 64 pages of 4 bytes. The CLI checks
Product Code `0x9090` on page `0x2D` and interprets UID, SYSBLOCK, Capability
Container, the 160-byte user area, static and dynamic locks, ANDEF, Product
ID, and the KILL area.

```sh
python3 scripts/core_util.py --port /dev/cu.usbmodem1101 tag-read --antenna 1 --page 0 --count 8
python3 scripts/core_util.py --port /dev/cu.usbmodem1101 tag-read --antenna 1 --page 0 --count 64
python3 scripts/core_util.py --port /dev/cu.usbmodem1101 tag-write --antenna 1 --page 4 --data "DE AD BE EF"
```

`tag-write` verifies the Product Code, writes the page, reads it back, and
compares all four bytes. By default it writes only user memory `0x04..0x2B`.
System and OTP areas require `--force`. UID, Product ID, and internal pages
remain blocked. Page `0x30` can permanently kill the tag and requires both
`--force` and `--allow-kill`.

All NFC commands accept global `--json` before the subcommand and emit NDJSON
suitable for an API or graphical application.

## USB protocol: PC ↔ S3

Frame format: `COBS(protobuf) || 0x00`. The schema is
`proto/core_service.proto`.

| Operation | Field | CORE behavior |
|---|---:|---|
| ping | 10 | return CORE firmware version |
| status | 11 | ping the selected C3 over TWAI |
| reboot_c3 | 12 | send reboot/update/ROM command over TWAI |
| flash_begin | 13 | switch the bus to UART and start SLIP or SLUP |
| flash_chunk | 14 | forward one image block over UART |
| flash_finish | 15 | verify, finish, and restore the normal bus |
| nfc | 16 | forward one NFC command to the selected C3 |
| discover_nodes | 17 | discover Node IDs and factory MAC addresses |

`flash_begin.mode`: `0` auto, `1` forced ROM UART using `merged.bin`, and `2`
forced application SLUP using `firmware.bin`.

## TWAI protocol: S3 ↔ C3

Classic CAN frames use 8 data bytes at 500 kbit/s.

- Byte 0 commands: `0x01` ping, `0x02` reboot, `0x03` enter update, `0x04`
  reboot to ROM, `0x05` status, `0x06` discovery, `0x07` prepare update, and
  `0x08` prepare ROM.
- NFC commands: `0x20` info, `0x21/0x22` register read/write, `0x23` scan,
  `0x24/0x25` Type 2 page read/write, and `0x26` UID continuation.
- Firmware image data is never transferred as TWAI frames.

Before entering ROM, the C3 waits for ACK transmission to complete, removes
TWAI and GPIO matrix routes, sets `FORCE_DOWNLOAD_BOOT`, and resets into the
first-stage ROM.

## Build and flash CORE

```sh
cd /Users/andreapiccini/dev/spaghettilab-community/firmware/bringup
python3 scripts/flash_core.py
```

The CORE RGB LED should then cycle at approximately 1 Hz.

## Conservative BACKBONE recovery image

`backbone-recovery` is a separate safety build. It starts UART SLUP and TWAI
before any optional peripheral, starts ESP-NOW, and never starts the automatic
ST25R100 IRQ/LPCD state machine. The LEDs continue their normal fade and
explicit NFC diagnostic commands remain available, but an NFC hardware or
driver fault cannot block the normal main-loop startup path.

Build it with:

```sh
/Users/andreapiccini/.platformio/penv/bin/pio run -e backbone-recovery
```

For FTDI recovery, flash `firmware.factory.bin` at address `0x0`. Keep this
image as the known recovery baseline; do not replace it with the normal
`backbone` artifact.

This recovery image is currently an application-level recovery environment,
not code executing inside the ESP-IDF second-stage bootloader. ESP-NOW needs
the Wi-Fi stack, which is not available to an ordinary bootloader hook. A
future immutable factory-recovery layout should combine this image with OTA
rollback/custom boot selection; until that migration is complete, keep the
FTDI header accessible.

## Python utility

```sh
python3 scripts/core_util.py --port /dev/cu.usbmodem1101 ping
python3 scripts/core_util.py --port /dev/cu.usbmodem1101 status
python3 scripts/core_util.py --port /dev/cu.usbmodem1101 reboot-c3
python3 scripts/core_util.py --port /dev/cu.usbmodem1101 reboot-c3 --update
```

The utility creates `firmware/bringup/.venv` and installs `pyserial` and
`rich` when required.

### First C3 flash: blank chip

1. Power CORE and connect 5V, GND, CANH, and CANL.
2. Hold BACKBONE IO9 low.
3. Press and release RESET; EN must return to 3.3 V.
4. Keep IO9 low and run:

```sh
python3 scripts/core_util.py \
  --port /dev/cu.usbmodem1101 \
  flash-c3 --rom --bin .pio/build/backbone/merged.bin
```

If diagnostics report TX echo only, the C3 did not transmit. Check EN, GPIO21
TX, GPIO20 RX, and GPIO8 high. To explicitly invert UART polarity:

```sh
python3 scripts/core_util.py \
  --port /dev/cu.usbmodem1101 \
  flash-c3 --rom --invert --bin .pio/build/backbone/merged.bin
```

### Raw ROM bridge recovery

If the application still responds over TWAI, CORE can request ROM mode and
become a transparent USB CDC ↔ UART-over-CAN bridge:

```sh
python3 scripts/core_util.py --port /dev/cu.usbmodem1101 reboot-c3 --rom
python3 scripts/core_util.py --port /dev/cu.usbmodem1101 rom-bridge
/Users/andreapiccini/.platformio/penv/bin/python \
  /Users/andreapiccini/.platformio/packages/tool-esptoolpy/esptool.py \
  --chip esp32c3 --port /dev/cu.usbmodem1101 --baud 115200 \
  --before no-reset --after no-reset --no-stub \
  write-flash 0x0 .pio/build/backbone/merged.bin
```

`rom-bridge` only activates the local bridge and therefore works when the C3
is already in ROM mode. Reboot CORE to exit raw bridge mode. Do not run
`flash-c3` while the bridge is active because USB protobuf framing is disabled.

### Subsequent C3 updates

Single-node legacy mode:

```sh
python3 scripts/core_util.py \
  --port /dev/cu.usbmodem1101 \
  flash-c3 --slup --bin .pio/build/backbone/firmware.bin
```

Addressed multi-node mode:

```sh
python3 scripts/core_util.py \
  --port /dev/cu.usbmodem1101 \
  --node 0x0D6730 \
  flash-c3 --slup --bin .pio/build/backbone/firmware.bin
```

The Rich interface reports percentage, bytes, rate, elapsed time, ETA, block
count, USB retries, and CRC32. For graphical tools, use NDJSON:

```sh
python3 scripts/core_util.py \
  --port /dev/cu.usbmodem1101 \
  --json \
  flash-c3 --slup --bin .pio/build/backbone/firmware.bin
```

Events include `flash_start`, `flash_phase`, `flash_begin`, `flash_progress`,
`transport_retry`, `flash_complete`, and `flash_error`.

## Files

| Path | Purpose |
|---|---|
| `proto/core_service.proto` | PC ↔ S3 USB schema |
| `src/common/cobs.*`, `pb_lite.*` | USB framing and compact protobuf codec |
| `src/core/main.cpp`, `bus_mux.cpp`, `c3_update.cpp` | S3 console, bus mux, and C3 updater |
| `src/core/esp_uart_flasher.*` | first-stage ROM SLIP client |
| `src/backbone/main.cpp`, `backbone_svc.cpp`, `nfc_svc.cpp` | C3 runtime, OTA, NFC, and LEDs |
| `scripts/core_util.py` | English CLI from Mac to CORE |
| `partitions/backbone_4mb_ota.csv` | dual-slot C3 OTA layout |
