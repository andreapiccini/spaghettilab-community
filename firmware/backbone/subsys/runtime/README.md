# Runtime

[← Project README](../../README.md) · [Architecture](../../ARCHITECTURE.md)

Runtime owns bounded multi-schedule sampling, asynchronous Module events, and rule
plug-in instances. Config stores stable Module keys and rule property sets; Runtime
resolves keys at start and never selects a Module from its Port.

## Scheduling

One worker waits for the nearest enabled deadline, reads every due job through Module
Manager, stamps boot ID / timestamp / per-job sequence, and publishes through Data.
Deadlines advance from the previous value to avoid drift. An error from one Module does
not delay the others.

## Events

On start, Runtime arms `start_events` for every configured schedule source that
supports it. The emit callback copies the payload into a bounded `k_msgq` and returns
`-ENOSPC` when full. Stop disarms events first, then drains the queue.

## Rules

`spaghetti_runtime_configure()` finds each rule driver, validates, and initializes up
to `SPAGHETTI_CONFIG_MAX_RULES` contexts. Every published record is delivered in order
to `on_record()`. Emitted actions are resolved by `target_key` and applied with
`spaghetti_module_manager_command()`. A failed action is logged and processing
continues. A failed rule init rolls back newly created contexts and keeps the previous
configuration.

## Lifecycle

```c
int spaghetti_runtime_configure(
	const struct spaghetti_runtime_schedule_config *schedules,
	size_t schedule_count,
	const struct spaghetti_rule_config *rules,
	size_t rule_count);
int spaghetti_runtime_start(void);
int spaghetti_runtime_stop(k_timeout_t timeout);
```
