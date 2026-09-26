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
    expect(nodes.find((n) => n.id === "if1")?.data.inputHandles?.[0]?.kind).toBe("digital");
    expect(nodes.find((n) => n.id === "if1")?.data.outputHandles?.[0]?.kind).toBe("digital");
    expect(nodes.find((n) => n.id === "if2")?.data.subtitle).toBe("TEMP ≥ 25°");
    expect(nodes.find((n) => n.id === "if2")?.data.ifInput?.kind).toBe("analog");
    expect(nodes.find((n) => n.id === "if2")?.data.inputHandles?.[0]?.kind).toBe("analog");
    expect(nodes.find((n) => n.id === "if3")?.data.subtitle).toBe("No input");
    expect(nodes.find((n) => n.id === "if3")?.data.ifInput?.kind).toBe("digital");
  });

  it("shows the relay close condition on the card", () => {
    const graphState: GraphState<"device-processing"> = {
      layer: "device-processing",
      nodes: [
        {
          layer: "device-processing",
          id: "r1",
          data: { kind: "block", blockTypeId: "ab.relay", catalogEntryId: "appblocks.relay", properties: {} },
        },
        {
          layer: "device-processing",
          id: "r2",
          data: { kind: "block", blockTypeId: "ab.relay", catalogEntryId: "appblocks.relay", properties: { closeWhen: "low" } },
        },
      ],
      edges: [],
    };
    const nodes = toProcessingNodes(graphState, {}, new Set(), () => "Module", undefined, new Set(), "en");
    expect(nodes.find((n) => n.id === "r1")?.data.subtitle).toBe("closed if HIGH");
    expect(nodes.find((n) => n.id === "r1")?.data.cardHeight).toBe(80);
    expect(nodes.find((n) => n.id === "r1")?.data.relayClose).toEqual({ closeWhenHigh: true, label: "closed if HIGH" });
    expect(nodes.find((n) => n.id === "r2")?.data.subtitle).toBe("closed if LOW");
    expect(nodes.find((n) => n.id === "r2")?.data.relayClose?.closeWhenHigh).toBe(false);
  });

  it("leaves Digital Toggle without a subtitle line", () => {
    const graphState: GraphState<"device-processing"> = {
      layer: "device-processing",
      nodes: [
        {
          layer: "device-processing",
          id: "t1",
          data: { kind: "block", blockTypeId: "ab.digital_out_toggle", catalogEntryId: "appblocks.digital_out_toggle", properties: {} },
        },
      ],
      edges: [],
    };
    const nodes = toProcessingNodes(graphState, {}, new Set(), () => "Module", undefined, new Set(), "en");
    const toggle = nodes.find((n) => n.id === "t1");
    expect(toggle?.data.subtitle).toBe("");
    expect(toggle?.data.settingsFooter?.tabs.map((tab) => tab.id)).toEqual(["toggleMode", "initial", "lowToHigh", "highToLow"]);
    expect(toggle?.data.cardHeight).toBe(80);
  });

  it("puts LED timings on a settings footer", () => {
    const graphState: GraphState<"device-processing"> = {
      layer: "device-processing",
      nodes: [
        {
          layer: "device-processing",
          id: "led",
          data: { kind: "block", blockTypeId: "ab.led", catalogEntryId: "appblocks.led", properties: { color: "#F5C518" } },
        },
      ],
      edges: [],
    };
    const led = toProcessingNodes(graphState, {}, new Set(), () => "Module", undefined, new Set(), "en").find((n) => n.id === "led");
    expect(led?.data.settingsFooter?.tabs.map((tab) => tab.id)).toEqual(["color", "delayOnMs", "delayOffMs", "softOnMs", "softOffMs"]);
    expect(led?.data.cardHeight).toBe(80);
    expect(led?.data.cardWidth).toBe(260);
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
