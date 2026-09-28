# Change contract — Phase 260 local maintenance UART

- Scope: board-selected shared-pin UART, authenticated RX-only bootstrap, restricted
  Spaghetti SMP group, offline Wi-Fi provisioning and sequential image writes through
  the existing Update coordinator.
- Public API additions: Maintenance Link lifecycle/key/status,
  `spaghetti_update_write()` and `spaghetti_wifi_profiles_init_offline()`.
- Security boundary: only management group 64 is registered; generic mcumgr Image,
  Shell, File System and OS groups remain disabled. Secrets and firmware bytes are not
  logged.
- Hardware ownership: Core enters maintenance before Runtime or Module start. Board
  DTS owns concrete pins and the common service sees only phandles and pinctrl states.
- Failure rule: malformed input changes no persistent state; upload timeout/cancel
  erases only the secondary slot. MCUboot is the final signed-image verifier.
- Deferred: base-side client, authenticated Wi-Fi OTA, remote console and destructive
  hardware interruption matrix belong to phases 270–290.
