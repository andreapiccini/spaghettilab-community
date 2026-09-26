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

  it("shows the IF compare on the card from the wired input", () => {
    const graphState: GraphState<"device-processing"> = {
      layer: "device-processing",
      nodes: [
        {
          layer: "device-processing",
          id: "t1",
          data: { kind: "block", blockTypeId: "ab.digital_out_toggle", catalogEntryId: "appblocks.digital_out_toggle", properties: {} },
        },
        {
          layer: "device-processing",
          id: "temp1",
          data: { kind: "block", blockTypeId: "ab.temperature_sensor", catalogEntryId: "appblocks.temperature_sensor", properties: { testC: 22 } },
        },
        {
          layer: "device-processing",
          id: "if1",
          data: {
            kind: "block",
            blockTypeId: "ab.compare_if",
            catalogEntryId: "appblocks.compare_if",
            properties: { compare: "eq", compareLevel: "high", thenOutput: "high" },
          },
        },
        {
          layer: "device-processing",
          id: "if2",
          data: {
            kind: "block",
            blockTypeId: "ab.compare_if",
            catalogEntryId: "appblocks.compare_if",
            properties: { compare: "gte", compareTempC: 25, thenOutput: "high" },
          },
        },
        {
          layer: "device-processing",
          id: "if3",
          data: { kind: "block", blockTypeId: "ab.compare_if", catalogEntryId: "appblocks.compare_if", properties: {} },
        },
      ],
      edges: [
        { layer: "device-processing", id: "e1", source: "t1", target: "if1" },
        { layer: "device-processing", id: "e2", source: "temp1", target: "if2" },
      ],
    };
    const nodes = toProcessingNodes(graphState, {}, new Set(), () => "Module", undefined, new Set(), "en");
    expect(nodes.find((n) => n.id === "if1")?.data.subtitle).toBe("TGL = HIGH");
    expect(nodes.find((n) => n.id === "if1")?.data.ifOutput?.thenElse).toBe("then HIGH · else LOW");
    expect(nodes.find((n) => n.id === "if1")?.data.ifInput?.kind).toBe("digital");
    expect(nodes.find((n) => n.id === "if2")?.data.subtitle).toBe("TEMP ≥ 25°");
    expect(nodes.find((n) => n.id === "if2")?.data.ifInput?.kind).toBe("analog");
    expect(nodes.find((n) => n.id === "if3")?.data.subtitle).toBe("No input");
    expect(nodes.find((n) => n.id === "if3")?.data.ifInput?.kind).toBe("digital");
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
