# Firmware file templates

[← Implementation guide](../../FIRMWARE_IMPLEMENTATION_GUIDE.md) ·
[Developer how-to](../../EXTENDING_SPAGHETTI_LAB.md)

These files are starting points, not additional firmware components. Files use
the neutral name `example`; replace it consistently with the component name.

Templates under this directory are compile-checked by `tests/templates/`. Do not
leave unverified pseudocode in a `.template` that claims to be a driver or
descriptor.

Choose the correct family:

| Goal | Templates |
|---|---|
| Removable Module (sync or async) | `module_driver.*` |
| Rule Driver | `rule_driver.c.template` |
| Discovery Provider | `discovery_provider.c.template` |
| Block Driver | `block_driver.c.template` |
| Capability Pack | `feature_pack.c.template` |
| Built-in Device Profile | `device_profile.c.template` |
| Protocol V1 operation | `operation_handler.c.template` |
| Core/board variant | `board.*` |
| New common subsystem | `component.*` / `public_api.h` / `thread_component` |

Do not use a generic component singleton as per-instance Module state. Do not
patch `driver_registry.c`, `rule_registry.c`, `block_registry.c`, or
`discovery.c` to register a new type: use the matching `SPAGHETTI_*_DEFINE`
macro so the linker collects the descriptor.

## Create a Module

1. Copy `module_driver.h.template` → `spaghetti_modules/<name>/<name>.h`.
2. Copy `module_driver.c.template` → `spaghetti_modules/<name>/<name>.c`.
3. Add the `.c` to the application `CMakeLists.txt` and log/slab options to
   `Kconfig`.
4. Optionally list the `type_id` in a Capability Pack under
   `subsys/feature_registry/`.
5. Replace every `example` token, schema ID, and field ID. Keep
   `api_version = SPAGHETTI_MODULE_DRIVER_API_VERSION`.
6. For async emission, implement both `start` and `stop`; never emit from ISR.

## Create a component

1. Copy `public_api.h.template` to `include/spaghetti/<component>.h` only if
   another component needs the API.
2. Copy `component.c.template` to `subsys/<component>/<component>.c`.
3. Copy `private_header.h.template` only when sibling `.c` files need shared
   private types or helper declarations.
4. Copy `CMakeLists.txt.template` and, when needed, `Kconfig.template`.
5. Copy `thread_component.c.template` only if the component meets the dedicated
   thread criteria in the implementation guide.
6. Copy `test_component.c.template` into the component's test source directory.
7. Replace placeholders and delete unused sections.
8. Replace `<PROJECT-LICENSE-ID>` only after the project license has been
   selected.

## Templates

| File | Purpose |
|---|---|
| [`change_contract.md.template`](change_contract.md.template) | Decisions to complete before coding |
| [`public_api.h.template`](public_api.h.template) | Public API and Doxygen contract |
| [`private_header.h.template`](private_header.h.template) | Types/helpers shared only by sibling `.c` files |
| [`component.c.template`](component.c.template) | Private state and synchronous implementation |
| [`thread_component.c.template`](thread_component.c.template) | Bounded dedicated worker thread |
| [`CMakeLists.txt.template`](CMakeLists.txt.template) | Component source selection |
| [`Kconfig.template`](Kconfig.template) | Feature, limits, thread resources, and log level |
| [`test_component.c.template`](test_component.c.template) | Basic ztest structure |
| [`module_driver.h.template`](module_driver.h.template) | Module config helpers and field IDs (API v2) |
| [`module_driver.c.template`](module_driver.c.template) | Property-set Module driver + iterable DEFINE |
| [`rule_driver.c.template`](rule_driver.c.template) | Rule driver + `SPAGHETTI_RULE_DRIVER_DEFINE` |
| [`discovery_provider.c.template`](discovery_provider.c.template) | Discovery provider + DEFINE |
| [`block_driver.c.template`](block_driver.c.template) | Block driver + DEFINE |
| [`feature_pack.c.template`](feature_pack.c.template) | Capability Pack + DEFINE |
| [`device_profile.c.template`](device_profile.c.template) | Built-in Device Profile + DEFINE |
| [`operation_handler.c.template`](operation_handler.c.template) | Protocol V1 operation handler + DEFINE |
| [`board.yml.template`](board.yml.template) | Zephyr board metadata for a Core variant |
| [`board.dts.template`](board.dts.template) | Core hardware, Ports, Flows, rails, Bays |
| [`board_defconfig.template`](board_defconfig.template) | Hardware-only board defaults |

## Verify

```sh
./validator EXTENDING_SPAGHETTI_LAB.md templates/firmware
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/templates -p native_sim/native/64 --inline-logs --clobber-output'
```
