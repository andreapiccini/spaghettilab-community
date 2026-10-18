import { describe, expect, it } from "vitest";
import { layoutBackboneNetwork } from "../backbone-network-layout.js";

describe("layoutBackboneNetwork", () => {
  it("places Master then Slave on a horizontal chain with a host cable", () => {
    const layout = layoutBackboneNetwork(
      [
        { id: "usb", label: "Master", sublabel: "Cavo", local: true, hostLink: "usb" },
        {
          id: "can",
          label: "Slave 1",
          sublabel: "Catena",
          local: false,
          hostLink: "can",
        },
      ],
      new Map(),
    );
    const boards = layout.nodes.filter((n) => n.kind === "backbone");
    const host = layout.nodes.find((n) => n.kind === "host");
    expect(boards).toHaveLength(2);
    expect(boards[0]!.x).toBeLessThan(boards[1]!.x);
    expect(boards[0]!.label).toBe("Master");
    expect(boards[1]!.label).toBe("Slave 1");
    expect(host).toBeDefined();
    expect(host!.x).toBeLessThan(boards[0]!.x);
    expect(layout.edges.some((e) => e.kind === "host" && e.to === "usb")).toBe(true);
    expect(
      layout.edges.some((e) => e.kind === "can" && e.from === "usb" && e.to === "can"),
    ).toBe(true);
    expect(layout.nodes.filter((n) => n.kind === "nfc" || n.kind === "nfc-empty")).toHaveLength(0);
  });

  it("keeps identified NFC nodes on the dedicated reader, not on a Backbone", () => {
    const tags = [
      { portId: 1, label: "sense-dial" },
      { portId: 2, label: "relay" },
    ];
    const layout = layoutBackboneNetwork(
      [
        { id: "usb", label: "Master", sublabel: "Cavo", local: true, hostLink: "usb" },
        {
          id: "reader",
          label: "Lettore NFC",
          sublabel: "",
          local: false,
          hostLink: "can",
          productKind: "nfc-reader",
        },
      ],
      new Map([
        ["usb", tags],
        ["reader", tags],
      ]),
    );
    expect(layout.nodes.filter((n) => n.parentId === "usb" && (n.kind === "nfc" || n.kind === "nfc-empty"))).toHaveLength(0);
    const nfc = layout.nodes.filter((n) => n.kind === "nfc");
    expect(nfc).toHaveLength(2);
    expect(nfc.every((n) => n.parentId === "reader" && n.y < 168)).toBe(true);
    expect(nfc.map((n) => n.sublabel)).toEqual(["1", "2"]);
    expect(layout.nodes.some((n) => n.kind === "nfc-empty")).toBe(false);
  });
  it("shows an NFC-only peripheral separately from hardware Backbones", () => {
    const layout = layoutBackboneNetwork(
      [
        { id: "master", label: "Master", sublabel: "", local: true, hostLink: "usb" },
        {
          id: "reader",
          label: "Modulo NFC",
          sublabel: "",
          local: false,
          hostLink: "can",
          productKind: "nfc-reader",
        },
      ],
      new Map(),
    );
    expect(layout.nodes.filter((node) => node.kind === "backbone")).toHaveLength(1);
    expect(layout.nodes.find((node) => node.id === "reader")?.kind).toBe("nfc-reader");
    expect(
      layout.edges.some((edge) => edge.kind === "can" && edge.to === "reader"),
    ).toBe(true);
    expect(
      layout.edges.some((edge) => edge.kind === "host" && edge.to === "reader"),
    ).toBe(false);
  });
});
