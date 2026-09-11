# Raw NFC-A probe recovery image

Built 2026-09-11. Includes the NFC scan wait-loop fix and preserves wired SLUP
and ESP-NOW updates. No CORE firmware update is required. Automatic LPCD remains
disabled in this recovery build. This is an application image, not an independent
recovery bootloader. Hardware validation is pending.

From the bringup directory:

```sh
python3 scripts/core_util.py --port /dev/cu.usbmodem101 flash-c3 --slup --bin artifacts/nfc-probe/backbone-recovery.ota.bin
python3 scripts/core_util.py --port /dev/cu.usbmodem101 nfc-probe --antenna 1 --count 0 --interval-ms 500
```

Use `--request wupa` for WUPA instead of REQA. Ctrl+C stops the host loop; every
probe turns the field off before returning. `--count` defaults to 20 and 0 means
continuous. The interval is a minimum host start-to-start period, not a hard
real-time schedule; USB/CAN latency may extend it. Each C3 probe leaves the field
off for 5 ms, turns it on, waits approximately 10 ms and transmits one 7-bit
request. No selection, memory read or write follows. With a suitable scope,
trigger on field onset and inspect roughly 10 ms later for the command. A short
scope record cannot cover the full delay and also resolve the carrier without
delayed acquisition or a separate envelope measurement.

Output fields (also emitted with global `--json`): `started`, `tx_complete`,
`software_deadline`, `rfal_error`, `rx_bits`, `atqa_hex`, `atqa_valid`, `result`.
TX complete means RFAL entered RX after handling the reader TX-end interrupt;
it does not prove the RF modulation meets the standard. ATQA is valid only with
successful TX, RFAL status zero and exactly 16 received bits. Bytes are displayed
in received order. A 300 ms software deadline bounds worker polling, but cannot
interrupt a stuck SPI operation or ISR.

The command uses the existing NFC_SCAN envelope with payload
`antenna, 0xD2, request` (request 0=REQA, 1=WUPA). A successful diagnostic delivery
has transport status zero and six data bytes:
`0xD2, flags, RFAL status, RX bit count, ATQA byte 0, ATQA byte 1`.
Flag bit 0: transceive accepted; bit 1: TX completed; bit 2: software deadline.
Older C3 firmware is rejected by the Python decoder if it lacks the marker.
The factory binary is only for direct serial installation at address 0x0.

Validation: recovery build and `scripts/test_nfc_scan.py` plus codec tests passed.
Tests cover wait-loop retries/deadlines and raw diagnostic decoding; they do not
simulate the physical RF path. Existing recovery artifacts were preserved.
