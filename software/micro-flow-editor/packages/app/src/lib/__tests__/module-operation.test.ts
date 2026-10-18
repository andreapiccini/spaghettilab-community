import { expect, it } from "vitest";
import { abortableModuleOperation } from "../module-operation.js";
it("cancels an operation even when the transport never settles", async () => {
  const controller = new AbortController();
  const result = abortableModuleOperation(
    new Promise<never>(() => {}),
    controller.signal,
  );
  controller.abort();
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
});
it("returns acknowledgment and preserves transport errors", async () => {
  const controller = new AbortController();
  await expect(
    abortableModuleOperation(Promise.resolve("ack"), controller.signal),
  ).resolves.toBe("ack");
  await expect(
    abortableModuleOperation(Promise.reject(new Error("USB")), controller.signal),
  ).rejects.toThrow("USB");
});

import { modulePinsAlreadyConfigured } from "../module-operation.js";
import { DEFAULT_PHYSICAL_SETTINGS } from "@spaghettilab/protocol-sdk";
it("skips a redundant pin write only when topology and PWM settings agree", () => {
  const actual = {
    version: 2 as const,
    mcu: "ESP32-S3" as const,
    antennas: 2,
    layout: 1,
    backendPortId: 0,
    capabilities: 0,
    modes: [12, 12, 12, 2],
    i2cSpeed: 0,
    source: 1,
    settings: DEFAULT_PHYSICAL_SETTINGS,
  };
  const planned = {
    name: "Module Function",
    modes: [12, 12, 12, 2],
    i2cSpeed: 0,
    settings: DEFAULT_PHYSICAL_SETTINGS,
  };
  expect(modulePinsAlreadyConfigured(actual, planned)).toBe(true);
  expect(modulePinsAlreadyConfigured({ ...actual, modes: [2, 2, 2, 2] }, planned)).toBe(
    false,
  );
  expect(
    modulePinsAlreadyConfigured(
      { ...actual, settings: { ...DEFAULT_PHYSICAL_SETTINGS, pwmInverted: true } },
      planned,
    ),
  ).toBe(false);
  expect(modulePinsAlreadyConfigured(undefined, planned)).toBe(false);
});
