import { describe, expect, it } from "vitest";
import {
  applyMapRange,
  createAnalogLevelExample,
  createBlankDraft,
  createGpioDigitalExample,
  createGraphicDisplayExample,
  createI2cTemperatureExample,
  createSpiPressureExample,
  draftToCanvasSensorRecipes,
  draftToSensorRecipe,
  hasValidAnalogAcquisition,
  insertOp,
  isAnalogCalibrationComplete,
  libraryOpsForBus,
  migrateDraft,
  migrateRecipeOp,
  multiSampleSpanMs,
  parseVarRef,
  serializeDeviceRecipeDraft,
  parseDeviceRecipeDraft,
  toVarRef,
  upsertRecipeVariable,
  validateDraftForCreate,
  validateI2cTransactionPhases,
  writeChannelsOf,
} from "../device-recipe-draft.js";

describe("device-recipe-draft", () => {
  it("migrates legacy i2c reg into write bytes / write_read", () => {
    const write = migrateRecipeOp({
      id: "w",
      type: "i2c_write",
      reg: "0x10",
      bytes: ["0xAB"],
    } as never);
    expect(write).toMatchObject({ type: "i2c_write", bytes: ["0x10", "0xAB"] });

    const read = migrateRecipeOp({
      id: "r",
      type: "i2c_read",
      reg: "0x00",
      len: 2,
      into: "raw",
    } as never);
    expect(read).toMatchObject({ type: "i2c_write_read", writeBytes: ["0x00"], readLen: 2 });
  });

  it("validates advanced I2C transaction phases", () => {
    expect(validateI2cTransactionPhases([])).not.toHaveLength(0);
    expect(
      validateI2cTransactionPhases([
        { kind: "start" },
        { kind: "write", bytes: ["0x00"] },
        { kind: "restart" },
        { kind: "read", len: 2 },
        { kind: "stop" },
      ]),
    ).toHaveLength(0);
    expect(
      validateI2cTransactionPhases([
        { kind: "start" },
        { kind: "write", bytes: ["0x00"] },
        { kind: "read", len: 1 },
        { kind: "stop" },
      ]).some((e) => /RESTART/i.test(e)),
    ).toBe(true);
  });

  it("createBlankDraft starts with no default actions or steps", () => {
    for (const mode of ["i2c", "spi", "gpio", "adc", "w1"] as const) {
      const draft = createBlankDraft(mode);
      expect(draft.commands).toHaveLength(0);
      expect(draft.phases.init).toHaveLength(0);
      expect(draft.channels).toHaveLength(0);
      expect(draft.binding.bus).toBe(mode);
    }
  });

  it("seeds I2C / SPI / GPIO examples with channels and named actions", () => {
    const i2c = createI2cTemperatureExample();
    expect(i2c.binding.bus).toBe("i2c");
    expect(i2c.channels[0]?.quantity).toBe("other");
    expect(i2c.commands[0]?.steps.some((op) => op.type === "i2c_write_read")).toBe(true);
    expect(i2c.commands[0]?.steps.some((op) => op.type === "emit")).toBe(true);
    expect(i2c.phases.sample).toHaveLength(0);

    const spi = createSpiPressureExample();
    expect(spi.binding.bus).toBe("spi");
    expect(spi.commands[0]?.steps.some((op) => op.type === "spi_transfer")).toBe(true);
    expect(spi.channels[0]?.unit).toBe("kPa");

    const gpio = createGpioDigitalExample();
    expect(gpio.commands[0]?.steps.some((op) => op.type === "gpio_debounce" && op.stableMs === 20)).toBe(true);
  });

  it("seeds analog level example with incomplete calibration", () => {
    const adc = createAnalogLevelExample();
    expect(adc.binding.bus).toBe("adc");
    expect(isAnalogCalibrationComplete(adc)).toBe(false);
    expect(hasValidAnalogAcquisition(adc)).toBe(true);
    expect(adc.commands[0]?.steps.filter((op) => op.type === "average")).toHaveLength(1);
    const multi = adc.commands[0]?.steps.find((op) => op.type === "adc_multi_sample");
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
    expect(recipe.channels?.some((c) => c.id === "out_0")).toBe(true);
    expect(recipe.recipe.sample.some((s) => s.type === "emit")).toBe(true);
  });

  it("inserts library ops into init; actions use commands[]", () => {
    let draft = createSpiPressureExample();
    draft = insertOp(draft, "init", "wait");
    expect(draft.phases.init.at(-1)?.type).toBe("wait");
    expect(draft.commands[0]?.steps.some((op) => op.type === "spi_transfer")).toBe(true);

    const adc = createAnalogLevelExample();
    expect(adc.commands[0]?.steps.some((op) => op.type === "adc_multi_sample")).toBe(true);
  });

  it("migrates legacy Task sample into a named action", () => {
    const migrated = migrateDraft({
      schemaVersion: "2",
      id: "old",
      name: "Legacy",
      binding: { bus: "i2c", i2c: { address: "0x48", busUnit: "I2C0", sdaLabel: "A0", sclLabel: "A1" }, gpioSignals: [], auxGpio: [] },
      channels: [{ id: "out_0", label: "Out", unit: "", quantity: "other", direction: "read" }],
      phases: {
        init: [],
        sample: [
          { id: "op1", type: "i2c_write_read", reg: "0x00", writeBytes: [], readLen: 2, into: "raw", repeatedStart: true },
          { id: "op2", type: "emit", channelId: "out_0", from: "raw" },
        ],
        command: [],
      },
    });
    expect(migrated.commands).toHaveLength(1);
    expect(migrated.commands[0]?.name).toBe("misura");
    expect(migrated.phases.sample).toHaveLength(0);
    expect(migrated.commands[0]?.steps.some((op) => op.type === "emit")).toBe(true);
  });

  it("expands named actions into one canvas recipe each", () => {
    const draft = createI2cTemperatureExample("TMP");
    const recipes = draftToCanvasSensorRecipes(draft);
    expect(recipes).toHaveLength(1);
    expect(recipes[0]?.chip).toContain("Misura");
    expect(recipes[0]?.recipe.sample.some((s) => s.type === "emit")).toBe(true);

    const multi = {
      ...draft,
      commands: [
        ...draft.commands,
        {
          ...draft.commands[0]!,
          id: "cmd-2",
          name: "calibra",
          label: "Calibra",
          steps: [{ id: "w1", type: "wait" as const, ms: 1 }],
        },
      ],
    };
    expect(draftToCanvasSensorRecipes(multi)).toHaveLength(2);
  });

  it("I2C library exposes only bus communication ops", () => {
    const types = libraryOpsForBus("i2c").map((o) => o.type);
    expect(types).toEqual([
      "i2c_read",
      "i2c_write",
      "i2c_write_read",
      "wait",
      "i2c_scan",
      "i2c_transaction",
    ]);
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
    const raw = { ...v1, schemaVersion: "1" as const, category: undefined, commands: undefined, phases: { init: [], sample: [], command: [] } };
    const migrated = migrateDraft(raw);
    expect(migrated.schemaVersion).toBe("2");
    expect(migrated.category).toBe("sensor");
    expect(migrated.commands).toEqual([]);
    expect(migrated.variables).toEqual([]);
    const roundTrip = parseDeviceRecipeDraft(serializeDeviceRecipeDraft(createGraphicDisplayExample()));
    expect(roundTrip?.category).toBe("display");
    expect(roundTrip?.variables).toEqual([]);
  });

  it("exposes Ingresso/Uscita on non-I2C buses; ADC keeps Campiona ADC", () => {
    for (const bus of ["spi", "gpio", "adc", "w1"] as const) {
      const lib = libraryOpsForBus(bus);
      expect(lib.some((x) => x.type === "sample_external" && x.label === "Ingresso")).toBe(true);
      expect(lib.some((x) => x.type === "emit" && x.label === "Uscita")).toBe(true);
    }
    expect(libraryOpsForBus("i2c").some((x) => x.type === "sample_external")).toBe(false);
    expect(libraryOpsForBus("adc").some((x) => x.type === "adc_sample" && x.label === "Campiona ADC")).toBe(true);
  });

  it("inserts Ingresso and upserts write channel + variable", () => {
    let draft = createI2cTemperatureExample();
    expect(draft.variables).toHaveLength(0);
    expect(writeChannelsOf(draft)).toHaveLength(0);
    draft = insertOp(draft, "init", "sample_external");
    const op = draft.phases.init.at(-1);
    expect(op?.type).toBe("sample_external");
    if (op?.type !== "sample_external") throw new Error("expected sample_external");
    expect(writeChannelsOf(draft).some((c) => c.id === op.fromChannelId)).toBe(true);
    expect(draft.variables.some((v) => v.name === op.into)).toBe(true);
  });

  it("parses $var refs and validates unknown variables", () => {
    expect(toVarRef("reg")).toBe("$reg");
    expect(parseVarRef("$reg")).toBe("reg");
    let draft = createI2cTemperatureExample();
    draft = {
      ...draft,
      commands: draft.commands.map((c) => ({
        ...c,
        steps: c.steps.map((op) =>
          op.type === "i2c_write_read" ? { ...op, writeBytes: ["$reg"] } : op,
        ),
      })),
    };
    expect(validateDraftForCreate(draft).some((e) => e.field === "variables")).toBe(true);
    draft = upsertRecipeVariable(draft, { name: "reg", valueType: "hex", label: "Registro" });
    expect(validateDraftForCreate(draft).some((e) => e.field === "variables")).toBe(false);
  });

  it("migrates sample_external ops into variables when missing", () => {
    const base = createI2cTemperatureExample();
    const raw = {
      ...base,
      variables: undefined,
      phases: {
        ...base.phases,
        command: [
          {
            id: "op-1",
            type: "sample_external" as const,
            fromChannelId: "ingresso",
            into: "setpoint",
            valueType: "number" as const,
          },
        ],
      },
    };
    const migrated = migrateDraft(raw);
    expect(migrated.variables.some((v) => v.name === "setpoint" && v.valueType === "number")).toBe(true);
  });
});
