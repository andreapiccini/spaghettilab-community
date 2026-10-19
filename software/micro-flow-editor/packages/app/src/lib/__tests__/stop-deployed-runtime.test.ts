import { describe, expect, it } from "vitest";
import { encodeConfigCbor } from "@spaghettilab/config-compiler";
import { DEFAULT_ENERGY, DISABLED_MQTT } from "../default-config-policy.js";
import {
  applyStoppedRuntime,
  oneShotRuntimeConfig,
  configHasContinuousSchedules,
  pauseContinuousRuntime,
  clearedRuntimeConfig,
  configBytesHaveLiveRuntime,
  configHasLiveRuntime,
} from "../stop-deployed-runtime.js";

const empty = {
  version: 4 as const,
  modules: [],
  schedules: [],
  rules: [],
  mqtt: DISABLED_MQTT,
  connectivity: 0,
  energy: DEFAULT_ENERGY,
  blocks: [],
  edges: [],
};

const live = {
  ...empty,
  modules: [
    {
      key: 1,
      portId: 0,
      typeId: "declarative-device",
      properties: {},
    },
  ],
  schedules: [{ sourceKey: 1, periodMs: 400, enabled: true }],
};

describe("stop-deployed-runtime", () => {
  it("detects a live schedule and clears it", () => {
    expect(configHasLiveRuntime(live)).toBe(true);
    expect(configHasLiveRuntime(empty)).toBe(false);
    const cleared = clearedRuntimeConfig(live);
    expect(cleared.modules).toEqual([]);
    expect(cleared.schedules).toEqual([]);
    expect(configBytesHaveLiveRuntime(encodeConfigCbor(live))).toBe(true);
    expect(configBytesHaveLiveRuntime(encodeConfigCbor(cleared))).toBe(false);
  });

  it("applies an empty runtime and returns the fresh config", async () => {
    let generation = 3;
    let bytes = encodeConfigCbor(live);
    const client = {
      getConfig: async () => ({
        generation,
        sha256: new Uint8Array(32),
        configBytes: bytes,
      }),
      applyConfig: async (request: { configBytes: Uint8Array }) => {
        bytes = request.configBytes;
        generation += 1;
      },
    };
    const result = await applyStoppedRuntime(client);
    expect(result.changed).toBe(true);
    expect(result.generation).toBe(4);
    expect(configBytesHaveLiveRuntime(result.config.configBytes)).toBe(false);
  });

  it("retries APPLY_CONFIG when the Core reports RESOURCE_EXHAUSTED", async () => {
    let generation = 2;
    let bytes = encodeConfigCbor(live);
    let applies = 0;
    const result = await applyStoppedRuntime({
      getConfig: async () => ({
        generation,
        sha256: new Uint8Array(32),
        configBytes: bytes,
      }),
      applyConfig: async (request: { configBytes: Uint8Array }) => {
        applies += 1;
        if (applies === 1) {
          throw { status: 8, message: "RESOURCE_EXHAUSTED" };
        }
        bytes = request.configBytes;
        generation += 1;
      },
    });
    expect(applies).toBe(2);
    expect(result.changed).toBe(true);
    expect(configBytesHaveLiveRuntime(result.config.configBytes)).toBe(false);
  });

  it("is a no-op when the Core is already empty", async () => {
    const bytes = encodeConfigCbor(empty);
    const result = await applyStoppedRuntime({
      getConfig: async () => ({
        generation: 1,
        sha256: new Uint8Array(32),
        configBytes: bytes,
      }),
      applyConfig: async () => {
        throw new Error("should not apply");
      },
    });
    expect(result.changed).toBe(false);
    expect(result.generation).toBe(1);
  });
});

it("Stop retains manual drivers and routes while disabling all repeating schedules", async () => {
  const paused = oneShotRuntimeConfig(live);
  expect(paused.modules).toEqual(live.modules);
  expect(paused.rules).toEqual(live.rules);
  expect(paused.schedules).toEqual([{ ...live.schedules[0], enabled: false }]);
  expect(live.schedules[0]!.enabled).toBe(true);
  let bytes = encodeConfigCbor(live);
  let generation = 7;
  const client = {
    getConfig: async () => ({
      generation,
      sha256: new Uint8Array(32),
      configBytes: bytes,
    }),
    applyConfig: async (request: { configBytes: Uint8Array }) => {
      bytes = request.configBytes;
      generation++;
    },
  };
  const result = await pauseContinuousRuntime(client);
  expect(result.generation).toBe(9);
  expect(result.configBytes).toEqual(encodeConfigCbor(paused));
});

it("keeps conversion-completion polling, but disables the clock that starts new reads", () => {
  const config = {
    ...live,
    modules: [
      { ...live.modules[0]!, properties: { "1": "flow.clock" } },
      { ...live.modules[0]!, key: 2, properties: { "1": "sensor.ds18b20" } },
    ],
    schedules: [...live.schedules, { sourceKey: 2, periodMs: 100, enabled: true }],
    rules: [{ key: 1, typeId: "device-action", properties: { "1": 1n, "3": 2n } }],
  };
  const paused = oneShotRuntimeConfig(config, ["sensor.ds18b20"]);
  expect(paused.schedules.map((item) => item.enabled)).toEqual([false, true]);
  expect(configHasContinuousSchedules(config)).toBe(true);
  expect(configHasContinuousSchedules(paused)).toBe(false);
});
