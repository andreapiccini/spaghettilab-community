import { describe, expect, it } from "vitest";
import { nodeShellRadius, portsForKind, portsForNode } from "./node-ports.js";

describe("portsForKind", () => {
  it("schedules and event-sources only have an output", () => {
    expect(portsForKind("schedule")).toEqual({ hasInput: false, hasOutput: true });
    expect(portsForKind("event-source")).toEqual({ hasInput: false, hasOutput: true });
  });

  it("blocks have both input and output by default", () => {
    expect(portsForKind("block")).toEqual({ hasInput: true, hasOutput: true });
  });

  it("rules have no canvas ports (commands are not edges)", () => {
    expect(portsForKind("rule")).toEqual({ hasInput: false, hasOutput: false });
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
    ).toEqual({ hasInput: true, hasOutput: false });
  });

  it("Schedule is an entry source from catalog ports", () => {
    expect(
      portsForNode({
        kind: "schedule",
        moduleNodeId: "m",
        periodMs: 1000,
        enabled: true,
      }),
    ).toEqual({ hasInput: false, hasOutput: true });
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
