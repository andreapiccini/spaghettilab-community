# Local Maintenance Link

[← Services](../README.md) · [Public API](../../../include/spaghetti/maintenance_link.h) ·
[Hardware contract](../../../UPDATE_HARDWARE_CONTRACT.md)

The Maintenance Link gives Core one board-independent way to borrow the normal Port
pins for a local UART session. Pin numbers and controllers live only in board
Devicetree. Core V1 maps Port 0 I2C SDA/SCL on GPIO3/GPIO4 to UART1 RX/TX; the V2
build-only board proves that common code also builds with a different mapping.

## Boot and pin ownership

The UART's boot-time `default` pinctrl state is deliberately receive-only, so Zephyr
device initialization never drives TX on a connected sensor. The link then starts in
`NORMAL`. With a valid Config it temporarily reapplies that receive-only state and
listens for at most the board's
`bootstrap-window-ms`; TX remains disabled. Without Config, or after an accepted
one-shot request, Core does not start Runtime, Module, Discovery, MQTT, or Wi-Fi and
switches directly to `ACTIVE` UART maintenance.

The authenticated bootstrap frame is exactly 40 bytes:

| Bytes | Value |
|---|---|
| 0..3 | ASCII `SPLM` |
| 4 | protocol version `1` |
| 5 | enter command `1` |
| 6..7 | zero, reserved |
| 8..39 | HMAC-SHA256 of bytes 0..7 followed by the Zephyr hardware device ID |

The per-device 32-byte HMAC key is stored through encrypted/authenticated PSA ITS and
can be installed only while local maintenance is already active. The frame is bound
to one device, but version 1 has no nonce and is replayable. It is therefore a local
bootstrap guard, not remote peer authentication; phase 270 adds the network security
boundary.

## SMP protocol

Zephyr's SMP UART transport supplies bounded Base64 serial framing and CRC. Only the
custom Spaghetti group (`MGMT_GROUP_ID_PERUSER`, numeric ID 64) is registered:

| Command | ID | Direction | CBOR request |
|---|---:|---|---|
| status | 0 | read | empty map |
| install Config | 1 | write | `{"data": bstr}` |
| add/update Wi-Fi | 2 | write | `{"ssid": tstr, "security": uint, "passphrase": bstr}` |
| remove Wi-Fi | 3 | write | `{"ssid": tstr}` |
| set bootstrap key | 4 | write | `{"key": bstr(32)}` |
| firmware chunk | 5 | write | `{"offset": uint, "total": uint, "data": bstr}` |
| cancel firmware | 6 | write | empty map |
| set OTA credentials | 7 | write | bounded manifest URL, SHA-256 and TLS trust data |
| arm OTA | 8 | write | empty map |
| clear OTA credentials | 9 | write | empty map |
| set remote-console credential | 10 | write | `{"psk": bstr(32), "identity": tstr}` |
| clear remote-console credential | 11 | write | empty map |

Every application response contains integer `rc`; image responses also contain the
next expected `offset`. Chunks are contiguous and at most 192 bytes. The first chunk
arms and assigns the Update coordinator to UART. The last chunk flushes flash,
requests `BOOT_UPGRADE_TEST`, returns its response, and only then schedules a warm
reboot. Shell, filesystem, OS and generic Image Management groups remain disabled so
no transport can bypass the coordinator or confirm a trial image.

UART has no portable cable-presence signal. A broken firmware transfer is therefore
detected by the Update absolute deadline, which erases the incomplete secondary slot;
the maintenance boot itself remains active until reset. On the next boot the old
confirmed image is still selected. Phase 290 qualifies physical interruption and
rollback on hardware.

## Ownership and secrets

All buffers are bounded and caller-owned. Config is decoded and validated before
Storage replaces the persisted record. Wi-Fi credentials and the bootstrap key are
copied synchronously, never logged, and temporary plaintext profile memory is wiped.
No heap is used by the Spaghetti adapter.

## Development USB adapter

The GPIO3/GPIO4 UART contract above remains the final-hardware provisioning path.
During development, the existing physical USB Zephyr Shell is a second local
adapter to the same maintenance policy; it does not change the board pin contract
and can simply be left unsoldered on production hardware.

From a Normal boot, `spaghetti maintenance reboot` stores the same one-shot marker
used by the architecture and performs a warm reboot. In Maintenance or
Unprovisioned mode, `spaghetti remote provision <identity>` accepts the 32-byte
remote-console PSK as 64 hidden hexadecimal digits; `spaghetti remote clear`
revokes it. The public credential API checks that Maintenance Link is `ACTIVE`, so
the USB commands cannot write or delete the secret during Normal operation. Prefer the host
wrappers documented in [Communication](../../communication/README.md), which keep
the PSK out of shell history and automate the reboot/reconnect sequence.
