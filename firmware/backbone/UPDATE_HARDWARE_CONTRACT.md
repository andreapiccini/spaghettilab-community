# Abstract hardware contract for maintenance

This document defines what each Core variant must offer to support provisioning and
updating without USB. The common firmware does not contain GPIO numbers and does not
assume which controller implements the connection.

## Boundary between common firmware and board

The common firmware knows only one `maintenance link` with these logical operations:

```c
enum spaghetti_maintenance_entry_reason {
	SPAGHETTI_MAINTENANCE_CONFIG_ABSENT,
	SPAGHETTI_MAINTENANCE_BOOTSTRAP_FRAME,
	SPAGHETTI_MAINTENANCE_REBOOT_REQUEST,
};

int spaghetti_maintenance_link_init(void);
int spaghetti_maintenance_link_probe(uint32_t timeout_ms, bool *requested);
int spaghetti_maintenance_link_enter(
	enum spaghetti_maintenance_entry_reason reason);
int spaghetti_maintenance_link_leave(void);
int spaghetti_maintenance_link_set_key(const uint8_t *key, size_t key_size);
enum spaghetti_maintenance_link_state spaghetti_maintenance_link_get_state(void);
```

`timeout_ms` is passed by value because it is a small numerical limit. `requested` is a
mutable caller-owned pointer: it is written only when the probe completes successfully.
`reason` is passed by value and is used for diagnostics and policy; it does not select
pins. These APIs are called by the Core boot thread and the Update coordinator, never
from an ISR.

The board backend must ensure that:

- `probe()` only listens, without transmitting or starting an update;
- `enter()` makes the local transport available and prevents concurrent use of the
  normal connection;
- `leave()` closes the transport, restores the normal pins/controller, and is repeatable;
- every error leaves the pins in a known state and never enables two peripherals together.

## Devicetree description

The Core variant describes a `spaghettilab,maintenance-link` compatible node. The
binding must require logical references, not GPIO numbers in the common API:

```dts
maintenance_link0: maintenance-link {
	compatible = "spaghettilab,maintenance-link";
	normal-bus = <&i2c0>;
	maintenance-uart = <&uart1>;
	bootstrap-window-ms = <500>;
	status = "okay";
};
```

`normal-bus` is the controller used by the Engine. `maintenance-uart` is the Zephyr
device used by the local backend. `bootstrap-window-ms` limits listening when there is
already a Config. Pins, pinmux, and concrete controllers remain in the board nodes,
pinctrl definitions, or overlay. Core V1 uses `uart1`; the build-only Core V2 uses the same
controller with a different pin mapping.

A variant that does not provide the node does not expose the capability. Kconfig/CMake
must refuse local maintenance on that build; the common firmware should not create a
fallback with hard-coded pins.

## Verified mapping for Core V1

Core V1 reuses the two already documented signals:

| Logical role | Normal mode | Maintenance mode |
|---|---|---|
| Data 0 | GPIO3, I2C SDA open-drain | UART RX |
| Data 1 | GPIO4, I2C SCL open-drain | UART TX |
| Reference | common ground | common ground |

GPIO3 and GPIO4 appear only in board and pinctrl files. They must not appear in Update,
Core, Communication, the public Maintenance Link API, or the host tool. On another Core, the same API
can use other pins or another backend declared by the overlay.

During the bootstrap window with Config valid, the backend keeps TX inactive and listens
for a 40-byte frame on the RX line: `SPLM`, version `1`, command `1`, two bytes reserved
as zero, and an HMAC-SHA256 of the header followed by the Zephyr device ID. The 32-byte key is
per-device and is saved in PSA ITS. Only a complete and authenticated frame authorizes
`enter()`. An I2C sensor does not spontaneously transmit that frame; an absent frame or
noise returns the pins to I2C at the end of the window. Version 1 has no nonce and is
replayable: it is a local bootstrap protection, not remote authentication.

## Implemented local transport

Zephyr SMP UART provides Base64 and CRC serial framing on the `zephyr,uart-mcumgr`
chosen by the board. The firmware registers only Spaghetti group 64, with bounded
operations for status, Config CBOR, Wi-Fi profiles, bootstrap key, firmware chunks, and
cancel. Shell, File System, OS, and standard Image mcumgr groups remain disabled:
firmware writing must pass through `spaghetti_update_arm()`, `spaghetti_update_begin()`,
`spaghetti_update_write()` and `spaghetti_update_finish()` and cannot independently
confirm a trial.

UART does not provide a portable cable-presence signal. Connection loss during an
upload is therefore managed by the Update coordinator's absolute deadline: the
incomplete secondary is deleted and the confirmed image remains intact. Maintenance mode
remains listening until reset; with a valid Config, reset restores I2C and the previous
Config.

## Boot entry rules

The order is deterministic:

1. Core initializes Storage and Maintenance Link without starting Wi-Fi, Runtime or
   Module.
2. If Config is absent or cannot be decoded, Core enters local maintenance directly and remains
   waiting for Config or firmware. Wi-Fi and OTA network remain off.
3. If the one-shot `maintenance/boot_once` marker is present, Core deletes it before
   entering maintenance. A later reset does not create a loop unless Config is still absent.
4. Config valid without marker: `probe()` opens the only RX bootstrap window. A valid
   payload enters maintenance; timeout or invalid payload start `NORMAL`.
5. In `NORMAL`, an authenticated request can save the one-shot marker and restart.

The marker is not part of the user Config and does not represent an Update status. It is
a separate transitional request: it is consumed once. Maintenance makes available the
local channel, but the writing of `image-1` begins only after an Image Management
command has been accepted by the Update coordinator.

When a new Config is received correctly while the device was without Config, the default
behavior is to respond to the base, close maintenance and restart in `NORMAL`. An
incomplete upload is deleted before rebooting.

## Security properties

- No persistent value can force `RECEIVING` or confirm a new image.
- The boot probe does not broadcast on shared pins before a valid frame.
- An absent Config enables only local maintenance, not Wi-Fi or the network OTA listener.
- An input payload does not contain the image; it only authorizes the mode.
- Timeout, incorrect frame and reset restore previous firmware and deterministic status.
- The active firmware remains in `image-0`; a candidate uses only `image-1`.

## What to verify for every new Core

- The normal controller and maintenance controller can be suspended and reactivated.
- Pinctrl states do not simultaneously enable two peripherals on the same pins.
- Levels, pull and voltage are compatible with base and connected Module.
- TX remains inactive during probe and reset.
- The base and the device share an electrical reference.
- Overlay and DTS contain only real pins of the variant.
