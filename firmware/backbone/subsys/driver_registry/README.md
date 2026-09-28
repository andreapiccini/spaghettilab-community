# Driver Registry

[← Project README](../../README.md) · [Architecture](../../ARCHITECTURE.md)

Driver Registry maps a stable module type identifier to an immutable driver
descriptor collected from Zephyr iterable sections at link time. It is a catalog,
not a module-instance owner.

## Ownership

Registry owns validation and lookup of descriptors published by drivers through
`SPAGHETTI_MODULE_DRIVER_DEFINE()`. It does not include concrete driver headers or
maintain a central pointer table.

## Files

| File | Role |
|---|---|
| `include/spaghetti/driver_registry.h` | Lookup and enumeration API. |
| `subsys/driver_registry/driver_registry.c` | Section iteration and validation. |
| `subsys/driver_registry/driver_sections.ld` | ROM iterable section. |
| `include/spaghetti/module_driver.h` | Descriptor contract and DEFINE macro. |

## API contract

`init()` walks every linked descriptor, rejects bad API versions, unpaired
start/stop, and incoherent schemas, then rejects duplicate `type_id` values.
`find()` / `count()` / `get()` iterate the same section. Order is not significant.

## How a driver registers

Compile the driver `.c` that contains `SPAGHETTI_MODULE_DRIVER_DEFINE(...)`.
No change to `driver_registry.c` is required.
