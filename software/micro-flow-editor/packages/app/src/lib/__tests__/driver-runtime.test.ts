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
