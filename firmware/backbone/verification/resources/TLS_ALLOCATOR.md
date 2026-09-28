# TLS allocator verification

[← Resource baseline](BASELINE.md) · [Secure Workspace](../../subsys/services/secure_workspace/README.md)

This note records the allocator path verified against the Zephyr 4.4.0 tree mounted
by the project development container. It distinguishes static reservation from
runtime demand: removing a private arena does not make a TLS handshake free.

## Zephyr 4.4 behavior

`modules/mbedtls/zephyr_init.c` declares `_mbedtls_heap` with
`CONFIG_MBEDTLS_HEAP_SIZE` bytes and calls
`mbedtls_memory_buffer_alloc_init()` only when both
`CONFIG_MBEDTLS_ENABLE_HEAP` and `MBEDTLS_MEMORY_BUFFER_ALLOC_C` are enabled.
That path permanently reserves the complete arena in `.bss`, whether or not a TLS
session is active.

The project configuration enables `MBEDTLS_PLATFORM_MEMORY`. When the private heap
initialization is absent, mbedTLS's platform `calloc` and `free` remain the libc
implementations. The ESP32-C3 application uses Picolibc plus Zephyr common-libc
malloc. `lib/libc/common/source/stdlib/malloc.c` backs that allocator with a
`sys_heap` spanning the otherwise unused SRAM between `_end` and `_heap_sentry` when
`CONFIG_COMMON_LIBC_MALLOC_ARENA_SIZE=-1`.

Therefore task 293 uses the common allocator and the Secure Workspace only controls
admission. It does not supply pointers and it does not reserve another 60 KiB array.
`CONFIG_SYS_HEAP_RUNTIME_STATS` exposes allocator high-water data to the production
metrics backend.

`native_sim` does not link the ESP32 common-libc allocator implementation, so unit
tests provide the internal metrics backend deterministically. This backend is not
part of the public API and is never linked into the hardware image.

## Before and after

The pre-task map contained `.bss._mbedtls_heap` with `0xea60` bytes, exactly 60,000
bytes. The pristine `core-v1-esp32c3` build after task 293 contains no
`_mbedtls_heap` symbol and reports:

| Measurement | Before task 293 | After task 293 | Difference |
|---|---:|---:|---:|
| Linked SRAM (`_image_ram_size`) | 298,224 B | 238,816 B | -59,408 B |
| Flexible libc heap (`_libc_heap_size`) | 80,352 B | 139,824 B | +59,472 B |
| Private mbedTLS arena | 60,000 B | 0 B | -60,000 B |

The small difference from exactly 60,000 bytes is the Secure Workspace state,
semaphore, mutex, allocator metrics and alignment. TLS 1.2, DTLS, the PSK exchange
and `TLS_PSK_WITH_AES_128_GCM_SHA256` remain enabled in the final configuration.

## Verification boundary

Automated `native_sim` tests cover exclusive admission, MQTT-to-OTA handoff,
bounded timeout, mismatched-owner release, forced allocator-statistics failure, 100
allocate/free session cycles and return to the allocation baseline. OTA tests also
prove that an interrupted network session closes its backend and releases admission.

Real TLS/DTLS peak sizing still belongs to hardware qualification because it depends
on the production socket backend, network packet buffers and selected radio. Do not
reduce `CONFIG_SPAGHETTI_SECURE_WORKSPACE_SIZE` below 60,000 bytes until the
qualification run has completed repeated correct-PSK handshakes, wrong-PSK rejection,
mid-handshake disconnect and peak capture on the target Core.
