# @spaghettilab/core-actions

Immediate Module commands and discovery scan/job orchestration (S092) — kept
structurally and visibly separate from any Config mutation, with permission denied /
queue full / job timeout always distinct outcomes, never a generic error bucket.

## Command runner (`command-runner.ts`)

`runCommand()` calls `MODULE_COMMAND` — a wire operation `APPLY_CONFIG` never touches,
so "l'esecuzione di un comando manuale non modifica Config o progetto" (S092 §
Verifiche) holds structurally: this function has no code path that could write
`ProjectV1` or go through `CommandStack`.

`MODULE_COMMAND`'s request (`@spaghettilab/protocol-sdk`'s `ModuleCommandRequest`) is
`{key, commandId}` only — checked directly against
`firmware/backbone/subsys/communication/operations/module_command.c`: **no argument field
exists on the wire today**. `requiresArguments: true` on a request makes this function
refuse up front (`UNSUPPORTED_ARGUMENTS`, no wire call at all) rather than silently
invoking a parameterized command without its parameters — a typed argument-entry form
can still exist client-side for when the wire eventually carries them; this is the one
place that stays honest about it not doing so yet.

Permission is checked locally first (`core.command.execute` by default,
`@spaghettilab/domain`'s `checkPermission`, S121) — denied means no wire call happens
at all, matching every other permission gate in this codebase.

## Discovery scan + job progress (`discovery-workflow.ts`)

`requestScan()` maps `invasive: true` to `SCAN_DISCOVERY`'s real `allowStateChanging`
field and requires the `"core.discovery.invasive-scan"` permission scope (added to
`@spaghettilab/domain`'s `PERMISSION_SCOPES` for this task) *before calling the wire at
all* — "una scan invasiva richiede l'autorizzazione esplicita prevista dalla policy"
(S092 § Verifiche). A non-invasive scan needs no such grant.

`interpretJobStatus()` classifies a `GET_JOB_STATUS` response
(`spaghetti_job_state`, `firmware/backbone/subsys/communication/communication.c`) into a
distinct outcome per state — `EXPIRED` (6) becomes `"TIMEOUT"` explicitly, never
folded into `"FAILED"`; `FREE` (0, an unissued or already-reclaimed slot) becomes
`"UNKNOWN"` rather than a guessed terminal state.

## Discovery accept/reject — deliberately not duplicated here

Accepting or rejecting a discovered candidate is `@spaghettilab/physical-composition-model`'s
job (S050's `previewDiscoveryAccept`/`previewDiscoveryAcceptDiff`/
`moduleFromAcceptedDiscovery`) — this package only starts the scan and reports job
progress. `LIST_DISCOVERY`/`ACCEPT_DISCOVERY` themselves need no wrapper: `SpaghettiClient`
already exposes them directly with nothing this package would add.

## Honest scope gaps

- **No typed command argument transport.** See `command-runner.ts` above —
  `requiresArguments` is a refusal, not a workaround.
- **`classifyWireError`'s `PROTOCOL_ERROR`/status mapping is shared, not
  Module-command-specific.** The same `UNAUTHORIZED`/`RESOURCE_EXHAUSTED`/`TIMEOUT`
  → outcome mapping is reused for both command execution and discovery scan, since
  both are the same envelope-level `ProtocolStatus` vocabulary
  (`firmware/backbone/subsys/communication/protocol_status.c`), not two different ones.
