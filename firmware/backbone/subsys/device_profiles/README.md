# Device Profiles

[← Project README](../../README.md) · [Architecture](../../ARCHITECTURE.md)

Device Profiles describe one device model as bounded acquisition plans. Instance
Port, Bay, label, and bus address stay in Module Config. Built-in ROM profiles and
installed CBOR profiles share one catalog API.

## Ownership

`subsys/device_profiles` owns decode, validation, hashing, catalog publication,
and plan execution through Port APIs. The `declarative-device` Module driver binds
one catalog profile to one Module instance from a mem slab.

## Files

| File | Role |
|---|---|
| `include/spaghetti/device_profile.h` | Catalog, validate, install, exec API |
| `subsys/device_profiles/device_profile.c` | Catalog, CBOR install, persistence slots |
| `subsys/device_profiles/device_profile_exec.c` | Bounded opcode interpreter |
| `subsys/device_profiles/device_profile_sections.ld` | ROM iterable section for built-ins |
| `spaghetti_modules/declarative_device/` | Generic Module driver |

## Limits

Kconfig caps `CONFIG_SPAGHETTI_MAX_DEVICE_PROFILES`,
`CONFIG_SPAGHETTI_MAX_DEVICE_PROFILE_BYTES`,
`CONFIG_SPAGHETTI_MAX_PROFILE_OPERATIONS`, and
`CONFIG_SPAGHETTI_MAX_ACQUISITION_OPERATIONS`. Validation rejects unknown opcodes,
WAIT without attempts, and budgets above the profile maxima before any I/O.

## Caps == 0 drivers

`declarative-device` publishes `required_capabilities = 0`. Registry accepts that
sentinel. Module Manager skips the blanket Port capability check and derives the
acquire transport from the endpoint described after profile resolution. The driver
still checks the profile's capability mask against the Port during init.

### Long I²C writes (opcode set 5, wire 3)

Wire 3 appends key 14 (action slices, possibly empty) and key 15 (immutable byte string,
maximum 3072 bytes) after the legacy keys 0–13. Wire 1 and 2 remain readable.

- `MESSAGE_LOAD` (29): `imm0` = message length (1–2048), `imm2` = template offset.
- `MESSAGE_PATCH` (30): `src_a` = ordinary temp, `imm0` = message offset,
  `imm1` = bytes copied. The source and destination ranges are checked.
- `I2C_MESSAGE_WRITE` (31): `imm0` = loaded message length, `imm1` = bounded timeout.
  One message is passed to Port I²C with STOP only at its end.

A dedicated workspace is allocated only for plans containing these instructions,
serialized by a bounded mutex and freed on every return path. Small temp/value
buffers remain unchanged. Installed profiles own their exact CBOR allocation;
message pointers are rebased to that owned storage. Aggregate profile storage is
limited to 16 KiB and allocation failures are returned before use. The fixed
profile slots no longer reserve a maximum CBOR buffer each.
