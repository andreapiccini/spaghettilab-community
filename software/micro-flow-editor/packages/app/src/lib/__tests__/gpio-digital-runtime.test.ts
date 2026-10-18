import { recipePlanToTestProfile } from "../recipe-to-test-profile.js";
import { buildRecipeBusCapture } from "../recipe-bus-capture.js";
import { evaluateRecipeReadResults } from "../recipe-read-results.js";
import { describe, it, expect } from "vitest";
import { createGpioDigitalDriver } from "../gpio-driver-presets.js";
import { compileRuntimeDriver } from "../driver-runtime-profile.js";
import {
  effectiveActionSteps,
  renameRecipeVariable,
  validateDraftForCreate,
} from "../device-recipe-draft.js";

describe("digital GPIO driver", () => {
  it("provides HIGH/LOW, startup, follow and actual readback through Flow interfaces", () => {
    const draft = createGpioDigitalDriver();
    expect(validateDraftForCreate(draft)).toEqual([]);
    expect(draft.commands.map((c) => c.name)).toEqual([
      "high",
      "low",
      "follow",
      "read",
    ]);
    const compiled = compileRuntimeDriver(draft, new Map(), new Map([["DATA", 2]]));
    expect(compiled.profile.initOps).toEqual([
      { op: "GPIO_SET", value: false, channel: 2 },
    ]);
    expect(
      compiled.profile.sampleOps.some(
        (op) => op.op === "GPIO_SET_VALUE" && op.channel === 2,
      ),
    ).toBe(true);
    expect(
      compiled.profile.sampleOps.filter((op) => op.op === "GPIO_GET"),
    ).toHaveLength(4);
    expect(
      compiled.profile.sampleOps.filter((op) => op.op === "EMIT_FIELD"),
    ).toHaveLength(4);
    expect(
      effectiveActionSteps(draft, draft.commands[2]!).map((op) => op.type),
    ).toEqual(["sample_external", "gpio_write", "gpio_read", "emit"]);
  });
  it("keeps variable identity and every GPIO reference when renamed", () => {
    const draft = createGpioDigitalDriver();
    const renamed = renameRecipeVariable(draft, draft.variables[0]!.id, "statoPin");
    expect(renamed.variables[0]!.id).toBe(draft.variables[0]!.id);
    const step = renamed.commands[2]!.steps[0]!;
    expect(step.type === "gpio_write" && step.value).toEqual({
      kind: "variable",
      name: "statoPin",
    });
    expect(() => compileRuntimeDriver(renamed)).not.toThrow();
  });
  it("reads an input without output writes or startup writes", () => {
    const compiled = compileRuntimeDriver(createGpioDigitalDriver("Ingresso", "in"));
    expect(compiled.profile.initOps).toEqual([]);
    expect(compiled.profile.sampleOps.map((op) => op.op)).toEqual([
      "GPIO_GET",
      "EMIT_FIELD",
      "EMIT_RECORD",
    ]);
  });
  it("rejects writing an input instead of changing its direction", () => {
    const draft = createGpioDigitalDriver();
    expect(() =>
      compileRuntimeDriver({
        ...draft,
        binding: {
          ...draft.binding,
          gpioSignals: draft.binding.gpioSignals.map((signal) => ({
            ...signal,
            direction: "in",
            signalType: "digital_input",
          })),
        },
      }),
    ).toThrow("è un ingresso");
  });
});

describe("GPIO test capture", () => {
  it("uses the assigned pin, keeps variable writes, and shows only measured states", () => {
    const draft = createGpioDigitalDriver();
    const ops = effectiveActionSteps(draft, draft.commands[2]!);
    const { profile, skipped } = recipePlanToTestProfile(
      draft,
      ops,
      [],
      new Map([["DATA", 3]]),
    );
    expect(skipped).toEqual([]);
    expect(
      profile.initOps.some((op) => op.op === "GPIO_SET_VALUE" && op.channel === 3),
    ).toBe(true);
    const read = ops.find((op) => op.type === "gpio_read")!;
    expect(evaluateRecipeReadResults(draft, ops, {})[0]!.value).toBeNull();
    const capture = buildRecipeBusCapture(ops, { [read.id]: [1] });
    expect(evaluateRecipeReadResults(draft, ops, capture.rxByOpId)[0]!.value).toBe(1);
  });
});

it("does not truncate numeric variables before the firmware validates a digital write", () => {
  const draft = createGpioDigitalDriver();
  const next = {
    ...draft,
    flowInterfaces: [],
    variables: draft.variables.map((variable) => ({
      ...variable,
      valueType: "number" as const,
      defaultValue: "256",
    })),
    commands: [draft.commands[2]!],
  };
  const profile = compileRuntimeDriver(next).profile;
  expect(profile.sampleOps).toContainEqual({
    op: "LOAD_CONST",
    dst: 0,
    length: 8,
    low: 256,
    high: 0,
  });
});
