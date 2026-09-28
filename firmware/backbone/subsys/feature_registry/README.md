# Feature registry

[← Project README](../../README.md) · [Public API](../../include/spaghetti/feature_pack.h)

The Feature Registry enumerates compiled Capability Packs. A pack is a build-time
grouping of Module, Rule, and Block types with dependencies and conflicts. Packs
are not dynamically loaded: installing one means flashing a signed MCUboot image
that contains the pack descriptors and their code.

This firmware exposes a catalog for a future host. It does **not** implement a
React Flow marketplace, store, payment, or search UI.

## Files

| File | Role |
|---|---|
| `feature_registry.c` | Init, find, count, get, catalog, provides-* |
| `image_manifest.c` | Embedded manifest and candidate validation |
| `pack_*.c` | Built-in pack descriptors |
| `feature_pack_sections.ld` | Iterable ROM section |

## Built-in packs

| Pack ID | When linked |
|---|---|
| `core-basic` | Always |
| `processing-basic` | `CONFIG_SPAGHETTI_PACK_PROCESSING_BASIC` |
| `processing-kalman` | `CONFIG_SPAGHETTI_PACK_PROCESSING_KALMAN` (needs Kalman block) |
| `device-profile-engine` | `CONFIG_SPAGHETTI_PACK_DEVICE_PROFILE` |
| `transport-modbus` | `CONFIG_SPAGHETTI_PACK_MODBUS` (stub, default n) |

## Image manifest

`spaghetti_image_manifest_get()` returns the embedded contract: Core variant,
resource profile, firmware version, ABI, protocol/config floors, ordered pack
list, `feature_set_hash` (SHA-256 of sorted `id@version`), declared flash/RAM
budgets, bootloader minimum, and Config migration policy.

`spaghetti_image_manifest_validate_candidate()` rejects a candidate that drops a
Module/Rule/Block type used by the supplied Config unless the candidate sets
`SPAGHETTI_CONFIG_MIGRATION_EXPLICIT`.
