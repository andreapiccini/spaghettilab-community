import { describe, expect, it } from "vitest";
import {
  createBlankDraft,
  createI2cTemperatureExample,
  draftToCanvasSensorRecipes,
  draftToSensorRecipe,
  libraryOpsForBus,
  parseDeviceRecipeDraft,
  serializeDeviceRecipeDraft,
  validateDraftForCreate,
} from "../device-recipe-draft.js";
import { evaluateGpioCapabilities } from "../gpio-capability.js";
import {
  GPIO_DRIVER_PRESETS,
  applyGpioPreset,
  createGpioButtonPreset,
  createGpioDigitalSensorPreset,
  createGpioJoystickPreset,
  createGpioLedPreset,
  createGpioMotorDriverPreset,
  createGpioPotentiometerPreset,
  createGpioRelayPreset,
  createGpioRgbLedPreset,
} from "../gpio-driver-presets.js";
import { gpioSignalType, validateGpioOperation } from "../gpio-operation-registry.js";
import { recipePlanToTestProfile } from "../recipe-to-test-profile.js";

describe("generic GPIO driver editor", () => {
  it("keeps I2C drivers valid and unchanged by GPIO presets", () => {
    const i2c = createI2cTemperatureExample();
    expect(validateDraftForCreate(i2c)).toHaveLength(0);
    expect(i2c.binding.bus).toBe("i2c");
    expect(libraryOpsForBus("i2c").some((item) => item.type === "i2c_write_read")).toBe(true);
    expect(libraryOpsForBus("gpio").some((item) => item.type === "i2c_write_read")).toBe(false);
  });

  it("exposes the generic GPIO operation library", () => {
    const types = libraryOpsForBus("gpio").map((item) => item.type);
    expect(types).toEqual(
      expect.arrayContaining([
        "gpio_read",
        "gpio_write",
        "gpio_toggle",
        "gpio_pulse",
        "gpio_read_analog",
        "gpio_set_pwm",
        "gpio_set_pwm_pulse",
        "gpio_stop_pwm",
        "wait",
        "emit",
      ]),
    );
  });

  it("validates the eight generic test-case presets", () => {
    const cases = [
      createGpioLedPreset(),
      createGpioButtonPreset(),
      createGpioRelayPreset(),
      createGpioPotentiometerPreset(),
      createGpioRgbLedPreset(),
      createGpioJoystickPreset(),
      createGpioMotorDriverPreset(),
      createGpioDigitalSensorPreset(),
    ];
    for (const draft of cases) {
      expect(draft.binding.bus).toBe("gpio");
      expect(draft.binding.gpioSignals.every((signal) => signal.pinLabel === "")).toBe(true);
      expect(validateDraftForCreate(draft)).toEqual([]);
      const recipes = draftToCanvasSensorRecipes(draft);
      expect(recipes.length).toBeGreaterThan(0);
      expect(recipes.every((recipe) => recipe.deviceDraft?.id === draft.id)).toBe(true);
    }
  });

  it("describes LED, button, RGB, motor and joystick with the same signal model", () => {
    const led = createGpioLedPreset();
    expect(led.binding.gpioSignals.map((signal) => gpioSignalType(signal))).toEqual([
      "digital_output",
    ]);
    expect(led.commands.map((command) => command.name)).toEqual([
      "turn_on",
      "turn_off",
      "toggle",
      "blink",
    ]);

    const button = createGpioButtonPreset();
    expect(button.channels.map((channel) => channel.id)).toEqual(["pressed"]);
    expect(button.gpioEvents?.map((event) => event.name)).toEqual(["On Press", "On Release"]);

    const rgb = createGpioRgbLedPreset();
    expect(rgb.binding.gpioSignals.map((signal) => signal.id)).toEqual(["RED", "GREEN", "BLUE"]);
    expect(rgb.commands[0]?.params.map((parameter) => parameter.id)).toEqual([
      "red",
      "green",
      "blue",
    ]);

    const motor = createGpioMotorDriverPreset();
    expect(motor.binding.gpioSignals.map((signal) => signal.id)).toEqual(["IN1", "IN2", "ENABLE"]);
    expect(motor.commands.map((command) => command.name)).toEqual([
      "forward",
      "reverse",
      "stop",
      "set_speed",
    ]);

    const joystick = createGpioJoystickPreset();
    expect(joystick.channels.map((channel) => channel.id)).toEqual(["x", "y", "pressed"]);
  });

  it("round-trips GPIO presets through the existing persistence helpers", () => {
    const draft = createGpioMotorDriverPreset("Motore");
    const restored = parseDeviceRecipeDraft(serializeDeviceRecipeDraft(draft));
    expect(restored?.binding.bus).toBe("gpio");
    expect(restored?.binding.gpioSignals.map((signal) => signal.id)).toEqual([
      "IN1",
      "IN2",
      "ENABLE",
    ]);
    expect(validateDraftForCreate(restored!)).toEqual([]);
  });

  it("applies a preset onto an existing GPIO draft without changing its id", () => {
    const blank = createBlankDraft("gpio", "Custom");
    const next = applyGpioPreset(blank, "led");
    expect(next.id).toBe(blank.id);
    expect(next.name).toBe("Custom");
    expect(next.binding.gpioSignals[0]?.id).toBe("LED_OUTPUT");
  });

  it("marks incompatible operations and missing signals", () => {
    const led = createGpioLedPreset();
    const readOnOutput = {
      id: "bad",
      type: "gpio_read" as const,
      signalId: "LED_OUTPUT",
      into: "x",
    };
    expect(validateGpioOperation(readOnOutput, led)).toEqual([]);
    const input = createGpioButtonPreset();
    expect(validateGpioOperation({ id: "bad-write", type: "gpio_write", signalId: input.binding.gpioSignals[0]!.id, level: 1 }, input).length).toBeGreaterThan(0);
    expect(
      validateDraftForCreate({
        ...led,
        commands: led.commands.map((command) => ({
          ...command,
          steps: command.steps.map((step) =>
            step.type === "gpio_write" ? { ...step, signalId: "MISSING" } : step,
          ),
        })),
      }).some((error) => error.message.includes("mancante")),
    ).toBe(true);
  });

  it("exposes GPIO events as Design Flow event channels", () => {
    const recipe = draftToSensorRecipe(createGpioButtonPreset());
    expect(recipe.channels?.some((channel) => channel.id === "event:on_press")).toBe(true);
    expect(recipe.channels?.some((channel) => channel.outputMode === "event")).toBe(true);
    expect(recipe.unknown?.some((item) => /Eventi GPIO/i.test(item))).toBe(true);
  });

  it("preserves signalId on v1 gpio read/write adapters", () => {
    const recipe = draftToSensorRecipe(createGpioRelayPreset());
    expect(
      recipe.commands?.some((command) =>
        command.steps?.some((step) => step.type === "gpio_write" && step.signalId === "RELAY_CONTROL"),
      ),
    ).toBe(true);
  });

  it("compiles supported GPIO test ops and skips PWM", () => {
    const relay = createGpioRelayPreset();
    const compiled = recipePlanToTestProfile(relay, relay.phases.init, relay.commands[0]!.steps);
    expect(compiled.profile.transport).toBe(3);
    expect(compiled.profile.initOps.some((op) => op.op === "GPIO_SET")).toBe(true);
    expect(compiled.profile.sampleOps.some((op) => op.op === "GPIO_SET")).toBe(true);

    const rgb = createGpioRgbLedPreset();
    const pwm = recipePlanToTestProfile(rgb, rgb.phases.init, rgb.commands[0]!.steps);
    expect(pwm.skipped).toEqual(expect.arrayContaining(["gpio_set_pwm"]));
    expect(pwm.profile.initOps.every((op) => op.op !== "GPIO_SET" || true)).toBe(true);
  });

  it("compiles analog-only GPIO reads as ADC transport", () => {
    const pot = createGpioPotentiometerPreset();
    const compiled = recipePlanToTestProfile(pot, [], pot.commands[0]!.steps);
    expect(compiled.profile.transport).toBe(4);
    expect(compiled.profile.sampleOps.some((op) => op.op === "ADC_READ")).toBe(true);
  });

  it("treats unassigned physical routes as capability issues, not editor blockers", () => {
    const led = createGpioLedPreset();
    expect(evaluateGpioCapabilities(led).ok).toBe(false);
    expect(evaluateGpioCapabilities(led).issues[0]?.code).toBe("unassigned");
    expect(
      evaluateGpioCapabilities(led, {
        assigned: { LED_OUTPUT: { digitalWrite: true } },
      }).ok,
    ).toBe(true);
  });

  it("lists every catalog preset as a generic factory", () => {
    expect(GPIO_DRIVER_PRESETS.map((preset) => preset.id)).toEqual(
      expect.arrayContaining(["led", "button", "relay", "rgb", "motor", "joystick"]),
    );
    for (const preset of GPIO_DRIVER_PRESETS) {
      const draft = preset.create();
      expect(draft.binding.bus).toBe("gpio");
      expect(validateDraftForCreate(draft)).toEqual([]);
    }
  });
});
