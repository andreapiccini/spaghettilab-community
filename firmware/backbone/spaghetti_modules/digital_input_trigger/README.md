# Digital Input Trigger module driver

[← Project README](../../README.md) · [Architecture](../../ARCHITECTURE.md)

Generic event-source driver that fires whenever one indexed digital connector
line reaches a configured level. It replaces the separate button-pressed,
button-released, MD-button, and interrupt blocks found in comparable no-code
tools with a single parametrized block: pick the signal index (0..4) and
whether the trigger fires on electrical high or low.

## Contract

- `channel` (0..4): connector signal index read via
  `spaghetti_port_digital_input_get()`.
- `trigger_high`: `true` fires when the line reads high, `false` when it reads
  low.
- `describe_endpoint` returns `SPAGHETTI_ENDPOINT_GPIO_LINE` keyed on
  `channel`, so two instances on different channels of the same Port coexist,
  while two instances on the same channel correctly collide.
- `init` takes one context from a static `k_mem_slab` and does one read to
  fail fast on an unready line; it never arms events itself.
- `start`/`stop` arm and disarm a `k_work_delayable` poll loop (period
  `CONFIG_SPAGHETTI_DIGITAL_INPUT_TRIGGER_POLL_MS`). Core V1 has no GPIO
  interrupt/ISR API wired through the Port layer, so edge detection is
  software-debounced polling, not a hardware interrupt.
- The event fires once per edge into the trigger level; the line must return
  to the opposite level before it can fire again.

The driver requires `SPAGHETTI_PORT_CAP_DIGITAL_INPUT` and never contains a
board-specific pin number — the Port's `input-gpios` Devicetree property owns
that. Unit tests should fake `spaghetti_port_digital_input_get()` and drive
the poll work item directly, following `tests/relay/`'s fake-Port pattern.
