# @spaghettilab/telemetry-buffer

Turns raw `EventStream` (S024) traffic from one or more Cores into queryable, bounded,
per-(Core, schema) telemetry buffers with explicit provenance and gaps (S091).

## The real gap this package works around

`RecordEventPayload` (`@spaghettilab/protocol-sdk`'s `EventType.RECORD`) is a
**notification only** — `{sourceKey, sequence, schemaId, schemaVersion}`, no field
values at all. The real record with actual field values
(`struct spaghetti_record`, `firmware/backbone/include/spaghetti/schema.h`) is delivered
out-of-band per consumer via a bounded firmware-side ring with independent cursors
(`spaghetti_record_delivery_peek`/`ack`,
`firmware/backbone/include/spaghetti/record_delivery.h`, one ring for MQTT and one for
BLE). There is no `GET_RECORD`-style Protocol V1 operation in `protocol-sdk` today,
and no MQTT-payload CBOR decoder either — checked directly, not assumed. This package
therefore cannot decode field values itself: every `ResolveFields` call is
caller-supplied, the same pattern used everywhere else in this codebase for data
that isn't really on the wire yet.

## Buffers (`buffer-store.ts`)

`TelemetryBufferStore` keys every buffer by the exact `(coreId, schemaId)` pair —
"record di due Core/schema distinti non si contaminano nello stesso buffer" (S091 §
Verifiche) holds structurally, not by convention. Overflow drops the oldest entry
first, mirroring `spaghetti_record_delivery_push`'s own ring policy rather than
inventing a different retention strategy. Every entry carries a `bootEpoch` — a
counter that increments each time `observeBootId()` (fed from `STATUS` events) sees
a changed `boot_id`. Two records straddling a reboot always have different
`bootEpoch` values, so a consumer never has to cross-reference a separate log to know
they're not one continuous series ("non collega serie incompatibili in silenzio").

## Subscription (`subscription-manager.ts`)

`subscribeCore()` drains one Core's `EventStream` into a shared
`TelemetryBufferStore`, tagged with a caller-assigned `coreId`. `STATUS` events feed
`observeBootId` (the real, structured boot-ID gap detection); `EventStream`'s own
`gap`/`boot_id_changed` event is deliberately *not* also logged — it would double the
same discontinuity `observeBootId` already recorded from the real `bootId` bigint
comparison. Only `gap`/`sequence_discontinuity` (no other source for it) is passed
through.

For each `record` notification, `resolveFields()` is called; returning `undefined`
means "unknown schema" (S091 point 2) — the record is still retained
(`kind: "unknown-schema"`, `needsCatalogRefresh: true`), with only `rawPayload` (if
the caller had bytes to preserve) surviving, never a guessed field interpretation.

## Honest scope gaps

Managed persistence is optional through the public `TelemetrySink` V1 boundary. The
local buffer is written first; sink failures are reported explicitly and cannot make
local telemetry unavailable. Durable retention, tenant isolation and historical
queries are deliberately outside this Community package.

- **No real field-value decoding.** `ResolveFields` is entirely caller-supplied — see
  above. This package's own tests use trivial fakes, not real firmware bytes.
- **No `unit` enrichment.** S091 point 3 asks for provenance/unit/boot-ID/gap in an
  export; this package has no schema-field catalog to source a unit string from —
  `TelemetryContext` exists for a caller to attach whatever domain enrichment
  (Module/Profile/Block) it already has, but unit specifically needs a real schema
  descriptor source that doesn't exist yet.
- **No transport wiring.** This package only consumes an already-constructed
  `EventStream`; opening one per Core (reconnect policy, `SpaghettiClient`
  construction) is `@spaghettilab/core-session`'s job (S030), not duplicated here.
