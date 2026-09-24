import { describe, expect, it } from "vitest";
import { nodeHeightForPorts, nodeShellRadius, portsForKind, portsForNode } from "./node-ports.js";
import { NODE_HEIGHT } from "./layout-constants.js";

describe("portsForKind", () => {
  it("schedules and event-sources only have an output", () => {
    expect(portsForKind("schedule")).toEqual({
      hasInput: false,
      hasOutput: true,
      inputs: [],
      outputs: [{ id: "0" }],
    });
    expect(portsForKind("event-source")).toEqual({
      hasInput: false,
      hasOutput: true,
      inputs: [],
      outputs: [{ id: "0" }],
    });
  });

  it("blocks have both input and output by default", () => {
    expect(portsForKind("block")).toEqual({
      hasInput: true,
      hasOutput: true,
      inputs: [{ id: "0" }],
      outputs: [{ id: "0" }],
    });
  });

  it("rules have no canvas ports (commands are not edges)", () => {
    expect(portsForKind("rule")).toEqual({ hasInput: false, hasOutput: false, inputs: [], outputs: [] });
  });
});

describe("portsForNode", () => {
  it("LED is a sink (input only) from catalog ports", () => {
    expect(
      portsForNode({
        kind: "block",
        blockTypeId: "ab.led",
        catalogEntryId: "appblocks.led",
        properties: {},
      }),
    ).toMatchObject({ hasInput: true, hasOutput: false, inputs: [{ id: "0" }], outputs: [] });
  });

  it("Schedule is an entry source from catalog ports", () => {
    expect(
      portsForNode({
        kind: "schedule",
        moduleNodeId: "m",
        periodMs: 1000,
        enabled: true,
      }),
    ).toMatchObject({ hasInput: false, hasOutput: true });
  });

  it("Terminal block exposes six channel outputs", () => {
    const ports = portsForNode({
      kind: "block",
      blockTypeId: "ab.terminal_block",
      catalogEntryId: "appblocks.terminal_block",
      properties: { ch3Name: "Sensore A" },
    });
    expect(ports.hasInput).toBe(false);
    expect(ports.outputs).toHaveLength(6);
    expect(ports.outputs.map((p) => p.label)).toEqual(["CH1", "CH2", "Sensore A", "CH4", "CH5", "CH6"]);
    expect(nodeHeightForPorts(ports)).toBeGreaterThan(NODE_HEIGHT);
  });
});

describe("nodeShellRadius", () => {
  it("rounds only the bottom-left; closed when no input", () => {
    expect(nodeShellRadius({ hasInput: false, hasOutput: true })).toBe("2px 2px 2px 28px");
  });

  it("opens the left side when the card has an input", () => {
    expect(nodeShellRadius({ hasInput: true, hasOutput: false })).toBe("2px 2px 2px 12px");
  });

  it("keeps the same radii for dual-port and closed cards", () => {
    expect(nodeShellRadius({ hasInput: true, hasOutput: true })).toBe("2px 2px 2px 12px");
    expect(nodeShellRadius({ hasInput: false, hasOutput: false })).toBe("2px 2px 2px 28px");
  });
});
