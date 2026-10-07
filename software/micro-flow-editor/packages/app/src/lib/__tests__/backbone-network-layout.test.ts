import { describe, expect, it } from "vitest";
import { layoutBackboneNetwork } from "../backbone-network-layout.js";

describe("layoutBackboneNetwork", () => {
  it("places Master then Slave on a horizontal chain with a host cable", () => {
    const layout = layoutBackboneNetwork(
      [
        { id: "usb", label: "Master", sublabel: "Cavo", local: true, hostLink: "usb" },
        { id: "can", label: "Slave 1", sublabel: "Catena", local: false, hostLink: "can" },
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
    expect(layout.edges.some((e) => e.kind === "can" && e.from === "usb" && e.to === "can")).toBe(true);
    expect(layout.nodes.filter((n) => n.kind === "nfc-empty")).toHaveLength(2);
  });

  it("fans identified NFC nodes above their backbone with their positions", () => {
    const layout = layoutBackboneNetwork(
      [{ id: "usb", label: "Master", sublabel: "Cavo", local: true, hostLink: "usb" }],
      new Map([["usb", [{ portId: 1, label: "sense-dial" }, { portId: 2, label: "relay" }]]]),
    );
    const nfc = layout.nodes.filter((n) => n.kind === "nfc");
    expect(nfc).toHaveLength(2);
    expect(nfc.every((n) => n.y < 168)).toBe(true);
    expect(nfc.map((n) => n.sublabel)).toEqual(["1", "2"]);
    expect(layout.nodes.some((n) => n.kind === "nfc-empty")).toBe(false);
  });
});
