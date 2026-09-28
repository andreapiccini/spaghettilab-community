# @spaghettilab/core-admin

Sensitive Core admin operations — connectivity lease, network maintenance and
factory-reset scope — each with the confirmation/permission discipline S094 requires:
a destructive mutation needs explicit confirmation with a visible target before it
runs, and a missing permission blocks the operation locally, before any wire call
(not only via firmware-side enforcement).

## Confirmation (`confirmation.ts`)

`checkDestructiveConfirmation()` is the one primitive every destructive operation in
this package composes with: a caller must re-supply the exact `target` string it was
shown before the mutation runs. Not a UI dialog — a domain-level gate that makes it
structurally impossible to call `openNetworkMaintenance`/`requestFactoryResetWithConfirmation`
without having first displayed the real target and gotten it echoed back.

## Lease (`lease.ts`) — reversible, no confirmation needed

`firmware/backbone/include/spaghetti/connectivity.h:79`: acquiring a lease returns
`-EBUSY` if one is already active rather than forcibly evicting another principal, and
it always auto-expires. Confirmed not destructive, so `acquireLease()`/`releaseLease()`
only check the `core.admin.lease` permission — no `DestructiveConfirmation`. Firmware
itself gates `ACQUIRE_CONNECTIVITY_LEASE` with `SPAGHETTI_PERMISSION_DISCOVER` and
`RELEASE_CONNECTIVITY_LEASE` with `SPAGHETTI_PERMISSION_COMMAND` (`connectivity_ops.c`)
— two different, coarser firmware bits than this package's single `core.admin.lease`
app-side scope; that's expected; the app models finer-grained scopes than firmware's 6
permission bits, same acceptable gap `@spaghettilab/domain`'s `checkPermission` already
documents.

## Maintenance (`maintenance.ts`) — destructive, requires confirmation

`OPEN_NETWORK_MAINTENANCE` stops MQTT for the whole workspace and, on
`RESOURCE_PROFILE_MINIMAL` builds, disconnects BLE
(`connectivity_ops.c`'s `run_wifi_handover`/`stop_mqtt_for_workspace`/
`maybe_request_minimal_disconnect`) — disruptive enough to a running workspace that
`openNetworkMaintenance()` requires both `core.admin.maintenance` and a matching
`DestructiveConfirmation` before calling the wire, even though the disruption is
bounded (the lease it acquires always expires).

**Correction made while implementing S094**: `OPEN_NETWORK_MAINTENANCE`
(op 13) and `OPEN_WIFI_UPDATE` (op 14) are `SERIALIZED_MUTATION` on the firmware
side, not `ASYNC_JOB` — both return a handover acknowledgment
(`{address, port, leaseExpiresAtMs, reachedStateRaw}`, `connectivity_ops.c`'s
`encode_handover_ack`), not a `{jobId}`. `@spaghettilab/protocol-sdk`'s
`fields.ts`/`operations/connectivity.ts`/`operations/update.ts` previously decoded
both as the unrelated `{0: job_id}` shape — fixed as part of this task (see
`HandoverAckResponse` in `protocol-sdk`'s `fields.ts` for the citation).

## Reset scope (`reset-scope.ts`) — destructive, requires confirmation

`describeResetScope()` turns `FACTORY_RESET`'s `scope` bitmask
(`firmware/backbone/include/spaghetti/factory_reset.h`) into a human-readable label like
`"CONFIG+NETWORK"` or `"ALL"` — the visible target a caller must display before asking
for confirmation. `requestFactoryResetWithConfirmation()` composes
`@spaghettilab/core-status`'s `requestFactoryReset()` (which already enforces
`core.admin.factory-reset`) with a `DestructiveConfirmation` check whose `target` must
equal `describeResetScope(scope)` — a caller cannot confirm a different scope than the
one that will actually be wiped. Permission is checked first, confirmation second, wire
call last — same ordering as `openNetworkMaintenance()`.

## Credential/provisioning (`credential-provisioning.ts`) — no wire operation exists

Exhaustive search of `firmware/backbone/subsys/communication/operations/` (14 files) found
no operation for setting Wi-Fi/MQTT/OTA/remote-console credentials or BLE bonds. Real
provisioning only happens out-of-band over the Maintenance Link's local serial shell
(`firmware/backbone/subsys/services/maintenance_link/README.md:42-55`), never reachable
from this app's BLE/MQTT/WebSocket transports. `checkCredentialProvisioningAvailability()`
still checks `core.admin.credential-provisioning` first — even the fact that
provisioning needs physical access shouldn't be disclosed to a caller without the
scope — then reports `UNAVAILABLE_OVER_PROTOCOL_V1` with the real remediation, rather
than a wire call that could never work or a capability silently omitted.

## Connectivity policy — not an admin operation at all

`spaghetti_connectivity_set_policy()` exists as an internal C API
(`connectivity.h:68-69`) but no Protocol V1 operation calls it — checked directly
against `connectivity_ops.c`'s full handler list. Connectivity policy is a Config field
(the `connectivity` section already modeled by `@spaghettilab/config-compiler`'s
`CanonicalConfig`), applied through the existing `@spaghettilab/config-deployment`
pipeline (S080), not a standalone admin operation. This package intentionally does not
add one.

## Honest scope gaps

- **Credential/provisioning has no wire operation** — see above; this package can only
  report unavailability, never actually provision anything over Protocol V1.
- **App-side admin permission scopes are coarser/finer than firmware's 6 permission
  bits** (`SPAGHETTI_PERMISSION_{READ,CONFIGURE,COMMAND,DISCOVER,UPDATE,PROVISION}`) —
  expected and already documented as acceptable by `@spaghettilab/domain`'s
  `checkPermission`.
- **`OPEN_WIFI_UPDATE`'s handler lives in `connectivity_ops.c`, not `update_ops.c`**,
  despite belonging conceptually to OTA — this package does not wrap it at all (OTA
  admin flows belong to the later S101-S103 Capability Pack/OTA tasks), only the
  `protocol-sdk` decoder fix above touches it.
