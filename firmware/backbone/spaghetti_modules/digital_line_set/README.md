# Digital Line Set module driver

[← Project README](../../README.md) · [Architecture](../../ARCHITECTURE.md)

Generic actuator driver that drives one indexed digital connector line to a
commanded electrical level. It is the output counterpart of
[Digital Input Trigger](../digital_input_trigger/README.md): same connector,
same `channel` concept, opposite direction.

## Contract

- `channel` (0..4): connector signal index driven via
  `spaghetti_port_digital_output_set()`.
- `safe_high`: electrical level imposed during both init and deinit.
- `describe_endpoint` returns `SPAGHETTI_ENDPOINT_GPIO_LINE` keyed on
  `channel`, so a Digital Line Set instance can share the connector Port with
  a Digital Input Trigger instance on a different channel, while two
  instances on the same channel correctly collide.
- `command` accepts `SPAGHETTI_DIGITAL_LINE_SET_COMMAND_SET` and updates
  cached state only after the Port write succeeds.
- `deinit` attempts `safe_high`, then releases the context even when the
  hardware write fails.

The driver requires `SPAGHETTI_PORT_CAP_DIGITAL_OUTPUT` and never contains a
board-specific pin number — the Port's `output-gpios` Devicetree property owns
that. Unit tests should fake `spaghetti_port_digital_output_set()`, following
`tests/relay/`'s fake-Port pattern.
