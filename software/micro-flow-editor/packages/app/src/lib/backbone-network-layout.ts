import type { NfcNode } from "./nfc-presence.js";

export type HostLinkKind = "usb" | "wifi" | "can";

export type NetworkBoard = {
  readonly id: string;
  readonly label: string;
  readonly sublabel: string;
  readonly local: boolean;
  readonly hostLink: HostLinkKind;
};

export type NetworkLaidNode = {
  readonly id: string;
  readonly kind: "host" | "backbone" | "nfc" | "nfc-empty";
  readonly x: number;
  readonly y: number;
  readonly r: number;
  readonly label: string;
  readonly sublabel: string;
  readonly hostLink?: HostLinkKind;
  readonly parentId?: string;
};

export type NetworkLaidEdge = {
  readonly id: string;
  readonly kind: "host" | "can" | "nfc";
  readonly from: string;
  readonly to: string;
};

export type BackboneNetworkLayout = {
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly NetworkLaidNode[];
  readonly edges: readonly NetworkLaidEdge[];
};

const BOARD_R = 36;
const HOST_R = 18;
const NFC_R = 15;
const EMPTY_R = 12;
const BOARD_Y = 168;
const NFC_LIFT = 88;
const GAP_X = 220;
const HOST_GAP = 92;
const PAD_X = 160;
const MIN_WIDTH = 640;
const HEIGHT = 260;

export function layoutBackboneNetwork(
  boards: readonly NetworkBoard[],
  nfcByBoardId: ReadonlyMap<string, readonly NfcNode[]>,
): BackboneNetworkLayout {
  const count = Math.max(boards.length, 1);
  const width = Math.max(PAD_X * 2 + (count - 1) * GAP_X, MIN_WIDTH);
  const usable = width - PAD_X * 2;
  const nodes: NetworkLaidNode[] = [];
  const edges: NetworkLaidEdge[] = [];

  boards.forEach((board, index) => {
    const x = count === 1 ? width / 2 : PAD_X + (usable * index) / (count - 1);
    nodes.push({
      id: board.id,
      kind: "backbone",
      x,
      y: BOARD_Y,
      r: BOARD_R,
      label: board.label,
      sublabel: board.sublabel,
      hostLink: board.hostLink,
    });
    if (board.local && (board.hostLink === "usb" || board.hostLink === "wifi")) {
      const hostId = `${board.id}-host`;
      nodes.push({
        id: hostId,
        kind: "host",
        x: x - HOST_GAP,
        y: BOARD_Y,
        r: HOST_R,
        label: "",
        sublabel: "",
        hostLink: board.hostLink,
        parentId: board.id,
      });
      edges.push({ id: `host-${board.id}`, kind: "host", from: hostId, to: board.id });
    }
    if (index > 0) {
      const prev = boards[index - 1]!;
      edges.push({ id: `can-${prev.id}-${board.id}`, kind: "can", from: prev.id, to: board.id });
    }

    const nfc = nfcByBoardId.get(board.id) ?? [];
    if (nfc.length === 0) {
      const emptyId = `${board.id}-nfc-empty`;
      nodes.push({
        id: emptyId,
        kind: "nfc-empty",
        x,
        y: BOARD_Y - NFC_LIFT,
        r: EMPTY_R,
        label: "",
        sublabel: "",
        parentId: board.id,
      });
      edges.push({ id: `nfc-${emptyId}`, kind: "nfc", from: board.id, to: emptyId });
      return;
    }

    const span = Math.min(70, 18 * (nfc.length - 1));
    nfc.forEach((node, i) => {
      const t = nfc.length === 1 ? 0.5 : i / (nfc.length - 1);
      const angle = ((t - 0.5) * span * Math.PI) / 180;
      const id = `${board.id}-nfc-${node.portId}-${node.label}`;
      nodes.push({
        id,
        kind: "nfc",
        x: x + Math.sin(angle) * 46,
        y: BOARD_Y - NFC_LIFT + (1 - Math.cos(angle)) * 18,
        r: NFC_R,
        label: node.label,
        sublabel: "",
        parentId: board.id,
      });
      edges.push({ id: `nfc-${id}`, kind: "nfc", from: board.id, to: id });
    });
  });

  return { width: Math.max(width, 160), height: HEIGHT, nodes, edges };
}
