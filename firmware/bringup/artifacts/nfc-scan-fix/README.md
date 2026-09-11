# NFC scan wait-loop fix

Recovery build, 2026-09-11. NFC runs on explicit commands; automatic LPCD
remains disabled. Wired SLUP and ESP-NOW update support are retained.

Both RFAL status loops now continue on ERR_BUSY, retaining their 300 ms and
750 ms polling deadlines. These deadlines do not bound blocking calls inside
the RFAL start/status methods. Scan failures preserve the RFAL error across
wakeup cleanup and report the last attempted antenna and operation stage.

Failure CAN payload (8 bytes): response command, status=1, antenna, RFAL error,
stage, 0xD1 diagnostic version marker, reserved, reserved. Success frames are
unchanged. The existing CORE forwards this payload without an S3 update.
Stage codes: 0 initialization, 1 configuration, 2 technology detection,
3 wake-up/anticollision/selection, 4 selected. Scanning both antennas reports
the last attempt on failure. Older C3 images show an explicit missing-diagnostics
message in the updated Python utility instead of an unqualified "no tag".

From the bringup directory, replacing the port with the connected CORE port:

```sh
python3 scripts/core_util.py --port /dev/cu.usbmodem101 flash-c3 --slup --bin artifacts/nfc-scan-fix/backbone-recovery.ota.bin
python3 scripts/core_util.py --port /dev/cu.usbmodem101 nfc-scan --antenna 1
```

For ESP-NOW use `--node 0x0D6730 flash-c3 --espnow` with the same OTA image.
The factory image is for direct serial installation at address 0x0 only.
The previous recovery artifacts are preserved. Hardware validation is pending.

Validation: build with `pio run -e backbone-recovery`; regression checks with
`python3 scripts/test_nfc_scan.py` and `python3 scripts/test_core_util_codec.py`.
