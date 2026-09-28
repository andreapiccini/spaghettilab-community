# Resources

[← Project README](../../README.md) · [Public API](../../include/spaghetti/resources.h)

The resource report separates immutable build budgets from runtime used/peak
observations. Snapshots are caller-owned and never allocate.

## What is reported

- Build/image: flash slot/image/headroom, static RAM, declared stacks/pools/
  workspace, feature-set hash, pack list
- Runtime pools: modules, rules, blocks, profiles, records, workspace
- Optional heap capacity when `CONFIG_HEAP_MEM_POOL_SIZE` is non-zero
- Optional stack high-water only when `CONFIG_SPAGHETTI_RESOURCES_STACK_STATS=y`
- Allocation failure count and last exhausted owner

## What is not reported

There is intentionally **no** `free_ram` installability promise. Instantaneous
free RAM does not authorize a new Capability Pack. Candidate fit is decided by
the signed image manifest and build/link gates.

## Instrumentation

Subsystems call `spaghetti_resources_note_used()` / `note_failure()` after pool
mutations. Device Profile used count is derived from
`spaghetti_device_profile_count()` on each snapshot.
