import type { DeviceProcessingNodeData } from "@spaghettilab/device-processing-graph-model";
import type { CSSProperties } from "react";
import { catalogEntryForNode } from "./catalog-entry-for-node.js";

/**
 * Port layout for a processing-graph card. Prefer catalog `inputs`/`outputs`
 * when declared; otherwise fall back to kind defaults.
 */
export type NodePortLayout = {
  readonly hasInput: boolean;
  readonly hasOutput: boolean;
};

export function portsForKind(kind: DeviceProcessingNodeData["kind"]): NodePortLayout {
  switch (kind) {
    case "schedule":
    case "event-source":
      return { hasInput: false, hasOutput: true };
    case "block":
      return { hasInput: true, hasOutput: true };
    case "rule":
      return { hasInput: false, hasOutput: false };
  }
}

export function portsForNode(data: DeviceProcessingNodeData): NodePortLayout {
  const entry = catalogEntryForNode(data);
  if (entry && (entry.inputs !== undefined || entry.outputs !== undefined)) {
    return {
      hasInput: (entry.inputs?.length ?? 0) > 0,
      hasOutput: (entry.outputs?.length ?? 0) > 0,
    };
  }
  return portsForKind(data.kind);
}

const CLOSED = 28;
const OPEN = 12;
/** Sharp corners; only bottom-left is rounded. */
const MARK = 2;

export function nodeShellRadius(ports: NodePortLayout): string {
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
