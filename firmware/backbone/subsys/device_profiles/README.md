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
