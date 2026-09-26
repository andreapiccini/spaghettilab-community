import type { GraphState } from "@spaghettilab/domain";
import { describe, expect, it } from "vitest";
import { toProcessingNodes } from "./to-nodes.js";

describe("toProcessingNodes", () => {
  it("puts the live IF condition in the gray subtitle, including the wired input name", () => {
    const graphState: GraphState<"device-processing"> = {
      layer: "device-processing",
      nodes: [
        { layer: "device-processing", id: "src", data: { kind: "block", blockTypeId: "scale_offset", properties: {} } },
        { layer: "device-processing", id: "iff", data: { kind: "block", blockTypeId: "threshold", properties: { "1": 30n } } },
      ],
      edges: [{ layer: "device-processing", id: "e1", source: "src", target: "iff" }],
    };
    const nodes = toProcessingNodes(
      graphState,
      {
        src: { comment: "var", position: { x: 0, y: 0 } },
        iff: { comment: "IF Condition", position: { x: 0, y: 80 } },
      },
      new Set(),
      () => "Module",
    );
    const iff = nodes.find((n) => n.id === "iff");
    expect(iff?.data.label).toBe("IF Condition");
    expect(iff?.data.subtitle).toBe("var ≥ 30");
  });

  it("shows named authoring fields on Debug Print and On Boot", () => {
    const graphState: GraphState<"device-processing"> = {
      layer: "device-processing",
      nodes: [
        { layer: "device-processing", id: "boot", data: { kind: "event-source", moduleNodeId: "", catalogEntryId: "appblocks.system", properties: {} } },
        {
          layer: "device-processing",
          id: "dbg",
          data: { kind: "block", blockTypeId: "ab.debug", catalogEntryId: "appblocks.debug", properties: { message: "hello" } },
        },
      ],
      edges: [],
    };
    const nodes = toProcessingNodes(
      graphState,
      {
        boot: { position: { x: 0, y: 0 } },
        dbg: { position: { x: 0, y: 80 } },
      },
      new Set(),
      () => "Module",
    );
    expect(nodes.find((n) => n.id === "boot")?.data.label).toBe("On Boot");
    expect(nodes.find((n) => n.id === "dbg")?.data.label).toBe("Debug Print");
    expect(nodes.find((n) => n.id === "dbg")?.data.subtitle).toBe("hello");
  });

  it("attaches static handles so wires survive a node-object rebuild", () => {
    const graphState: GraphState<"device-processing"> = {
      layer: "device-processing",
      nodes: [{ layer: "device-processing", id: "src", data: { kind: "block", blockTypeId: "scale_offset", properties: {} } }],
      edges: [],
    };
    const [node] = toProcessingNodes(graphState, { src: { position: { x: 0, y: 0 } } }, new Set(), () => "Module");
    expect(node?.handles?.some((h) => h.type === "source")).toBe(true);
    expect(node?.handles?.some((h) => h.type === "target")).toBe(true);
  });
});
