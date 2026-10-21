import { describe, expect, it } from "vitest";
import { compileRuntimeDriver } from "../driver-runtime-profile.js";
import { programFromRuntime } from "../module-program.js";
import {
  catalogGpioRelayDriver,
  catalogDht22Driver,
  catalogDs18b20Driver,
} from "../gpio-driver-presets.js";
import { rgbModuleDraft } from "../rgb-module.js";
import {
  migrateDraft,
  parseDeviceRecipeDraft,
  serializeDeviceRecipeDraft,
} from "../device-recipe-draft.js";
import { editModuleMetadata } from "../new-device-driver.js";
import { DEVICE_RECIPE_DRAFT_META_KEY } from "../device-recipe-draft.js";

for (const factory of [
  catalogGpioRelayDriver,
  catalogDht22Driver,
  catalogDs18b20Driver,
  rgbModuleDraft,
]) {
  it(`preserves executable instructions and action contracts for ${factory.name}`, () => {
    const draft = factory();
    const channels = new Map(
      draft.binding.gpioSignals.map((signal, index) => [signal.id, index]),
    );
    const original = compileRuntimeDriver(draft, new Map(), channels);
    const program = programFromRuntime(draft, original);
    const restored = migrateDraft({ ...draft, moduleProgram: program });
    expect(restored.moduleProgram).toEqual(program);
    const next = compileRuntimeDriver(restored, new Map(), channels);
    expect(next.profile.initOps).toEqual(original.profile.initOps);
    expect(next.profile.sampleOps).toEqual(original.profile.sampleOps);
    expect(next.profile.safeStopOps).toEqual(original.profile.safeStopOps);
    expect(next.actions).toEqual(original.actions);
  });
}
describe("common module program", () => {
  it("compiles edited steps instead of regenerating the original preset", () => {
    const draft = catalogGpioRelayDriver();
    const runtime = compileRuntimeDriver(
      draft,
      new Map(),
      new Map([[draft.binding.gpioSignals[0]!.id, 0]]),
    );
    const program = programFromRuntime(draft, runtime);
    const edited = {
      ...draft,
      moduleProgram: {
        ...program,
        profile: {
          ...program.profile,
          initOps: [{ op: "GPIO_SET" as const, value: true, channel: 0 }],
        },
      },
    };
    const restored = parseDeviceRecipeDraft(serializeDeviceRecipeDraft(edited))!;
    const result = compileRuntimeDriver(
      restored,
      new Map(),
      new Map([[program.signals[0]!, 3]]),
    );
    expect(result.profile.initOps).toEqual([
      { op: "GPIO_SET", value: true, channel: 3 },
    ]);
    expect(program.profile.initOps).toEqual(runtime.profile.initOps);
    expect(result.profile.profileId).not.toBe(runtime.profile.profileId);
  });
  it("remaps packed RGB channels using the module's named signals", () => {
    const draft = rgbModuleDraft();
    const program = programFromRuntime(
      draft,
      compileRuntimeDriver(
        draft,
        new Map(),
        new Map([
          ["RED", 0],
          ["GREEN", 1],
          ["BLUE", 2],
        ]),
      ),
    );
    const runtime = compileRuntimeDriver(
      { ...draft, moduleProgram: program },
      new Map(),
      new Map([
        ["RED", 2],
        ["GREEN", 0],
        ["BLUE", 3],
      ]),
    );
    expect(runtime.profile.initOps[0]).toMatchObject({
      op: "RGB_PROGRAM",
      channels: 50,
    });
    expect(program.profile.initOps[0]).toMatchObject({ channels: 36 });
  });
  it("copies library recipes without mutating installed module snapshots", () => {
    const draft = catalogGpioRelayDriver();
    const copy = editModuleMetadata({}, draft, true);
    const edited = parseDeviceRecipeDraft(copy[DEVICE_RECIPE_DRAFT_META_KEY]?.comment)!;
    expect(edited.id).not.toBe(draft.id);
    expect(edited.commands).toEqual(draft.commands);
    expect(draft.name).not.toContain("copia");
  });
  it("rejects instructions that do not match the module transport", () => {
    const draft = catalogGpioRelayDriver();
    const runtime = compileRuntimeDriver(
      draft,
      new Map(),
      new Map([[draft.binding.gpioSignals[0]!.id, 0]]),
    );
    const program = programFromRuntime(draft, runtime);
    expect(() =>
      compileRuntimeDriver(
        {
          ...draft,
          moduleProgram: {
            ...program,
            profile: {
              ...program.profile,
              initOps: [{ op: "I2C_READ", dst: 0, length: 2, timeoutMs: 10 }],
            },
          },
        },
        new Map(),
        new Map([[program.signals[0]!, 0]]),
      ),
    ).toThrow();
  });
});

it("deploys edited module actions through real canvas instance IDs", async () => {
  const { planModuleImport, commitModuleImport } = await import("../module-import.js");
  const { prepareDriverDeployment } = await import("../driver-deployment-plan.js");
  const { compileConfig } = await import("@spaghettilab/config-compiler");
  const { DEFAULT_ENERGY, DISABLED_MQTT } = await import("../default-config-policy.js");
  const { synchronizeModuleProgram } = await import("../module-program.js");
  const { createModuleProgramDraft } = await import("../new-module-program.js");
  const project = {
    coreBindings: [
      { bindingId: "master", expectedDeviceId: "board", connectionProfileId: "usb" },
    ],
    physicalGraphs: [{ layer: "physical-composition", nodes: [], edges: [] }],
    deviceGraphs: [{ layer: "device-processing", nodes: [], edges: [] }],
    authoringMetadata: {},
  } as unknown as import("@spaghettilab/domain").ProjectV1;
  const initial = createModuleProgramDraft("i2c");
  const program = initial.moduleProgram!;
  const draft = synchronizeModuleProgram({
    ...initial,
    status: "ready",
    moduleProgram: {
      ...program,
      profile: {
        ...program.profile,
        sampleOps: [
          { op: "I2C_READ", dst: 0, length: 2, timeoutMs: 50 },
          {
            op: "EMIT_FIELD",
            src: 0,
            fieldId: 1,
            width: 2,
            byteOrder: "be",
            signExtend: false,
            multiplier: 0,
          },
          { op: "EMIT_RECORD" },
        ],
        actions: [{ id: 1, first: 0, count: 3 }],
        sampleFields: [{ fieldId: 1, name: "temperature", type: "int64" }],
      },
    },
  });
  const proposal = planModuleImport(project, "master", "master:board", draft, {
    name: "Function",
    modes: [0, 0, 0, 0],
    i2cSpeed: 0,
    local: true,
    backendPortId: 0,
  });
  const installed = commitModuleImport(project, proposal, "native-i2c", false, true);
  const planned = prepareDriverDeployment(installed, "master", {
    physicalGraph: installed.physicalGraphs[0]!,
    processingGraph: installed.deviceGraphs[0]!,
    mqtt: DISABLED_MQTT,
    energy: DEFAULT_ENERGY,
    connectivity: 0,
  });
  expect(planned.profiles[0]?.sampleOps).toContainEqual({
    op: "I2C_READ",
    dst: 0,
    length: 2,
    timeoutMs: 50,
  });
  expect(compileConfig(planned.input, planned.options).ok).toBe(true);
});

it("retains generic SPI, UART and ADC transport declarations through import and canvas compilation", async () => {
  const { createModuleProgramDraft } = await import("../new-module-program.js");
  const { planModuleImport, commitModuleImport } = await import("../module-import.js");
  const { prepareDriverDeployment } = await import("../driver-deployment-plan.js");
  const { compileConfig } = await import("@spaghettilab/config-compiler");
  const { DEFAULT_ENERGY, DISABLED_MQTT } = await import("../default-config-policy.js");
  for (const bus of ["spi", "uart", "adc"] as const) {
    const draft = { ...createModuleProgramDraft(bus), status: "ready" as const };
    const project = {
      coreBindings: [
        { bindingId: "master", expectedDeviceId: "board", connectionProfileId: "usb" },
      ],
      physicalGraphs: [{ layer: "physical-composition", nodes: [], edges: [] }],
      deviceGraphs: [{ layer: "device-processing", nodes: [], edges: [] }],
      authoringMetadata: {},
    } as unknown as import("@spaghettilab/domain").ProjectV1;
    const proposal = planModuleImport(project, "master", "master:board", draft, {
      name: "Function",
      modes: [0, 0, 0, 0],
      i2cSpeed: 0,
      local: true,
      backendPortId: 0,
    });
    const installed = commitModuleImport(
      project,
      proposal,
      `native-${bus}`,
      false,
      true,
    );
    const plan = prepareDriverDeployment(installed, "master", {
      physicalGraph: installed.physicalGraphs[0]!,
      processingGraph: installed.deviceGraphs[0]!,
      mqtt: DISABLED_MQTT,
      energy: DEFAULT_ENERGY,
      connectivity: 0,
    });
    expect(plan.profiles[0]?.transport).toBe(draft.moduleProgram!.profile.transport);
    expect(compileConfig(plan.input, plan.options).ok).toBe(true);
  }
});

it("compiles PWM from shared steps and preserves its signal binding", async () => {
  const { createModuleProgramDraft } = await import("../new-module-program.js");
  const { toRawOp, fromRawOp } =
    await import("@spaghettilab/device-profile-authoring-model");
  const initial = createModuleProgramDraft("gpio");
  const program = initial.moduleProgram!;
  const draft = {
    ...initial,
    binding: {
      ...initial.binding,
      gpioSignals: initial.binding.gpioSignals.map((signal) => ({
        ...signal,
        signalType: "pwm_output" as const,
      })),
    },
    moduleProgram: {
      ...program,
      profile: {
        ...program.profile,
        requiredCapabilities: 128,
        initOps: [
          { op: "LOAD_CONST" as const, dst: 0, length: 2, low: 2500, high: 0 },
          { op: "PWM_SET" as const, src: 0, channel: 0, frequencyHz: 1000 },
        ],
      },
    },
  };
  const compiled = compileRuntimeDriver(draft, new Map(), new Map([["OUTPUT", 2]]));
  expect(compiled.profile.initOps[1]).toEqual({
    op: "PWM_SET",
    src: 0,
    channel: 2,
    frequencyHz: 1000,
  });
  const raw = toRawOp(compiled.profile.initOps[1]!);
  expect(raw).toMatchObject({ opcode: 41, imm0: 2, imm2: 1000 });
  expect(fromRawOp(raw)).toEqual({ ok: true, value: compiled.profile.initOps[1] });
});

it("keeps legacy PWM LED recipes executable without offering the redundant catalog entry", async () => {
  const { catalogPwmLedModule } = await import("../pwm-led-module.js");
  const { availableModuleDrivers } = await import("../module-catalog.js");
  const { builtinNfcDrivers } = await import("../nfc-workspace.js");
  const { validateDraftForCreate } = await import("../device-recipe-draft.js");
  const draft = catalogPwmLedModule();
  expect(validateDraftForCreate(draft)).toEqual([]);
  const compiled = compileRuntimeDriver(draft, new Map(), new Map([["OUTPUT", 1]]));
  expect(
    compiled.profile.sampleOps.filter((step) => step.op === "PWM_SET"),
  ).toHaveLength(3);
  expect(compiled.profile.safeStopOps[1]).toMatchObject({ op: "PWM_SET", channel: 1 });
  expect(compiled.actions.get("pwm-level")?.inputIds).toEqual({ level: 1 });
  expect(
    availableModuleDrivers(undefined, {
      drivers: builtinNfcDrivers(),
      modules: [],
      units: [],
    } as unknown as Parameters<typeof availableModuleDrivers>[1]).some(
      (driver) => driver.id === "gpio-pwm-led",
    ),
  ).toBe(false);
});
