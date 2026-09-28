# Update and recovery qualification

[Project README](../../README.md) ·
[Update coordinator](../../subsys/services/update/README.md) ·
[Qualification task](../../roadmap/290-update-qualification/TASK-290-01-qualificare-update-e-recovery.md)

This directory contains the versioned evidence contract for a release candidate. A
successful build is prerequisite evidence, not proof of rollback. Every `Q-*` row in
[`QUALIFICATION_REPORT.md`](QUALIFICATION_REPORT.md) must be exercised on the named
physical board and changed from `NOT RUN` to `PASS`, `FAIL`, or a justified `N/A`.

## Freeze the candidate

Start from a clean Git commit and build the exact candidate:

```sh
make pristine
make update-qualification-manifest \
  QUALIFICATION_BOARD_REVISION=core-v1-rev-a \
  QUALIFICATION_DEVICE_SERIAL=prototype-001
```

Copy the JSON printed by the second command into the report's candidate section. It
contains Git state, sizes, SHA-256 hashes and the public MCUboot version. It reads no
secret value. A dirty Git tree is valid only for development investigation and cannot
qualify a release.

The application [`VERSION`](../../VERSION) starts at `0.1.0+0`. Every candidate must
advance it deliberately; the downgrade cases use a correctly signed image with a
lower value. The manifest rejects `0.0.0+0` because that value cannot prove downgrade
prevention.

The command also reports suspicious tracked secret filenames and unsafe POSIX modes
under `.keys/`. Zero findings are required. This is intentionally a filename and
permission check: it never opens credentials or prints their contents.

## Execute a case

Use a controllable power switch and the real base/client intended for the product.
Record its tool version in the report. For each row:

1. flash MCUboot and the baseline application once through USB;
2. capture `spaghetti status` before the operation;
3. execute exactly the requested fault at the stated byte boundary or boot phase;
4. reconnect without erasing NVS or either image slot;
5. capture boot logs and `spaghetti status` after recovery;
6. record hashes of the transmitted candidate and captured log, never a PSK;
7. mark `PASS` only when the expected image, slot, Config, and Update state agree.

UART cases use the GPIO Maintenance Link with USB disconnected after the initial
flash. Wi-Fi cases first install/arm OTA through local Maintenance, then use DTLS-PSK
UDP port 1337. The base/client must send Spaghetti SMP group 64 commands documented in
[Maintenance Link](../../subsys/services/maintenance_link/README.md). The client is
external to this Core repository and its exact revision belongs in the report.

Run the completeness gate after recording results:

```sh
make update-qualification-check
```

It exits nonzero for every `NOT RUN`, unknown status, or `FAIL`. It does not infer a
hardware pass from logs and cannot replace operator evidence.

## Irreversible production security

ESP32 Secure Boot, flash-encryption and eFuse operations are outside this matrix.
Perform them only under a separately reviewed manufacturing procedure: an incorrect
eFuse operation can permanently prevent recovery. The present Core V1 PSA ITS key
provider derives a key from the device ID and is not sufficient protection against a
physical attacker.
