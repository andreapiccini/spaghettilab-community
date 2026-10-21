import { describe, expect, it } from "vitest";
import {
  catalogGpioRelayDriver,
  createGpioRelayPreset,
} from "../gpio-driver-presets.js";
import {
  effectiveActionSteps,
  validateDraftForCreate,
} from "../device-recipe-draft.js";
import { compileRuntimeDriver } from "../driver-runtime-profile.js";
import { isMappedTrigger, mappedTriggerActionSteps } from "../gpio-trigger-map.js";
import {
  addLibraryDriver,
  builtinNfcDrivers,
  driverRevision,
  emptyNfcLibrary,
  mergeBuiltinNfcDrivers,
  resolveLibraryDriver,
} from "../nfc-workspace.js";
import { installNfcDriver, nfcWiring } from "../nfc-installation.js";
import {
  configuredDigitalOutputPins,
  PHYSICAL_META_KEY,
} from "../backbone-physical.js";
import type { ProjectV1 } from "@spaghettilab/domain";

describe("relay GPIO driver", () => {
  it("exposes ON/OFF, starts OFF, maps trigger HIGH/LOW onto those actions, and publishes state", () => {
    const draft = createGpioRelayPreset();
    expect(validateDraftForCreate(draft)).toEqual([]);
    expect(draft.commands.map((command) => command.name)).toEqual(["on", "off"]);
    expect(draft.phases.init).toEqual([
      expect.objectContaining({
        type: "gpio_write",
        signalId: "RELAY_CONTROL",
        level: 0,
      }),
    ]);
    const input = draft.flowInterfaces?.find((op) => op.type === "sample_external");
    expect(input).toMatchObject({
      inputMode: "trigger",
      triggerHighAction: "on",
      triggerLowAction: "off",
      valueType: "bool",
    });
    expect(isMappedTrigger(input!)).toBe(true);
    expect(
      draft.flowInterfaces?.some(
        (op) => op.type === "emit" && op.channelId === "stato",
      ),
    ).toBe(true);
    expect(draft.channels.map((channel) => channel.id).sort()).toEqual([
      "comando",
      "stato",
    ]);
    expect(
      effectiveActionSteps(draft, draft.commands[0]!).map((op) => op.type),
    ).toEqual(["gpio_write", "gpio_read", "emit"]);
  });

  it("compiles ON/OFF writes and a mapped trigger that follows the incoming level", () => {
    const draft = createGpioRelayPreset();
    const compiled = compileRuntimeDriver(
      draft,
      new Map(),
      new Map([["RELAY_CONTROL", 2]]),
    );
    expect(compiled.profile.initOps).toEqual([
      { op: "GPIO_SET", value: false, channel: 2 },
    ]);
    const on = compileRuntimeDriver(
      { ...draft, commands: [draft.commands[0]!], flowInterfaces: [] },
      new Map(),
      new Map([["RELAY_CONTROL", 2]]),
    );
    expect(on.profile.sampleOps).toContainEqual({
      op: "GPIO_SET",
      value: true,
      channel: 2,
    });
    const input = draft.flowInterfaces!.find((op) => op.type === "sample_external")!;
    const follow = mappedTriggerActionSteps(draft, input);
    expect(follow.map((op) => op.type)).toEqual([
      "sample_external",
      "gpio_write",
      "gpio_read",
      "emit",
    ]);
    const mapped = compileRuntimeDriver(
      {
        ...draft,
        commands: [{ ...draft.commands[0]!, steps: follow }],
        flowInterfaces: [],
      },
      new Map([[draft.commands[0]!.id, new Set(["comando"])]]),
      new Map([["RELAY_CONTROL", 2]]),
    );
    expect(
      mapped.profile.sampleOps.some(
        (op) => op.op === "GPIO_SET_VALUE" && op.channel === 2,
      ),
    ).toBe(true);
  });

  it("inverts the incoming level when HIGH maps to OFF", () => {
    const draft = createGpioRelayPreset();
    const input = {
      ...draft.flowInterfaces!.find((op) => op.type === "sample_external")!,
      triggerHighAction: "off",
      triggerLowAction: "on",
    };
    const write = mappedTriggerActionSteps(draft, input).find(
      (op) => op.type === "gpio_write",
    );
    expect(write).toMatchObject({
      type: "gpio_write",
      invert: true,
      value: { kind: "variable", name: "comando" },
    });
  });
});

describe("relay NFC catalog", () => {
  it("is ready and selectable without saving a project driver first", () => {
    const catalog = catalogGpioRelayDriver();
    expect(catalog.id).toBe("gpio-relay");
    expect(validateDraftForCreate(catalog)).toEqual([]);
    expect(driverRevision(catalog).ready).toBe(true);
    const library = mergeBuiltinNfcDrivers(emptyNfcLibrary());
    expect(builtinNfcDrivers().map((driver) => driver.id)).toContain("gpio-relay");
    expect(resolveLibraryDriver(library, "gpio-relay")?.draft.name).toBe("Relè");
    const again = mergeBuiltinNfcDrivers(addLibraryDriver(library, catalog));
    expect(again.drivers.filter((driver) => driver.id === "gpio-relay")).toHaveLength(
      1,
    );
    expect(library.models.some((model) => model.id === "model-gpio-relay")).toBe(true);
    expect(library.units.filter((unit) => unit.modelId === "model-gpio-relay")).toEqual([]);
  });
});

function gpioProject(modes: readonly number[] = [2, 0, 0, 0, 0, 0, 0, 0]): ProjectV1 {
  return {
    schemaVersion: 1,
    projectId: "project",
    name: "NFC relay",
    coreBindings: [
      { bindingId: "master", expectedDeviceId: "board", connectionProfileId: "usb" },
    ],
    physicalGraphs: [],
    deviceGraphs: [{ layer: "device-processing", nodes: [], edges: [] }],
    systemAutomationGraph: { layer: "system-automation", nodes: [], edges: [] },
    requiredArtifacts: [],
    deploymentRecords: [],
    deviceProfilePackages: [],
    authoringMetadata: {
      [PHYSICAL_META_KEY]: {
        comment: JSON.stringify({
          drafts: {
            "master:board": {
              applied: true,
              variant: "v2",
              modes,
              name: "Function",
              i2cSpeed: 100000,
              local: true,
            },
          },
          catalog: [],
        }),
      },
    },
  } as unknown as ProjectV1;
}

describe("relay NFC installation", () => {
  it("wires the configured digital OUT pin and keeps the assignment on the module", () => {
    const driver = catalogGpioRelayDriver();
    const project = gpioProject();
    expect(
      configuredDigitalOutputPins(
        JSON.parse(project.authoringMetadata[PHYSICAL_META_KEY]!.comment!).drafts,
        "master",
      ),
    ).toEqual([expect.objectContaining({ channel: 0, label: "A0 · OUT" })]);
    expect(nfcWiring(project, "master", driver, "5V").lines[0]).toEqual({
      signal: "RELAY",
      pin: "A0",
    });
    const installed = installNfcDriver(
      project,
      "master",
      "UID-RELAY",
      driver,
      "1",
      "5V",
    );
    expect(installed.deviceGraphs[0]?.nodes).toHaveLength(1);
    const modules = JSON.parse(
      installed.authoringMetadata.__backboneSensorModules!.comment,
    ) as {
      byBinding: Record<string, { gpioAssignment?: { channel: number } }[]>;
    };
    expect(modules.byBinding.master?.[0]?.gpioAssignment?.channel).toBe(0);
  });

  it("uses the GPIO OUT pin chosen in the module popup", () => {
    const driver = catalogGpioRelayDriver();
    const project = gpioProject([2, 2, 0, 0, 0, 0, 0, 0]);
    expect(
      nfcWiring(project, "master", driver, "5V", {
        boardKey: "master:board",
        channel: 1,
      }).lines[0],
    ).toEqual({
      signal: "RELAY",
      pin: "A1",
    });
    const installed = installNfcDriver(
      project,
      "master",
      "UID-RELAY",
      driver,
      "1",
      "5V",
      { boardKey: "master:board", channel: 1 },
    );
    const modules = JSON.parse(
      installed.authoringMetadata.__backboneSensorModules!.comment,
    ) as {
      byBinding: Record<string, { gpioAssignment?: { channel: number } }[]>;
    };
    expect(modules.byBinding.master?.[0]?.gpioAssignment?.channel).toBe(1);
  });

  it("still places a GPIO relay on the Run Deploy canvas without a mapped pin", () => {
    const driver = catalogGpioRelayDriver();
    const project = {
      ...gpioProject(),
      authoringMetadata: {},
    } as unknown as ProjectV1;
    const installed = installNfcDriver(project, "master", "UID-RELAY", driver, "1", "");
    expect(installed.deviceGraphs[0]?.nodes).toHaveLength(1);
    expect(installed.deviceGraphs[0]?.nodes[0]?.id).toBe("nfc-block-UID-RELAY");
  });
});
