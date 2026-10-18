# Dedicated NFC module firmware

Build this product from the Backbone code without copying the application:

```
make build-nfc
```

Output: `build-nfc/app/zephyr/zephyr.signed.bin`. The normal Backbone build stays
in `build/`. Both use the existing development signing key and MCUboot layout.
Do not use plain `make flash` for this product: that selects the normal build.
For an already-provisioned Backbone ESP32-S3, after releasing the serial port:

```
esptool --chip esp32s3 --port /dev/cu.usbmodem1101 write-flash \
  0x20000 build-nfc/app/zephyr/zephyr.signed.bin
```

This writes the application only and preserves the bootloader and NVS. The
bootloader must trust the signing key used by the build. Keep a backup of the
previous application before converting a board.

## Product policy

`CONFIG_SPAGHETTI_NFC_MODULE=y` selects a CAN peripheral, never a host/master:

- USB remains a power, flashing and local-diagnostics connection. It never grants
  the USB-master flag, even with DTR asserted. Chain slot 1 is rejected.
- No hardware Port initialization, physical mapping restoration, Module Manager,
  Flow runtime or saved Config is started. Physical and Config application APIs
  reject requests. Previous Backbone settings remain stored but inactive.
- Wi-Fi and ESP-NOW are disabled in the product overlay.
- SLUP discovery STATUS reports flag `0x02` = dedicated NFC module and no physical
  port descriptor. A Backbone master discovers it through the existing CAN path.
  The app uses that flag to label it **Modulo NFC**, display the reader icon and
  avoid exposing its hardware configuration or offering it as an installation
  destination. No product identity is inferred from its MAC or name.
- Type-A scans retain blank and third-party tags as well as legacy SLM1 tags.
  Existing ordinary Backbone images retain their SLM1-only auto-configuration
  policy. Insertions/removals are forwarded via `RSP_NFC_CHANGED`; cached UID and
  legacy metadata use the existing NFC response frames.
- Ordinary `slup load` clones a master Backbone image, which would change the
  product. This product refuses that update path until target-aware OTA exists.
  Use the dedicated signed image over USB for maintenance.

`nfcmodule` on the local serial shell prints identity, CAN role, policy self-test
and currently detected tags. The policy self-test does not write tag memory.

## NFC memory CAN contract v1

Only addressed extended frames (`0x12000000 | node_id`) are accepted. Broadcast
memory commands are ignored. Replies use `0x13000000 | node_id`.

| Command | Frame bytes after command |
|---|---|
| `0x0E` NFC_TARGET | token, part (0 or 1), five target bytes |
| `0x0F` NFC_READ_PAGE | token, page |
| `0x10` NFC_WRITE_PAGE | token, page, four data bytes |

Target is ten bytes: antenna (1/2), UID length (must be 7), UID[7], padding[1].
Parts must arrive in order; a new part 0 replaces the previous target. The target
expires 10 seconds after part 0. Each page operation reselects the tag and checks
its complete expected UID. UID mismatch/removal invalidates staging.

Read/write responses `0x8F` / `0x90` carry token, positive errno (0 = success),
page, four data bytes. Failed operations return zero data. RF access is serialized
with periodic scanning; lock and RF waits are bounded.

User pages 4–43 are writable. Pages 3 (CC) and 45 (product code) are readable only.
Writing requires ST25TN01K product code `0x9090`, CC user capacity 160 bytes and
write permission. Unknown/SLM1 contents are not automatically overwritten: the
first user page must be blank or begin with SLF1. System, UID and lock pages are
never writable. A successful write checks the Type2 ACK and exact page readback;
the coordinator must also verify the entire final SLF1 image and CRC.

## Integration boundary

Master firmware 0.5.0 forwards all detected UIDs, including blank and SLF1 tags
with module_type_id zero. Earlier GET_STATUS implementations filtered those tags
out. NFC_CHANGED now requests a fresh CAN NFC snapshot before emitting the host
discovery event; periodic discovery remains a fallback. Full tag memory read/write in the app additionally
needs the master host operation and the app's `NfcMemoryBridge` adapter for this
CAN contract. Neither an old master nor the software simulator is presented as
having completed a real tag-memory write. End-to-end CAN tests require another
Backbone acting as master and a physical writable tag.

## Device verified on 2026-10-17

- ESP32-S3, MAC `90:70:69:E1:80:30`, node `0xe18030`.
- Prior running firmware: `0.3.2+0`; prior application slot backed up externally.
- Installed and flash-hash verified: `0.4.0+0` dedicated NFC image.
- ST25R100 probe: ID `0xa9`, hardware SPI, IRQ GPIO5.
- CAN driver started at 500000 bit/s.
- Runtime policy: NFC flag `0x02`, chain slot 0, master slot denied, physical
  configuration denied, network-master discovery denied; self-test PASS.
- No tag was present during the initial device check; real tag-memory writing
  and end-to-end master forwarding are not yet hardware-qualified.

## Master notification fix verified on 2026-10-17

- Master MAC `90:70:69:E1:C5:2C` updated from 0.3.7 to 0.5.0, application
  only, with flash hash verification and a backup of the previous slot.
- Live host status and Discover confirm master 0.5.0 and NFC peer
  `90:70:69:E1:80:30` running 0.4.0. Reader displayed as connected, zero tags.
- Native communication regression test verifies GET_STATUS retains a remote
  Type2 UID with module_type_id zero. Communication suite passes.
- App typecheck, 357 tests and production build pass. Physical scan notification
  still needs a tag presentation; no tag was present during this verification.

## Master event stack fix (0.5.1)

Discovery events can originate on the 2048-byte CAN worker or the 1024-byte
system workqueue. The previous implementation nested a payload, envelope and
USB frame on the caller stack (plus CBOR state). Version 0.5.1 serializes
discovery scratch storage with its own mutex and protects the USB event frame
with the existing TX mutex through encoding and transmission. The empty event
payload is immutable storage. This avoids protocol-sized automatic buffers on
those worker stacks without changing the event wire format.

Master 90:70:69:E1:C5:2C was flashed application-only and verified running
0.5.1 with NFC peer 0.4.0. Communication native tests pass. Physical scan
notification and LED behavior are pending the next tag presentation.

## Reader CAN forwarding fix (0.5.1)

The reader-side NFC snapshot handler also filtered module_type_id zero. That
filter is removed, so all selected tags produce the four existing response
parts, including blank/SLF1 tags. A native regression test now exercises the
actual receive worker, feeds an addressed NFC request and checks all four
response frames for a blank Type2 tag. Field-update suite: six tests pass.

Reader 90:70:69:E1:80:30 was updated application-only to 0.5.1; flash hash and
local shell identity were verified. Policy self-test passes with USB DTR high:
CAN peripheral, never master, hardware configuration disabled. User confirmed
that master 0.5.1 remains lit on tag presentation. End-to-end notification
verification follows reconnection of USB to the master.
