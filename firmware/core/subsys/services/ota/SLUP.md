# SLUP — USB master loads the other Backbones

[← OTA](README.md) · [Public API](../../../include/spaghetti/field_update.h)

Type every command on the **USB master** only: the Backbone with the PC cable
and the serial shell. The other boards stay on the CAN bus. They do not need
USB, a shell, or a second loop.

From `firmware/core`, with that board plugged in:

```sh
BOARD=spaghettilab_backbone_v1/esp32s3/procpu make monitor
```

Wait for `uart:~$`, then type `slup list`. Exit the monitor with `Ctrl-X`.
Close it before `make flash`: only one program can own the USB port.
`make screen` is the raw fallback.

```text
PC USB  →  Backbone idx 1 (master)  --CAN-->  idx 2, 3, … (peers)
                 ↑
           slup list / load / blink
```

`slup list` discovers who is on the bus and assigns an **index** for this
session. Index 1 is always this master. 2..N are the peers, each with its
`node_id` (last three factory MAC bytes). You choose the target. Cable order
does not matter.

The **image file lives on the PC**. The Zephyr shell cannot see that path.
Close `make monitor`, then from `firmware/core`:

```sh
make slup-list
make slup-load TARGET=2
make slup-load TARGET=0x112233 IMAGE=build/app/zephyr/zephyr.signed.bin
```

That reads the signed bin on the Mac, sends it over USB to the master, and
the master forwards it on CAN to the chosen idx/`node_id`. Default `IMAGE`
is the last `make build` output. `slup load 2` on the shell is different:
it clones the **master’s already-running** image, not a file on the PC.

## Commands (master shell)

```text
slup who
slup list
slup load 2
slup load 0x112233
slup blink 2
slup blink 0x112233
```

| Command | What it does |
|---|---|
| `slup who` | This master `node_id`. |
| `slup list` | Discover + assign `idx`. Prints `idx`, role (`master`/`peer`), `node_id`, MAC, version. |
| `slup version` | This master's signed image version. |
| `slup version 2` / `slup version 0xNODE` | Ask that board its running version over CAN. |
| `slup load 2` | EnterUpdate + push the running image to the board that `list` called 2. After the peer reboots, prints `firmware update done on … version: …`. |
| `slup load 0xNODE` | Same, by MAC suffix. |
| `slup blink 2` / `slup blink 0xNODE` | Pulse D5 on that board so you can confirm which one it is. |
| `slup locate` | Blink every listed board in turn. |

`field_update` is an alias of `slup`.

Example:

```text
slup list
idx  role    node_id   mac
1    master  0xaabbcc  aa:bb:cc:11:22:33
2    peer    0x112233  ...
3    peer    0x445566  ...
slup blink 2
slup load 2
```

The peer writes MCUboot image-1, ACKs, and trial-reboots. D5 is solid red
while an image is running; `blink` pulses it, then it goes solid again.

The master pauses the periodic Discover sweep for the whole `slup load`, so
STATUS/VERSION/NFC replies cannot steal image ACKs (`-ETIMEDOUT` / `-116`).

During `slup load` the **target** reports install progress on CAN. The master
prints it:

```text
SLUP erase 1% … 100%     peer wiping its unused MCUboot slot
SLUP install 1% … 100%   peer writing the image (each % is an ACK from that board)
```

STATUS replies include that same 0–100 value. A peer still on older firmware
does not send erase percents; the master then estimates erase from elapsed
time until that board is updated once.

## Bus

- Discover: standard ID `0x10`, command `0x06`.
- EnterUpdate to one `node_id`: extended ID `0x12000000 | node_id`, command `0x03`.
- Image: standard IDs `0x1B0`–`0x1B3` at 500 kbit/s on the SN65HVD230.
  The target sends `0x1B3` ACKs while it erases (`status=0xFE`, percent in
  the 32-bit value) and after each written chunk.
- Blink: command `0x0A`.
- NFC snapshot: command `0x08`. The master collects each peer’s Type-A tags
  during the periodic Discover sweep and publishes them on GET_STATUS.
