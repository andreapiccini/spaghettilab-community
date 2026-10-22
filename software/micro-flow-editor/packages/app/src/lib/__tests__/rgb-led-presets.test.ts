import { expect, it } from "vitest";
import type { ProjectV1 } from "@spaghettilab/domain";
import type { CompileConfigInput } from "@spaghettilab/config-compiler";
import { compileConfig } from "@spaghettilab/config-compiler";
import { DISABLED_MQTT, DEFAULT_ENERGY } from "@spaghettilab/protocol-sdk";
import { lowerRgbLedPresets, migrateRgbLedGenerators } from "../rgb-led-presets.js";
import { defaultLedDriver } from "../led-driver.js";
import { rgbModuleDraft } from "../rgb-module.js";
import { planModuleImport, commitModuleImport } from "../module-import.js";
import { prepareDriverDeployment } from "../driver-deployment-plan.js";
import { channelsFromNodeProperties } from "../backbone-sensor-block.js";
function setup() {
  const project = { coreBindings: [{ bindingId: "master", expectedDeviceId: "board", connectionProfileId: "usb" }],
    physicalGraphs: [{ layer: "physical-composition", nodes: [], edges: [] }],
    deviceGraphs: [{ layer: "device-processing", nodes: [], edges: [] }], authoringMetadata: {} } as unknown as ProjectV1;
  const installed = commitModuleImport(project, planModuleImport(project, "master", "master:board", rgbModuleDraft(), {
    name: "Function", variant: "v1", modes: [0, 0, 0, 0], i2cSpeed: 0, local: true, backendPortId: 0,
  }), "rgb", false, true);
  const led = installed.deviceGraphs[0]!.nodes[0]!;
  const graph = { ...installed.deviceGraphs[0]!, nodes: [...installed.deviceGraphs[0]!.nodes,
    { layer: "device-processing", id: "button", data: { kind: "block", blockTypeId: "ui.manual_trigger", properties: {} } }],
    edges: [{ layer: "device-processing", id: "trigger", source: "button", sourceHandle: "trigger", target: led.id, targetHandle: "preset:0" }],
  } as CompileConfigInput["processingGraph"];
  return { installed, led, graph };
}
it("exposes colored preset triggers on the LED and lowers them exactly once", () => {
  const { graph, led } = setup();
  const channels = channelsFromNodeProperties((led.data as { properties: Record<string, unknown> }).properties);
  expect(channels.slice(0, 2).map(channel => channel.id)).toEqual(["preset:0", "preset:1"]);
  const lowered = lowerRgbLedPresets(graph);
  expect(lowered.nodes).toHaveLength(graph.nodes.length + 1);
  expect(lowered.edges.find(edge => edge.id === "trigger")).toMatchObject({ target: `rgb-presets:${led.id}`, targetHandle: "0" });
  expect(lowered.edges.find(edge => edge.target === led.id)).toMatchObject({ targetHandle: "color-input" });
  expect(lowerRgbLedPresets(lowered)).toEqual(lowered);
});
it("compiles an integrated preset to a real RGB driver and native state-driven color logic", () => {
  const { installed, graph } = setup();
  const plan = prepareDriverDeployment(installed, "master", {
    physicalGraph: installed.physicalGraphs[0]!, processingGraph: graph,
    mqtt: DISABLED_MQTT, energy: DEFAULT_ENERGY,
  } as CompileConfigInput);
  const result = compileConfig(plan.input, plan.options);
  expect(result.ok).toBe(true);
});
it("folds old generator triggers into the LED without changing its identity", () => {
  const { installed, led } = setup();
  const config = { ...defaultLedDriver(), presets: [{ id: "0", name: "Caldo", color: "#FF0000", level: "high" }] };
  const project = { ...installed, deviceGraphs: [{ ...installed.deviceGraphs[0]!,
    nodes: [...installed.deviceGraphs[0]!.nodes, { layer: "device-processing", id: "generator", data: {
      kind: "block", blockTypeId: "led_driver", properties: { ledDriverConfig: JSON.stringify(config) } } }],
    edges: [{ layer: "device-processing", id: "if", source: "condition", target: "generator", targetHandle: "0" },
      { layer: "device-processing", id: "color", source: "generator", sourceHandle: "0", target: led.id, targetHandle: "color-input" }],
  }] } as unknown as ProjectV1;
  const migrated = migrateRgbLedGenerators(project);
  expect(migrated.deviceGraphs[0]!.nodes.map(node => node.id)).toEqual([led.id]);
  expect(migrated.deviceGraphs[0]!.edges[0]).toMatchObject({ source: "condition", target: led.id, targetHandle: "preset:0" });
  expect(migrateRgbLedGenerators(migrated)).toBe(migrated);
});
it("rejects mixed preset and direct RGB commands instead of racing colors", () => {
  const { graph, led } = setup();
  expect(() => lowerRgbLedPresets({ ...graph, edges: [...graph.edges, {
    layer: "device-processing", id: "mixed", source: "other", target: led.id, targetHandle: "red-level",
  }] })).toThrow("usa i preset");
});

it("allows five generated rules for an RGB flow within the eight-rule firmware budget", () => {
  const { installed, graph } = setup();
  const plan = prepareDriverDeployment(installed, "master", {
    physicalGraph: installed.physicalGraphs[0]!, processingGraph: graph,
    mqtt: DISABLED_MQTT, energy: DEFAULT_ENERGY,
  } as CompileConfigInput);
  expect(plan.options.maxRules).toBe(8);
  const base = compileConfig(plan.input, plan.options);
  if (!base.ok) throw new Error(JSON.stringify(base.error));
  const alternate = base.value.modules.find(module => String(module.properties[1]).startsWith("flow.trigger."))!;
  const template = plan.input.processingGraph.nodes.find(node => (node.data as { kind: string }).kind === "rule")!;
  const data = template.data as { kind: "rule"; ruleTypeId: string; properties: Record<string, bigint> };
  const nodes = [...plan.input.processingGraph.nodes.filter(node => (node.data as { kind: string }).kind !== "rule"),
    ...Array.from({ length: 5 }, (_, index) => ({ ...template, id: `capacity-rule-${index}`, data: {
      ...data, properties: { ...data.properties, "1": index < 3 ? data.properties["1"]! : BigInt(alternate.key) },
    } })),
  ];
  const compiled = compileConfig({ ...plan.input, processingGraph: { ...plan.input.processingGraph, nodes } }, plan.options);
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
  expect(compiled.value.rules).toHaveLength(5);
});
