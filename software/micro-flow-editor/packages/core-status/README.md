# @spaghettilab/core-status

Readable projections of the Core's own state — Module, schedule, Rule, Block, service,
connectivity, health, reset cause, watchdog, audit and job — plus a resource monitor
that shows flash/RAM/pool figures as the distinct quantities the firmware actually
tracks, never a generic "installable RAM" summary (S093).

## Status readability (`status-labels.ts`, `status-view.ts`)

`GET_STATUS`'s enum-shaped fields (`state`, `mode`, `imageState`, `healthState`, each
Module's `state`/`endpointKind`) were previously left as raw numbers in
`@spaghettilab/protocol-sdk` — that pass only had the enum *names* from the firmware
source, not the integer→label mapping. This package resolves the real values, read
directly from `firmware/backbone/include/spaghetti/core.h`, `health.h` and `module.h`:

- `spaghetti_core_state` (0 UNINITIALIZED .. 4 FAILED)
- `spaghetti_core_mode` (0 UNPROVISIONED, 1 NORMAL, 2 MAINTENANCE)
- `spaghetti_core_image_state` (0 CONFIRMED, 1 TRIAL)
- `spaghetti_health_state` (0 STARTING, 1 HEALTHY, 2 DEGRADED, 3 STALE)
- `spaghetti_module_state` (0 UNINITIALIZED, 1 READY, 2 ERROR)
- `spaghetti_module_endpoint_kind` (0 PORT_EXCLUSIVE .. 6 W1_ROM)

An unrecognized integer becomes `"UNKNOWN(n)"` rather than throwing — a firmware build
one version ahead of this SDK should stay readable, just less specific.

**Watchdog** (`watchdogInferenceOf`): the firmware computes
`hardware_watchdog_armed` internally (`firmware/backbone/subsys/core/health.c`) but never
puts it on the wire. `HealthState.HEALTHY` documents "HW watchdog armed",
`DEGRADED` "no hardware WDT" (`health.h:24-29`) — that is the only wire-visible signal,
so this is an inference from `healthState`, not a direct field. `STARTING`/`STALE`
resolve to `"unknown"`.

**Reset cause** (`CoreStatusView.lastResetCauseRaw`) and **connectivity service bits**
(`ConnectivityStatusView.policyRaw`/`activeServicesRaw`/`leasedServicesRaw`) are left as
raw, undecoded bitmasks. `last_reset_cause` comes from Zephyr's
`hwinfo_get_reset_cause()` (`health.c:354`) and this checkout vendors no Zephyr source
tree to confirm the real bit→label table against — decoding it with a guessed table
would be worse than a raw number that round-trips correctly regardless.

**Module** status comes straight from `GET_STATUS`'s per-Module list.

## Schedule/Rule/Block status — an honest gap (`processing-status.ts`)

Neither Schedule, Rule nor Block has *any* runtime status field on the wire —
`execute_get_status` only ever serializes Modules. A Schedule is nothing but a
`{enabled, source_key, period_ms}` toggle bound to one Module, so
`describeScheduleStatus()` reports the state of the Module it samples as the closest
honest proxy (`"unknown"` if that Module isn't in the last `GET_STATUS`). A Rule or
Block has no such proxy at all: `describeDeployedEntityStatus()` only confirms presence
in the last deployed Config — never "currently executing" or "healthy", concepts the
firmware does not expose per-Rule/per-Block.

## Audit and job (`audit-view.ts`, `job-status.ts`)

`describeAuditLog()` maps each `GET_AUDIT_LOG` entry's `operationId` to its real
`Operation` enum name (`@spaghettilab/protocol-sdk`'s `envelope.ts`); `internalResult`
stays a raw firmware errno, never remapped to `ProtocolStatus` since it's an internal
syscall result, not necessarily the envelope status the caller saw.

`describeJobStatus()` labels a `GET_JOB_STATUS` response's `state`/`operation` — generic
across job kinds, distinct from `@spaghettilab/core-actions`'s `interpretJobStatus`,
which classifies a *discovery-scan* job into outcomes for that specific workflow. This
function only makes the raw response readable for any job kind.

## Resource monitor (`resource-monitor.ts`)

`describeResourceMonitor()` presents `GET_RESOURCES`'s six pools
(modules/rules/blocks/profiles/records/workspace) as distinct `{capacity, used, peak}`
objects — never summed into one number, matching the doc comment already on
`protocol-sdk`'s `ResourcePool` ("one distinct pool per resource kind, never summed").
Config limits (`maxModules`/`maxPrincipals`) come from `GET_CAPABILITIES`.

**Allocation failures are sticky.** `firmware/backbone/subsys/resources/resources.c`'s
`spaghetti_resources_note_failure()` only ever increments the counter;
`spaghetti_resources_reset_high_water()` explicitly leaves it untouched
(`resources.h:96`). It clears only on a full reboot. So "a past allocation failure
remains visible even after the condition has cleared" (S093 § Verifiche) holds by
construction — `allocationFailures.hasEverFailed` reports the sticky value honestly
rather than trying to clear it client-side, which firmware has no operation for either.

`highWaterRegressed(previousPeak, currentPeak)` lets a caller assert a pool's `peak`
only ever increases across observations (S093 § Verifiche), matching that `peak` is
only raised by firmware, never lowered except by an explicit
`spaghetti_resources_reset_high_water()` this package does not call.

## Flash headroom and static RAM (`resource-monitor.ts`)

`flash_slot_bytes`/`flash_image_budget_bytes`/`flash_headroom_bytes`/
`static_ram_budget_bytes` are real `GET_RESOURCES` wire fields (keys 8-11) as of
Firmware roadmap [phase 392](../../../../firmware/backbone/roadmap/392-resources-flash-ram-wire-exposure/README.md)
— previously a documented firmware gap (S093's original implementation note), now
closed. `ResourceMonitorView.flashAndStaticRam` exposes all four as distinct numbers,
same "never summed" rule as the six pools above — flash headroom and static RAM budget
answer different questions and must stay legible as such, never folded into the pool
totals or into each other.

## Reset authorization (`reset-authorization.ts`)

`FACTORY_RESET` (op 15)'s `scope` is a bitmask
(`firmware/backbone/include/spaghetti/factory_reset.h:18-24`: `CONFIG`/`NETWORK`/
`CREDENTIALS`/`BLE_BONDS`/`ALL`), **not** an enum with a distinct "diagnostic" value —
`reset_ops.c` gates the whole operation with one permission
(`SPAGHETTI_PERMISSION_PROVISION`) regardless of which scope bits are set. So S093 §
Verifiche's "un reset diagnostico richiede autorizzazione esplicita" is an app-side
policy, not a wire distinction: `requestFactoryReset()` requires
`@spaghettilab/domain`'s `core.admin.factory-reset` scope for every call, any scope
combination included — denied means no `FACTORY_RESET` request is ever sent, matching
what the firmware actually enforces rather than inventing a second permission scope for
a wire value that doesn't exist.

## Honest scope gaps

- **`lastResetCause` and connectivity service bits stay undecoded raw bitmasks** — no
  vendored Zephyr source tree in this checkout to confirm `hwinfo` reset-cause bit
  values, and no confirmed service-bit table for `GET_CONNECTIVITY_STATUS` distinct from
  the MQTT=1/BLE=2 record-delivery consumer IDs used elsewhere.
- **Schedule/Rule/Block have no real runtime status** — only a Module-state proxy
  (Schedule) or deployed-presence (Rule/Block), documented in `processing-status.ts`.
- **Watchdog state is inferred from `healthState`**, not a direct wire field.
