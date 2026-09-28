# Connectivity Manager

[← Project README](../../README.md) · [Architecture](../../ARCHITECTURE.md)

The Connectivity Manager is the single owner of the persistent radio/network policy
and of one bounded temporary service lease. Wi-Fi Profiles still owns credentials,
MQTT owns broker state, and BLE owns peers when compiled in; none of those components
selects the overall power policy.

## Policy model

`LOW_ENERGY` keeps only compiled BLE connectivity in the normal service set.
`ONLINE` permits compiled Wi-Fi and MQTT. BLE and Wi-Fi never run together: the
ESP32-C3 shares one 2.4 GHz radio, so a lease for the other radio switches the
active one instead of OR-ing both. On Core V1 they are also **separate firmware
images** (`make build` vs `make build-ble`) because SRAM cannot hold both stacks.
The remote console is never opened merely because Wi-Fi is active; it must be
requested explicitly by a lease.

The build selects an initial policy through Kconfig. Config will persist it in phase
330. The service callbacks are no-op adapters in this phase so existing radio behavior
is unchanged; real lifecycle adapters arrive in phases 294, 365, and 370.

## Lease model

One request is copied into Manager-owned state. Its relative duration is converted to
an absolute `k_uptime_get()` deadline and a delayed work item restores the persistent
policy. Explicit release and logical reboot clear the same state. A second concurrent
lease returns `-EBUSY`.

Every transition starts new services in dependency order and publishes state only
after all callbacks succeed. On failure it stops newly started services, restarts any
service already stopped, retains the previous policy, and exposes the backend error in
the snapshot.

## Public API

See [connectivity.h](../../include/spaghetti/connectivity.h) for complete parameter,
ownership, execution-context, and error contracts.
