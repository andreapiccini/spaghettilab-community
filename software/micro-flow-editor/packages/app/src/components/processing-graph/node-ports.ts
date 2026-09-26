import type { DeviceProcessingNodeData } from "@spaghettilab/device-processing-graph-model";
import type { PortType } from "@spaghettilab/processing-block-catalog";
import { Position } from "@xyflow/react";
import type { CSSProperties } from "react";
import { catalogEntryForNode } from "./catalog-entry-for-node.js";
import { NODE_HEIGHT, NODE_WIDTH } from "./layout-constants.js";

export type PortKind = "digital" | "analog" | "boolean" | "activation" | "event" | "power";

export function portKindFromTypes(types: readonly PortType[] | undefined): PortKind | undefined {
  const domain = types?.[0]?.domain;
  if (domain === "digital" || domain === "analog" || domain === "activation" || domain === "event" || domain === "power") {
    return domain;
  }
  return undefined;
}

/**
 * Port layout for a processing-graph card. Prefer catalog `inputs`/`outputs`
 * when declared; otherwise fall back to kind defaults.
 */
export type NodePortHandle = {
  readonly id: string;
  readonly label?: string;
  readonly kind?: PortKind;
};

export type NodePortLayout = {
  readonly hasInput: boolean;
  readonly hasOutput: boolean;
  readonly inputs: readonly NodePortHandle[];
  readonly outputs: readonly NodePortHandle[];
};

export function portsForKind(kind: DeviceProcessingNodeData["kind"]): NodePortLayout {
  switch (kind) {
    case "schedule":
    case "event-source":
      return { hasInput: false, hasOutput: true, inputs: [], outputs: [{ id: "0" }] };
    case "block":
      return { hasInput: true, hasOutput: true, inputs: [{ id: "0" }], outputs: [{ id: "0" }] };
    case "rule":
      return { hasInput: false, hasOutput: false, inputs: [], outputs: [] };
  }
}

export function portsForNode(data: DeviceProcessingNodeData): NodePortLayout {
  const entry = catalogEntryForNode(data);
  if (entry && (entry.inputs !== undefined || entry.outputs !== undefined)) {
    const props = data.kind === "block" || data.kind === "rule" || data.kind === "event-source" ? data.properties ?? {} : {};
    const inputs = (entry.inputs ?? []).map((p) => ({ id: p.id, label: p.label, kind: portKindFromTypes(p.types) }));
    const outputs = (entry.outputs ?? []).map((p, index) => ({
      id: p.id,
      label: resolveChannelName(props, index, p.label ?? `CH${index + 1}`),
      kind: portKindFromTypes(p.types),
    }));
    return {
      hasInput: inputs.length > 0,
      hasOutput: outputs.length > 0,
      inputs,
      outputs,
    };
  }
  return portsForKind(data.kind);
}

/** Prefer `chNName` property; fall back to catalog port label. */
export function resolveChannelName(
  properties: Readonly<Record<string, unknown>>,
  zeroBasedIndex: number,
  fallback: string,
): string {
  const key = `ch${zeroBasedIndex + 1}Name`;
  const raw = properties[key];
  if (typeof raw === "string" && raw.trim() !== "") return raw.trim();
  return fallback;
}

const MULTI_HEADER = 44;
const MULTI_ROW = 22;
const MULTI_PAD = 10;

/** Card height grows with stacked handles (e.g. Terminal block ×6). */
export function nodeHeightForPorts(ports: NodePortLayout): number {
  const n = Math.max(ports.inputs.length, ports.outputs.length, 1);
  if (n <= 1) return NODE_HEIGHT;
  return MULTI_HEADER + n * MULTI_ROW + MULTI_PAD;
}

/** Slightly wider card when many labeled channel rows. */
export function nodeWidthForPorts(ports: NodePortLayout): number {
  const n = Math.max(ports.inputs.length, ports.outputs.length, 1);
  return n > 1 ? 200 : NODE_WIDTH;
}

const CLOSED = 28;
const OPEN = 12;
/** Sharp corners; only bottom-left is rounded. */
const MARK = 2;

export function nodeShellRadius(ports: Pick<NodePortLayout, "hasInput" | "hasOutput">): string {
  const round = ports.hasInput ? OPEN : CLOSED;
  return `${MARK}px ${MARK}px ${MARK}px ${round}px`;
}

/** Type-icon handle (replaces the old circle / input bar). */
export const PORT_HANDLE_SIZE = 16;

export const SOURCE_HANDLE_STYLE: CSSProperties = {
  width: PORT_HANDLE_SIZE,
  height: PORT_HANDLE_SIZE,
  borderRadius: 3,
  background: "var(--color-surface)",
  border: "1.5px solid var(--color-brand-blue)",
};

export const TARGET_HANDLE_STYLE: CSSProperties = SOURCE_HANDLE_STYLE;

/** Vertical position (%) for the i-th of n stacked handles. */
export function stackedHandleTop(index: number, count: number): string {
  if (count <= 1) return "50%";
  return `${((index + 1) / (count + 1)) * 100}%`;
}

const TARGET_W = PORT_HANDLE_SIZE;
const TARGET_H = PORT_HANDLE_SIZE;
const SOURCE_W = PORT_HANDLE_SIZE;
const SOURCE_H = PORT_HANDLE_SIZE;
const TICK_HANDLE = 8;
const MULTI_SOURCE = PORT_HANDLE_SIZE;

/**
 * Static React Flow `handles` matching ProcessingNode / the tick disc.
 * Required because `renderedNodes` rebuilds every drag frame (parentId,
 * live container size, preview). That wipes DOM-measured handleBounds and
 * `getEdgePosition` then returns null — wires vanish until the next measure.
 * Same reason EventContainer nodes already carry an explicit `handles` list.
 */
export type StaticNodeHandle = {
  readonly id: string;
  readonly type: "source" | "target";
  readonly position: Position;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export function handlesForNode(
  ports: NodePortLayout,
  size: { readonly width: number; readonly height: number; readonly circular?: boolean; readonly bandHeight?: number },
): StaticNodeHandle[] {
  if (size.circular) {
    return [
      {
        id: "0",
        type: "source",
        position: Position.Right,
        x: size.width - TICK_HANDLE + 2,
        y: size.height / 2 - TICK_HANDLE / 2,
        width: TICK_HANDLE,
        height: TICK_HANDLE,
      },
    ];
  }

  const stacked = Math.max(ports.inputs.length, ports.outputs.length) > 1;
  const handles: StaticNodeHandle[] = [];
  const inputCount = stacked ? Math.max(ports.inputs.length, ports.outputs.length) : ports.inputs.length;
  const bandHeight = size.bandHeight ?? size.height;

  for (let i = 0; i < ports.inputs.length; i++) {
    handles.push({
      id: ports.inputs[i]!.id,
      type: "target",
      position: Position.Left,
      x: -TARGET_W / 2,
      y: stackedHandleY(i, inputCount, bandHeight, TARGET_H),
      width: TARGET_W,
      height: TARGET_H,
    });
  }

  for (let i = 0; i < ports.outputs.length; i++) {
    if (stacked) {
      handles.push({
        id: ports.outputs[i]!.id,
        type: "source",
        position: Position.Right,
        x: size.width - MULTI_SOURCE + 2,
        y: MULTI_HEADER + i * MULTI_ROW + (MULTI_ROW - MULTI_SOURCE) / 2,
        width: MULTI_SOURCE,
        height: MULTI_SOURCE,
      });
      continue;
    }
    handles.push({
      id: ports.outputs[i]!.id,
      type: "source",
      position: Position.Right,
      x: size.width - SOURCE_W,
      y: bandHeight / 2 - SOURCE_H / 2,
      width: SOURCE_W,
      height: SOURCE_H,
    });
  }

  return handles;
}

function stackedHandleY(index: number, count: number, nodeHeight: number, handleHeight: number): number {
  if (count <= 1) return nodeHeight / 2 - handleHeight / 2;
  return (nodeHeight * (index + 1)) / (count + 1) - handleHeight / 2;
}
