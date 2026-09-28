# Power

[← Project README](../../README.md) · [Architecture](../../ARCHITECTURE.md)

Power owns shared rail admission and electrical ownership. Topology describes Flow
and Bay geometry; Power describes which rails reach a Bay and how firmly firmware
may select them.

Unmanaged jumper rails accept Modules as `UNVERIFIED` without pretending to know
the physical selection. Switched rails enforce declared voltage/current limits
before enabling a real backend.

## Files

| File | Role |
|---|---|
| `include/spaghetti/power.h` | Ownership, rail descriptors, and admission API. |
| `subsys/power/power.c` | Devicetree catalog, owners, and admission. |
| `dts/bindings/spaghetti/spaghettilab,power-rail.yaml` | Rail assurance and limits. |
| `dts/bindings/spaghetti/spaghettilab,bay-power.yaml` | Bay reachability masks. |

## API contract

`acquire`/`release` remain the electrical owner table. `attach`/`detach` validate a
Flow/Bay/rail binding, then call into that table. Descriptor limit `0` means
unknown and never invents safety. Module Manager wiring arrives in task 320.
