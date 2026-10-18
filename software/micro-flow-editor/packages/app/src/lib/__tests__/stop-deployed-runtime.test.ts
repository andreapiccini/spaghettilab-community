import { describe, expect, it } from "vitest";
import { encodeConfigCbor } from "@spaghettilab/config-compiler";
import { DEFAULT_ENERGY, DISABLED_MQTT } from "../default-config-policy.js";
import {
  applyStoppedRuntime,
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
