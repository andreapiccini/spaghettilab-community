import { describe, expect, it } from "vitest";
import { parseRgbLedConfig, rgbLedVisualAt, serializeRgbLedActions } from "./rgb-led-model.js";

describe("rgb-led-model", () => {
  it("defaults to preset solid", () => {
    const cfg = parseRgbLedConfig({});
    expect(cfg.mode).toBe("preset");
    expect(cfg.preset).toBe("solid");
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
});
