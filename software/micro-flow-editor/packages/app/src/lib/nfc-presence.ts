export type ModulePosition = 1 | 2;

export type NfcNode = {
  readonly portId: ModulePosition;
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

export function moduleTypeLabel(tag: Pick<NfcTagInput, "typeId" | "fallbackClass" | "moduleTypeId">): string {
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

/** Collect only SLM1-validated module tags from GET_STATUS `nfcTags`. */
export function collectNfcNodes(tags: readonly NfcTagInput[] = []): NfcNode[] {
  const nodes: NfcNode[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    if (!isSlm1Tag(tag)) continue;
    const portId = asModulePosition(tag.portId);
    if (portId === undefined) continue;
    const label = moduleTypeLabel(tag);
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
