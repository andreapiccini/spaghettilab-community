import { expect, it } from "vitest";
import type { ProjectV1 } from "@spaghettilab/domain";
import { compileConfig } from "@spaghettilab/config-compiler";
import { findCatalogEntryById } from "@spaghettilab/processing-block-catalog";
import { prepareDriverDeployment } from "../driver-deployment-plan.js";
import { DISABLED_MQTT, DEFAULT_ENERGY } from "../default-config-policy.js";
import { generatorColorKind } from "../data-viewer.js";

it("compiles color input and three separately observable RGB channels", () => {
 const entry = findCatalogEntryById("native.color_split")!;
 expect(entry.inputs[0]?.label).toBe("Colore");
 expect(entry.outputs.map(port => port.label)).toEqual(["Rosso (%)", "Verde (%)", "Blu (%)"]);
 const physicalGraph = { layer: "physical-composition" as const, nodes: [], edges: [] };
 const processingGraph = { layer: "device-processing" as const, nodes: [
  { id: "colors", layer: "device-processing" as const, data: { kind: "block" as const, blockTypeId: "led_driver", properties: {} } },
  { id: "split", layer: "device-processing" as const, data: { kind: "block" as const, blockTypeId: "color_split", properties: {} } },
  ...[1,2,3].map(i => ({ id: `view${i}`, layer: "device-processing" as const, data: {kind: "block" as const, blockTypeId: "ui.data_viewer", properties: {} } })),
 ], edges: [
  { id: "color", source: "colors", sourceHandle: "0", target: "split", targetHandle: "0" },
  ...[1,2,3].map(i => ({ id: `channel${i}`, source: "split", sourceHandle: String(i), target: `view${i}`, targetHandle: "0" })),
 ] };
 const project = {coreBindings: [{bindingId:"master"}], authoringMetadata:{}, physicalGraphs:[physicalGraph],deviceGraphs:[processingGraph]} as unknown as ProjectV1;
 const plan = prepareDriverDeployment(project,"master",{physicalGraph,processingGraph,mqtt:DISABLED_MQTT,energy:DEFAULT_ENERGY,connectivity:0});
 const compiled = compileConfig(plan.input,plan.options);
 expect(compiled.ok).toBe(true);
 if (!compiled.ok) return;
 expect(compiled.value.blocks.some(block => block.typeId === "color_split")).toBe(true);
 expect(plan.observations?.map(item => item.colorKind)).toEqual(["red","green","blue"]);
 expect([1,2,3].map(i => generatorColorKind("color_split",String(i)))).toEqual(["red","green","blue"]);
});
