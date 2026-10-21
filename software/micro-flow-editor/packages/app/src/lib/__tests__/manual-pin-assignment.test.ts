import { describe, expect, it } from "vitest";
import { assignManualPin } from "../manual-pin-assignment.js";
import { validatePhysicalModes } from "../backbone-physical.js";
describe("manual pin assignments", () => {
  it("completes I2C without removing its sibling", () => {
    expect(assignManualPin([4, 0, 0, 0], 1, 5)).toEqual([4, 5, 0, 0]);
  });
  it("keeps SPI siblings while editing and reports incomplete buses", () => {
    const result = assignManualPin([8, 9, 10, 11], 2, 0);
    expect(result).toEqual([8, 9, 0, 11]);
    expect(validatePhysicalModes(result, 0)).toBeTruthy();
  });
  it("rejects duplicate bus signals without changing the draft", () => {
    const modes = [6, 7, 0, 0];
    expect(() => assignManualPin(modes, 2, 6)).toThrow();
    expect(modes).toEqual([6, 7, 0, 0]);
  });
  it("allows repeated GPIO and PWM", () => {
    expect(assignManualPin([1, 12, 0, 0], 2, 12)).toEqual([1, 12, 12, 0]);
  });
  it("rejects invalid indices and modes", () => {
    for (const [index, mode] of [
      [-1, 1],
      [4, 1],
      [0, 255],
      [0, 18],
    ])
      expect(() => assignManualPin([0, 0, 0, 0], index, mode)).toThrow();
  });
});
