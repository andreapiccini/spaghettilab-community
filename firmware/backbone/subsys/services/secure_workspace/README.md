# Secure Workspace

[← Services](../README.md) · [Architecture](../../../ARCHITECTURE.md)

Secure Workspace serializes heavy TLS/DTLS sessions without becoming another memory
allocator. mbedTLS uses Zephyr's common-libc `calloc()`/`free()` and therefore the
`sys_heap` built from otherwise unused SRAM. The workspace grants admission only; it
never returns a pointer to that heap.

The current public snapshot names one owner, so every profile deliberately supports
one concurrent heavy secure session. Increasing this requires a future public
multi-owner snapshot and a measured board budget, not only a larger semaphore.

`peak_used` is the highest observed increase over the common-libc allocation baseline
of an admitted session. Because the allocator is shared, it is a conservative upper
bound and may include unrelated concurrent libc allocations. Admission timeouts are
counted in `allocation_failures`.

Wi-Fi OTA acquires the workspace before mutating Update state and releases it after
closing its DTLS backend. MQTT is currently plain TCP and therefore does not acquire a
TLS workspace yet; phase 370 must acquire `SPAGHETTI_SECURE_OWNER_MQTT` before opening
its future TLS socket.

Allocator evidence and the measured SRAM reduction are recorded in
[TLS allocator verification](../../../verification/resources/TLS_ALLOCATOR.md).
