export type NfcNode = {
  readonly portId: number;
  readonly label: string;
  readonly nodeId?: number;
  readonly backboneMac?: string;
};

export type NfcTagInput = {
  readonly portId: number;
  readonly typeId: string;
  readonly nodeId?: number;
  readonly backboneMac?: string;
};

export type NfcPopupKind = "connected" | "removed";

export type NfcPopupEvent = {
  readonly id: string;
  readonly kind: NfcPopupKind;
  readonly node: NfcNode;
  readonly backboneMac: string;
};

export type NfcPopupQueue = {
  readonly current: NfcPopupEvent | null;
  readonly pending: readonly NfcPopupEvent[];
};

export function nfcNodeKey(node: NfcNode): string {
  return `${node.nodeId ?? ""}\0${node.portId}\0${node.label}`;
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
  return { current: null, pending: [] };
}

function popupIdentity(event: Pick<NfcPopupEvent, "kind" | "node" | "backboneMac">): string {
  return `${event.kind}\0${event.backboneMac}\0${nfcNodeKey(event.node)}`;
}

function alreadyQueued(queue: NfcPopupQueue, event: Pick<NfcPopupEvent, "kind" | "node" | "backboneMac">): boolean {
  const id = popupIdentity(event);
  if (queue.current && popupIdentity(queue.current) === id) return true;
  return queue.pending.some((item) => popupIdentity(item) === id);
}

export function enqueueNfcPopups(queue: NfcPopupQueue, events: readonly NfcPopupEvent[]): NfcPopupQueue {
  const pending = [...queue.pending];
  let current = queue.current;
  for (const event of events) {
    if (alreadyQueued({ current, pending }, event)) continue;
    if (current === null) current = event;
    else pending.push(event);
  }
  return { current, pending };
}

export function dismissNfcPopup(queue: NfcPopupQueue): NfcPopupQueue {
  if (queue.current === null) return queue;
  const [next, ...rest] = queue.pending;
  return { current: next ?? null, pending: rest };
}

export function nfcEventsFromDiff(
  backboneMac: string,
  previous: readonly NfcNode[],
  next: readonly NfcNode[],
  nextId: () => string,
): NfcPopupEvent[] {
  const { added, removed } = diffNfcNodes(previous, next);
  return [
    ...added.map((node) => ({
      id: nextId(),
      kind: "connected" as const,
      node,
      backboneMac: node.backboneMac ?? backboneMac,
    })),
    ...removed.map((node) => ({
      id: nextId(),
      kind: "removed" as const,
      node,
      backboneMac: node.backboneMac ?? backboneMac,
    })),
  ];
}
