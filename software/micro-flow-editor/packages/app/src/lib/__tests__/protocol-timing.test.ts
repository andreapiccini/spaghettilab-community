import { describe, expect, it } from "vitest";
import { createI2cTemperatureExample } from "../device-recipe-draft.js";
import { buildProtocolTiming } from "../protocol-timing.js";

describe("protocol-timing", () => {
  it("expands I2C write_read+RESTART into datasheet cells aligned with timing", () => {
    const draft = createI2cTemperatureExample();
    const model = buildProtocolTiming(draft, "sample");
    const labels = model.cells.map((c) => c.label);
    expect(labels[0]).toBe("S");
    expect(labels).toContain("Sr");
    expect(labels.some((l) => l.endsWith("+W"))).toBe(true);
    expect(labels.some((l) => l.endsWith("+R"))).toBe(true);
    expect(labels).toContain("D0");
    expect(labels).toContain("D1");
    expect(labels.at(-1)).toBe("P");
    expect(model.lanes.map((l) => l.id)).toEqual(["scl", "sda"]);
    // every cell time range fits in duration
    for (const c of model.cells) {
      expect(c.t1).toBeGreaterThan(c.t0);
      expect(c.t1).toBeLessThanOrEqual(model.durationMs);
    }
    // phase bands share ids with non-ack cells
    expect(model.phaseBands.length).toBeGreaterThan(4);
    expect(model.phaseBands.every((b) => model.cells.some((c) => c.id === b.id))).toBe(true);
  });
});
