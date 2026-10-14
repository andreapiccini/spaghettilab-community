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

/**
 * Legacy phase keys kept for migrate / adapter.
 * Editor UX is Init + named Actions (`commands[]`); `sample`/`command` are no longer edited.
 */
export type DeviceRecipePhase = "init" | "sample" | "command";
/** Sensor editor panes — Task removed; interval lives on the canvas. */
export type DeviceRecipeEditorPane = "init" | "actions";

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

/** Phase of an advanced I²C transaction (composer). */
export type I2cTransactionPhase =
  | { readonly kind: "start" }
  | { readonly kind: "restart" }
  | { readonly kind: "stop" }
  | { readonly kind: "write"; readonly bytes: readonly string[] }
  | { readonly kind: "read"; readonly len: number };

export type WaitTimeUnit = "ms" | "us";

export type DeviceRecipeOp =
  | {
      readonly id: string;
      readonly type: "wait";
      /** Duration in `unit` (legacy field name `ms`). */
      readonly ms: number;
      readonly unit?: WaitTimeUnit;
      readonly timeoutMs?: number;
    }
  | {
      readonly id: string;
      readonly type: "i2c_write";
      /** 7-bit device address HEX; empty → binding address. */
      readonly address?: string;
      readonly bytes: readonly string[];
      readonly timeoutMs?: number;
    }
  | {
      readonly id: string;
      readonly type: "i2c_read";
      readonly address?: string;
      readonly len: number;
      readonly into: string;
      readonly timeoutMs?: number;
    }
  | {
      readonly id: string;
      readonly type: "i2c_write_read";
      readonly address?: string;
      readonly writeBytes: readonly string[];
      readonly readLen: number;
      readonly into: string;
      readonly timeoutMs?: number;
    }
  | {
      readonly id: string;
      readonly type: "i2c_scan";
      readonly fromAddress: string;
      readonly toAddress: string;
      readonly into?: string;
      readonly timeoutMs?: number;
    }
  | {
      readonly id: string;
      readonly type: "i2c_transaction";
      readonly address?: string;
      readonly phases: readonly I2cTransactionPhase[];
      readonly into?: string;
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

/**
 * Named action — sensor or display.
 * Each action is a canvas-schedulable unit; Init stays in `phases.init`.
 */
export type DeviceRecipeCommand = {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly params: readonly DeviceCommandParam[];
  readonly steps: readonly DeviceRecipeOp[];
  /** When this action is fired by an external trigger (Flow / GPIO / canvas). */
  readonly trigger?: DeviceActionTrigger;
  readonly updateMode?: DisplayUpdateMode;
  readonly errorPolicy?: "abort" | "ignore" | "clamp";
};

/** Build a named action (sensor or display). */
export function createNamedAction(seed?: Partial<DeviceRecipeCommand>): DeviceRecipeCommand {
  return {
    id: seed?.id && seed.id.trim() ? seed.id : newId("cmd"),
    name: seed?.name ?? "azione",
    label: seed?.label ?? "Azione",
    description: seed?.description ?? "",
    params: seed?.params ?? [],
    steps: seed?.steps ?? [],
    trigger: normalizeActionTrigger(seed?.trigger),
    updateMode: seed?.updateMode,
    errorPolicy: seed?.errorPolicy ?? "abort",
  };
}

export type DeviceRecipeBinding = {
  readonly bus: DeviceRecipeBus;
  readonly i2c?: {
    /** Hex address — 7-bit (0x00–0x7F) or 10-bit (0x000–0x3FF) per `addressBits`. */
    readonly address: string;
    /** Default 7-bit (standard). */
    readonly addressBits?: 7 | 10;
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
  /** @deprecated Interval is decided on the canvas; kept for migrate only. */
  readonly sampleIntervalMs: number;
  /**
   * @deprecated Prefer per-action `commands[].trigger`. Kept for migrate of old sensor drafts.
   */
  readonly actionTrigger: DeviceActionTrigger;
  readonly binding: DeviceRecipeBinding;
  readonly channels: readonly SensorChannel[];
  /** Named slots shared across Init / Actions; filled by Ingresso (sample_external) or defaults. */
  readonly variables: readonly RecipeVariable[];
  /** Named actions (sensor + display). Source of truth for sequences + Flow blocks. */
  readonly commands: readonly DeviceRecipeCommand[];
  readonly display?: DisplayProfile;
  readonly phases: {
    readonly init: readonly DeviceRecipeOp[];
    /** @deprecated Migrated into `commands[]`; always empty after migrate. */
    readonly sample: readonly DeviceRecipeOp[];
    /** @deprecated Migrated into `commands[]`; always empty after migrate. */
    readonly command: readonly DeviceRecipeOp[];
  };
  readonly verification: DeviceRecipeVerification;
  readonly updatedAt: number;
  /** Ops not executable on current firmware — listed for honesty. */
  readonly runtimeUnavailable: readonly string[];
};

/** Active named actions — source of truth for sensor + display sequences. */
export function namedActions(draft: DeviceRecipeDraft): readonly DeviceRecipeCommand[] {
  return draft.commands;
}

export function actionById(
  draft: DeviceRecipeDraft,
  actionId?: string | null,
): DeviceRecipeCommand | undefined {
  if (!draft.commands.length) return undefined;
  if (actionId) {
    const found = draft.commands.find((c) => c.id === actionId);
    if (found) return found;
  }
  return draft.commands[0];
}

/** Ops shown in the editor for Init or the selected Action. */
export function opsForEditorPane(
  draft: DeviceRecipeDraft,
  pane: DeviceRecipeEditorPane,
  actionId?: string | null,
): readonly DeviceRecipeOp[] {
  if (pane === "init") return draft.phases.init;
  return actionById(draft, actionId)?.steps ?? [];
}

/** Walk init + every named action (and legacy phases if still present). */
export function forEachSequenceOp(
  draft: DeviceRecipeDraft,
  visit: (op: DeviceRecipeOp) => void,
): void {
  for (const op of draft.phases.init) visit(op);
  for (const cmd of draft.commands) {
    for (const op of cmd.steps) visit(op);
  }
  for (const op of draft.phases.sample) visit(op);
  for (const op of draft.phases.command) visit(op);
}

/** Resolve per-op I²C address, falling back to binding. */
export function resolveI2cOpAddress(
  op: { readonly address?: string },
  draft: DeviceRecipeDraft,
): string {
  const raw = (op.address ?? draft.binding.i2c?.address ?? "0x00").trim();
  if (!raw) return draft.binding.i2c?.address?.trim() || "0x00";
  return raw.toLowerCase().startsWith("0x") ? raw : `0x${raw}`;
}

/** Wait duration in milliseconds (µs → fractional ms). */
export function waitDurationMs(op: Extract<DeviceRecipeOp, { type: "wait" }>): number {
  return op.unit === "us" ? op.ms / 1000 : op.ms;
}

/**
 * Validate an advanced I²C phase list.
 * Rules: START to open, STOP to close; RESTART only while active;
 * WRITE/READ only while active; direction change requires RESTART.
 */
export function validateI2cTransactionPhases(
  phases: readonly I2cTransactionPhase[],
): readonly string[] {
  const errors: string[] = [];
  if (phases.length === 0) {
    errors.push("Sequenza vuota: serve almeno START … STOP");
    return errors;
  }
  let active = false;
  let needAddr = false;
  let dir: "w" | "r" | null = null;
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i]!;
    const at = `fase ${i + 1}`;
    switch (p.kind) {
      case "start":
        if (active) errors.push(`${at}: START solo a bus idle (manca STOP)`);
        active = true;
        needAddr = true;
        dir = null;
        break;
      case "restart":
        if (!active) errors.push(`${at}: RESTART senza START`);
        needAddr = true;
        dir = null;
        break;
      case "stop":
        if (!active) errors.push(`${at}: STOP senza START`);
        active = false;
        needAddr = false;
        dir = null;
        break;
      case "write":
        if (!active) errors.push(`${at}: WRITE senza START`);
        else if (dir === "r" && !needAddr) errors.push(`${at}: dopo READ serve RESTART prima di WRITE`);
        else {
          if (needAddr) {
            needAddr = false;
            dir = "w";
          } else if (dir === null) dir = "w";
          if (p.bytes.length === 0 && dir === "w" && !needAddr) {
            /* address-only write is ok when bytes empty after addr — allow */
          }
        }
        break;
      case "read":
        if (!active) errors.push(`${at}: READ senza START`);
        else if (p.len < 1) errors.push(`${at}: READ richiede almeno 1 byte`);
        else if (dir === "w" && !needAddr) errors.push(`${at}: dopo WRITE serve RESTART prima di READ`);
        else {
          if (needAddr) {
            needAddr = false;
            dir = "r";
          } else if (dir === null) dir = "r";
        }
        break;
      default:
        break;
    }
  }
  if (active) errors.push("Sequenza aperta: manca STOP finale");
  if (phases[0]?.kind !== "start") errors.push("La sequenza deve iniziare con START");
  return errors;
}

export function describeDeviceOp(op: DeviceRecipeOp): string {
  switch (op.type) {
    case "wait":
      return `Attendi ${op.ms} ${op.unit === "us" ? "µs" : "ms"}`;
    case "i2c_write":
      return `I2C scrivi ${op.bytes.join(" ") || "(vuoto)"}`;
    case "i2c_read":
      return `I2C leggi ${op.len}B`;
    case "i2c_write_read":
      return `I2C scrivi+leggi ${op.readLen}B · RESTART`;
    case "i2c_scan":
      return `I2C scan ${op.fromAddress}–${op.toAddress}`;
    case "i2c_transaction":
      return `I2C transazione (${op.phases.length} fasi)`;
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

/** New sensor draft: binding only — no default actions/steps (user adds from library). */
export function createBlankDraft(mode: DeviceRecipeMode, name?: string): DeviceRecipeDraft {
  if (mode === "display") return createGraphicDisplayExample(name);
  return createBlankSensorDraft(mode, name);
}

function createBlankSensorDraft(bus: DeviceRecipeBus, name?: string): DeviceRecipeDraft {
  const seed = blankBindingSeed(bus);
  return {
    schemaVersion: DEVICE_RECIPE_DRAFT_VERSION,
    id: newId("dr"),
    name: name?.trim() ? name : seed.name,
    status: "draft",
    ...sensorDraftBase([]),
    sampleIntervalMs: 0,
    actionTrigger: DEFAULT_ACTION_TRIGGER,
    variables: [],
    binding: seed.binding,
    channels: [],
    verification: { status: "untested", note: "" },
    updatedAt: Date.now(),
    runtimeUnavailable: ["try_read_on_device"],
  };
}

function blankBindingSeed(bus: DeviceRecipeBus): {
  readonly name: string;
  readonly binding: DeviceRecipeBinding;
} {
  switch (bus) {
    case "i2c":
      return {
        name: "Sensore I2C",
        binding: {
          bus: "i2c",
          i2c: { address: "0x48", addressBits: 7, busUnit: "I2C0", sdaLabel: "", sclLabel: "" },
          gpioSignals: [],
          auxGpio: [],
        },
      };
    case "spi":
      return {
        name: "Sensore SPI",
        binding: {
          bus: "spi",
          spi: {
            mode: 0,
            freqHz: 1_000_000,
            bitOrder: "msb",
            sckLabel: "",
            mosiLabel: "",
            misoLabel: "",
            csLabel: "",
            misoRequired: true,
          },
          gpioSignals: [],
          auxGpio: [],
        },
      };
    case "adc":
      return {
        name: "Sensore analogico",
        binding: {
          bus: "adc",
          adc: {
            signalName: "SIGNAL",
            pinLabel: "",
            supportsMv: true,
            displayUnit: "mV",
            calibMinMv: null,
            calibMaxMv: null,
          },
          gpioSignals: [],
          auxGpio: [],
        },
      };
    case "w1":
      return {
        name: "Sensore 1-Wire",
        binding: {
          bus: "w1",
          w1: {
            busId: "w1-0",
            busName: "1-Wire 0",
            dqPinLabel: "",
            rom: "",
            powerMode: "external",
            externalPullupRequired: true,
            resolutionBits: 12,
          },
          gpioSignals: [],
          auxGpio: [],
        },
      };
    default:
      return {
        name: "Dispositivo GPIO",
        binding: {
          bus: "gpio",
          gpioSignals: [],
          auxGpio: [],
        },
      };
  }
}

function sensorDraftBase(
  actions: readonly DeviceRecipeCommand[],
): Pick<DeviceRecipeDraft, "category" | "commands" | "display" | "phases"> {
  return {
    category: "sensor",
    commands: actions.map((c) => ({ ...c, trigger: normalizeActionTrigger(c.trigger) })),
    display: undefined,
    phases: { init: [], sample: [], command: [] },
  };
}

function defaultMeasureAction(steps: readonly DeviceRecipeOp[]): DeviceRecipeCommand {
  return createNamedAction({
    name: "misura",
    label: "Misura",
    description: "",
    steps: [...steps],
    trigger: DEFAULT_ACTION_TRIGGER,
  });
}

/** Generic I2C skeleton — write+read with RESTART; outputs via Uscita (emit). */
export function createI2cGenericExample(name = "Sensore I2C"): DeviceRecipeDraft {
  const rawInto = "raw";
  return {
    schemaVersion: DEVICE_RECIPE_DRAFT_VERSION,
    id: newId("dr"),
    name,
    status: "draft",
    ...sensorDraftBase([
      defaultMeasureAction([
        {
          id: newId("op"),
          type: "i2c_write_read",
          address: "0x48",
          writeBytes: ["0x00"],
          readLen: 2,
          into: rawInto,
          timeoutMs: 20,
        },
        { id: newId("op"), type: "emit", channelId: "out_0", from: rawInto },
      ]),
    ]),
    sampleIntervalMs: 0,
    actionTrigger: DEFAULT_ACTION_TRIGGER,
    variables: [],
    binding: {
      bus: "i2c",
      i2c: {
        address: "0x48",
        addressBits: 7,
        busUnit: "I2C0",
        sdaLabel: "A0",
        sclLabel: "A1",
      },
      gpioSignals: [],
      auxGpio: [],
    },
    channels: [{ id: "out_0", label: "Uscita", unit: "", quantity: "other", direction: "read" }],
    verification: { status: "untested", note: "Da provare sul dispositivo" },
    updatedAt: Date.now(),
    runtimeUnavailable: ["i2c_scan", "i2c_transaction", "try_read_on_device"],
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

/** Ports the Flow block will expose — inputs from Ingresso, outputs from Uscita. */
export function recipeBlockPorts(draft: DeviceRecipeDraft): {
  readonly inputs: readonly RecipeBlockPort[];
  readonly outputs: readonly RecipeBlockPort[];
} {
  const inputs: RecipeBlockPort[] = [];
  const seenIn = new Set<string>();
  forEachSequenceOp(draft, (op) => {
    if (op.type !== "sample_external") return;
    if (seenIn.has(op.fromChannelId)) return;
    seenIn.add(op.fromChannelId);
    const ch = draft.channels.find((c) => c.id === op.fromChannelId);
    inputs.push({
      id: op.fromChannelId,
      label: ch?.label ?? op.fromChannelId,
      direction: "in",
      valueType: op.valueType,
      unit: ch?.unit,
    });
  });
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
  forEachSequenceOp(draft, (op) => {
    if (op.type !== "emit") return;
    if (seenOut.has(op.channelId)) return;
    seenOut.add(op.channelId);
    const ch = draft.channels.find((c) => c.id === op.channelId);
    outputs.push({
      id: op.channelId,
      label: ch?.label ?? op.channelId,
      direction: "out",
      valueType: ch?.quantity ?? "other",
      unit: ch?.unit,
    });
  });
  return { inputs, outputs };
}

export function createSpiPressureExample(name = "Sensore SPI"): DeviceRecipeDraft {
  return {
    schemaVersion: DEVICE_RECIPE_DRAFT_VERSION,
    id: newId("dr"),
    name,
    status: "draft",
    ...sensorDraftBase([
      defaultMeasureAction([
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
      ]),
    ]),
    sampleIntervalMs: 0,
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
    ...sensorDraftBase([
      defaultMeasureAction([
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
      ]),
    ]),
    sampleIntervalMs: 0,
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
    ...sensorDraftBase([
      defaultMeasureAction([
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
      ]),
    ]),
    sampleIntervalMs: 0,
    actionTrigger: DEFAULT_ACTION_TRIGGER,
    variables: [],
    binding: {
      bus: "gpio",
      gpioSignals: signals,
      auxGpio: [],
    },
    channels: [{ id: "state", label: "Stato", unit: "on/off", quantity: "digital", direction: "read" }],
    verification: { status: "untested", note: "Da provare sul dispositivo" },
    updatedAt: Date.now(),
    runtimeUnavailable: ["gpio_debounce_events", "try_read_on_device"],
  };
}

/**
 * DS18B20 (external power) — datasheet timings/commands.
 * Convert T max 750 ms @ 12-bit; scratchpad 9 bytes; CRC over first 8.
 */
export function createDs18b20Example(name = "Sensore 1-Wire"): DeviceRecipeDraft {
  const exampleRom = "28 FF 01 02 03 04 05 62";
  return {
    schemaVersion: DEVICE_RECIPE_DRAFT_VERSION,
    id: newId("dr"),
    name,
    status: "draft",
    ...sensorDraftBase([
      defaultMeasureAction([
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
      ]),
    ]),
    sampleIntervalMs: 0,
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
      command: [],
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
  const inputOp = { type: "sample_external" as const, label: "Ingresso" };
  const outputOp = { type: "emit" as const, label: "Uscita" };
  const dataOps = [
    { type: "encode" as const, label: "Codifica" },
    { type: "decode" as const, label: "Decodifica" },
    outputOp,
  ];
  switch (bus) {
    case "i2c":
      return [
        { type: "i2c_read", label: "Leggi" },
        { type: "i2c_write", label: "Scrivi" },
        { type: "i2c_write_read", label: "Scrivi e leggi" },
        { type: "wait", label: "Attendi" },
        { type: "i2c_scan", label: "Scansiona" },
        { type: "i2c_transaction", label: "Transazione avanzata" },
      ];
    case "spi":
      return [
        inputOp,
        { type: "spi_cs", label: "Seleziona CS" },
        { type: "spi_transfer", label: "Trasferisci" },
        { type: "wait", label: "Attendi" },
        ...dataOps,
      ];
    case "gpio":
      return [
        inputOp,
        { type: "gpio_read", label: "Leggi livello" },
        { type: "gpio_write", label: "Imposta livello" },
        { type: "gpio_debounce", label: "Antirimbalzo" },
        { type: "wait", label: "Attendi" },
        ...dataOps,
      ];
    case "adc":
      return [
        inputOp,
        { type: "adc_sample", label: "Campiona ADC" },
        { type: "adc_multi_sample", label: "Campiona più volte" },
        { type: "average", label: "Media" },
        { type: "filter", label: "Filtra" },
        { type: "map_range", label: "Mappa intervallo" },
        ...dataOps,
        { type: "wait", label: "Attendi" },
      ];
    case "w1":
      return [
        inputOp,
        { type: "w1_reset", label: "Reset / presenza" },
        { type: "w1_match_rom", label: "Seleziona ROM" },
        { type: "w1_write", label: "Scrivi byte" },
        { type: "w1_read", label: "Leggi byte" },
        { type: "w1_wait_convert", label: "Attendi completamento" },
        { type: "w1_crc", label: "Verifica CRC" },
        ...dataOps,
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
      return { id, type: "wait", ms: 10, unit: "ms" };
    case "i2c_write":
      return {
        id,
        type: "i2c_write",
        address: draft.binding.i2c?.address ?? "0x48",
        bytes: ["0x00"],
        timeoutMs: 20,
      };
    case "i2c_read":
      return {
        id,
        type: "i2c_read",
        address: draft.binding.i2c?.address ?? "0x48",
        len: 2,
        into: "raw",
        timeoutMs: 20,
      };
    case "i2c_write_read":
      return {
        id,
        type: "i2c_write_read",
        address: draft.binding.i2c?.address ?? "0x48",
        writeBytes: ["0x00"],
        readLen: 2,
        into: "raw",
        timeoutMs: 20,
      };
    case "i2c_scan":
      return {
        id,
        type: "i2c_scan",
        fromAddress: "0x08",
        toAddress: "0x77",
        into: "found",
        timeoutMs: 20,
      };
    case "i2c_transaction":
      return {
        id,
        type: "i2c_transaction",
        address: draft.binding.i2c?.address ?? "0x48",
        phases: [
          { kind: "start" },
          { kind: "write", bytes: ["0x00"] },
          { kind: "restart" },
          { kind: "read", len: 2 },
          { kind: "stop" },
        ],
        into: "raw",
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
  const cmd = createNamedAction({
    name: seed?.name ?? `azione_${draft.commands.length + 1}`,
    label: seed?.label ?? "Nuova azione",
    description: seed?.description ?? "",
    params: seed?.params ?? [],
    steps: seed?.steps ?? [],
    trigger: seed?.trigger,
    updateMode: seed?.updateMode ?? draft.display?.updateModeDefault ?? "auto",
    errorPolicy: seed?.errorPolicy ?? "abort",
  });
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

function ensureReadChannelForI2cOp(draft: DeviceRecipeDraft, op: DeviceRecipeOp): DeviceRecipeDraft {
  if (draft.channels.some((c) => c.direction === "read")) return draft;
  const into =
    op.type === "i2c_read" || op.type === "i2c_write_read"
      ? op.into
      : op.type === "i2c_scan" || op.type === "i2c_transaction"
        ? op.into
        : undefined;
  if (!into?.trim()) return draft;
  const id = normalizeRecipeVarName(into);
  return {
    ...draft,
    channels: [...draft.channels, { id, label: id, unit: "", quantity: "other", direction: "read" }],
  };
}

export function insertCommandStep(
  draft: DeviceRecipeDraft,
  commandId: string,
  type: DeviceRecipeOp["type"],
): DeviceRecipeDraft {
  const op = defaultOp(type, draft);
  const withChannel = ensureReadChannelForI2cOp(draft, op);
  const commands = withChannel.commands.map((c) => (c.id === commandId ? { ...c, steps: [...c.steps, op] } : c));
  return touch({ ...withChannel, commands });
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
      push(op.address);
      for (const b of op.bytes) push(b);
      break;
    case "i2c_read":
      push(op.address);
      break;
    case "i2c_write_read":
      push(op.address);
      for (const b of op.writeBytes) push(b);
      break;
    case "i2c_scan":
      push(op.fromAddress);
      push(op.toAddress);
      break;
    case "i2c_transaction":
      push(op.address);
      for (const phase of op.phases) {
        if (phase.kind === "write") for (const b of phase.bytes) push(b);
      }
      break;
    case "sample_external":
      // `into` is created by this op — not a pre-existing ref.
      break;
    case "decode":
      // `into` is written by decode; `input` may be a $var or a raw buffer name.
      push(op.input);
      break;
    case "encode":
      // `into` is written by encode; `input` is the source variable name.
      if (op.input.trim()) refs.push(normalizeRecipeVarName(op.input.replace(/^\$+/, "")));
      break;
    default:
      break;
  }
  return refs;
}

export function collectAllVarRefs(draft: DeviceRecipeDraft): readonly string[] {
  const names = new Set<string>();
  forEachSequenceOp(draft, (op) => {
    for (const n of collectVarRefsFromOp(op)) names.add(n);
  });
  return [...names];
}

export function isVariableUsed(draft: DeviceRecipeDraft, name: string): boolean {
  const n = normalizeRecipeVarName(name);
  if (collectAllVarRefs(draft).includes(n)) return true;
  let used = false;
  forEachSequenceOp(draft, (op) => {
    if (
      (op.type === "sample_external" || op.type === "decode" || op.type === "encode") &&
      op.into === n
    ) {
      used = true;
    }
  });
  return used;
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
  next = ensureReadChannelForI2cOp(next, op);
  const list = [...next.phases[phase]];
  const index = atIndex === undefined ? list.length : Math.max(0, Math.min(atIndex, list.length));
  list.splice(index, 0, op);
  return touch({ ...next, phases: { ...next.phases, [phase]: list } });
}

/** Update an op whether it lives in Init or a named action. */
export function updateOpAnywhere(
  draft: DeviceRecipeDraft,
  opId: string,
  next: DeviceRecipeOp,
): DeviceRecipeDraft {
  if (draft.phases.init.some((o) => o.id === opId)) return updateOp(draft, "init", opId, next);
  for (const cmd of draft.commands) {
    if (cmd.steps.some((s) => s.id === opId)) return updateCommandStep(draft, cmd.id, opId, next);
  }
  for (const phase of ["sample", "command"] as const) {
    if (draft.phases[phase].some((o) => o.id === opId)) return updateOp(draft, phase, opId, next);
  }
  return draft;
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
  if (draft.commands.length === 0) {
    errors.push({ field: "actions", message: "Serve almeno un'azione" });
  }
  for (const cmd of draft.commands) {
    if (!cmd.name.trim()) {
      errors.push({ field: `cmd.${cmd.id}.name`, message: `Nome azione obbligatorio (${cmd.label})` });
    }
    if (cmd.steps.length === 0) {
      errors.push({ field: `cmd.${cmd.id}.steps`, message: `Sequenza vuota: ${cmd.label}` });
    }
    for (const op of cmd.steps) {
      if (op.type === "i2c_transaction") {
        for (const msg of validateI2cTransactionPhases(op.phases)) {
          errors.push({ field: `cmd.${cmd.id}.tx`, message: `${cmd.label}: ${msg}` });
        }
      }
    }
  }
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
  let hasEmit = false;
  forEachSequenceOp(draft, (op) => {
    if (op.type === "emit") hasEmit = true;
  });
  if (!hasEmit) errors.push({ field: "emit", message: "Manca un passo Uscita in almeno un'azione" });

  const knownVars = new Set(draft.variables.map((v) => v.name));
  for (const ref of collectAllVarRefs(draft)) {
    if (!knownVars.has(ref)) {
      errors.push({ field: "variables", message: `Variabile sconosciuta: $${ref}` });
    }
  }
  forEachSequenceOp(draft, (op) => {
    if (op.type !== "sample_external") return;
    if (!draft.channels.some((c) => c.id === op.fromChannelId && c.direction === "write")) {
      errors.push({
        field: "sample_external",
        message: `Ingresso: canale Flow mancante (${op.fromChannelId})`,
      });
    }
  });
  return errors;
}

/** Raw acquisition present — try raw allowed even without calibration. */
export function hasValidAnalogAcquisition(draft: DeviceRecipeDraft): boolean {
  let ok = false;
  forEachSequenceOp(draft, (op) => {
    if (op.type === "adc_sample" || op.type === "adc_multi_sample") ok = true;
  });
  return ok;
}

/**
 * One SensorRecipe per named action — for canvas placement (each action = one block).
 * Init is attached to every action recipe so a single block stays self-contained.
 */
export function draftToCanvasSensorRecipes(draft: DeviceRecipeDraft): readonly SensorRecipe[] {
  if (draft.category === "display") {
    return [draftToSensorRecipe(draft)];
  }
  const actions =
    draft.commands.length > 0
      ? draft.commands
      : [
          createNamedAction({
            name: "misura",
            label: "Misura",
            steps: draft.phases.sample,
          }),
        ];
  return actions.map((cmd) => {
    const used = new Set<string>();
    for (const op of cmd.steps) {
      if (op.type === "emit") used.add(op.channelId);
      if (op.type === "sample_external") used.add(op.fromChannelId);
    }
    const channels = draft.channels.filter((c) => used.has(c.id));
    const slice: DeviceRecipeDraft = {
      ...draft,
      id: `${draft.id}:${cmd.id}`,
      name: `${draft.name} · ${cmd.label}`,
      commands: [{ ...cmd, trigger: normalizeActionTrigger(cmd.trigger) }],
      channels: channels.length > 0 ? channels : draft.channels,
      phases: { init: draft.phases.init, sample: [], command: [] },
    };
    return draftToSensorRecipe(slice);
  });
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
  const primary = draft.commands[0];
  const primarySteps = primary?.steps ?? draft.phases.sample;
  const sample = draft.category === "display" ? [] : primarySteps.flatMap((op) => mapOpToV1(op, address));
  const init = draft.phases.init.flatMap((op) => mapOpToV1(op, address));
  const transforms: SensorTransform[] = primarySteps
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
  let hasSampleExternal = draft.variables.length > 0;
  forEachSequenceOp(draft, (op) => {
    if (op.type === "sample_external") hasSampleExternal = true;
  });
  if (hasSampleExternal) {
    unknown.push("Ingresso / variabili ricetta: authoring only finché il runtime non le supporta");
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
        // v1 still has a single sample slot — filled from the first named action.
        sample,
        write: draft.commands.slice(1).flatMap((c) => c.steps.flatMap((op) => mapOpToV1(op, address))),
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
      return [{ type: "wait", ms: Math.max(1, Math.ceil(waitDurationMs(op))) }];
    case "i2c_write":
      return [{ type: "i2c_write", addr: op.address ?? addr, bytes: op.bytes }];
    case "i2c_read":
      return [{ type: "i2c_read", addr: op.address ?? addr, len: op.len, into: op.into }];
    case "i2c_write_read":
      return [
        ...(op.writeBytes.length
          ? [{ type: "i2c_write" as const, addr: op.address ?? addr, bytes: op.writeBytes }]
          : []),
        { type: "i2c_read", addr: op.address ?? addr, len: op.readLen, into: op.into },
      ];
    case "i2c_scan":
    case "i2c_transaction":
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

/** Normalize legacy I²C / wait op shapes onto the current model. */
export function migrateRecipeOp(op: DeviceRecipeOp): DeviceRecipeOp {
  const legacy = op as DeviceRecipeOp & {
    readonly reg?: string;
    readonly repeatedStart?: boolean;
    readonly duration?: number;
  };
  switch (legacy.type) {
    case "wait":
      return {
        id: legacy.id,
        type: "wait",
        ms: legacy.ms ?? legacy.duration ?? 10,
        unit: legacy.unit === "us" ? "us" : "ms",
        timeoutMs: legacy.timeoutMs,
      };
    case "i2c_write": {
      const bytes = [
        ...(legacy.reg ? [legacy.reg] : []),
        ...(("bytes" in legacy && Array.isArray(legacy.bytes) ? legacy.bytes : []) as string[]),
      ];
      return {
        id: legacy.id,
        type: "i2c_write",
        address: legacy.address,
        bytes: bytes.length ? bytes : ["0x00"],
        timeoutMs: legacy.timeoutMs,
      };
    }
    case "i2c_read": {
      if (legacy.reg) {
        return {
          id: legacy.id,
          type: "i2c_write_read",
          address: legacy.address,
          writeBytes: [legacy.reg],
          readLen: Math.max(1, legacy.len),
          into: legacy.into || "raw",
          timeoutMs: legacy.timeoutMs,
        };
      }
      return {
        id: legacy.id,
        type: "i2c_read",
        address: legacy.address,
        len: Math.max(1, legacy.len),
        into: legacy.into || "raw",
        timeoutMs: legacy.timeoutMs,
      };
    }
    case "i2c_write_read": {
      const writeBytes = [
        ...(legacy.reg ? [legacy.reg] : []),
        ...(("writeBytes" in legacy && Array.isArray(legacy.writeBytes) ? legacy.writeBytes : []) as string[]),
      ];
      return {
        id: legacy.id,
        type: "i2c_write_read",
        address: legacy.address,
        writeBytes,
        readLen: Math.max(1, legacy.readLen),
        into: legacy.into || "raw",
        timeoutMs: legacy.timeoutMs,
      };
    }
    case "i2c_scan":
      return {
        id: legacy.id,
        type: "i2c_scan",
        fromAddress: legacy.fromAddress || "0x08",
        toAddress: legacy.toAddress || "0x77",
        into: legacy.into,
        timeoutMs: legacy.timeoutMs,
      };
    case "i2c_transaction":
      return {
        id: legacy.id,
        type: "i2c_transaction",
        address: legacy.address,
        phases: Array.isArray(legacy.phases) ? legacy.phases : [],
        into: legacy.into,
        timeoutMs: legacy.timeoutMs,
      };
    default:
      return op;
  }
}

/**
 * Migrate older drafts → current model:
 * - Task (`phases.sample`) / legacy Action (`phases.command`) → named `commands[]`
 * - Interval / draft-level actionTrigger kept but unused by the new UX
 * - Legacy I²C `reg` / `repeatedStart` folded into current ops
 */
export function migrateDraft(raw: Partial<DeviceRecipeDraft> & { schemaVersion?: string }): DeviceRecipeDraft {
  const category: DeviceRecipeCategory = raw.category ?? "sensor";
  const phasesIn = raw.phases ?? { init: [], sample: [], command: [] };
  const migrateList = (ops: readonly DeviceRecipeOp[] | undefined) =>
    (ops ?? []).map((op) => migrateRecipeOp(op));

  const variablesFromOps: RecipeVariable[] = [];
  for (const phase of ["init", "sample", "command"] as const) {
    for (const op of migrateList(phasesIn[phase])) {
      if (op.type === "sample_external") {
        variablesFromOps.push(
          normalizeRecipeVariable({ name: op.into, valueType: op.valueType, label: op.into }),
        );
      }
    }
  }
  for (const cmd of raw.commands ?? []) {
    for (const op of migrateList(cmd.steps)) {
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

  let commands: DeviceRecipeCommand[] = (raw.commands ?? []).map((c) => ({
    ...c,
    steps: migrateList(c.steps),
    trigger: normalizeActionTrigger(c.trigger ?? raw.actionTrigger),
  }));

  const initMigrated = migrateList(phasesIn.init);
  const sampleMigrated = migrateList(phasesIn.sample);
  const commandMigrated = migrateList(phasesIn.command);

  // Sensors (and displays without commands): fold legacy Task / Action into named actions.
  if (commands.length === 0) {
    if (sampleMigrated.length > 0) {
      commands = [
        createNamedAction({
          name: "misura",
          label: "Misura",
          steps: sampleMigrated,
          trigger: raw.actionTrigger,
        }),
      ];
    }
    if (commandMigrated.length > 0) {
      commands = [
        ...commands,
        createNamedAction({
          name: category === "display" ? "comando" : "azione",
          label: category === "display" ? "Comando" : "Azione",
          steps: commandMigrated,
          trigger: raw.actionTrigger,
        }),
      ];
    }
  }

  return {
    schemaVersion: DEVICE_RECIPE_DRAFT_VERSION,
    id: raw.id!,
    name: raw.name ?? "Ricetta",
    status: raw.status === "ready" ? "ready" : "draft",
    category,
    sampleIntervalMs: 0,
    actionTrigger: normalizeActionTrigger(raw.actionTrigger),
    binding: raw.binding!,
    channels: raw.channels ?? [],
    variables: uniqueVars,
    commands,
    display: raw.display,
    phases: {
      init: initMigrated,
      sample: [],
      command: [],
    },
    verification: raw.verification ?? { status: "untested", note: "" },
    updatedAt: raw.updatedAt ?? Date.now(),
    runtimeUnavailable: raw.runtimeUnavailable ?? [],
  };
}

export function serializeDeviceRecipeDraft(draft: DeviceRecipeDraft): string {
  return JSON.stringify(draft);
}
