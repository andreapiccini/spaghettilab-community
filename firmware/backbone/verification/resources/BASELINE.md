# Resource profile baseline

[← Project README](../../README.md) · [Core](../../subsys/core/README.md)

This baseline records the deterministic build contract introduced by task 291. It
does not promise final PCB limits and it must not be used as a substitute for
hardware qualification.

## Measured ESP32-C3 builds

Both available ESP32-C3 variants select the **Minimal** profile at build time. The
measurements below use Zephyr 4.4.0, the MCUboot sysbuild configuration, and the
project's normal pristine build.

| Variant | Application binary | Signed application | MCUboot | Linked SRAM | SRAM region | Headroom |
|---|---:|---:|---:|---:|---:|---:|
| `core-v1-esp32c3` | 817,512 B | 817,663 B | 43,040 B | 238,816 B | 365,328 B | 126,512 B |
| `core-v2-build-only` | 817,180 B | 817,330 B | 43,040 B | 298,224 B | 365,328 B | 67,104 B |

The linked SRAM value comes from `_image_ram_size` in `zephyr.map`; it is not a
runtime free-heap sample. Standard and Extended are verified on `native_sim` so that
their contracts and distinct snapshots compile, but no ESP32 hardware-memory claim
is made for those profiles yet. The Core v1 row includes task 293; Core v2 has not
yet been remeasured with the shared allocator and intentionally retains its previous
baseline.

## Profile limits

| Resource | Minimal | Standard | Extended |
|---|---:|---:|---:|
| Modules | 8 | 16 | 32 |
| Schedules | 8 | 16 | 32 |
| Rules | 4 | 8 | 16 |
| Device Profiles | 8 | 16 | 32 |
| Persisted Device Profile bytes | 512 | 1,024 | 2,048 |
| Device Profile operations | 16 | 32 | 64 |
| Acquisition operations | 16 | 32 | 64 |
| Processing blocks | 16 | 32 | 64 |
| Processing edges | 24 | 64 | 128 |
| Active processing contexts | 8 | 16 | 32 |
| Properties per set | 12 | 16 | 24 |
| Protocol payload | 512 B | 1,024 B | 2,048 B |
| Record queue | 8 | 16 | 32 |
| Record consumers | 3 | 4 | 6 |
| BLE peers | 1 | 2 | 4 |
| Principals | 4 | 8 | 16 |
| In-flight requests | 4 | 8 | 16 |
| Secure sessions | 1 | 1 | 1 |
| Shared secure workspace | 60,000 B | 60,000 B | 65,536 B |
| Flows | 2 | 4 | 8 |
| Function Bays per Flow | 3 | 5 | 8 |
| Power rails | 3 | 4 | 8 |
| Replay window | 30,000 ms | 60,000 ms | 120,000 ms |

The power-rail limit cannot exceed 32 because its protocol representation is a
`uint32_t` bit mask. These values are declared once in `Kconfig.resources`; code,
codecs, tests, and future protocol schemas must consume the corresponding
`CONFIG_SPAGHETTI_*` symbol rather than repeat the number.

## Current Minimal static allocations

| Allocation | Configured size | Notes |
|---|---:|---|
| Main stack | 8,192 B | Zephyr main thread. |
| Shell UART stack | 5,120 B | Local development and maintenance shell. |
| Wi-Fi profile worker | 0 B static | Allocated only while the Wi-Fi service runs. |
| MQTT workers | 0 B static | Two stacks are allocated only while enabled and running. |
| Runtime sampling stack | 1,536 B | Bounded sampling worker. |
| Runtime rule stack | 1,536 B | Bounded rule worker. |
| OTA lifecycle work stack | 0 B static | Cleanup uses the shared system workqueue. |
| OTA listener stack | 0 B static | Allocated only during an authenticated OTA window. |
| Update stack | 1,024 B | Update state machine worker. |
| Electrical logger stack | 1,024 B | Power diagnostics worker. |
| Logging stack | 768 B | Zephyr deferred logging. |
| Private mbedTLS heap | 0 B | Removed by task 293; mbedTLS now uses the flexible common-libc heap. |
| Minimal secure-workspace contract | 60,000 B | Admission budget and metric threshold; it is not a static allocation. |
| Production remote-console stack | 0 B | Its TLS backend and worker are not compiled in Minimal. |

Optional-service dynamic admission is limited to 4 threads and 16,384 requested
stack bytes in Minimal, 6/24,576 in Standard, and 8/32,768 in Extended. The public
service resource snapshot reports current threads/bytes, their high-water values,
largest measured joined-stack usage, and allocation failures. Zephyr obtains these
stacks from its system heap, configured to 20,480 B, 28,672 B, and 36,864 B
respectively so allocator metadata and alignment cannot consume the admission
budget. This is distinct from the common-libc heap used by mbedTLS: linked SRAM owns
the bounded system-heap arena, while stopped services return its blocks for reuse by
another optional service.

Subsystem pools are bounded by the profile macros. For example, Config and Module
Manager both use `CONFIG_SPAGHETTI_MAX_MODULES`, while communication and the Config
codec share `CONFIG_SPAGHETTI_MAX_PROTOCOL_PAYLOAD`. Later phases must extend this
same rule to their new queues, slabs, catalogs, and schemas.

## Capability baseline

The ESP32-C3 Minimal image advertises only features whose backends are compiled and
supported by its board configuration. Wi-Fi, MQTT, and Wi-Fi OTA are present. The
production remote console, external RAM, runtime pin mux, power switching, and power
measurement are absent. BLE capability remains absent until the BLE transport task
provides its real backend.

The Core logs the selected profile, variant, module capacity, protocol-payload limit,
and capability mask at boot. Update metadata can compare those immutable values; it
must never choose compatibility from instantaneous free RAM.

## Reproduce the baseline

```sh
make validate
docker compose run --rm --entrypoint sh dev -lc \
  'west twister -T tests/capabilities -p native_sim/native/64 --inline-logs --clobber-output'
make pristine
BOARD=spaghettilab_core_v2_build_only/esp32c3 make pristine
```

After each hardware build, read `_image_ram_size` and the SRAM memory-region length
from `build/app/zephyr/zephyr.map`, and measure artifacts with `wc -c`. Record new
numbers here only after a pristine build.

See [TLS allocator verification](TLS_ALLOCATOR.md) for the allocator source audit,
before/after map symbols and the remaining hardware peak-qualification boundary.
