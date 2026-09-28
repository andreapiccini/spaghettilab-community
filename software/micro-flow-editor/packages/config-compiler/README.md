# @spaghettilab/config-compiler

Compiles one Core's validated Physical Composition (S050) + Device Processing (S071)
graphs into `struct spaghetti_config`'s canonical shape (S072) — deterministic key
assignment, normalized arrays, sorted property sets, budget checks with real node
ownership attribution, canonical debug JSON, and the exact wire-V3 CBOR bytes plus a
reproducible SHA-256 hash.

Every field, map key, and encoding rule is read directly from
`firmware/backbone/subsys/config/config_cbor.c`'s `spaghetti_config_encode_cbor` and
`firmware/backbone/subsys/config/config.c` — **not** from the stale comment that used to
live in `protocol-sdk`'s `GET_CONFIG` doc ("Config CDDL only goes up to v3... decoding
not yet specified"). Phase 330 shipped a complete, real V2 wire codec; the on-wire
version integer is `4` (`SPAGHETTI_CONFIG_CBOR_WIRE_VERSION_V3`), distinct from the
in-memory `SPAGHETTI_CONFIG_VERSION` (`5`) — `CONFIG_WIRE_VERSION` here is always the
wire value.

## Key assignment (`compile.ts`)

Firmware itself never assigns or renumbers keys — `config.c` only checks uniqueness
*within* each array (Module/Rule/Block each have their own independent key namespace;
Schedules have no key of their own, only `source_key` referencing a Module). This
compiler assigns keys deterministically: sort authoring node IDs ascending, number
1..N. Re-arranging the same set of nodes in a different authoring order, or moving them
on canvas, never changes the sorted ID list — so it never changes the assigned keys,
the compiled Config, or its hash (S072 § Verifiche). Output array order is likewise
sorted by assigned key (or, for edges, by `(sourceKind, sourceKey, sourcePortOrField,
targetKey, targetInput)`), never by the authoring graph's own node/edge insertion
order.

## Properties (`properties.ts`)

Firmware's `properties` map is keyed by real numeric `field_id`
(`encode_properties`/`decode_properties`, `config_cbor.c`). This package's node data
(`ModuleNodeData.properties`, `BlockNodeData.properties`, `RuleNodeData.properties`)
has no schema behind it yet — same gap `device-processing-graph-model` already
documents for ports — so `toPropertySet()` requires every property key to already be
the numeric field ID as a string, rejecting anything else explicitly. `PropertyValue`
excludes plain JS `number` on purpose: firmware's CBOR encoder rejects float values
everywhere on the Config wire, so only `bigint`/`boolean`/`string` are accepted, never
a value that could accidentally serialize as a float.

## Compilation (`compile.ts`)

- **Schedule/Event-source**: a `ScheduleNodeData` compiles to a `CanonicalSchedule`
  (`source_key` resolved from the referenced Module's assigned key). An
  `EventSourceNodeData` compiles to **nothing** — `spaghetti_runtime_schedule_config`
  is specifically periodic; async-publish Modules have no Schedule-shaped wire
  representation at all, so this compiler doesn't invent one.
- **Rule command target / source reference**: `RuleNodeData.commandTarget`
  (`{moduleNodeId, commandId}`) and `.sourceReference` (`{moduleNodeId, fieldId}`) are
  each embedded as two property fields on the compiled Rule itself, matching how
  firmware embeds `spaghetti_rule_action` (and the `on_record` field-match dispatch
  that feeds a Rule) in the rule's own behavior rather than a separate struct or an
  edge — which field IDs depends on the Rule type's schema, so
  `resolveRuleActionFieldIds`/`resolveRuleSourceFieldIds` are caller-supplied, same
  "caller-supplied, not invented" pattern used throughout this codebase for schema
  data that isn't on the wire yet.
- **Edges**: `source_port_or_field`/`target_input` are numeric firmware IDs; this
  compiler tries a caller-supplied resolver first, then falls back to parsing the
  edge's `sourceHandle`/`targetHandle` string as a literal integer (the S071
  `GraphEdge` extension) — an edge with neither fails explicitly rather than guessing.
  `target_key` on the wire is always a Block key — an edge whose target is a Rule
  never compiles (`device-processing-graph-model`'s own validator already rejects
  this shape before it reaches the compiler).
- This function assumes `input.processingGraph` already passed
  `validateDeviceProcessingGraph` (S071) — it does not re-check cycles, dangling
  references, or duplicates itself; it focuses on compilation and budget checks.

## Budget ownership (S072 § Verifiche: "un grafo che supera un budget dichiarato
fallisce con l'owner indicato, non con un errore generico")

Firmware's own `spaghetti_config_validate` **cannot** do this for graph-level
(Block/Edge) failures: it forwards `spaghetti_processing_validate_graph`'s return code
with `index` hardcoded to `0` (read directly in `config.c`'s
`spaghetti_config_validate`) — a real, confirmed firmware limitation, not a guess. This
compiler re-derives ownership locally instead of relying on a remote `VALIDATE_CONFIG`
response to say which node is at fault:

- **Cost budget** (`SPAGHETTI_PROCESSING_COST_BUDGET`, Kconfig-tunable): iterates Blocks
  in assigned-key order accumulating `resolveBlockCost`, and attributes the failure to
  the first Block whose running total exceeds the cap — deterministic, not arbitrary.
- **Fan-out** (`SPAGHETTI_PROCESSING_FANOUT_MAX`, hardcoded to 4 in firmware today, still
  exposed as caller-supplied since this compiler cannot query a live build constant):
  attributed to the source node with too many outgoing edges.
- **Depth** (`SPAGHETTI_PROCESSING_DEPTH_MAX`, Kconfig-tunable): longest-path length from
  every node with no incoming edge, attributed to whichever node sits past the cap.
- **Capacity** (`SPAGHETTI_MAX_MODULES`/`..._SCHEDULES`/`..._RULES`/
  `..._PROCESSING_BLOCKS`/`..._PROCESSING_EDGES`, Kconfig-tunable): attributed to the
  first node whose assigned key would exceed the cap.

## Wire CBOR + hash (`config-cbor.ts`, `hash.ts`)

`encodeConfigCbor()` produces byte-exact wire-V3 CBOR; `canonicalConfigJson()` is a
debug-only JSON rendering (`bigint` properties as `"123n"` strings, since
`JSON.stringify` cannot serialize `bigint`); `sha256()` mirrors
`compute_config_hash`/`compute_sha256` (`config.c`) — SHA-256 over exactly the encoded
bytes, via Web Crypto `SubtleCrypto`, the same pattern
`@spaghettilab/device-profile-install` already uses for Device Profile hashes.

## Honest scope gaps

- **No CBOR decoder.** This package only ever produces bytes; the reverse direction is
  S073's job (decompiler).
- **No state/workspace RAM arena simulation.** Firmware tracks `state_size`/`state_align`
  per Block against a fixed arena (`CONFIG_SPAGHETTI_MAX_PROCESSING_CONTEXTS`) — this
  compiler does not simulate that packing; only the aggregate cost/fan-out/depth/count
  budgets above are enforced.
- **`mqtt`/`connectivity`/`energy` are not derived from any graph.** They are Core-level
  connectivity settings, a separate concern this compiler accepts as caller-supplied
  input rather than invents from graph content.
- **Property field-id/name resolution and Rule action field-id resolution are both
  caller-supplied** — no Block/Rule schema exists on the wire yet to resolve them from
  automatically.
