import { describe, expect, it } from "vitest";
import type { GraphState } from "@spaghettilab/domain";
import { findCatalogEntryById } from "@spaghettilab/processing-block-catalog";
import {
  activeActuatorsAt,
  activeTriggersAt,
  buildDryRunPreviewChannels,
  hysteresisTicksFromProperties,
  initialHighFromProperties,
  isDigitalOutToggle,
  isLedBlock,
  isRgbLedBlock,
  ledBindingFromProperties,
  ledIntensityAt,
  ledLitAt,
  ledWantedOn,
  lineHighAtElapsed,
  lineHighAtTick,
  rgbVisualsAt,
  waveformPlateaus,
  type DryRunPreviewChannel,
  type LedActuatorBinding,
} from "./dry-run-preview.js";

function graph(nodes: GraphState<"device-processing">["nodes"], edges: GraphState<"device-processing">["edges"]): GraphState<"device-processing"> {
  return { layer: "device-processing", nodes, edges };
}

const schedule = (id: string, periodMs: number, enabled = true) =>
  ({ layer: "device-processing" as const, id, data: { kind: "schedule" as const, moduleNodeId: "m", periodMs, enabled } });

const toggle = (id: string, properties: Record<string, unknown> = { line: "LED" }) =>
  ({
    layer: "device-processing" as const,
    id,
    data: { kind: "block" as const, blockTypeId: "ab.digital_out_toggle", catalogEntryId: "appblocks.digital_out_toggle", properties },
  });

const led = (id: string, properties: Record<string, unknown> = { color: "#F5C518" }) =>
  ({
    layer: "device-processing" as const,
    id,
    data: { kind: "block" as const, blockTypeId: "ab.led", catalogEntryId: "appblocks.led", properties },
  });

const rgbLed = (id: string, properties: Record<string, unknown> = { mode: "preset", preset: "solid", color: "#FF3366", intensity: 100 }) =>
  ({
    layer: "device-processing" as const,
    id,
    data: { kind: "block" as const, blockTypeId: "ab.rgb_led", catalogEntryId: "appblocks.rgb_led", properties },
  });

const defaultLed = (over: Partial<LedActuatorBinding> = {}): LedActuatorBinding => ({
  id: "led",
  threshold: 50,
  negated: false,
  delayOnMs: 0,
  delayOffMs: 0,
  softOnMs: 0,
  softOffMs: 0,
  ...over,
});

const baseChannel = (over: Partial<DryRunPreviewChannel> = {}): DryRunPreviewChannel => ({
  triggerId: "s1",
  periodMs: 1000,
  highTicks: 1,
  lowTicks: 1,
  initialHigh: true,
  toggleMode: "astable",
  pulseMs: 100,
  toggleIds: ["t1"],
  startIds: [],
  actuators: [defaultLed()],
  rgbActuators: [],
  ...over,
});

describe("buildDryRunPreviewChannels", () => {
  it("requires Schedule → Digital Out Toggle with default soglia LED", () => {
    const channels = buildDryRunPreviewChannels(
      graph(
        [schedule("s1", 800), toggle("t1"), led("led")],
        [
          { layer: "device-processing", id: "e1", source: "s1", target: "t1" },
          { layer: "device-processing", id: "e2", source: "t1", target: "led" },
        ],
      ),
    );
    expect(channels[0]).toMatchObject({
      triggerId: "s1",
      periodMs: 800,
      toggleIds: ["t1"],
      actuators: [defaultLed({ id: "led" })],
    });
  });

  it("reads soglia, negated, delays, and soft ramps", () => {
    const channels = buildDryRunPreviewChannels(
      graph(
        [
          schedule("s1", 100),
          toggle("t1"),
          led("led", {
            color: "#F5C518",
            threshold: 75n,
            negated: true,
            delayOnMs: 50n,
            delayOffMs: 80n,
            softOnMs: 200n,
            softOffMs: 300n,
          }),
        ],
        [
          { layer: "device-processing", id: "e1", source: "s1", target: "t1" },
          { layer: "device-processing", id: "e2", source: "t1", target: "led" },
        ],
      ),
    );
    expect(channels[0]?.actuators[0]).toMatchObject({
      threshold: 75,
      negated: true,
      delayOnMs: 50,
      delayOffMs: 80,
      softOnMs: 200,
      softOffMs: 300,
    });
  });

  it("walks Schedule → Start → Toggle → LED", () => {
    const start = {
      layer: "device-processing" as const,
      id: "start",
      data: {
        kind: "block" as const,
        blockTypeId: "ab.flow_start",
        catalogEntryId: "native.flow_start",
        properties: {},
      },
    };
    const channels = buildDryRunPreviewChannels(
      graph(
        [schedule("s1", 500), start, toggle("t1"), led("led")],
        [
          { layer: "device-processing", id: "e1", source: "s1", target: "start" },
          { layer: "device-processing", id: "e2", source: "start", target: "t1" },
          { layer: "device-processing", id: "e3", source: "t1", target: "led" },
        ],
      ),
    );
    expect(channels[0]).toMatchObject({
      toggleIds: ["t1"],
      startIds: ["start"],
      actuators: [defaultLed({ id: "led" })],
    });
  });

  it("previews Schedule → Toggle without an LED", () => {
    const channels = buildDryRunPreviewChannels(
      graph([schedule("s1", 500), toggle("t1")], [{ layer: "device-processing", id: "e1", source: "s1", target: "t1" }]),
    );
    expect(channels[0]).toMatchObject({ toggleIds: ["t1"], actuators: [] });
  });

  it("skips LED wired only to Schedule and disabled schedules", () => {
    expect(
      buildDryRunPreviewChannels(
        graph([schedule("s1", 500), led("led")], [{ layer: "device-processing", id: "e1", source: "s1", target: "led" }]),
      ),
    ).toEqual([]);
    expect(
      buildDryRunPreviewChannels(
        graph(
          [schedule("s1", 500, false), toggle("t1"), led("led")],
          [
            { layer: "device-processing", id: "e1", source: "s1", target: "t1" },
            { layer: "device-processing", id: "e2", source: "t1", target: "led" },
          ],
        ),
      ),
    ).toEqual([]);
  });
});

describe("LED soglia + soft start/stop", () => {
  it("ON when comando ≥ soglia; negated inverts", () => {
    expect(ledWantedOn(100, defaultLed())).toBe(true);
    expect(ledWantedOn(0, defaultLed())).toBe(false);
    expect(ledWantedOn(100, defaultLed({ negated: true }))).toBe(false);
    expect(ledWantedOn(0, defaultLed({ negated: true }))).toBe(true);
  });

  it("follow line with default soglia 50", () => {
    const ch = baseChannel();
    expect(ledIntensityAt(0, ch, defaultLed())).toBe(1);
    expect(ledIntensityAt(1000, ch, defaultLed())).toBe(0);
  });

  it("soft start ramps ON over softOnMs", () => {
    const ch = baseChannel({ actuators: [defaultLed({ softOnMs: 400 })] });
    const led = ch.actuators[0]!;
    expect(ledIntensityAt(0, ch, led)).toBeCloseTo(0, 2);
    expect(ledIntensityAt(200, ch, led)).toBeCloseTo(0.5, 1);
    expect(ledIntensityAt(400, ch, led)).toBeCloseTo(1, 2);
  });

  it("delayOnMs postpones soft start after segnale ON", () => {
    const ch = baseChannel({ actuators: [defaultLed({ delayOnMs: 200, softOnMs: 0 })] });
    const led = ch.actuators[0]!;
    expect(ledIntensityAt(0, ch, led)).toBe(0);
    expect(ledIntensityAt(199, ch, led)).toBe(0);
    expect(ledIntensityAt(200, ch, led)).toBe(1);
  });

  it("delayOffMs holds ON after segnale OFF before soft stop", () => {
    const ch = baseChannel({ actuators: [defaultLed({ delayOffMs: 200, softOffMs: 0 })] });
    const led = ch.actuators[0]!;
    expect(ledIntensityAt(0, ch, led)).toBe(1);
    expect(ledIntensityAt(1000, ch, led)).toBe(1);
    expect(ledIntensityAt(1199, ch, led)).toBe(1);
    expect(ledIntensityAt(1200, ch, led)).toBe(0);
  });

  it("soft stop decays OFF over softOffMs", () => {
    const ch = baseChannel({ actuators: [defaultLed({ softOffMs: 400 })] });
    const led = ch.actuators[0]!;
    expect(ledIntensityAt(0, ch, led)).toBe(1);
    expect(ledIntensityAt(1000, ch, led)).toBeCloseTo(1, 2);
    expect(ledIntensityAt(1200, ch, led)).toBeCloseTo(0.5, 1);
    expect(ledIntensityAt(1400, ch, led)).toBeCloseTo(0, 2);
  });

  it("ledBindingFromProperties clamps soglia 0–100", () => {
    expect(ledBindingFromProperties("x", { threshold: 150n }).threshold).toBe(100);
    expect(ledBindingFromProperties("x", { threshold: -5 }).threshold).toBe(0);
  });

  it("activeActuatorsAt includes toggles and lit LEDs", () => {
    const channels = [baseChannel()];
    expect([...activeActuatorsAt(0, channels)].sort()).toEqual(["led", "t1"]);
    expect([...activeActuatorsAt(1000, channels)]).toEqual([]);
    expect([...activeTriggersAt(0, channels)]).toEqual(["s1"]);
  });

  it("ledLitAt tracks intensity", () => {
    const ch = baseChannel();
    expect(ledLitAt(0, ch, defaultLed())).toBe(true);
    expect(ledLitAt(1000, ch, defaultLed())).toBe(false);
  });
});

describe("RGB LED dry-run", () => {
  it("builds Schedule → Toggle → RGB as line-driven", () => {
    const channels = buildDryRunPreviewChannels(
      graph(
        [schedule("s1", 500), toggle("t1"), rgbLed("rgb")],
        [
          { layer: "device-processing", id: "e1", source: "s1", target: "t1" },
          { layer: "device-processing", id: "e2", source: "t1", target: "rgb" },
        ],
      ),
    );
    expect(channels).toHaveLength(1);
    expect(channels[0]).toMatchObject({
      rgbDrive: "line",
      toggleIds: ["t1"],
      rgbActuators: [{ id: "rgb" }],
    });
  });

  it("builds Schedule → RGB without toggle as trigger-driven", () => {
    const channels = buildDryRunPreviewChannels(
      graph(
        [schedule("s1", 800), rgbLed("rgb", { mode: "preset", preset: "blink", speedMs: 200, color: "#00FF00", intensity: 100 })],
        [{ layer: "device-processing", id: "e1", source: "s1", target: "rgb" }],
      ),
    );
    expect(channels).toHaveLength(1);
    expect(channels[0]?.rgbDrive).toBe("trigger");
    expect(channels[0]?.toggleIds).toEqual([]);
    expect(channels[0]?.actuators).toEqual([]);
    // Default follow+rising: HIGH on even ticks — blink runs during first period.
    const visuals = rgbVisualsAt(0, channels);
    expect(visuals.get("rgb")?.intensity).toBeCloseTo(1, 2);
    expect(rgbVisualsAt(100, channels).get("rgb")?.intensity).toBe(0);
  });

  it("activeActuatorsAt includes lit RGB while line HIGH", () => {
    const ch = baseChannel({
      actuators: [],
      rgbActuators: [{ id: "rgb", properties: { mode: "preset", preset: "solid", color: "#FF0000", intensity: 100 } }],
      rgbDrive: "line",
    });
    expect(activeActuatorsAt(0, [ch]).has("rgb")).toBe(true);
    expect(activeActuatorsAt(1000, [ch]).has("rgb")).toBe(false);
  });

  it("follow falling lights RGB while line LOW", () => {
    const ch = baseChannel({
      actuators: [],
      rgbActuators: [
        {
          id: "rgb",
          properties: {
            mode: "preset",
            preset: "solid",
            color: "#FF0000",
            intensity: 100,
            triggerEdge: "falling",
            triggerAction: "follow",
          },
        },
      ],
      rgbDrive: "line",
    });
    expect(activeActuatorsAt(0, [ch]).has("rgb")).toBe(false);
    expect(activeActuatorsAt(1000, [ch]).has("rgb")).toBe(true);
  });

  it("start rising keeps RGB lit after falling edge", () => {
    const ch = baseChannel({
      actuators: [],
      rgbActuators: [
        {
          id: "rgb",
          properties: {
            mode: "preset",
            preset: "solid",
            color: "#FF0000",
            intensity: 100,
            triggerEdge: "rising",
            triggerAction: "start",
          },
        },
      ],
      rgbDrive: "line",
    });
    expect(rgbVisualsAt(0, [ch]).get("rgb")?.intensity).toBeCloseTo(1, 2);
    expect(rgbVisualsAt(1000, [ch]).get("rgb")?.intensity).toBeCloseTo(1, 2);
  });
});

describe("Digital Out Toggle modes", () => {
  it("reads pulse_high from the graph", () => {
    const channels = buildDryRunPreviewChannels(
      graph(
        [schedule("s1", 500), toggle("t1", { line: "LED", toggleMode: "pulse_high", pulseMs: 80n }), led("led")],
        [
          { layer: "device-processing", id: "e1", source: "s1", target: "t1" },
          { layer: "device-processing", id: "e2", source: "t1", target: "led" },
        ],
      ),
    );
    expect(channels[0]).toMatchObject({ toggleMode: "pulse_high", pulseMs: 80, periodMs: 500 });
  });

  it("pulse_high: HIGH only during the pulse, then LOW until next period", () => {
    const ch = baseChannel({
      toggleMode: "pulse_high",
      pulseMs: 100,
      periodMs: 1000,
      actuators: [],
    });
    expect(lineHighAtElapsed(0, ch)).toBe(true);
    expect(lineHighAtElapsed(50, ch)).toBe(true);
    expect(lineHighAtElapsed(100, ch)).toBe(false);
    expect(lineHighAtElapsed(500, ch)).toBe(false);
    expect(lineHighAtElapsed(1000, ch)).toBe(true);
  });

  it("pulse_low: LOW during the pulse, HIGH at rest", () => {
    const ch = baseChannel({
      toggleMode: "pulse_low",
      pulseMs: 100,
      periodMs: 1000,
      actuators: [],
    });
    expect(lineHighAtElapsed(0, ch)).toBe(false);
    expect(lineHighAtElapsed(50, ch)).toBe(false);
    expect(lineHighAtElapsed(100, ch)).toBe(true);
    expect(lineHighAtElapsed(800, ch)).toBe(true);
  });

  it("astable still toggles each tick", () => {
    const ch = baseChannel({ toggleMode: "astable", actuators: [] });
    expect(lineHighAtElapsed(0, ch)).toBe(true);
    expect(lineHighAtElapsed(1000, ch)).toBe(false);
    expect(lineHighAtElapsed(2000, ch)).toBe(true);
  });
});

describe("helpers", () => {
  it("hysteresis / initial / plateaus", () => {
    expect(hysteresisTicksFromProperties({ highToLow: 2n, lowToHigh: 5 })).toEqual({ highTicks: 2, lowTicks: 5 });
    expect(initialHighFromProperties({ initial: "low" })).toBe(false);
    expect(waveformPlateaus(3, 1, true)[0]).toEqual({ high: true, ticks: 3 });
    expect(lineHighAtTick(0, 1, 1, false)).toBe(false);
  });

  it("classifiers", () => {
    expect(isDigitalOutToggle(toggle("t").data)).toBe(true);
    expect(isLedBlock(led("l").data)).toBe(true);
    expect(isRgbLedBlock(rgbLed("r").data)).toBe(true);
  });

  it("catalog declares ports for Schedule / Toggle / LED / RGB LED", () => {
    const scheduleEntry = findCatalogEntryById("native.schedule");
    const toggleEntry = findCatalogEntryById("appblocks.digital_out_toggle");
    const ledEntry = findCatalogEntryById("appblocks.led");
    const rgbEntry = findCatalogEntryById("appblocks.rgb_led");
    expect(scheduleEntry?.outputs?.[0]?.types.some((t) => t.domain === "activation")).toBe(true);
    expect(toggleEntry?.outputs?.[0]?.types[0]).toMatchObject({ domain: "digital", role: "comando" });
    expect(ledEntry?.inputs?.[0]?.types.some((t) => t.role === "comando")).toBe(true);
    expect(ledEntry?.outputs).toEqual([]);
    expect(ledEntry?.fields?.some((f) => f.id === "threshold")).toBe(true);
    expect(ledEntry?.fields?.some((f) => f.id === "effect")).toBe(false);
    expect(rgbEntry?.inputs?.[0]?.types.some((t) => t.role === "trigger")).toBe(true);
    expect(rgbEntry?.fields?.some((f) => f.id === "mode")).toBe(true);
    expect(rgbEntry?.family).toBe("bay");
  });
});

describe("IF / relay / temperature dry-run", () => {
  const iff = (id: string, properties: Record<string, unknown>) =>
    ({
      layer: "device-processing" as const,
      id,
      data: { kind: "block" as const, blockTypeId: "ab.compare_if", catalogEntryId: "appblocks.compare_if", properties },
    });
  const temp = (id: string, testC: number) =>
    ({
      layer: "device-processing" as const,
      id,
      data: { kind: "block" as const, blockTypeId: "ab.temperature_sensor", catalogEntryId: "appblocks.temperature_sensor", properties: { testC } },
    });
  const relay = (id: string, closeWhen = "high") =>
    ({
      layer: "device-processing" as const,
      id,
      data: { kind: "block" as const, blockTypeId: "ab.relay", catalogEntryId: "appblocks.relay", properties: { closeWhen } },
    });

  it("drives LED from IF when Toggle equals HIGH then HIGH", () => {
    const channels = buildDryRunPreviewChannels(
      graph(
        [
          schedule("s1", 1000),
          toggle("t1", { initial: "high", highToLow: 1, lowToHigh: 1 }),
          iff("if1", { compare: "eq", compareLevel: "high", thenOutput: "high" }),
          led("led1"),
        ],
        [
          { layer: "device-processing", id: "e1", source: "s1", target: "t1" },
          { layer: "device-processing", id: "e2", source: "t1", target: "if1" },
          { layer: "device-processing", id: "e3", source: "if1", target: "led1" },
        ],
      ),
    );
    expect(channels[0]?.ifIds).toContain("if1");
    expect(activeActuatorsAt(0, channels).has("led1")).toBe(true);
    expect(activeActuatorsAt(1000, channels).has("led1")).toBe(false);
  });

  it("inverts LED when IF is not-equal HIGH then HIGH", () => {
    const channels = buildDryRunPreviewChannels(
      graph(
        [
          schedule("s1", 1000),
          toggle("t1", { initial: "high", highToLow: 1, lowToHigh: 1 }),
          iff("if1", { compare: "neq", compareLevel: "high", thenOutput: "high" }),
          led("led1"),
        ],
        [
          { layer: "device-processing", id: "e1", source: "s1", target: "t1" },
          { layer: "device-processing", id: "e2", source: "t1", target: "if1" },
          { layer: "device-processing", id: "e3", source: "if1", target: "led1" },
        ],
      ),
    );
    expect(activeActuatorsAt(0, channels).has("led1")).toBe(false);
    expect(activeActuatorsAt(1000, channels).has("led1")).toBe(true);
  });

  it("uses the configured else output when the IF condition is false", () => {
    const channels = buildDryRunPreviewChannels(
      graph(
        [
          schedule("s1", 1000),
          toggle("t1", { initial: "high", highToLow: 1, lowToHigh: 1 }),
          iff("if1", { compare: "eq", compareLevel: "high", thenOutput: "high", elseOutput: "high" }),
          led("led1"),
        ],
        [
          { layer: "device-processing", id: "e1", source: "s1", target: "t1" },
          { layer: "device-processing", id: "e2", source: "t1", target: "if1" },
          { layer: "device-processing", id: "e3", source: "if1", target: "led1" },
        ],
      ),
    );
    expect(activeActuatorsAt(0, channels).has("led1")).toBe(true);
    expect(activeActuatorsAt(1000, channels).has("led1")).toBe(true);
  });

  it("closes the relay when IF temperature is greater than the threshold", () => {
    const channels = buildDryRunPreviewChannels(
      graph(
        [
          temp("temp1", 30),
          iff("if1", { compare: "gt", compareTempC: 25, thenOutput: "high" }),
          relay("relay1", "high"),
        ],
        [
          { layer: "device-processing", id: "e1", source: "temp1", target: "if1" },
          { layer: "device-processing", id: "e2", source: "if1", target: "relay1" },
        ],
      ),
    );
    expect(channels.some((channel) => channel.tempIds?.includes("temp1"))).toBe(true);
    expect(activeActuatorsAt(0, channels).has("relay1")).toBe(true);
    expect(activeActuatorsAt(0, channels).has("if1")).toBe(true);
  });

  it("keeps LED on the temperature IF, not the Toggle clock, when Toggle is disconnected", () => {
    const channels = buildDryRunPreviewChannels(
      graph(
        [
          schedule("s1", 1000),
          toggle("t1", { initial: "high", highToLow: 1, lowToHigh: 1 }),
          temp("temp1", 30),
          iff("if1", { compare: "gt", compareTempC: 25, thenOutput: "high" }),
          led("led1"),
        ],
        [
          { layer: "device-processing", id: "e1", source: "s1", target: "t1" },
          { layer: "device-processing", id: "e2", source: "temp1", target: "if1" },
          { layer: "device-processing", id: "e3", source: "if1", target: "led1" },
        ],
      ),
    );
    expect(activeActuatorsAt(0, channels).has("led1")).toBe(true);
    expect(activeActuatorsAt(1000, channels).has("led1")).toBe(true);
    const ledDrive = channels.flatMap((channel) => channel.actuators).find((actuator) => actuator.id === "led1")?.drive;
    expect(ledDrive).toMatchObject({ kind: "if", source: { kind: "temperature", testC: 30 } });
  });

  it("keeps LED on the temperature IF even if the seed Toggle→LED wire is still present", () => {
    const channels = buildDryRunPreviewChannels(
      graph(
        [
          schedule("s1", 1000),
          toggle("t1", { initial: "high", highToLow: 1, lowToHigh: 1 }),
          temp("temp1", 30),
          iff("if1", { compare: "gt", compareTempC: 25, thenOutput: "high" }),
          led("led1"),
        ],
        [
          { layer: "device-processing", id: "e1", source: "s1", target: "t1" },
          { layer: "device-processing", id: "e2", source: "t1", target: "led1" },
          { layer: "device-processing", id: "e3", source: "temp1", target: "if1" },
          { layer: "device-processing", id: "e4", source: "if1", target: "led1" },
        ],
      ),
    );
    expect(activeActuatorsAt(0, channels).has("led1")).toBe(true);
    expect(activeActuatorsAt(1000, channels).has("led1")).toBe(true);
    const ledDrive = channels.flatMap((channel) => channel.actuators).find((actuator) => actuator.id === "led1")?.drive;
    expect(ledDrive).toMatchObject({ kind: "if", source: { kind: "temperature", testC: 30 } });
  });

  it("does not drive the LED when IF input type does not match the wired source", () => {
    const channels = buildDryRunPreviewChannels(
      graph(
        [
          schedule("s1", 1000),
          toggle("t1", { initial: "high", highToLow: 1, lowToHigh: 1 }),
          temp("temp1", 30),
          iff("if1", { compare: "gt", compareTempC: 25, thenOutput: "high", inputType: "digital" }),
          led("led1"),
        ],
        [
          { layer: "device-processing", id: "e1", source: "s1", target: "t1" },
          { layer: "device-processing", id: "e2", source: "temp1", target: "if1" },
          { layer: "device-processing", id: "e3", source: "if1", target: "led1" },
        ],
      ),
    );
    const ledDrive = channels.flatMap((channel) => channel.actuators).find((actuator) => actuator.id === "led1")?.drive;
    expect(ledDrive).toMatchObject({ kind: "if", source: { kind: "none" } });
    expect(activeActuatorsAt(0, channels).has("led1")).toBe(false);
  });

  it("does not drive the LED when IF output type is boolean", () => {
    const channels = buildDryRunPreviewChannels(
      graph(
        [
          temp("temp1", 30),
          iff("if1", { compare: "gt", compareTempC: 25, thenOutput: "high", outputType: "boolean" }),
          led("led1"),
        ],
        [
          { layer: "device-processing", id: "e1", source: "temp1", target: "if1" },
          { layer: "device-processing", id: "e2", source: "if1", target: "led1" },
        ],
      ),
    );
    expect(channels.flatMap((channel) => channel.actuators).some((actuator) => actuator.id === "led1")).toBe(false);
    expect(activeActuatorsAt(0, channels).has("led1")).toBe(false);
  });
});