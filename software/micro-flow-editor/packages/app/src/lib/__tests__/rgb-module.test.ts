import { expect, it } from "vitest";
import type { ProjectV1 } from "@spaghettilab/domain";
import { rgbModuleDraft, defaultRgbModule } from "../rgb-module.js";
import { compileRuntimeDriver } from "../driver-runtime-profile.js";
import { rgbInputCommand } from "../rgb-runtime.js";
import {
  draftToCanvasSensorRecipes,
  parseDeviceRecipeDraft,
  serializeDeviceRecipeDraft,
} from "../device-recipe-draft.js";
import { planModuleImport, commitModuleImport } from "../module-import.js";
import { builtinNfcDrivers } from "../nfc-workspace.js";
import { availableModuleDrivers } from "../module-catalog.js";
import { prepareDriverDeployment } from "../driver-deployment-plan.js";
import { compileConfig } from "@spaghettilab/config-compiler";
import { DEFAULT_ENERGY, DISABLED_MQTT } from "../default-config-policy.js";
import {
  encodeDeviceProfileCbor,
  decodeDeviceProfileCbor,
} from "@spaghettilab/device-profile-install";
const pins = new Map([
  ["RED", 0],
  ["GREEN", 1],
  ["BLUE", 2],
]);
it("compiles actual PWM actions and color argument commands with persistent defaults", () => {
  const draft = rgbModuleDraft();
  expect(parseDeviceRecipeDraft(serializeDeviceRecipeDraft(draft))?.rgbModule).toEqual(
    defaultRgbModule(),
  );
  const runtime = compileRuntimeDriver(draft, new Map(), pins);
  expect(runtime.profile.sampleOps).toHaveLength(15);
  expect(runtime.profile.initOps[0]).toMatchObject({
    op: "RGB_PROGRAM",
    channels: 36,
    inverted: false,
  });
  expect(runtime.profile.actions).toHaveLength(6);
  const decoded = decodeDeviceProfileCbor(encodeDeviceProfileCbor(runtime.profile));
  expect(decoded.ok).toBe(true);
  expect(rgbInputCommand(draft, "color-input")).toEqual({
    commandId: 3,
    argument: 1,
    mode: 0,
  });
  expect(rgbInputCommand(draft, "red-level")).toEqual({
    commandId: 4,
    argument: 1,
    mode: 5,
  });
  expect(() =>
    compileRuntimeDriver(
      draft,
      new Map(),
      new Map([
        ["RED", 0],
        ["GREEN", 0],
        ["BLUE", 2],
      ]),
    ),
  ).toThrow(/distinte/);
  expect(draftToCanvasSensorRecipes(draft)).toHaveLength(1);
  expect(draftToCanvasSensorRecipes(draft)[0]?.channels).toHaveLength(6);
});
it("appears in the module library and imports as one complete block using only A0–A2", () => {
  const project = {
    coreBindings: [
      { bindingId: "master", expectedDeviceId: "board", connectionProfileId: "usb" },
    ],
    physicalGraphs: [{ layer: "physical-composition", nodes: [], edges: [] }],
    deviceGraphs: [{ layer: "device-processing", nodes: [], edges: [] }],
    authoringMetadata: {},
  } as unknown as ProjectV1;
  const library = {
    drivers: builtinNfcDrivers(),
    modules: [],
    units: [],
  } as Parameters<typeof availableModuleDrivers>[1];
  expect(
    availableModuleDrivers(project, library).some((d) => d.id === "gpio-rgb-led"),
  ).toBe(true);
  const plan = planModuleImport(project, "master", "master:board", rgbModuleDraft(), {
    name: "Function",
    variant: "v1",
    modes: [0, 0, 0, 2],
    i2cSpeed: 0,
    local: true,
    backendPortId: 0,
  });
  expect(plan.physical.modes).toEqual([12, 12, 12, 2]);
  expect(plan.physical.settings?.pwmInverted).toBe(false);
  const imported = commitModuleImport(project, plan, "rgb", false, true);
  expect(imported.deviceGraphs[0]?.nodes).toHaveLength(1);
  const graph = imported.deviceGraphs[0]!;
  const prepared = prepareDriverDeployment(imported, "master", {
    physicalGraph: project.physicalGraphs[0]!,
    processingGraph: graph,
    mqtt: DISABLED_MQTT,
    connectivity: 0,
    energy: DEFAULT_ENERGY,
  });
  expect(prepared.profiles).toHaveLength(1);
  const result = compileConfig(prepared.input, prepared.options);
  expect(result.ok).toBe(true);
});

it("compiles independent trigger actions and variable-on-change without hiding state outputs", () => {
  const draft = rgbModuleDraft({ ...defaultRgbModule(), inputMode: "rgb" });
  // Use the same property identifiers as actual installed blocks.
  const p = {
    coreBindings: [
      { bindingId: "master", expectedDeviceId: "board", connectionProfileId: "usb" },
    ],
    physicalGraphs: [{ layer: "physical-composition", nodes: [], edges: [] }],
    deviceGraphs: [{ layer: "device-processing", nodes: [], edges: [] }],
    authoringMetadata: {},
  } as unknown as ProjectV1;
  const proposal = planModuleImport(p, "master", "master:board", draft, {
    name: "Function",
    variant: "v1",
    modes: [0, 0, 0, 0],
    i2cSpeed: 0,
    local: true,
    backendPortId: 0,
  });
  const installed = commitModuleImport(p, proposal, "rgb", false, true);
  const graph = installed.deviceGraphs[0]!;
  const target = graph.nodes[0]!.id;
  const sources = draft
    .rgbModule!.inputs.filter((input) => input.mode === "component")
    .map((input, index) => ({
      layer: "device-processing" as const,
      id: `source${index}`,
      data: {
        kind: "block" as const,
        blockTypeId: "ab.digital_out_toggle",
        properties: {},
      },
    }));
  const edges = draft
    .rgbModule!.inputs.filter((input) => input.mode === "component")
    .map((input, index) => ({
      id: `wire${index}`,
      source: `source${index}`,
      sourceHandle: "0",
      target,
      targetHandle: input.id,
    }));
  const plan = prepareDriverDeployment(installed, "master", {
    physicalGraph: p.physicalGraphs[0]!,
    processingGraph: { ...graph, nodes: [...graph.nodes, ...sources], edges },
    mqtt: DISABLED_MQTT,
    connectivity: 0,
    energy: DEFAULT_ENERGY,
  });
  const rules = plan.input.processingGraph.nodes.filter((n) => n.data.kind === "rule");
  expect(rules).toHaveLength(3);
  expect(
    rules.map((n) => n.data.kind === "rule" && Number(n.data.properties["8"])),
  ).toEqual([5, 5, 5]);
  const result = compileConfig(plan.input, plan.options);
  expect(
    result.ok,
    JSON.stringify(result, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  ).toBe(true);
});

it("calibrates swapped red/green wiring without changing RGB color values", async () => {
  const { reassignGpioSignal } = await import("../backbone-sensor-modules.js");
  const original = { RED: 0, GREEN: 1, BLUE: 2 };
  const mapped = reassignGpioSignal(original, "RED", 1);
  expect(mapped).toEqual({ RED: 1, GREEN: 0, BLUE: 2 });
  expect(original).toEqual({ RED: 0, GREEN: 1, BLUE: 2 });
  const draft = rgbModuleDraft({ ...defaultRgbModule(), initialOn: true });
  const standard = compileRuntimeDriver(draft, new Map(), pins);
  const corrected = compileRuntimeDriver(
    draft,
    new Map(),
    new Map(Object.entries(mapped)),
  );
  expect(corrected.profile.initOps[0]).toMatchObject({
    op: "RGB_PROGRAM",
    channels: 33,
  });
  expect(corrected.profile.messageData).toEqual(standard.profile.messageData);
  expect(corrected.profile.profileId).not.toBe(standard.profile.profileId);
  expect(() => reassignGpioSignal(original, "RED", 4)).toThrow();
});

it("exposes independent percent inputs and bounded component commands", () => {
  const draft = rgbModuleDraft({ ...defaultRgbModule(), inputMode: "rgb" });
  expect(
    draft.channels.filter((c) => c.direction === "write").map((c) => c.label),
  ).toEqual(["Ricevi colore", "Rosso (%)", "Verde (%)", "Blu (%)"]);
  for (const [index, id] of ["red-level", "green-level", "blue-level"].entries()) {
    const command = rgbInputCommand(draft, id);
    expect(command).toEqual({ commandId: 4 + index, argument: 1, mode: 5 });
  }
});

it("routes RGB to its assigned CAN Backbone without requiring master PWM pins", () => {
  const project = {
    coreBindings: [
      { bindingId: "master", expectedDeviceId: "board", connectionProfileId: "usb" },
    ],
    physicalGraphs: [{ layer: "physical-composition", nodes: [], edges: [] }],
    deviceGraphs: [{ layer: "device-processing", nodes: [], edges: [] }],
    authoringMetadata: {},
  } as unknown as ProjectV1;
  const draft = rgbModuleDraft();
  const proposal = planModuleImport(project, "master", "master:remote", draft, {
    name: "Function",
    variant: "v2",
    modes: [0, 0, 0, 0],
    i2cSpeed: 0,
    local: false,
    nodeId: 0xe17fd0,
    backendPortId: 0,
  });
  const installed = commitModuleImport(project, proposal, "remote-rgb", false, true);
  const plan = prepareDriverDeployment(installed, "master", {
    physicalGraph: installed.physicalGraphs[0]!,
    processingGraph: installed.deviceGraphs[0]!,
    mqtt: DISABLED_MQTT,
    connectivity: 0,
    energy: DEFAULT_ENERGY,
  });
  const ops = [...plan.profiles[0]!.initOps, ...plan.profiles[0]!.sampleOps].filter(
    (op) => op.op === "RGB_PROGRAM",
  );
  expect(ops.length).toBeGreaterThan(0);
  expect(ops.every((op) => op.op === "RGB_PROGRAM" && op.nodeId === 0xe17fd0)).toBe(
    true,
  );
  expect(plan.profiles[0]!.profileId).toContain(".ne17fd0");
  expect(compileConfig(plan.input, plan.options).ok).toBe(true);
});

it("rejects a saved RGB module with both input families wired", () => {
  const project = {
    coreBindings: [
      { bindingId: "master", expectedDeviceId: "board", connectionProfileId: "usb" },
    ],
    physicalGraphs: [{ layer: "physical-composition", nodes: [], edges: [] }],
    deviceGraphs: [{ layer: "device-processing", nodes: [], edges: [] }],
    authoringMetadata: {},
  } as unknown as ProjectV1;
  const draft = rgbModuleDraft();
  const proposal = planModuleImport(project, "master", "master:remote", draft, {
    name: "Function",
    variant: "v2",
    modes: [0, 0, 0, 0],
    i2cSpeed: 0,
    local: false,
    nodeId: 0xe17fd0,
    backendPortId: 0,
  });
  const installed = commitModuleImport(project, proposal, "remote-rgb", false, true);
  expect(() =>
    prepareDriverDeployment(installed, "master", {
      physicalGraph: installed.physicalGraphs[0]!,
      processingGraph: {
        ...installed.deviceGraphs[0]!,
        nodes: [
          ...installed.deviceGraphs[0]!.nodes,
          {
            layer: "device-processing",
            id: "source",
            data: { kind: "block", blockTypeId: "ui.manual_trigger", properties: {} },
          },
        ],
        edges: [
          {
            id: "color",
            source: "source",
            sourceHandle: "trigger",
            target: installed.deviceGraphs[0]!.nodes[0]!.id,
            targetHandle: "color-input",
          },
          {
            id: "red",
            source: "source",
            sourceHandle: "trigger",
            target: installed.deviceGraphs[0]!.nodes[0]!.id,
            targetHandle: "red-level",
          },
        ],
      },
      mqtt: DISABLED_MQTT,
      connectivity: 0,
      energy: DEFAULT_ENERGY,
    }),
  ).toThrow(/Colore oppure/);
});
