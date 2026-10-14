/**
 * Device recipe authoring draft (editor UI).
 * Separates: reusable protocol, project pin/bus binding, verification.
 * Adapts down to SensorRecipe v1 for Flow placement; extended ops live here
 * until a firmware runtime exists (declared unavailable for try/run).
 */

import {
  blankSensorRecipe,
  outputsFromChannels,
  withChannels,
  type SensorBus,
  type SensorChannel,
  type SensorRecipe,
  type SensorRecipeStep,
  type SensorTransform,
} from "./sensor-recipe.js";
import { DS18B20_CMD, validateOneWireRom } from "./onewire.js";

export const DEVICE_RECIPE_DRAFT_VERSION = "2" as const;
export const DEVICE_RECIPE_DRAFT_META_KEY = "__deviceRecipeDraft";
/** Set to "1" when Crea sensore should place a Flow block on next Processing Graph open. */
export const DEVICE_RECIPE_PENDING_CREATE_META_KEY = "__deviceRecipePendingCreate";

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.round(Math.random() * 1e5).toString(36)}`;
}

export type DeviceRecipePhase = "init" | "sample" | "command";

export type DeviceRecipeBus = "i2c" | "spi" | "gpio" | "adc" | "w1";
/** Editor mode pill: buses + display category (display is not a bus). */
export type DeviceRecipeMode = DeviceRecipeBus | "display";
export type DeviceRecipeCategory = "sensor" | "display";
export type DisplayControllerProfile = "graphic_framebuffer" | "character" | "segment";
export type DisplayUpdateMode = "auto" | "explicit";
export type DeviceCommandParamType = "string" | "int" | "float" | "bool";

/**
 * External action trigger — same vocabulary as canvas blocks / GPIO pin settings
 * (`triggerEdge` rising|falling, pin `edge` both, polarity high|low).
 */
export type DeviceActionTriggerEdge = "rising" | "falling" | "both";
export type DeviceActionTriggerLevel = "high" | "low";
export type DeviceActionTrigger = {
  readonly edge: DeviceActionTriggerEdge;
  readonly level: DeviceActionTriggerLevel;
};

export const DEFAULT_ACTION_TRIGGER: DeviceActionTrigger = {
  edge: "rising",
  level: "high",
};

export function normalizeActionTrigger(raw?: Partial<DeviceActionTrigger> | null): DeviceActionTrigger {
  const edge =
    raw?.edge === "falling" || raw?.edge === "both" || raw?.edge === "rising" ? raw.edge : DEFAULT_ACTION_TRIGGER.edge;
  const level = raw?.level === "low" || raw?.level === "high" ? raw.level : DEFAULT_ACTION_TRIGGER.level;
  return { edge, level };
}

/** Recipe-scoped variables shared across Inizializzazione / Task / Azione. */
export type RecipeVarType = "number" | "hex" | "bool" | "string";

export type RecipeVariable = {
  readonly id: string;
  readonly name: string;
  readonly valueType: RecipeVarType;
  readonly label: string;
  readonly defaultValue?: string;
};

export const RECIPE_VAR_REF_PREFIX = "$";

export function isVarRef(value: string | undefined | null): boolean {
  return Boolean(value && value.startsWith(RECIPE_VAR_REF_PREFIX) && value.length > 1);
}

export function parseVarRef(value: string | undefined | null): string | null {
  if (!isVarRef(value)) return null;
  return value!.slice(1).trim() || null;
}

export function toVarRef(name: string): string {
  const n = name.trim().replace(/^\$+/, "");
  return `${RECIPE_VAR_REF_PREFIX}${n}`;
}

export function normalizeRecipeVarName(name: string): string {
  return name
    .trim()
    .replace(/^\$-/, "")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/^(\d)/, "_$1")
    .slice(0, 32) || "var";
}

export function normalizeRecipeVariable(raw?: Partial<RecipeVariable> | null): RecipeVariable {
  const name = normalizeRecipeVarName(raw?.name ?? "var");
  const valueType: RecipeVarType =
    raw?.valueType === "number" || raw?.valueType === "hex" || raw?.valueType === "bool" || raw?.valueType === "string"
      ? raw.valueType
      : "hex";
  return {
    id: raw?.id && raw.id.trim() ? raw.id : newId("var"),
    name,
    valueType,
    label: raw?.label?.trim() || name,
    defaultValue: raw?.defaultValue,
  };
}

export type DeviceCommandParam = {
  readonly id: string;
  readonly name: string;
  readonly type: DeviceCommandParamType;
  readonly defaultValue: string | number | boolean;
  readonly min?: number;
  readonly max?: number;
  readonly required?: boolean;
};

export type DisplayProfile = {
  readonly controllerProfile: DisplayControllerProfile;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly pixelFormat: "1bpp" | "rgb565" | "mono";
  readonly fontId: string;
  readonly encoding: "utf8" | "ascii";
  readonly clipPolicy: "clip" | "reject" | "wrap";
  readonly updateModeDefault: DisplayUpdateMode;
};

export type GpioSignalDef = {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly direction: "in" | "out" | "bidir";
  readonly pinLabel: string;
  readonly pull: "none" | "up" | "down";
  readonly activeLow: boolean;
};

export type DeviceRecipeOp =
  | { readonly id: string; readonly type: "wait"; readonly ms: number; readonly timeoutMs?: number }
  | {
      readonly id: string;
      readonly type: "i2c_write";
      readonly reg?: string;
      readonly bytes: readonly string[];
      readonly timeoutMs?: number;
    }
  | {
      readonly id: string;
      readonly type: "i2c_read";
      readonly reg?: string;
      readonly len: number;
      readonly into: string;
      readonly timeoutMs?: number;
    }
  | {
      readonly id: string;
      readonly type: "i2c_write_read";
      readonly reg?: string;
      readonly writeBytes: readonly string[];
      readonly readLen: number;
      readonly into: string;
      readonly repeatedStart: boolean;
      readonly timeoutMs?: number;
    }
  | { readonly id: string; readonly type: "spi_cs"; readonly assert: boolean; readonly timeoutMs?: number }
  | {
      readonly id: string;
      readonly type: "spi_transfer";
      readonly txBytes: readonly string[];
      readonly rxLen: number;
      readonly into: string;
      readonly keepCs: boolean;
      readonly timeoutMs?: number;
    }
  | {
      readonly id: string;
      readonly type: "gpio_read";
      readonly signalId: string;
      readonly into: string;
      readonly timeoutMs?: number;
    }
  | {
      readonly id: string;
      readonly type: "gpio_write";
      readonly signalId: string;
      readonly level: 0 | 1;
      readonly timeoutMs?: number;
    }
  | {
      readonly id: string;
      readonly type: "gpio_debounce";
      readonly signalId: string;
      readonly sampleMs: number;
      readonly stableMs: number;
      readonly into: string;
      readonly timeoutMs?: number;
    }
  | {
      /**
       * Decodifica: bytes grezzi / buffer / variabile interna → variabile di uscita
       * (tipicamente prima di Emetti).
       */
      readonly id: string;
      readonly type: "decode";
      readonly input: string;
      readonly into: string;
      readonly byteOrder: "be" | "le";
      readonly signed: boolean;
      readonly startByte: number;
      readonly endByte: number;
      readonly multiply?: number;
      readonly divide?: number;
      readonly offset?: number;
      /** Tipo della variabile di uscita dopo la conversione. */
      readonly outType?: RecipeVarType;
    }
  | {
      /**
       * Codifica: ingresso (variabile / valore Flow) → altra variabile,
       * cambiando tipo o applicando regole (scala, packing byte).
       */
      readonly id: string;
      readonly type: "encode";
      readonly input: string;
      readonly into: string;
      readonly fromType: RecipeVarType;
      readonly toType: RecipeVarType;
      readonly byteOrder: "be" | "le";
      /** Larghezza in byte quando toType è hex (packing). */
      readonly widthBytes: number;
      readonly multiply?: number;
      readonly divide?: number;
      readonly offset?: number;
    }
  | {
      readonly id: string;
      readonly type: "adc_sample";
      readonly into: string;
      readonly format: "raw" | "mV";
      readonly timeoutMs?: number;
    }
  | {
      readonly id: string;
      readonly type: "adc_multi_sample";
      readonly count: number;
      /** Gap between adjacent samples (ms). Span first→last = (count-1)*intervalMs. */
      readonly intervalMs: number;
      readonly into: string;
      readonly format: "raw" | "mV";
      readonly timeoutMs?: number;
    }
  | {
      readonly id: string;
      readonly type: "average";
      readonly input: string;
      readonly into: string;
    }
  | {
      readonly id: string;
      readonly type: "filter";
      readonly input: string;
      readonly into: string;
      readonly kind: "moving_avg" | "median";
      readonly window: number;
    }
  | {
      readonly id: string;
      readonly type: "map_range";
      readonly input: string;
      readonly into: string;
      readonly inMin: number | null;
      readonly inMax: number | null;
      readonly outMin: number;
      readonly outMax: number;
      readonly saturate: boolean;
    }
  | { readonly id: string; readonly type: "emit"; readonly channelId: string; readonly from: string }
  | {
      readonly id: string;
      readonly type: "validate_params";
      readonly paramNames: readonly string[];
    }
  | {
      readonly id: string;
      readonly type: "buffer_draw_text";
      readonly textParam: string;
      readonly xParam: string;
      readonly yParam: string;
      readonly fontId?: string;
    }
  | { readonly id: string; readonly type: "buffer_clear" }
  | { readonly id: string; readonly type: "display_flush"; readonly timeoutMs?: number }
  | { readonly id: string; readonly type: "display_power"; readonly on: boolean }
  | {
      readonly id: string;
      readonly type: "ctrl_pin";
      readonly pin: "DC" | "CS" | "RESET";
      readonly level: 0 | 1;
    }
  | {
      readonly id: string;
      readonly type: "spi_transfer_buffer";
      readonly timeoutMs?: number;
    }
  | {
      readonly id: string;
      readonly type: "w1_reset";
      readonly intoPresence: string;
      readonly timeoutMs?: number;
    }
  | {
      readonly id: string;
      readonly type: "w1_match_rom";
      /** Empty = use binding.w1.rom at run time. */
      readonly rom: string;
      readonly timeoutMs?: number;
    }
  | {
      readonly id: string;
      readonly type: "w1_write";
      readonly bytes: readonly string[];
      readonly timeoutMs?: number;
    }
  | {
      readonly id: string;
      readonly type: "w1_read";
      readonly len: number;
      readonly into: string;
      readonly timeoutMs?: number;
    }
  | {
      readonly id: string;
      readonly type: "w1_wait_convert";
      /** Strategy: fixed max from resolution, or poll (runtime may not support poll). */
      readonly strategy: "fixed_max" | "poll";
      readonly timeoutMs: number;
    }
  | {
      readonly id: string;
      readonly type: "w1_crc";
      readonly input: string;
      readonly len: number;
      readonly intoOk: string;
    }
  | {
      /** Copy a Flow write-channel value into a recipe variable. */
      readonly id: string;
      readonly type: "sample_external";
      readonly fromChannelId: string;
      readonly into: string;
      readonly valueType: RecipeVarType;
    };

/** Typed public command with its own executable sequence (refs params by name). */
export type DeviceRecipeCommand = {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly params: readonly DeviceCommandParam[];
  readonly steps: readonly DeviceRecipeOp[];
  /** When this azione is fired by an external trigger (Flow / GPIO / canvas). */
  readonly trigger?: DeviceActionTrigger;
  readonly updateMode?: DisplayUpdateMode;
  readonly errorPolicy?: "abort" | "ignore" | "clamp";
};

export type DeviceRecipeBinding = {
  readonly bus: DeviceRecipeBus;
  readonly i2c?: {
    readonly address: string;
    readonly busUnit: string;
    readonly sdaLabel: string;
    readonly sclLabel: string;
  };
  readonly spi?: {
    readonly mode: 0 | 1 | 2 | 3;
    readonly freqHz: number;
    readonly bitOrder: "msb" | "lsb";
    readonly sckLabel: string;
    readonly mosiLabel: string;
    readonly misoLabel: string;
    readonly csLabel: string;
    readonly misoRequired: boolean;
  };
  readonly adc?: {
    readonly signalName: string;
    readonly pinLabel: string;
    /** Board may expose mV conversion; otherwise only raw counts. */
    readonly supportsMv: boolean;
    readonly displayUnit: "raw" | "mV";
    /** Sensor calibration (not ADC counts). Null = incomplete. */
    readonly calibMinMv: number | null;
    readonly calibMaxMv: number | null;
  };
  /** Display control pins (category=display); independent of bus choice. */
  readonly displayPins?: {
    readonly dcLabel: string;
    readonly resetLabel: string;
    readonly csLabel: string;
  };
  readonly w1?: {
    /** Stable bus id from pin configurator (e.g. w1-0). */
    readonly busId: string;
    readonly busName: string;
    /** Summary only — pin is owned by the configurator. */
    readonly dqPinLabel: string;
    /** 8-byte ROM formatted; empty = unset (draft ok). */
    readonly rom: string;
    readonly powerMode: "external" | "parasitic";
    readonly externalPullupRequired: true;
    /** DS18B20 resolution bits when using convert wait (9–12). */
    readonly resolutionBits?: 9 | 10 | 11 | 12;
  };
  readonly gpioSignals: readonly GpioSignalDef[];
  readonly auxGpio: readonly GpioSignalDef[];
};

export type DeviceRecipeVerification = {
  readonly status: "untested" | "unavailable" | "simulated" | "passed" | "failed";
  readonly note: string;
  readonly lastTriedAt?: number;
};

export type DeviceRecipeDraft = {
  readonly schemaVersion: typeof DEVICE_RECIPE_DRAFT_VERSION;
  readonly id: string;
  readonly name: string;
  readonly status: "draft" | "ready";
  readonly category: DeviceRecipeCategory;
  readonly sampleIntervalMs: number;
  /**
   * External trigger for the Azione phase (sensor recipes).
   * Edge + level match canvas / pin configurator vocabulary.
   */
  readonly actionTrigger: DeviceActionTrigger;
  readonly binding: DeviceRecipeBinding;
  readonly channels: readonly SensorChannel[];
  /** Named slots shared across phases; filled by Campiona (sample_external) or defaults. */
  readonly variables: readonly RecipeVariable[];
  /** Typed commands (display / actuators). Source of truth for command UI + Flow preview. */
  readonly commands: readonly DeviceRecipeCommand[];
  readonly display?: DisplayProfile;
  readonly phases: {
    readonly init: readonly DeviceRecipeOp[];
    readonly sample: readonly DeviceRecipeOp[];
    readonly command: readonly DeviceRecipeOp[];
  };
  readonly verification: DeviceRecipeVerification;
  readonly updatedAt: number;
  /** Ops not executable on current firmware — listed for honesty. */
  readonly runtimeUnavailable: readonly string[];
};

export function describeDeviceOp(op: DeviceRecipeOp): string {
  switch (op.type) {
    case "wait":
      return `Attendi ${op.ms} ms`;
    case "i2c_write":
      return op.reg ? `I2C scrivi reg ${op.reg}` : `I2C scrivi ${op.bytes.join(" ")}`;
    case "i2c_read":
      return op.reg ? `I2C leggi reg ${op.reg} (${op.len}B)` : `I2C leggi ${op.len}B`;
    case "i2c_write_read":
      return `I2C scrivi+leggi ${op.readLen}B${op.repeatedStart ? " · RESTART" : ""}`;
    case "spi_cs":
      return op.assert ? "CS basso" : "CS alto";
    case "spi_transfer":
      return `Trasferisci ${Math.max(op.txBytes.length, op.rxLen)} byte`;
    case "gpio_read":
      return `Leggi ${op.signalId}`;
    case "gpio_write":
      return `Imposta ${op.signalId}=${op.level}`;
    case "gpio_debounce":
      return `Antirimbalzo ${op.stableMs} ms`;
    case "decode":
      return `Decodifica ${op.input} → $${op.into}`;
    case "encode":
      return `Codifica ${op.input} (${op.fromType}→${op.toType}) → $${op.into}`;
    case "adc_sample":
      return `Campiona ADC (${op.format})`;
    case "adc_multi_sample":
      return `Acquisisci ${op.count} campioni`;
    case "sample_external":
      return `Campiona ${op.fromChannelId} → $${op.into}`;
    case "average":
      return `Media ${op.input}`;
    case "filter":
      return `Filtra ${op.kind} (${op.window})`;
    case "map_range":
      return `Mappa intervallo → ${op.into}`;
    case "emit":
      return `Emetti ${op.channelId}`;
    case "validate_params":
      return `Valida ${op.paramNames.join(", ")}`;
    case "buffer_draw_text":
      return "Disegna nel buffer";
    case "buffer_clear":
      return "Pulisci buffer";
    case "display_flush":
      return "Aggiorna display";
    case "display_power":
      return op.on ? "Accendi" : "Spegni";
    case "ctrl_pin":
      return `${op.pin}: ${op.level === 0 ? "basso" : "alto"}`;
    case "spi_transfer_buffer":
      return "Trasferisci buffer SPI";
    case "w1_reset":
      return "Reset / presenza";
    case "w1_match_rom":
      return op.rom ? `Seleziona ROM` : "Seleziona ROM (binding)";
    case "w1_write":
      return `Scrivi ${op.bytes.join(" ")}`;
    case "w1_read":
      return `Leggi ${op.len}B → ${op.into}`;
    case "w1_wait_convert":
      return `Attendi conversione (${op.timeoutMs} ms)`;
    case "w1_crc":
      return `Verifica CRC ${op.input}`;
    default:
      return "Passo";
  }
}

/** Adjacent-sample gap → total span first to last. */
export function multiSampleSpanMs(count: number, intervalMs: number): number {
  return Math.max(0, count - 1) * intervalMs;
}

export function isAnalogCalibrationComplete(draft: DeviceRecipeDraft): boolean {
  if (draft.binding.bus !== "adc" || !draft.binding.adc) return true;
  const { calibMinMv, calibMaxMv } = draft.binding.adc;
  if (calibMinMv === null || calibMaxMv === null) return false;
  if (!Number.isFinite(calibMinMv) || !Number.isFinite(calibMaxMv)) return false;
  if (calibMinMv === calibMaxMv) return false;
  return true;
}

/**
 * Linear map with inverted range support (inMin > inMax).
 * Coincident endpoints are invalid. Saturation clamps to outMin/outMax when enabled.
 */
export function applyMapRange(
  value: number,
  inMin: number,
  inMax: number,
  outMin: number,
  outMax: number,
  saturate: boolean,
): number | null {
  if (!Number.isFinite(value) || !Number.isFinite(inMin) || !Number.isFinite(inMax)) return null;
  if (inMin === inMax) return null;
  const t = (value - inMin) / (inMax - inMin);
  let out = outMin + t * (outMax - outMin);
  if (saturate) {
    const lo = Math.min(outMin, outMax);
    const hi = Math.max(outMin, outMax);
    out = Math.min(hi, Math.max(lo, out));
  }
  return out;
}

export function createBlankDraft(mode: DeviceRecipeMode, name?: string): DeviceRecipeDraft {
  if (mode === "display") return createGraphicDisplayExample(name);
  if (mode === "i2c") return createI2cGenericExample(name);
  if (mode === "spi") return createSpiPressureExample(name);
  if (mode === "adc") return createAnalogLevelExample(name);
  if (mode === "w1") return createDs18b20Example(name);
  return createGpioDigitalExample(name);
}

function sensorDraftBase(_name: string): Pick<DeviceRecipeDraft, "category" | "commands" | "display"> {
  return { category: "sensor", commands: [], display: undefined };
}

/** Generic I2C skeleton — no assumed quantity (temperature, etc.). Outputs come from Emetti. */
export function createI2cGenericExample(name = "Sensore I2C"): DeviceRecipeDraft {
  const rawInto = "raw";
  return {
    schemaVersion: DEVICE_RECIPE_DRAFT_VERSION,
    id: newId("dr"),
    name,
    status: "draft",
    ...sensorDraftBase(name),
    sampleIntervalMs: 1000,
    actionTrigger: DEFAULT_ACTION_TRIGGER,
    variables: [],
    binding: {
      bus: "i2c",
      i2c: {
        address: "0x48",
        busUnit: "I2C0",
        sdaLabel: "A0",
        sclLabel: "A1",
      },
      gpioSignals: [],
      auxGpio: [],
    },
    channels: [{ id: "out_0", label: "Uscita", unit: "", quantity: "other", direction: "read" }],
    phases: {
      init: [],
      sample: [
        {
          id: newId("op"),
          type: "i2c_write_read",
          reg: "0x00",
          writeBytes: [],
          readLen: 2,
          into: rawInto,
          repeatedStart: true,
          timeoutMs: 20,
        },
        { id: newId("op"), type: "emit", channelId: "out_0", from: rawInto },
      ],
      command: [],
    },
    verification: { status: "untested", note: "Da provare sul dispositivo" },
    updatedAt: Date.now(),
    runtimeUnavailable: ["i2c_write_read", "try_read_on_device"],
  };
}

/** @deprecated Use createI2cGenericExample — kept for older tests/imports. */
export function createI2cTemperatureExample(name = "Sensore I2C"): DeviceRecipeDraft {
  return createI2cGenericExample(name);
}

export type RecipeBlockPort = {
  readonly id: string;
  readonly label: string;
  readonly direction: "in" | "out";
  readonly valueType: string;
  readonly unit?: string;
};

/** Ports the Flow block will expose — inputs from Campiona, outputs from Emetti. */
export function recipeBlockPorts(draft: DeviceRecipeDraft): {
  readonly inputs: readonly RecipeBlockPort[];
  readonly outputs: readonly RecipeBlockPort[];
} {
  const inputs: RecipeBlockPort[] = [];
  const seenIn = new Set<string>();
  for (const phase of ["init", "sample", "command"] as const) {
    for (const op of draft.phases[phase]) {
      if (op.type !== "sample_external") continue;
      if (seenIn.has(op.fromChannelId)) continue;
      seenIn.add(op.fromChannelId);
      const ch = draft.channels.find((c) => c.id === op.fromChannelId);
      inputs.push({
        id: op.fromChannelId,
        label: ch?.label ?? op.fromChannelId,
        direction: "in",
        valueType: op.valueType,
        unit: ch?.unit,
      });
    }
  }
  for (const ch of draft.channels.filter((c) => c.direction === "write")) {
    if (seenIn.has(ch.id)) continue;
    seenIn.add(ch.id);
    inputs.push({
      id: ch.id,
      label: ch.label,
      direction: "in",
      valueType: ch.quantity === "digital" ? "bool" : ch.quantity === "other" ? "number" : ch.quantity,
      unit: ch.unit,
    });
  }

  const outputs: RecipeBlockPort[] = [];
  const seenOut = new Set<string>();
  for (const phase of ["init", "sample", "command"] as const) {
    for (const op of draft.phases[phase]) {
      if (op.type !== "emit") continue;
      if (seenOut.has(op.channelId)) continue;
      seenOut.add(op.channelId);
      const ch = draft.channels.find((c) => c.id === op.channelId);
      outputs.push({
        id: op.channelId,
        label: ch?.label ?? op.channelId,
        direction: "out",
        valueType: ch?.quantity ?? "other",
        unit: ch?.unit,
      });
    }
  }
  return { inputs, outputs };
}

export function createSpiPressureExample(name = "Sensore SPI"): DeviceRecipeDraft {
  return {
    schemaVersion: DEVICE_RECIPE_DRAFT_VERSION,
    id: newId("dr"),
    name,
    status: "draft",
    ...sensorDraftBase(name),
    sampleIntervalMs: 100,
    actionTrigger: DEFAULT_ACTION_TRIGGER,
    variables: [],
    binding: {
      bus: "spi",
      spi: {
        mode: 0,
        freqHz: 1_000_000,
        bitOrder: "msb",
        sckLabel: "A0",
        mosiLabel: "A1",
        misoLabel: "A2",
        csLabel: "A3",
        misoRequired: true,
      },
      gpioSignals: [],
      auxGpio: [],
    },
    channels: [{ id: "press_kpa", label: "Pressione", unit: "kPa", quantity: "pressure", direction: "read" }],
    phases: {
      init: [],
      sample: [
        { id: newId("op"), type: "spi_cs", assert: true },
        {
          id: newId("op"),
          type: "spi_transfer",
          txBytes: ["0x80", "0x00", "0x00"],
          rxLen: 3,
          into: "rx",
          keepCs: true,
          timeoutMs: 20,
        },
        { id: newId("op"), type: "spi_cs", assert: false },
        {
          id: newId("op"),
          type: "decode",
          input: "rx",
          into: "press_scaled",
          byteOrder: "be",
          signed: false,
          startByte: 1,
          endByte: 2,
          divide: 10,
        },
        { id: newId("op"), type: "emit", channelId: "press_kpa", from: "press_scaled" },
      ],
      command: [],
    },
    verification: { status: "untested", note: "Da provare sul dispositivo" },
    updatedAt: Date.now(),
    runtimeUnavailable: ["spi_transfer", "spi_cs", "try_read_on_device"],
  };
}

export function createAnalogLevelExample(name = "Sensore analogico"): DeviceRecipeDraft {
  return {
    schemaVersion: DEVICE_RECIPE_DRAFT_VERSION,
    id: newId("dr"),
    name,
    status: "draft",
    ...sensorDraftBase(name),
    sampleIntervalMs: 100,
    actionTrigger: DEFAULT_ACTION_TRIGGER,
    variables: [],
    binding: {
      bus: "adc",
      adc: {
        signalName: "SIGNAL",
        pinLabel: "A0",
        supportsMv: true,
        displayUnit: "mV",
        calibMinMv: null,
        calibMaxMv: null,
      },
      gpioSignals: [],
      auxGpio: [],
    },
    channels: [{ id: "level", label: "Livello", unit: "%", quantity: "analog", direction: "read" }],
    phases: {
      init: [],
      sample: [
        {
          id: newId("op"),
          type: "adc_multi_sample",
          count: 8,
          intervalMs: 1,
          into: "samples",
          format: "mV",
          timeoutMs: 50,
        },
        { id: newId("op"), type: "average", input: "samples", into: "media_mV" },
        {
          id: newId("op"),
          type: "map_range",
          input: "media_mV",
          into: "level_pct",
          inMin: null,
          inMax: null,
          outMin: 0,
          outMax: 100,
          saturate: true,
        },
        { id: newId("op"), type: "emit", channelId: "level", from: "level_pct" },
      ],
      command: [],
    },
    verification: { status: "untested", note: "Da provare sul dispositivo" },
    updatedAt: Date.now(),
    runtimeUnavailable: ["adc_multi_sample_precise", "try_read_on_device"],
  };
}

export function createGpioDigitalExample(name = "Dispositivo GPIO"): DeviceRecipeDraft {
  const signals: readonly GpioSignalDef[] = [
    { id: "IN_A", name: "IN_A", role: "generico", direction: "in", pinLabel: "A0", pull: "up", activeLow: true },
    { id: "IN_B", name: "IN_B", role: "generico", direction: "in", pinLabel: "A1", pull: "none", activeLow: false },
    { id: "OUT_A", name: "OUT_A", role: "generico", direction: "out", pinLabel: "A2", pull: "none", activeLow: false },
  ];
  return {
    schemaVersion: DEVICE_RECIPE_DRAFT_VERSION,
    id: newId("dr"),
    name,
    status: "draft",
    ...sensorDraftBase(name),
    sampleIntervalMs: 5,
    actionTrigger: DEFAULT_ACTION_TRIGGER,
    variables: [],
    binding: {
      bus: "gpio",
      gpioSignals: signals,
      auxGpio: [],
    },
    channels: [{ id: "state", label: "Stato", unit: "on/off", quantity: "digital", direction: "read" }],
    phases: {
      init: [],
      sample: [
        { id: newId("op"), type: "gpio_read", signalId: "IN_A", into: "livello" },
        {
          id: newId("op"),
          type: "gpio_debounce",
          signalId: "IN_A",
          sampleMs: 5,
          stableMs: 20,
          into: "livello",
        },
        { id: newId("op"), type: "emit", channelId: "state", from: "livello" },
      ],
      command: [],
    },
    verification: { status: "untested", note: "Da provare sul dispositivo" },
    updatedAt: Date.now(),
    runtimeUnavailable: ["gpio_debounce_events", "try_read_on_device"],
  };
}

/**
 * DS18B20 (external power) — datasheet timings/commands.
 * Convert T max 750 ms @ 12-bit; scratchpad 9 bytes; CRC over first 8.
 * Search ROM is a hardware action, not part of the periodic sample sequence.
 */
export function createDs18b20Example(name = "Sensore 1-Wire"): DeviceRecipeDraft {
  const exampleRom = "28 FF 01 02 03 04 05 62";
  return {
    schemaVersion: DEVICE_RECIPE_DRAFT_VERSION,
    id: newId("dr"),
    name,
    status: "draft",
    ...sensorDraftBase(name),
    sampleIntervalMs: 1000,
    actionTrigger: DEFAULT_ACTION_TRIGGER,
    variables: [],
    binding: {
      bus: "w1",
      w1: {
        busId: "w1-0",
        busName: "1-Wire 0",
        dqPinLabel: "DQ (configuratore)",
        rom: exampleRom,
        powerMode: "external",
        externalPullupRequired: true,
        resolutionBits: 12,
      },
      gpioSignals: [],
      auxGpio: [],
    },
    channels: [{ id: "temp_c", label: "Temperatura", unit: "°C", quantity: "temperature", direction: "read" }],
    phases: {
      init: [],
      sample: [
        { id: newId("op"), type: "w1_reset", intoPresence: "presence", timeoutMs: 5 },
        { id: newId("op"), type: "w1_match_rom", rom: "", timeoutMs: 20 },
        { id: newId("op"), type: "w1_write", bytes: [DS18B20_CMD.convertT], timeoutMs: 20 },
        {
          id: newId("op"),
          type: "w1_wait_convert",
          strategy: "fixed_max",
          timeoutMs: DS18B20_CMD.convertMaxMs12bit,
        },
        { id: newId("op"), type: "w1_reset", intoPresence: "presence", timeoutMs: 5 },
        { id: newId("op"), type: "w1_match_rom", rom: "", timeoutMs: 20 },
        { id: newId("op"), type: "w1_write", bytes: [DS18B20_CMD.readScratchpad], timeoutMs: 20 },
        { id: newId("op"), type: "w1_read", len: 9, into: "scratch", timeoutMs: 50 },
        { id: newId("op"), type: "w1_crc", input: "scratch", len: 9, intoOk: "crc_ok" },
        {
          id: newId("op"),
          type: "decode",
          input: "scratch",
          into: "temp_c",
          byteOrder: "le",
          signed: true,
          startByte: 0,
          endByte: 1,
          multiply: 625,
          divide: 10000,
        },
        { id: newId("op"), type: "emit", channelId: "temp_c", from: "temp_c" },
      ],
      command: [],
    },
    verification: { status: "untested", note: "Da provare sul dispositivo" },
    updatedAt: Date.now(),
    runtimeUnavailable: [
      "w1_reset",
      "w1_match_rom",
      "w1_write",
      "w1_read",
      "w1_crc",
      "w1_search_rom",
      "w1_parasite_power",
      "try_read_on_device",
    ],
  };
}

/** Graphic framebuffer display — category≠bus; exposes commands, not sensor channels. */
export function createGraphicDisplayExample(name = "Display grafico"): DeviceRecipeDraft {
  const writeText: DeviceRecipeCommand = {
    id: newId("cmd"),
    name: "scrivi_testo",
    label: "Scrivi testo",
    description: "Disegna un testo sul display grafico",
    updateMode: "auto",
    errorPolicy: "clamp",
    params: [
      { id: "p_text", name: "testo", type: "string", defaultValue: "Ciao!", required: true },
      { id: "p_x", name: "x", type: "int", defaultValue: 0, min: 0, max: 127, required: true },
      { id: "p_y", name: "y", type: "int", defaultValue: 0, min: 0, max: 63, required: true },
    ],
    steps: [
      { id: newId("op"), type: "validate_params", paramNames: ["testo", "x", "y"] },
      {
        id: newId("op"),
        type: "buffer_draw_text",
        textParam: "testo",
        xParam: "x",
        yParam: "y",
        fontId: "default_5x7",
      },
      { id: newId("op"), type: "ctrl_pin", pin: "DC", level: 1 },
      { id: newId("op"), type: "ctrl_pin", pin: "CS", level: 0 },
      { id: newId("op"), type: "spi_transfer_buffer", timeoutMs: 50 },
      { id: newId("op"), type: "ctrl_pin", pin: "CS", level: 1 },
      { id: newId("op"), type: "display_flush", timeoutMs: 50 },
    ],
  };
  const clearCmd: DeviceRecipeCommand = {
    id: newId("cmd"),
    name: "pulisci",
    label: "Pulisci",
    description: "Svuota il buffer e aggiorna il display",
    updateMode: "auto",
    params: [],
    steps: [
      { id: newId("op"), type: "buffer_clear" },
      { id: newId("op"), type: "display_flush", timeoutMs: 50 },
    ],
  };
  const refreshCmd: DeviceRecipeCommand = {
    id: newId("cmd"),
    name: "aggiorna",
    label: "Aggiorna",
    description: "Invia il buffer al display (modalità esplicita)",
    updateMode: "explicit",
    params: [],
    steps: [{ id: newId("op"), type: "display_flush", timeoutMs: 50 }],
  };
  const powerCmd: DeviceRecipeCommand = {
    id: newId("cmd"),
    name: "accendi_spegni",
    label: "Accendi / Spegni",
    description: "Alimentazione pannello",
    params: [{ id: "p_on", name: "acceso", type: "bool", defaultValue: true }],
    steps: [{ id: newId("op"), type: "display_power", on: true }],
  };

  return {
    schemaVersion: DEVICE_RECIPE_DRAFT_VERSION,
    id: newId("dr"),
    name,
    status: "draft",
    category: "display",
    sampleIntervalMs: 0,
    actionTrigger: DEFAULT_ACTION_TRIGGER,
    variables: [],
    binding: {
      bus: "spi",
      spi: {
        mode: 0,
        freqHz: 8_000_000,
        bitOrder: "msb",
        sckLabel: "GPIO18",
        mosiLabel: "GPIO23",
        misoLabel: "",
        csLabel: "GPIO5",
        misoRequired: false,
      },
      displayPins: { dcLabel: "GPIO15", resetLabel: "GPIO17", csLabel: "GPIO5" },
      gpioSignals: [],
      auxGpio: [
        { id: "DC", name: "DC", role: "display_dc", direction: "out", pinLabel: "A0", pull: "none", activeLow: false },
        { id: "RESET", name: "RESET", role: "display_reset", direction: "out", pinLabel: "A1", pull: "none", activeLow: true },
      ],
    },
    channels: [],
    commands: [writeText, clearCmd, refreshCmd, powerCmd].map((c) => ({
      ...c,
      trigger: c.trigger ?? DEFAULT_ACTION_TRIGGER,
    })),
    display: {
      controllerProfile: "graphic_framebuffer",
      widthPx: 128,
      heightPx: 64,
      pixelFormat: "1bpp",
      fontId: "default_5x7",
      encoding: "utf8",
      clipPolicy: "clip",
      updateModeDefault: "auto",
    },
    phases: {
      init: [
        { id: newId("op"), type: "ctrl_pin", pin: "RESET", level: 0 },
        { id: newId("op"), type: "wait", ms: 10 },
        { id: newId("op"), type: "ctrl_pin", pin: "RESET", level: 1 },
        { id: newId("op"), type: "display_power", on: true },
      ],
      sample: [],
      command: writeText.steps,
    },
    verification: { status: "untested", note: "Da provare sul dispositivo" },
    updatedAt: Date.now(),
    runtimeUnavailable: [
      "display_framebuffer",
      "spi_transfer_buffer",
      "buffer_draw_text",
      "try_command_on_device",
    ],
  };
}

export function libraryOpsForBus(bus: DeviceRecipeBus): readonly { readonly type: DeviceRecipeOp["type"]; readonly label: string }[] {
  const sampleExternal = { type: "sample_external" as const, label: "Campiona" };
  switch (bus) {
    case "i2c":
      return [
        sampleExternal,
        { type: "i2c_write", label: "Scrivi" },
        { type: "i2c_read", label: "Leggi" },
        { type: "i2c_write_read", label: "Scrivi e leggi" },
        { type: "wait", label: "Attendi" },
        { type: "encode", label: "Codifica" },
        { type: "decode", label: "Decodifica" },
        { type: "emit", label: "Emetti" },
      ];
    case "spi":
      return [
        sampleExternal,
        { type: "spi_cs", label: "Seleziona CS" },
        { type: "spi_transfer", label: "Trasferisci" },
        { type: "wait", label: "Attendi" },
        { type: "encode", label: "Codifica" },
        { type: "decode", label: "Decodifica" },
        { type: "emit", label: "Emetti" },
      ];
    case "gpio":
      return [
        sampleExternal,
        { type: "gpio_read", label: "Leggi livello" },
        { type: "gpio_write", label: "Imposta livello" },
        { type: "gpio_debounce", label: "Antirimbalzo" },
        { type: "wait", label: "Attendi" },
        { type: "encode", label: "Codifica" },
        { type: "decode", label: "Decodifica" },
        { type: "emit", label: "Emetti" },
      ];
    case "adc":
      return [
        sampleExternal,
        { type: "adc_sample", label: "Campiona ADC" },
        { type: "adc_multi_sample", label: "Campiona più volte" },
        { type: "average", label: "Media" },
        { type: "filter", label: "Filtra" },
        { type: "map_range", label: "Mappa intervallo" },
        { type: "encode", label: "Codifica" },
        { type: "decode", label: "Decodifica" },
        { type: "emit", label: "Emetti" },
        { type: "wait", label: "Attendi" },
      ];
    case "w1":
      return [
        sampleExternal,
        { type: "w1_reset", label: "Reset / presenza" },
        { type: "w1_match_rom", label: "Seleziona ROM" },
        { type: "w1_write", label: "Scrivi byte" },
        { type: "w1_read", label: "Leggi byte" },
        { type: "w1_wait_convert", label: "Attendi completamento" },
        { type: "w1_crc", label: "Verifica CRC" },
        { type: "encode", label: "Codifica" },
        { type: "decode", label: "Decodifica" },
        { type: "emit", label: "Emetti" },
        { type: "wait", label: "Attendi" },
      ];
  }
}

/** Display command implementation library (grouped in UI as Bus / GPIO / Buffer / Dati). */
export function libraryOpsForDisplay(): readonly {
  readonly type: DeviceRecipeOp["type"];
  readonly label: string;
  readonly group: "bus" | "gpio" | "buffer" | "data";
}[] {
  return [
    { type: "spi_cs", label: "CS", group: "bus" },
    { type: "spi_transfer", label: "Trasferisci SPI", group: "bus" },
    { type: "spi_transfer_buffer", label: "Trasferisci buffer", group: "bus" },
    { type: "i2c_write", label: "I2C scrivi", group: "bus" },
    { type: "ctrl_pin", label: "Pin DC/CS/RESET", group: "gpio" },
    { type: "gpio_write", label: "GPIO scrive", group: "gpio" },
    { type: "buffer_draw_text", label: "Disegna testo", group: "buffer" },
    { type: "buffer_clear", label: "Pulisci buffer", group: "buffer" },
    { type: "display_flush", label: "Aggiorna display", group: "buffer" },
    { type: "display_power", label: "Accendi/Spegni", group: "buffer" },
    { type: "validate_params", label: "Valida parametri", group: "data" },
    { type: "wait", label: "Attendi", group: "data" },
  ];
}

export function defaultOp(type: DeviceRecipeOp["type"], draft: DeviceRecipeDraft): DeviceRecipeOp {
  const id = newId("op");
  const addrSignal = draft.binding.gpioSignals[0]?.id ?? "IN_A";
  const channelId = draft.channels[0]?.id ?? "value";
  switch (type) {
    case "wait":
      return { id, type: "wait", ms: 10 };
    case "i2c_write":
      return { id, type: "i2c_write", reg: "0x00", bytes: ["0x00"], timeoutMs: 20 };
    case "i2c_read":
      return { id, type: "i2c_read", reg: "0x00", len: 2, into: "raw", timeoutMs: 20 };
    case "i2c_write_read":
      return {
        id,
        type: "i2c_write_read",
        reg: "0x00",
        writeBytes: [],
        readLen: 2,
        into: "raw",
        repeatedStart: true,
        timeoutMs: 20,
      };
    case "spi_cs":
      return { id, type: "spi_cs", assert: true };
    case "spi_transfer":
      return { id, type: "spi_transfer", txBytes: ["0x00"], rxLen: 1, into: "rx", keepCs: true, timeoutMs: 20 };
    case "gpio_read":
      return { id, type: "gpio_read", signalId: addrSignal, into: "livello" };
    case "gpio_write":
      return { id, type: "gpio_write", signalId: draft.binding.gpioSignals.find((s) => s.direction !== "in")?.id ?? "OUT_A", level: 1 };
    case "gpio_debounce":
      return { id, type: "gpio_debounce", signalId: addrSignal, sampleMs: 5, stableMs: 20, into: "livello" };
    case "decode":
      return {
        id,
        type: "decode",
        input: "raw",
        into: "scaled",
        byteOrder: "be",
        signed: false,
        startByte: 0,
        endByte: 1,
        outType: "number",
        divide: 1,
      };
    case "encode":
      return {
        id,
        type: "encode",
        input: draft.variables[0]?.name ?? "ingresso",
        into: "encoded",
        fromType: draft.variables[0]?.valueType ?? "number",
        toType: "hex",
        byteOrder: "be",
        widthBytes: 2,
        multiply: 1,
      };
    case "adc_sample":
      return {
        id,
        type: "adc_sample",
        into: "sample",
        format: draft.binding.adc?.supportsMv ? "mV" : "raw",
        timeoutMs: 20,
      };
    case "adc_multi_sample":
      return {
        id,
        type: "adc_multi_sample",
        count: 8,
        intervalMs: 1,
        into: "samples",
        format: draft.binding.adc?.supportsMv ? "mV" : "raw",
        timeoutMs: 50,
      };
    case "average":
      return { id, type: "average", input: "samples", into: "media_mV" };
    case "filter":
      return { id, type: "filter", input: "samples", into: "filtered", kind: "moving_avg", window: 3 };
    case "map_range":
      return {
        id,
        type: "map_range",
        input: "media_mV",
        into: "level_pct",
        inMin: draft.binding.adc?.calibMinMv ?? null,
        inMax: draft.binding.adc?.calibMaxMv ?? null,
        outMin: 0,
        outMax: 100,
        saturate: true,
      };
    case "emit":
      return { id, type: "emit", channelId, from: draft.binding.bus === "adc" ? "level_pct" : "scaled" };
    case "sample_external": {
      const writeCh = draft.channels.find((c) => c.direction === "write");
      const into = draft.variables[0]?.name ?? "ingresso";
      return {
        id,
        type: "sample_external",
        fromChannelId: writeCh?.id ?? "ingresso",
        into,
        valueType: draft.variables[0]?.valueType ?? "hex",
      };
    }
    case "validate_params":
      return { id, type: "validate_params", paramNames: ["testo", "x", "y"] };
    case "buffer_draw_text":
      return {
        id,
        type: "buffer_draw_text",
        textParam: "testo",
        xParam: "x",
        yParam: "y",
        fontId: draft.display?.fontId ?? "default_5x7",
      };
    case "buffer_clear":
      return { id, type: "buffer_clear" };
    case "display_flush":
      return { id, type: "display_flush", timeoutMs: 50 };
    case "display_power":
      return { id, type: "display_power", on: true };
    case "ctrl_pin":
      return { id, type: "ctrl_pin", pin: "DC", level: 1 };
    case "spi_transfer_buffer":
      return { id, type: "spi_transfer_buffer", timeoutMs: 50 };
    case "w1_reset":
      return { id, type: "w1_reset", intoPresence: "presence", timeoutMs: 5 };
    case "w1_match_rom":
      return { id, type: "w1_match_rom", rom: draft.binding.w1?.rom ?? "", timeoutMs: 20 };
    case "w1_write":
      return { id, type: "w1_write", bytes: [DS18B20_CMD.convertT], timeoutMs: 20 };
    case "w1_read":
      return { id, type: "w1_read", len: 9, into: "scratch", timeoutMs: 50 };
    case "w1_wait_convert":
      return {
        id,
        type: "w1_wait_convert",
        strategy: "fixed_max",
        timeoutMs: DS18B20_CMD.convertMaxMs12bit,
      };
    case "w1_crc":
      return { id, type: "w1_crc", input: "scratch", len: 9, intoOk: "crc_ok" };
  }
}

export function updateCommand(
  draft: DeviceRecipeDraft,
  commandId: string,
  next: DeviceRecipeCommand,
): DeviceRecipeDraft {
  const commands = draft.commands.map((c) => (c.id === commandId ? next : c));
  return touch({ ...draft, commands });
}

export function addCommand(draft: DeviceRecipeDraft, seed?: Partial<DeviceRecipeCommand>): DeviceRecipeDraft {
  const cmd: DeviceRecipeCommand = {
    id: newId("cmd"),
    name: seed?.name ?? `comando_${draft.commands.length + 1}`,
    label: seed?.label ?? "Nuova azione",
    description: seed?.description ?? "",
    params: seed?.params ?? [],
    steps: seed?.steps ?? [{ id: newId("op"), type: "wait", ms: 1 }],
    trigger: normalizeActionTrigger(seed?.trigger),
    updateMode: seed?.updateMode ?? draft.display?.updateModeDefault ?? "auto",
    errorPolicy: seed?.errorPolicy ?? "abort",
  };
  return touch({ ...draft, commands: [...draft.commands, cmd] });
}

export function removeCommand(draft: DeviceRecipeDraft, commandId: string): DeviceRecipeDraft {
  return touch({ ...draft, commands: draft.commands.filter((c) => c.id !== commandId) });
}

export function updateCommandStep(
  draft: DeviceRecipeDraft,
  commandId: string,
  stepId: string,
  next: DeviceRecipeOp,
): DeviceRecipeDraft {
  const commands = draft.commands.map((c) =>
    c.id === commandId ? { ...c, steps: c.steps.map((s) => (s.id === stepId ? next : s)) } : c,
  );
  return touch({ ...draft, commands });
}

export function insertCommandStep(
  draft: DeviceRecipeDraft,
  commandId: string,
  type: DeviceRecipeOp["type"],
): DeviceRecipeDraft {
  const op = defaultOp(type, draft);
  const commands = draft.commands.map((c) => (c.id === commandId ? { ...c, steps: [...c.steps, op] } : c));
  return touch({ ...draft, commands });
}

export function removeCommandStep(draft: DeviceRecipeDraft, commandId: string, stepId: string): DeviceRecipeDraft {
  const commands = draft.commands.map((c) =>
    c.id === commandId ? { ...c, steps: c.steps.filter((s) => s.id !== stepId) } : c,
  );
  return touch({ ...draft, commands });
}

export function moveCommandStep(
  draft: DeviceRecipeDraft,
  commandId: string,
  stepId: string,
  dir: -1 | 1,
): DeviceRecipeDraft {
  const commands = draft.commands.map((c) => {
    if (c.id !== commandId) return c;
    const list = [...c.steps];
    const from = list.findIndex((s) => s.id === stepId);
    const to = from + dir;
    if (from < 0 || to < 0 || to >= list.length) return c;
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item!);
    return { ...c, steps: list };
  });
  return touch({ ...draft, commands });
}

export function upsertRecipeVariable(
  draft: DeviceRecipeDraft,
  patch: Partial<RecipeVariable> & { readonly name: string },
): DeviceRecipeDraft {
  const next = normalizeRecipeVariable(patch);
  const existingIdx = draft.variables.findIndex((v) => v.name === next.name || v.id === patch.id);
  const variables =
    existingIdx >= 0
      ? draft.variables.map((v, i) => (i === existingIdx ? { ...next, id: draft.variables[i]!.id } : v))
      : [...draft.variables, next];
  return touch({ ...draft, variables });
}

export function removeRecipeVariable(draft: DeviceRecipeDraft, varId: string): DeviceRecipeDraft {
  return touch({ ...draft, variables: draft.variables.filter((v) => v.id !== varId) });
}

export function ensureWriteChannel(
  draft: DeviceRecipeDraft,
  seed?: { readonly id?: string; readonly label?: string; readonly unit?: string },
): { readonly draft: DeviceRecipeDraft; readonly channelId: string } {
  const existing = draft.channels.find((c) => c.direction === "write" && (!seed?.id || c.id === seed.id));
  if (existing) return { draft, channelId: existing.id };
  const id = normalizeRecipeVarName(seed?.id ?? seed?.label ?? `ingresso_${draft.channels.filter((c) => c.direction === "write").length + 1}`);
  const channel: SensorChannel = {
    id,
    label: seed?.label ?? id,
    unit: seed?.unit ?? "",
    quantity: "other",
    direction: "write",
  };
  return { draft: touch({ ...draft, channels: [...draft.channels, channel] }), channelId: id };
}

export function writeChannelsOf(draft: DeviceRecipeDraft): readonly SensorChannel[] {
  return draft.channels.filter((c) => c.direction === "write");
}

/** Collect `$name` refs from ops that support variable substitution. */
export function collectVarRefsFromOp(op: DeviceRecipeOp): readonly string[] {
  const refs: string[] = [];
  const push = (v?: string) => {
    const n = parseVarRef(v);
    if (n) refs.push(n);
  };
  switch (op.type) {
    case "i2c_write":
      push(op.reg);
      for (const b of op.bytes) push(b);
      break;
    case "i2c_read":
      push(op.reg);
      break;
    case "i2c_write_read":
      push(op.reg);
      for (const b of op.writeBytes) push(b);
      break;
    case "sample_external":
      refs.push(op.into);
      break;
    case "decode":
      // `into` is always a recipe variable; `input` may be a raw buffer name.
      refs.push(op.into);
      push(op.input);
      break;
    case "encode":
      refs.push(op.into);
      if (op.input.trim()) refs.push(normalizeRecipeVarName(op.input.replace(/^\$+/, "")));
      break;
    default:
      break;
  }
  return refs;
}

export function collectAllVarRefs(draft: DeviceRecipeDraft): readonly string[] {
  const names = new Set<string>();
  for (const phase of ["init", "sample", "command"] as const) {
    for (const op of draft.phases[phase]) {
      for (const n of collectVarRefsFromOp(op)) names.add(n);
    }
  }
  for (const cmd of draft.commands) {
    for (const op of cmd.steps) {
      for (const n of collectVarRefsFromOp(op)) names.add(n);
    }
  }
  return [...names];
}

export function isVariableUsed(draft: DeviceRecipeDraft, name: string): boolean {
  const n = normalizeRecipeVarName(name);
  if (collectAllVarRefs(draft).includes(n)) return true;
  for (const phase of ["init", "sample", "command"] as const) {
    if (
      draft.phases[phase].some(
        (op) =>
          (op.type === "sample_external" || op.type === "decode" || op.type === "encode") && op.into === n,
      )
    ) {
      return true;
    }
  }
  return false;
}

function upsertIntoVariable(
  draft: DeviceRecipeDraft,
  name: string,
  valueType: RecipeVarType,
): DeviceRecipeDraft {
  return upsertRecipeVariable(draft, { name, valueType, label: name });
}

export function insertOp(
  draft: DeviceRecipeDraft,
  phase: DeviceRecipePhase,
  type: DeviceRecipeOp["type"],
  atIndex?: number,
): DeviceRecipeDraft {
  let next = draft;
  let op = defaultOp(type, next);
  if (type === "sample_external" && op.type === "sample_external") {
    const ensured = ensureWriteChannel(next, { id: op.fromChannelId, label: op.fromChannelId });
    next = ensured.draft;
    op = { ...op, fromChannelId: ensured.channelId };
    next = upsertIntoVariable(next, op.into, op.valueType);
  }
  if (type === "decode" && op.type === "decode") {
    next = upsertIntoVariable(next, op.into, op.outType ?? "number");
  }
  if (type === "encode" && op.type === "encode") {
    next = upsertIntoVariable(next, op.into, op.toType);
  }
  const list = [...next.phases[phase]];
  const index = atIndex === undefined ? list.length : Math.max(0, Math.min(atIndex, list.length));
  list.splice(index, 0, op);
  return touch({ ...next, phases: { ...next.phases, [phase]: list } });
}

export function updateOp(
  draft: DeviceRecipeDraft,
  phase: DeviceRecipePhase,
  opId: string,
  next: DeviceRecipeOp,
): DeviceRecipeDraft {
  let base = draft;
  if (next.type === "sample_external") {
    const ensured = ensureWriteChannel(base, { id: next.fromChannelId, label: next.fromChannelId });
    base = ensured.draft;
    next = { ...next, fromChannelId: ensured.channelId };
    base = upsertIntoVariable(base, next.into, next.valueType);
  }
  if (next.type === "decode") {
    base = upsertIntoVariable(base, next.into, next.outType ?? "number");
  }
  if (next.type === "encode") {
    base = upsertIntoVariable(base, next.into, next.toType);
  }
  const list = base.phases[phase].map((op) => (op.id === opId ? next : op));
  return touch({ ...base, phases: { ...base.phases, [phase]: list } });
}

export function removeOp(draft: DeviceRecipeDraft, phase: DeviceRecipePhase, opId: string): DeviceRecipeDraft {
  return touch({
    ...draft,
    phases: { ...draft.phases, [phase]: draft.phases[phase].filter((op) => op.id !== opId) },
  });
}

export function moveOp(
  draft: DeviceRecipeDraft,
  phase: DeviceRecipePhase,
  opId: string,
  dir: -1 | 1,
): DeviceRecipeDraft {
  const list = [...draft.phases[phase]];
  const from = list.findIndex((op) => op.id === opId);
  const to = from + dir;
  if (from < 0 || to < 0 || to >= list.length) return draft;
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item!);
  return touch({ ...draft, phases: { ...draft.phases, [phase]: list } });
}

function touch(draft: DeviceRecipeDraft): DeviceRecipeDraft {
  return { ...draft, updatedAt: Date.now(), status: "draft" };
}

export function validateDraftForCreate(draft: DeviceRecipeDraft): readonly { readonly field: string; readonly message: string }[] {
  const errors: { field: string; message: string }[] = [];
  if (!draft.name.trim()) errors.push({ field: "name", message: "Nome obbligatorio" });

  if (draft.category === "display") {
    if (!draft.display) errors.push({ field: "display", message: "Profilo display mancante" });
    if (draft.commands.length === 0) errors.push({ field: "commands", message: "Serve almeno un comando" });
    if (draft.binding.bus === "spi" && !draft.binding.spi?.sckLabel) {
      errors.push({ field: "sck", message: "SCK mancante" });
    }
    if (draft.binding.bus === "i2c" && !draft.binding.i2c?.address) {
      errors.push({ field: "address", message: "Indirizzo I2C mancante" });
    }
    if (!draft.binding.displayPins?.dcLabel && draft.display?.controllerProfile === "graphic_framebuffer") {
      errors.push({ field: "dc", message: "Pin DC mancante per display grafico" });
    }
    for (const cmd of draft.commands) {
      if (!cmd.name.trim()) errors.push({ field: `cmd.${cmd.id}.name`, message: `Nome comando obbligatorio (${cmd.label})` });
      if (cmd.steps.length === 0) {
        errors.push({ field: `cmd.${cmd.id}.steps`, message: `Sequenza vuota: ${cmd.label}` });
      }
    }
    return errors;
  }

  if (draft.channels.length === 0) errors.push({ field: "channels", message: "Serve almeno un canale" });
  if (draft.phases.sample.length === 0) errors.push({ field: "sample", message: "La sequenza Task è vuota" });
  if (draft.binding.bus === "i2c" && !draft.binding.i2c?.address) {
    errors.push({ field: "address", message: "Indirizzo I2C mancante" });
  }
  if (draft.binding.bus === "spi" && draft.binding.spi?.misoRequired && !draft.binding.spi.misoLabel) {
    errors.push({ field: "miso", message: "MISO richiesto per questa ricetta" });
  }
  if (draft.binding.bus === "adc") {
    if (!draft.binding.adc?.pinLabel) errors.push({ field: "adc_pin", message: "Ingresso ADC mancante" });
    if (!isAnalogCalibrationComplete(draft)) {
      errors.push({
        field: "calibration",
        message: "Calibrazione min/max mancante o non valida (valori coincidenti non ammessi)",
      });
    }
  }
  if (draft.binding.bus === "w1") {
    if (!draft.binding.w1?.busId) errors.push({ field: "w1_bus", message: "Seleziona un bus 1-Wire dal configuratore" });
    const rom = draft.binding.w1?.rom?.trim() ?? "";
    if (!rom) errors.push({ field: "w1_rom", message: "Identificativo ROM obbligatorio per creare il dispositivo" });
    else {
      const check = validateOneWireRom(rom);
      if (!check.ok) errors.push({ field: "w1_rom", message: check.message });
    }
    if (draft.binding.w1?.powerMode === "parasitic") {
      errors.push({
        field: "w1_power",
        message: "Alimentazione parassita non supportata dal runtime attuale",
      });
    }
  }
  const hasEmit = draft.phases.sample.some((op) => op.type === "emit");
  if (!hasEmit) errors.push({ field: "emit", message: "Manca un passo Emetti nel Task" });

  const knownVars = new Set(draft.variables.map((v) => v.name));
  for (const ref of collectAllVarRefs(draft)) {
    if (!knownVars.has(ref)) {
      errors.push({ field: "variables", message: `Variabile sconosciuta: $${ref}` });
    }
  }
  for (const phase of ["init", "sample", "command"] as const) {
    for (const op of draft.phases[phase]) {
      if (op.type !== "sample_external") continue;
      if (!draft.channels.some((c) => c.id === op.fromChannelId && c.direction === "write")) {
        errors.push({
          field: "sample_external",
          message: `Campiona: ingresso Flow mancante (${op.fromChannelId})`,
        });
      }
    }
  }
  return errors;
}

/** Raw acquisition present — try raw allowed even without calibration. */
export function hasValidAnalogAcquisition(draft: DeviceRecipeDraft): boolean {
  return draft.phases.sample.some((op) => op.type === "adc_sample" || op.type === "adc_multi_sample");
}

/** Map draft → SensorRecipe v1 (+ additive commands[]). Lossy for extended ops. */
export function draftToSensorRecipe(draft: DeviceRecipeDraft): SensorRecipe {
  const sensorBus: SensorBus =
    draft.binding.bus === "gpio"
      ? "gpio"
      : draft.binding.bus === "spi"
        ? "spi"
        : draft.binding.bus === "adc"
          ? "adc"
          : draft.binding.bus === "w1"
            ? "w1"
            : "i2c";
  const base = blankSensorRecipe(draft.name, sensorBus);
  const address = draft.binding.bus === "w1" ? draft.binding.w1?.rom : draft.binding.i2c?.address;
  const sample = draft.phases.sample.flatMap((op) => mapOpToV1(op, address));
  const init = draft.phases.init.flatMap((op) => mapOpToV1(op, address));
  const transforms: SensorTransform[] = draft.phases.sample
    .filter((op): op is Extract<DeviceRecipeOp, { type: "decode" }> => op.type === "decode")
    .map((op) => ({
      id: op.id,
      op: op.signed ? (op.byteOrder === "be" ? "s16_be" : "s16_le") : op.byteOrder === "be" ? "u16_be" : "u16_le",
      input: op.input,
      args: { multiply: op.multiply, divide: op.divide, offset: op.offset },
    }));

  const unknown = [...draft.runtimeUnavailable.map((x) => `Runtime non disponibile: ${x}`)];
  if (draft.binding.bus === "adc" && !isAnalogCalibrationComplete(draft)) {
    unknown.push("Canale calibrato non disponibile: calibrazione min/max incompleta");
  }
  if (draft.category === "display") {
    unknown.push("Display: comandi tipizzati in commands[] — non ridotti a canale On/Off");
    unknown.push("Framebuffer / draw_text / flush non eseguiti finché il runtime non li supporta");
  }
  if (draft.binding.bus === "w1") {
    unknown.push("1-Wire: timing bit-bang gestito dal firmware, non dall'UI");
    unknown.push("Ricerca ROM (Search) non disponibile senza adapter runtime");
    if (draft.binding.w1?.powerMode === "parasitic") {
      unknown.push("Parasite power non supportato");
    }
  }
  if (
    draft.variables.length > 0 ||
    draft.phases.init.some((op) => op.type === "sample_external") ||
    draft.phases.sample.some((op) => op.type === "sample_external") ||
    draft.phases.command.some((op) => op.type === "sample_external")
  ) {
    unknown.push("Campiona / variabili ricetta: authoring only finché il runtime non le supporta");
  }

  const commands = draft.commands.map((c) => ({
    id: c.id,
    name: c.name,
    label: c.label,
    params: c.params.map((p) => ({ name: p.name, type: p.type, defaultValue: p.defaultValue })),
    // Only serialize steps that map to v1 primitives; buffer ops stay draft-only.
    steps: c.steps.flatMap((op) => mapOpToV1(op, address)),
  }));

  const channels = draft.category === "display" ? [] : draft.channels;

  const withCh = withChannels(
    {
      ...base,
      id: draft.id,
      chip: draft.name,
      oneLiner:
        draft.category === "display"
          ? `Display ${draft.display?.controllerProfile ?? "?"} · ${draft.binding.bus.toUpperCase()}`
          : `Ricetta ${draft.binding.bus.toUpperCase()} · editor dispositivo`,
      bus: sensorBus,
      address,
      recipe: {
        init,
        sample: draft.category === "display" ? [] : sample,
        write: draft.phases.command.flatMap((op) => mapOpToV1(op, address)),
      },
      transforms: draft.category === "display" ? [] : transforms,
      commands: commands.length ? commands : undefined,
      source: { kind: "manual", label: "Device recipe editor" },
      confidence: draft.category === "display" || (draft.binding.bus === "adc" && !isAnalogCalibrationComplete(draft)) ? "low" : "medium",
      unknown: unknown.length ? unknown : undefined,
      tryNow:
        draft.category === "display"
          ? { outputId: "", hint: "Nessuna misura: solo comandi (prova HW non disponibile)" }
          : base.tryNow,
    },
    channels,
  );
  return { ...withCh, outputs: outputsFromChannels(channels), commands: commands.length ? commands : undefined };
}

function mapOpToV1(op: DeviceRecipeOp, address?: string): SensorRecipeStep[] {
  const addr = address ?? "0x00";
  switch (op.type) {
    case "wait":
      return [{ type: "wait", ms: op.ms }];
    case "i2c_write":
      return [{ type: "i2c_write", addr, reg: op.reg, bytes: op.bytes }];
    case "i2c_read":
      return [{ type: "i2c_read", addr, reg: op.reg, len: op.len, into: op.into }];
    case "i2c_write_read":
      return [
        ...(op.reg || op.writeBytes.length
          ? [{ type: "i2c_write" as const, addr, reg: op.reg, bytes: op.writeBytes.length ? op.writeBytes : op.reg ? [] : ["0x00"] }]
          : []),
        { type: "i2c_read", addr, reg: op.reg, len: op.readLen, into: op.into },
      ];
    case "spi_cs":
    case "spi_transfer":
    case "gpio_debounce":
    case "decode":
    case "average":
    case "filter":
    case "map_range":
    case "validate_params":
    case "buffer_draw_text":
    case "buffer_clear":
    case "display_flush":
    case "display_power":
    case "ctrl_pin":
    case "spi_transfer_buffer":
    case "w1_wait_convert":
    case "sample_external":
    case "encode":
      // No v1 primitive — skipped in adapter (kept in draft + unknown / commands).
      return [];
    case "adc_sample":
    case "adc_multi_sample":
      return [{ type: "adc_read", into: op.into }];
    case "gpio_read":
      return [{ type: "gpio_read", into: op.into }];
    case "gpio_write":
      return [{ type: "gpio_write", level: op.level }];
    case "w1_reset":
      return [{ type: "w1_reset", intoPresence: op.intoPresence }];
    case "w1_match_rom":
      return [{ type: "w1_match_rom", rom: op.rom || address || "" }];
    case "w1_write":
      return [{ type: "w1_write", bytes: op.bytes }];
    case "w1_read":
      return [{ type: "w1_read", len: op.len, into: op.into }];
    case "w1_crc":
      return [{ type: "w1_crc", input: op.input, len: op.len }];
    case "emit":
      return [{ type: "emit", outputId: op.channelId, from: op.from }];
  }
}

export function parseDeviceRecipeDraft(raw: string | undefined | null): DeviceRecipeDraft | null {
  if (!raw?.trim()) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DeviceRecipeDraft> & { schemaVersion?: string };
    if (!parsed?.id || !parsed.binding) return null;
    const version = String(parsed.schemaVersion ?? "");
    if (version !== "1" && version !== "2") return null;
    return migrateDraft(parsed);
  } catch {
    return null;
  }
}

/** Migrate v1 drafts → v2 (category + commands). */
export function migrateDraft(raw: Partial<DeviceRecipeDraft> & { schemaVersion?: string }): DeviceRecipeDraft {
  const category: DeviceRecipeCategory = raw.category ?? "sensor";
  const phases = raw.phases ?? { init: [], sample: [], command: [] };
  const variablesFromOps: RecipeVariable[] = [];
  for (const phase of ["init", "sample", "command"] as const) {
    for (const op of phases[phase] ?? []) {
      if (op.type === "sample_external") {
        variablesFromOps.push(
          normalizeRecipeVariable({ name: op.into, valueType: op.valueType, label: op.into }),
        );
      }
    }
  }
  const variables = (raw.variables?.length ? raw.variables : variablesFromOps).map((v) => normalizeRecipeVariable(v));
  // Dedupe by name
  const seen = new Set<string>();
  const uniqueVars = variables.filter((v) => {
    if (seen.has(v.name)) return false;
    seen.add(v.name);
    return true;
  });
  return {
    schemaVersion: DEVICE_RECIPE_DRAFT_VERSION,
    id: raw.id!,
    name: raw.name ?? "Ricetta",
    status: raw.status === "ready" ? "ready" : "draft",
    category,
    sampleIntervalMs: raw.sampleIntervalMs ?? 1000,
    actionTrigger: normalizeActionTrigger(raw.actionTrigger),
    binding: raw.binding!,
    channels: raw.channels ?? [],
    variables: uniqueVars,
    commands: (raw.commands ?? []).map((c) => ({
      ...c,
      trigger: normalizeActionTrigger(c.trigger),
    })),
    display: raw.display,
    phases,
    verification: raw.verification ?? { status: "untested", note: "" },
    updatedAt: raw.updatedAt ?? Date.now(),
    runtimeUnavailable: raw.runtimeUnavailable ?? [],
  };
}

export function serializeDeviceRecipeDraft(draft: DeviceRecipeDraft): string {
  return JSON.stringify(draft);
}
