import type { SpaghettiClient } from "@spaghettilab/protocol-sdk";
import { buildRecipeTestConfigBytes } from "../recipe-to-test-profile.js";
import { describe, expect, it, vi } from "vitest";
import { createI2cGenericExample } from "../device-recipe-draft.js";
import {
  buildRecipeTestPlan,
  modesForRecipeTestI2c,
  runRecipeHardwareTest,
} from "../recipe-hardware-test.js";

const labels = { init: "Init", task: "Azione", action: "Azione" };

describe("modesForRecipeTestI2c", () => {
  it("keeps preferred SDA/SCL placement", () => {
    expect(modesForRecipeTestI2c([0, 0, 0, 0], [0, 4, 5, 0])).toEqual([0, 4, 5, 0]);
  });

  it("adds I²C on the first free pins when live map has none", () => {
    expect(modesForRecipeTestI2c([2, 0, 0, 0])).toEqual([2, 4, 5, 0]);
  });

  it("strips ADC/W1 bases that APPLY_PHYSICAL cannot encode", () => {
    expect(modesForRecipeTestI2c(undefined, [4, 5, 13, 14])).toEqual([4, 5, 0, 0]);
  });

  it("falls back to Pin2=SDA Pin3=SCL", () => {
    expect(modesForRecipeTestI2c([1, 2, 3, 12])).toEqual([4, 5, 0, 0]);
  });
});

describe("buildRecipeTestPlan", () => {
  it("tests initialization alone without running an action", () => {
    const base = createI2cGenericExample();
    const draft = { ...base, phases: { ...base.phases, init: [{ id: "init-only", type: "wait" as const, ms: 10 }] } };
    const plan = buildRecipeTestPlan(draft, { target: { kind: "init" }, runInitFirst: false }, labels);
    expect(plan.steps.map(s => s.op.id)).toEqual(["init-only"]);
    expect(plan.steps.every(s => s.phase === "init")).toBe(true);
  });
  it("runs the selected Action alone without Init", () => {
    const draft = createI2cGenericExample();
    const plan = buildRecipeTestPlan(
      draft,
      {
        target: { kind: "action", commandId: draft.commands[0]!.id },
        runInitFirst: false,
      },
      labels,
    );
    expect(plan.steps.every((s) => s.phase === "command_named")).toBe(true);
    expect(plan.steps.length).toBe(draft.commands[0]!.steps.length);
  });

  it("prepends Init when requested", () => {
    const draft = createI2cGenericExample();
    const withInit = {
      ...draft,
      phases: {
        ...draft.phases,
        init: [{ id: "init-wait", type: "wait" as const, ms: 10 }],
      },
    };
    const plan = buildRecipeTestPlan(
      withInit,
      {
        target: { kind: "action", commandId: draft.commands[0]!.id },
        runInitFirst: true,
      },
      labels,
    );
    expect(plan.steps[0]?.phase).toBe("init");
    expect(plan.steps.some((s) => s.phase === "command_named")).toBe(true);
  });

  it("legacy task target maps to first named action", () => {
    const draft = createI2cGenericExample();
    const plan = buildRecipeTestPlan(
      draft,
      { target: { kind: "task" }, runInitFirst: false },
      labels,
    );
    expect(plan.steps.every((s) => s.phase === "command_named")).toBe(true);
    expect(plan.steps.length).toBe(draft.commands[0]!.steps.length);
  });
});

describe("hardware test restore interval", () => {
  it("does not report a successful test as BUSY when restoring its config", async () => {
    vi.useFakeTimers();
    try {
      const parked = buildRecipeTestConfigBytes({
        profileId: "parked",
        profileVersion: 1,
      })!;
      let configBytes = parked;
      let generation = 1;
      let installed: { profileId: string; version: number } | undefined;
      let lastWrite: number | undefined;
      const writes: number[] = [];
      const client = {
        getConfig: async () => ({
          generation,
          configBytes,
          sha256: new Uint8Array(32),
        }),
        getFullDeviceProfileList: async () => (installed ? [installed] : []),
        validateConfig: async () => ({ valid: true }),
        getStatus: async () => ({
          chainPeers: [
            {
              local: true,
              nodeId: 0,
              physical: new Uint8Array([1, 1, 2, 1, 0, 1, 0, 4, 5, 0, 0, 0, 1]),
            },
          ],
        }),
        applyConfig: async (request: { configBytes: Uint8Array }) => {
          const now = Date.now();
          if (lastWrite !== undefined && now - lastWrite < 1000)
            throw new Error("BUSY");
          lastWrite = now;
          writes.push(now);
          configBytes = request.configBytes;
          generation += 1;
          return { changed: true, generation, sha256: new Uint8Array(32), rxReads: [new Uint8Array([0x68, 0x00])] };
        },
      } as unknown as SpaghettiClient;
      const resultPromise = runRecipeHardwareTest({
        client,
        draft: createI2cGenericExample(),
        selection: { target: { kind: "action" }, runInitFirst: false },
        labels,
        sampleWaitMs: 0,
        installProfile: async (profile) => {
          installed = profile;
          return { ok: true };
        },
      });
      await vi.runAllTimersAsync();
      const result = await resultPromise;
      expect(result.ok).toBe(true);
      expect(result.restored).toBe(true);
      expect(Object.values(result.capture.rxByOpId)).toContainEqual([0x68, 0x00]);
      expect(writes).toHaveLength(2);
      expect(writes[1]! - writes[0]!).toBeGreaterThanOrEqual(1000);
      expect(configBytes).toEqual(parked);
    } finally {
      vi.useRealTimers();
    }
  });
});

it("does not overlap temporary configs when two canvas actions are tested", async () => {
  const parked = buildRecipeTestConfigBytes({ profileId: "parked", profileVersion: 1 })!;
  let release!: () => void;
  const client = { getConfig: () => new Promise(resolve => { release = () => resolve({ generation: 1, configBytes: parked, sha256: new Uint8Array(32) }); }) } as unknown as SpaghettiClient;
  const input = { client, draft: createI2cGenericExample(), selection: { target: { kind: "action" as const }, runInitFirst: false }, labels, installProfile: async () => ({ ok: false, error: "test-only stop before mutation" }) };
  const first = runRecipeHardwareTest(input);
  const overlapping = await runRecipeHardwareTest(input);
  expect(overlapping.ok).toBe(false);
  expect(overlapping.note).toContain("già in corso");
  release();
  expect((await first).kind).toBe("profile_failed");
  const next = runRecipeHardwareTest(input);
  release();
  expect((await next).kind).toBe("profile_failed");
});
