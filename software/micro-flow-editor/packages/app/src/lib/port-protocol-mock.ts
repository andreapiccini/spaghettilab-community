/**
 * Authoring-only mock for Port pin maps and custom module protocols.
 * Not GraphState, not AuthoringMetadata, not firmware — local UI state
 * until the Core can store a real pin↔signal map and field schema.
 */

export type LogicalPeripheral = "unused" | "uart" | "i2c" | "spi" | "can" | "gpio" | "adc" | "pwm" | "dac" | "w1" | "vcc" | "gnd";

export type PinAssignment = {
  readonly pinIndex: number;
  readonly peripheral: LogicalPeripheral;
  readonly signal: string;
  readonly label: string;
  readonly settings?: PinLineSettings;
};

export type PortPinMap = {
  readonly portId: number;
  readonly pins: readonly PinAssignment[];
};

export type ProtocolFieldType = "int" | "bool" | "string" | "bytes";
export type ProtocolFieldRole = "read" | "write" | "status";
export type ProtocolAddressing = { readonly kind: "register"; readonly offset: string } | { readonly kind: "at"; readonly command: string };

export type MappingAccess = "read" | "write" | "read-write" | "event";
export type MappingDataType = "int" | "uint" | "float" | "bool" | "string" | "bytes";
export type Endianness = "le" | "be";
export type ProtocolMode = "custom" | "integrated";

export type DialectKind = "gpio" | "adc" | "pwm" | "dac" | "i2c" | "spi" | "uart" | "raw-serial" | "at" | "modbus-rtu" | "can" | "w1";

export type AdcSettings = { readonly resolution: string; readonly rangeMin: string; readonly rangeMax: string };
export type PwmSettings = { readonly frequencyHz: string };
export type DacSettings = { readonly resolution: string; readonly rangeMin: string; readonly rangeMax: string };
export type I2cSettings = { readonly address: string; readonly busHz: string; readonly registerWidth: "8" | "16"; readonly timeoutMs: string };
export type SpiSettings = {
  readonly chipSelect: string;
  readonly mode: "0" | "1" | "2" | "3";
  readonly frequencyHz: string;
  readonly bitOrder: "msb" | "lsb";
  readonly rwMask: string;
  readonly autoIncrementMask: string;
  readonly dummyBytes: string;
  readonly csMode: "auto" | "manual";
};
export type SerialSettings = {
  readonly baud: string;
  readonly dataBits: "7" | "8";
  readonly parity: "none" | "even" | "odd";
  readonly stopBits: "1" | "2";
  readonly flowControl: "none" | "rts-cts";
  readonly timeoutMs: string;
  readonly frameFormat: "terminator" | "fixed" | "csv" | "json" | "regex" | "binary";
  readonly terminator: string;
  readonly frameLength: string;
};
export type AtSettings = {
  readonly baud: string;
  readonly dataBits: "7" | "8";
  readonly parity: "none" | "even" | "odd";
  readonly stopBits: "1" | "2";
  readonly flowControl: "none" | "rts-cts";
  readonly terminator: string;
  readonly timeoutMs: string;
  readonly okToken: string;
  readonly errorToken: string;
  readonly echo: boolean;
  readonly urc: boolean;
};
export type ModbusSettings = {
  readonly baud: string;
  readonly dataBits: "7" | "8";
  readonly parity: "none" | "even" | "odd";
  readonly stopBits: "1" | "2";
  readonly rs485: boolean;
  readonly slaveId: string;
  readonly timeoutMs: string;
  readonly retries: string;
  readonly gapMs: string;
  readonly addressing: "zero" | "doc";
};
export type CanSettings = { readonly bitrate: string; readonly frame: "standard" | "extended"; readonly filters: string; readonly mode: "raw" | "dbc" };
export type W1Settings = { readonly rom: string; readonly family: string; readonly timeoutMs: string };

export type DialectSettings =
  | { readonly kind: "gpio" }
  | ({ readonly kind: "adc" } & AdcSettings)
  | ({ readonly kind: "pwm" } & PwmSettings)
  | ({ readonly kind: "dac" } & DacSettings)
  | ({ readonly kind: "i2c" } & I2cSettings)
  | ({ readonly kind: "spi" } & SpiSettings)
  | ({ readonly kind: "uart" } & SerialSettings)
  | ({ readonly kind: "raw-serial" } & SerialSettings)
  | ({ readonly kind: "at" } & AtSettings)
  | ({ readonly kind: "modbus-rtu" } & ModbusSettings)
  | ({ readonly kind: "can" } & CanSettings)
  | ({ readonly kind: "w1" } & W1Settings);

export type GpioSpec = {
  readonly kind: "gpio";
  readonly direction: "input" | "output";
  readonly polarity: "high" | "low";
  readonly pull: "none" | "up" | "down";
  readonly debounceMs: string;
  readonly edge: "none" | "rising" | "falling" | "both";
  readonly initial: string;
  readonly safeState: string;
};
export type AdcSpec = { readonly kind: "adc"; readonly rawMin: string; readonly rawMax: string; readonly filter: string; readonly sampleHz: string };
export type PwmSpec = {
  readonly kind: "pwm";
  readonly dutyMin: string;
  readonly dutyMax: string;
  readonly initial: string;
  readonly safeState: string;
  readonly rangeMin: string;
  readonly rangeMax: string;
};
export type DacSpec = {
  readonly kind: "dac";
  readonly resolution: string;
  readonly rangeMin: string;
  readonly rangeMax: string;
  readonly rawMin: string;
  readonly rawMax: string;
  readonly initial: string;
  readonly safeState: string;
};
export type AdcLineSettings = AdcSpec & AdcSettings;
export type PwmLineSettings = PwmSpec & PwmSettings & { readonly polarity: "high" | "low" };
export type PinLineSettings = GpioSpec | AdcLineSettings | PwmLineSettings | DacSpec;
export type I2cSpec = {
  readonly kind: "i2c";
  readonly register: string;
  readonly length: string;
  readonly signed: boolean;
  readonly endian: Endianness;
  readonly bitStart: string;
  readonly bitEnd: string;
};
export type SpiSpec = {
  readonly kind: "spi";
  readonly command: string;
  readonly length: string;
  readonly signed: boolean;
  readonly endian: Endianness;
  readonly bitfield: string;
};
export type UartSpec = {
  readonly kind: "uart" | "raw-serial";
  readonly source: "json" | "csv" | "regex" | "binary";
  readonly path: string;
  readonly command: string;
};
export type AtSpec = {
  readonly kind: "at";
  readonly readCommand: string;
  readonly writeCommand: string;
  readonly responsePattern: string;
  readonly extractField: string;
  readonly params: string;
};
export type ModbusSpec = {
  readonly kind: "modbus-rtu";
  readonly table: "coil" | "discrete" | "input" | "holding";
  readonly address: string;
  readonly quantity: string;
  readonly functionCode: string;
  readonly byteOrder: "abcd" | "badc" | "cdab" | "dcba";
  readonly wordOrder: "ab" | "ba";
};
export type CanSpec = {
  readonly kind: "can";
  readonly canId: string;
  readonly startBit: string;
  readonly bitLength: string;
  readonly signed: boolean;
  readonly endian: Endianness;
};
export type W1Spec = { readonly kind: "w1"; readonly command: string; readonly offset: string; readonly length: string };

export type MappingSpec = GpioSpec | AdcSpec | PwmSpec | DacSpec | I2cSpec | SpiSpec | UartSpec | AtSpec | ModbusSpec | CanSpec | W1Spec;

export type ProtocolField = {
  readonly id: string;
  readonly name: string;
  readonly label: string;
  readonly identifier: string;
  readonly type: ProtocolFieldType;
  readonly role: ProtocolFieldRole;
  readonly access: MappingAccess;
  readonly dataType: MappingDataType;
  readonly scale: string;
  readonly offset: string;
  readonly unit: string;
  readonly updateHz: string;
  readonly addressing: ProtocolAddressing;
  readonly spec: MappingSpec;
};

export type CommandGroup = {
  readonly id: string;
  readonly name: string;
  readonly fieldIds: readonly string[];
};

export type CustomProtocol = {
  readonly id: string;
  readonly name: string;
  readonly portId?: number;
  readonly moduleNodeId?: string;
  readonly nativeTypeId?: string;
  readonly mode: ProtocolMode;
  readonly integratedModuleId?: string;
  readonly dialect: DialectKind;
  readonly settings: DialectSettings;
  readonly fields: readonly ProtocolField[];
  readonly groups: readonly CommandGroup[];
};

export const PERIPHERAL_LABEL: Record<LogicalPeripheral, string> = {
  unused: "Non usato",
  uart: "UART",
  i2c: "I2C",
  spi: "SPI",
  can: "CAN",
  gpio: "GPIO",
  adc: "ADC",
  pwm: "PWM",
  dac: "DAC",
  w1: "1-Wire",
  vcc: "VCC",
  gnd: "GND",
};

export const SIGNALS_FOR: Record<LogicalPeripheral, readonly string[]> = {
  unused: [],
  uart: ["TX", "RX", "RTS", "CTS"],
  i2c: ["SDA", "SCL"],
  spi: ["MOSI", "MISO", "SCLK", "CS"],
  can: ["TX", "RX"],
  gpio: ["IO"],
  adc: ["CH"],
  pwm: ["PWM"],
  dac: ["DAC"],
  w1: ["DATA"],
  vcc: ["VCC"],
  gnd: ["GND"],
};

export const DIALECT_LABEL: Record<DialectKind, string> = {
  gpio: "GPIO",
  adc: "ADC",
  pwm: "PWM",
  dac: "DAC",
  i2c: "I²C",
  spi: "SPI",
  uart: "UART",
  "raw-serial": "Raw Serial",
  at: "AT Commands",
  "modbus-rtu": "Modbus RTU",
  can: "CAN",
  w1: "1-Wire",
};

export const DIALECT_BLURB: Record<DialectKind, string> = {
  gpio: "Linea digitale, senza protocollo",
  adc: "Conversione analogica, senza protocollo",
  pwm: "Uscita PWM, senza protocollo",
  dac: "Conversione digitale-analogica, senza protocollo",
  i2c: "Mappa registri su bus I²C",
  spi: "Comandi e registri su SPI",
  uart: "Frame seriale (testo o binario)",
  "raw-serial": "Byte grezzi su UART",
  at: "Comandi AT e risposte URC",
  "modbus-rtu": "Slave, tabelle e function code",
  can: "Frame CAN, raw o DBC",
  w1: "ROM e comandi 1-Wire",
};

export const BUS_DIALECTS: readonly DialectKind[] = ["i2c", "spi", "uart", "modbus-rtu", "at", "can", "w1", "raw-serial"];
export const DIRECT_DIALECTS: readonly DialectKind[] = ["gpio", "adc", "pwm", "dac"];
export const BUS_PERIPHERALS: readonly LogicalPeripheral[] = ["i2c", "spi", "uart", "can", "w1"];
export const AUX_PERIPHERALS: readonly LogicalPeripheral[] = ["gpio", "adc", "pwm", "dac", "vcc", "gnd"];

export const DIALECTS_FOR_PERIPHERAL: Record<LogicalPeripheral, readonly DialectKind[]> = {
  unused: [],
  i2c: ["i2c"],
  spi: ["spi"],
  uart: ["uart", "modbus-rtu", "at", "raw-serial"],
  can: ["can"],
  w1: ["w1"],
  gpio: ["gpio"],
  adc: ["adc"],
  pwm: ["pwm"],
  dac: ["dac"],
  vcc: [],
  gnd: [],
};

export function isPowerPeripheral(peripheral: LogicalPeripheral): boolean {
  return peripheral === "vcc" || peripheral === "gnd";
}

export function isBusPeripheral(peripheral: LogicalPeripheral): boolean {
  return (BUS_PERIPHERALS as readonly LogicalPeripheral[]).includes(peripheral);
}

export function isExclusivePeripheral(peripheral: LogicalPeripheral): boolean {
  return isBusPeripheral(peripheral);
}

export function exclusivePeripheralOf(peripherals: readonly LogicalPeripheral[]): LogicalPeripheral | undefined {
  return peripherals.find(isExclusivePeripheral);
}

export function applyExclusivePin(map: PortPinMap, next: PinAssignment): PortPinMap {
  return {
    portId: map.portId,
    pins: map.pins.map((pin) => {
      if (pin.pinIndex === next.pinIndex) return next;
      if (isBusPeripheral(next.peripheral) && isBusPeripheral(pin.peripheral) && pin.peripheral !== next.peripheral) {
        return emptyPin(pin.pinIndex);
      }
      return pin;
    }),
  };
}

export function takenSignals(map: PortPinMap, peripheral: LogicalPeripheral, exceptPinIndex?: number): readonly string[] {
  return map.pins.filter((pin) => pin.peripheral === peripheral && pin.signal !== "" && pin.pinIndex !== exceptPinIndex).map((pin) => pin.signal);
}

export const LINE_SIGNAL: Partial<Record<LogicalPeripheral, string>> = {
  gpio: "IO",
  adc: "CH",
  pwm: "PWM",
  dac: "DAC",
};

export function isLinePeripheral(peripheral: LogicalPeripheral): peripheral is "gpio" | "adc" | "pwm" | "dac" {
  return peripheral === "gpio" || peripheral === "adc" || peripheral === "pwm" || peripheral === "dac";
}

export function nextFreeSignal(map: PortPinMap, peripheral: LogicalPeripheral, exceptPinIndex?: number): string {
  if (isLinePeripheral(peripheral)) return LINE_SIGNAL[peripheral] ?? "";
  const taken = new Set(takenSignals(map, peripheral, exceptPinIndex));
  return SIGNALS_FOR[peripheral].find((signal) => !taken.has(signal)) ?? "";
}

/** Bus lines that fill automatically; leftover pins stay free for GPIO / ADC / PWM. */
export const REQUIRED_SIGNALS: Partial<Record<LogicalPeripheral, readonly string[]>> = {
  uart: ["TX", "RX"],
  i2c: ["SDA", "SCL"],
  spi: ["MOSI", "MISO", "SCLK", "CS"],
  can: ["TX", "RX"],
  w1: ["DATA"],
};

export function nextRequiredSignal(map: PortPinMap, peripheral: LogicalPeripheral, exceptPinIndex?: number): string {
  const required = REQUIRED_SIGNALS[peripheral];
  if (!required) return nextFreeSignal(map, peripheral, exceptPinIndex);
  const taken = new Set(takenSignals(map, peripheral, exceptPinIndex));
  return required.find((signal) => !taken.has(signal)) ?? "";
}

export function nextOpenPinIndex(map: PortPinMap, afterPinIndex: number): number | undefined {
  const start = map.pins.findIndex((pin) => pin.pinIndex === afterPinIndex);
  if (start < 0) return map.pins.find((pin) => pin.peripheral === "unused")?.pinIndex;
  for (let i = 1; i <= map.pins.length; i += 1) {
    const pin = map.pins[(start + i) % map.pins.length];
    if (pin && pin.peripheral === "unused") return pin.pinIndex;
  }
  return undefined;
}

export type DialectSection = {
  readonly peripheral: LogicalPeripheral;
  readonly dialects: readonly DialectKind[];
};

export function peripheralOfDialect(kind: DialectKind): LogicalPeripheral {
  if (kind === "modbus-rtu" || kind === "at" || kind === "raw-serial") return "uart";
  if (kind === "gpio" || kind === "adc" || kind === "pwm" || kind === "dac" || kind === "i2c" || kind === "spi" || kind === "uart" || kind === "can" || kind === "w1") return kind;
  return "uart";
}

export function dialectSections(
  peripherals: readonly LogicalPeripheral[],
  available?: readonly LogicalPeripheral[],
): readonly DialectSection[] {
  const assigned = peripherals.filter((p) => DIALECTS_FOR_PERIPHERAL[p].some((d) => (BUS_DIALECTS as readonly DialectKind[]).includes(d)));
  const allowed = available ? assigned.filter((p) => available.includes(p)) : assigned;
  return allowed.map((peripheral) => ({ peripheral, dialects: DIALECTS_FOR_PERIPHERAL[peripheral] }));
}

/** Matches firmware `SPAGHETTI_FLOW_SIGNAL_COUNT` — never invent a wider connector. */
export const DEFAULT_SIGNAL_COUNT = 5;

/** Abstract Port letters — authoring never shows board pin numbers. */
export function pinLetter(pinIndex: number): string {
  if (pinIndex < 1) return "?";
  return String.fromCharCode(64 + pinIndex);
}

export function emptyPin(pinIndex: number): PinAssignment {
  return { pinIndex, peripheral: "unused", signal: "", label: "" };
}

export function defaultPinMap(portId: number, pinCount = DEFAULT_SIGNAL_COUNT): PortPinMap {
  const count = pinCount > 0 ? pinCount : DEFAULT_SIGNAL_COUNT;
  return { portId, pins: Array.from({ length: count }, (_, i) => emptyPin(i + 1)) };
}

export function resizePinMap(map: PortPinMap, pinCount: number): PortPinMap {
  const count = pinCount > 0 ? pinCount : DEFAULT_SIGNAL_COUNT;
  if (map.pins.length === count) return map;
  if (map.pins.length > count) return { portId: map.portId, pins: map.pins.slice(0, count) };
  return {
    portId: map.portId,
    pins: [...map.pins, ...Array.from({ length: count - map.pins.length }, (_, i) => emptyPin(map.pins.length + i + 1))],
  };
}

export function signalCountForPort(flows: readonly { readonly portId: number; readonly signalCount: number }[], portId: number): number {
  const flow = flows.find((f) => f.portId === portId);
  return flow && flow.signalCount > 0 ? flow.signalCount : DEFAULT_SIGNAL_COUNT;
}

export type DeclaredPort = {
  readonly portId: number;
  readonly flowId?: number;
  readonly signalCount: number;
  readonly fromCore: boolean;
  readonly capabilities?: number;
};

export function declaredPortsOf(
  topology: {
    readonly ports: readonly { readonly portId: number; readonly capabilities?: number }[];
    readonly flows: readonly { readonly portId: number; readonly flowId: number; readonly signalCount: number; readonly capabilities?: number }[];
  } | null,
  extraPortIds: readonly number[] = [],
): DeclaredPort[] {
  const byId = new Map<number, DeclaredPort>();
  for (const flow of topology?.flows ?? []) {
    byId.set(flow.portId, {
      portId: flow.portId,
      flowId: flow.flowId,
      signalCount: flow.signalCount > 0 ? flow.signalCount : DEFAULT_SIGNAL_COUNT,
      fromCore: true,
      ...(flow.capabilities !== undefined ? { capabilities: flow.capabilities } : {}),
    });
  }
  for (const port of topology?.ports ?? []) {
    if (!byId.has(port.portId)) {
      byId.set(port.portId, {
        portId: port.portId,
        signalCount: DEFAULT_SIGNAL_COUNT,
        fromCore: true,
        ...(port.capabilities !== undefined ? { capabilities: port.capabilities } : {}),
      });
    } else if (port.capabilities !== undefined && byId.get(port.portId)?.capabilities === undefined) {
      const current = byId.get(port.portId)!;
      byId.set(port.portId, { ...current, capabilities: port.capabilities });
    }
  }
  for (const id of extraPortIds) {
    if (Number.isInteger(id) && id >= 0 && !byId.has(id)) byId.set(id, { portId: id, signalCount: DEFAULT_SIGNAL_COUNT, fromCore: false });
  }
  return [...byId.values()].sort((a, b) => a.portId - b.portId);
}

export function assignedPinCount(map: PortPinMap): number {
  return map.pins.filter((p) => p.peripheral !== "unused").length;
}

export function assignedPeripherals(map: PortPinMap): readonly LogicalPeripheral[] {
  return [...new Set(map.pins.filter((p) => p.peripheral !== "unused").map((p) => p.peripheral))];
}

export function isDirectPeripheral(peripheral: LogicalPeripheral): boolean {
  return isLinePeripheral(peripheral);
}

/** Matches `spaghetti_port_capability` in `firmware/backbone/include/spaghetti/port.h`. */
export const PORT_CAP = {
  I2C: 1 << 0,
  SPI: 1 << 1,
  UART: 1 << 2,
  DIGITAL_INPUT: 1 << 3,
  DIGITAL_OUTPUT: 1 << 4,
  ADC: 1 << 5,
  W1: 1 << 6,
  PWM: 1 << 7,
  DAC: 1 << 8,
  CAN: 1 << 9,
} as const;

export function peripheralsFromCapabilities(capabilities: number | undefined): readonly LogicalPeripheral[] {
  const out: LogicalPeripheral[] = [];
  if (capabilities !== undefined) {
    if (capabilities & PORT_CAP.UART) out.push("uart");
    if (capabilities & PORT_CAP.I2C) out.push("i2c");
    if (capabilities & PORT_CAP.SPI) out.push("spi");
    if (capabilities & PORT_CAP.CAN) out.push("can");
    if (capabilities & (PORT_CAP.DIGITAL_INPUT | PORT_CAP.DIGITAL_OUTPUT)) out.push("gpio");
    if (capabilities & PORT_CAP.ADC) out.push("adc");
    if (capabilities & PORT_CAP.PWM) out.push("pwm");
    if (capabilities & PORT_CAP.DAC) out.push("dac");
    if (capabilities & PORT_CAP.W1) out.push("w1");
  }
  out.push("vcc", "gnd");
  return out;
}

export function gpioDirectionsFromCapabilities(capabilities: number | undefined): readonly ("input" | "output")[] {
  if (capabilities === undefined) return ["input", "output"];
  const dirs: ("input" | "output")[] = [];
  if (capabilities & PORT_CAP.DIGITAL_INPUT) dirs.push("input");
  if (capabilities & PORT_CAP.DIGITAL_OUTPUT) dirs.push("output");
  return dirs.length > 0 ? dirs : ["input", "output"];
}

export function emptyLineSettings(kind: "gpio", capabilities?: number): GpioSpec;
export function emptyLineSettings(kind: "adc", capabilities?: number): AdcLineSettings;
export function emptyLineSettings(kind: "pwm", capabilities?: number): PwmLineSettings;
export function emptyLineSettings(kind: "dac", capabilities?: number): DacSpec;
export function emptyLineSettings(kind: "gpio" | "adc" | "pwm" | "dac", capabilities?: number): PinLineSettings;
export function emptyLineSettings(kind: "gpio" | "adc" | "pwm" | "dac", capabilities?: number): PinLineSettings {
  if (kind === "gpio") {
    const dirs = gpioDirectionsFromCapabilities(capabilities);
    return { kind: "gpio", direction: dirs[0] ?? "input", polarity: "high", pull: "none", debounceMs: "20", edge: "both", initial: "0", safeState: "0" };
  }
  if (kind === "adc") {
    return { kind: "adc", rawMin: "0", rawMax: "4095", filter: "none", sampleHz: "10", resolution: "12", rangeMin: "0", rangeMax: "3300" };
  }
  if (kind === "pwm") {
    return { kind: "pwm", dutyMin: "0", dutyMax: "100", initial: "0", safeState: "0", rangeMin: "0", rangeMax: "100", frequencyHz: "1000", polarity: "high" };
  }
  return { kind: "dac", resolution: "8", rangeMin: "0", rangeMax: "3300", rawMin: "0", rawMax: "255", initial: "0", safeState: "0" };
}

export function normalizePinAssignment(pin: PinAssignment): PinAssignment {
  if (pin.peripheral === "gpio") {
    const fallback = emptyLineSettings("gpio");
    const existing = pin.settings?.kind === "gpio" ? pin.settings : { ...fallback, direction: pin.signal === "OUT" ? "output" : fallback.direction };
    return { ...pin, signal: LINE_SIGNAL.gpio ?? "IO", settings: existing };
  }
  if (pin.peripheral === "adc") {
    return { ...pin, signal: LINE_SIGNAL.adc ?? "CH", settings: pin.settings?.kind === "adc" ? pin.settings : emptyLineSettings("adc") };
  }
  if (pin.peripheral === "pwm") {
    return { ...pin, signal: LINE_SIGNAL.pwm ?? "PWM", settings: pin.settings?.kind === "pwm" ? pin.settings : emptyLineSettings("pwm") };
  }
  if (pin.peripheral === "dac") {
    return { ...pin, signal: LINE_SIGNAL.dac ?? "DAC", settings: pin.settings?.kind === "dac" ? pin.settings : emptyLineSettings("dac") };
  }
  return { pinIndex: pin.pinIndex, peripheral: pin.peripheral, signal: pin.signal, label: pin.label };
}

export function normalizePinMap(map: PortPinMap): PortPinMap {
  return { portId: map.portId, pins: map.pins.map(normalizePinAssignment) };
}

export function gpioDirectionOf(pin: PinAssignment): "input" | "output" {
  if (pin.settings?.kind === "gpio") return pin.settings.direction;
  return pin.signal === "OUT" ? "output" : "input";
}

export function isDirectOnly(peripherals: readonly LogicalPeripheral[]): boolean {
  const core = peripherals.filter((p) => !isPowerPeripheral(p));
  return core.length > 0 && core.every(isDirectPeripheral);
}

export function compatibleDialects(
  peripherals: readonly LogicalPeripheral[],
  available?: readonly LogicalPeripheral[],
): readonly DialectKind[] {
  const core = peripherals.filter((p) => !isPowerPeripheral(p));
  if (core.length === 0) return [];
  if (isDirectOnly(peripherals)) {
    return core.flatMap((p) => DIALECTS_FOR_PERIPHERAL[p]).filter((kind) => !available || available.includes(peripheralOfDialect(kind)));
  }
  return dialectSections(peripherals, available).flatMap((section) => section.dialects);
}

export function hasConfigurablePins(peripherals: readonly LogicalPeripheral[]): boolean {
  return peripherals.some((p) => !isPowerPeripheral(p) && p !== "unused");
}

export function defaultDirectDialect(peripherals: readonly LogicalPeripheral[]): DialectKind | undefined {
  const direct = compatibleDialects(peripherals);
  return isDirectOnly(peripherals) ? direct[0] : undefined;
}

export function roleFromAccess(access: MappingAccess): ProtocolFieldRole {
  if (access === "write" || access === "read-write") return "write";
  if (access === "event") return "status";
  return "read";
}

export function typeFromDataType(dataType: MappingDataType): ProtocolFieldType {
  if (dataType === "bool") return "bool";
  if (dataType === "string") return "string";
  if (dataType === "bytes") return "bytes";
  return "int";
}

export function emptySettings(kind: DialectKind): DialectSettings {
  const serial: SerialSettings = {
    baud: "115200",
    dataBits: "8",
    parity: "none",
    stopBits: "1",
    flowControl: "none",
    timeoutMs: "100",
    frameFormat: "terminator",
    terminator: "\\n",
    frameLength: "16",
  };
  switch (kind) {
    case "gpio":
      return { kind };
    case "adc":
      return { kind, resolution: "12", rangeMin: "0", rangeMax: "3300" };
    case "pwm":
      return { kind, frequencyHz: "1000" };
    case "dac":
      return { kind, resolution: "8", rangeMin: "0", rangeMax: "3300" };
    case "i2c":
      return { kind, address: "0x40", busHz: "400000", registerWidth: "8", timeoutMs: "20" };
    case "spi":
      return { kind, chipSelect: "0", mode: "0", frequencyHz: "1000000", bitOrder: "msb", rwMask: "0x80", autoIncrementMask: "0x40", dummyBytes: "0", csMode: "auto" };
    case "uart":
      return { kind, ...serial };
    case "raw-serial":
      return { kind, ...serial, frameFormat: "binary" };
    case "at":
      return { kind, baud: "115200", dataBits: "8", parity: "none", stopBits: "1", flowControl: "none", terminator: "\\r\\n", timeoutMs: "300", okToken: "OK", errorToken: "ERROR", echo: true, urc: true };
    case "modbus-rtu":
      return { kind, baud: "9600", dataBits: "8", parity: "none", stopBits: "1", rs485: true, slaveId: "1", timeoutMs: "200", retries: "2", gapMs: "20", addressing: "doc" };
    case "can":
      return { kind, bitrate: "500000", frame: "standard", filters: "", mode: "raw" };
    case "w1":
      return { kind, rom: "", family: "", timeoutMs: "750" };
  }
}

export function emptySpec(kind: DialectKind): MappingSpec {
  switch (kind) {
    case "gpio":
      return { kind, direction: "input", polarity: "high", pull: "none", debounceMs: "20", edge: "both", initial: "0", safeState: "0" };
    case "adc":
      return { kind, rawMin: "0", rawMax: "4095", filter: "none", sampleHz: "10" };
    case "pwm":
      return { kind, dutyMin: "0", dutyMax: "100", initial: "0", safeState: "0", rangeMin: "0", rangeMax: "100" };
    case "dac":
      return { kind, resolution: "8", rangeMin: "0", rangeMax: "3300", rawMin: "0", rawMax: "255", initial: "0", safeState: "0" };
    case "i2c":
      return { kind, register: "0x00", length: "2", signed: false, endian: "be", bitStart: "", bitEnd: "" };
    case "spi":
      return { kind, command: "0x00", length: "2", signed: false, endian: "be", bitfield: "" };
    case "uart":
    case "raw-serial":
      return { kind, source: kind === "raw-serial" ? "binary" : "json", path: "", command: "" };
    case "at":
      return { kind, readCommand: "", writeCommand: "", responsePattern: "", extractField: "", params: "" };
    case "modbus-rtu":
      return { kind, table: "holding", address: "1", quantity: "1", functionCode: "3", byteOrder: "abcd", wordOrder: "ab" };
    case "can":
      return { kind, canId: "0x100", startBit: "0", bitLength: "16", signed: false, endian: "be" };
    case "w1":
      return { kind, command: "0xBE", offset: "0", length: "2" };
  }
}

export function addressingFromSpec(spec: MappingSpec): ProtocolAddressing {
  switch (spec.kind) {
    case "i2c":
      return { kind: "register", offset: spec.register };
    case "spi":
      return { kind: "register", offset: spec.command };
    case "modbus-rtu":
      return { kind: "register", offset: spec.address };
    case "w1":
      return { kind: "register", offset: spec.offset };
    case "at":
      return { kind: "at", command: spec.readCommand || spec.writeCommand };
    case "uart":
    case "raw-serial":
      return spec.command !== "" ? { kind: "at", command: spec.command } : { kind: "register", offset: spec.path };
    default:
      return { kind: "register", offset: "" };
  }
}

export function emptyField(id: string, dialect: DialectKind = "i2c"): ProtocolField {
  const spec = emptySpec(dialect);
  return {
    id,
    name: "",
    label: "",
    identifier: "",
    type: "int",
    role: "read",
    access: "read",
    dataType: "int",
    scale: "1",
    offset: "0",
    unit: "",
    updateHz: "",
    addressing: addressingFromSpec(spec),
    spec,
  };
}

export function applyFieldPatch(field: ProtocolField, patch: Partial<Omit<ProtocolField, "spec">> & { readonly spec?: Partial<MappingSpec> }): ProtocolField {
  const spec = patch.spec ? ({ ...field.spec, ...patch.spec, kind: field.spec.kind } as MappingSpec) : field.spec;
  const access = patch.access ?? field.access;
  const dataType = patch.dataType ?? field.dataType;
  const label = patch.label ?? field.label;
  const name = patch.name ?? label;
  return {
    ...field,
    ...patch,
    spec,
    access,
    dataType,
    label,
    name,
    role: roleFromAccess(access),
    type: typeFromDataType(dataType),
    addressing: addressingFromSpec(spec),
  };
}

export function retargetField(field: ProtocolField, dialect: DialectKind): ProtocolField {
  if (field.spec.kind === dialect || (dialect === "raw-serial" && field.spec.kind === "uart") || (dialect === "uart" && field.spec.kind === "raw-serial")) {
    if (field.spec.kind === dialect) return field;
  }
  return applyFieldPatch({ ...field, spec: emptySpec(dialect) }, {});
}

export function emptyProtocol(id: string, name = "Protocollo personalizzato", dialect: DialectKind = "i2c"): CustomProtocol {
  return { id, name, mode: "custom", dialect, settings: emptySettings(dialect), fields: [], groups: [] };
}

export function protocolWithDialect(protocol: CustomProtocol, dialect: DialectKind): CustomProtocol {
  if (protocol.dialect === dialect && protocol.settings.kind === dialect) return protocol;
  return {
    ...protocol,
    dialect,
    name: protocol.mode === "integrated" ? protocol.name : DIALECT_LABEL[dialect],
    settings: emptySettings(dialect),
    fields: protocol.fields.map((field) => retargetField(field, dialect)),
    integratedModuleId: undefined,
    nativeTypeId: undefined,
    mode: "custom",
  };
}

export type IntegratedModule = {
  readonly id: string;
  readonly name: string;
  readonly dialect: DialectKind;
  readonly settings: DialectSettings;
  readonly fields: readonly Omit<ProtocolField, "id" | "addressing" | "role" | "type">[];
};

function integratedField(partial: Omit<ProtocolField, "id" | "addressing" | "role" | "type" | "spec"> & { readonly spec: MappingSpec }): Omit<ProtocolField, "id" | "addressing" | "role" | "type"> {
  return { ...partial, spec: partial.spec };
}

export const INTEGRATED_MODULES: readonly IntegratedModule[] = [
  {
    id: "preset.ina219",
    name: "Sensore INA219",
    dialect: "i2c",
    settings: { kind: "i2c", address: "0x40", busHz: "400000", registerWidth: "8", timeoutMs: "20" },
    fields: [
      integratedField({ label: "Bus voltage", name: "Bus voltage", identifier: "bus_voltage", access: "read", dataType: "uint", scale: "0.004", offset: "0", unit: "V", updateHz: "10", spec: { kind: "i2c", register: "0x02", length: "2", signed: false, endian: "be", bitStart: "", bitEnd: "" } }),
      integratedField({ label: "Shunt voltage", name: "Shunt voltage", identifier: "shunt_voltage", access: "read", dataType: "int", scale: "0.00001", offset: "0", unit: "V", updateHz: "10", spec: { kind: "i2c", register: "0x01", length: "2", signed: true, endian: "be", bitStart: "", bitEnd: "" } }),
      integratedField({ label: "Current", name: "Current", identifier: "current", access: "read", dataType: "int", scale: "1", offset: "0", unit: "mA", updateHz: "10", spec: { kind: "i2c", register: "0x04", length: "2", signed: true, endian: "be", bitStart: "", bitEnd: "" } }),
      integratedField({ label: "Power", name: "Power", identifier: "power", access: "read", dataType: "uint", scale: "1", offset: "0", unit: "mW", updateHz: "10", spec: { kind: "i2c", register: "0x03", length: "2", signed: false, endian: "be", bitStart: "", bitEnd: "" } }),
    ],
  },
  {
    id: "mod.sht30",
    name: "Sensore SHT30",
    dialect: "i2c",
    settings: { kind: "i2c", address: "0x44", busHz: "100000", registerWidth: "16", timeoutMs: "20" },
    fields: [
      integratedField({ label: "Temperatura", name: "Temperatura", identifier: "temperature", access: "read", dataType: "uint", scale: "0.00267", offset: "-45", unit: "°C", updateHz: "2", spec: { kind: "i2c", register: "0x2C06", length: "2", signed: false, endian: "be", bitStart: "", bitEnd: "" } }),
      integratedField({ label: "Umidità", name: "Umidità", identifier: "humidity", access: "read", dataType: "uint", scale: "0.00153", offset: "0", unit: "%", updateHz: "2", spec: { kind: "i2c", register: "0x2C06", length: "2", signed: false, endian: "be", bitStart: "16", bitEnd: "31" } }),
    ],
  },
  {
    id: "mod.ds18b20",
    name: "DS18B20",
    dialect: "w1",
    settings: { kind: "w1", rom: "", family: "0x28", timeoutMs: "750" },
    fields: [
      integratedField({ label: "Temperatura", name: "Temperatura", identifier: "temperature", access: "read", dataType: "int", scale: "0.0625", offset: "0", unit: "°C", updateHz: "1", spec: { kind: "w1", command: "0xBE", offset: "0", length: "2" } }),
    ],
  },
  {
    id: "mod.pzem004t",
    name: "PZEM-004T",
    dialect: "modbus-rtu",
    settings: { kind: "modbus-rtu", baud: "9600", dataBits: "8", parity: "none", stopBits: "1", rs485: true, slaveId: "1", timeoutMs: "200", retries: "2", gapMs: "20", addressing: "zero" },
    fields: [
      integratedField({ label: "Tensione", name: "Tensione", identifier: "voltage", access: "read", dataType: "uint", scale: "0.1", offset: "0", unit: "V", updateHz: "2", spec: { kind: "modbus-rtu", table: "input", address: "0", quantity: "1", functionCode: "4", byteOrder: "abcd", wordOrder: "ab" } }),
      integratedField({ label: "Corrente", name: "Corrente", identifier: "current", access: "read", dataType: "uint", scale: "0.001", offset: "0", unit: "A", updateHz: "2", spec: { kind: "modbus-rtu", table: "input", address: "1", quantity: "2", functionCode: "4", byteOrder: "abcd", wordOrder: "ab" } }),
    ],
  },
  {
    id: "mod.sim7600",
    name: "SIM7600",
    dialect: "at",
    settings: { kind: "at", baud: "115200", dataBits: "8", parity: "none", stopBits: "1", flowControl: "none", terminator: "\\r\\n", timeoutMs: "300", okToken: "OK", errorToken: "ERROR", echo: true, urc: true },
    fields: [
      integratedField({ label: "RSSI", name: "RSSI", identifier: "rssi", access: "read", dataType: "int", scale: "1", offset: "0", unit: "dBm", updateHz: "0.2", spec: { kind: "at", readCommand: "AT+CSQ", writeCommand: "", responsePattern: "+CSQ: <rssi>,<ber>", extractField: "rssi", params: "" } }),
      integratedField({ label: "Registrazione rete", name: "Registrazione rete", identifier: "creg", access: "event", dataType: "int", scale: "1", offset: "0", unit: "", updateHz: "", spec: { kind: "at", readCommand: "AT+CREG?", writeCommand: "", responsePattern: "+CREG: <n>,<stat>", extractField: "stat", params: "" } }),
    ],
  },
];

/** Demo presets so the picker is usable without a live Core catalog. */
export const KNOWN_PROTOCOL_PRESETS = INTEGRATED_MODULES.map((mod) => ({ id: mod.id, name: mod.name, fields: mod.fields }));

function materializeField(id: string, draft: Omit<ProtocolField, "id" | "addressing" | "role" | "type">): ProtocolField {
  return {
    ...draft,
    id,
    name: draft.name || draft.label,
    role: roleFromAccess(draft.access),
    type: typeFromDataType(draft.dataType),
    addressing: addressingFromSpec(draft.spec),
  };
}

export function protocolFromIntegrated(moduleId: string, id: string): CustomProtocol | undefined {
  const mod = INTEGRATED_MODULES.find((m) => m.id === moduleId);
  if (!mod) return undefined;
  return {
    id,
    name: mod.name,
    mode: "integrated",
    integratedModuleId: mod.id,
    dialect: mod.dialect,
    settings: mod.settings,
    fields: mod.fields.map((field, i) => materializeField(`${id}-f${i + 1}`, field)),
    groups: [],
  };
}

export function protocolFromPreset(presetId: string, id: string): CustomProtocol | undefined {
  return protocolFromIntegrated(presetId, id);
}

export type DriverSchemaField = {
  readonly fieldId: number;
  readonly name: string;
  readonly type: string;
  readonly description: string;
  readonly unit?: string;
};

export type InstalledDriverContent = {
  readonly typeId: string;
  readonly name: string;
  readonly blurb: string;
  readonly transport: string;
  readonly configSchema: string;
  readonly config: readonly DriverSchemaField[];
  readonly records: readonly DriverSchemaField[];
  readonly commands: readonly { readonly commandId: number; readonly name: string; readonly fields: readonly DriverSchemaField[] }[];
  readonly protocol?: CustomProtocol;
};

const KNOWN_INSTALLED_DRIVERS: Record<string, Omit<InstalledDriverContent, "typeId" | "protocol">> = {
  ina219: {
    name: "INA219",
    blurb: "Misuratore I²C di tensione, corrente e potenza.",
    transport: "I2C",
    configSchema: "spaghetti.ina219.config",
    config: [
      { fieldId: 1, name: "address", type: "uint64", description: "Indirizzo I²C a 7 bit", unit: "" },
      { fieldId: 2, name: "shunt_milliohm", type: "uint64", description: "Resistenza dello shunt", unit: "mΩ" },
      { fieldId: 3, name: "current_lsb_microamp", type: "uint64", description: "Peso LSB del registro corrente", unit: "µA" },
    ],
    records: [
      { fieldId: 1, name: "bus_voltage_microvolts", type: "int64", description: "Tensione di bus", unit: "µV" },
      { fieldId: 2, name: "current_microamps", type: "int64", description: "Corrente sullo shunt", unit: "µA" },
      { fieldId: 3, name: "power_microwatts", type: "uint64", description: "Potenza istantanea", unit: "µW" },
    ],
    commands: [],
  },
  relay: {
    name: "Relay",
    blurb: "Uscita digitale ON/OFF. Il pin GPIO resta della Porta.",
    transport: "GPIO",
    configSchema: "spaghetti.relay.config",
    config: [
      { fieldId: 1, name: "active_high", type: "bool", description: "Alto elettrico = ON logico" },
      { fieldId: 2, name: "safe_on", type: "bool", description: "Stato imposto in init e deinit" },
    ],
    records: [],
    commands: [{ commandId: 1, name: "set", fields: [{ fieldId: 1, name: "on", type: "bool", description: "Stato logico richiesto" }] }],
  },
  "declarative-device": {
    name: "Declarative device",
    blurb: "Esegue i Device Profile installati sul Core. Il contenuto dipende dal profilo, non da un sensore fisso.",
    transport: "Dal profilo",
    configSchema: "spaghetti.declarative-device.config",
    config: [
      { fieldId: 1, name: "profile_id", type: "text", description: "Identificatore del profilo" },
      { fieldId: 2, name: "profile_version", type: "uint64", description: "Versione del profilo" },
      { fieldId: 3, name: "profile_hash", type: "bytes", description: "Hash opzionale del profilo" },
      { fieldId: 4, name: "i2c_address", type: "uint64", description: "Indirizzo I²C opzionale" },
      { fieldId: 5, name: "spi_cs", type: "uint64", description: "Chip-select SPI opzionale" },
      { fieldId: 6, name: "adc_channel", type: "uint64", description: "Canale ADC opzionale" },
      { fieldId: 7, name: "spi_frequency_hz", type: "uint64", description: "Frequenza SPI opzionale", unit: "Hz" },
      { fieldId: 8, name: "w1_rom", type: "bytes", description: "ROM 1-Wire opzionale, 8 byte" },
    ],
    records: [],
    commands: [],
  },
};

export function contentForInstalledDriver(typeId: string): InstalledDriverContent {
  const known = KNOWN_INSTALLED_DRIVERS[typeId];
  const integrated = INTEGRATED_MODULES.find((mod) => mod.id === typeId || mod.id.endsWith(`.${typeId}`));
  const protocol = integrated ? protocolFromIntegrated(integrated.id, `core-${typeId}`) : undefined;
  if (known) return { typeId, ...known, protocol };
  return {
    typeId,
    name: typeId,
    blurb: "Driver presente sul Core. GET_CATALOG non espone ancora lo schema di questo tipo.",
    transport: "",
    configSchema: "",
    config: [],
    records: [],
    commands: [],
    protocol,
  };
}

export function sourceFieldsOf(protocol: CustomProtocol): readonly ProtocolField[] {
  return protocol.fields.filter((f) => f.access === "read" || f.access === "read-write" || f.access === "event" || f.role === "read" || f.role === "status");
}

/** Authoring-only numeric ids so RuleNodeData can keep fieldId/commandId until firmware has names. */
export function numericIdForField(protocol: CustomProtocol, fieldId: string): number {
  const i = protocol.fields.findIndex((f) => f.id === fieldId);
  return i >= 0 ? i + 1 : 0;
}

export function numericIdForGroup(protocol: CustomProtocol, groupId: string): number {
  const i = protocol.groups.findIndex((g) => g.id === groupId);
  return i >= 0 ? 1000 + i : 0;
}

export function commandTargetsOf(protocol: CustomProtocol): readonly { readonly id: string; readonly name: string; readonly kind: "field" | "group" }[] {
  const writes = protocol.fields
    .filter((f) => f.access === "write" || f.access === "read-write" || f.role === "write")
    .map((f) => ({ id: f.id, name: f.label || f.name, kind: "field" as const }));
  const groups = protocol.groups.map((g) => ({ id: g.id, name: g.name, kind: "group" as const }));
  return [...groups, ...writes];
}

export type SelectableSignal = {
  readonly id: string;
  readonly label: string;
  readonly numericId: number;
  readonly kind: "protocol-field" | "pin-signal" | "command-group";
  readonly role: "source" | "command";
};

/** Authoring ids for pin-level GPIO/ADC/PWM so they don't collide with protocol field indices. */
export const PIN_SIGNAL_ID_BASE = 2000;

export function pinSignalNumericId(pinIndex: number): number {
  return PIN_SIGNAL_ID_BASE + pinIndex;
}

function pinSignalRole(pin: PinAssignment): "source" | "command" | "both" | undefined {
  if (!isDirectPeripheral(pin.peripheral)) return undefined;
  if (pin.peripheral === "adc") return "source";
  if (pin.peripheral === "pwm" || pin.peripheral === "dac") return "command";
  return gpioDirectionOf(pin) === "output" ? "command" : "source";
}

function pinSignalLabel(pin: PinAssignment): string {
  if (pin.label.trim() !== "") return pin.label.trim();
  if (pin.peripheral === "gpio") return `GPIO ${gpioDirectionOf(pin) === "output" ? "OUT" : "IN"} · ${pinLetter(pin.pinIndex)}`;
  return `${PERIPHERAL_LABEL[pin.peripheral]} ${pin.signal} · ${pinLetter(pin.pinIndex)}`;
}

export function selectableSignalsForPort(map?: PortPinMap, protocol?: CustomProtocol): readonly SelectableSignal[] {
  const out: SelectableSignal[] = [];
  if (protocol) {
    for (const field of sourceFieldsOf(protocol)) {
      out.push({
        id: `f:${field.id}`,
        label: field.label || field.name || field.identifier || "Senza nome",
        numericId: numericIdForField(protocol, field.id),
        kind: "protocol-field",
        role: "source",
      });
    }
    for (const target of commandTargetsOf(protocol)) {
      out.push({
        id: `${target.kind}:${target.id}`,
        label: target.name,
        numericId: target.kind === "group" ? numericIdForGroup(protocol, target.id) : numericIdForField(protocol, target.id),
        kind: target.kind === "group" ? "command-group" : "protocol-field",
        role: "command",
      });
    }
  }
  for (const pin of map?.pins ?? []) {
    const role = pinSignalRole(pin);
    if (!role) continue;
    const label = pinSignalLabel(pin);
    const numericId = pinSignalNumericId(pin.pinIndex);
    if (role === "source" || role === "both") {
      out.push({ id: `pin:${pin.pinIndex}`, label, numericId, kind: "pin-signal", role: "source" });
    }
    if (role === "command" || role === "both") {
      out.push({ id: `pinw:${pin.pinIndex}`, label, numericId, kind: "pin-signal", role: "command" });
    }
  }
  return out;
}

export function signalsForRole(signals: readonly SelectableSignal[], role: "source" | "command"): readonly SelectableSignal[] {
  return signals.filter((signal) => signal.role === role);
}

export function labelForNumericSignal(numericId: number, map?: PortPinMap, protocol?: CustomProtocol): string | undefined {
  return selectableSignalsForPort(map, protocol).find((signal) => signal.numericId === numericId)?.label;
}

/**
 * Distinct hues first — a signal keeps its color until the palette is exhausted.
 * UART TX/RX stay brand-blue / error so existing cards don't jump.
 */
export const SIGNAL_PALETTE = [
  "var(--color-brand-blue)",
  "var(--color-error)",
  "var(--color-warning)",
  "var(--color-brand-purple-glow)",
  "var(--color-brand-cyan-glow)",
  "var(--color-success)",
  "#E67E22",
  "#1ABC9C",
  "#8E44AD",
  "#16A085",
  "#2980B9",
  "#D35400",
  "#7F8C8D",
  "#27AE60",
  "#F39C12",
  "#9B59B6",
  "#2C3E50",
  "#C9A227",
  "#4B5563",
] as const;

const SIGNAL_ASSIGN_ORDER: readonly LogicalPeripheral[] = ["uart", "i2c", "spi", "can", "gpio", "adc", "pwm", "dac", "w1", "vcc", "gnd"];

function assignUniqueSignalColors(): Record<LogicalPeripheral, Readonly<Record<string, string>>> {
  const out: Record<string, Record<string, string>> = { unused: {} };
  let index = 0;
  for (const peripheral of SIGNAL_ASSIGN_ORDER) {
    const next: Record<string, string> = {};
    for (const signal of SIGNALS_FOR[peripheral]) {
      next[signal] = SIGNAL_PALETTE[index] ?? SIGNAL_PALETTE[index % SIGNAL_PALETTE.length]!;
      index += 1;
    }
    out[peripheral] = next;
  }
  return out as Record<LogicalPeripheral, Readonly<Record<string, string>>>;
}

export const SIGNAL_COLOR: Record<LogicalPeripheral, Readonly<Record<string, string>>> = assignUniqueSignalColors();

export const PERIPHERAL_COLOR: Record<LogicalPeripheral, string> = {
  unused: "var(--color-border-strong)",
  uart: SIGNAL_COLOR.uart.TX ?? "var(--color-brand-blue)",
  i2c: SIGNAL_COLOR.i2c.SDA ?? "var(--color-brand-cyan-glow)",
  spi: SIGNAL_COLOR.spi.MOSI ?? "#E67E22",
  can: SIGNAL_COLOR.can.TX ?? "#2980B9",
  gpio: SIGNAL_COLOR.gpio.IO ?? "#7F8C8D",
  adc: SIGNAL_COLOR.adc.CH ?? "#27AE60",
  pwm: SIGNAL_COLOR.pwm.PWM ?? "#F39C12",
  dac: SIGNAL_COLOR.dac.DAC ?? "#C0392B",
  w1: SIGNAL_COLOR.w1.DATA ?? "#9B59B6",
  vcc: SIGNAL_COLOR.vcc.VCC ?? "#C9A227",
  gnd: SIGNAL_COLOR.gnd.GND ?? "#4B5563",
};

export function pinColor(pin: PinAssignment): string {
  if (pin.peripheral === "unused") return "var(--color-border)";
  return SIGNAL_COLOR[pin.peripheral][pin.signal] ?? PERIPHERAL_COLOR[pin.peripheral];
}

export type ConfiguredPortSummary = {
  readonly portId: number;
  readonly pins: readonly PinAssignment[];
  readonly protocolName?: string;
  readonly nativeTypeId?: string;
  readonly dialect?: DialectKind;
  readonly fields: readonly ProtocolField[];
  readonly fieldNames: readonly string[];
  readonly groupNames: readonly string[];
  readonly flowId?: number;
  readonly fromCore?: boolean;
};

export function summarizeConfiguredPort(portId: number, map: PortPinMap, protocol?: CustomProtocol, meta?: Pick<DeclaredPort, "flowId" | "fromCore">): ConfiguredPortSummary {
  return {
    portId,
    pins: map.pins,
    protocolName: protocol?.name,
    nativeTypeId: protocol?.nativeTypeId,
    dialect: protocol?.dialect,
    fields: protocol?.fields ?? [],
    fieldNames: protocol?.fields.map((f) => (f.label || f.name).trim()).filter((n) => n !== "") ?? [],
    groupNames: protocol?.groups.map((g) => g.name.trim()).filter((n) => n !== "") ?? [],
    flowId: meta?.flowId,
    fromCore: meta?.fromCore,
  };
}

export function assignedPeripheralKinds(pins: readonly PinAssignment[]): readonly LogicalPeripheral[] {
  return [...new Set(pins.filter((p) => p.peripheral !== "unused").map((p) => p.peripheral))];
}

export function fieldsForPeripheral(fields: readonly ProtocolField[], peripheral: LogicalPeripheral, dialect?: DialectKind): readonly ProtocolField[] {
  const matched = fields.filter((f) => peripheralOfDialect(f.spec.kind) === peripheral);
  if (matched.length > 0) return matched;
  if (dialect && peripheralOfDialect(dialect) === peripheral) return fields;
  return [];
}

export function compositionLines(field: ProtocolField): readonly { readonly label: string; readonly value: string }[] {
  const lines: { label: string; value: string }[] = [
    { label: "Identificatore", value: field.identifier },
    { label: "Accesso", value: field.access },
    { label: "Tipo", value: field.dataType },
    { label: "Scala", value: field.scale },
    { label: "Offset", value: field.offset },
    { label: "Unità", value: field.unit },
    { label: "Hz", value: field.updateHz },
  ];
  const spec = field.spec;
  switch (spec.kind) {
    case "i2c":
      lines.push({ label: "Registro", value: spec.register }, { label: "Lunghezza", value: spec.length }, { label: "Endian", value: spec.endian }, { label: "Bit", value: spec.bitStart && spec.bitEnd ? `${spec.bitStart}–${spec.bitEnd}` : "" });
      break;
    case "spi":
      lines.push({ label: "Comando", value: spec.command }, { label: "Lunghezza", value: spec.length }, { label: "Endian", value: spec.endian }, { label: "Bitfield", value: spec.bitfield });
      break;
    case "modbus-rtu":
      lines.push({ label: "Tabella", value: spec.table }, { label: "Indirizzo", value: spec.address }, { label: "Quantità", value: spec.quantity }, { label: "Funzione", value: spec.functionCode });
      break;
    case "at":
      lines.push({ label: "Lettura", value: spec.readCommand }, { label: "Scrittura", value: spec.writeCommand }, { label: "Pattern", value: spec.responsePattern }, { label: "Campo", value: spec.extractField });
      break;
    case "uart":
    case "raw-serial":
      lines.push({ label: "Origine", value: spec.source }, { label: "Percorso", value: spec.path }, { label: "Comando", value: spec.command });
      break;
    case "can":
      lines.push({ label: "CAN ID", value: spec.canId }, { label: "Start bit", value: spec.startBit }, { label: "Lunghezza", value: spec.bitLength });
      break;
    case "w1":
      lines.push({ label: "Comando", value: spec.command }, { label: "Offset", value: spec.offset }, { label: "Lunghezza", value: spec.length });
      break;
    case "gpio":
      lines.push({ label: "Direzione", value: spec.direction }, { label: "Polarità", value: spec.polarity }, { label: "Pull", value: spec.pull });
      break;
    case "adc":
      lines.push({ label: "Grezzo", value: `${spec.rawMin}–${spec.rawMax}` }, { label: "Filtro", value: spec.filter }, { label: "Sample", value: spec.sampleHz });
      break;
    case "pwm":
      lines.push({ label: "Duty", value: `${spec.dutyMin}–${spec.dutyMax}` }, { label: "Safe", value: spec.safeState });
      break;
    case "dac":
      lines.push({ label: "Range", value: `${spec.rangeMin}–${spec.rangeMax}` }, { label: "Risoluzione", value: spec.resolution }, { label: "Safe", value: spec.safeState });
      break;
  }
  return lines.filter((line) => line.value.trim() !== "");
}

export function pinCaption(pin: PinAssignment): string {
  if (pin.peripheral === "unused") return "";
  if (pin.label.trim() !== "") return pin.label.trim();
  if (pin.peripheral === "gpio") return `GPIO_${gpioDirectionOf(pin) === "output" ? "OUT" : "IN"}`;
  if (pin.signal !== "") return `${PERIPHERAL_LABEL[pin.peripheral]}_${pin.signal}`;
  return PERIPHERAL_LABEL[pin.peripheral];
}

export function pinPreviewSignal(pin: PinAssignment): string {
  if (pin.peripheral === "unused") return "";
  if (pin.peripheral === "gpio") return gpioDirectionOf(pin) === "output" ? "OUT" : "IN";
  return pin.signal || pinCaption(pin).slice(0, 4);
}

export function pinCompositionLines(pin: PinAssignment): readonly { readonly label: string; readonly value: string }[] {
  const settings = pin.settings;
  if (!settings) return [];
  if (settings.kind === "gpio") {
    return [
      { label: "Pin", value: pinLetter(pin.pinIndex) },
      { label: "Direzione", value: settings.direction },
      { label: "Polarità", value: settings.polarity },
      { label: "Pull", value: settings.pull },
      { label: "Debounce", value: settings.debounceMs },
      { label: "Edge", value: settings.edge },
      ...(settings.direction === "output"
        ? [
            { label: "Iniziale", value: settings.initial },
            { label: "Safe", value: settings.safeState },
          ]
        : []),
    ].filter((line) => line.value.trim() !== "");
  }
  if (settings.kind === "adc") {
    return [
      { label: "Pin", value: pinLetter(pin.pinIndex) },
      { label: "Risoluzione", value: settings.resolution },
      { label: "Range", value: `${settings.rangeMin}–${settings.rangeMax}` },
      { label: "Grezzo", value: `${settings.rawMin}–${settings.rawMax}` },
      { label: "Filtro", value: settings.filter },
      { label: "Sample", value: settings.sampleHz },
    ].filter((line) => line.value.trim() !== "");
  }
  if (settings.kind === "pwm") {
    return [
      { label: "Pin", value: pinLetter(pin.pinIndex) },
      { label: "Frequenza", value: settings.frequencyHz },
      { label: "Polarità", value: settings.polarity },
      { label: "Duty", value: `${settings.dutyMin}–${settings.dutyMax}` },
      { label: "Iniziale", value: settings.initial },
      { label: "Safe", value: settings.safeState },
    ].filter((line) => line.value.trim() !== "");
  }
  return [
    { label: "Pin", value: pinLetter(pin.pinIndex) },
    { label: "Risoluzione", value: settings.resolution },
    { label: "Range", value: `${settings.rangeMin}–${settings.rangeMax}` },
    { label: "Grezzo", value: `${settings.rawMin}–${settings.rawMax}` },
    { label: "Iniziale", value: settings.initial },
    { label: "Safe", value: settings.safeState },
  ].filter((line) => line.value.trim() !== "");
}

export function mappingCaption(field: ProtocolField): string {
  const spec = field.spec;
  switch (spec.kind) {
    case "i2c":
      return spec.register;
    case "spi":
      return spec.command;
    case "modbus-rtu":
      return `${spec.table} ${spec.address}`;
    case "at":
      return spec.readCommand || spec.writeCommand || "AT";
    case "uart":
    case "raw-serial":
      return spec.path || spec.command || spec.source;
    case "can":
      return spec.canId;
    case "w1":
      return spec.command;
    case "gpio":
      return spec.direction;
    case "adc":
      return `${spec.sampleHz} Hz`;
    case "pwm":
      return `duty ${spec.dutyMin}–${spec.dutyMax}`;
    case "dac":
      return `${spec.rangeMin}–${spec.rangeMax}`;
  }
}
