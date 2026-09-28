export type NfcNode = {
  readonly portId: number;
  readonly label: string;
  readonly uid?: string;
  readonly nodeId?: number;
  readonly backboneMac?: string;
};

export type NfcTagInput = {
  readonly portId: number;
  readonly typeId: string;
  readonly uid?: Uint8Array | string;
  readonly nodeId?: number;
  readonly backboneMac?: string;
};

export type NfcPopupKind = "read";

export type NfcPopupEvent = {
  readonly id: string;
  readonly kind: NfcPopupKind;
  readonly node: NfcNode;
  readonly backboneMac: string;
};

export type NfcPopupQueue = {
  readonly items: readonly NfcPopupEvent[];
  readonly activeIndex: number;
};

export function nfcNodeKey(node: NfcNode): string {
  return `${node.nodeId ?? ""}\0${node.portId}\0${node.label}\0${node.uid ?? ""}`;
}

function uidHex(uid: Uint8Array | string | undefined): string | undefined {
  if (uid === undefined) return undefined;
  if (typeof uid === "string") return uid.toUpperCase();
  return Array.from(uid, (byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function nfcLabel(typeId: string): string {
  const label = typeId.trim();
  if (label === "t2t" || label === "t4t" || label === "tag") return "Tag NFC";
  return label;
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

export function collectNfcNodes(
  modules: readonly { readonly portId: number; readonly typeId: string }[],
  candidates: readonly { readonly portId: number; readonly suggestedTypeId: string }[],
  tags: readonly NfcTagInput[] = [],
): NfcNode[] {
  const nodes: NfcNode[] = [];
  const seen = new Set<string>();
  for (const tag of tags) {
    const label = nfcLabel(tag.typeId);
    if (!label) continue;
    const node = {
      portId: tag.portId,
      label,
      ...(tag.uid !== undefined ? { uid: uidHex(tag.uid) } : {}),
      ...(tag.nodeId !== undefined ? { nodeId: tag.nodeId } : {}),
      ...(tag.backboneMac ? { backboneMac: tag.backboneMac } : {}),
    };
    const key = nfcNodeKey(node);
    if (seen.has(key)) continue;
    seen.add(key);
    nodes.push(node);
  }
  for (const module of modules) {
    const label = nfcLabel(module.typeId);
    if (!label) continue;
    const node = { portId: module.portId, label };
    const key = nfcNodeKey(node);
    if (seen.has(key)) continue;
    seen.add(key);
    nodes.push(node);
  }
  for (const candidate of candidates) {
    const label = nfcLabel(candidate.suggestedTypeId);
    if (!label) continue;
    const node = { portId: candidate.portId, label };
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

export function emptyNfcPopupQueue(): NfcPopupQueue {
  return { items: [], activeIndex: 0 };
}

export function enqueueNfcPopups(
  queue: NfcPopupQueue,
  events: readonly NfcPopupEvent[],
): NfcPopupQueue {
  const items = [...queue.items];
  for (const event of events) {
    if (items.some((item) => item.id === event.id)) continue;
    items.push(event);
  }
  return { items, activeIndex: queue.activeIndex };
}

export function dismissNfcPopup(queue: NfcPopupQueue): NfcPopupQueue {
  if (queue.items.length === 0) return queue;
  const items = queue.items.filter((_, index) => index !== queue.activeIndex);
  return {
    items,
    activeIndex: Math.min(queue.activeIndex, Math.max(0, items.length - 1)),
  };
}

export function selectNfcPopup(queue: NfcPopupQueue, index: number): NfcPopupQueue {
  if (queue.items.length === 0) return queue;
  return {
    ...queue,
    activeIndex: Math.max(0, Math.min(index, queue.items.length - 1)),
  };
}

export function dismissAllNfcPopups(): NfcPopupQueue {
  return emptyNfcPopupQueue();
}

export function nfcEventsFromDiff(
  backboneMac: string,
  previous: readonly NfcNode[],
  next: readonly NfcNode[],
  nextId: () => string,
): NfcPopupEvent[] {
  const { added } = diffNfcNodes(previous, next);
  return added.map((node) => ({
    id: nextId(),
    kind: "read" as const,
    node,
    backboneMac: node.backboneMac ?? backboneMac,
  }));
}
