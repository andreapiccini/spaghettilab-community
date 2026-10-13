/**
 * SensorRecipe v1 — standard card the UI / “AI” / manual wizard all fill.
 * Runtime executes only typed steps; no free-form datasheet text in the app.
 */

export const SENSOR_RECIPE_SCHEMA_VERSION = "1" as const;

export type SensorBus = "i2c" | "spi" | "uart" | "adc" | "gpio" | "w1";

export type SensorOutputKind =
  | "temperature"
  | "humidity"
  | "pressure"
  | "distance"
  | "light"
  | "digital"
  | "analog"
  | "other";

/** Semantic quantity exposed to Flow blocks (read or write). */
export type SensorChannelDirection = "read" | "write";

export type SensorChannel = {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly quantity: SensorOutputKind;
  readonly direction: SensorChannelDirection;
};

export type SensorRecipeStep =
  | { readonly type: "wait"; readonly ms: number }
  | { readonly type: "i2c_write"; readonly addr: string; readonly reg?: string; readonly bytes: readonly string[] }
  | { readonly type: "i2c_read"; readonly addr: string; readonly reg?: string; readonly len: number; readonly into: string }
  | { readonly type: "adc_read"; readonly into: string }
  | { readonly type: "gpio_write"; readonly level: 0 | 1 }
  | { readonly type: "gpio_read"; readonly into: string }
  | { readonly type: "emit"; readonly outputId: string; readonly from: string };

/** Typed multi-param command (additive to v1 — not a scalar write channel). */
export type SensorCommandParamType = "string" | "int" | "float" | "bool";

export type SensorCommandParam = {
  readonly name: string;
  readonly type: SensorCommandParamType;
  readonly defaultValue?: string | number | boolean;
};

export type SensorCommand = {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly params: readonly SensorCommandParam[];
  /** Executable steps when runtime supports them; often empty / partial. */
  readonly steps?: readonly SensorRecipeStep[];
};

export type SensorTransformOp = "u16_be" | "u16_le" | "s16_be" | "s16_le" | "u8" | "scale";

export type SensorTransform = {
  readonly id: string;
  readonly op: SensorTransformOp;
  readonly input: string;
  readonly args?: { readonly multiply?: number; readonly divide?: number; readonly offset?: number };
};

export type SensorRecipe = {
  readonly schemaVersion: typeof SENSOR_RECIPE_SCHEMA_VERSION;
  readonly id: string;
  readonly chip: string;
  readonly vendor?: string;
  readonly aliases?: readonly string[];
  readonly oneLiner: string;
  readonly bus: SensorBus;
  readonly address?: string;
  readonly addressAlt?: string;
  readonly voltage: string;
  readonly pins: readonly { readonly role: string; readonly label: string; readonly signal?: "power" | "gnd" | "i2c" | "spi" | "uart" | "adc" | "digital_in" | "digital_out" }[];
  /**
   * Channels the Flow blocks see (grandezze read/write).
   * Source of truth for graph ports; `outputs` mirrors read channels for emit/tryNow.
   * Optional for older saved modules — use `recipeChannels()`.
   */
  readonly channels?: readonly SensorChannel[];
  /**
   * Multi-parameter commands (display / actuators). Additive v1 field.
   * Do not collapse these into a single On/Off write channel.
   * Runtime may ignore until firmware supports command dispatch.
   */
  readonly commands?: readonly SensorCommand[];
  /** @deprecated Prefer `channels` (read). Kept in sync for emit/tryNow. */
  readonly outputs: readonly {
    readonly id: string;
    readonly label: string;
    readonly unit: string;
    readonly kind: SensorOutputKind;
  }[];
  readonly recipe: {
    readonly init: readonly SensorRecipeStep[];
    readonly sample: readonly SensorRecipeStep[];
    /** Optional actuation sequence for write channels. */
    readonly write?: readonly SensorRecipeStep[];
  };
  readonly transforms: readonly SensorTransform[];
  readonly registers: readonly {
    readonly id: string;
    readonly name: string;
    readonly role: "config" | "data" | "status" | "other";
    readonly note?: string;
  }[];
  readonly tryNow: { readonly outputId: string; readonly hint?: string };
  readonly source: {
    readonly kind: "catalog" | "community" | "ai_draft" | "manual";
    readonly label?: string;
  };
  readonly confidence: "high" | "medium" | "low";
  readonly unknown?: readonly string[];
};

export function outputsFromChannels(channels: readonly SensorChannel[]): SensorRecipe["outputs"] {
  return channels
    .filter((channel) => channel.direction === "read")
    .map((channel) => ({
      id: channel.id,
      label: channel.label,
      unit: channel.unit,
      kind: channel.quantity,
    }));
}

export function channelsFromOutputs(
  outputs: SensorRecipe["outputs"],
  direction: SensorChannelDirection = "read",
): readonly SensorChannel[] {
  return outputs.map((output) => ({
    id: output.id,
    label: output.label,
    unit: output.unit,
    quantity: output.kind,
    direction,
  }));
}

/** Prefer `channels`; fall back to legacy `outputs` as read channels. */
export function recipeChannels(recipe: Pick<SensorRecipe, "channels" | "outputs">): readonly SensorChannel[] {
  if (recipe.channels && recipe.channels.length > 0) return recipe.channels;
  return channelsFromOutputs(recipe.outputs ?? []);
}

export function withChannels(recipe: SensorRecipe, channels: readonly SensorChannel[]): SensorRecipe {
  const outputs = outputsFromChannels(channels);
  const tryId = outputs.some((o) => o.id === recipe.tryNow.outputId)
    ? recipe.tryNow.outputId
    : (outputs[0]?.id ?? recipe.tryNow.outputId);
  return {
    ...recipe,
    channels,
    outputs,
    tryNow: { ...recipe.tryNow, outputId: tryId },
  };
}

export function readChannels(recipe: Pick<SensorRecipe, "channels" | "outputs">): readonly SensorChannel[] {
  return recipeChannels(recipe).filter((channel) => channel.direction === "read");
}

export function writeChannels(recipe: Pick<SensorRecipe, "channels" | "outputs">): readonly SensorChannel[] {
  return recipeChannels(recipe).filter((channel) => channel.direction === "write");
}

/**
 * Unused seed cards (BME280, AHT20, …) kept for later catalog work.
 * Not wired into SENSOR_RECIPE_CATALOG / search / wizard.
 */
export const SENSOR_RECIPE_SEED_CATALOG: readonly SensorRecipe[] = [
  {
    schemaVersion: "1",
    id: "bme280",
    chip: "BME280",
    vendor: "Bosch",
    aliases: ["BMP280"],
    oneLiner: "Sensore I2C di temperatura, umidità e pressione.",
    bus: "i2c",
    address: "0x76",
    addressAlt: "0x77",
    voltage: "3.3V",
    pins: [
      { role: "VCC", label: "3.3V", signal: "power" },
      { role: "GND", label: "GND", signal: "gnd" },
      { role: "SDA", label: "I2C data", signal: "i2c" },
      { role: "SCL", label: "I2C clock", signal: "i2c" },
    ],
    channels: [
      { id: "temp_c", label: "Temperatura", unit: "°C", quantity: "temperature", direction: "read" },
      { id: "hum_pct", label: "Umidità", unit: "%", quantity: "humidity", direction: "read" },
      { id: "press_hpa", label: "Pressione", unit: "hPa", quantity: "pressure", direction: "read" },
    ],
    outputs: [
      { id: "temp_c", label: "Temperatura", unit: "°C", kind: "temperature" },
      { id: "hum_pct", label: "Umidità", unit: "%", kind: "humidity" },
      { id: "press_hpa", label: "Pressione", unit: "hPa", kind: "pressure" },
    ],
    recipe: {
      init: [
        { type: "wait", ms: 10 },
        { type: "i2c_write", addr: "0x76", reg: "0xF4", bytes: ["0x27"] },
      ],
      sample: [
        { type: "wait", ms: 10 },
        { type: "i2c_read", addr: "0x76", reg: "0xFA", len: 3, into: "temp_raw" },
        { type: "emit", outputId: "temp_c", from: "temp_scaled" },
      ],
    },
    transforms: [
      { id: "temp_u16", op: "u16_be", input: "temp_raw" },
      { id: "temp_scaled", op: "scale", input: "temp_u16", args: { divide: 100, offset: 0 } },
    ],
    registers: [
      { id: "0xF4", name: "CTRL_MEAS", role: "config", note: "Avvia misura" },
      { id: "0xFA", name: "TEMP_MSB", role: "data", note: "Byte alto temperatura" },
    ],
    tryNow: { outputId: "temp_c", hint: "Tocca il sensore con un dito: la temperatura sale" },
    source: { kind: "catalog", label: "BME280 datasheet (scheda curata)" },
    confidence: "high",
  },
  {
    schemaVersion: "1",
    id: "aht20",
    chip: "AHT20",
    vendor: "ASAIR",
    oneLiner: "Sensore I2C compatto di temperatura e umidità.",
    bus: "i2c",
    address: "0x38",
    voltage: "3.3V",
    pins: [
      { role: "VCC", label: "3.3V", signal: "power" },
      { role: "GND", label: "GND", signal: "gnd" },
      { role: "SDA", label: "I2C data", signal: "i2c" },
      { role: "SCL", label: "I2C clock", signal: "i2c" },
    ],
    channels: [
      { id: "temp_c", label: "Temperatura", unit: "°C", quantity: "temperature", direction: "read" },
      { id: "hum_pct", label: "Umidità", unit: "%", quantity: "humidity", direction: "read" },
    ],
    outputs: [
      { id: "temp_c", label: "Temperatura", unit: "°C", kind: "temperature" },
      { id: "hum_pct", label: "Umidità", unit: "%", kind: "humidity" },
    ],
    recipe: {
      init: [
        { type: "wait", ms: 40 },
        { type: "i2c_write", addr: "0x38", bytes: ["0xBE", "0x08", "0x00"] },
      ],
      sample: [
        { type: "i2c_write", addr: "0x38", bytes: ["0xAC", "0x33", "0x00"] },
        { type: "wait", ms: 80 },
        { type: "i2c_read", addr: "0x38", len: 6, into: "frame" },
        { type: "emit", outputId: "temp_c", from: "temp_scaled" },
      ],
    },
    transforms: [
      { id: "temp_u16", op: "u16_be", input: "frame" },
      { id: "temp_scaled", op: "scale", input: "temp_u16", args: { divide: 100, offset: -50 } },
    ],
    registers: [
      { id: "0xBE", name: "INIT", role: "config" },
      { id: "0xAC", name: "TRIGGER", role: "config", note: "Avvia misura" },
    ],
    tryNow: { outputId: "temp_c", hint: "Soffia sul sensore: umidità e temperatura cambiano" },
    source: { kind: "catalog", label: "AHT20 datasheet (scheda curata)" },
    confidence: "high",
  },
  {
    schemaVersion: "1",
    id: "adc-pot",
    chip: "Potenziometro",
    aliases: ["POT", "analog pot"],
    oneLiner: "Resistenza variabile letta come tensione ADC (0–3.3V).",
    bus: "adc",
    voltage: "3.3V",
    pins: [
      { role: "VCC", label: "3.3V", signal: "power" },
      { role: "GND", label: "GND", signal: "gnd" },
      { role: "OUT", label: "ADC", signal: "adc" },
    ],
    channels: [{ id: "level", label: "Livello", unit: "%", quantity: "analog", direction: "read" }],
    outputs: [{ id: "level", label: "Livello", unit: "%", kind: "analog" }],
    recipe: {
      init: [],
      sample: [
        { type: "adc_read", into: "raw" },
        { type: "emit", outputId: "level", from: "pct" },
      ],
    },
    transforms: [{ id: "pct", op: "scale", input: "raw", args: { multiply: 100, divide: 4095 } }],
    registers: [],
    tryNow: { outputId: "level", hint: "Gira la manopola e guarda il valore" },
    source: { kind: "catalog", label: "ADC generico" },
    confidence: "high",
  },
  {
    schemaVersion: "1",
    id: "gpio-button",
    chip: "Pulsante",
    aliases: ["button", "switch"],
    oneLiner: "Ingresso digitale on/off (pulsante o switch).",
    bus: "gpio",
    voltage: "3.3V",
    pins: [
      { role: "SIG", label: "GPIO", signal: "digital_in" },
      { role: "GND", label: "GND", signal: "gnd" },
    ],
    channels: [{ id: "pressed", label: "Premuto", unit: "on/off", quantity: "digital", direction: "read" }],
    outputs: [{ id: "pressed", label: "Premuto", unit: "on/off", kind: "digital" }],
    recipe: {
      init: [],
      sample: [
        { type: "gpio_read", into: "level" },
        { type: "emit", outputId: "pressed", from: "level" },
      ],
    },
    transforms: [{ id: "level", op: "u8", input: "level" }],
    registers: [],
    tryNow: { outputId: "pressed", hint: "Tieni premuto il pulsante" },
    source: { kind: "catalog", label: "GPIO generico" },
    confidence: "high",
  },
  {
    schemaVersion: "1",
    id: "hc-sr04",
    chip: "HC-SR04",
    aliases: ["ultrasuoni", "ultrasonic", "distance"],
    oneLiner: "Distanza a ultrasuoni (TRIG + ECHO).",
    bus: "gpio",
    voltage: "5V",
    pins: [
      { role: "VCC", label: "5V", signal: "power" },
      { role: "GND", label: "GND", signal: "gnd" },
      { role: "TRIG", label: "Trigger", signal: "digital_out" },
      { role: "ECHO", label: "Echo", signal: "digital_in" },
    ],
    channels: [{ id: "distance_cm", label: "Distanza", unit: "cm", quantity: "distance", direction: "read" }],
    outputs: [{ id: "distance_cm", label: "Distanza", unit: "cm", kind: "distance" }],
    recipe: {
      init: [],
      sample: [
        { type: "gpio_write", level: 1 },
        { type: "wait", ms: 1 },
        { type: "gpio_write", level: 0 },
        { type: "gpio_read", into: "echo" },
        { type: "emit", outputId: "distance_cm", from: "echo" },
      ],
    },
    transforms: [],
    registers: [],
    tryNow: { outputId: "distance_cm", hint: "Avvicina la mano al sensore" },
    source: { kind: "catalog", label: "HC-SR04 (scheda curata)" },
    confidence: "medium",
  },
];

/** Live picker catalog — empty until real curated cards ship (seeds stay unused). */
export const SENSOR_RECIPE_CATALOG: readonly SensorRecipe[] = [];

export function findSensorRecipeById(id: string): SensorRecipe | undefined {
  return SENSOR_RECIPE_CATALOG.find((recipe) => recipe.id === id);
}

export function searchSensorRecipes(query: string): readonly SensorRecipe[] {
  const q = query.trim().toLowerCase();
  if (!q) return SENSOR_RECIPE_CATALOG;
  return SENSOR_RECIPE_CATALOG.filter((recipe) => {
    const hay = [recipe.chip, recipe.vendor ?? "", recipe.oneLiner, ...(recipe.aliases ?? [])]
      .join(" ")
      .toLowerCase();
    return hay.includes(q) || recipe.id.includes(q);
  });
}

export function describeStep(step: SensorRecipeStep): string {
  switch (step.type) {
    case "wait":
      return `Aspetta ${step.ms} ms`;
    case "i2c_write":
      return step.reg
        ? `Scrivi I2C ${step.addr} reg ${step.reg}: ${step.bytes.join(" ")}`
        : `Scrivi I2C ${step.addr}: ${step.bytes.join(" ")}`;
    case "i2c_read":
      return step.reg
        ? `Leggi I2C ${step.addr} reg ${step.reg} → ${step.len} byte`
        : `Leggi I2C ${step.addr} → ${step.len} byte`;
    case "adc_read":
      return "Leggi ADC";
    case "gpio_write":
      return `Imposta GPIO = ${step.level}`;
    case "gpio_read":
      return "Leggi GPIO";
    case "emit":
      return `Emessi valore «${step.outputId}»`;
    default:
      return "Passo";
  }
}

export type SensorRecipePhase = "init" | "sample";

export type SensorRecipeStepType = SensorRecipeStep["type"];

/** Short badge for sequence diagram blocks (datasheet-style). */
export function stepBadge(step: SensorRecipeStep): string {
  switch (step.type) {
    case "wait":
      return `${step.ms}ms`;
    case "i2c_write":
      return step.reg ? `W ${step.reg}` : `W ${step.bytes[0] ?? "?"}`;
    case "i2c_read":
      return step.reg ? `R ${step.reg}` : `R ${step.len}B`;
    case "adc_read":
      return "ADC";
    case "gpio_write":
      return `GPIO=${step.level}`;
    case "gpio_read":
      return "GPIO";
    case "emit":
      return `→ ${step.outputId}`;
    default:
      return "?";
  }
}

export function defaultStep(type: SensorRecipeStepType, address = "0x00"): SensorRecipeStep {
  switch (type) {
    case "wait":
      return { type: "wait", ms: 10 };
    case "i2c_write":
      return { type: "i2c_write", addr: address, reg: "0x00", bytes: ["0x00"] };
    case "i2c_read":
      return { type: "i2c_read", addr: address, reg: "0x00", len: 2, into: "raw" };
    case "adc_read":
      return { type: "adc_read", into: "raw" };
    case "gpio_write":
      return { type: "gpio_write", level: 1 };
    case "gpio_read":
      return { type: "gpio_read", into: "level" };
    case "emit":
      return { type: "emit", outputId: "value", from: "raw" };
    default:
      return { type: "wait", ms: 10 };
  }
}

/** Step types offered in the palette for a given bus. */
export function paletteStepTypes(bus: SensorBus): readonly SensorRecipeStepType[] {
  switch (bus) {
    case "i2c":
      return ["wait", "i2c_write", "i2c_read", "emit"];
    case "adc":
      return ["wait", "adc_read", "emit"];
    case "gpio":
      return ["wait", "gpio_write", "gpio_read", "emit"];
    default:
      return ["wait", "emit"];
  }
}

export function withRecipePhase(
  recipe: SensorRecipe,
  phase: SensorRecipePhase,
  steps: readonly SensorRecipeStep[],
): SensorRecipe {
  return {
    ...recipe,
    recipe: {
      ...recipe.recipe,
      [phase]: steps,
    },
    confidence: recipe.source.kind === "manual" ? "medium" : recipe.confidence,
    unknown: recipe.source.kind === "manual" && steps.length > 0 ? undefined : recipe.unknown,
  };
}

export function insertRecipeStep(
  recipe: SensorRecipe,
  phase: SensorRecipePhase,
  type: SensorRecipeStepType,
  atIndex?: number,
): SensorRecipe {
  const current = [...recipe.recipe[phase]];
  const step = defaultStep(type, recipe.address ?? "0x00");
  const index = atIndex === undefined ? current.length : Math.max(0, Math.min(atIndex, current.length));
  current.splice(index, 0, step);
  return withRecipePhase(recipe, phase, current);
}

export function updateRecipeStep(
  recipe: SensorRecipe,
  phase: SensorRecipePhase,
  index: number,
  next: SensorRecipeStep,
): SensorRecipe {
  const current = [...recipe.recipe[phase]];
  if (index < 0 || index >= current.length) return recipe;
  current[index] = next;
  return withRecipePhase(recipe, phase, current);
}

export function removeRecipeStep(recipe: SensorRecipe, phase: SensorRecipePhase, index: number): SensorRecipe {
  const current = recipe.recipe[phase].filter((_, i) => i !== index);
  return withRecipePhase(recipe, phase, current);
}

export function moveRecipeStep(
  recipe: SensorRecipe,
  phase: SensorRecipePhase,
  from: number,
  to: number,
): SensorRecipe {
  const current = [...recipe.recipe[phase]];
  if (from < 0 || from >= current.length || to < 0 || to >= current.length || from === to) return recipe;
  const [item] = current.splice(from, 1);
  current.splice(to, 0, item!);
  return withRecipePhase(recipe, phase, current);
}

/** Blank manual draft when the chip is not in the catalog. */
export function blankSensorRecipe(chip: string, bus: SensorBus = "i2c"): SensorRecipe {
  const id = `manual-${chip.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") || "sensor"}`;
  const address = bus === "i2c" ? "0x00" : undefined;
  const sampleDefaults: SensorRecipeStep[] =
    bus === "adc"
      ? [
          { type: "adc_read", into: "raw" },
          { type: "emit", outputId: "value", from: "raw" },
        ]
      : bus === "gpio"
        ? [
            { type: "gpio_read", into: "raw" },
            { type: "emit", outputId: "value", from: "raw" },
          ]
        : bus === "i2c"
          ? [
              { type: "i2c_read", addr: address ?? "0x00", reg: "0x00", len: 2, into: "raw" },
              { type: "emit", outputId: "value", from: "raw" },
            ]
          : [
              { type: "wait", ms: 10 },
              { type: "emit", outputId: "value", from: "raw" },
            ];
  const channels: readonly SensorChannel[] = [
    {
      id: "value",
      label: bus === "gpio" ? "Stato" : "Valore",
      unit: bus === "gpio" ? "on/off" : "raw",
      quantity: bus === "gpio" ? "digital" : bus === "adc" ? "analog" : "other",
      direction: "read",
    },
  ];
  return {
    schemaVersion: "1",
    id,
    chip: chip.trim() || "Sensore",
    oneLiner: "Ricetta creata a mano — completa i passi di lettura.",
    bus,
    address,
    voltage: "3.3V",
    pins:
      bus === "i2c"
        ? [
            { role: "VCC", label: "3.3V", signal: "power" },
            { role: "GND", label: "GND", signal: "gnd" },
            { role: "SDA", label: "I2C data", signal: "i2c" },
            { role: "SCL", label: "I2C clock", signal: "i2c" },
          ]
        : [
            { role: "SIG", label: bus.toUpperCase(), signal: bus === "adc" ? "adc" : "digital_in" },
            { role: "GND", label: "GND", signal: "gnd" },
          ],
    channels,
    outputs: outputsFromChannels(channels),
    recipe: { init: [], sample: sampleDefaults },
    transforms: [],
    registers: [],
    tryNow: { outputId: "value", hint: "Aggiungi i passi di lettura dalla scheda" },
    source: { kind: "manual" },
    confidence: "low",
    unknown: ["Sequenza da completare"],
  };
}
