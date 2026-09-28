# On Boot module driver

[← Project README](../../README.md) · [Architecture](../../ARCHITECTURE.md)

Synthetic event-source driver with no real hardware behind it: it fires one
event exactly once, the moment the Runtime finishes arming every event
source during boot (`spaghetti_core_start()` → `spaghetti_runtime_start()`).
It exists purely so a Processing Graph can start from an "On Boot" trigger
node, matching the equivalent block in comparable no-code tools, without
inventing a new protocol event type: it reuses the existing RECORD event
pipeline (`start()` → `emit()` → `runtime_event_emit()` →
`spaghetti_processing_on_record()` / rule dispatch), the same path every other
Module event source uses.

## Contract

- Empty config schema: On Boot takes no parameters.
- `describe_endpoint` returns `SPAGHETTI_ENDPOINT_I2C_ADDRESS` with the
  reserved I2C General Call address (`0x00`), which the I2C specification
  guarantees no real peripheral will ever answer to. On Boot never issues an
  I2C transfer; this only exists so the driver can bind to Port 0 (the
  Core's I2C-capable Port) without colliding with a real device address, and
  because I2C is a shareable transport, other Modules keep using the same
  Port.
- `required_capabilities = 0`: like Declarative Device, the endpoint alone
  decides the Port transport actually acquired.
- `start()` fires the event once, synchronously, before returning. Manager
  guards against a double `start()` on an already-armed instance
  (`-EALREADY`), so it cannot fire twice per boot.
- `stop()` is a no-op; there is nothing to disarm.

`spaghetti_runtime_start()` arms `start()` for every configured event source
unconditionally, regardless of any `schedule.enabled` flag — so an On Boot
Module needs no schedule entry at all to fire on every boot.
