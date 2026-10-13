import { describe, expect, it } from "vitest";
import {
  decodeDs18b20TempC,
  formatOneWireRom,
  onewireCrc8,
  parseOneWireRom,
  validateOneWireRom,
} from "../onewire.js";
import { createDs18b20Example, draftToSensorRecipe, validateDraftForCreate } from "../device-recipe-draft.js";

describe("onewire", () => {
  it("validates ROM CRC (Dallas/Maxim)", () => {
    const rom = "28 FF 01 02 03 04 05 62";
    expect(validateOneWireRom(rom).ok).toBe(true);
    expect(validateOneWireRom("28 FF 01 02 03 04 05 00").ok).toBe(false);
    expect(parseOneWireRom(rom)).toHaveLength(8);
    expect(formatOneWireRom(parseOneWireRom(rom)!)).toBe(rom);
  });

  it("decodes DS18B20 temperature (0.0625 °C/LSB)", () => {
    // 0x0191 = 25.0625 °C
    expect(decodeDs18b20TempC(0x91, 0x01)).toBeCloseTo(25.0625, 4);
    expect(onewireCrc8([0x28, 0xff, 0x01, 0x02, 0x03, 0x04, 0x05])).toBe(0x62);
  });

  it("seeds DS18B20 draft with datasheet convert wait and maps to SensorRecipe w1", () => {
    const draft = createDs18b20Example();
    expect(draft.binding.bus).toBe("w1");
    expect(draft.phases.sample.some((op) => op.type === "w1_wait_convert" && op.timeoutMs === 750)).toBe(true);
    expect(draft.phases.sample.filter((op) => op.type === "w1_reset")).toHaveLength(2);
    expect(validateDraftForCreate(draft)).toHaveLength(0);
    const recipe = draftToSensorRecipe(draft);
    expect(recipe.bus).toBe("w1");
    expect(recipe.recipe.sample.some((s) => s.type === "w1_reset")).toBe(true);
    expect(recipe.recipe.sample.some((s) => s.type === "emit")).toBe(true);
    expect(recipe.unknown?.some((u) => /1-Wire/i.test(u))).toBe(true);
  });
});
