import { describe, expect, it } from "vitest";
import {
  applyMapRange,
  createAnalogLevelExample,
  createGpioDigitalExample,
  createGraphicDisplayExample,
  createI2cTemperatureExample,
  createSpiPressureExample,
  draftToSensorRecipe,
  hasValidAnalogAcquisition,
  insertOp,
  isAnalogCalibrationComplete,
  migrateDraft,
  multiSampleSpanMs,
  serializeDeviceRecipeDraft,
  parseDeviceRecipeDraft,
  validateDraftForCreate,
} from "../device-recipe-draft.js";

describe("device-recipe-draft", () => {
  it("seeds I2C / SPI / GPIO examples with channels and sample steps", () => {
    const i2c = createI2cTemperatureExample();
    expect(i2c.binding.bus).toBe("i2c");
    expect(i2c.channels[0]?.quantity).toBe("temperature");
    expect(i2c.phases.sample.some((op) => op.type === "i2c_write_read")).toBe(true);

    const spi = createSpiPressureExample();
    expect(spi.binding.bus).toBe("spi");
    expect(spi.phases.sample.some((op) => op.type === "spi_transfer")).toBe(true);
    expect(spi.channels[0]?.unit).toBe("kPa");

    const gpio = createGpioDigitalExample();
    expect(gpio.sampleIntervalMs).toBe(5);
    expect(gpio.phases.sample.some((op) => op.type === "gpio_debounce" && op.stableMs === 20)).toBe(true);
  });

  it("seeds analog level example with incomplete calibration", () => {
    const adc = createAnalogLevelExample();
    expect(adc.binding.bus).toBe("adc");
    expect(adc.sampleIntervalMs).toBe(100);
    expect(isAnalogCalibrationComplete(adc)).toBe(false);
    expect(hasValidAnalogAcquisition(adc)).toBe(true);
    expect(adc.phases.sample.filter((op) => op.type === "average")).toHaveLength(1);
    const multi = adc.phases.sample.find((op) => op.type === "adc_multi_sample");
    expect(multi?.type === "adc_multi_sample" && multi.count === 8 && multi.intervalMs === 1).toBe(true);
  });

  it("computes multi-sample span as (n-1)×gap", () => {
    expect(multiSampleSpanMs(8, 1)).toBe(7);
    expect(multiSampleSpanMs(2, 1)).toBe(1);
    expect(multiSampleSpanMs(1, 5)).toBe(0);
  });

  it("maps range with invert, rejects coincident, saturates", () => {
    expect(applyMapRange(1500, 1000, 2000, 0, 100, true)).toBe(50);
    expect(applyMapRange(1500, 2000, 1000, 0, 100, true)).toBe(50);
    expect(applyMapRange(100, 0, 0, 0, 100, true)).toBeNull();
    expect(applyMapRange(3000, 0, 1000, 0, 100, true)).toBe(100);
    expect(applyMapRange(-10, 0, 1000, 0, 100, true)).toBe(0);
  });

  it("blocks create without analog calibration; draft acquisition still valid", () => {
    const draft = createAnalogLevelExample();
    expect(validateDraftForCreate(draft).some((e) => e.field === "calibration")).toBe(true);
    const calibrated = {
      ...draft,
      binding: {
        ...draft.binding,
        adc: { ...draft.binding.adc!, calibMinMv: 200, calibMaxMv: 2800 },
      },
    };
    expect(isAnalogCalibrationComplete(calibrated)).toBe(true);
    expect(validateDraftForCreate(calibrated).some((e) => e.field === "calibration")).toBe(false);
  });

  it("adapts analog draft to SensorRecipe v1 with adc_read + emit", () => {
    const recipe = draftToSensorRecipe(createAnalogLevelExample("LVL"));
    expect(recipe.bus).toBe("adc");
    expect(recipe.recipe.sample.some((s) => s.type === "adc_read")).toBe(true);
    expect(recipe.recipe.sample.some((s) => s.type === "emit")).toBe(true);
    expect(recipe.unknown?.some((u) => /calibrazione/i.test(u))).toBe(true);
  });

  it("validates create requirements", () => {
    const draft = createI2cTemperatureExample();
    expect(validateDraftForCreate(draft)).toHaveLength(0);
    expect(validateDraftForCreate({ ...draft, name: "" }).some((e) => e.field === "name")).toBe(true);
  });

  it("adapts draft to SensorRecipe v1 with channels", () => {
    const recipe = draftToSensorRecipe(createI2cTemperatureExample("TMP"));
    expect(recipe.chip).toBe("TMP");
    expect(recipe.bus).toBe("i2c");
    expect(recipe.channels?.some((c) => c.id === "temp_c")).toBe(true);
    expect(recipe.recipe.sample.some((s) => s.type === "emit")).toBe(true);
  });

  it("inserts library ops into a phase", () => {
    let draft = createSpiPressureExample();
    const before = draft.phases.sample.length;
    draft = insertOp(draft, "sample", "wait");
    expect(draft.phases.sample).toHaveLength(before + 1);
    expect(draft.phases.sample.at(-1)?.type).toBe("wait");

    let adc = createAnalogLevelExample();
    adc = insertOp(adc, "sample", "filter");
    expect(adc.phases.sample.some((op) => op.type === "filter")).toBe(true);
  });

  it("seeds graphic display with typed commands, not measure channels", () => {
    const display = createGraphicDisplayExample();
    expect(display.category).toBe("display");
    expect(display.binding.bus).toBe("spi");
    expect(display.channels).toHaveLength(0);
    expect(display.commands.some((c) => c.name === "scrivi_testo")).toBe(true);
    const write = display.commands.find((c) => c.name === "scrivi_testo")!;
    expect(write.params.map((p) => p.name)).toEqual(["testo", "x", "y"]);
    expect(write.steps.some((s) => s.type === "buffer_draw_text")).toBe(true);
    expect(validateDraftForCreate(display)).toHaveLength(0);
  });

  it("adapts display draft with commands[] and no fake emit channels", () => {
    const recipe = draftToSensorRecipe(createGraphicDisplayExample("OLED"));
    expect(recipe.bus).toBe("spi");
    expect(recipe.channels ?? []).toHaveLength(0);
    expect(recipe.outputs).toHaveLength(0);
    expect(recipe.commands?.some((c) => c.name === "scrivi_testo")).toBe(true);
    expect(recipe.unknown?.some((u) => /commands\[\]/i.test(u))).toBe(true);
  });

  it("migrates v1 drafts to v2", () => {
    const v1 = createI2cTemperatureExample();
    const raw = { ...v1, schemaVersion: "1" as const, category: undefined, commands: undefined };
    const migrated = migrateDraft(raw);
    expect(migrated.schemaVersion).toBe("2");
    expect(migrated.category).toBe("sensor");
    expect(migrated.commands).toEqual([]);
    const roundTrip = parseDeviceRecipeDraft(serializeDeviceRecipeDraft(createGraphicDisplayExample()));
    expect(roundTrip?.category).toBe("display");
  });
});
