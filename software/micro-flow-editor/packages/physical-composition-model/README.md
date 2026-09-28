# @spaghettilab/physical-composition-model

Domain model for the Physical Composition layer (S050): Backbone, Power source,
Function Bay, Connector, external device, and Module — plus validation and Module-
discovery integration built strictly from what the Core actually declares in its
`TopologyIndex` (`@spaghettilab/catalog-model`, S041).

## Node data (`entities.ts`)

Node payloads for a `"physical-composition"` `GraphState` (`@spaghettilab/domain`,
S013/S014): `BackboneNodeData`, `PowerSourceNodeData`, `ConnectorNodeData`,
`ExternalDeviceNodeData`, `ModuleNodeData` — a discriminated union on `kind`. Cabling
between them is expressed with the graph's own edges, not a duplicated back-reference
field, so nothing here can drift out of sync with the actual wiring.

Bay/Port/Rail are never authoring entities — a `ModuleNodeData` references their exact
wire-declared numeric IDs directly. None of these types carry a label or grouping
field: per the task's point 1 ("associa label e grouping senza alterare identità
firmware"), that lives in `AuthoringMetadata.comment`/`AuthoringMetadata.groupId`,
which `canonicalProjectHash` already excludes — relabeling/regrouping structurally
cannot change a Config hash, with no extra code needed to guarantee it.

`ConnectorNodeData` is deliberately separate from a Bay (point 5): its `pinout` and
whatever external device is wired to it can change without touching a Module's
`electricalMode`, which lives only on `ModuleNodeData`.

## Power (`power.ts`)

`RailEntry.assurance`/`FunctionBayEntry.admission` are raw Core-reported numbers in
`catalog-model` (S041 deliberately never coerces them). This file resolves what those
numbers mean — `RailAssurance` (`UNMANAGED`/`SWITCHED`/`SWITCHED_AND_MEASURED`) and
`PowerAdmission` (`NOT_REQUIRED`/`UNVERIFIED`/`ENFORCED`) — sourced directly from the
firmware's own definition, `firmware/backbone/include/spaghetti/power.h`
(`enum spaghetti_power_assurance`, `enum spaghetti_power_admission_state`), not
guessed. `catalog-model`'s pass-through contract is untouched; this is a local
interpretation at the point of use. `requiresPowerAcknowledgement()` is true exactly
for `UNMANAGED` — "passive power" in the task/architecture docs.

## Validation (`validate-composition.ts`)

`validateComposition()` checks every Module node in a Physical Composition graph
against the topology (Port/Bay/Rail existence) and against each other (endpoint
collision, `moduleKey` conflict), collecting every problem rather than stopping at the
first — matching `@spaghettilab/domain`'s `validateProjectV1` precedent. A rail
requiring acknowledgement (`requiresPowerAcknowledgement`) fails validation unless its
Module's node ID is in the caller-supplied `acknowledgedModuleNodeIds` set.

Transport (I2C vs SPI vs 1-Wire) has **no wire field at the generic Module Driver level** —
`catalog-model`'s `ModuleDriverEntry` is only `{typeId, commandCount}`. `TransportOf` is
a caller-supplied classifier, the same "caller-supplied, not invented" pattern
`@spaghettilab/editor-model`'s `checkHandleCompatibility` uses for
`installedCapabilities`. Omit it entirely and transport mismatch simply isn't checked —
never guessed.

Transport **does** exist on the wire one level down, at the Device Profile level:
`protocol-sdk`'s `GET_DEVICE_PROFILE` (op 23) response carries a real `transport: number`
and `requiredCapabilities: number` (firmware phase 325, "Profili dispositivo
dichiarativi" — a single generic `declarative-device` driver executes a bounded
acquisition plan per profile, so the firmware never needs to know a specific sensor's
registers; profiles are authored/installed independently, see S061-S063). `catalog-model`
does not yet index that field into `ProfileIndex` (`{profileId, version, hash}` only
today) — this package's `TransportOf` stays caller-supplied until that indexing exists,
not because the data is unavailable, but because nothing upstream surfaces it yet.

## Discovery integration (`discovery.ts`)

`previewDiscoveryAccept()` builds a proposed `ModuleNodeData` from a
`DiscoveryCandidate` (`@spaghettilab/protocol-sdk`) and a `DiscoveryAcceptChoice`,
without ever calling `ACCEPT_DISCOVERY` or touching a graph.
`previewDiscoveryAcceptDiff()` runs `validateComposition()` with that proposed Module
added to a snapshot of the existing graph, returning the exact diff of what would
break — the explicit diff the task requires before applying anything.
`moduleFromAcceptedDiscovery()` only fills in `moduleKey` once the real
`AcceptDiscoveryResponse.moduleKey` is known; nothing in this package fabricates a key
ahead of that round trip. Applying the result is left to the caller (e.g.
`@spaghettilab/react-flow-adapter`'s `addGraphNodeCommand`, reused as-is — no new
`ProjectCommand` subtype was needed), which is what makes acceptance an explicit,
undo-able action rather than an automatic one. Rejecting a candidate has no side
effect to model: it is simply never accepted, so there is no function for it.

## Honest scope gaps

- **No wire Module CRUD operation exists.** `protocol-sdk`'s operations only expose
  `MODULE_COMMAND` (invoke an existing Module by key) and `ACCEPT_DISCOVERY` (create
  one via discovery, `key` only). Every field this package models on `ModuleNodeData`
  — driver/profile, Port, Bay, rail, endpoint, electrical mode, properties — is
  authoring-side state today; it becomes real hardware configuration only once a later
  Config Compiler task compiles it, not through a live device write from this package.
- **`ACCEPT_DISCOVERY` has no Bay/rail field.** Its wire request
  (`AcceptDiscoveryRequest`) is `{candidateId, key, generation}` only.
  `DiscoveryAcceptChoice.bayId`/`railId` are authoring-only choices with no wire
  counterpart, despite the task text saying "accettazione con key/Bay/rail scelta."
- **No "authority" field exists on `DiscoveryCandidate`** — only `confidence`. This
  package does not model authority anywhere; if the UI needs it, it has no backing wire
  source yet.
- **Port has no attributes beyond a numeric ID.** Anything Port-related beyond that ID
  (name, electrical description) is out of scope by construction — there is nothing to
  read it from.
- **Transport (I2C/SPI/1-Wire) is not on the wire at the generic Module Driver level.** It does
  exist at the Device Profile level (`GET_DEVICE_PROFILE`'s `transport` field) — see
  `validate-composition.ts`'s `TransportOf` note above for the distinction and why
  `catalog-model` not yet indexing it is the actual current gap, not the wire itself.
  Instance 1-Wire ROM is `ModuleEndpoint.w1Rom` (8-byte hex, firmware `w1_rom`), never
  a field of the shared Device Profile.
