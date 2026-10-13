import {
  decodePhysicalBackbone,
  encodePhysicalSettings,
  type GetStatusResponse,
  type NfcTagStatus,
  type PhysicalBackbone,
  type PhysicalInterfaceSettings,
} from "@spaghettilab/protocol-sdk";
import builtin from "../../../catalog-model/src/nfc-module-catalog.json";
import type { CustomProtocol } from "./port-protocol-mock.js";

export type PhysicalCatalogEntry = {
  readonly registryId: number;
  readonly vendorId: number;
  readonly moduleTypeId: number;
  readonly name: string;
  readonly nameIt?: string;
  /** Complete six-pin electrical definition. Missing in the legacy demo catalog. */
  readonly pins?: readonly string[];
  readonly modes?: readonly number[];
  readonly i2cSpeed?: number;
  readonly protocol?: CustomProtocol;
  readonly settings?: PhysicalInterfaceSettings;
};

export const PHYSICAL_CATALOG: readonly PhysicalCatalogEntry[] = builtin;
export const PHYSICAL_META_KEY = "__backbonePhysical";

/** Function module hardware generation on the Backbone. */
export type FunctionModuleVariant = "v1" | "v2";

/** Default = V2 (12-pin). V1 keeps the legacy 1×6 Function bay. */
export const DEFAULT_FUNCTION_VARIANT: FunctionModuleVariant = "v2";

/** ESP32-S3 bus controller index chosen in authoring (one bus of each kind on the bay). */
export type PhysicalBusUnits = {
  readonly i2c?: number;
  readonly spi?: number;
  readonly uart?: number;
  /** Logical 1-Wire bus index (always 0 on Function bay today). */
  readonly w1?: number;
};

/**
 * Authoring config for a 1-Wire peripheral (distinct from GPIO).
 * Multiple sensors share one bus — do not create one peripheral per ROM.
 */
export type W1PeripheralConfig = {
  readonly id: string;
  readonly name: string;
  /** External power only until firmware exposes parasite-power strong pull-up. */
  readonly powerMode: "external" | "parasitic";
  /** Always true in UI: internal MCU pull-up is not sufficient for 1-Wire. */
  readonly externalPullupRequired: true;
  /** Runtime must opt-in; default false so parasitic stays disabled. */
  readonly parasiticSupported: boolean;
};

export const DEFAULT_W1_CONFIG: W1PeripheralConfig = {
  id: "w1-0",
  name: "1-Wire 0",
  powerMode: "external",
  externalPullupRequired: true,
  parasiticSupported: false,
};

export type BackbonePhysicalDraft = {
  readonly applied?: boolean;
  readonly nodeId?: number;
  readonly local?: boolean;
  readonly backendPortId?: number;
  readonly automatic?: boolean;
  readonly name: string;
  /** V1 = 6 pin (4 signals); V2 = 12 pin (A0–A7). Default V2. */
  readonly variant?: FunctionModuleVariant;
  readonly modes: readonly number[];
  readonly i2cSpeed: number;
  readonly protocol?: CustomProtocol;
  readonly settings?: PhysicalInterfaceSettings;
  /** Selected I2C / SPI / UART controller numbers (ESP32-S3). */
  readonly busUnits?: PhysicalBusUnits;
  /** 1-Wire bus metadata (name, power, pull-up). Present when W1 is used or configured. */
  readonly w1Config?: W1PeripheralConfig;
};

export function functionVariantOf(
  draft: Pick<BackbonePhysicalDraft, "variant" | "modes">,
): FunctionModuleVariant {
  if (draft.variant === "v1" || draft.variant === "v2") return draft.variant;
  return draft.modes.length === 8 ? "v2" : draft.modes.length === 4 ? "v1" : DEFAULT_FUNCTION_VARIANT;
}

export function configurablePinCount(variant: FunctionModuleVariant): number {
  return variant === "v1" ? 4 : 8;
}

export function defaultModesForVariant(variant: FunctionModuleVariant): number[] {
  return Array.from({ length: configurablePinCount(variant) }, () => 0);
}

/** Remap modes when the user switches V1 ↔ V2 in the UI. */
export function modesForVariant(
  modes: readonly number[],
  variant: FunctionModuleVariant,
): number[] {
  const n = configurablePinCount(variant);
  if (modes.length === n) return [...modes];
  if (modes.length > n) return modes.slice(0, n).map((mode) => mode);
  return [...modes, ...Array.from({ length: n - modes.length }, () => 0)];
}

/**
 * Stable pin id used in interface cards / assignments.
 * V1: physical pins 2–5. V2: A0–A7 as 0–7.
 */
export function modeIndexToPinId(index: number, variant: FunctionModuleVariant): number {
  return variant === "v1" ? index + 2 : index;
}

export function pinIdToModeIndex(pinId: number, variant: FunctionModuleVariant): number {
  return variant === "v1" ? pinId - 2 : pinId;
}

export function formatPinLabel(pinId: number, variant: FunctionModuleVariant): string {
  return variant === "v1" ? `Pin ${pinId}` : `A${pinId}`;
}

export function expectedFunctionTag(
  tag: NfcTagStatus | undefined,
  automatic = false,
): Uint8Array {
  const bytes = new Uint8Array(20);
  if (tag) {
    const view = new DataView(bytes.buffer);
    view.setUint16(0, tag.registryId ?? 0);
    view.setUint16(2, tag.vendorId ?? 0);
    view.setUint32(4, tag.moduleTypeId ?? 0);
    if (tag.uid.length > 10) throw new Error("Invalid NFC UID");
    bytes[8] = tag.uid.length;
    bytes.set(tag.uid, 9);
  }
  bytes[19] = automatic ? 1 : 0;
  return bytes;
}

export type PhysicalProject = {
  readonly drafts: Readonly<Record<string, BackbonePhysicalDraft>>;
  readonly catalog: readonly PhysicalCatalogEntry[];
};

export function parsePhysicalProject(raw: string | undefined): PhysicalProject {
  try {
    const parsed = JSON.parse(raw ?? "{}") as Partial<PhysicalProject>;
    return { drafts: parsed.drafts ?? {}, catalog: parsed.catalog ?? [] };
  } catch {
    return { drafts: {}, catalog: [] };
  }
}

export function catalogEntry(
  tag: NfcTagStatus | undefined,
  catalog: readonly PhysicalCatalogEntry[],
): PhysicalCatalogEntry | undefined {
  if (!tag?.registryId || !tag.vendorId || !tag.moduleTypeId) return undefined;
  return catalog.find(
    (entry) =>
      entry.registryId === tag.registryId &&
      entry.vendorId === tag.vendorId &&
      entry.moduleTypeId === tag.moduleTypeId,
  );
}

/** Physical Function Bay Port 2 pin roles (MCU modes 0–13 + GPIO pull bits). */
export function labelForMode(mode: number): string {
  const base = mode & 15;
  switch (base) {
    case 0:
      return "NC";
    case 1:
      if (mode & 16) return "GPIO IN PULLUP";
      if (mode & 32) return "GPIO IN PULLDOWN";
      return "GPIO IN";
    case 2:
      return "GPIO OUT";
    case 3:
      return "GPIO OUT HIGH";
    case 4:
      return "SDA";
    case 5:
      return "SCL";
    case 6:
      return "TX";
    case 7:
      return "RX";
    /* Must match firmware port_backend_board.c mux: 8=CLK, 9=MOSI, 10=MISO, 11=CS. */
    case 8:
      return "SCK";
    case 9:
      return "MOSI";
    case 10:
      return "MISO";
    case 11:
      return "CS";
    case 12:
      return "PWM";
    case 13:
      return "DQ";
    case 14:
      return "ADC";
    default:
      return "NC";
  }
}

/**
 * Flat left→right labels for V1 (6) or row-major V2 matching the Module Function
 * PCB silkscreen: top A4…A7 GND 3.3V · bottom A3…A0 GND 5V.
 */
export function pinsForModes(
  modes: readonly number[],
  variant: FunctionModuleVariant = modes.length === 8 ? "v2" : "v1",
): string[] {
  if (variant === "v2") {
    const m = modesForVariant(modes, "v2");
    return [
      labelForMode(m[4]!),
      labelForMode(m[5]!),
      labelForMode(m[6]!),
      labelForMode(m[7]!),
      "GND",
      "3.3V",
      labelForMode(m[3]!),
      labelForMode(m[2]!),
      labelForMode(m[1]!),
      labelForMode(m[0]!),
      "GND",
      "5V",
    ];
  }
  const m = modesForVariant(modes, "v1");
  return ["5V", ...m.map(labelForMode), "GND"];
}

export type FunctionPinCell = {
  readonly label: string;
  /** Present when the cell is a configurable A0–A7 / pin 2–5. */
  readonly modeIndex?: number;
  /** Firmware mode byte when configurable (0 = NC). */
  readonly mode?: number;
  /** MCU / ADC channel detail under the role label. */
  readonly detail?: string;
};

/** Physical contact grid for the Function module preview. */
export function functionPinGrid(
  modes: readonly number[],
  variant: FunctionModuleVariant = modes.length === 8 ? "v2" : "v1",
): readonly (readonly FunctionPinCell[])[] {
  if (variant === "v2") {
    const m = modesForVariant(modes, "v2");
    const cell = (modeIndex: number): FunctionPinCell => pinCell(m[modeIndex]!, modeIndex, "v2");
    // Match Module Function PCB silkscreen (image): A4→A7 GND 3.3V / A3→A0 GND 5V.
    return [
      [cell(4), cell(5), cell(6), cell(7), { label: "GND" }, { label: "3.3V" }],
      [cell(3), cell(2), cell(1), cell(0), { label: "GND" }, { label: "5V" }],
    ];
  }
  const m = modesForVariant(modes, "v1");
  const cell = (modeIndex: number): FunctionPinCell => pinCell(m[modeIndex]!, modeIndex, "v1");
  return [
    [
      { label: "5V" },
      cell(0),
      cell(1),
      cell(2),
      cell(3),
      { label: "GND" },
    ],
  ];
}

function pinCell(
  mode: number,
  modeIndex: number,
  variant: FunctionModuleVariant,
): FunctionPinCell {
  const base = mode & 15;
  const hw = functionPinHardware(modeIndex, variant);
  // Always show the physical IO pad; never show ADC channel numbers in the UI.
  const detail = base === 0 ? undefined : formatGpioNumber(hw.gpio);
  return {
    label: labelForMode(mode),
    modeIndex,
    mode,
    detail,
  };
}

/** One allocated peripheral on the Function module. */
export type PortInterfaceKind = "gpio" | "i2c" | "uart" | "spi" | "pwm" | "w1" | "adc";

/** Accent colors shared by peripheral picker chips and Function pin contacts. */
export const PERIPHERAL_ACCENT: Record<PortInterfaceKind, string> = {
  gpio: "#0F766E",
  i2c: "#2563EB",
  uart: "#7C3AED",
  spi: "#EA580C",
  pwm: "#DB2777",
  adc: "#0891B2",
  w1: "#CA8A04",
};

/** Map a firmware mode byte to its peripheral kind (or null for NC). */
export function kindForMode(mode: number): PortInterfaceKind | null {
  const base = mode & 15;
  if (base === 1 || base === 2 || base === 3) return "gpio";
  if (base === 4 || base === 5) return "i2c";
  if (base === 6 || base === 7) return "uart";
  if (base === 8 || base === 9 || base === 10 || base === 11) return "spi";
  if (base === 12) return "pwm";
  if (base === 13) return "w1";
  if (base === 14) return "adc";
  return null;
}

/** Capability bits — same as `PORT_CAP` / firmware `spaghetti_port_capability`. */
export const PHYSICAL_CAP = {
  I2C: 1 << 0,
  SPI: 1 << 1,
  UART: 1 << 2,
  DIGITAL_INPUT: 1 << 3,
  DIGITAL_OUTPUT: 1 << 4,
  ADC: 1 << 5,
  W1: 1 << 6,
  PWM: 1 << 7,
} as const;

export type PortSignalBinding = {
  readonly signalId: string;
  readonly label: string;
  /** Full mode byte (GPIO may include pull bits). */
  readonly mode: number;
  /** V1: physical pin 2–5. V2: A0–A7 as 0–7. */
  readonly pin: number;
};

export type PortInterfaceInstance = {
  readonly id: string;
  readonly kind: PortInterfaceKind;
  readonly ordinal: number;
  readonly signals: readonly PortSignalBinding[];
};

export type PhysicalSignalDef = {
  readonly id: string;
  readonly label: string;
  readonly mode: number;
};

export function signalsForInterface(kind: PortInterfaceKind): readonly PhysicalSignalDef[] {
  switch (kind) {
    case "i2c":
      return [
        { id: "sda", label: "SDA", mode: 4 },
        { id: "scl", label: "SCL", mode: 5 },
      ];
    case "uart":
      return [
        { id: "tx", label: "TX", mode: 6 },
        { id: "rx", label: "RX", mode: 7 },
      ];
    case "spi":
      return [
        { id: "sck", label: "SCK", mode: 8 },
        { id: "mosi", label: "MOSI", mode: 9 },
        { id: "miso", label: "MISO", mode: 10 },
        { id: "cs", label: "CS", mode: 11 },
      ];
    case "pwm":
      return [{ id: "pwm", label: "PWM", mode: 12 }];
    case "w1":
      return [{ id: "dq", label: "DQ", mode: 13 }];
    case "adc":
      return [{ id: "adc", label: "ADC", mode: 14 }];
    case "gpio":
      return [
        { id: "gpio-in", label: "GPIO IN", mode: 1 },
        { id: "gpio-out", label: "GPIO OUT", mode: 2 },
      ];
  }
}

export function pinsRequiredForKind(kind: PortInterfaceKind): number {
  // GPIO exposes IN + OUT as alternate chips, but each instance still uses one pin.
  if (kind === "gpio") return 1;
  return signalsForInterface(kind).length;
}

export type PinVisualKind = "power" | "ground" | "signal" | "unused" | "unknown";

export function pinVisualKind(label: string): PinVisualKind {
  if (label === "5V" || label === "3.3V" || label === "3V3") return "power";
  if (label === "GND") return "ground";
  if (label === "?") return "unknown";
  if (label === "NC") return "unused";
  return "signal";
}

export function freeConfigurablePinIndices(modes: readonly number[]): number[] {
  return modes.map((_, index) => index).filter((index) => (modes[index]! & 15) === 0);
}

/**
 * Bus / 1-Wire signal bases that must stay unique on the Function bay
 * (one SDA, one SCL, one GPIO IN, one ADC, …). Re-assign is blocked until cleared.
 */
export const UNIQUE_SIGNAL_BASES = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
]);

/**
 * Module Function pad map from the connector silkscreen:
 * A0–A3 → IO7–IO10, A4–A7 → IO12–IO15 (STATUS/IO11 is not configurable).
 * ADC/PWM channel is implied by the GPIO of the pin you drop onto — never pick it in UI.
 */
export type FunctionPinHardware = {
  readonly gpio: number;
  /** Connector pin number on the Function module (11–19 for A0–A7). */
  readonly connectorPin?: number;
  readonly adcUnit?: 1 | 2;
  readonly adcChannel?: number;
};

/** Mode index 0–7 → IO number on the SpaghettiLAB Function module. */
const FUNCTION_IO_BY_MODE_INDEX = [7, 8, 9, 10, 12, 13, 14, 15] as const;
const FUNCTION_CONNECTOR_PIN_BY_MODE_INDEX = [11, 12, 13, 14, 16, 17, 18, 19] as const;

/** ESP32-S3 ADC unit/channel for a GPIO (hidden from UI; used by bindings). */
function adcForGpio(gpio: number): Pick<FunctionPinHardware, "adcUnit" | "adcChannel"> {
  if (gpio >= 1 && gpio <= 10) return { adcUnit: 1, adcChannel: gpio - 1 };
  if (gpio >= 11 && gpio <= 20) return { adcUnit: 2, adcChannel: gpio - 11 };
  return {};
}

export function functionPinHardware(
  modeIndex: number,
  _variant: FunctionModuleVariant = "v2",
): FunctionPinHardware {
  const gpio = FUNCTION_IO_BY_MODE_INDEX[modeIndex] ?? 7 + modeIndex;
  const connectorPin = FUNCTION_CONNECTOR_PIN_BY_MODE_INDEX[modeIndex];
  return { gpio, connectorPin, ...adcForGpio(gpio) };
}

/** Silkscreen-style pad name (IO7 … IO15). */
export function formatGpioNumber(gpio: number): string {
  return `IO${gpio}`;
}

export function formatAdcChannel(hw: FunctionPinHardware): string | undefined {
  if (hw.adcUnit === undefined || hw.adcChannel === undefined) return undefined;
  return `ADC${hw.adcUnit}_CH${hw.adcChannel}`;
}

export type PlaceableSignal = PhysicalSignalDef & {
  readonly subtitle?: string;
};

export type GpioPlacementOptions = {
  /** Full mode byte for GPIO IN (1 / 17 pullup / 33 pulldown). */
  readonly inMode?: number;
  /** Full mode byte for GPIO OUT (2 / 3 high). */
  readonly outMode?: number;
};

/**
 * Draggable signals for a peripheral. ADC / PWM are single chips; GPIO exposes
 * IN and OUT. The drop target pin selects the MCU pad automatically.
 */
export function placeableSignalsForKind(
  kind: PortInterfaceKind,
  _modes: readonly number[] = [],
  _variant: FunctionModuleVariant = "v2",
  gpio: GpioPlacementOptions = {},
): readonly PlaceableSignal[] {
  if (kind === "adc") {
    return [{ id: "adc", label: "ADC", mode: 14 }];
  }
  if (kind === "pwm") {
    return [{ id: "pwm", label: "PWM", mode: 12 }];
  }
  if (kind === "gpio") {
    const inMode = gpio.inMode ?? 1;
    const outMode = gpio.outMode ?? 2;
    return [
      { id: "gpio-in", label: "GPIO IN", mode: inMode },
      { id: "gpio-out", label: "GPIO OUT", mode: outMode },
    ];
  }
  return signalsForInterface(kind).map((signal) => ({ ...signal }));
}

/** Remap every GPIO IN / OUT pin to the current settings modes. */
export function applyGpioSettingsToModes(
  modes: readonly number[],
  gpio: Required<GpioPlacementOptions>,
): number[] {
  return modes.map((mode) => {
    const base = mode & 15;
    if (base === 1) return gpio.inMode;
    if (base === 2 || base === 3) return gpio.outMode;
    return mode;
  });
}

/** Assign `mode` onto a configurable mode index. Unique bases clear siblings. */
export function assignModeToPin(
  modes: readonly number[],
  pinIndex: number,
  mode: number,
): number[] {
  const base = mode & 15;
  const unique = UNIQUE_SIGNAL_BASES.has(base);
  return modes.map((current, index) => {
    if (index === pinIndex) return mode;
    if (unique && (current & 15) === base && base !== 0) return 0;
    return current;
  });
}

function variantFromModes(modes: readonly number[]): FunctionModuleVariant {
  return modes.length === 8 ? "v2" : "v1";
}

/** Pin ids still free for a unique bus signal (or already holding it). */
export function availablePinsForSignal(
  modes: readonly number[],
  signalMode: number,
  variant: FunctionModuleVariant = variantFromModes(modes),
): readonly number[] {
  return modes
    .map((_, index) => index)
    .filter((index) => {
      const base = modes[index]! & 15;
      return base === 0 || base === (signalMode & 15);
    })
    .map((index) => modeIndexToPinId(index, variant));
}

/** Free pins plus the pin this GPIO/PWM instance already occupies. */
export function availablePinsForExclusiveSlot(
  modes: readonly number[],
  currentPin: number,
  variant: FunctionModuleVariant = variantFromModes(modes),
): readonly number[] {
  const currentIndex = pinIdToModeIndex(currentPin, variant);
  return modes
    .map((_, index) => index)
    .filter((index) => (modes[index]! & 15) === 0 || index === currentIndex)
    .map((index) => modeIndexToPinId(index, variant));
}

/** Move one pin’s mode to another slot without clearing sibling GPIOs. */
export function movePinAssignment(
  modes: readonly number[],
  fromPin: number,
  toPin: number,
  variant: FunctionModuleVariant = variantFromModes(modes),
): number[] {
  if (fromPin === toPin) return [...modes];
  const from = pinIdToModeIndex(fromPin, variant);
  const to = pinIdToModeIndex(toPin, variant);
  const mode = modes[from]!;
  return modes.map((current, index) => {
    if (index === to) return mode;
    if (index === from) return 0;
    return current;
  });
}

function pushBusInstance(
  instances: PortInterfaceInstance[],
  kind: PortInterfaceKind,
  modes: readonly number[],
  defs: readonly PhysicalSignalDef[],
  variant: FunctionModuleVariant,
): void {
  const signals: PortSignalBinding[] = [];
  for (const def of defs) {
    const index = modes.findIndex((mode) => (mode & 15) === def.mode);
    if (index >= 0) {
      signals.push({
        signalId: def.id,
        label: def.label,
        mode: def.mode,
        pin: modeIndexToPinId(index, variant),
      });
    }
  }
  if (signals.length === 0) return;
  instances.push({
    id: `${kind}-1`,
    kind,
    ordinal: 1,
    signals,
  });
}

/** On-board STATUS indicator — fixed MCU pad, not a Module Function pin (IO11). */
export const STATUS_LED_GPIO = 11;
export const STATUS_LED_LABEL = "STATUS LED";

/** True when Module Function modes already expose this bus/peripheral. */
export function modesProvideBus(
  modes: readonly number[] | undefined,
  bus: "i2c" | "spi" | "uart" | "adc" | "gpio" | "w1",
): boolean {
  if (!modes || modes.length === 0) return false;
  const kinds = new Set(derivePortInterfaces(modes).map((item) => item.kind));
  if (bus === "gpio") return kinds.has("gpio") || freeConfigurablePinIndices(modes).length > 0;
  return kinds.has(bus);
}

/** First saved draft for a core binding (any attached Backbone). */
export function draftModesForBinding(
  project: PhysicalProject,
  bindingId: string | undefined | null,
): readonly number[] | undefined {
  if (!bindingId) return undefined;
  const prefix = `${bindingId}:`;
  for (const [key, draft] of Object.entries(project.drafts)) {
    if (key.startsWith(prefix) && draft.modes?.length) return draft.modes;
  }
  return undefined;
}

/**
 * Derives interface instances from the firmware modes map (4 or 8 channels).
 * Mixed peripherals on one port are first-class (I2C + UART, I2C + GPIO + PWM, …).
 * Firmware currently allows at most one I2C / UART / SPI peripheral on this bay.
 */
export function derivePortInterfaces(
  modes: readonly number[],
  variant: FunctionModuleVariant = variantFromModes(modes),
): PortInterfaceInstance[] {
  const instances: PortInterfaceInstance[] = [];
  pushBusInstance(instances, "i2c", modes, signalsForInterface("i2c"), variant);
  pushBusInstance(instances, "uart", modes, signalsForInterface("uart"), variant);
  pushBusInstance(instances, "spi", modes, signalsForInterface("spi"), variant);
  pushBusInstance(instances, "w1", modes, signalsForInterface("w1"), variant);

  let gpioOrdinal = 0;
  let pwmOrdinal = 0;
  let adcOrdinal = 0;
  modes.forEach((mode, index) => {
    const base = mode & 15;
    if (base === 1 || base === 2 || base === 3) {
      gpioOrdinal += 1;
      instances.push({
        id: `gpio-${gpioOrdinal}`,
        kind: "gpio",
        ordinal: gpioOrdinal,
        signals: [
          {
            signalId: "gpio",
            label: labelForMode(mode),
            mode,
            pin: modeIndexToPinId(index, variant),
          },
        ],
      });
    } else if (base === 12) {
      pwmOrdinal += 1;
      instances.push({
        id: `pwm-${pwmOrdinal}`,
        kind: "pwm",
        ordinal: pwmOrdinal,
        signals: [
          {
            signalId: "pwm",
            label: "PWM",
            mode: 12,
            pin: modeIndexToPinId(index, variant),
          },
        ],
      });
    } else if (base === 14) {
      adcOrdinal += 1;
      instances.push({
        id: `adc-${adcOrdinal}`,
        kind: "adc",
        ordinal: adcOrdinal,
        signals: [
          {
            signalId: "adc",
            label: "ADC",
            mode: 14,
            pin: modeIndexToPinId(index, variant),
          },
        ],
      });
    }
  });
  return instances;
}

/** Compact hardware-style name: I2C0, GPIO0, UART1, … */
export function numberedPeripheralName(
  kind: PortInterfaceKind,
  ordinal: number,
  busUnits?: PhysicalBusUnits,
  w1Config?: W1PeripheralConfig,
): string {
  if (kind === "w1") {
    return w1Config?.name?.trim() || `1-Wire ${Math.max(0, (busUnits?.w1 ?? 0))}`;
  }
  if (isBusPortKind(kind)) {
    return busUnitLabel(kind, selectedBusUnit({ busUnits }, kind));
  }
  // 0-based like ESP32 controller indexes
  return `${peripheralLabel(kind)}${Math.max(0, ordinal - 1)}`;
}

export function interfaceDisplayName(
  instance: PortInterfaceInstance,
  busUnits?: PhysicalBusUnits,
  w1Config?: W1PeripheralConfig,
): string {
  return numberedPeripheralName(instance.kind, instance.ordinal, busUnits, w1Config);
}

export function peripheralLabel(kind: PortInterfaceKind): string {
  const labels: Record<PortInterfaceKind, string> = {
    gpio: "GPIO",
    i2c: "I2C",
    uart: "UART",
    spi: "SPI",
    pwm: "PWM",
    w1: "1-Wire",
    adc: "ADC",
  };
  return labels[kind];
}

/** Ensure w1Config exists when a DQ pin is assigned. */
export function ensureW1Config(draft: BackbonePhysicalDraft): BackbonePhysicalDraft {
  const hasW1 = draft.modes.some((m) => (m & 15) === 13);
  if (!hasW1) return draft;
  if (draft.w1Config) return draft;
  return {
    ...draft,
    busUnits: { ...draft.busUnits, w1: draft.busUnits?.w1 ?? 0 },
    w1Config: { ...DEFAULT_W1_CONFIG },
  };
}

/** Kinds that expose numbered ESP32-S3 controllers in the picker. */
export type BusPortKind = "i2c" | "spi" | "uart";

export function isBusPortKind(kind: PortInterfaceKind): kind is BusPortKind {
  return kind === "i2c" || kind === "spi" || kind === "uart";
}

/**
 * ESP32-S3 controllers available on Module Function.
 * SPI0/SPI1 are flash — only SPI2/SPI3 are offered.
 */
export const ESP32_S3_BUS_UNITS: Record<BusPortKind, readonly number[]> = {
  i2c: [0, 1],
  spi: [2, 3],
  uart: [0, 1, 2],
};

export function busUnitLabel(kind: BusPortKind, unit: number): string {
  return `${peripheralLabel(kind)}${unit}`;
}

export function defaultBusUnit(kind: BusPortKind): number {
  return ESP32_S3_BUS_UNITS[kind][0]!;
}

export function selectedBusUnit(
  draft: Pick<BackbonePhysicalDraft, "busUnits">,
  kind: BusPortKind,
): number {
  const current = draft.busUnits?.[kind];
  if (current !== undefined && ESP32_S3_BUS_UNITS[kind].includes(current)) return current;
  return defaultBusUnit(kind);
}

/** True when this signal mode byte is already on at least one Function pin. */
export function signalModeIsPlaced(modes: readonly number[], signalMode: number): boolean {
  const base = signalMode & 15;
  return modes.some((mode) => (mode & 15) === base && base !== 0);
}

/**
 * Peripherals offered in the picker (capability-gated). Always listed so the
 * user can activate one and drag its signals — incomplete buses fail validate.
 */
export function availablePeripheralKinds(
  capabilities: number,
  extended: boolean,
): readonly PortInterfaceKind[] {
  // GPIO + ADC are always offered for Module Function authoring.
  const out: PortInterfaceKind[] = ["gpio", "adc"];
  if (capabilities & PHYSICAL_CAP.I2C || capabilities === 0) out.push("i2c");
  if (extended && (capabilities & PHYSICAL_CAP.UART || capabilities === 0)) out.push("uart");
  if (extended && (capabilities & PHYSICAL_CAP.SPI || capabilities === 0)) out.push("spi");
  if (extended && (capabilities & PHYSICAL_CAP.PWM || capabilities === 0)) out.push("pwm");
  if (capabilities & PHYSICAL_CAP.W1 || capabilities === 0) out.push("w1");
  return out;
}

/** Kinds that still fit free pins + MCU capabilities (firmware: one I2C/UART/SPI/W1 max). */
export function allocatableInterfaceKinds(
  modes: readonly number[],
  capabilities: number,
  extended: boolean,
): readonly PortInterfaceKind[] {
  const free = freeConfigurablePinIndices(modes).length;
  const bases = new Set(modes.map((mode) => mode & 15));
  const hasI2c = bases.has(4) || bases.has(5);
  const hasUart = bases.has(6) || bases.has(7);
  const hasSpi = bases.has(8) || bases.has(9) || bases.has(10) || bases.has(11);
  const hasW1 = bases.has(13);
  const out: PortInterfaceKind[] = [];
  if (free >= 1) out.push("gpio");
  if (free >= 1 && (capabilities & PHYSICAL_CAP.ADC)) out.push("adc");
  if (free >= 1 && extended && (capabilities & PHYSICAL_CAP.PWM)) out.push("pwm");
  if (free >= 1 && (capabilities & PHYSICAL_CAP.W1) && !hasW1) out.push("w1");
  if (free >= 2 && (capabilities & PHYSICAL_CAP.I2C) && !hasI2c) out.push("i2c");
  if (free >= 2 && extended && (capabilities & PHYSICAL_CAP.UART) && !hasUart) out.push("uart");
  if (free >= 4 && extended && (capabilities & PHYSICAL_CAP.SPI) && !hasSpi) out.push("spi");
  return out;
}

/** Place a new interface on the first free pin(s). Does not wipe existing assignments. */
export function addPortInterface(
  modes: readonly number[],
  kind: PortInterfaceKind,
): number[] {
  const free = freeConfigurablePinIndices(modes);
  const need = pinsRequiredForKind(kind);
  if (free.length < need) {
    throw new Error(`Need ${need} free pin(s) for ${kind}`);
  }
  const next = [...modes];
  const defs = signalsForInterface(kind);
  if (kind === "gpio") {
    next[free[0]!] = 2;
    return next;
  }
  defs.forEach((def, offset) => {
    next[free[offset]!] = def.mode;
  });
  return next;
}

export function removePortInterface(
  modes: readonly number[],
  instance: PortInterfaceInstance,
  variant: FunctionModuleVariant = variantFromModes(modes),
): number[] {
  const pins = new Set(
    instance.signals.map((signal) => pinIdToModeIndex(signal.pin, variant)),
  );
  return modes.map((mode, index) => (pins.has(index) ? 0 : mode));
}

/**
 * Drop a peripheral signal onto a pin. Occupied pins overwrite: the previous
 * peripheral is cleared from every pin it owned. A signal already placed on
 * another pin is refused (clear it first) — never duplicated.
 */
export function dropSignalOnPin(
  modes: readonly number[],
  signalMode: number,
  pinId: number,
  variant: FunctionModuleVariant = variantFromModes(modes),
): number[] {
  const index = pinIdToModeIndex(pinId, variant);
  if (index < 0 || index >= modes.length) return [...modes];
  const base = signalMode & 15;
  const existingIndex = modes.findIndex((mode) => (mode & 15) === base && base !== 0);
  if (existingIndex >= 0 && existingIndex !== index) {
    return [...modes];
  }
  let next = [...modes];
  const occupant = next[index]! & 15;
  if (occupant !== 0 && occupant !== base) {
    const victim = derivePortInterfaces(next, variant).find((item) =>
      item.signals.some((signal) => signal.pin === pinId),
    );
    if (victim) next = removePortInterface(next, victim, variant);
  }
  return assignModeToPin(next, index, signalMode);
}

/** Clear one configurable pin (and drop its whole peripheral if multi-signal). */
export function clearPinAssignment(
  modes: readonly number[],
  pinId: number,
  variant: FunctionModuleVariant = variantFromModes(modes),
): number[] {
  const victim = derivePortInterfaces(modes, variant).find((item) =>
    item.signals.some((signal) => signal.pin === pinId),
  );
  if (!victim) {
    const index = pinIdToModeIndex(pinId, variant);
    return modes.map((mode, i) => (i === index ? 0 : mode));
  }
  return removePortInterface(modes, victim, variant);
}

export function setInterfaceSignalPin(
  modes: readonly number[],
  signalMode: number,
  pinNumber: number,
  variant: FunctionModuleVariant = variantFromModes(modes),
): number[] {
  return assignModeToPin(modes, pinIdToModeIndex(pinNumber, variant), signalMode);
}

export function setGpioModeOnPin(
  modes: readonly number[],
  pinNumber: number,
  gpioMode: number,
  variant: FunctionModuleVariant = variantFromModes(modes),
): number[] {
  const index = pinIdToModeIndex(pinNumber, variant);
  return modes.map((mode, i) => (i === index ? gpioMode : mode));
}

/** @deprecated Prefer derivePortInterfaces — kept for older call sites. */
export type PhysicalInterfaceKind = PortInterfaceKind;

/** @deprecated Single-kind view; use derivePortInterfaces for mixed ports. */
export function interfaceKindFromModes(modes: readonly number[]): PhysicalInterfaceKind {
  const instances = derivePortInterfaces(modes);
  const bus = instances.find(
    (item) => item.kind === "spi" || item.kind === "uart" || item.kind === "i2c",
  );
  if (bus) return bus.kind;
  if (instances.some((item) => item.kind === "pwm")) return "pwm";
  return "gpio";
}

export const INTERFACE_PRESETS: Record<PhysicalInterfaceKind, readonly number[]> = {
  gpio: [0, 0, 0, 0],
  i2c: [4, 5, 0, 0],
  uart: [6, 7, 0, 0],
  spi: [8, 9, 10, 11],
  pwm: [12, 0, 0, 0],
  w1: [13, 0, 0, 0],
  adc: [14, 0, 0, 0],
};

export function topologyForBoard(
  status: GetStatusResponse | undefined,
  board: { readonly local: boolean; readonly nodeId: number },
): PhysicalBackbone | undefined {
  const bytes = board.local
    ? (status?.physical ?? status?.chainPeers?.find((peer) => peer.local)?.physical)
    : status?.chainPeers?.find((peer) => !peer.local && peer.nodeId === board.nodeId)
        ?.physical;
  return bytes ? decodePhysicalBackbone(bytes) : undefined;
}

export function tagForSlot(
  status: GetStatusResponse | undefined,
  board: { readonly local: boolean; readonly nodeId: number },
  slot: number,
): NfcTagStatus | undefined {
  return status?.nfcTags?.find(
    (tag) =>
      tag.portId === slot &&
      (board.local ? tag.local : !tag.local && tag.nodeId === board.nodeId),
  );
}

export function validatePhysicalModes(
  modes: readonly number[],
  speed: number,
): string | undefined {
  if (
    (modes.length !== 4 && modes.length !== 8) ||
    modes.some(
      (mode) =>
        !Number.isInteger(mode) ||
        mode < 0 ||
        mode > 255 ||
        (mode & 15) > 14 ||
        (mode & 0xc0) !== 0 ||
        (mode & 0x30) === 0x30 ||
        ((mode & 15) !== 1 && (mode & 0x30) !== 0),
    )
  )
    return "Invalid pin map";
  if (speed !== 0 && speed !== 1) return "Invalid I²C speed";
  const bases = modes.map((mode) => mode & 15);
  for (const group of [
    [4, 5],
    [6, 7],
    [8, 9, 10, 11],
  ]) {
    if (
      bases.some((base) => group.includes(base)) &&
      group.some((base) => bases.filter((value) => value === base).length !== 1)
    )
      return (
        "Assegna una volta tutti i segnali dell’interfaccia: " +
        group.map((base) => labelForMode(base)).join(", ")
      );
  }
  if (bases.filter((base) => base === 13).length > 1) {
    return "One Wire DQ can be assigned to only one pin";
  }
  return undefined;
}

/** Reject incomplete electrical imports; legacy metadata entries remain display-only. */
export function parsePhysicalCatalog(raw: string): readonly PhysicalCatalogEntry[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length > 256)
    throw new Error("Expected a catalog array (maximum 256 modules)");
  const identities = new Set<string>();
  return parsed.map((value: unknown) => {
    if (!value || typeof value !== "object") throw new Error("Invalid catalog entry");
    const entry = value as PhysicalCatalogEntry;
    if (
      ![entry.registryId, entry.vendorId, entry.moduleTypeId].every(
        (id) => Number.isInteger(id) && id > 0,
      ) ||
      entry.registryId > 65535 ||
      entry.vendorId > 65535 ||
      entry.moduleTypeId > 0xffffffff ||
      typeof entry.name !== "string" ||
      !entry.name.trim()
    )
      throw new Error("Missing module identity or name");
    const key = `${entry.registryId}:${entry.vendorId}:${entry.moduleTypeId}`;
    if (identities.has(key)) throw new Error(`Duplicate module ${key}`);
    identities.add(key);
    if (
      entry.pins &&
      ((entry.pins.length !== 6 && entry.pins.length !== 12) ||
        !entry.pins.every((pin) => typeof pin === "string" && pin.length <= 40))
    )
      throw new Error("Each module must describe 6 (V1) or 12 (V2) pins");
    if (
      entry.modes &&
      (!entry.pins ||
        validatePhysicalModes(entry.modes, entry.i2cSpeed ?? 0) ||
        entry.pins.some((pin, i) => {
          const expected = pinsForModes(entry.modes!);
          if (pin === expected[i]) return false;
          const variant = entry.modes!.length === 8 ? "v2" : "v1";
          if (variant === "v1" && i > 0 && i < 5 && [2, 3].includes(entry.modes![i - 1]!)) {
            return !["GPIO OUT", "GPIO OUT HIGH", "GPIO OUT · 0", "GPIO OUT · 1"].includes(pin);
          }
          return true;
        }))
    )
      throw new Error("Invalid Module Function electrical definition");
    if (entry.settings) encodePhysicalSettings(entry.settings);
    return entry;
  });
}
