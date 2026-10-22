import { expect, it } from "vitest";
import type { ProjectV1 } from "@spaghettilab/domain";
import {
  catalogUln2003Driver,
  catalogGpioRelayDriver,
} from "../gpio-driver-presets.js";
import { planModuleImport, commitModuleImport, commitModulePinConfiguration, removeInstalledModule } from "../module-import.js";
import { PHYSICAL_META_KEY, parsePhysicalProject } from "../backbone-physical.js";
import {
  parseBackboneSensorModules,
  BACKBONE_SENSOR_MODULES_META_KEY,
} from "../backbone-sensor-modules.js";
import { compileRuntimeDriver } from "../driver-runtime-profile.js";
import {
  validateDraftForCreate,
  renameRecipeVariable,
} from "../device-recipe-draft.js";
import {
  encodeDeviceProfileCbor,
  decodeDeviceProfileCbor,
} from "@spaghettilab/device-profile-install";
const physical = {
  name: "Function",
  variant: "v1" as const,
  modes: [0, 0, 0, 0],
  i2cSpeed: 0,
  local: true,
  backendPortId: 0,
};
function project(): ProjectV1 {
  return {
    coreBindings: [
      { bindingId: "master", expectedDeviceId: "board", connectionProfileId: "usb" },
    ],
    physicalGraphs: [],
    deviceGraphs: [{ layer: "device-processing", nodes: [], edges: [] }],
    authoringMetadata: {},
  } as unknown as ProjectV1;
}
it("imports a four-pin motor offline without claiming physical settings were applied", () => {
  const p = project();
  const plan = planModuleImport(
    p,
    p.coreBindings[0]!.bindingId,
    "master:board",
    catalogUln2003Driver(),
    physical,
  );
  expect(plan.physical.modes).toEqual([2, 2, 2, 2]);
  expect(plan.conflicts).toEqual([]);
  const imported = commitModuleImport(p, plan, "motor1", false, false);
  expect(imported.deviceGraphs[0]?.nodes).toHaveLength(1);
  expect(
    parsePhysicalProject(imported.authoringMetadata[PHYSICAL_META_KEY]?.comment).drafts[
      "master:board"
    ]?.applied,
  ).toBe(false);
  expect(
    parseBackboneSensorModules(
      imported.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment,
    ).byBinding.master?.[0]?.gpioAssignments?.channels,
  ).toEqual({ IN1: 0, IN2: 1, IN3: 2, IN4: 3 });
});
it("requires explicit conflict resolution and retires the affected module", () => {
  const p = project();
  const first = planModuleImport(
    p,
    p.coreBindings[0]!.bindingId,
    "master:board",
    catalogGpioRelayDriver(),
    physical,
  );
  const relay = commitModuleImport(p, first, "relay1", false, true);
  const motor = planModuleImport(
    relay,
    p.coreBindings[0]!.bindingId,
    "master:board",
    catalogUln2003Driver(),
    { ...physical, modes: [2, 0, 0, 0] },
  );
  expect(motor.conflicts.map((item) => item.label)).toContain("Relè");
  expect(() => commitModuleImport(relay, motor, "motor1", false, true)).toThrow(
    /Scegli/,
  );
  expect(relay.deviceGraphs[0]?.nodes).toHaveLength(1);
  const replaced = commitModuleImport(relay, motor, "motor1", true, true);
  expect(replaced.deviceGraphs[0]?.nodes).toHaveLength(1);
  expect(replaced.deviceGraphs[0]?.nodes[0]?.id).toBe("nfc-block-motor1");
});
it("compiles asynchronous Start/Stop/position and preserves variable renames", () => {
  let draft = catalogUln2003Driver();
  expect(validateDraftForCreate(draft)).toEqual([]);
  expect(draft).toEqual(catalogUln2003Driver());
  draft = renameRecipeVariable(draft, "uln-position", "angolo");
  expect(draft.commands[2]?.steps[0]).toMatchObject({ positionVariable: "angolo" });
  const compiled = compileRuntimeDriver(
    draft,
    new Map(),
    new Map([
      ["IN1", 0],
      ["IN2", 1],
      ["IN3", 2],
      ["IN4", 3],
    ]),
  );
  expect(compiled.profile.initOps).toContainEqual(
    expect.objectContaining({ op: "STEPPER", command: 0 }),
  );
  expect(
    compiled.profile.sampleOps
      .filter((op) => op.op === "STEPPER")
      .map((op) => op.command),
  ).toEqual([0, 1, 2]);
  expect(compiled.profile.sampleOps.some((op) => op.op === "DELAY_BOUNDED")).toBe(
    false,
  );
  expect(decodeDeviceProfileCbor(encodeDeviceProfileCbor(compiled.profile))).toEqual({
    ok: true,
    value: compiled.profile,
  });
});

it("never requires a position argument to execute motor Start or Stop", () => {
  const draft = catalogUln2003Driver();
  const compiled = compileRuntimeDriver(
    draft,
    new Map(draft.commands.map((command) => [command.id, new Set(["angolo"])])),
    new Map([
      ["IN1", 0],
      ["IN2", 1],
      ["IN3", 2],
      ["IN4", 3],
    ]),
  );
  const requiredByAction = compiled.profile.actions!.map((action) =>
    compiled.profile.sampleOps
      .slice(action.first, action.first + action.count)
      .filter((op) => op.op === "LOAD_ARGUMENT")
      .some((op) => op.required),
  );
  expect(requiredByAction).toEqual([false, false, true]);
});

it("includes a saved project driver and does not turn an installed unit into a duplicate catalog model", async () => {
  const { availableModuleDrivers } = await import("../module-catalog.js");
  const { saveDriverMetadata } = await import("../device-driver-library.js");
  const { emptyNfcLibrary } = await import("../nfc-workspace.js");
  const p = project();
  const custom = { ...catalogGpioRelayDriver(), id: "my-relay", name: "Il mio relè" };
  const saved = {
    ...p,
    authoringMetadata: saveDriverMetadata(p.authoringMetadata, custom),
  };
  const imported = commitModuleImport(
    saved,
    planModuleImport(
      saved,
      saved.coreBindings[0]!.bindingId,
      "master:board",
      custom,
      physical,
    ),
    "local-unit",
    false,
    false,
  );
  expect(
    availableModuleDrivers(imported, emptyNfcLibrary()).map((driver) => driver.id),
  ).toEqual(["my-relay"]);
});

it("installs an NFC RGB unit with three PWM channels and preserves its calibrated order on replacement", async () => {
  const { rgbModuleDraft } = await import("../rgb-module.js");
  const driver = rgbModuleDraft();
  const p = project();
  const first = planModuleImport(
    p,
    p.coreBindings[0]!.bindingId,
    "master:board",
    driver,
    physical,
  );
  expect(first.physical.modes).toEqual([12, 12, 12, 0]);
  expect(first.physical.settings?.pwmHz).toBe(1000);
  expect(first.channels).toEqual({ RED: 1, GREEN: 0, BLUE: 2 });
  const runtime = compileRuntimeDriver(driver, new Map(), new Map(Object.entries(first.channels)));
  expect(runtime.profile.initOps.find(op => op.op === "RGB_PROGRAM")).toMatchObject({ channels: 33 });
  const installed = commitModuleImport(p, first, "0471C102A02190", false, true);
  const stored = parseBackboneSensorModules(
    installed.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment,
  );
  const module = stored.byBinding.master![0]!;
  expect(module.id).toBe("nfc-module-0471C102A02190");
  expect(module.gpioAssignments?.channels).toEqual({ RED: 1, GREEN: 0, BLUE: 2 });
  const calibrated = {
    ...installed,
    authoringMetadata: {
      ...installed.authoringMetadata,
      [BACKBONE_SENSOR_MODULES_META_KEY]: {
        comment: JSON.stringify({
          ...stored,
          byBinding: {
            master: [
              {
                ...module,
                gpioAssignments: {
                  boardKey: "master:board",
                  channels: { RED: 1, GREEN: 0, BLUE: 2 },
                },
              },
            ],
          },
        }),
      },
    },
  };
  const replacement = planModuleImport(
    calibrated,
    p.coreBindings[0]!.bindingId,
    "master:board",
    driver,
    first.physical,
  );
  expect(replacement.channels).toEqual({ RED: 1, GREEN: 0, BLUE: 2 });
  expect(replacement.conflicts).toHaveLength(1);
  expect(() =>
    commitModuleImport(calibrated, replacement, "0471C102A02190", false, true),
  ).toThrow();
});

it("imports DHT22 DATA as input on A0 and a separate HIGH supply output on A1", async () => {
  const { catalogDht22Driver } = await import("../gpio-driver-presets.js");
  const driver = catalogDht22Driver();
  const p = project();
  const plan = planModuleImport(
    p,
    p.coreBindings[0]!.bindingId,
    "master:board",
    driver,
    physical,
  );
  expect(plan.physical.modes).toEqual([1, 2, 0, 0]);
  expect(plan.channels).toEqual({ DATA: 0, POWER: 1 });
  const compiled = compileRuntimeDriver(
    driver,
    new Map(),
    new Map(Object.entries(plan.channels)),
  );
  expect(compiled.profile.initOps).toContainEqual({
    op: "DHT22_POWER",
    dataChannel: 0,
    powerChannel: 1,
    on: true,
  });
  expect(compiled.profile.sampleOps.find((op) => op.op === "DHT22_READ")).toMatchObject(
    { dataChannel: 0, powerChannel: 1 },
  );
  expect(compiled.profile.safeStopOps).toEqual([
    { op: "DHT22_POWER", dataChannel: 0, powerChannel: 1, on: false },
  ]);
  expect(compiled.profile.sampleFields).toHaveLength(2);
  expect(validateDraftForCreate(driver)).toEqual([]);
  expect(compiled.profile.sampleFields).toEqual([
    { fieldId: 1, type: "float", name: "value_1", unit: "%RH" },
    { fieldId: 2, type: "float", name: "value_2", unit: "°C" },
  ]);
  const installed = commitModuleImport(p, plan, "dht-unit", false, true);
  expect(
    parseBackboneSensorModules(
      installed.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment,
    ).byBinding.master?.[0]?.gpioAssignments?.channels,
  ).toEqual({ DATA: 0, POWER: 1 });
});

it("keeps a module on the selected CAN Backbone without changing the master's pin draft", () => {
  const first = commitModuleImport(
    project(),
    planModuleImport(
      project(),
      "master",
      "master:board",
      catalogGpioRelayDriver(),
      physical,
    ),
    "local-relay",
    false,
    true,
  );
  const remotePlan = planModuleImport(
    first,
    "master",
    "master:remote",
    catalogGpioRelayDriver(),
    {
      ...physical,
      variant: "v2",
      modes: Array(8).fill(0),
      local: false,
      nodeId: 0x123456,
    },
  );
  const next = commitModuleImport(first, remotePlan, "remote-relay", false, true);
  const drafts = parsePhysicalProject(
    next.authoringMetadata[PHYSICAL_META_KEY]?.comment,
  ).drafts;
  expect(drafts["master:board"]).toEqual(
    parsePhysicalProject(first.authoringMetadata[PHYSICAL_META_KEY]?.comment).drafts[
      "master:board"
    ],
  );
  expect(drafts["master:remote"]).toMatchObject({
    local: false,
    nodeId: 0x123456,
    variant: "v2",
  });
  const modules = parseBackboneSensorModules(
    next.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment,
  ).byBinding.master!;
  expect(
    modules.some((module) => module.gpioAssignment?.boardKey === "master:board"),
  ).toBe(true);
  expect(
    modules.some((module) => module.gpioAssignment?.boardKey === "master:remote"),
  ).toBe(true);
});

it("keeps modules on free pins and retires the whole overlapping RGB module including extra canvas copies", async () => {
  const { rgbModuleDraft } = await import("../rgb-module.js");
  const { SENSOR_MODULE_ID_PROP } = await import("../backbone-sensor-block.js");
  const p = project();
  const rgbPlan = planModuleImport(
    p,
    "master",
    "master:board",
    rgbModuleDraft(),
    physical,
  );
  let current = commitModuleImport(p, rgbPlan, "rgb", false, false);
  const freePlan = planModuleImport(
    current,
    "master",
    "master:board",
    catalogGpioRelayDriver(),
    rgbPlan.physical,
    { RELAY_CONTROL: 3 },
  );
  expect(freePlan.conflicts).toEqual([]);
  current = commitModuleImport(current, freePlan, "relay", false, false);
  const graph = current.deviceGraphs[0]!;
  const rgbNode = graph.nodes[0]!;
  current = {
    ...current,
    deviceGraphs: [
      {
        ...graph,
        nodes: [
          ...graph.nodes,
          {
            ...rgbNode,
            id: "extra-rgb",
            data: {
              ...rgbNode.data,
              properties: { [SENSOR_MODULE_ID_PROP]: "nfc-module-rgb" },
            },
          },
        ],
        edges: [{ id: "extra-wire", source: "extra-rgb", target: graph.nodes[1]!.id }],
      },
    ],
  } as ProjectV1;
  const replacement = planModuleImport(
    current,
    "master",
    "master:board",
    catalogGpioRelayDriver(),
    freePlan.physical,
    { RELAY_CONTROL: 1 },
  );
  expect(replacement.conflicts.map((item) => item.id)).toEqual(["nfc-module-rgb"]);
  expect(replacement.physical.modes).toEqual([0, 2, 0, 2]);
  const next = commitModuleImport(current, replacement, "new-relay", true, false);
  expect(next.deviceGraphs[0]!.nodes.map((node) => node.id)).toEqual([
    "nfc-block-relay",
    "nfc-block-new-relay",
  ]);
  expect(next.deviceGraphs[0]!.edges).toEqual([]);
  expect(
    Object.values(JSON.parse(next.authoringMetadata.__nfcInstallations!.comment!)),
  ).not.toContainEqual(expect.objectContaining({ moduleId: "nfc-module-rgb" }));
});

it("persists explicit RGB signal mapping and rejects duplicate assignments", async () => {
  const { rgbModuleDraft } = await import("../rgb-module.js");
  const plan = planModuleImport(
    project(),
    "master",
    "master:board",
    rgbModuleDraft(),
    physical,
    { RED: 2, GREEN: 0, BLUE: 3 },
  );
  expect(plan.channels).toEqual({ RED: 2, GREEN: 0, BLUE: 3 });
  expect(plan.physical.modes).toEqual([12, 0, 12, 12]);
  expect(() =>
    planModuleImport(project(), "master", "master:board", rgbModuleDraft(), physical, {
      RED: 0,
      GREEN: 0,
      BLUE: 2,
    }),
  ).toThrow(/distinto/);
});

it("maps I²C to selected pins and prevents relocating a bus still used by another module", async () => {
  const { createModuleProgramDraft } = await import("../new-module-program.js");
  const driver = { ...createModuleProgramDraft("i2c"), status: "ready" as const };
  const p = project();
  const plan = planModuleImport(p, "master", "master:board", driver, physical, {
    SDA: 3,
    SCL: 2,
  });
  expect(plan.physical.modes).toEqual([0, 0, 5, 4]);
  const installed = commitModuleImport(p, plan, "i2c", false, false);
  expect(
    parseBackboneSensorModules(
      installed.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment,
    ).byBinding.master![0]!.gpioAssignments?.channels,
  ).toEqual({ SDA: 3, SCL: 2 });
  expect(() =>
    planModuleImport(installed, "master", "master:board", driver, plan.physical, {
      SDA: 0,
      SCL: 1,
    }),
  ).toThrow(/bus è già assegnato/);
  const overlap = planModuleImport(
    installed,
    "master",
    "master:board",
    catalogGpioRelayDriver(),
    plan.physical,
    { RELAY_CONTROL: 3 },
  );
  expect(overlap.conflicts).toHaveLength(1);
  expect(overlap.physical.modes).toEqual([0, 0, 0, 2]);
});

it("remaps an installed module in place, releases its old pin and retains canvas wiring", () => {
  const initial = commitModuleImport(project(), planModuleImport(project(), "master", "master:board",
    catalogGpioRelayDriver(), physical), "relay-remap", false, false);
  const stored = parseBackboneSensorModules(initial.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment);
  const module = stored.byBinding.master![0]!;
  const before = initial.deviceGraphs[0]!;
  const draft = module.recipe.deviceDraft!;
  const signal = draft.binding.gpioSignals[0]!.id;
  const board = parsePhysicalProject(initial.authoringMetadata[PHYSICAL_META_KEY]?.comment).drafts["master:board"]!;
  const plan = planModuleImport(initial, "master", "master:board", draft, board, { [signal]: 2 }, module.id);
  expect(plan.conflicts).toEqual([]);
  expect(plan.physical.modes).toEqual([0, 0, 2, 0]);
  const updated = commitModulePinConfiguration(initial, plan, module.id, false);
  expect(updated.deviceGraphs[0]).toEqual(before);
  const after = parseBackboneSensorModules(updated.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment).byBinding.master!;
  expect(after).toHaveLength(1);
  expect(after[0]!.id).toBe(module.id);
  expect(after[0]!.gpioAssignments?.channels).toEqual({ [signal]: 2 });
});

it("remapping onto another module replaces only that module and frees the original pin", () => {
  const driver = catalogGpioRelayDriver();
  const signal = driver.binding.gpioSignals[0]!.id;
  let p = commitModuleImport(project(), planModuleImport(project(), "master", "master:board", driver, physical), "first", false, false);
  let board = parsePhysicalProject(p.authoringMetadata[PHYSICAL_META_KEY]?.comment).drafts["master:board"]!;
  p = commitModuleImport(p, planModuleImport(p, "master", "master:board", driver, board, { [signal]: 1 }), "second", false, false);
  const modules = parseBackboneSensorModules(p.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment).byBinding.master!;
  board = parsePhysicalProject(p.authoringMetadata[PHYSICAL_META_KEY]?.comment).drafts["master:board"]!;
  const first = modules[0]!;
  const plan = planModuleImport(p, "master", "master:board", driver, board, { [signal]: 1 }, first.id);
  expect(plan.conflicts.map(item => item.id)).toEqual([modules[1]!.id]);
  const updated = commitModulePinConfiguration(p, plan, first.id, false);
  const remaining = parseBackboneSensorModules(updated.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment).byBinding.master!;
  expect(remaining.map(item => item.id)).toEqual([first.id]);
  expect(updated.deviceGraphs[0]!.nodes.map(node => node.id)).toEqual(p.deviceGraphs[0]!.nodes.filter(node => !modules[1]!.graphNodeIds?.includes(node.id) && node.id !== modules[1]!.graphNodeId).map(node => node.id));
  expect(plan.physical.modes).toEqual([0, 2, 0, 0]);
});

it("deletes an installed module and its canvas copies while releasing only its pins", () => {
  const driver = catalogGpioRelayDriver();
  const initial = commitModuleImport(project(), planModuleImport(project(), "master", "master:board", driver, physical), "delete-me", false, false);
  const module = parseBackboneSensorModules(initial.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment).byBinding.master![0]!;
  const deleted = removeInstalledModule(initial, "master", module.id);
  expect(deleted.deviceGraphs[0]!.nodes).toEqual([]);
  expect(deleted.deviceGraphs[0]!.edges).toEqual([]);
  expect(parseBackboneSensorModules(deleted.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment).byBinding.master).toEqual([]);
  const board = parsePhysicalProject(deleted.authoringMetadata[PHYSICAL_META_KEY]?.comment).drafts["master:board"]!;
  expect(board.modes).toEqual([0, 0, 0, 0]);
  expect(board.applied).toBe(false);
  expect(JSON.parse(deleted.authoringMetadata.__nfcInstallations!.comment!)).toEqual({});
});
it("moves a module to another Backbone without changing the canvas and frees source pins", () => {
  const driver = catalogGpioRelayDriver();
  const initial = commitModuleImport(project(), planModuleImport(project(), "master", "master:board", driver, physical), "move-me", false, false);
  const module = parseBackboneSensorModules(initial.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment).byBinding.master![0]!;
  const signal = driver.binding.gpioSignals[0]!.id;
  const plan = planModuleImport(initial, "master", "master:second", driver, { ...physical, local: false, nodeId: 123, logicalSlot: 2 }, { [signal]: 1 }, module.id);
  const moved = commitModulePinConfiguration(initial, plan, module.id, false);
  expect(moved.deviceGraphs).toEqual(initial.deviceGraphs);
  const saved = parseBackboneSensorModules(moved.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment).byBinding.master![0]!;
  expect(saved.id).toBe(module.id);
  expect(saved.gpioAssignments).toEqual({ boardKey: "master:second", channels: { [signal]: 1 } });
  const boards = parsePhysicalProject(moved.authoringMetadata[PHYSICAL_META_KEY]?.comment).drafts;
  expect(boards["master:board"]!.modes).toEqual([0, 0, 0, 0]);
  expect(boards["master:board"]!.applied).toBe(false);
  expect(boards["master:second"]!.modes).toEqual([0, 2, 0, 0]);
});
