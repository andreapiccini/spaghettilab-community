# ST25TN01K lock map (Tag Studio v1)

Protocol policy (README §12):

| Blocks | After factory lock |
|---|---|
| 4..33 | Permanently read-only |
| 34..43 | Remain writable |

## Pages used

- **Page 2** — static lock / OTP bytes (`STATLOCK_0`, `STATLOCK_1`).
- **Page 44** — `DYNLOCK_0..2` + `SYSLOCK`.

## Planned masks (planner)

- Page 2: OR `0xF8` into byte 2 and `0xFF` into byte 3 (lock CC + pages 4..15 in Type-2 compatible layout).
- Page 44: OR `0xFF` into `DYNLOCK_0` and `0x01` into `DYNLOCK_1` so pairs through **32..33** lock while **34+** stay clear.

`SYSLOCK` and kill areas are never written by Tag Studio.

> Validate these masks on a sacrificial ST25TN01K before production use; ST dynamic-lock bit numbering must match the silicon revision on the PCB.
