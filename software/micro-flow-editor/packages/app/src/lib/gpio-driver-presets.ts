import {
  DEFAULT_ACTION_TRIGGER,
  createNamedAction,
  type DeviceRecipeCommand,
  type DeviceRecipeDraft,
  type DeviceRecipeOp,
  type GpioEventDefinition,
  type GpioSignalDef,
} from "./device-recipe-draft.js";
import { gpioSignalType } from "./gpio-operation-registry.js";
import type { SensorChannel } from "./sensor-recipe.js";

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.round(Math.random() * 1e5).toString(36)}`;
}

function digitalOut(
  id: string,
  name: string,
  extras?: Pick<GpioSignalDef, "description" | "activeLow"> & {
    readonly initialState?: 0 | 1;
    readonly safeState?: 0 | 1;
  },
): GpioSignalDef {
  return {
    id,
    identifier: id,
    name,
    description: extras?.description ?? "",
    signalType: "digital_output",
    role: "generic",
    direction: "out",
    pinLabel: "",
    pull: "none",
    activeLow: extras?.activeLow ?? false,
    configuration: {
      initialState: extras?.initialState ?? 0,
      safeState: extras?.safeState ?? 0,
    },
    requirements: { writable: true },
  };
}

function digitalIn(
  id: string,
  name: string,
  extras?: Pick<GpioSignalDef, "pull" | "activeLow" | "description"> & {
    readonly debounceMs?: number;
  },
): GpioSignalDef {
  return {
    id,
    identifier: id,
    name,
    description: extras?.description ?? "",
    signalType: "digital_input",
    role: "generic",
    direction: "in",
    pinLabel: "",
    pull: extras?.pull ?? "up",
    activeLow: extras?.activeLow ?? true,
    configuration: {
      debounceMs: extras?.debounceMs ?? 20,
      pollingIntervalMs: 20,
      edge: "both",
    },
    requirements: { readable: true },
  };
}

function analogIn(id: string, name: string, unit = "%"): GpioSignalDef {
  return {
    id,
    identifier: id,
    name,
    description: "",
    signalType: "analog_input",
    role: "generic",
    direction: "in",
    pinLabel: "",
    pull: "none",
    activeLow: false,
    configuration: {
      adcMode: "single",
      rawMin: 0,
      rawMax: 4095,
      scaleMin: 0,
      scaleMax: 100,
      unit,
      calibrationOffset: 0,
      calibrationMultiplier: 1,
    },
    requirements: { readable: true, adc: true },
  };
}

function pwmOut(id: string, name: string): GpioSignalDef {
  return {
    id,
    identifier: id,
    name,
    description: "",
    signalType: "pwm_output",
    role: "generic",
    direction: "out",
    pinLabel: "",
    pull: "none",
    activeLow: false,
    configuration: {
      pwmFrequencyHz: 1000,
      initialDutyPercent: 0,
      dutyMinPercent: 0,
      dutyMaxPercent: 100,
      stopBehavior: "low",
      safeDutyPercent: 0,
    },
    requirements: { writable: true, pwm: true, dedicatedRoute: true },
  };
}

function action(
  name: string,
  label: string,
  steps: readonly DeviceRecipeOp[],
  extras?: Partial<DeviceRecipeCommand>,
): DeviceRecipeCommand {
  return createNamedAction({
    name,
    label,
    description: extras?.description ?? "",
    params: extras?.params ?? [],
    steps,
    id: extras?.id,
  });
}

function gpioDraft(seed: {
  readonly name: string;
  readonly hardwareKind?: NonNullable<DeviceRecipeDraft["gpioHardware"]>["kind"];
  readonly description: string;
  readonly deviceCategory: NonNullable<DeviceRecipeDraft["deviceCategory"]>;
  readonly signals: readonly GpioSignalDef[];
  readonly commands: readonly DeviceRecipeCommand[];
  readonly channels?: readonly SensorChannel[];
  readonly events?: readonly GpioEventDefinition[];
  readonly init?: readonly DeviceRecipeOp[];
  readonly runtimeUnavailable?: readonly string[];
}): DeviceRecipeDraft {
  return {
    schemaVersion: "2",
    id: uid("dr"),
    name: seed.name,
    gpioHardware: {
      kind: seed.hardwareKind ?? "generic",
      power: "none",
      ground: false,
      extraTerminals: [],
    },
    description: seed.description,
    deviceCategory: seed.deviceCategory,
    icon: "",
    status: "draft",
    category: "sensor",
    sampleIntervalMs: 0,
    actionTrigger: DEFAULT_ACTION_TRIGGER,
    variables: [],
    binding: {
      bus: "gpio",
      gpioSignals: seed.signals,
      auxGpio: [],
    },
    channels: seed.channels ?? [],
    commands: seed.commands,
    gpioEvents: seed.events ?? [],
    phases: { init: seed.init ?? [], sample: [], command: [] },
    verification: { status: "untested", note: "Da provare sul dispositivo" },
    updatedAt: Date.now(),
    runtimeUnavailable: seed.runtimeUnavailable ?? ["try_read_on_device"],
  };
}

function write(signalId: string, level: 0 | 1): DeviceRecipeOp {
  return { id: uid("op"), type: "gpio_write", signalId, level };
}

function read(signalId: string, into: string): DeviceRecipeOp {
  return { id: uid("op"), type: "gpio_read", signalId, into };
}

function analogRead(
  signalId: string,
  into: string,
  convertedInto?: string,
): DeviceRecipeOp {
  return { id: uid("op"), type: "gpio_read_analog", signalId, into, convertedInto };
}

function emit(channelId: string, from: string): DeviceRecipeOp {
  return { id: uid("op"), type: "emit", channelId, from };
}

function waitMs(ms: number, parameterId?: string): DeviceRecipeOp {
  return {
    id: uid("op"),
    type: "wait",
    ms,
    unit: "ms",
    ...(parameterId ? { duration: { kind: "parameter" as const, parameterId } } : {}),
  };
}

function pwm(signalId: string, dutyParameterId?: string, duty = 0): DeviceRecipeOp {
  return {
    id: uid("op"),
    type: "gpio_set_pwm",
    signalId,
    frequencyHz: { kind: "fixed", value: 1000 },
    dutyPercent: dutyParameterId
      ? { kind: "parameter", parameterId: dutyParameterId }
      : { kind: "fixed", value: duty },
  };
}

function output(
  id: string,
  label: string,
  dataType: SensorChannel["dataType"],
  extras?: Partial<SensorChannel>,
): SensorChannel {
  return {
    id,
    label,
    unit: extras?.unit ?? "",
    quantity: dataType === "bool" ? "digital" : "analog",
    direction: "read",
    dataType,
    source: extras?.source ?? "",
    transforms: extras?.transforms ?? [],
    description: extras?.description,
  };
}

function event(
  id: string,
  name: string,
  sourceSignalId: string,
  trigger: GpioEventDefinition["trigger"],
): GpioEventDefinition {
  return {
    id,
    name,
    sourceSignalId,
    trigger,
    delivery: "auto",
    pollingIntervalMs: 20,
  };
}

export function createGpioLedPreset(name = "LED"): DeviceRecipeDraft {
  return gpioDraft({
    hardwareKind: "led",
    name,
    description: "Uscita digitale generica per un LED o un indicatore.",
    deviceCategory: "output",
    signals: [digitalOut("LED_OUTPUT", "LED_OUTPUT")],
    init: [write("LED_OUTPUT", 0)],
    commands: [
      action("turn_on", "Turn On", [write("LED_OUTPUT", 1)]),
      action("turn_off", "Turn Off", [write("LED_OUTPUT", 0)]),
      action("toggle", "Toggle", [
        { id: uid("op"), type: "gpio_toggle", signalId: "LED_OUTPUT" },
      ]),
      action(
        "blink",
        "Blink",
        [write("LED_OUTPUT", 1), waitMs(500, "duration"), write("LED_OUTPUT", 0)],
        {
          description: "Accende, attende duration, spegne.",
          params: [
            {
              id: "duration",
              name: "duration",
              type: "float",
              defaultValue: 500,
              min: 1,
              unit: "ms",
            },
          ],
        },
      ),
    ],
    runtimeUnavailable: ["gpio_toggle", "try_read_on_device"],
  });
}

export function createGpioButtonPreset(name = "Button"): DeviceRecipeDraft {
  return gpioDraft({
    hardwareKind: "button",
    name,
    description: "Ingresso digitale generico per un pulsante o un contatto.",
    deviceCategory: "input",
    signals: [digitalIn("BUTTON_INPUT", "BUTTON_INPUT")],
    commands: [
      action("read_value", "Read Value", [
        read("BUTTON_INPUT", "pressed"),
        emit("pressed", "pressed"),
      ]),
    ],
    channels: [output("pressed", "pressed", "bool", { source: "pressed" })],
    events: [
      event("on_press", "On Press", "BUTTON_INPUT", "digital_rising"),
      event("on_release", "On Release", "BUTTON_INPUT", "digital_falling"),
    ],
  });
}

export const GPIO_RELAY_CATALOG_ID = "gpio-relay";
export const GPIO_RELAY_CATALOG_UPDATED_AT = Date.UTC(2026, 0, 1);

export function createGpioRelayPreset(
  name = "Relè",
  options?: { readonly stable?: boolean },
): DeviceRecipeDraft {
  const id = (key: string) => (options?.stable ? `relay-${key}` : uid("op"));
  const signalId = "RELAY_CONTROL";
  const reading = (key: string) => ({
    id: id(key),
    type: "gpio_read" as const,
    signalId,
    into: "stato",
  });
  const base = gpioDraft({
    hardwareKind: "relay",
    name,
    description:
      "Relè digitale ON/OFF. L’ingresso trigger chiama ON o OFF in base al livello ricevuto.",
    deviceCategory: "actuator",
    signals: [
      {
        ...digitalOut(signalId, "RELAY"),
        requirements: { writable: true, readable: true },
      },
    ],
    init: [{ id: id("init"), type: "gpio_write", signalId, level: 0 }],
    commands: [
      action(
        "on",
        "ON",
        [
          { id: id("on-write"), type: "gpio_write", signalId, level: 1 },
          reading("on-read"),
        ],
        options?.stable ? { id: "relay-cmd-on" } : undefined,
      ),
      action(
        "off",
        "OFF",
        [
          { id: id("off-write"), type: "gpio_write", signalId, level: 0 },
          reading("off-read"),
        ],
        options?.stable ? { id: "relay-cmd-off" } : undefined,
      ),
    ],
    channels: [output("stato", "Stato", "bool")],
    runtimeUnavailable: [],
  });
  return {
    ...base,
    ...(options?.stable
      ? {
          id: GPIO_RELAY_CATALOG_ID,
          updatedAt: GPIO_RELAY_CATALOG_UPDATED_AT,
          status: "ready" as const,
        }
      : {}),
    gpioHardware: {
      kind: "relay",
      power: "none",
      ground: true,
      extraTerminals: ["COM", "NO", "NC"],
    },
    variables: [
      {
        id: options?.stable ? "relay-var-comando" : uid("var"),
        name: "comando",
        label: "Comando",
        valueType: "bool",
        defaultValue: "0",
      },
      {
        id: options?.stable ? "relay-var-stato" : uid("var"),
        name: "stato",
        label: "Stato",
        valueType: "bool",
        defaultValue: "0",
      },
    ],
    flowInterfaces: [
      {
        id: id("ingresso"),
        type: "sample_external",
        fromChannelId: "comando",
        into: "comando",
        valueType: "bool",
        widthBytes: 1,
        byteOrder: "le",
        inputMode: "trigger",
        triggerHighAction: "on",
        triggerLowAction: "off",
      },
      { id: id("uscita"), type: "emit", channelId: "stato", from: "stato" },
    ],
    channels: [
      ...base.channels,
      { ...output("comando", "Comando", "bool"), direction: "write" },
    ],
  };
}

export function catalogGpioRelayDriver(): DeviceRecipeDraft {
  return createGpioRelayPreset("Relè", { stable: true });
}

export function createGpioMosfetPreset(name = "MOSFET"): DeviceRecipeDraft {
  const draft = createGpioLedPreset(name);
  return {
    ...draft,
    deviceCategory: "actuator",
    gpioHardware: { kind: "mosfet", power: "none", ground: false, extraTerminals: [] },
    binding: {
      ...draft.binding,
      gpioSignals: draft.binding.gpioSignals.map((signal) => ({
        ...signal,
        name: "GATE",
      })),
    },
  };
}

export function createGpioPotentiometerPreset(
  name = "Potentiometer",
): DeviceRecipeDraft {
  return gpioDraft({
    hardwareKind: "potentiometer",
    name,
    description: "Ingresso analogico con mappa ADC configurabile verso 0–100.",
    deviceCategory: "input",
    signals: [analogIn("ANALOG_VALUE", "ANALOG_VALUE")],
    commands: [
      action("read_value", "Read Value", [
        analogRead("ANALOG_VALUE", "raw", "position"),
        emit("position", "position"),
      ]),
    ],
    channels: [
      output("position", "position", "number", {
        unit: "%",
        source: "position",
        transforms: [
          {
            kind: "map_range",
            inMin: 0,
            inMax: 4095,
            outMin: 0,
            outMax: 100,
            clamp: true,
          },
        ],
      }),
    ],
    runtimeUnavailable: ["gpio_read_analog", "try_read_on_device"],
  });
}

export function createGpioRgbLedPreset(name = "RGB LED"): DeviceRecipeDraft {
  return gpioDraft({
    hardwareKind: "rgb",
    name,
    description:
      "Tre uscite PWM indipendenti. Il colore è una composizione di azioni, non un tipo dispositivo.",
    deviceCategory: "output",
    signals: [pwmOut("RED", "RED"), pwmOut("GREEN", "GREEN"), pwmOut("BLUE", "BLUE")],
    init: [
      pwm("RED", undefined, 0),
      pwm("GREEN", undefined, 0),
      pwm("BLUE", undefined, 0),
    ],
    commands: [
      action(
        "set_color",
        "Set Color",
        [pwm("RED", "red"), pwm("GREEN", "green"), pwm("BLUE", "blue")],
        {
          params: [
            {
              id: "red",
              name: "red",
              type: "float",
              defaultValue: 0,
              min: 0,
              max: 100,
              unit: "%",
            },
            {
              id: "green",
              name: "green",
              type: "float",
              defaultValue: 0,
              min: 0,
              max: 100,
              unit: "%",
            },
            {
              id: "blue",
              name: "blue",
              type: "float",
              defaultValue: 0,
              min: 0,
              max: 100,
              unit: "%",
            },
          ],
        },
      ),
    ],
    runtimeUnavailable: ["gpio_set_pwm", "try_read_on_device"],
  });
}

export function createGpioJoystickPreset(name = "Analog Joystick"): DeviceRecipeDraft {
  return gpioDraft({
    hardwareKind: "joystick",
    name,
    description: "Due assi analogici e un pulsante digitale.",
    deviceCategory: "input",
    signals: [
      analogIn("X_AXIS", "X_AXIS"),
      analogIn("Y_AXIS", "Y_AXIS"),
      digitalIn("BUTTON", "BUTTON"),
    ],
    commands: [
      action("read_value", "Read Value", [
        analogRead("X_AXIS", "x_raw", "x"),
        analogRead("Y_AXIS", "y_raw", "y"),
        read("BUTTON", "pressed"),
        emit("x", "x"),
        emit("y", "y"),
        emit("pressed", "pressed"),
      ]),
    ],
    channels: [
      output("x", "x", "number", { source: "x" }),
      output("y", "y", "number", { source: "y" }),
      output("pressed", "pressed", "bool", { source: "pressed" }),
    ],
    runtimeUnavailable: ["gpio_read_analog", "try_read_on_device"],
  });
}

export function createGpioMotorDriverPreset(name = "Motor Driver"): DeviceRecipeDraft {
  return gpioDraft({
    hardwareKind: "motor",
    name,
    description: "Due uscite digitali di direzione e un PWM di abilitazione/velocità.",
    deviceCategory: "actuator",
    signals: [
      digitalOut("IN1", "IN1"),
      digitalOut("IN2", "IN2"),
      pwmOut("ENABLE", "ENABLE"),
    ],
    init: [write("IN1", 0), write("IN2", 0), pwm("ENABLE", undefined, 0)],
    commands: [
      action("forward", "Forward", [write("IN1", 1), write("IN2", 0)]),
      action("reverse", "Reverse", [write("IN1", 0), write("IN2", 1)]),
      action("stop", "Stop", [
        pwm("ENABLE", undefined, 0),
        write("IN1", 0),
        write("IN2", 0),
      ]),
      action("set_speed", "Set Speed", [pwm("ENABLE", "speed")], {
        params: [
          {
            id: "speed",
            name: "speed",
            type: "float",
            defaultValue: 0,
            min: 0,
            max: 100,
            unit: "%",
          },
        ],
      }),
    ],
    runtimeUnavailable: ["gpio_set_pwm", "try_read_on_device"],
  });
}

export function createGpioDigitalSensorPreset(
  name = "Digital Sensor",
): DeviceRecipeDraft {
  return gpioDraft({
    hardwareKind: "sensor",
    name,
    description: "Ingresso digitale generico per un sensore on/off.",
    deviceCategory: "sensor",
    signals: [digitalIn("SENSOR_OUTPUT", "SENSOR_OUTPUT")],
    commands: [
      action("read_value", "Read Value", [
        read("SENSOR_OUTPUT", "detected"),
        emit("detected", "detected"),
      ]),
    ],
    channels: [output("detected", "detected", "bool", { source: "detected" })],
    events: [
      event("on_detection", "On Detection", "SENSOR_OUTPUT", "digital_rising"),
      event("on_detection_end", "On Detection End", "SENSOR_OUTPUT", "digital_falling"),
    ],
  });
}

export function createGpioPirPreset(name = "PIR Sensor"): DeviceRecipeDraft {
  return createGpioDigitalSensorPreset(name);
}

export const GPIO_BUZZER_CATALOG_ID = "gpio-buzzer-active";

/** Active buzzer with its own oscillator. Passive audio PWM is not generated. */
export function createGpioBuzzerPreset(
  name = "Buzzer attivo",
  options?: { readonly stable?: boolean },
): DeviceRecipeDraft {
  const base = createGpioRelayPreset(name, options);
  const signalId = "BUZZER";
  const remap = (op: DeviceRecipeOp): DeviceRecipeOp =>
    "signalId" in op ? { ...op, signalId } : op;
  return {
    ...base,
    id: options?.stable ? GPIO_BUZZER_CATALOG_ID : base.id,
    description:
      "Buzzer attivo con oscillatore interno: accendi, spegni o emetti un beep di 100 ms. Non genera toni per buzzer passivi.",
    gpioHardware: { kind: "buzzer", power: "none", ground: true, extraTerminals: [] },
    binding: {
      ...base.binding,
      gpioSignals: base.binding.gpioSignals.map((signal) => ({
        ...signal,
        id: signalId,
        identifier: signalId,
        name: "BUZZER",
      })),
    },
    phases: { ...base.phases, init: base.phases.init.map(remap) },
    commands: [
      ...base.commands.map((command) => ({
        ...command,
        id: command.id.replace("relay-", "buzzer-"),
        label: command.name === "on" ? "Accendi" : "Spegni",
        steps: command.steps.map(remap),
      })),
      action(
        "beep",
        "Beep breve",
        [
          {
            id: options?.stable ? "buzzer-beep-pulse" : uid("op"),
            type: "gpio_pulse",
            signalId,
            activeState: 1,
            durationMs: { kind: "fixed", value: 100 },
            restoreState: 0,
          },
          {
            id: options?.stable ? "buzzer-beep-read" : uid("op"),
            type: "gpio_read",
            signalId,
            into: "stato",
          },
        ],
        options?.stable ? { id: "buzzer-cmd-beep" } : undefined,
      ),
    ],
    variables: base.variables.map((variable) => ({
      ...variable,
      id: variable.id.replace("relay-", "buzzer-"),
    })),
  };
}

export function catalogGpioBuzzerDriver(): DeviceRecipeDraft {
  return createGpioBuzzerPreset("Buzzer attivo", { stable: true });
}

export function createGpioAnalogSensorPreset(
  name = "Analog Sensor",
): DeviceRecipeDraft {
  const draft = createGpioPotentiometerPreset(name);
  return { ...draft, gpioHardware: { ...draft.gpioHardware!, kind: "sensor" } };
}

export type GpioDriverPreset = {
  readonly id: string;
  readonly name: { readonly it: string; readonly en: string };
  readonly description: { readonly it: string; readonly en: string };
  readonly create: (name?: string) => DeviceRecipeDraft;
};

/** Ordinary generic drafts. None of these use device-specific editor logic. */
export const GPIO_DRIVER_PRESETS: readonly GpioDriverPreset[] = [
  {
    id: "mosfet",
    name: { it: "MOSFET", en: "MOSFET" },
    description: { it: "Comando on / off", en: "On / off control" },
    create: createGpioMosfetPreset,
  },
  {
    id: "led",
    name: { it: "LED", en: "LED" },
    description: { it: "Uscita digitale", en: "Digital output" },
    create: createGpioLedPreset,
  },
  {
    id: "button",
    name: { it: "Pulsante", en: "Button" },
    description: { it: "Ingresso digitale", en: "Digital input" },
    create: createGpioButtonPreset,
  },
  {
    id: "relay",
    name: { it: "Relè", en: "Relay" },
    description: { it: "ON / OFF + trigger", en: "ON / OFF + trigger" },
    create: createGpioRelayPreset,
  },
  {
    id: "pir",
    name: { it: "Sensore PIR", en: "PIR sensor" },
    description: { it: "Ingresso digitale", en: "Digital input" },
    create: createGpioPirPreset,
  },
  {
    id: "potentiometer",
    name: { it: "Potenziometro", en: "Potentiometer" },
    description: { it: "Ingresso analogico", en: "Analog input" },
    create: createGpioPotentiometerPreset,
  },
  {
    id: "analog",
    name: { it: "Sensore analogico", en: "Analog sensor" },
    description: { it: "Ingresso analogico", en: "Analog input" },
    create: createGpioAnalogSensorPreset,
  },
  {
    id: "buzzer",
    name: { it: "Cicalino", en: "Buzzer" },
    description: { it: "Uscita digitale", en: "Digital output" },
    create: createGpioBuzzerPreset,
  },
  {
    id: "rgb",
    name: { it: "LED RGB", en: "RGB LED" },
    description: { it: "Tre PWM", en: "Three PWM outputs" },
    create: createGpioRgbLedPreset,
  },
  {
    id: "joystick",
    name: { it: "Joystick", en: "Joystick" },
    description: { it: "Due analogici + pulsante", en: "Two analog + button" },
    create: createGpioJoystickPreset,
  },
  {
    id: "motor",
    name: { it: "Driver motore", en: "Motor driver" },
    description: { it: "Due digitali + PWM", en: "Two digital + PWM" },
    create: createGpioMotorDriverPreset,
  },
  {
    id: "digital_sensor",
    name: { it: "Sensore digitale", en: "Digital sensor" },
    description: { it: "Ingresso digitale", en: "Digital input" },
    create: createGpioDigitalSensorPreset,
  },
];

export function applyGpioPreset(
  draft: DeviceRecipeDraft,
  presetId: string,
): DeviceRecipeDraft {
  const preset = GPIO_DRIVER_PRESETS.find((item) => item.id === presetId);
  if (!preset) return draft;
  const next = preset.create(draft.name);
  return { ...next, id: draft.id, name: draft.name, updatedAt: Date.now() };
}

/** Init ops derived from signal initial state — not copied back into signal configuration. */
export function gpioInitialStateOps(
  draft: DeviceRecipeDraft,
): readonly DeviceRecipeOp[] {
  const ops: DeviceRecipeOp[] = [];
  for (const signal of draft.binding.gpioSignals) {
    const type = gpioSignalType(signal);
    if (type === "digital_output") {
      ops.push({
        id: uid("op"),
        type: "gpio_write",
        signalId: signal.id,
        level: signal.configuration?.initialState ?? 0,
      });
    }
    if (type === "pwm_output") {
      ops.push({
        id: uid("op"),
        type: "gpio_set_pwm",
        signalId: signal.id,
        frequencyHz: {
          kind: "fixed",
          value: signal.configuration?.pwmFrequencyHz ?? 1000,
        },
        dutyPercent: {
          kind: "fixed",
          value: signal.configuration?.initialDutyPercent ?? 0,
        },
      });
    }
  }
  return ops;
}

/** A single digital signal. Physical pin assignment belongs to Module Function. */
export function createGpioDigitalDriver(
  name = "Dispositivo GPIO",
  direction: "in" | "out" = "out",
): DeviceRecipeDraft {
  const signalId = "DATA";
  const reading = () => read(signalId, "var1");
  const base = gpioDraft({
    name,
    description: "Ingresso o uscita digitale",
    deviceCategory: direction === "out" ? "output" : "sensor",
    signals: [
      direction === "out"
        ? digitalOut(signalId, "DATA")
        : digitalIn(signalId, "DATA", { pull: "none", activeLow: false }),
    ],
    init: direction === "out" ? [write(signalId, 0)] : [],
    channels: [output("stato", "Stato", "bool")],
    commands:
      direction === "out"
        ? [
            action("high", "HIGH", [write(signalId, 1), reading()]),
            action("low", "LOW", [write(signalId, 0), reading()]),
            action("follow", "Segui ingresso", [
              {
                id: uid("op"),
                type: "gpio_write",
                signalId,
                level: 0,
                value: { kind: "variable", name: "var1" },
              },
              reading(),
            ]),
            action("read", "Leggi stato", [reading()]),
          ]
        : [action("read", "Leggi ingresso", [reading()])],
    runtimeUnavailable: [],
  });
  return {
    ...base,
    variables: [
      {
        id: uid("var"),
        name: "var1",
        label: "var1",
        valueType: "bool",
        defaultValue: "0",
      },
    ],
    flowInterfaces: [
      ...(direction === "out"
        ? [
            {
              id: uid("op"),
              type: "sample_external" as const,
              fromChannelId: "dato",
              into: "var1",
              valueType: "bool" as const,
              widthBytes: 1,
              byteOrder: "le" as const,
              inputMode: "data" as const,
              label: "Dato",
            },
          ]
        : []),
      emit("stato", "var1"),
    ],
    channels: [
      ...base.channels,
      ...(direction === "out"
        ? [{ ...output("dato", "Dato", "bool"), direction: "write" as const }]
        : []),
    ],
  };
}

/** ULN2003 / 28BYJ-48, nominal 4096 half-steps/revolution. */
export function catalogUln2003Driver(): DeviceRecipeDraft {
  const signalIds = ["IN1", "IN2", "IN3", "IN4"];
  const motor = (command: "start" | "stop" | "position"): DeviceRecipeOp => ({
    id: `uln-${command}-op`,
    type: "stepper",
    signalIds,
    command,
    positionVariable: "posizione",
    intervalMs: 3,
    stepsPerRevolution: 4096,
  });
  const base = gpioDraft({
    name: "Stepper ULN2003",
    hardwareKind: "motor",
    deviceCategory: "actuator",
    description:
      "Motore 28BYJ-48 con ULN2003. Start continuo, Stop e posizione 0–360° rispetto allo zero all’avvio. Posizione stimata, senza sensore di riferimento.",
    signals: signalIds.map((id) => digitalOut(id, id)),
    init: [motor("stop")],
    commands: [
      action("stop", "Stop", [motor("stop")], { id: "uln-01-stop" }),
      action("start", "Start", [motor("start")], { id: "uln-02-start" }),
      action("position", "Vai a posizione", [motor("position")], {
        id: "uln-03-position",
      }),
    ],
    channels: [
      {
        ...output("angolo", "Posizione · 0–360°", "number"),
        direction: "write",
        unit: "°",
      },
    ],
    runtimeUnavailable: [],
  });
  return {
    ...base,
    id: "uln2003-28byj48",
    status: "ready",
    updatedAt: Date.UTC(2026, 9, 18),
    gpioHardware: { kind: "motor", power: "5", ground: true, extraTerminals: [] },
    variables: [
      {
        id: "uln-position",
        name: "posizione",
        label: "Posizione",
        valueType: "number",
        defaultValue: "0",
      },
    ],
    flowInterfaces: [
      {
        id: "uln-position-input",
        type: "sample_external",
        fromChannelId: "angolo",
        into: "posizione",
        valueType: "number",
        widthBytes: 8,
        byteOrder: "le",
        inputMode: "data",
        label: "Posizione · 0–360°",
      },
    ],
  };
}

/** DHT11; the legacy preset ID stays stable for saved modules and NFC bindings. */
export function catalogDht22Driver(): DeviceRecipeDraft {
  const readStep: DeviceRecipeOp = {
    id: "dht-read",
    type: "dht22_read",
    temperatureInto: "temperatura_raw",
    humidityInto: "umidita_raw",
  };
  const draft = gpioDraft({
    name: "DHT11",
    hardwareKind: "sensor",
    deviceCategory: "sensor",
    description:
      "Temperatura e umidità su richiesta: DATA A0, alimentazione A1 HIGH, GND comune. Il fronte di salita o false→true avvia la lettura.",
    signals: [
      digitalIn("DATA", "DATA", { activeLow: false, pull: "none" }),
      digitalOut("POWER", "Alimentazione 3,3 V"),
    ],
    init: [{ id: "dht-init", type: "dht22_power", on: true }],
    commands: [
      action(
        "leggi",
        "Leggi temperatura",
        [
          {
            id: "dht-trigger",
            type: "sample_external",
            inputMode: "trigger",
            fromChannelId: "read-trigger",
            into: "richiesta_lettura",
            valueType: "bool",
          },
          readStep,
          {
            id: "dht-convert",
            type: "dht22_convert",
            input: "temperatura_raw",
            into: "temperatura",
            format: "float",
          },
          emit("temperature", "temperatura"),
          {
            id: "dht-humidity",
            type: "dht22_convert",
            input: "umidita_raw",
            into: "umidita",
            format: "float",
            quantity: "humidity",
          },
          emit("humidity", "umidita"),
        ],
        { id: "00-read" },
      ),
    ],
    channels: [
      {
        id: "read-trigger",
        label: "Leggi temperatura",
        unit: "",
        quantity: "digital",
        direction: "write",
        dataType: "bool",
        inputMode: "trigger",
      },
      {
        id: "temperature",
        label: "Temperatura",
        unit: "°C",
        quantity: "temperature",
        direction: "read",
        dataType: "number",
      },
      {
        id: "humidity",
        label: "Umidità",
        unit: "%RH",
        quantity: "humidity",
        direction: "read",
        dataType: "number",
      },
    ],
    runtimeUnavailable: [],
  });
  return {
    ...draft,
    id: "gpio-dht22",
    temperatureSensorModel: "dht11",
    dht22Module: true,
    dht22Version: 3,
    status: "ready",
    sampleIntervalMs: 0,
    gpioHardware: { ...draft.gpioHardware!, ground: true },
    updatedAt: 1792353600000,
  };
}

/** Upgrade the original unformatted DHT22 template while keeping unit identity. */
export function upgradeDht22Driver(draft: DeviceRecipeDraft): DeviceRecipeDraft {
  return draft.dht22Module &&
    draft.temperatureSensorModel !== "ds18b20" &&
    (draft.dht22Version ?? 0) < 3
    ? {
        ...catalogDht22Driver(),
        id: draft.id,
        name: draft.name === "DHT22" ? "DHT11" : draft.name,
      }
    : draft;
}

/** One DS18B20 on DATA; parasite power uses DATA, VDD must be grounded. */
export function catalogDs18b20Driver(): DeviceRecipeDraft {
  const dht = catalogDht22Driver();
  return {
    ...dht,
    id: "gpio-ds18b20-parasite",
    name: "DS18B20",
    temperatureSensorModel: "ds18b20",
    ds18b20PowerMode: "parasite",
    description:
      "Alimentazione parassita da DATA A0. VDD e GND a massa; pull-up esterno DATA–3,3 V. Un sensore per pin; conversione fino a 750 ms. Verificare la schedina con LED prima del collegamento.",
    binding: {
      ...dht.binding,
      gpioSignals: dht.binding.gpioSignals.filter((s) => s.id === "DATA"),
    },
    channels: dht.channels.filter((c) => c.id !== "humidity"),
    commands: dht.commands.map((a) => ({
      ...a,
      steps: a.steps.filter(
        (s) =>
          !(s.type === "dht22_convert" && s.quantity === "humidity") &&
          !(s.type === "emit" && s.channelId === "humidity"),
      ),
    })),
  };
}

/** Rebuild pin requirements without changing actions, variables or driver identity. */
export function withDs18b20PowerMode(
  draft: DeviceRecipeDraft,
  mode: "parasite" | "vcc" | "gpio",
  _legacyVoltage?: "3.3" | "5",
): DeviceRecipeDraft {
  if (draft.temperatureSensorModel !== "ds18b20") return draft;
  const data = draft.binding.gpioSignals.find((signal) => signal.id === "DATA");
  if (!data) throw new Error("Il DS18B20 deve dichiarare DATA.");
  const power =
    draft.binding.gpioSignals.find((signal) => signal.id === "POWER") ??
    digitalOut("POWER", "Alimentazione 3,3 V");
  return {
    ...draft,
    ds18b20PowerMode: mode,
    gpioHardware: { kind: "sensor", power: mode === "vcc" ? "3.3" : "none", ground: true, extraTerminals: [] },
    binding: {
      ...draft.binding,
      gpioSignals: mode === "gpio" ? [data, power] : [data],
    },
    description:
      mode === "gpio"
        ? "DATA A0, VCC A1 HIGH, GND comune. Alimentazione da GPIO durante avvio, conversione e lettura."
        : mode === "vcc"
          ? "DATA sul pin scelto, VCC alla linea 3,3 V della Backbone V2 e GND comune. Non collegare VCC a 5 V: il pull-up della schedina porterebbe DATA a 5 V. Conversione fino a 750 ms."
          : catalogDs18b20Driver().description,
  };
}
