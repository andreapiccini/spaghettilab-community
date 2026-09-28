# Change contract: complete engine bootstrap and transactional Config

## Scope

- Task: compose and start the complete Spaghetti LAB engine.
- Required observable outcome: boot reaches RUNNING without Modules; a persisted or
  serial Config reconciles Discovery, Manager, Runtime, MQTT and Storage atomically.
- Explicitly excluded behavior: automatic hardware discovery without a provider,
  fictional Power resources, TLS, and a new application transport.
- Component that owns the change: Core owns startup order; Config owns desired state
  and its transaction.
- Files allowed to change: Core, Config, Communication, main, their public contracts,
  tests, README and roadmap documentation.

## API

- Public functions: `spaghetti_config_init`, `validate`, `apply`, `get_snapshot`,
  `spaghetti_core_init`, `start`, and `get_state`.
- Contracts: documented in `include/spaghetti/config.h` and `core.h`.
- Purpose: generation-safe desired-state replacement and two-stage boot.
- Execution: synchronous thread calls; workers remain owned by Runtime and services.
- Return type: `int` for fallible operations, enum by value for Core state.
- Inputs: complete bounded Config copies and a nonzero expected generation.
- Ownership: pointer inputs are borrowed; Config copies successful snapshots; outputs
  are caller-owned and written only on success.
- Errors: validation/dependency errno, `-ESTALE` for generation mismatch and `-EIO`
  when rollback itself fails.
- Timeout: existing bounded Runtime and MQTT stop Kconfig values.
- Thread safety: Config mutex serializes apply/snapshot; Core state uses atomics.
- Idempotence: init/start reject repeated calls; apply is generation-guarded.

## Data and ownership

- New mutable objects: Config generation and Core-owned persisted startup copy.
- Owner/lifetime: Config and Core respectively, static for the firmware lifetime.
- Capacity: eight Module descriptions, 64 driver bytes each, no heap.
- Sharing: synchronous copied Discovery events and public snapshot APIs.
- Failure state: Config restores Modules, Runtime, MQTT and persisted record; Core
  remains RUNNING with the empty Config when a stored hardware assignment cannot apply.

## Execution

- Invocation context: boot thread and Shell thread.
- Blocking: bounded mutex, hardware init/deinit, flash write and service stop.
- Mechanism: direct calls because the transaction must return one definitive result.
- Synchronization: Config mutex protects generation, snapshot and reconciliation.
- Logging: existing Core and Config modules record the original and rollback errors.

## Configuration and hardware

- Devicetree: no new facts; current Port descriptions remain authoritative.
- Kconfig: existing fixed capacities and stop timeouts.
- Runtime Config: version 3 bounded snapshot.
- CMake: add only native Core test sources; production sources already exist.

## Verification

- Success: empty boot, persisted apply, live reconfiguration and generation increment.
- Invalid input: validation metadata and stale generation.
- Boundary: two endpoints on one Port and fixed capacities.
- Dependency failure: stored Module absent does not disable Communication.
- Rollback: injected driver and storage errors preserve old state/generation.
- Build: validator, focused Twister tests and `make pristine`.
- Hardware: boot without INA219 reaches engine RUNNING and Shell remains responsive.
