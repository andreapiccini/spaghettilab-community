import { describe, expect, it } from "vitest";
import {
  parseRgbLedConfig,
  rgbLedPlaybackAt,
  rgbLedVisualAt,
  serializeRgbLedActions,
  type RgbLineSignal,
} from "./rgb-led-model.js";

function signal(over: Partial<RgbLineSignal> = {}): RgbLineSignal {
  return {
    lineHigh: true,
    msSinceRising: 0,
    msSinceFalling: Number.POSITIVE_INFINITY,
    highPhaseMs: 0,
    lowPhaseMs: 0,
    ...over,
  };
}

describe("rgb-led-model", () => {
  it("defaults to preset solid with rising / follow", () => {
    const cfg = parseRgbLedConfig({});
    expect(cfg.mode).toBe("preset");
    expect(cfg.preset).toBe("solid");
    expect(cfg.triggerEdge).toBe("rising");
    expect(cfg.triggerAction).toBe("follow");
    expect(cfg.ledCount).toBe(1);
  });

  it("blinks on/off with speed", () => {
    const cfg = parseRgbLedConfig({ preset: "blink", speedMs: 200, intensity: 100, color: "#FF0000" });
    expect(rgbLedVisualAt(0, cfg, true).intensity).toBeCloseTo(1, 2);
    expect(rgbLedVisualAt(100, cfg, true).intensity).toBe(0);
    expect(rgbLedVisualAt(50, cfg, false).intensity).toBe(0);
  });

  it("cycles hue for color_cycle", () => {
    const cfg = parseRgbLedConfig({ preset: "color_cycle", speedMs: 1000, intensity: 80 });
    const a = rgbLedVisualAt(0, cfg, true);
    const b = rgbLedVisualAt(500, cfg, true);
    expect(a.color).not.toBe(b.color);
    expect(a.intensity).toBeCloseTo(0.8, 2);
  });

  it("plays custom sequence steps", () => {
    const json = serializeRgbLedActions([
      { kind: "solid", color: "#FF0000", intensity: 100, durationMs: 100 },
      { kind: "wait", durationMs: 100 },
      { kind: "solid", color: "#0000FF", intensity: 50, durationMs: 100 },
    ]);
    const cfg = parseRgbLedConfig({ mode: "sequence", sequenceJson: json, loop: true });
    expect(rgbLedVisualAt(50, cfg, true).color).toBe("#FF0000");
    expect(rgbLedVisualAt(150, cfg, true).intensity).toBe(0);
    expect(rgbLedVisualAt(250, cfg, true).color).toBe("#0000FF");
    expect(rgbLedVisualAt(250, cfg, true).intensity).toBeCloseTo(0.5, 2);
  });

  it("follow + rising: on while HIGH, off while LOW", () => {
    const cfg = parseRgbLedConfig({
      preset: "solid",
      color: "#FF0000",
      intensity: 100,
      triggerEdge: "rising",
      triggerAction: "follow",
    });
    expect(rgbLedPlaybackAt(signal({ lineHigh: true, highPhaseMs: 50 }), cfg).intensity).toBeCloseTo(1, 2);
    expect(rgbLedPlaybackAt(signal({ lineHigh: false, highPhaseMs: 0, lowPhaseMs: 50 }), cfg).intensity).toBe(0);
  });

  it("follow + falling: on while LOW, off while HIGH", () => {
    const cfg = parseRgbLedConfig({
      preset: "solid",
      color: "#FF0000",
      intensity: 100,
      triggerEdge: "falling",
      triggerAction: "follow",
    });
    expect(rgbLedPlaybackAt(signal({ lineHigh: false, lowPhaseMs: 40, msSinceFalling: 40 }), cfg).intensity).toBeCloseTo(1, 2);
    expect(rgbLedPlaybackAt(signal({ lineHigh: true, highPhaseMs: 40, msSinceRising: 40 }), cfg).intensity).toBe(0);
  });

  it("start + rising: keeps playing after line goes LOW", () => {
    const cfg = parseRgbLedConfig({
      preset: "solid",
      color: "#00FF00",
      intensity: 100,
      triggerEdge: "rising",
      triggerAction: "start",
    });
    const afterFall = signal({
      lineHigh: false,
      msSinceRising: 500,
      msSinceFalling: 100,
      highPhaseMs: 0,
      lowPhaseMs: 100,
    });
    expect(rgbLedPlaybackAt(afterFall, cfg).intensity).toBeCloseTo(1, 2);
  });

  it("start + falling: starts on falling and ignores rising", () => {
    const cfg = parseRgbLedConfig({
      preset: "solid",
      color: "#0000FF",
      intensity: 80,
      triggerEdge: "falling",
      triggerAction: "start",
    });
    const afterRise = signal({
      lineHigh: true,
      msSinceFalling: 300,
      msSinceRising: 50,
      highPhaseMs: 50,
      lowPhaseMs: 0,
    });
    expect(rgbLedPlaybackAt(afterRise, cfg).intensity).toBeCloseTo(0.8, 2);
  });

  it("color_cycle advances hue with elapsed while driven", () => {
    const cfg = parseRgbLedConfig({ preset: "color_cycle", speedMs: 1000, intensity: 100 });
    const high = signal({ lineHigh: true, highPhaseMs: 0, msSinceRising: 0 });
    const a = rgbLedPlaybackAt(high, cfg, 0);
    const b = rgbLedPlaybackAt(high, cfg, 500);
    expect(a.color).not.toBe(b.color);
    expect(a.intensity).toBeCloseTo(1, 2);
  });
});
