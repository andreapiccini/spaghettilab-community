# Schema

[← Project README](../../README.md) · [Architecture](../../ARCHITECTURE.md)

Schema owns the typed property vocabulary shared by Config, drivers, Data,
Runtime, Communication, and Node-RED. Values are bounded and pointer-free.
Descriptors stay `const` for firmware life and publish names, units, limits,
enums, and semantics without repeating them in every message.

## Ownership

Schema owns lookup and validation helpers. Plug-ins own schema descriptors,
string literals, defaults, and enum tables. Property sets and records own every
byte they carry. Schema never allocates and never mutates caller input.

## Files

| File | Role |
|---|---|
| `include/spaghetti/schema.h` | Public types and validation API. |
| `subsys/schema/schema.c` | Find/validate implementation. |

## Value contract

- Types: `BOOL`, `INT64`, `UINT64`, `TEXT`, `BYTES`.
- No float and no pointers inside values.
- `TEXT` is owned UTF-8; `size` excludes NUL and `text[size]` must be `'\0'`.
- `BYTES` is an opaque owned blob.
- Capacities come from profile 291:
  `CONFIG_SPAGHETTI_MAX_PROPERTIES_PER_SET`,
  `CONFIG_SPAGHETTI_VALUE_TEXT_MAX`,
  `CONFIG_SPAGHETTI_VALUE_BYTES_MAX`.

## Host / Node-RED integer mapping

INT64 and UINT64 keep full precision on the wire. Host codecs decode them as
`BigInt`. JSON and Node-RED messages emit decimal strings when a value falls
outside `Number.MIN_SAFE_INTEGER..Number.MAX_SAFE_INTEGER`. The catalog always
keeps the original integer type so clients can rebuild without silent `Number`
conversion.

## Record metadata

| Field | Meaning |
|---|---|
| `timestamp_ms` | Monotonic uptime from `k_uptime_get()`, not Unix time. |
| `boot_id` | Changes across reboot and makes gaps explicit. |
| `sequence` | Per source, starts at one, rollover at `UINT32_MAX` is valid. |

## RAM footprint

Measured on `native_sim/native/64` with the MINIMAL profile
(`MAX_PROPERTIES=12`, `VALUE_TEXT_MAX=32`, `VALUE_BYTES_MAX=16`):

| Type | `sizeof` |
|---|---|
| `struct spaghetti_value` | 56 |
| `struct spaghetti_property_set` | 680 |
| `struct spaghetti_record` | 752 |

Update this table after changing profile defaults before choosing zbus queue
depth in phase 340.

## API contract

`spaghetti_property_find()` returns a borrowed immutable pointer.
`spaghetti_property_validate()` checks types, required fields, ranges, UTF-8,
enums, and reference-group pairing.
`spaghetti_property_validate_with_resolver()` also asks a fake or Config-owned
resolver for Module/Flow/Bay/Port/rail targets.
`spaghetti_record_payload_validate()` / `spaghetti_record_validate()` add kind,
schema ID/version, source key, sequence, and timestamp checks.
