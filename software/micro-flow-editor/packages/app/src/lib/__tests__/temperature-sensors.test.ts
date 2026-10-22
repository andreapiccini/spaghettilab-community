import { expect, it } from "vitest";
import {
  catalogDs18b20Driver,
  catalogDht22Driver,
  upgradeDht22Driver,
  withDs18b20PowerMode,
} from "../gpio-driver-presets.js";
import {
  organizeDriverInterfaces,
  serializeDeviceRecipeDraft,
  parseDeviceRecipeDraft,
} from "../device-recipe-draft.js";
import { compileRuntimeDriver } from "../driver-runtime-profile.js";
import {
  encodeDeviceProfileCbor,
  decodeDeviceProfileCbor,
} from "@spaghettilab/device-profile-install";
import { commitModuleImport, planModuleImport } from "../module-import.js";
import { parseBackboneSensorModules } from "../backbone-sensor-modules.js";
it("DHT11 publishes temperature and humidity and selects the DHT11 wire format", () => {
  const draft = organizeDriverInterfaces(catalogDht22Driver());
  expect(draft.name).toBe("DHT11");
  expect(draft.channels.filter((c) => c.direction === "read").map((c) => c.id)).toEqual(
    ["temperature", "humidity"],
  );
  const compiled = compileRuntimeDriver(
    draft,
    new Map(),
    new Map([
      ["DATA", 0],
      ["POWER", 1],
    ]),
  ).profile;
  expect(compiled.sampleOps[0]).toMatchObject({ op: "DHT22_READ", model: "dht11" });
  expect(compiled.sampleOps.filter((op) => op.op === "EMIT_DECIMAL")).toHaveLength(2);
  const restored = parseDeviceRecipeDraft(serializeDeviceRecipeDraft(draft))!;
  expect(restored.temperatureSensorModel).toBe("dht11");
  expect(decodeDeviceProfileCbor(encodeDeviceProfileCbor(compiled))).toMatchObject({
    ok: true,
  });
});
it("DS18B20 claims only DATA and uses a queued conversion with 1/16 degree resolution", () => {
  const draft = organizeDriverInterfaces(catalogDs18b20Driver());
  expect(draft.binding.gpioSignals.map((s) => s.id)).toEqual(["DATA"]);
  expect(draft.channels.some((c) => c.id === "humidity")).toBe(false);
  const profile = compileRuntimeDriver(
    draft,
    new Map(),
    new Map([["DATA", 0]]),
  ).profile;
  expect(profile.requiredCapabilities).toBe(24);
  expect(profile.initOps).toEqual([{ op: "DS18B20_SETUP", channel: 0, on: true, externalPower: true }]);
  expect(profile.sampleOps).toContainEqual({ op: "DS18B20_READ", dst: 0, channel: 0 });
  expect(profile.sampleOps).toContainEqual({
    op: "EMIT_DECIMAL",
    src: 0,
    fieldId: 1,
    text: false,
    divisor: 16,
  });
  expect(profile.safeStopOps).toEqual([{ op: "DS18B20_SETUP", channel: 0, on: false, externalPower: true }]);
  expect(decodeDeviceProfileCbor(encodeDeviceProfileCbor(profile))).toMatchObject({
    ok: true,
    value: expect.objectContaining({ sampleOps: profile.sampleOps }),
  });
});
it("upgrades old DHT22 templates but never reinterprets DS18B20 as a DHT", () => {
  const legacy = {
    ...catalogDht22Driver(),
    temperatureSensorModel: undefined,
    name: "DHT22",
    dht22Version: 2,
    id: "my-unit",
  };
  expect(upgradeDht22Driver(legacy)).toMatchObject({
    id: "my-unit",
    name: "DHT11",
    temperatureSensorModel: "dht11",
  });
  const ds = catalogDs18b20Driver();
  expect(upgradeDht22Driver(ds)).toBe(ds);
});

it("imports DS18B20 on A0 without reserving A1 and upgrades saved DHT units", async () => {
  const project = {
    coreBindings: [
      { bindingId: "master", expectedDeviceId: "board", connectionProfileId: "usb" },
    ],
    physicalGraphs: [{ layer: "physical-composition", nodes: [], edges: [] }],
    deviceGraphs: [{ layer: "device-processing", nodes: [], edges: [] }],
    authoringMetadata: {},
  } as any;
  const plan = planModuleImport(
    project,
    "master",
    "master:board",
    catalogDs18b20Driver(),
    {
      name: "Function",
      variant: "v1",
      modes: [0, 0, 0, 0],
      i2cSpeed: 0,
      local: true,
      backendPortId: 0,
    } as any,
  );
  expect(plan.channels).toEqual({ DATA: 0 });
  expect(plan.physical.modes).toEqual([1, 0, 0, 0]);
  const { draftToCanvasSensorRecipes } = await import("../device-recipe-draft.js");
  const old = {
    ...catalogDht22Driver(),
    temperatureSensorModel: undefined,
    dht22Version: 2,
    name: "DHT22",
    id: "old",
  };
  const recipe = draftToCanvasSensorRecipes(old)[0]!;
  const saved = JSON.stringify({
    version: 1,
    byBinding: {
      master: [
        {
          id: "unit",
          label: "DHT22",
          recipe,
          recipeId: recipe.id,
          bus: "gpio",
          gpioAssignments: { boardKey: "board", channels: { DATA: 0, POWER: 1 } },
        },
      ],
    },
  });
  const unit = parseBackboneSensorModules(saved).byBinding.master![0]!;
  expect(unit.id).toBe("unit");
  expect(unit.label).toBe("DHT11");
  expect(unit.gpioAssignments?.channels).toEqual({ DATA: 0, POWER: 1 });
  expect(unit.recipe.deviceDraft?.temperatureSensorModel).toBe("dht11");
});

it("persists GPIO supply mode and encodes its power channel", () => {
  const base = catalogDs18b20Driver();
  const draft = withDs18b20PowerMode(base, "gpio");
  expect(draft.commands).toEqual(base.commands);
  expect(draft.binding.gpioSignals.map((s) => s.id)).toEqual(["DATA", "POWER"]);
  expect(
    parseDeviceRecipeDraft(serializeDeviceRecipeDraft(draft))?.ds18b20PowerMode,
  ).toBe("gpio");
  const profile = compileRuntimeDriver(
    draft,
    new Map(),
    new Map([
      ["DATA", 0],
      ["POWER", 1],
    ]),
  ).profile;
  expect(profile.initOps).toEqual([
    { op: "DS18B20_SETUP", channel: 0, on: true, powerChannel: 1 },
  ]);
  expect(profile.safeStopOps).toEqual([
    { op: "DS18B20_SETUP", channel: 0, on: false, powerChannel: 1 },
  ]);
  expect(decodeDeviceProfileCbor(encodeDeviceProfileCbor(profile))).toMatchObject({
    ok: true,
    value: expect.objectContaining({ initOps: profile.initOps }),
  });
  expect(
    withDs18b20PowerMode(draft, "parasite").binding.gpioSignals.map((s) => s.id),
  ).toEqual(["DATA"]);
});

it("releases A1 on replacement with parasite mode while preserving unrelated pins", () => {
  const project = {
    coreBindings: [
      { bindingId: "master", expectedDeviceId: "board", connectionProfileId: "usb" },
    ],
    physicalGraphs: [],
    deviceGraphs: [{ layer: "device-processing", nodes: [], edges: [] }],
    authoringMetadata: {},
  } as any;
  const physical = {
    name: "Function",
    variant: "v1",
    modes: [0, 0, 2, 0],
    i2cSpeed: 0,
    local: true,
    backendPortId: 0,
  } as any;
  const powered = planModuleImport(
    project,
    "master",
    "master:board",
    withDs18b20PowerMode(catalogDs18b20Driver(), "gpio"),
    physical,
  );
  const saved = commitModuleImport(project, powered, "sensor", false, false);
  const parasite = planModuleImport(
    saved,
    "master",
    "master:board",
    catalogDs18b20Driver(),
    powered.physical,
  );
  expect(parasite.conflicts).toHaveLength(1);
  expect(parasite.physical.modes).toEqual([1, 0, 2, 0]);
});

it("round-trips diagnostic scratchpad reads without changing normal DS18B20 reads", () => {
  const draft = catalogDs18b20Driver();
  const profile = compileRuntimeDriver(
    draft,
    new Map(),
    new Map([["DATA", 0]]),
  ).profile;
  const diagnostic = {
    ...profile,
    sampleOps: profile.sampleOps.map((op) =>
      op.op === "DS18B20_READ" ? { ...op, rawScratchpad: true } : op,
    ),
  };
  expect(decodeDeviceProfileCbor(encodeDeviceProfileCbor(diagnostic))).toMatchObject({
    ok: true,
    value: expect.objectContaining({ sampleOps: diagnostic.sampleOps }),
  });
  expect(profile.sampleOps[0]).not.toHaveProperty("rawScratchpad");
});
