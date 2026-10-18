export type ModulePosition = 1 | 2;

export type NfcNode = {
  readonly portId: number;
  readonly label: string;
  readonly uid?: string;
  readonly nodeId?: number;
  readonly backboneMac?: string;
  readonly backboneLabel?: string;
  readonly moduleTypeId?: number;
  readonly fallbackClass?: number;
};

export type NfcTagInput = {
  readonly portId: number;
  readonly typeId: string;
  readonly uid?: Uint8Array | string;
  readonly nodeId?: number;
  readonly backboneMac?: string;
  readonly backboneLabel?: string;
  readonly moduleTypeId?: number;
  readonly vendorId?: number;
  readonly fallbackClass?: number;
  readonly registryId?: number;
};

export type NfcDetectKind = "read";

export type NfcDetectEvent = {
  readonly id: string;
  readonly kind: NfcDetectKind;
  readonly node: NfcNode;
  readonly backboneMac: string;
};

export type NfcDetectQueue = {
  readonly items: readonly NfcDetectEvent[];
  readonly activeIndex: number;
};

/** @deprecated Use NfcDetectEvent — kept for existing imports during rename. */
export type NfcPopupEvent = NfcDetectEvent;
/** @deprecated Use NfcDetectQueue */
export type NfcPopupQueue = NfcDetectQueue;
/** @deprecated Use NfcDetectKind */
export type NfcPopupKind = NfcDetectKind;

const GENERIC_TYPE_IDS = new Set(["t2t", "t4t", "tag", ""]);

const TYPE_LABELS: Record<string, string> = {
  backbone: "Backbone",
  power: "Power",
  sensor: "Sensor",
  actuator: "Actuator",
  iface: "Interface",
  interface: "Interface",
  ctrl: "Controller",
  controller: "Controller",
  adapter: "Adapter",
  module: "Module",
};

const FALLBACK_CLASS_LABELS: Record<number, string> = {
  0x0001: "Backbone",
  0x0002: "Power",
  0x0003: "Sensor",
  0x0004: "Actuator",
  0x0005: "Interface",
  0x0006: "Controller",
  0x0007: "Adapter",
};

export function nfcNodeKey(node: NfcNode): string {
  return `${node.nodeId ?? ""}\0${node.portId}\0${node.moduleTypeId ?? node.label}\0${node.uid ?? ""}`;
}

function nfcPresenceKey(node: NfcNode): string {
  return node.uid ? `uid:${node.uid}` : nfcNodeKey(node);
}

/** Empty snapshots from a periodic poll: keep the last tag once, then drop it. */
export const NFC_EMPTY_CONFIRM_POLLS = 2;

/**
 * Live presence from GET_STATUS. Appear immediately. A periodic empty list
 * must be confirmed once so a dropped field or missed RF read does not
 * flicker; a discovery-triggered refresh may drop the tag on the first empty.
 * An omitted `nfcTags` field counts as a miss so removal still clears when
 * the firmware omits the field instead of sending an empty array.
 */
export function stabilizeNfcPresence<T>(
  previous: readonly T[],
  incoming: readonly T[] | undefined,
  emptyStreak: number,
  options?: { readonly immediateLeave?: boolean },
): { readonly tags: readonly T[]; readonly emptyStreak: number } {
  if (incoming === undefined) {
    if (previous.length === 0) return { tags: [], emptyStreak: 0 };
    if (options?.immediateLeave) return { tags: [], emptyStreak: 0 };
    const omittedStreak = emptyStreak + 1;
    if (omittedStreak >= NFC_EMPTY_CONFIRM_POLLS) {
      return { tags: [], emptyStreak: 0 };
    }
    return { tags: previous, emptyStreak: omittedStreak };
  }
  if (incoming.length > 0) {
    return { tags: incoming, emptyStreak: 0 };
  }
  if (previous.length === 0) {
    return { tags: [], emptyStreak: 0 };
  }
  if (options?.immediateLeave) {
    return { tags: [], emptyStreak: 0 };
  }
  const streak = emptyStreak + 1;
  if (streak >= NFC_EMPTY_CONFIRM_POLLS) {
    return { tags: [], emptyStreak: 0 };
  }
  return { tags: previous, emptyStreak: streak };
}

/**
 * Optional hysteresis for flaky antennas. Live presence should use
 * `stabilizeNfcPresence` instead of holding a removed tag across polls.
 */
export function retainSeenNfcNodes(
  previous: readonly NfcNode[],
  incoming: readonly NfcNode[],
  misses: ReadonlyMap<string, number>,
  missLimit: number,
): { readonly nodes: readonly NfcNode[]; readonly misses: ReadonlyMap<string, number> } {
  const incomingByKey = new Map(incoming.map((node) => [nfcPresenceKey(node), node]));
  const nextMisses = new Map<string, number>();
  const nodes: NfcNode[] = [];
  const seen = new Set<string>();

  for (const node of previous) {
    const key = nfcPresenceKey(node);
    const fresh = incomingByKey.get(key);
    if (fresh) {
      nextMisses.set(key, 0);
      nodes.push(fresh);
      seen.add(key);
      continue;
    }
    const count = (misses.get(key) ?? 0) + 1;
    nextMisses.set(key, count);
    if (count < missLimit) nodes.push(node);
  }

  for (const node of incoming) {
    const key = nfcPresenceKey(node);
    if (seen.has(key)) continue;
    nextMisses.set(key, 0);
    nodes.push(node);
  }

  return { nodes, misses: nextMisses };
}

function uidHex(uid: Uint8Array | string | undefined): string | undefined {
  if (uid === undefined) return undefined;
  if (typeof uid === "string") return uid.toUpperCase();
  return Array.from(uid, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export function isSlm1Tag(tag: NfcTagInput): boolean {
  if (tag.moduleTypeId !== undefined && tag.moduleTypeId > 0) return true;
  const typeId = tag.typeId.trim().toLowerCase();
  if (GENERIC_TYPE_IDS.has(typeId)) return false;
  return TYPE_LABELS[typeId] !== undefined;
}

export function moduleTypeLabel(
  tag: Pick<NfcTagInput, "typeId" | "fallbackClass" | "moduleTypeId">,
): string {
  if (tag.fallbackClass !== undefined && FALLBACK_CLASS_LABELS[tag.fallbackClass]) {
    return FALLBACK_CLASS_LABELS[tag.fallbackClass]!;
  }
  const key = tag.typeId.trim().toLowerCase();
  if (TYPE_LABELS[key]) return TYPE_LABELS[key]!;
  if (tag.moduleTypeId && tag.moduleTypeId > 0) return `Module ${tag.moduleTypeId}`;
  return "Module";
}

export function asModulePosition(portId: number): ModulePosition | undefined {
  if (portId === 1 || portId === 2) return portId;
  return undefined;
}

function asReaderPort(portId: number): number | undefined {
  if (!Number.isInteger(portId) || portId < 0) return undefined;
  return portId;
}

export function nfcNodesForBoard(
  board: {
    readonly nodeId: number;
    readonly local: boolean;
    readonly mac: string;
    readonly deviceIdHex: string;
  },
  nodes: readonly NfcNode[],
): NfcNode[] {
  const compact = (value: string) => value.replace(/[^a-fA-F0-9]/g, "").toLowerCase();
  const boardMac = compact(board.mac);
  const boardHex = compact(board.deviceIdHex);
  return nodes.filter((node) => {
    if (node.nodeId !== undefined && node.nodeId !== 0) {
      if (node.nodeId === board.nodeId) return true;
      if (!board.local || board.nodeId !== 0) return false;
    }
    if (node.backboneMac) {
      const mac = compact(node.backboneMac);
      return mac === boardMac || mac === boardHex;
    }
    return board.local;
  });
}

/** Hardware mapping stays SLM1-only; reader displays may include unidentified tags. */
export function collectNfcNodes(
  tags: readonly NfcTagInput[] = [],
  includeUnidentified = false,
): NfcNode[] {
  const nodes: NfcNode[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    if (!isSlm1Tag(tag) && !includeUnidentified) continue;
    const portId = includeUnidentified
      ? asReaderPort(tag.portId)
      : asModulePosition(tag.portId);
    if (portId === undefined) continue;
    const label = isSlm1Tag(tag) ? moduleTypeLabel(tag) : "Tag NFC";
    const node: NfcNode = {
      portId,
      label,
      ...(tag.uid !== undefined ? { uid: uidHex(tag.uid) } : {}),
      ...(tag.nodeId !== undefined ? { nodeId: tag.nodeId } : {}),
      ...(tag.backboneMac ? { backboneMac: tag.backboneMac } : {}),
      ...(tag.backboneLabel ? { backboneLabel: tag.backboneLabel } : {}),
      ...(tag.moduleTypeId !== undefined ? { moduleTypeId: tag.moduleTypeId } : {}),
      ...(tag.fallbackClass !== undefined ? { fallbackClass: tag.fallbackClass } : {}),
    };
    const key = nfcNodeKey(node);
    if (seen.has(key)) continue;
    seen.add(key);
    nodes.push(node);
  }
  return nodes;
}

export function diffNfcNodes(
  previous: readonly NfcNode[],
  next: readonly NfcNode[],
): { readonly added: readonly NfcNode[]; readonly removed: readonly NfcNode[] } {
  const prevKeys = new Set(previous.map(nfcNodeKey));
  const nextKeys = new Set(next.map(nfcNodeKey));
  return {
    added: next.filter((node) => !prevKeys.has(nfcNodeKey(node))),
    removed: previous.filter((node) => !nextKeys.has(nfcNodeKey(node))),
  };
}

export function emptyNfcDetectQueue(): NfcDetectQueue {
  return { items: [], activeIndex: 0 };
}

/** @deprecated */
export const emptyNfcPopupQueue = emptyNfcDetectQueue;

export function enqueueNfcDetects(
  queue: NfcDetectQueue,
  events: readonly NfcDetectEvent[],
): NfcDetectQueue {
  const items = [...queue.items];
  for (const event of events) {
    if (items.some((item) => item.id === event.id)) continue;
    items.push(event);
  }
  return { items, activeIndex: items.length > 0 ? items.length - 1 : 0 };
}

/** @deprecated */
export const enqueueNfcPopups = enqueueNfcDetects;

export function dismissNfcDetect(queue: NfcDetectQueue): NfcDetectQueue {
  if (queue.items.length === 0) return queue;
  const items = queue.items.filter((_, index) => index !== queue.activeIndex);
  return {
    items,
    activeIndex: Math.min(queue.activeIndex, Math.max(0, items.length - 1)),
  };
}

/** @deprecated */
export const dismissNfcPopup = dismissNfcDetect;

export function selectNfcDetect(queue: NfcDetectQueue, index: number): NfcDetectQueue {
  if (queue.items.length === 0) return queue;
  return {
    ...queue,
    activeIndex: Math.max(0, Math.min(index, queue.items.length - 1)),
  };
}

/** @deprecated */
export const selectNfcPopup = selectNfcDetect;

export function dismissAllNfcDetects(): NfcDetectQueue {
  return emptyNfcDetectQueue();
}

/** @deprecated */
export const dismissAllNfcPopups = dismissAllNfcDetects;

export function nfcEventsFromDiff(
  backboneMac: string,
  previous: readonly NfcNode[],
  next: readonly NfcNode[],
  nextId: () => string,
): NfcDetectEvent[] {
  const { added } = diffNfcNodes(previous, next);
  return added.map((node) => ({
    id: nextId(),
    kind: "read" as const,
    node,
    backboneMac: node.backboneMac ?? backboneMac,
  }));
}
