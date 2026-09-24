import type { DeviceProcessingNodeData } from "@spaghettilab/device-processing-graph-model";
import type { CSSProperties } from "react";
import { catalogEntryForNode } from "./catalog-entry-for-node.js";
import { NODE_HEIGHT, NODE_WIDTH } from "./layout-constants.js";

/**
 * Port layout for a processing-graph card. Prefer catalog `inputs`/`outputs`
 * when declared; otherwise fall back to kind defaults.
 */
export type NodePortHandle = {
  readonly id: string;
  readonly label?: string;
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
    const inputs = (entry.inputs ?? []).map((p) => ({ id: p.id, label: p.label }));
    const outputs = (entry.outputs ?? []).map((p, index) => ({
      id: p.id,
      label: resolveChannelName(props, index, p.label ?? `CH${index + 1}`),
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

export const SOURCE_HANDLE_STYLE: CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: 9999,
  background: "var(--color-surface)",
  border: "2px solid var(--color-brand-blue)",
};

export const TARGET_HANDLE_STYLE: CSSProperties = {
  width: 10,
  height: 14,
  borderRadius: 2,
  background: "var(--color-surface)",
  border: "2px solid var(--color-brand-blue)",
};

/** Vertical position (%) for the i-th of n stacked handles. */
export function stackedHandleTop(index: number, count: number): string {
  if (count <= 1) return "50%";
  return `${((index + 1) / (count + 1)) * 100}%`;
}
