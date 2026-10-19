import { catalogUln2003Driver } from "../gpio-driver-presets.js";
import {
  SEQUENCE_TYPE,
  MOVEMENT_COMPLETED_FIELD,
  sequenceActionNodeId,
} from "../flow-sequence.js";
import {
  catalogGpioRelayDriver,
  createGpioDigitalDriver,
} from "../gpio-driver-presets.js";
import {
  SENSOR_INSTANCE_PROP,
  SENSOR_INPUT_PROP,
  SENSOR_OUTPUT_PROP,
} from "../sensor-instance.js";
import { describe, expect, it } from "vitest";
import type { ProjectV1 } from "@spaghettilab/domain";
import { compileConfig, type CompileConfigInput } from "@spaghettilab/config-compiler";
import {
  encodeDeviceProfileCbor,
  decodeDeviceProfileCbor,
} from "@spaghettilab/device-profile-install";
import {
  createBlankDraft,
  addCommand,
  updateCommand,
  updateOpAnywhere,
  organizeDriverInterfaces,
  effectiveActionSteps,
  parseDeviceRecipeDraft,
  serializeDeviceRecipeDraft,
  type DeviceRecipeDraft,
} from "../device-recipe-draft.js";
import { addRegisterAction } from "../i2c-driver-actions.js";
import { addFlowInterface } from "../flow-interfaces.js";
import { installDriverProfiles } from "../driver-profile-deployment.js";
import { compileRuntimeDriver } from "../driver-runtime-profile.js";
import { prepareDriverDeployment } from "../driver-deployment-plan.js";
import { BACKBONE_SENSOR_MODULES_META_KEY } from "../backbone-sensor-modules.js";
import { PHYSICAL_META_KEY } from "../backbone-physical.js";
import {
  BACKBONE_SENSOR_BLOCK_TYPE_ID,
  SENSOR_ACTION_ID_PROP,
  SENSOR_MODULE_ID_PROP,
} from "../backbone-sensor-block.js";
import { DEFAULT_ENERGY, DISABLED_MQTT } from "../default-config-policy.js";
import { parseI2cMessage } from "../i2c-message-input.js";
import { readableTimingScale } from "../timing-scale.js";
import { buildProtocolTimingFromOps } from "../protocol-timing.js";
import { readableI2cStep } from "../i2c-step-label.js";
import { recipePlanToTestProfile } from "../recipe-to-test-profile.js";

const oled =
  "00 AE D5 80 A8 1F D3 00 40 8D 14 20 00 A1 C8 DA 02 81 CF D9 F1 DB 40 A4 A6 2E AF A5";
function readDriver() {
  const draft = addRegisterAction(createBlankDraft("i2c", "MPU6050"), "read", true);
  return {
    ...draft,
    binding: { ...draft.binding, i2c: { ...draft.binding.i2c!, address: "0x68" } },
  };
}
function deployment(
  draft: DeviceRecipeDraft,
  edges: CompileConfigInput["processingGraph"]["edges"] = [],
) {
  const nodes = draft.commands.map((command) => ({
    layer: "device-processing" as const,
    id: command.id,
    data: {
      kind: "block" as const,
      blockTypeId: BACKBONE_SENSOR_BLOCK_TYPE_ID,
      properties: {
        [SENSOR_MODULE_ID_PROP]: "sensor",
        [SENSOR_ACTION_ID_PROP]: command.id,
      },
    },
  }));
  const project = {
    authoringMetadata: {
      [BACKBONE_SENSOR_MODULES_META_KEY]: {
        comment: JSON.stringify({
          version: 1,
          byBinding: { core: [{ id: "sensor", recipe: { deviceDraft: draft } }] },
        }),
      },
      [PHYSICAL_META_KEY]: {
        comment: JSON.stringify({
          drafts: {
            "core:physical": { applied: true, backendPortId: 0, modes: [4, 5, 0, 0] },
          },
          catalog: [],
        }),
      },
    },
  } as unknown as ProjectV1;
  const input: CompileConfigInput = {
    physicalGraph: { layer: "physical-composition", nodes: [], edges: [] },
    processingGraph: {
      layer: "device-processing",
      nodes: [
        {
          layer: "device-processing",
          id: "timer",
          data: { kind: "schedule", moduleNodeId: "", periodMs: 500, enabled: true },
        },
        {
          layer: "device-processing",
          id: "activation",
          data: { kind: "block", blockTypeId: "ab.flow_start", properties: {} },
        },
        ...nodes,
      ],
      edges: [
        {
          id: "tick",
          source: "timer",
          target: "activation",
          sourceHandle: "0",
          targetHandle: "0",
        },
        ...edges,
      ],
    },
    mqtt: DISABLED_MQTT,
    connectivity: 0,
    energy: DEFAULT_ENERGY,
  };
  return { project, input };
}
describe("production driver deployment", () => {
  it("installs one complete profile per driver and translates activation into a real command rule", () => {
    const draft = readDriver(),
      fixture = deployment(draft, [
        {
          id: "run",
          source: "activation",
          target: draft.commands[0]!.id,
          sourceHandle: "0",
          targetHandle: "execute",
        },
      ]);
    const plan = prepareDriverDeployment(fixture.project, "core", fixture.input);
    expect(plan.profiles).toHaveLength(2);
    expect(plan.profiles[0]?.actions).toHaveLength(1);
    const compiled = compileConfig(plan.input, plan.options);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    expect(compiled.value.blocks).toEqual([]);
    expect(compiled.value.modules).toHaveLength(2);
    expect(
      compiled.value.modules.every(
        (module) => module.bayId === undefined && module.powerRailId === undefined,
      ),
    ).toBe(true);
    expect(compiled.value.rules[0]?.typeId).toBe("device-action");
    expect(compiled.value.rules[0]?.properties[4]).toBe(1n);
    expect(compiled.value.schedules[0]?.periodMs).toBe(500);
    const profile = plan.profiles[0]!;
    expect(decodeDeviceProfileCbor(encodeDeviceProfileCbor(profile))).toEqual({
      ok: true,
      value: profile,
    });
    const withField = profile.sampleOps.find((op) => op.op === "EMIT_FIELD");
    expect(withField).toMatchObject({ width: 1, byteOrder: "be", signExtend: false });
  });
  it("shares one hardware instance across read/write actions and latches connected parameters", () => {
    let draft = organizeDriverInterfaces(
      addRegisterAction(readDriver(), "write", true),
    );
    const writeId = draft.commands[1]!.id;
    let added = addFlowInterface(draft, "sample_external");
    draft = added.draft;
    const source = added.op;
    if (source.type !== "sample_external") throw new Error("input");
    added = addFlowInterface(draft, "encode");
    draft = added.draft;
    const encoder = added.op;
    if (encoder.type !== "encode") throw new Error("encoder");
    draft = {
      ...draft,
      flowInterfaces: draft.flowInterfaces!.map((op) =>
        op.id === encoder.id ? { ...encoder, widthBytes: 1 } : op,
      ),
      commands: draft.commands.map((command) =>
        command.id === writeId
          ? {
              ...command,
              steps: [
                { id: "write", type: "i2c_write", bytes: ["6B", `$${encoder.into}`] },
              ],
            }
          : command,
      ),
    };
    const fixture = deployment(draft, [
      {
        id: "read",
        source: "activation",
        target: draft.commands[0]!.id,
        targetHandle: "execute",
      },
      {
        id: "write-trigger",
        source: "activation",
        target: writeId,
        targetHandle: "execute",
      },
      {
        id: "value",
        source: draft.commands[0]!.id,
        target: writeId,
        sourceHandle: draft.channels.find((c) => c.direction === "read")!.id,
        targetHandle: source.fromChannelId,
      },
    ]);
    const plan = prepareDriverDeployment(fixture.project, "core", fixture.input);
    expect(plan.profiles[0]?.actions).toHaveLength(2);
    expect(
      plan.profiles[0]?.sampleOps.some(
        (op) => op.op === "LOAD_ARGUMENT" && op.required && op.length === 1,
      ),
    ).toBe(true);
    const compiled = compileConfig(plan.input, plan.options);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    expect(
      compiled.value.modules.filter((module) => Number(module.properties[4]) === 0x68),
    ).toHaveLength(1);
    expect(
      compiled.value.rules.filter((rule) => rule.properties[8] === 3n),
    ).toHaveLength(1);
  });
  it("arms the on-boot event source without periodically sampling it", () => {
    const draft = readDriver(),
      fixture = deployment(draft);
    const input = {
      ...fixture.input,
      processingGraph: {
        ...fixture.input.processingGraph,
        nodes: [
          ...fixture.input.processingGraph.nodes,
          {
            layer: "device-processing" as const,
            id: "boot",
            data: {
              kind: "event-source" as const,
              catalogEntryId: "appblocks.system",
              moduleNodeId: "",
            },
          },
        ],
        edges: [
          ...fixture.input.processingGraph.edges,
          {
            id: "boot-run",
            source: "boot",
            target: draft.commands[0]!.id,
            targetHandle: "execute",
          },
        ],
      },
    };
    const plan = prepareDriverDeployment(fixture.project, "core", input);
    const compiled = compileConfig(plan.input, plan.options);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) throw new Error(JSON.stringify(compiled.error));
    const boot = compiled.value.modules.find((module) => module.typeId === "on_boot")!;
    expect(compiled.value.schedules).toContainEqual({
      sourceKey: boot.key,
      periodMs: 1000,
      enabled: false,
    });
    const rule = compiled.value.rules.find(
      (rule) => rule.properties[1] === BigInt(boot.key),
    )!;
    expect(rule.properties[5]).toBeUndefined();
  });
  it("persists custom step names in actions and initialization without changing executable behavior", () => {
    const base = readDriver();
    const draft = {
      ...base,
      phases: {
        ...base.phases,
        init: [{ id: "init-write", type: "i2c_write" as const, bytes: ["00"] }],
      },
    };
    const step = draft.commands[0]!.steps[0]!;
    const before = compileRuntimeDriver(draft);
    const renamed = updateOpAnywhere(
      updateOpAnywhere(draft, step.id, { ...step, label: "Acquisisci temperatura" }),
      "init-write",
      { ...draft.phases.init[0]!, label: "Prepara il sensore" },
    );
    const restored = parseDeviceRecipeDraft(serializeDeviceRecipeDraft(renamed))!;
    expect(restored.commands[0]!.steps[0]!.label).toBe("Acquisisci temperatura");
    expect(restored.phases.init[0]!.label).toBe("Prepara il sensore");
    expect(restored.commands[0]!.steps[0]!.id).toBe(step.id);
    expect(readableI2cStep(restored, restored.commands[0]!.steps[0]!)).toContain(
      "Acquisisci temperatura",
    );
    expect(compileRuntimeDriver(restored).profile.profileId).toBe(
      before.profile.profileId,
    );
  });
  it("preserves the canvas action reference and firmware identity when renaming an action identifier", () => {
    const draft = readDriver();
    const action = draft.commands[0]!;
    const before = compileRuntimeDriver(draft);
    const renamed = updateCommand(draft, action.id, {
      ...action,
      name: "leggi_temperatura",
      label: "Leggi temperatura",
    });
    const restored = parseDeviceRecipeDraft(serializeDeviceRecipeDraft(renamed))!;
    const after = compileRuntimeDriver(restored);
    expect(restored.commands[0]!.id).toBe(action.id);
    expect(restored.commands[0]!.name).toBe("leggi_temperatura");
    expect(restored.commands[0]!.steps).toEqual(action.steps);
    expect(after.actions.get(action.id)?.commandId).toBe(
      before.actions.get(action.id)?.commandId,
    );
    expect(after.profile.profileId).toBe(before.profile.profileId);
  });
  it("keeps profile identities stable across labels/positions, changes identity when bytes change", () => {
    const draft = readDriver();
    const a = compileRuntimeDriver(draft).profile;
    expect(
      compileRuntimeDriver({ ...draft, name: "Renamed", updatedAt: 1 }).profile
        .profileId,
    ).toBe(a.profileId);
    const changed = {
      ...draft,
      commands: draft.commands.map((command) => ({
        ...command,
        steps: command.steps.map((op) =>
          op.type === "i2c_write_read" ? { ...op, writeBytes: ["76"] } : op,
        ),
      })),
    };
    expect(compileRuntimeDriver(changed).profile.profileId).not.toBe(a.profileId);
  });
  it("loads a published variable from another action through device memory", () => {
    const base = readDriver(),
      decoder = base.commands[0]!.steps.find((op) => op.type === "decode");
    if (!decoder || decoder.type !== "decode") throw new Error("decoder");
    const draft = addCommand(base, {
      label: "Write cached",
      steps: [{ id: "cached", type: "i2c_write", bytes: [`$${decoder.into}`] }],
    });
    const profile = compileRuntimeDriver(draft).profile;
    expect(profile.sampleOps).toContainEqual(
      expect.objectContaining({ op: "LOAD_VALUE", argumentId: 1, length: 1 }),
    );
  });
  it("rejects dangling wires and cycles before installing any profile", () => {
    const draft = readDriver(),
      fixture = deployment(draft, [
        {
          id: "broken",
          source: "missing",
          target: draft.commands[0]!.id,
          targetHandle: "execute",
        },
      ]);
    expect(() =>
      prepareDriverDeployment(fixture.project, "core", fixture.input),
    ).toThrow(/non disponibile/);
    const cycle = deployment(draft, [
      {
        id: "loop",
        source: draft.commands[0]!.id,
        target: draft.commands[0]!.id,
        targetHandle: "execute",
      },
    ]);
    expect(() => prepareDriverDeployment(cycle.project, "core", cycle.input)).toThrow(
      /ciclo/,
    );
  });
  it("rejects unimplemented operations instead of dropping them during deploy", () => {
    const draft = readDriver();
    expect(() =>
      compileRuntimeDriver({
        ...draft,
        commands: [
          {
            ...draft.commands[0]!,
            steps: [
              {
                id: "scan",
                type: "i2c_scan",
                fromAddress: "08",
                toAddress: "77",
                into: "devices",
              },
            ],
          },
        ],
      }),
    ).toThrow(/non compilabile/);
  });
});
describe("OLED messages and Flow interfaces", () => {
  it("pastes every OLED byte and transmits them in one transaction without truncation", () => {
    const parsed = parseI2cMessage(oled);
    expect(parsed.error).toBeUndefined();
    expect(parsed.tokens).toHaveLength(28);
    const draft = addCommand(createBlankDraft("i2c"), {
      label: "OLED",
      steps: [{ id: "oled", type: "i2c_write", bytes: parsed.tokens }],
    });
    const profile = compileRuntimeDriver(draft).profile;
    expect(profile.sampleOps.filter((op) => op.op === "I2C_WRITE")).toEqual([
      expect.objectContaining({ length: 28 }),
    ]);
    const test = recipePlanToTestProfile(draft, [], draft.commands[0]!.steps).profile;
    expect(test.sampleOps.filter((op) => op.op === "I2C_WRITE")).toEqual([
      expect.objectContaining({ length: 28 }),
    ]);
    expect(parseI2cMessage("6B $value 00").tokens).toEqual(["0x6B", "$value", "0x00"]);
    expect(parseI2cMessage("00 ZZ AF").error).toBeTruthy();
  });
  it("assembles a long message with multiple variable bytes without exhausting temporary slots", () => {
    let draft = organizeDriverInterfaces(readDriver());
    draft = { ...draft, commands: [], flowInterfaces: [], variables: [], channels: [] };
    const one = addFlowInterface(draft, "sample_external");
    draft = one.draft;
    const two = addFlowInterface(draft, "encode");
    draft = two.draft;
    if (one.op.type !== "sample_external" || two.op.type !== "encode")
      throw new Error("interfaces");
    draft = {
      ...draft,
      flowInterfaces: draft.flowInterfaces!.map((op) =>
        op.id === two.op.id ? { ...two.op, widthBytes: 1 } : op,
      ),
    };
    const tokens = parseI2cMessage(oled).tokens.map((token, i) =>
      i === 0 || i === 18 ? `$${two.op.type === "encode" ? two.op.into : ""}` : token,
    );
    draft = addCommand(draft, {
      label: "OLED",
      steps: [{ id: "message", type: "i2c_write", bytes: tokens }],
    });
    const profile = compileRuntimeDriver(draft).profile;
    expect(profile.sampleOps.find((op) => op.op === "I2C_WRITE")).toMatchObject({
      length: 28,
    });
    expect(profile.sampleOps.length).toBeLessThanOrEqual(16);
  });
  it("moves existing interfaces out of action steps and preserves the executable sequence and persisted scope", () => {
    const original = readDriver(),
      grouped = organizeDriverInterfaces(original);
    expect(grouped.commands[0]?.steps.map((op) => op.type)).toEqual(["i2c_write_read"]);
    expect(grouped.flowInterfaces?.map((op) => op.type)).toEqual(["decode", "emit"]);
    expect(effectiveActionSteps(grouped, grouped.commands[0]!)).toEqual(
      original.commands[0]!.steps,
    );
    expect(
      parseDeviceRecipeDraft(serializeDeviceRecipeDraft(grouped))?.flowInterfaces,
    ).toEqual(grouped.flowInterfaces);
  });
  it("keeps byte and framing widths readable for long messages and exposes actual read responses", () => {
    const draft = createBlankDraft("i2c"),
      op = {
        id: "oled",
        type: "i2c_write" as const,
        bytes: parseI2cMessage(oled).tokens,
      };
    const model = buildProtocolTimingFromOps(draft, [op]);
    const scale = readableTimingScale(
      model.durationMs,
      model.phaseBands,
      model.stepSpans,
    );
    expect(scale.width).toBeGreaterThan(2000);
    model.phaseBands
      .filter((band) => /^0x/.test(band.label))
      .forEach((band) =>
        expect(scale.xAt(band.t1) - scale.xAt(band.t0)).toBeGreaterThanOrEqual(71.99),
      );
    const read = { id: "read", type: "i2c_read" as const, into: "raw", len: 2 };
    const label = readableI2cStep(draft, read, [0x68, 0x01]);
    expect(label).toContain("read · 2 byte");
    expect(label).toContain("0x68 0x01");
    expect(label).not.toMatch(/RESTART|STOP|START/);
    expect(readableI2cStep(draft, read, [null])).toContain("da provare");
  });
});

describe("driver installation lifecycle", () => {
  it("installs before deployment, retains live profiles and removes only previously owned versions", async () => {
    const events: string[] = [],
      remembered: unknown[] = [];
    let live = true;
    const profile = compileRuntimeDriver(readDriver()).profile;
    const cleanup = await installDriverProfiles(
      [profile],
      [{ profileId: "old.driver", version: 1 }],
      {
        install: async (item) => {
          events.push(`install:${item.profileId}`);
        },
        remove: async (id) => {
          events.push(`remove:${id}`);
          return !live;
        },
        remember: (entries) => remembered.push([...entries]),
      },
    );
    events.push("deploy");
    live = false;
    await cleanup();
    expect(events).toEqual([
      "remove:old.driver",
      `install:${profile.profileId}`,
      "deploy",
      "remove:old.driver",
    ]);
    expect(remembered.at(-1)).toEqual([{ profileId: profile.profileId, version: 1 }]);
  });
  it("does not proceed past a failed installation", async () => {
    const profile = compileRuntimeDriver(readDriver()).profile;
    await expect(
      installDriverProfiles([profile], [], {
        install: async () => {
          throw new Error("offline");
        },
        remove: async () => true,
        remember: () => undefined,
      }),
    ).rejects.toThrow("offline");
  });
});

describe("direct Flow input/output interfaces", () => {
  it("uses an input variable directly in a byte without an encoder", () => {
    const added = addFlowInterface(createBlankDraft("i2c"), "sample_external");
    if (added.op.type !== "sample_external") throw new Error("input");
    const draft = addCommand(added.draft, {
      label: "Write input",
      steps: [{ id: "write", type: "i2c_write", bytes: [`$${added.op.into}`] }],
    });
    const profile = compileRuntimeDriver(
      draft,
      new Map([[draft.commands[0]!.id, new Set([added.op.fromChannelId])]]),
    ).profile;
    expect(draft.flowInterfaces?.map((op) => op.type)).toEqual(["sample_external"]);
    expect(profile.sampleOps).toContainEqual(
      expect.objectContaining({ op: "LOAD_ARGUMENT", length: 1, required: true }),
    );
    expect(
      parseDeviceRecipeDraft(serializeDeviceRecipeDraft(draft))?.flowInterfaces?.[0],
    ).toMatchObject({ widthBytes: 1, byteOrder: "be" });
  });
  it("publishes an internal variable and supports internal HEX message variables", () => {
    const base = {
      ...createBlankDraft("i2c"),
      variables: [
        { name: "internal", valueType: "number" as const, defaultValue: "42" },
        { name: "message", valueType: "hex" as const, defaultValue: "00 AF" },
      ],
    };
    const added = addFlowInterface(base, "emit");
    expect(added.op).toMatchObject({ type: "emit", from: "internal" });
    const draft = addCommand(added.draft, {
      label: "Internal values",
      steps: [{ id: "write", type: "i2c_write", bytes: ["$message"] }],
    });
    const profile = compileRuntimeDriver(draft).profile;
    expect(profile.sampleOps).toContainEqual(
      expect.objectContaining({ op: "I2C_WRITE", length: 2 }),
    );
    expect(profile.sampleOps.some((op) => op.op === "EMIT_FIELD")).toBe(true);
  });
  it("exposes actions automatically without action options", () => {
    const draft = readDriver();
    const migrated = organizeDriverInterfaces({
      ...draft,
      commands: draft.commands.map((command) => ({
        ...command,
        exposeOnCanvas: false,
      })),
    });
    expect(migrated.commands.every((command) => command.exposeOnCanvas === true)).toBe(
      true,
    );
  });
});

describe("single sensor instances", () => {
  it("latches data without executing and uses a separate trigger instance with shared input memory", () => {
    let draft = addCommand(createBlankDraft("i2c", "OLED"), { label: "Scrivi" });
    const added = addFlowInterface(draft, "sample_external");
    draft = added.draft;
    const dataInput = added.op;
    if (dataInput.type !== "sample_external") throw new Error("input");
    const trigger = addFlowInterface(draft, "sample_external");
    draft = {
      ...trigger.draft,
      flowInterfaces: trigger.draft.flowInterfaces!.map((op) =>
        op.id === trigger.op.id ? { ...op, inputMode: "trigger" as const } : op,
      ),
      commands: draft.commands.map((command) => ({
        ...command,
        steps: [
          {
            id: "write",
            type: "i2c_write" as const,
            bytes: ["00", `$${dataInput.into}`],
          },
        ],
      })),
    };
    if (trigger.op.type !== "sample_external") throw new Error("trigger");
    const id = draft.commands[0]!.id;
    const fixture = deployment(draft, [
      {
        id: "data",
        source: "timer",
        target: id,
        sourceHandle: "0",
        targetHandle: dataInput.fromChannelId,
      },
      {
        id: "trigger",
        source: "timer",
        target: "trigger-instance",
        sourceHandle: "0",
        targetHandle: trigger.op.fromChannelId,
      },
    ]);
    const original = fixture.input.processingGraph.nodes.find(
      (node) => node.id === id,
    )!;
    if (original.data.kind !== "block") throw new Error("block");
    const dataNode = {
      ...original,
      data: {
        ...original.data,
        properties: {
          ...original.data.properties,
          [SENSOR_INSTANCE_PROP]: true,
          [SENSOR_INPUT_PROP]: dataInput.fromChannelId,
          [SENSOR_OUTPUT_PROP]: "",
        },
      },
    };
    const triggerNode = {
      ...dataNode,
      id: "trigger-instance",
      data: {
        ...dataNode.data,
        properties: {
          ...dataNode.data.properties,
          [SENSOR_INPUT_PROP]: trigger.op.fromChannelId,
        },
      },
    };
    const input = {
      ...fixture.input,
      processingGraph: {
        ...fixture.input.processingGraph,
        nodes: [
          ...fixture.input.processingGraph.nodes.filter((node) => node.id !== id),
          dataNode,
          triggerNode,
        ],
      },
    };
    const plan = prepareDriverDeployment(fixture.project, "core", input);
    const dataRule = plan.input.processingGraph.nodes.find(
      (node) => node.id === "0-parameter:data",
    )!;
    const triggerRule = plan.input.processingGraph.nodes.find(
      (node) => node.id === "1-execute:trigger",
    )!;
    expect(dataRule.data).toMatchObject({ kind: "rule", properties: { "8": 3n } });
    expect(triggerRule.data).toMatchObject({ kind: "rule", properties: { "8": 0n } });
    expect(plan.profiles[0]!.actions).toHaveLength(2);
    const args = plan.profiles[0]!.sampleOps.filter((op) => op.op === "LOAD_ARGUMENT");
    expect(args).toHaveLength(2);
    expect(args.every((op) => op.required && op.argumentId === 1)).toBe(true);
    expect(compileConfig(plan.input, plan.options).ok).toBe(true);
  });
  it("rejects wires to unselected sensor pins", () => {
    const draft = readDriver();
    const id = draft.commands[0]!.id;
    const fixture = deployment(draft, [
      { id: "bad", source: "timer", target: id, targetHandle: "execute" },
    ]);
    const input = {
      ...fixture.input,
      processingGraph: {
        ...fixture.input.processingGraph,
        nodes: fixture.input.processingGraph.nodes.map((node) =>
          node.id === id && node.data.kind === "block"
            ? {
                ...node,
                data: {
                  ...node.data,
                  properties: {
                    ...node.data.properties,
                    [SENSOR_INSTANCE_PROP]: true,
                    [SENSOR_INPUT_PROP]: "",
                    [SENSOR_OUTPUT_PROP]: "",
                  },
                },
              }
            : node,
        ),
      },
    };
    expect(() => prepareDriverDeployment(fixture.project, "core", input)).toThrow(
      "Ingresso",
    );
  });
});

describe("GPIO physical deployment", () => {
  it("routes DATA to the applied output channel and compiles real Flow rules", () => {
    const draft = createGpioDigitalDriver();
    const fixture = deployment(draft, [
      {
        id: "run-gpio",
        source: "activation",
        target: draft.commands[0]!.id,
        sourceHandle: "0",
        targetHandle: "execute",
      },
    ]);
    const physical = JSON.parse(
      fixture.project.authoringMetadata[PHYSICAL_META_KEY]!.comment!,
    );
    physical.drafts["core:physical"].modes = [0, 0, 2, 0];
    const project = {
      ...fixture.project,
      authoringMetadata: {
        ...fixture.project.authoringMetadata,
        [PHYSICAL_META_KEY]: { comment: JSON.stringify(physical) },
      },
    };
    const plan = prepareDriverDeployment(project, "core", fixture.input);
    expect(plan.profiles[0]!.initOps).toEqual([
      { op: "GPIO_SET", channel: 2, value: false },
    ]);
    expect(
      plan.profiles[0]!.sampleOps.some(
        (op) => op.op === "GPIO_SET_VALUE" && op.channel === 2,
      ),
    ).toBe(true);
    expect(compileConfig(plan.input, plan.options).ok).toBe(true);
    physical.drafts["core:physical"].modes = [2, 0, 2, 0];
    expect(() =>
      prepareDriverDeployment(
        {
          ...project,
          authoringMetadata: {
            ...project.authoringMetadata,
            [PHYSICAL_META_KEY]: { comment: JSON.stringify(physical) },
          },
        },
        "core",
        fixture.input,
      ),
    ).toThrow("assegna DATA");
  });

  it("schedules the relay itself so the square wave never opens a fake I2C clock", () => {
    const draft = catalogGpioRelayDriver();
    const fixture = deployment(draft);
    const physical = JSON.parse(
      fixture.project.authoringMetadata[PHYSICAL_META_KEY]!.comment!,
    );
    physical.drafts["core:physical"].modes = [2, 0, 0, 0];
    const modules = JSON.parse(
      fixture.project.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]!.comment!,
    );
    modules.byBinding.core[0].gpioAssignment = {
      boardKey: "core:physical",
      channel: 0,
    };
    const project = {
      ...fixture.project,
      authoringMetadata: {
        ...fixture.project.authoringMetadata,
        [PHYSICAL_META_KEY]: { comment: JSON.stringify(physical) },
        [BACKBONE_SENSOR_MODULES_META_KEY]: { comment: JSON.stringify(modules) },
      },
    };
    const relayId = draft.commands[0]!.id;
    const input = {
      ...fixture.input,
      processingGraph: {
        ...fixture.input.processingGraph,
        nodes: [
          {
            layer: "device-processing" as const,
            id: "sq",
            data: {
              kind: "block" as const,
              blockTypeId: "ab.square_wave",
              catalogEntryId: "appblocks.square_wave",
              properties: { periodMs: 400, dutyCycle: 25 },
            },
          },
          {
            layer: "device-processing" as const,
            id: relayId,
            data: {
              kind: "block" as const,
              blockTypeId: BACKBONE_SENSOR_BLOCK_TYPE_ID,
              properties: {
                [SENSOR_MODULE_ID_PROP]: "sensor",
                [SENSOR_ACTION_ID_PROP]: relayId,
                [SENSOR_INSTANCE_PROP]: true,
                [SENSOR_INPUT_PROP]: "comando",
              },
            },
          },
        ],
        edges: [
          {
            id: "sq-relay",
            source: "sq",
            target: relayId,
            sourceHandle: "0",
            targetHandle: "comando",
          },
        ],
      },
    };
    const plan = prepareDriverDeployment(project, "core", input);
    const square = plan.input.processingGraph.nodes.find((node) => node.id === "sq");
    expect(square?.data).toMatchObject({
      kind: "schedule",
      moduleNodeId: "driver:sensor",
      periodMs: 400,
      enabled: true,
    });
    expect(plan.profiles.some((profile) => profile.profileId === "flow.clock")).toBe(
      false,
    );
    expect(
      plan.input.physicalGraph.nodes.some((node) =>
        node.id.startsWith("driver-clock:"),
      ),
    ).toBe(false);
    expect(
      plan.input.processingGraph.nodes.some(
        (node) => node.data.kind === "rule" && node.data.ruleTypeId === "device-action",
      ),
    ).toBe(false);
    const relayProfile = plan.profiles.find(
      (profile) => profile.sampleOps.some(op => op.op === "GPIO_PULSE"),
    );
    expect(relayProfile?.sampleOps).toEqual(
      expect.arrayContaining([
        {
          op: "GPIO_PULSE",
          channel: 0,
          milliseconds: 100,
          activeHigh: true,
          restoreHigh: false,
        },
      ]),
    );
    expect(compileConfig(plan.input, plan.options).ok).toBe(true);
  });
});

describe("board STATUS LED deployment", () => {
  it("binds STATUS to the native LED backend without exposing a connector GPIO", () => {
    const fixture = deployment(readDriver());
    const input = {
      ...fixture.input,
      processingGraph: {
        ...fixture.input.processingGraph,
        nodes: [
          {
            layer: "device-processing" as const,
            id: "status",
            data: {
              kind: "block" as const,
              blockTypeId: "ab.led",
              properties: { statusLed: true, gpio: 11, threshold: 50, negated: true },
            },
          },
        ],
        edges: [],
      },
    };
    const plan = prepareDriverDeployment(fixture.project, "core", input);
    const ledResult = compileConfig(plan.input, plan.options);
    if (!ledResult.ok) throw new Error(JSON.stringify(ledResult.error));
    expect(ledResult.ok).toBe(true);
    expect(plan.input.processingGraph.nodes[0]?.data).toMatchObject({
      blockTypeId: "status_led",
      properties: { "1": 1n, "2": false },
    });
    expect(
      (plan.input.processingGraph.nodes[0]?.data as { properties: object }).properties,
    ).not.toHaveProperty("gpio");
  });
  it("does not remap an ordinary LED and rejects unsupported STATUS timing", () => {
    const fixture = deployment(readDriver());
    const input = {
      ...fixture.input,
      processingGraph: {
        ...fixture.input.processingGraph,
        nodes: [
          {
            layer: "device-processing" as const,
            id: "status",
            data: {
              kind: "block" as const,
              blockTypeId: "ab.led",
              properties: { statusLed: true, delayOnMs: 10 },
            },
          },
        ],
        edges: [],
      },
    };
    expect(() => prepareDriverDeployment(fixture.project, "core", input)).toThrow(
      "senza ritardi",
    );
    const ordinary = {
      ...input,
      processingGraph: {
        ...input.processingGraph,
        nodes: [
          {
            ...input.processingGraph.nodes[0]!,
            data: {
              ...input.processingGraph.nodes[0]!.data,
              properties: { statusLed: false },
            },
          },
        ],
      },
    };
    expect(
      prepareDriverDeployment(fixture.project, "core", ordinary).input.processingGraph
        .nodes[0]?.data,
    ).toMatchObject({ blockTypeId: "ab.led" });
  });
});

describe("sequence deployment", () => {
  function fixture() {
    const draft = catalogUln2003Driver();
    const original = deployment(draft);
    const physical = JSON.parse(
      original.project.authoringMetadata[PHYSICAL_META_KEY]!.comment!,
    );
    physical.drafts["core:physical"].modes = [2, 2, 2, 2];
    const modules = JSON.parse(
      original.project.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]!.comment!,
    );
    modules.byBinding.core[0].gpioAssignments = {
      boardKey: "core:physical",
      channels: { IN1: 0, IN2: 1, IN3: 2, IN4: 3 },
    };
    const project = {
      ...original.project,
      authoringMetadata: {
        ...original.project.authoringMetadata,
        [PHYSICAL_META_KEY]: { comment: JSON.stringify(physical) },
        [BACKBONE_SENSOR_MODULES_META_KEY]: { comment: JSON.stringify(modules) },
      },
    };
    const rows = [
      {
        id: "a",
        kind: "action",
        moduleId: "sensor",
        actionId: "uln-03-position",
        value: 90,
        waitForMotion: true,
      },
      { id: "w", kind: "wait", durationMs: 1000 },
      {
        id: "b",
        kind: "action",
        moduleId: "sensor",
        actionId: "uln-03-position",
        value: 0,
        waitForMotion: true,
      },
    ];
    const sequence = {
      layer: "device-processing" as const,
      id: "sequence-1",
      data: {
        kind: "block" as const,
        blockTypeId: SEQUENCE_TYPE,
        catalogEntryId: "appblocks.sequence",
        properties: { stepsJson: JSON.stringify(rows), autostart: true, repeat: true },
      },
    };
    const input = {
      ...original.input,
      processingGraph: {
        ...original.input.processingGraph,
        nodes: [sequence],
        edges: [],
      },
    };
    return { project, input, rows, sequence };
  }
  it("compiles actions without hidden canvas blocks, waits for completion and shares one driver", () => {
    const { project, input } = fixture();
    const plan = prepareDriverDeployment(project, "core", input);
    expect(plan.profiles).toHaveLength(1);
    expect(plan.profiles[0]!.actions).toHaveLength(1);
    expect(
      plan.profiles[0]!.sampleFields.some(
        (field) => field.fieldId === MOVEMENT_COMPLETED_FIELD,
      ),
    ).toBe(true);
    expect(plan.profiles[0]!.sampleOps.some((op) => op.op === "LOAD_ARGUMENT")).toBe(
      true,
    );
    const result = compileConfig(plan.input, plan.options);
    expect(
      result.ok,
      JSON.stringify(result, (_, v) => (typeof v === "bigint" ? String(v) : v)),
    ).toBe(true);
    if (!result.ok) return;
    const module = result.value.modules.find((module) => module.typeId === "sequence")!;
    const hex = String(module.properties[1]);
    expect(hex.slice(0, 2)).toBe("02");
    expect(hex.slice(8, 16)).toBe("5a000000");
    expect(module.properties[5]).toBe(true);
    expect(result.value.schedules.every((schedule) => schedule.periodMs === 20)).toBe(
      true,
    );
    expect(
      plan.input.processingGraph.nodes.some(
        (node) => node.id === sequenceActionNodeId("sensor", "uln-03-position"),
      ),
    ).toBe(false);
  });
  it("maps Avvia, Pausa and Stop to distinct native commands", () => {
    const { project, input } = fixture();
    const activation = {
      layer: "device-processing" as const,
      id: "boot",
      data: {
        kind: "event-source" as const,
        catalogEntryId: "appblocks.system",
        moduleNodeId: "",
      },
    };
    for (const [port, command] of [
      ["start", 1],
      ["pause", 2],
      ["stop", 3],
    ] as const) {
      const plan = prepareDriverDeployment(project, "core", {
        ...input,
        processingGraph: {
          ...input.processingGraph,
          nodes: [...input.processingGraph.nodes, activation],
          edges: [
            {
              id: "control",
              source: "boot",
              sourceHandle: "0",
              target: "sequence-1",
              targetHandle: port,
            },
          ],
        },
      });
      const rule = plan.input.processingGraph.nodes.find(
        (node) => node.data.kind === "rule",
      )!;
      expect(rule.data.kind === "rule" && rule.data.properties["4"]).toBe(
        BigInt(command),
      );
      expect(compileConfig(plan.input, plan.options).ok).toBe(true);
    }
  });
  it("routes the native motion completion event without confusing it with the command ACK", () => {
    const { project, input } = fixture();
    const motor = {
      layer: "device-processing" as const,
      id: "motor-card",
      data: {
        kind: "block" as const,
        blockTypeId: BACKBONE_SENSOR_BLOCK_TYPE_ID,
        properties: {
          [SENSOR_MODULE_ID_PROP]: "sensor",
          [SENSOR_ACTION_ID_PROP]: "uln-01-stop",
          [SENSOR_INSTANCE_PROP]: true,
          [SENSOR_INPUT_PROP]: "execute",
          sensorMotion: true,
        },
      },
    };
    const plan = prepareDriverDeployment(project, "core", {
      ...input,
      processingGraph: {
        ...input.processingGraph,
        nodes: [...input.processingGraph.nodes, motor],
        edges: [
          {
            id: "motion-done",
            source: "motor-card",
            sourceHandle: "movement-completed",
            target: "sequence-1",
            targetHandle: "start",
          },
        ],
      },
    });
    const rule = plan.input.processingGraph.nodes.find(
      (node) => node.data.kind === "rule",
    )!;
    expect(rule.data.kind === "rule" && rule.data.properties["5"]).toBe(
      BigInt(MOVEMENT_COMPLETED_FIELD),
    );
    expect(rule.data.kind === "rule" && rule.data.properties["2"]).toBeUndefined();
    expect(compileConfig(plan.input, plan.options).ok).toBe(true);
  });
  it("rejects invalid angles and stale module references before deployment", () => {
    const { project, input, rows, sequence } = fixture();
    const broken = (changes: Record<string, unknown>) => ({
      ...input,
      processingGraph: {
        ...input.processingGraph,
        nodes: [
          {
            ...sequence,
            data: {
              ...sequence.data,
              properties: {
                ...sequence.data.properties,
                stepsJson: JSON.stringify([{ ...rows[0], ...changes }]),
              },
            },
          },
        ],
      },
    });
    expect(() =>
      prepareDriverDeployment(project, "core", broken({ value: 361 })),
    ).toThrow("0 e 360");
    expect(() =>
      prepareDriverDeployment(project, "core", broken({ moduleId: "deleted" })),
    ).toThrow();
  });
});
