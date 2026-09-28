# Processing engine

Compiles Config `blocks`/`edges` into a topo-ordered DAG and evaluates it when
Runtime delivers source records.

## Budgets

| Limit | Source | Default (minimal/standard/extended) |
|-------|--------|-------------------------------------|
| Blocks / edges / contexts | `CONFIG_SPAGHETTI_MAX_PROCESSING_*` | profile |
| Fan-out per endpoint | `SPAGHETTI_PROCESSING_FANOUT_MAX` | 4 |
| Cost per record | `CONFIG_SPAGHETTI_PROCESSING_COST_BUDGET` | 256 / 512 / 1024 |
| Topological depth | `CONFIG_SPAGHETTI_PROCESSING_DEPTH_MAX` | 8 / 16 / 32 |

A block error increments stats and aborts only that evaluation. Acquisition and
other pipelines continue.
