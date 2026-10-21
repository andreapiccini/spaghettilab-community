import { expect, it } from "vitest";
import { catalogDht22Driver, upgradeDht22Driver } from "../gpio-driver-presets.js";
import { dht22OutputFormat, setDht22OutputFormat } from "../dht22-driver.js";
import { compileRuntimeDriver } from "../driver-runtime-profile.js";
import { organizeDriverInterfaces, effectiveActionSteps, validateDraftForCreate } from "../device-recipe-draft.js";
import { encodeDeviceProfileCbor, decodeDeviceProfileCbor } from "@spaghettilab/device-profile-install";
const pins = new Map([["DATA", 0], ["POWER", 1]]);
it("builds a rising-trigger input and a read/convert/publish action without periodic reads", () => {
  const draft = organizeDriverInterfaces(catalogDht22Driver());
  expect(draft.sampleIntervalMs).toBe(0);
  expect(draft.channels.filter(channel => channel.direction === "write")).toMatchObject([{ inputMode: "trigger", dataType: "bool" }]);
  expect(effectiveActionSteps(draft, draft.commands[0]!).map(step => step.type)).toEqual(["dht22_read", "dht22_convert", "dht22_convert", "emit", "emit"]);
  expect(validateDraftForCreate(draft)).toEqual([]);
  const compiled = compileRuntimeDriver(draft, new Map(), pins).profile;
  expect(compiled.sampleOps.find(op => op.op === "DHT22_READ")).toMatchObject({ queued: true });
  expect(compiled.sampleFields[0]?.type).toBe("float");
  const decoded = decodeDeviceProfileCbor(encodeDeviceProfileCbor(compiled));
  expect(decoded.ok).toBe(true);
});
it("changes the published variable format to text with degrees without changing the original driver", () => {
  const original = catalogDht22Driver();
  const text = setDht22OutputFormat(original, "string");
  expect(dht22OutputFormat(original)).toBe("float");
  expect(dht22OutputFormat(text)).toBe("string");
  expect(text.channels.find(channel => channel.id === "temperature")?.dataType).toBe("string");
  const profile = compileRuntimeDriver(text, new Map(), pins).profile;
  expect(profile.sampleOps).toContainEqual({ op: "EMIT_DECIMAL", src: 0, fieldId: 2, text: true });
  expect(profile.sampleFields.find(field => field.fieldId === 2)?.type).toBe("text");
});
it("upgrades the initial DHT22 snapshot without changing its physical-unit identity", () => {
  const legacy = { ...catalogDht22Driver(), id: "nfc-my-unit", name: "Sensore stanza", dht22Version: undefined };
  const upgraded = upgradeDht22Driver(legacy);
  expect(upgraded.id).toBe(legacy.id);
  expect(upgraded.name).toBe(legacy.name);
  expect(upgraded.dht22Version).toBe(3);
});

it("compiles the DHT22 trigger as a rising-edge rule and its timer only monitors pending requests", async () => {
  const { planModuleImport, commitModuleImport } = await import("../module-import.js");
  const { prepareDriverDeployment } = await import("../driver-deployment-plan.js");
  const { compileConfig } = await import("@spaghettilab/config-compiler");
  const { DEFAULT_ENERGY, DISABLED_MQTT } = await import("../default-config-policy.js");
  const p = { coreBindings: [{ bindingId: "master", expectedDeviceId: "board", connectionProfileId: "usb" }], physicalGraphs: [{ layer: "physical-composition", nodes: [], edges: [] }], deviceGraphs: [{ layer: "device-processing", nodes: [], edges: [] }], authoringMetadata: {} } as unknown as import("@spaghettilab/domain").ProjectV1;
  const driver = catalogDht22Driver();
  const proposal = planModuleImport(p, "master", "master:board", driver, { name: "Function", variant: "v1", modes: [0, 0, 0, 0], i2cSpeed: 0, local: true, backendPortId: 0 });
  const installed = commitModuleImport(p, proposal, "dht22", false, true);
  const graph = installed.deviceGraphs[0]!;
  const result = prepareDriverDeployment(installed, "master", { physicalGraph: p.physicalGraphs[0]!, processingGraph: { ...graph, nodes: [...graph.nodes, { layer: "device-processing", id: "trigger", data: { kind: "block", blockTypeId: "ab.digital_out_toggle", properties: {} } }], edges: [{ id: "read", source: "trigger", sourceHandle: "0", target: graph.nodes[0]!.id, targetHandle: "read-trigger" }] }, mqtt: DISABLED_MQTT, connectivity: 0, energy: DEFAULT_ENERGY });
  const rules = result.input.processingGraph.nodes.filter(node => node.data.kind === "rule");
  expect(rules).toHaveLength(1);
  expect(rules[0]?.data).toMatchObject({ properties: { "8": 1n } });
  expect(result.profiles[0]?.sampleOps.find(op => op.op === "DHT22_READ")).toMatchObject({ queued: true });
  const compiled = compileConfig(result.input, result.options);
  expect(compiled.ok, JSON.stringify(compiled, (_, value) => typeof value === "bigint" ? String(value) : value)).toBe(true);
});

it("keeps both the trigger and converted output on the canvas after organizing and saving the driver", async () => {
  const { propertiesForSensorModule, channelsFromNodeProperties, catalogEntryWithSensorChannels } = await import("../backbone-sensor-block.js");
  const { draftToCanvasSensorRecipes } = await import("../device-recipe-draft.js");
  const { createModuleFromRecipe } = await import("../backbone-sensor-modules.js");
  const { findCatalogEntryById } = await import("@spaghettilab/processing-block-catalog");
  const recipe = draftToCanvasSensorRecipes(organizeDriverInterfaces(catalogDht22Driver()))[0]!;
  const module = createModuleFromRecipe(recipe);
  const props = propertiesForSensorModule(module, recipe);
  expect(channelsFromNodeProperties(props).map(channel => channel.id)).toEqual(["read-trigger", "temperature", "humidity"]);
  expect(props.sensorDht22).toBe(true);
  const entry = findCatalogEntryById("appblocks.backbone_sensor");
  expect(entry).toBeDefined();
  expect(catalogEntryWithSensorChannels(entry!, props).inputs.map(port => port.id)).toEqual(["read-trigger"]);
});

it("publishes the converted DHT22 field to a host viewer without sending the viewer to the Core", async () => {
  const { planModuleImport, commitModuleImport } = await import("../module-import.js");
  const { prepareDriverDeployment } = await import("../driver-deployment-plan.js");
  const { compileConfig } = await import("@spaghettilab/config-compiler");
  const { DEFAULT_ENERGY, DISABLED_MQTT } = await import("../default-config-policy.js");
  const p = { coreBindings: [{ bindingId: "master", expectedDeviceId: "board", connectionProfileId: "usb" }], physicalGraphs: [{ layer: "physical-composition", nodes: [], edges: [] }], deviceGraphs: [{ layer: "device-processing", nodes: [], edges: [] }], authoringMetadata: {} } as unknown as import("@spaghettilab/domain").ProjectV1;
  const proposal = planModuleImport(p, "master", "master:board", catalogDht22Driver(), { name: "Function", variant: "v1", modes: [0,0,0,0], i2cSpeed: 0, local: true, backendPortId: 0 });
  const installed = commitModuleImport(p, proposal, "dht22", false, true);
  const graph = installed.deviceGraphs[0]!;
  const input = { physicalGraph: p.physicalGraphs[0]!, processingGraph: { ...graph, nodes: [...graph.nodes, { id: "viewer", layer: "device-processing" as const, data: { kind: "block" as const, blockTypeId: "ui.data_viewer", properties: {} } }], edges: [{ id: "show-temperature", source: graph.nodes[0]!.id, sourceHandle: "temperature", target: "viewer", targetHandle: "value" }] }, mqtt: DISABLED_MQTT, connectivity: 0, energy: DEFAULT_ENERGY };
  // Applying Module Function also creates a potential generic input for DATA.
  const physicalPin = { id: "physical-pin:master:board:0", layer: "physical-composition" as const, data: { kind: "module" as const, driverTypeId: "digital_input_trigger", portId: 0, bayId: 0, railId: 0, electricalMode: "input-only" as const, properties: { "1": 0n, "2": true, "3": true } } };
  input.physicalGraph = { ...input.physicalGraph, nodes: [physicalPin] };
  const result = prepareDriverDeployment(installed, "master", input);
  expect(result.input.physicalGraph.nodes.some(node => node.id === physicalPin.id)).toBe(false);
  expect(input.physicalGraph.nodes).toContain(physicalPin);
  expect(() => prepareDriverDeployment(installed, "master", { ...input, processingGraph: { ...input.processingGraph, nodes: [...input.processingGraph.nodes, { id: "duplicate-input", layer: "device-processing", data: { kind: "event-source", moduleNodeId: physicalPin.id } }] } })).toThrow("ingresso GPIO");
  expect(result.observations).toEqual([{ viewerId: "viewer", key: 1, field: 2, action: 1, label: "Temperatura", unit: "°C", valueKind: "number", colorKind: undefined, profileId: result.profiles[0]!.profileId, schemaId: result.profiles[0]!.sampleSchemaId }]);
  expect(result.input.processingGraph.nodes.some(node => node.id === "viewer")).toBe(false);
  expect(result.input.processingGraph.edges.some(edge => edge.target === "viewer")).toBe(false);
  const compiled = compileConfig(result.input, result.options);
  expect(compiled.ok, JSON.stringify(compiled, (_, value) => typeof value === "bigint" ? String(value) : value)).toBe(true);
});


it("deploys a manual trigger wired to DHT22 and forwards the converted output to its PC viewer", async () => {
  const { planModuleImport, commitModuleImport } = await import("../module-import.js");
  const { prepareDriverDeployment } = await import("../driver-deployment-plan.js");
  const { compileConfig } = await import("@spaghettilab/config-compiler");
  const { DEFAULT_ENERGY, DISABLED_MQTT } = await import("../default-config-policy.js");
  const p = { coreBindings: [{ bindingId: "master", expectedDeviceId: "board", connectionProfileId: "usb" }], physicalGraphs: [{ layer: "physical-composition", nodes: [], edges: [] }], deviceGraphs: [{ layer: "device-processing", nodes: [], edges: [] }], authoringMetadata: {} } as unknown as import("@spaghettilab/domain").ProjectV1;
  const proposal = planModuleImport(p, "master", "master:board", catalogDht22Driver(), { name: "Function", variant: "v1", modes: [0,0,0,0], i2cSpeed: 0, local: true, backendPortId: 0 });
  const installed = commitModuleImport(p, proposal, "dht22", false, true);
  const graph = installed.deviceGraphs[0]!;
  const input = { physicalGraph: p.physicalGraphs[0]!, processingGraph: { ...graph, nodes: [...graph.nodes, { id: "manual", layer: "device-processing" as const, data: { kind: "block" as const, blockTypeId: "ui.manual_trigger", properties: {} } }, { id: "viewer", layer: "device-processing" as const, data: { kind: "block" as const, blockTypeId: "ui.data_viewer", properties: {} } }], edges: [{id:"trigger-read",source:"manual",sourceHandle:"trigger",target:graph.nodes[0]!.id,targetHandle:"read-trigger"}, { id: "show-temperature", source: graph.nodes[0]!.id, sourceHandle: "temperature", target: "viewer", targetHandle: "value" }] }, mqtt: DISABLED_MQTT, connectivity: 0, energy: DEFAULT_ENERGY };
  const result=prepareDriverDeployment(installed,"master",input);
  expect(result.profiles).toHaveLength(2);
  expect(result.input.processingGraph.nodes.find(node=>node.id==="dht22-trigger:trigger-read")?.data).toMatchObject({kind:"rule",properties:{"1":1n,"3":2n,"5":1n,"8":1n}});
  expect(result.observations).toMatchObject([{viewerId:"viewer",key:2,field:2}]);
  expect(result.input.processingGraph.nodes.find(node=>node.id==="driver-manual:manual:armed")?.data).toMatchObject({kind:"schedule",enabled:false});
  const compiled=compileConfig(result.input,result.options);
  expect(compiled.ok,JSON.stringify(compiled,(_,v)=>typeof v==="bigint"?String(v):v)).toBe(true);
});
