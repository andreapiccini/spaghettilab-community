# Change contract — Phase 270 authenticated Wi-Fi OTA

- Scope: one-shot OTA request, per-device DTLS-PSK credentials, restricted SMP over
  UDP and ordered writes through the existing Update coordinator.
- Public API additions: OTA credential/lifecycle/status contract and exact MCUboot
  secondary-slot capacity query.
- Security boundary: only local active UART may provision credentials or arm the next
  window. Authenticated UDP exposes status, firmware chunks and cancellation only.
- Transport decision: Zephyr 4.4 standard SMP UDP DTLS does not clearly require client
  authentication, so a private SMP transport owns a DTLS-PSK server socket instead.
- Failure rule: timeout or network loss closes the listener and erases only an
  incomplete candidate; Config, Wi-Fi profiles and active firmware remain untouched.
- Deferred: a user-facing host OTA client, multi-transport remote console and the
  physical interruption/security matrix belong to phases 280–290.
