# @spaghettilab/device-processing-graph-model

Domain model and validation for the Device Processing layer (S071): Schedule, Event
source, Block, Rule — the local, bounded behavior of one Core, authored as a graph and
rejected before it can ever compile into an invalid Config.

Every node type is grounded in the real Config structs
(`firmware/backbone/include/spaghetti/config.h`, `block_driver.h`, `rule_driver.h`), read
directly rather than inferred from the task prose or the UX's node taxonomy alone —
where the UX's 5-category taxonomy (Trigger/Read/Processing/Logic/Output) is richer than
what firmware actually has, this package follows firmware (see Honest scope notes
below).

> **Correction (2026-08-13, made while building S072's Config compiler):** the first
> revision let an edge target a Rule node. Building the compiler against
> `struct spaghetti_edge_config` confirmed `target_key` is always a Block key on the
> wire — a Rule has no input port to receive an edge on at all; it reads its source the
> same way it declares its action, by field reference in its own `properties`
> (`on_record` dispatch). `RuleNodeData` gained `sourceReference` (mirroring
> `commandTarget`'s shape) and the validator now rejects any edge whose target is a
> Rule (`RULE_AS_EDGE_TARGET`).

## Node data (`entities.ts`)

- `ScheduleNodeData` / `EventSourceNodeData` mirror `struct
  spaghetti_runtime_schedule_config { enabled, source_key, period_ms }` — firmware's real
  "Schedule" is nothing more than a periodic-sampling toggle bound directly to one
  Module, with no cron/calendar concept anywhere. Both node kinds carry `moduleNodeId`
  directly, collapsing the UX's separate "Trigger" and "Read" categories into one node:
  firmware has no separate read-node or edge between them, so modeling two connected
  node kinds would invent a wire firmware doesn't have.
- `BlockNodeData` mirrors `struct spaghetti_block_config { key, type_id, min_version,
  exact_version, properties }`.
- `RuleNodeData` mirrors `struct spaghetti_rule_config { key, type_id, properties }`
  plus `struct spaghetti_rule_action { target_key, command }` — a Rule's command target
  is a field on the rule itself (`commandTarget?: {moduleNodeId, commandId}`), not a
  separate graph node, matching how firmware embeds the action in the rule's own
  behavior.

`moduleNodeId` fields are cross-graph references: a Module lives in the
`"physical-composition"` `Graph` (S050), a different instance from the
`"device-processing"` graph these nodes belong to, so it can never be a same-layer
`GraphEdge` — it's validated against a caller-supplied set of known Module node IDs.

## Ports (`ports.ts`)

Block/Rule port data (types, units, required-ness) is not on the wire today —
`GET_CATALOG` only returns `{typeId, commandCount}`, the same gap already documented in
`@spaghettilab/catalog-model`'s README for Module Drivers. `ResolveProcessingNodeDescriptor`
is therefore caller-supplied, the same pattern `@spaghettilab/editor-model`'s
`checkHandleCompatibility` uses for `installedCapabilities`: a node with no resolvable
descriptor has its edges skip type/unit checking entirely rather than being guessed
compatible.

## Validation (`validate-processing-graph.ts`)

`validateDeviceProcessingGraph()` collects every problem instead of stopping at the
first (matching `@spaghettilab/domain`'s `validateProjectV1` precedent):

- **Cycles** — DFS with an explicit color map, reporting the exact closing edge and the
  full node path on the cycle, not just "a cycle exists somewhere" (S071 § Verifiche).
- **Dangling Module references** — every `moduleNodeId` (Schedule/Event-source binding,
  Rule command target) checked against a caller-supplied set of known Module node IDs.
- **Duplicate triggers** — two Schedule/Event-source nodes bound to the same Module.
- **Type/unit mismatch** — delegated entirely to `@spaghettilab/editor-model`'s
  `checkHandleCompatibility`, never reimplemented; its `UNIT_MISMATCH` remediation
  ("add an explicit transformation instead of connecting directly") is exactly S071's
  "inserimenti di conversione devono essere espliciti."
- **Output nodes as edge sources** — a Rule is *always* rejected as an edge source,
  unconditionally: `spaghetti_rule_driver` declares no ports at all, so this holds
  regardless of any injected descriptor. A Block with zero declared output ports (e.g.
  the catalogued `publish_field`) is rejected the same way once a descriptor is
  supplied — there is no separate "Output node" kind in this package; it's a structural
  property of the resolved port descriptor, matching the UX's own rule ("un nodo Uscita
  non può mai essere sorgente di un collegamento") without hardcoding a `blockTypeId`.
- **Required input** — an input port whose descriptor sets `required` must have an
  incoming edge before this validator passes.
- **Fan-out** — an optional caller-supplied cap (Kconfig-tunable in firmware, not wire
  data, so never assumed here).
- **Cross-Core edges** — no code here at all. Each Core gets its own `Graph` instance
  (`project.deviceGraphs[i]`), so a foreign-Core node ID is structurally impossible to
  reference: `Graph.addEdge` (`@spaghettilab/domain`, S013) already rejects it as a
  dangling endpoint before this validator ever runs — proven directly in this package's
  tests.

## Domain change made for this task

`GraphEdge` (`@spaghettilab/domain`'s `graph.ts`) gained optional `sourceHandle`/
`targetHandle` fields, mirroring `struct spaghetti_edge_config`'s real
`source_port_or_field`/`target_input` fields — the previous `{layer, id, source,
target}` shape had no way to disambiguate which of a multi-port Block's several
typed ports one edge connects to. Additive and backward-compatible: every existing
layer that only ever wires whole nodes together (Physical Composition, System
Automation) simply never sets them.

## Honest scope notes

- Block/Rule port types/units/required-ness are caller-supplied, not fetched from a
  live Core — see `ports.ts`.
- No Block/Rule catalog package exists yet to supply real `ResolveProcessingNodeDescriptor`
  implementations from — a future task (once Block/Rule schema data exists on the wire)
  would build one, the same way `@spaghettilab/catalog-model` normalizes Module Driver
  data today.
- Fan-out/depth/budget caps are Kconfig-tunable in firmware (`CONFIG_SPAGHETTI_MAX_*`)
  and not enforced here beyond an optional caller-supplied `maxFanOut` — the real budget
  accounting (per-record cost, state/workspace size) is S072's job (Config Compiler), not
  this package's.
