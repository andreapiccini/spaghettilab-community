import { expect, it } from "vitest";
import type { ProjectV1 } from "@spaghettilab/domain";
import {
  catalogUln2003Driver,
  catalogGpioRelayDriver,
} from "../gpio-driver-presets.js";
import { planModuleImport, commitModuleImport } from "../module-import.js";
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
  const first = planModuleImport(p, p.coreBindings[0]!.bindingId, "master:board", driver, physical);
  expect(first.physical.modes).toEqual([12, 12, 12, 0]);
  expect(first.physical.settings?.pwmHz).toBe(1000);
  const installed = commitModuleImport(p, first, "0471C102A02190", false, true);
  const stored = parseBackboneSensorModules(installed.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment);
  const module = stored.byBinding.master![0]!;
  expect(module.id).toBe("nfc-module-0471C102A02190");
  expect(module.gpioAssignments?.channels).toEqual({ RED: 0, GREEN: 1, BLUE: 2 });
  const calibrated = { ...installed, authoringMetadata: { ...installed.authoringMetadata,
    [BACKBONE_SENSOR_MODULES_META_KEY]: { comment: JSON.stringify({ ...stored, byBinding: { master: [{ ...module, gpioAssignments: { boardKey: "master:board", channels: { RED: 1, GREEN: 0, BLUE: 2 } } }] } }) } } };
  const replacement = planModuleImport(calibrated, p.coreBindings[0]!.bindingId, "master:board", driver, first.physical);
  expect(replacement.channels).toEqual({ RED: 1, GREEN: 0, BLUE: 2 });
  expect(replacement.conflicts).toHaveLength(1);
  expect(() => commitModuleImport(calibrated, replacement, "0471C102A02190", false, true)).toThrow();
});

it("imports DHT22 DATA as input on A0 and a separate HIGH supply output on A1", async () => {
  const { catalogDht22Driver } = await import("../gpio-driver-presets.js");
  const driver = catalogDht22Driver();
  const p = project();
  const plan = planModuleImport(p, p.coreBindings[0]!.bindingId, "master:board", driver, physical);
  expect(plan.physical.modes).toEqual([1, 2, 0, 0]);
  expect(plan.channels).toEqual({ DATA: 0, POWER: 1 });
  const compiled = compileRuntimeDriver(driver, new Map(), new Map(Object.entries(plan.channels)));
  expect(compiled.profile.initOps).toContainEqual({ op: "DHT22_POWER", dataChannel: 0, powerChannel: 1, on: true });
  expect(compiled.profile.sampleOps.find(op => op.op === "DHT22_READ")).toMatchObject({ dataChannel: 0, powerChannel: 1 });
  expect(compiled.profile.safeStopOps).toEqual([{ op: "DHT22_POWER", dataChannel: 0, powerChannel: 1, on: false }]);
  expect(compiled.profile.sampleFields).toHaveLength(2);
  expect(validateDraftForCreate(driver)).toEqual([]);
  expect(compiled.profile.sampleFields).toEqual([{ fieldId: 1, type: "float", name: "value_1", unit: "%RH" }, { fieldId: 2, type: "float", name: "value_2", unit: "°C" }]);
  const installed = commitModuleImport(p, plan, "dht-unit", false, true);
  expect(parseBackboneSensorModules(installed.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment).byBinding.master?.[0]?.gpioAssignments?.channels).toEqual({ DATA: 0, POWER: 1 });
});
