# Threshold rule

[← Project README](../../README.md) · [Architecture](../../ARCHITECTURE.md)

The Threshold rule observes one numeric field on records from one Module key and
emits a BOOL command to another Module key on hysteresis transitions. It never
includes concrete driver headers such as INA219 or Relay.

## Config schema

`spaghetti.rule.threshold` version 1 uses field IDs:

| Field ID | Meaning |
|---|---|
| 1 | Source Module key |
| 2 | Source record field ID |
| 3 | Lower hysteresis boundary (INT64) |
| 4 | Upper hysteresis boundary (INT64) |
| 5 | Target Module key |
| 6 | Target command ID |
| 7 | Target command BOOL field ID |
| 8 | BOOL value commanded when the sample is above upper |

Reference groups: source key + source field = group 1; target key + command ID +
command field = group 2.

## Behavior

- Ignores records whose source key or field ID differ.
- Accepts INT64 and UINT64 values representable as INT64.
- Emits a command only on transitions across the hysteresis bands.
- Runtime resolves `target_key` and applies the command; Threshold never holds a
  Manager pointer.
