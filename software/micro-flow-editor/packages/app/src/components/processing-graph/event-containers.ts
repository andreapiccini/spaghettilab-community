import type { AuthoringMetadata, GraphState } from "@spaghettilab/domain";
import type { DeviceProcessingNodeData } from "@spaghettilab/device-processing-graph-model";
import { formatFieldsSubtitle } from "@spaghettilab/processing-block-catalog";
import { catalogEntryForNode, propertiesOf } from "./catalog-entry-for-node.js";
import { EVENT_CONTAINER_HEADER_HEIGHT, NODE_HEIGHT, NODE_PADDING, NODE_WIDTH } from "./layout-constants.js";

export type EventContainer = {
  readonly id: string;
  readonly triggerId: string;
  readonly label: string;
  /** Schedule period shown beside the title — undefined for event-sources. */
  readonly periodMs?: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Direct members: blocks in this chain, plus nested trigger ids (not the nested trigger's own blocks). */
  readonly memberIds: readonly string[];
  /** Set when this trigger is nested inside another (edge parent → this). */
  readonly parentTriggerId?: string;
};

/**
 * Nestable containers: dashed boxes that hold members. Schedule is the usual
 * outer box; event-sources (On Button Pressed, On Interrupt, …) join the same
 * category so they accept blocks with the same green/red insert gesture, and
 * so a block dropped into a nested event-source stays inside both boxes.
 * Future nestable kinds are added here — not as one-off UI branches.
 */
export function isNestableContainer(kind: DeviceProcessingNodeData["kind"]): kind is "schedule" | "event-source" {
  return kind === "schedule" || kind === "event-source";
}

export const isTriggerKind = isNestableContainer;

/**
 * May be placed inside another nestable container. Schedule is outer-only
 * (two schedules stack, they do not nest).
 */
export function canBeNested(kind: DeviceProcessingNodeData["kind"]): boolean {
  return kind === "event-source";
}

export const canNestTrigger = canBeNested;

export function triggerToContainerOrigin(position: { readonly x: number; readonly y: number }): { x: number; y: number } {
  return {
    x: position.x - NODE_PADDING,
    y: position.y - NODE_PADDING - EVENT_CONTAINER_HEADER_HEIGHT,
  };
}

export function containerOriginToTrigger(origin: { readonly x: number; readonly y: number }): { x: number; y: number } {
  return {
    x: origin.x + NODE_PADDING,
    y: origin.y + NODE_PADDING + EVENT_CONTAINER_HEADER_HEIGHT,
  };
}

export function emptyEventContainerSize(): { width: number; height: number } {
  return {
    width: NODE_WIDTH + NODE_PADDING * 2,
    height: NODE_HEIGHT + NODE_PADDING * 2 + EVENT_CONTAINER_HEADER_HEIGHT,
  };
}

function containerLabel(data: DeviceProcessingNodeData, meta: AuthoringMetadata | undefined): string {
  const custom = meta?.comment?.trim();
  if (data.kind === "schedule") {
    return custom && custom !== "" ? custom : "Schedule";
  }
  if (custom && custom !== "") return custom;
  const entry = catalogEntryForNode(data);
  const fromFields = entry?.fields?.length ? formatFieldsSubtitle(entry.fields, propertiesOf(data)) : undefined;
  const parts = [entry?.label, fromFields].filter((part): part is string => Boolean(part));
  return parts.join(" · ") || "Event source";
}

/** Compact period for the Schedule container header (e.g. `ogni 1s`, `ogni 500ms`). */
export function formatSchedulePeriod(periodMs: number): string {
  if (!Number.isFinite(periodMs) || periodMs <= 0) return "ogni —";
  if (periodMs >= 1000 && periodMs % 1000 === 0) return `ogni ${periodMs / 1000}s`;
  if (periodMs >= 1000) {
    const seconds = periodMs / 1000;
    const rounded = Math.round(seconds * 10) / 10;
    return `ogni ${rounded}s`;
  }
  return `ogni ${Math.round(periodMs)}ms`;
}

export type ContainerSizePreview = {
  readonly triggerId: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly width?: number;
  readonly height?: number;
};

type MutableContainer = {
  id: string;
  triggerId: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  memberIds: string[];
  parentTriggerId?: string;
};

function growRightDown(c: MutableContainer, rect: { x: number; y: number; width: number; height: number }): void {
  const right = Math.max(c.x + c.width, rect.x + rect.width);
  const bottom = Math.max(c.y + c.height, rect.y + rect.height);
  c.width = Math.round(right - c.x);
  c.height = Math.round(bottom - c.y);
}

/**
 * One dashed container per Schedule/Event-source. Nested event-sources (an
 * edge from an outer trigger into this one) stay their own dashed box, parented
 * inside the outer; the walk stops at that nested trigger so its chain is not
 * stolen as outer members.
 */
export function computeEventContainers(
  graphState: GraphState<"device-processing">,
  authoringMetadata: Readonly<Record<string, AuthoringMetadata>>,
  livePositions?: ReadonlyMap<string, { readonly x: number; readonly y: number }>,
  sizePreview?: ContainerSizePreview,
): readonly EventContainer[] {
  const nodesById = new Map(graphState.nodes.map((n) => [n.id, n]));
  const outgoing = new Map<string, string[]>();
  for (const edge of graphState.edges) {
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge.target);
    outgoing.set(edge.source, list);
  }

  const containers: MutableContainer[] = [];
  for (const node of graphState.nodes) {
    const data = node.data as DeviceProcessingNodeData;
    if (!isTriggerKind(data.kind)) continue;

    const triggerPos = livePositions?.get(node.id) ?? authoringMetadata[node.id]?.position ?? { x: 0, y: 0 };

    const memberIds = new Set<string>();
    const queue = [...(outgoing.get(node.id) ?? [])];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (memberIds.has(id) || id === node.id) continue;
      memberIds.add(id);
      const child = nodesById.get(id);
      const childKind = child ? (child.data as DeviceProcessingNodeData).kind : undefined;
      // Nested trigger keeps its own dashed box; don't steal its chain as outer members.
      if (childKind && isTriggerKind(childKind)) continue;
      for (const next of outgoing.get(id) ?? []) queue.push(next);
    }

    let maxRelX = 0;
    let maxRelY = 0;
    for (const id of memberIds) {
      const child = nodesById.get(id);
      if (!child) continue;
      if (isTriggerKind((child.data as DeviceProcessingNodeData).kind)) continue;
      const pos = livePositions?.get(id) ?? authoringMetadata[id]?.position ?? { x: 0, y: 0 };
      maxRelX = Math.max(maxRelX, pos.x - triggerPos.x);
      maxRelY = Math.max(maxRelY, pos.y - triggerPos.y);
    }
    if (sizePreview?.triggerId === node.id && sizePreview.width === undefined) {
      maxRelX = Math.max(maxRelX, sizePreview.position.x - triggerPos.x);
      maxRelY = Math.max(maxRelY, sizePreview.position.y - triggerPos.y);
    }

    const meta = authoringMetadata[node.id];
    const label = containerLabel(data, meta);
    containers.push({
      id: `container-${node.id}`,
      triggerId: node.id,
      label,
      ...(data.kind === "schedule" ? { periodMs: data.periodMs } : {}),
      x: Math.round(triggerPos.x - NODE_PADDING),
      y: Math.round(triggerPos.y - NODE_PADDING - EVENT_CONTAINER_HEADER_HEIGHT),
      width: Math.round(maxRelX + NODE_WIDTH + NODE_PADDING * 2),
      height: Math.round(maxRelY + NODE_HEIGHT + NODE_PADDING * 2 + EVENT_CONTAINER_HEADER_HEIGHT),
      memberIds: Array.from(memberIds).filter((id) => nodesById.has(id)),
    });
  }

  const byTrigger = new Map(containers.map((c) => [c.triggerId, c]));
  for (const c of containers) {
    const parent = containers.find((p) => p.triggerId !== c.triggerId && p.memberIds.includes(c.triggerId));
    if (parent) c.parentTriggerId = parent.triggerId;
  }

  const depthOf = (c: MutableContainer): number => {
    let d = 0;
    let parentId = c.parentTriggerId;
    const seen = new Set<string>();
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      d += 1;
      parentId = byTrigger.get(parentId)?.parentTriggerId;
    }
    return d;
  };
  for (const c of [...containers].sort((a, b) => depthOf(a) - depthOf(b))) {
    for (const id of c.memberIds) {
      const nested = byTrigger.get(id);
      if (!nested) continue;
      growRightDown(c, nested);
    }
    if (sizePreview?.triggerId === c.triggerId && sizePreview.width !== undefined && sizePreview.height !== undefined) {
      growRightDown(c, { x: sizePreview.position.x, y: sizePreview.position.y, width: sizePreview.width, height: sizePreview.height });
    }
  }

  return containers;
}

export function collectDescendantMemberIds(container: EventContainer, byTrigger: ReadonlyMap<string, EventContainer>): string[] {
  const out: string[] = [];
  for (const id of container.memberIds) {
    out.push(id);
    const nested = byTrigger.get(id);
    if (nested) out.push(...collectDescendantMemberIds(nested, byTrigger));
  }
  return out;
}

export function containerContainsTrigger(ancestor: EventContainer, triggerId: string, byTrigger: ReadonlyMap<string, EventContainer>): boolean {
  if (ancestor.memberIds.includes(triggerId)) return true;
  return ancestor.memberIds.some((id) => {
    const nested = byTrigger.get(id);
    return nested ? containerContainsTrigger(nested, triggerId, byTrigger) : false;
  });
}

function isAncestorTrigger(node: EventContainer, candidateId: string, byTrigger: ReadonlyMap<string, EventContainer>): boolean {
  let parentId = node.parentTriggerId;
  const seen = new Set<string>();
  while (parentId && !seen.has(parentId)) {
    if (parentId === candidateId) return true;
    seen.add(parentId);
    parentId = byTrigger.get(parentId)?.parentTriggerId;
  }
  return false;
}

function isPeerContainer(dragged: EventContainer | undefined, candidate: EventContainer, byTrigger: ReadonlyMap<string, EventContainer>): boolean {
  if (!dragged) return true;
  if (candidate.triggerId === dragged.triggerId) return false;
  if (containerContainsTrigger(dragged, candidate.triggerId, byTrigger)) return false;
  if (isAncestorTrigger(dragged, candidate.triggerId, byTrigger)) return false;
  return true;
}

/** Other dashed boxes that must not stack with `draggedId` (parent/child nest is allowed). */
export function peerContainerObstacles(
  draggedId: string,
  containers: readonly EventContainer[],
  byTrigger: ReadonlyMap<string, EventContainer>,
): { readonly id: string; readonly position: { readonly x: number; readonly y: number }; readonly w: number; readonly h: number }[] {
  const dragged = byTrigger.get(draggedId);
  return containers.filter((c) => isPeerContainer(dragged, c, byTrigger)).map((c) => ({ id: c.triggerId, position: { x: c.x, y: c.y }, w: c.width, h: c.height }));
}

/** Innermost peer dashed box that visually overlaps `box` — used for the red "can't nest" hint. */
export function overlappingPeerContainer(
  box: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  draggedId: string,
  containers: readonly EventContainer[],
  byTrigger: ReadonlyMap<string, EventContainer>,
): EventContainer | undefined {
  const dragged = byTrigger.get(draggedId);
  const hits = containers.filter((c) => isPeerContainer(dragged, c, byTrigger) && box.x < c.x + c.width && c.x < box.x + box.width && box.y < c.y + c.height && c.y < box.y + box.height);
  if (hits.length === 0) return undefined;
  return [...hits].sort((a, b) => a.width * a.height - b.width * b.height)[0];
}

export function memberEscapesContainer(
  position: { readonly x: number; readonly y: number },
  container: { readonly x: number; readonly y: number },
): boolean {
  return position.x < container.x || position.y < container.y;
}

/**
 * Where a dragged block (or nestable container treated as a member) should
 * attach after a drop. `hovered` is the innermost dashed box under the
 * pointer; when leaving through the top/left edge, the caller excludes the
 * box being escaped so `hovered` is the ancestor that still contains it.
 *
 * A block already inside a Schedule that is dropped onto a nested On Interrupt
 * re-parents to the inner box — it then belongs to both (inner chain, outer box).
 */
export function planMembershipDrop(input: {
  readonly current: { readonly triggerId: string } | undefined;
  readonly hovered: { readonly triggerId: string } | undefined;
  readonly escaping: boolean;
}): { readonly detachFrom?: string; readonly attachTo?: string } {
  const currentId = input.current?.triggerId;
  const hoveredId = input.hovered?.triggerId;
  if (input.escaping && currentId) {
    return { detachFrom: currentId, attachTo: hoveredId && hoveredId !== currentId ? hoveredId : undefined };
  }
  if (hoveredId && hoveredId !== currentId) {
    return { detachFrom: currentId, attachTo: hoveredId };
  }
  return {};
}

export type GraphEdgeLike = { readonly id: string; readonly source: string; readonly target: string };

export function detachMemberEdges(
  memberId: string,
  container: { readonly triggerId: string; readonly memberIds: readonly string[] },
  edges: readonly GraphEdgeLike[],
): { readonly removeIds: readonly string[]; readonly splice: { readonly source: string; readonly target: string } | undefined } {
  const inside = new Set<string>([container.triggerId, ...container.memberIds]);
  const removeIds: string[] = [];
  const predecessors: string[] = [];
  const successors: string[] = [];
  for (const edge of edges) {
    const fromInside = edge.source === memberId && inside.has(edge.target) && edge.target !== memberId;
    const toInside = edge.target === memberId && inside.has(edge.source) && edge.source !== memberId;
    if (!fromInside && !toInside) continue;
    removeIds.push(edge.id);
    if (toInside) predecessors.push(edge.source);
    if (fromInside) successors.push(edge.target);
  }
  const alreadyLinked = (source: string, target: string) => edges.some((e) => e.source === source && e.target === target);
  const splice =
    predecessors.length === 1 && successors.length === 1 && predecessors[0] !== successors[0] && !alreadyLinked(predecessors[0]!, successors[0]!)
      ? { source: predecessors[0]!, target: successors[0]! }
      : undefined;
  return { removeIds, splice };
}
