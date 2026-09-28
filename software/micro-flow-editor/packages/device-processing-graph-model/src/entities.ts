/**
 * Node payloads for a `"device-processing"` `GraphState`
 * (`@spaghettilab/domain`, S013/S014, one graph per Core in
 * `project.deviceGraphs`). Every field is grounded in the real Config
 * structs (`firmware/backbone/include/spaghetti/config.h`), not invented from
 * task prose — where firmware's structure is narrower than the UX's 5-node
 * taxonomy (Trigger/Read/Processing/Logic/Output), this package follows the
 * struct.
 *
 * `moduleNodeId` fields are cross-graph references — a Module lives in the
 * `"physical-composition"` layer (S050), a different `Graph` instance, so
 * this can never be a same-layer `GraphEdge`; it's a plain string reference
 * to that graph's `GraphNode.id`, validated against a caller-supplied set of
 * known Module node IDs by `validateDeviceProcessingGraph` (never against a
 * firmware-assigned Module key, which usually doesn't exist yet at authoring
 * time — `ModuleNodeData.moduleKey` is optional/undefined until Config
 * compiles, S072).
 */

/**
 * Mirrors `struct spaghetti_runtime_schedule_config { enabled, source_key,
 * period_ms }` (`config.h`) — the real "Schedule" is nothing more than a
 * periodic-sampling toggle bound directly to one Module. There is no
 * cron/calendar concept anywhere in firmware; this package does not invent
 * one. This node simultaneously represents the UX's "Trigger" (Schedule) and
 * "Read" (Module read) categories — firmware has no separate read-node/edge
 * between them, so modeling two node kinds connected by an edge would invent
 * a firmware-unbacked wire.
 */
export type ScheduleNodeData = {
  readonly kind: "schedule";
  readonly moduleNodeId: string;
  readonly periodMs: number;
  readonly enabled: boolean;
};

/**
 * A Module that publishes records asynchronously (`spaghetti_module_manager_start_events`)
 * rather than being sampled on a period — the UX's "Event source" Trigger.
 * Same collapsing of Trigger+Read into one node as `ScheduleNodeData`, same
 * reason.
 */
export type EventSourceNodeData = {
  readonly kind: "event-source";
  readonly moduleNodeId: string;
  /** Catalog row this trigger was placed from (`appblocks.interrupt`, …). */
  readonly catalogEntryId?: string;
  readonly properties?: Readonly<Record<string, unknown>>;
};

/**
 * Mirrors `struct spaghetti_block_config { key, type_id, min_version,
 * exact_version, properties }` (`config.h`). A Block with zero declared
 * output ports (e.g. the catalogued `publish_field`) is structurally a sink
 * — the UX's "Output → Publish" category isn't a separate node kind here,
 * it's a Block whose resolved port descriptor has no outputs (checked by
 * `validate-processing-graph.ts`, not hardcoded to a specific `blockTypeId`).
 */
export type BlockNodeData = {
  readonly kind: "block";
  readonly blockTypeId: string;
  readonly minVersion?: number;
  readonly exactVersion?: number;
  readonly properties: Readonly<Record<string, unknown>>;
  /** Catalog row this block was placed from, when it is not a firmware type_id alone. */
  readonly catalogEntryId?: string;
};

/**
 * Mirrors `struct spaghetti_rule_config { key, type_id, properties }` plus
 * `struct spaghetti_rule_action { target_key, command }` (`rule_driver.h`) —
 * a Rule's command target is embedded on the rule itself, exactly like
 * firmware embeds the action in the rule's own behavior, not as a separate
 * graph node. `spaghetti_rule_driver` declares no ports at all
 * (`rule_driver.h`): a Rule can never be a valid edge **source**,
 * structurally, regardless of any injected descriptor (S071's "Un nodo
 * Uscita non può mai essere sorgente di un collegamento" applies to every
 * Rule, unconditionally) — and, confirmed while building S072's compiler
 * against `struct spaghetti_edge_config`, a Rule can never be a valid edge
 * **target** either: `target_key` on the wire is always a Block key. A Rule
 * consumes its input the same way it declares its action — by field
 * reference embedded in its own `properties` (`on_record` dispatch matches a
 * record by field ID, not by a declared input port) — hence
 * `sourceReference` below, mirroring `commandTarget`'s shape for the other
 * direction. Earlier revisions of this package and of S072's compiler
 * allowed edges to target a Rule; that was wrong and has been corrected.
 */
export type RuleNodeData = {
  readonly kind: "rule";
  readonly ruleTypeId: string;
  readonly properties: Readonly<Record<string, unknown>>;
  readonly commandTarget?: {
    readonly moduleNodeId: string;
    readonly commandId: number;
  };
  /** Which Module's record field this Rule reads — a Rule has no input port/edge, matching the real `on_record` field-match dispatch. Block-sourced Rule inputs are not modeled: no confirmed example of that shape exists yet (see this package's README). */
  readonly sourceReference?: {
    readonly moduleNodeId: string;
    readonly fieldId: number;
  };
};

export type DeviceProcessingNodeData = ScheduleNodeData | EventSourceNodeData | BlockNodeData | RuleNodeData;

export function isBlockNodeData(data: DeviceProcessingNodeData): data is BlockNodeData {
  return data.kind === "block";
}

export function isRuleNodeData(data: DeviceProcessingNodeData): data is RuleNodeData {
  return data.kind === "rule";
}

export function moduleReferenceOf(data: DeviceProcessingNodeData): string | undefined {
  if (data.kind === "schedule" || data.kind === "event-source") {
    return data.moduleNodeId.trim() === "" ? undefined : data.moduleNodeId;
  }
  return undefined;
}
