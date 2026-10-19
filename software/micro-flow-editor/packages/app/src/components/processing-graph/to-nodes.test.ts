import type { GraphState } from "@spaghettilab/domain";
import { findCatalogEntryById } from "@spaghettilab/processing-block-catalog";
import { describe, expect, it } from "vitest";
import { nodeDataFromCatalogEntry } from "./catalog-to-node.js";
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
    expect(nodes.find((n) => n.id === "t1")?.data.subtitle).toBe("");
  });

  it("shows period and duty on Square wave", () => {
    const graphState: GraphState<"device-processing"> = {
      layer: "device-processing",
      nodes: [
        {
          layer: "device-processing",
          id: "sq",
          data: { kind: "block", blockTypeId: "ab.square_wave", catalogEntryId: "appblocks.square_wave", properties: { periodMs: 500, dutyCycle: 50 } },
        },
      ],
      edges: [],
    };
    const nodes = toProcessingNodes(graphState, {}, new Set(), () => "Module", undefined, new Set(), "en");
    expect(nodes.find((n) => n.id === "sq")?.data.subtitle).toBe("On 0.25 s · off 0.25 s");
    expect(nodes.find((n) => n.id === "sq")?.data.toggleWave).toMatchObject({
      mode: "pulse_high",
      pulseMs: 250,
    });
  });

  it("builds Square wave from catalog defaults (bigint period/duty) without a target handle", () => {
    const entry = findCatalogEntryById("appblocks.square_wave");
    const data = entry ? nodeDataFromCatalogEntry(entry, undefined) : null;
    expect(data?.kind).toBe("block");
    if (!data || data.kind !== "block") throw new Error("expected square wave block");
    expect(typeof data.properties.periodMs).toBe("bigint");
    expect(typeof data.properties.dutyCycle).toBe("bigint");
    const graphState: GraphState<"device-processing"> = {
      layer: "device-processing",
      nodes: [{ layer: "device-processing", id: "sq", data }],
      edges: [],
    };
    const [node] = toProcessingNodes(graphState, {}, new Set(), () => "Module", undefined, new Set(), "en");
    expect(node?.data.subtitle).toBe("On 0.25 s · off 0.25 s");
    expect(node?.data.toggleWave).toMatchObject({ mode: "pulse_high", pulseMs: 250 });
    expect(node?.data.hasInput).toBe(false);
    expect(node?.handles?.some((handle) => handle.type === "target")).toBe(false);
    expect(node?.handles?.some((handle) => handle.type === "source")).toBe(true);
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

it("gives both signal generator modes the same card dimensions and correct output handles", () => {
  const data = ["appblocks.manual_trigger", "appblocks.square_wave"].map(id => nodeDataFromCatalogEntry(findCatalogEntryById(id)!, undefined)!);
  const graph: GraphState<"device-processing"> = { layer: "device-processing", nodes: data.map((data, index) => ({ layer: "device-processing", id: `generator-${index}`, data })), edges: [] };
  const nodes = toProcessingNodes(graph, {}, new Set(), () => "Module");
  expect(nodes.map(node => [node.width, node.height])).toEqual([[210,118], [210,118]]);
  expect(nodes[0]?.data.manualTrigger).toBeDefined();
  expect(nodes[1]?.data.signalGenerator).toMatchObject({ onMs: 250, offMs: 250 });
  expect(nodes[0]?.handles?.[0]?.id).toBe("trigger");
  expect(nodes[1]?.handles?.[0]?.id).toBe("0");
});

it("labels the IF input with the selected output rather than the device name", () => {
  const graph: GraphState<"device-processing"> = {layer:"device-processing",nodes:[
    {layer:"device-processing",id:"sensor",data:{kind:"block",blockTypeId:"ab.backbone_sensor",catalogEntryId:"appblocks.backbone_sensor",properties:{sensorChip:"DS18B20",sensorChannelsJson:JSON.stringify([
      {id:"temperature",label:"Temperatura",direction:"read",dataType:"int",unit:"°C",quantity:"temperature"},
      {id:"humidity",label:"Umidità",direction:"read",dataType:"int",unit:"%",quantity:"humidity"},
    ])}}},
    {layer:"device-processing",id:"if",data:{kind:"block",blockTypeId:"logic_if",catalogEntryId:"logic.if",properties:{condition:"1",value:0}}},
  ],edges:[{layer:"device-processing",id:"wire",source:"sensor",sourceHandle:"temperature",target:"if",targetHandle:"0"}]};
  const nodes=toProcessingNodes(graph,{sensor:{comment:"DS18B20"}},new Set(),()=>"Module");
  expect(nodes.find(n=>n.id==="if")?.data.subtitle).toContain("Temperatura");
  expect(nodes.find(n=>n.id==="if")?.data.subtitle).not.toContain("DS18B20");
  const humidity=toProcessingNodes({...graph,edges:[{...graph.edges[0]!,sourceHandle:"humidity"}]},{sensor:{comment:"DS18B20"}},new Set(),()=>"Module");
  expect(humidity.find(n=>n.id==="if")?.data.subtitle).toContain("Umidità");
});
