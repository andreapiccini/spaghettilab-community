import type { DeviceProcessingNodeData } from "@spaghettilab/device-processing-graph-model";
import {
  catalogPortsCompatible,
  type ProcessingCatalogEntry,
} from "@spaghettilab/processing-block-catalog";
import {
  ifInputCompatibleWith,
  ifOutputType,
  isCompareIf,
  isBackboneSensorBlock,
  isDigitalCommandSource,
  isLedBlock,
  isRelayBlock,
  isTemperatureSensor,
} from "./dry-run-preview.js";

/**
 * Connection rules for the Device Processing Graph canvas.
 * - No self-loops
 * - When both ends declare catalog ports, output kinds must be compatible
 *   with input kinds (`activation` is a jolly that matches any input)
 */
export function isValidProcessingConnection(
  connection: {
    readonly source?: string | null;
    readonly target?: string | null;
    readonly sourceHandle?: string | null;
    readonly targetHandle?: string | null;
  },
  resolveEntry?: (nodeId: string) => ProcessingCatalogEntry | undefined,
): boolean {
  if (!connection.source || !connection.target) return false;
  if (connection.source === connection.target) return false;
  if (!resolveEntry) return true;

  const sourceEntry = resolveEntry(connection.source);
  const targetEntry = resolveEntry(connection.target);
  if (!sourceEntry && !targetEntry) return true;

  return catalogPortsCompatible(
    sourceEntry?.outputs,
    targetEntry?.inputs,
    connection.sourceHandle,
    connection.targetHandle,
  );
}

export type DemoConnectionContext = {
  readonly nodes: readonly { readonly id: string; readonly data: DeviceProcessingNodeData }[];
  readonly edges: readonly { readonly source: string; readonly target: string }[];
};

/**
 * Visitor demo: IF takes Toggle or Temperature; temperature only feeds IF;
 * LED / Relay take Toggle or a Digital IF. Connecting a new source replaces the old wire.
 */
export function isValidDemoProcessingConnection(
  connection: {
    readonly source?: string | null;
    readonly target?: string | null;
  },
  ctx: DemoConnectionContext,
): boolean {
  if (!connection.source || !connection.target) return false;
  const source = ctx.nodes.find((node) => node.id === connection.source)?.data;
  const target = ctx.nodes.find((node) => node.id === connection.target)?.data;
  if (!source || !target) return true;

  if (isTemperatureSensor(source)) {
    return isCompareIf(target);
  }
  if (isCompareIf(target)) {
    return isDigitalCommandSource(source) || isTemperatureSensor(source);
  }
  if (isTemperatureSensor(target)) return false;
  if (isCompareIf(source)) return isLedBlock(target) || isRelayBlock(target) || isBackboneSensorBlock(target);
  if (isLedBlock(target) || isRelayBlock(target) || isBackboneSensorBlock(target))
    return isDigitalCommandSource(source) || isCompareIf(source);
  return true;
}

/** Existing wire that the visitor should see as broken (Boolean IF → LED, or mismatched IF input). */
export function isIncompatibleDemoEdge(
  edge: { readonly source: string; readonly target: string },
  ctx: DemoConnectionContext,
): boolean {
  const source = ctx.nodes.find((node) => node.id === edge.source)?.data;
  const target = ctx.nodes.find((node) => node.id === edge.target)?.data;
  if (!source || !target) return false;
  if (isCompareIf(target) && (isDigitalCommandSource(source) || isTemperatureSensor(source))) {
    return !ifInputCompatibleWith(target, source);
  }
  if (!isCompareIf(source)) return false;
  if (!(isLedBlock(target) || isRelayBlock(target) || isBackboneSensorBlock(target))) return false;
  return ifOutputType(source) === "boolean";
}

export function ifSourceKind(
  nodeId: string,
  ctx: DemoConnectionContext,
): "toggle" | "temperature" | "none" {
  const incoming = ctx.edges.find((edge) => edge.target === nodeId);
  if (!incoming) return "none";
  const source = ctx.nodes.find((node) => node.id === incoming.source)?.data;
  if (!source) return "none";
  if (isDigitalCommandSource(source)) return "toggle";
  if (isTemperatureSensor(source)) return "temperature";
  return "none";
}

