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
  ledBindingFromProperties,
  ledIntensityAt,
  ledLitAt,
  ledWantedOn,
  lineHighAtTick,
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
  toggleIds: ["t1"],
  startIds: [],
  actuators: [defaultLed()],
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
  });

  it("catalog declares ports for Schedule / Toggle / LED", () => {
    const scheduleEntry = findCatalogEntryById("native.schedule");
    const toggleEntry = findCatalogEntryById("appblocks.digital_out_toggle");
    const ledEntry = findCatalogEntryById("appblocks.led");
    expect(scheduleEntry?.outputs?.[0]?.types.some((t) => t.domain === "activation")).toBe(true);
    expect(toggleEntry?.outputs?.[0]?.types[0]).toMatchObject({ domain: "digital", role: "comando" });
    expect(ledEntry?.inputs?.[0]?.types.some((t) => t.role === "comando")).toBe(true);
    expect(ledEntry?.outputs).toEqual([]);
    expect(ledEntry?.fields?.some((f) => f.id === "threshold")).toBe(true);
    expect(ledEntry?.fields?.some((f) => f.id === "effect")).toBe(false);
  });
});
