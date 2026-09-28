import type {
  Catalog,
  CoreTopology,
  PowerRail,
  SpaghettiConfig,
} from "./types.js";

export type EditorHandleKind =
  | "flow_signal"
  | "bay"
  | "module"
  | "power_rail"
  | "record_field"
  | "command";

export interface EditorHandle {
  id: string;
  kind: EditorHandleKind;
  label: string;
  /** UI-neutral catalog semantic, never remapped by this helper. */
  semantic?: string;
  referenceGroup?: number;
}

export interface EditorNode {
  id: string;
  type: string;
  label: string;
  handles: EditorHandle[];
  meta: Record<string, unknown>;
}

export interface EditorEdge {
  id: string;
  source: string;
  target: string;
  kind: string;
}

export interface EditorModel {
  nodes: EditorNode[];
  edges: EditorEdge[];
  /** Unmanaged rails stay `unverified` — never implicitly safe. */
  powerRails: Array<PowerRail & { verification: "unverified" | "switched" | "measured" }>;
}

/**
 * Pure editor projection from catalog + topology + config.
 * No React, React Flow, or Node-RED imports.
 */
export function buildEditorModel(
  catalog: Catalog,
  topology: CoreTopology,
  config: SpaghettiConfig,
): EditorModel {
  const nodes: EditorNode[] = [];
  const edges: EditorEdge[] = [];

  for (const flow of topology.flows) {
    const flowId = `flow:${flow.id}`;
    nodes.push({
      id: flowId,
      type: "hardware_flow",
      label: `Flow ${flow.id}`,
      handles: Array.from({ length: flow.signalCount }, (_, i) => ({
        id: `${flowId}:signal:${i}`,
        kind: "flow_signal" as const,
        label: `S${i}`,
      })),
      meta: {
        portId: flow.portId,
        direction: flow.direction,
        signalCount: flow.signalCount,
      },
    });

    for (const bay of flow.bays) {
      const bayId = `bay:${flow.id}:${bay.id}`;
      nodes.push({
        id: bayId,
        type: "function_bay",
        label: `Bay ${bay.id}`,
        handles: [
          {
            id: `${bayId}:slot`,
            kind: "bay",
            label: "module",
          },
        ],
        meta: {
          flowId: flow.id,
          ordinalFromField: bay.ordinalFromField,
          availablePowerRails: bay.availablePowerRails,
        },
      });
      edges.push({
        id: `${flowId}->${bayId}`,
        source: flowId,
        target: bayId,
        kind: "flow_bay",
      });
    }
  }

  const driversByType = new Map(catalog.drivers.map((d) => [d.typeId, d]));
  for (const module of config.modules) {
    const driver = driversByType.get(module.type);
    const moduleId = `module:${module.key}`;
    const handles: EditorHandle[] = [];
    for (const field of driver?.fields ?? []) {
      handles.push({
        id: `${moduleId}:field:${field.fieldId}`,
        kind: "record_field",
        label: field.name,
        semantic: field.semantic,
        referenceGroup: field.referenceGroup,
      });
    }
    for (const command of driver?.commands ?? []) {
      handles.push({
        id: `${moduleId}:cmd:${command.commandId}`,
        kind: "command",
        label: command.name,
      });
    }
    nodes.push({
      id: moduleId,
      type: "module",
      label: module.type,
      handles,
      meta: {
        key: module.key,
        port: module.port,
        bay: module.bay,
        powerRail: module.powerRail,
        typeId: module.type,
        properties: module.properties,
      },
    });
    if (module.bay !== undefined) {
      const bayId = `bay:${/* best-effort: match by bay id across flows */ ""}`;
      void bayId;
      for (const flow of topology.flows) {
        if (flow.portId !== module.port) continue;
        const bay = flow.bays.find((b) => b.id === module.bay);
        if (!bay) continue;
        edges.push({
          id: `module:${module.key}->bay:${flow.id}:${bay.id}`,
          source: moduleId,
          target: `bay:${flow.id}:${bay.id}`,
          kind: "module_bay",
        });
      }
    }
  }

  const powerRails = topology.powerRails.map((rail) => {
    if (rail.assurance === "unmanaged") {
      return { ...rail, verification: "unverified" as const };
    }
    if (rail.assurance === "switched_and_measured") {
      return { ...rail, verification: "measured" as const };
    }
    return { ...rail, verification: "switched" as const };
  });

  for (const rail of powerRails) {
    nodes.push({
      id: `rail:${rail.id}`,
      type: "power_rail",
      label: `Rail ${rail.id}`,
      handles: [
        {
          id: `rail:${rail.id}:out`,
          kind: "power_rail",
          label: rail.assurance,
        },
      ],
      meta: {
        assurance: rail.assurance,
        verification: rail.verification,
        maxTotalMicroamps: rail.maxTotalMicroamps,
      },
    });
  }

  return { nodes, edges, powerRails };
}
