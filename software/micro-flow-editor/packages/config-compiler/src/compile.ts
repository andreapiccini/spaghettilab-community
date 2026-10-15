import { domainError, err, ok, type DomainError, type GraphNode, type GraphState, type Result } from "@spaghettilab/domain";
import { isModuleNodeData, type ModuleNodeData } from "@spaghettilab/physical-composition-model";
import { isBlockNodeData, isRuleNodeData, moduleReferenceOf, type DeviceProcessingNodeData } from "@spaghettilab/device-processing-graph-model";
import {
  CONFIG_WIRE_VERSION,
  EdgeSourceKind,
  type CanonicalConfig,
  type CanonicalEdge,
  type CanonicalEnergy,
  type CanonicalMqtt,
} from "./canonical-config.js";
import { ConfigCompilerErrorCode } from "./errors.js";
import { toPropertySet } from "./properties.js";

type PhysicalNode = GraphNode<"physical-composition", string, unknown>;
type ProcessingNode = GraphNode<"device-processing", string, DeviceProcessingNodeData>;
type ProcessingEdge = { readonly id: string; readonly source: string; readonly target: string; readonly sourceHandle?: string; readonly targetHandle?: string };

export type CompileConfigInput = {
  /** This Core's Physical Composition graph — the only source of Module identity/Port/Bay/rail (S050). */
  readonly physicalGraph: GraphState<"physical-composition">;
  /** This Core's Device Processing graph — assumed already validated by `validateDeviceProcessingGraph` (S071); this function does not re-check cycles/dangling refs/duplicates itself. */
  readonly processingGraph: GraphState<"device-processing">;
  /** Not derived from any graph — Core-level connectivity settings, a separate concern this compiler accepts as given rather than invents. */
  readonly mqtt: CanonicalMqtt;
  readonly connectivity: number;
  readonly energy: CanonicalEnergy;
};

export type ResolveEdgeEndpoint = (params: {
  readonly node: ProcessingNode;
  readonly handle: string | undefined;
}) => number | undefined;

export type CompileConfigOptions = {
  readonly resolveSourcePortOrField?: ResolveEdgeEndpoint;
  readonly resolveTargetInput?: ResolveEdgeEndpoint;
  /** `struct spaghetti_block_driver.max_cost_per_record` — not on the wire (see `device-processing-graph-model`'s port gap), caller-supplied. Missing/undefined treated as 0 cost. */
  readonly resolveBlockCost?: (node: ProcessingNode) => number | undefined;
  /** A Rule's `target_key`/`command` action is embedded as two property fields inside its own `properties` (S071's `RuleNodeData.commandTarget`, firmware's `spaghetti_rule_action`) — which two field IDs depends on the Rule type's schema, not on the wire yet. */
  readonly resolveRuleActionFieldIds?: (ruleTypeId: string) => { readonly targetKeyFieldId: number; readonly commandIdFieldId: number } | undefined;
  /** The other direction of the same gap: a Rule's `sourceReference` (which Module/field it reads — `on_record` dispatch, no input port) is embedded as two more property fields, again schema-dependent. */
  readonly resolveRuleSourceFieldIds?: (ruleTypeId: string) => { readonly sourceKeyFieldId: number; readonly sourceFieldIdFieldId: number } | undefined;
  /** `SPAGHETTI_PROCESSING_COST_BUDGET` — Kconfig-tunable (256/512/1024 by resource profile), not wire data. */
  readonly maxTotalCost?: number;
  /** `SPAGHETTI_PROCESSING_FANOUT_MAX` — hardcoded to 4 in firmware today, still exposed here as caller-supplied rather than hardcoded, since it's a build-time constant this compiler cannot query live. */
  readonly maxFanOut?: number;
  /** `SPAGHETTI_PROCESSING_DEPTH_MAX` — Kconfig-tunable (8/16/32 by resource profile). */
  readonly maxDepth?: number;
  readonly maxModules?: number;
  readonly maxSchedules?: number;
  readonly maxRules?: number;
  readonly maxBlocks?: number;
  readonly maxEdges?: number;
};

function failure(code: string, path: string[], target: string, remediation: string): DomainError {
  return domainError({ code, path: ["config-compiler", ...path], target, remediation });
}

/** Deterministic key assignment: sort by authoring node ID, assign 1..N. Stable regardless of the order nodes were added or how they're positioned on canvas (S072 § Verifiche: "la stessa semantica con ordine o coordinate diverse produce lo stesso Config e lo stesso hash") — re-sorting the same set of IDs always yields the same keys. */
function assignKeys(nodeIds: readonly string[]): Map<string, number> {
  const sorted = [...nodeIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return new Map(sorted.map((id, index) => [id, index + 1]));
}

function longestDepth(nodeIds: readonly string[], edges: readonly ProcessingEdge[]): Map<string, number> {
  const outgoing = new Map<string, string[]>();
  const hasIncoming = new Set<string>();
  for (const edge of edges) {
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge.target);
    outgoing.set(edge.source, list);
    hasIncoming.add(edge.target);
  }
  const depth = new Map<string, number>();
  function visit(nodeId: string): number {
    const cached = depth.get(nodeId);
    if (cached !== undefined) return cached;
    let max = 0;
    for (const next of outgoing.get(nodeId) ?? []) {
      max = Math.max(max, 1 + visit(next));
    }
    depth.set(nodeId, max);
    return max;
  }
  for (const id of nodeIds) if (!hasIncoming.has(id)) visit(id);
  for (const id of nodeIds) if (!depth.has(id)) visit(id);
  return depth;
}

/**
 * Compiles one Core's validated Physical Composition + Device Processing
 * graphs into `struct spaghetti_config`'s canonical shape — deterministic
 * key assignment, normalized arrays, sorted property sets, and budget
 * checks with a real node "owner" attributed to each failure (S072 §
 * Verifiche: "un grafo che supera un budget dichiarato fallisce con
 * l'owner indicato, non con un errore generico"). Firmware itself cannot
 * do this for graph-level (Block/Edge) failures — its own validator
 * reports `index: 0` for those (see this package's README) — so this
 * compiler re-derives ownership locally rather than relying on a remote
 * `VALIDATE_CONFIG` response to say which node is at fault.
 */
export function compileConfig(input: CompileConfigInput, options: CompileConfigOptions = {}): Result<CanonicalConfig, readonly DomainError[]> {
  const errors: DomainError[] = [];

  const moduleNodes = (input.physicalGraph.nodes as readonly PhysicalNode[]).filter(
    (n): n is PhysicalNode & { data: ModuleNodeData } => isModuleNodeData(n.data as ModuleNodeData),
  );
  const moduleKeyOf = assignKeys(moduleNodes.map((n) => n.id));

  const processingNodes = input.processingGraph.nodes as readonly ProcessingNode[];
  const processingNodesById = new Map(processingNodes.map((n) => [n.id, n]));
  const blockNodes = processingNodes.filter((n) => isBlockNodeData(n.data));
  const ruleNodes = processingNodes.filter((n) => isRuleNodeData(n.data));
  const triggerNodes = processingNodes.filter((n) => n.data.kind === "schedule");
  const blockKeyOf = assignKeys(blockNodes.map((n) => n.id));
  const ruleKeyOf = assignKeys(ruleNodes.map((n) => n.id));

  if (options.maxModules !== undefined && moduleNodes.length > options.maxModules) {
    const overflow = [...moduleKeyOf.entries()].find(([, key]) => key === options.maxModules! + 1);
    errors.push(failure(ConfigCompilerErrorCode.CAPACITY_EXCEEDED, ["modules"], overflow?.[0] ?? "modules", `${moduleNodes.length} modules exceed the declared cap ${options.maxModules}`));
  }
  if (options.maxBlocks !== undefined && blockNodes.length > options.maxBlocks) {
    const overflow = [...blockKeyOf.entries()].find(([, key]) => key === options.maxBlocks! + 1);
    errors.push(failure(ConfigCompilerErrorCode.CAPACITY_EXCEEDED, ["blocks"], overflow?.[0] ?? "blocks", `${blockNodes.length} blocks exceed the declared cap ${options.maxBlocks}`));
  }
  if (options.maxRules !== undefined && ruleNodes.length > options.maxRules) {
    const overflow = [...ruleKeyOf.entries()].find(([, key]) => key === options.maxRules! + 1);
    errors.push(failure(ConfigCompilerErrorCode.CAPACITY_EXCEEDED, ["rules"], overflow?.[0] ?? "rules", `${ruleNodes.length} rules exceed the declared cap ${options.maxRules}`));
  }
  if (options.maxSchedules !== undefined && triggerNodes.length > options.maxSchedules) {
    errors.push(failure(ConfigCompilerErrorCode.CAPACITY_EXCEEDED, ["schedules"], "schedules", `${triggerNodes.length} schedules exceed the declared cap ${options.maxSchedules}`));
  }
  const edges = input.processingGraph.edges as readonly ProcessingEdge[];
  if (options.maxEdges !== undefined && edges.length > options.maxEdges) {
    errors.push(failure(ConfigCompilerErrorCode.CAPACITY_EXCEEDED, ["edges"], "edges", `${edges.length} edges exceed the declared cap ${options.maxEdges}`));
  }

  const modules = moduleNodes.map((node) => {
    const data = node.data;
    const propsResult = toPropertySet(node.id, data.properties);
    if (!propsResult.ok) errors.push(...propsResult.error);
    return {
      key: moduleKeyOf.get(node.id)!,
      portId: data.portId,
      typeId: data.driverTypeId,
      properties: propsResult.ok ? propsResult.value : {},
      bayId: data.bayId === 255 ? undefined : data.bayId,
      powerRailId: data.railId === 255 ? undefined : data.railId,
    };
  });

  const schedules = triggerNodes
    .filter((n) => n.data.kind === "schedule")
    .map((node) => {
      const data = node.data as Extract<DeviceProcessingNodeData, { kind: "schedule" }>;
      const sourceKey = moduleKeyOf.get(data.moduleNodeId);
      if (sourceKey === undefined) {
        errors.push(failure(ConfigCompilerErrorCode.DANGLING_MODULE_REFERENCE, ["nodes", node.id], data.moduleNodeId, `Schedule "${node.id}" references a Module not present in physicalGraph`));
        return undefined;
      }
      return { sourceKey, periodMs: data.periodMs, enabled: data.enabled };
    })
    .filter((s): s is NonNullable<typeof s> => s !== undefined);

  const rules = ruleNodes.map((node) => {
    const data = node.data as Extract<DeviceProcessingNodeData, { kind: "rule" }>;
    const propsResult = toPropertySet(node.id, data.properties);
    if (!propsResult.ok) errors.push(...propsResult.error);
    const properties = propsResult.ok ? { ...propsResult.value } : {};

    if (data.commandTarget) {
      const fieldIds = options.resolveRuleActionFieldIds?.(data.ruleTypeId);
      if (!fieldIds) {
        errors.push(failure(ConfigCompilerErrorCode.UNRESOLVED_RULE_ACTION, ["nodes", node.id], data.ruleTypeId, `no resolveRuleActionFieldIds mapping supplied for Rule type "${data.ruleTypeId}"`));
      } else {
        const targetKey = moduleKeyOf.get(data.commandTarget.moduleNodeId);
        if (targetKey === undefined) {
          errors.push(failure(ConfigCompilerErrorCode.DANGLING_MODULE_REFERENCE, ["nodes", node.id, "commandTarget"], data.commandTarget.moduleNodeId, `Rule "${node.id}"'s command target references a Module not present in physicalGraph`));
        } else {
          properties[fieldIds.targetKeyFieldId] = BigInt(targetKey);
          properties[fieldIds.commandIdFieldId] = BigInt(data.commandTarget.commandId);
        }
      }
    }

    if (data.sourceReference) {
      const fieldIds = options.resolveRuleSourceFieldIds?.(data.ruleTypeId);
      if (!fieldIds) {
        errors.push(failure(ConfigCompilerErrorCode.UNRESOLVED_RULE_ACTION, ["nodes", node.id], data.ruleTypeId, `no resolveRuleSourceFieldIds mapping supplied for Rule type "${data.ruleTypeId}"`));
      } else {
        const sourceKey = moduleKeyOf.get(data.sourceReference.moduleNodeId);
        if (sourceKey === undefined) {
          errors.push(failure(ConfigCompilerErrorCode.DANGLING_MODULE_REFERENCE, ["nodes", node.id, "sourceReference"], data.sourceReference.moduleNodeId, `Rule "${node.id}"'s source reference references a Module not present in physicalGraph`));
        } else {
          properties[fieldIds.sourceKeyFieldId] = BigInt(sourceKey);
          properties[fieldIds.sourceFieldIdFieldId] = BigInt(data.sourceReference.fieldId);
        }
      }
    }

    return { key: ruleKeyOf.get(node.id)!, typeId: data.ruleTypeId, properties };
  });

  const blocks = blockNodes.map((node) => {
    const data = node.data as Extract<DeviceProcessingNodeData, { kind: "block" }>;
    const propsResult = toPropertySet(node.id, data.properties);
    if (!propsResult.ok) errors.push(...propsResult.error);
    return {
      key: blockKeyOf.get(node.id)!,
      typeId: data.blockTypeId,
      minVersion: data.minVersion ?? 0,
      exactVersion: data.exactVersion ?? 0,
      properties: propsResult.ok ? propsResult.value : {},
    };
  });

  function keyOf(nodeId: string): { key: number; kind: (typeof EdgeSourceKind)[keyof typeof EdgeSourceKind] } | undefined {
    const node = processingNodesById.get(nodeId);
    if (!node) return undefined;
    if (node.data.kind === "schedule" || node.data.kind === "event-source") {
      const moduleNodeId = moduleReferenceOf(node.data);
      const key = moduleNodeId ? moduleKeyOf.get(moduleNodeId) : undefined;
      return key === undefined ? undefined : { key, kind: EdgeSourceKind.MODULE };
    }
    if (node.data.kind === "block") {
      const key = blockKeyOf.get(nodeId);
      return key === undefined ? undefined : { key, kind: EdgeSourceKind.BLOCK };
    }
    return undefined;
  }

  const compiledEdges: CanonicalEdge[] = [];
  for (const edge of edges) {
    const sourceNode = processingNodesById.get(edge.source);
    const targetNode = processingNodesById.get(edge.target);
    if (!sourceNode || !targetNode) continue;

    const source = keyOf(edge.source);
    if (!source) {
      errors.push(failure(ConfigCompilerErrorCode.DANGLING_MODULE_REFERENCE, ["edges", edge.id], edge.source, `edge "${edge.id}"'s source could not be resolved to a compiled Module/Block key`));
      continue;
    }
    // struct spaghetti_edge_config's target_key is always a Block key on the wire — a
    // Rule has no input port to be an edge target for (see device-processing-graph-model's
    // README correction); RuleNodeData.sourceReference is compiled separately, below.
    const targetKey = targetNode.data.kind === "block" ? blockKeyOf.get(edge.target) : undefined;
    if (targetKey === undefined) {
      // Authoring nest: Schedule/Event-source → Event-source is a dashed-box
      // grouping, not a Config edge (`target_key` is always a Block).
      if (targetNode.data.kind === "schedule" || targetNode.data.kind === "event-source") continue;
      errors.push(failure(ConfigCompilerErrorCode.DANGLING_MODULE_REFERENCE, ["edges", edge.id], edge.target, `edge "${edge.id}"'s target is not a compiled Block`));
      continue;
    }

    const sourcePortOrField = options.resolveSourcePortOrField?.({ node: sourceNode, handle: edge.sourceHandle }) ?? numericHandle(edge.sourceHandle);
    const targetInput = options.resolveTargetInput?.({ node: targetNode, handle: edge.targetHandle }) ?? numericHandle(edge.targetHandle);
    if (sourcePortOrField === undefined || targetInput === undefined) {
      errors.push(failure(ConfigCompilerErrorCode.UNRESOLVED_PORT_OR_FIELD, ["edges", edge.id], edge.id, `edge "${edge.id}" has no resolvable numeric source/target port — supply resolveSourcePortOrField/resolveTargetInput`));
      continue;
    }

    compiledEdges.push({ sourceKey: source.key, sourcePortOrField, targetKey, targetInput, sourceKind: source.kind });
  }

  if (options.maxFanOut !== undefined) {
    const outgoingCount = new Map<string, number>();
    for (const edge of edges) outgoingCount.set(edge.source, (outgoingCount.get(edge.source) ?? 0) + 1);
    for (const [nodeId, count] of outgoingCount) {
      if (count > options.maxFanOut) {
        errors.push(failure(ConfigCompilerErrorCode.FAN_OUT_EXCEEDED, ["nodes", nodeId], nodeId, `"${nodeId}" has ${count} outgoing edges, exceeding the cap ${options.maxFanOut}`));
      }
    }
  }

  if (options.maxDepth !== undefined) {
    const depths = longestDepth(processingNodes.map((n) => n.id), edges);
    for (const [nodeId, depth] of depths) {
      if (depth > options.maxDepth) {
        errors.push(failure(ConfigCompilerErrorCode.DEPTH_EXCEEDED, ["nodes", nodeId], nodeId, `"${nodeId}" is at depth ${depth}, exceeding the cap ${options.maxDepth}`));
      }
    }
  }

  if (options.maxTotalCost !== undefined) {
    let cumulative = 0;
    for (const node of blockNodes.slice().sort((a, b) => (blockKeyOf.get(a.id)! - blockKeyOf.get(b.id)!))) {
      cumulative += options.resolveBlockCost?.(node) ?? 0;
      if (cumulative > options.maxTotalCost) {
        errors.push(failure(ConfigCompilerErrorCode.COST_BUDGET_EXCEEDED, ["nodes", node.id], String(cumulative), `cumulative processing cost ${cumulative} exceeds the declared budget ${options.maxTotalCost} at Block "${node.id}"`));
        break;
      }
    }
  }

  if (errors.length > 0) return err(errors);

  // Output array order must depend only on assigned keys, never on the
  // authoring nodes/edges array's own insertion order — otherwise
  // "the same semantics with different order" (S072 § Verifiche) could
  // still produce a different byte sequence despite identical key values.
  return ok({
    version: CONFIG_WIRE_VERSION,
    modules: [...modules].sort((a, b) => a.key - b.key),
    schedules: [...schedules].sort((a, b) => a.sourceKey - b.sourceKey),
    rules: [...rules].sort((a, b) => a.key - b.key),
    mqtt: input.mqtt,
    connectivity: input.connectivity,
    energy: input.energy,
    blocks: [...blocks].sort((a, b) => a.key - b.key),
    edges: [...compiledEdges].sort(
      (a, b) =>
        a.sourceKind - b.sourceKind ||
        a.sourceKey - b.sourceKey ||
        a.sourcePortOrField - b.sourcePortOrField ||
        a.targetKey - b.targetKey ||
        a.targetInput - b.targetInput,
    ),
  });
}

function numericHandle(handle: string | undefined): number | undefined {
  if (handle === undefined) return undefined;
  const n = Number(handle);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}
