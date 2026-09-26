import type { DeviceProcessingNodeData } from "@spaghettilab/device-processing-graph-model";
import {
  catalogPortsCompatible,
  type ProcessingCatalogEntry,
} from "@spaghettilab/processing-block-catalog";
import {
  isCompareIf,
  isDigitalOutToggle,
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
 * Visitor demo: IF takes exactly one input (Toggle or Temperature sensor);
 * the temperature sensor only feeds IF; Relay is driven by Toggle or IF.
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
    return isCompareIf(target) && incomingCount(ctx.edges, connection.target) === 0;
  }
  if (isCompareIf(target)) {
    if (incomingCount(ctx.edges, connection.target) > 0) return false;
    return isDigitalOutToggle(source) || isTemperatureSensor(source);
  }
  if (isTemperatureSensor(target)) return false;
  if (isCompareIf(source)) return isLedBlock(target) || isRelayBlock(target);
  if (isRelayBlock(target)) return isDigitalOutToggle(source) || isCompareIf(source);
  return true;
}

export function ifSourceKind(
  nodeId: string,
  ctx: DemoConnectionContext,
): "toggle" | "temperature" | "none" {
  const incoming = ctx.edges.find((edge) => edge.target === nodeId);
  if (!incoming) return "none";
  const source = ctx.nodes.find((node) => node.id === incoming.source)?.data;
  if (!source) return "none";
  if (isDigitalOutToggle(source)) return "toggle";
  if (isTemperatureSensor(source)) return "temperature";
  return "none";
}

function incomingCount(edges: DemoConnectionContext["edges"], targetId: string): number {
  return edges.filter((edge) => edge.target === targetId).length;
}
