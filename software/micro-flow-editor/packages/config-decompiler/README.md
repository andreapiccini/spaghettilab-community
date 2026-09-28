# @spaghettilab/config-decompiler

The reverse direction of `@spaghettilab/config-compiler` (S072): Config CBOR → canonical
Config → authoring graph, plus a full local dry-run (S073).

## Decode (`decode-config-cbor.ts`)

`decodeConfigCbor()` is the exact inverse of `config-compiler`'s `encodeConfigCbor()` —
same map keys, same per-record shapes, read from the same source
(`firmware/backbone/subsys/config/config_cbor.c`'s `decode_wire_v3`). This is the reverse
direction S072 explicitly left undone. While building it, `@spaghettilab/protocol-sdk`'s
`CborReader` gained support for CBOR simple value 22 (`0xF6`, the wire `null`) — needed
to decode an unspecified `bay_id`/`power_rail_id` (`config_cbor.c`'s
`encode_optional_u8`) — the shared decoder previously only handled `bool`/`array`/`map`/
etc. simple values, never `null`.

## Decompile (`decompile.ts`)

`decompileConfig()` turns a `CanonicalConfig` into a `{physicalGraph, processingGraph}`
pair. Synthesized node IDs (`module-00001`, `block-00002`, ...) are zero-padded so
lexicographic sort — what `compileConfig`'s deterministic key assignment relies on —
matches numeric key order regardless of how many entries exist; without the padding, a
decompile→recompile cycle could silently reassign different keys once a category passed
9 entries (`"block-10"` sorts before `"block-2"`).

**Never invents authoring metadata it cannot recover** (S073 point 1): `AuthoringMetadata`
(position, viewport, selection, label, grouping) doesn't exist in Config at all and this
function never touches that store. Two fields *do* need special handling because they're
structurally required on `ModuleNodeData`/`RuleNodeData` but genuinely absent from Config:

- **`electricalMode`** is not part of `struct spaghetti_module_config` — it never
  survives compilation. Decompiled Modules get `"input-output"` (the least presumptive
  default) with an explicit `"warning"`-severity issue attached, never silently.
- **`profileId`** is not recoverable either — the generic `"declarative-device"` driver's
  `typeId` doesn't distinguish which Device Profile is installed. Left `undefined`
  (already optional), with a warning noting the loss.
- A Module with no recoverable `bay_id`/`power_rail_id` (both required on
  `ModuleNodeData`) is not represented at all — reported as an `"error"`-severity issue
  instead of fabricating a Bay/rail that was never real.

**Schedule vs. Event-source is inferred, not guessed beyond what's knowable**: Config's
`edges[]` doesn't distinguish "a Schedule-triggered Module" from "an Event-source
Module" — both compile to the same `sourceKind: MODULE, sourceKey`. A Module key used as
an edge source with no matching `schedules[]` entry is inferred to be an Event-source
(the only other possibility this package's own compiler produces); this is a real
inference from the only signal available, not an invented default.

## Dry-run (`dry-run.ts`)

`dryRunConfig()` runs `compileConfig()` and, independently, checks that every referenced
Device Profile / Block-Rule type is actually available (`availableProfileIds`/
`availableBlockRuleTypeIds`, both caller-supplied — this package has no installed-profile
list of its own, that's S062/S063's job) — "profilo o pack assente" (S073 point 2).
Every issue found is returned, error or warning, never stopping at the first; `compiled`
is present only when no `"error"`-severity issue exists — a warnings-only dry-run still
produces a usable Config, matching `S070-processing-graph-editor/backend-behavior.md`'s
"warnings don't block Send to Deploy, errors do."

## Honest scope gaps

- **Rule `commandTarget`/`sourceReference` reconstruction is caller-supplied**, mirroring
  `config-compiler`'s own `resolveRuleActionFieldIds`/`resolveRuleSourceFieldIds` — without
  it, a decompiled Rule keeps its action/source data as raw numeric property fields
  instead of the structured shape, flagged with a warning, never silently dropped.
  Property field names are never resolved back to catalog-driven property names either —
  same "no Block/Rule schema on the wire yet" gap `config-compiler` already documents.
- **Synthesized node IDs never match an original authoring session's UUIDs.** Config
  carries no authoring identity, only integer keys — a graph needs some ID to exist, and
  a deterministic one derived from the only real identity Config has is the honest
  choice here, not a guess at what the original was.
