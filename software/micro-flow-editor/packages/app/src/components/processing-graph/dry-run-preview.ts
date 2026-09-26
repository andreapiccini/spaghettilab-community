import type { DeviceProcessingNodeData } from "@spaghettilab/device-processing-graph-model";
import { isBlockNodeData } from "@spaghettilab/device-processing-graph-model";
import type { GraphState } from "@spaghettilab/domain";
import { parseRgbLedConfig, rgbLedPlaybackAt, type RgbLineSignal } from "./rgb-led-model.js";

/** Catalog / type ids for Digital Out Toggle — flips the line after hysteresis ticks. */
export const DIGITAL_OUT_TOGGLE_IDS = new Set(["appblocks.digital_out_toggle", "ab.digital_out_toggle"]);

/** Catalog / type ids for the visual LED indicator (solid color swatch). */
export const LED_BLOCK_IDS = new Set(["appblocks.led", "ab.led"]);

/** RGB LED bay — sequence player (solid / breathe / blink / cycle / custom). */
export const RGB_LED_BLOCK_IDS = new Set(["appblocks.rgb_led", "ab.rgb_led"]);

/** Relay actuator — Backbone hardware contact. */
export const RELAY_BLOCK_IDS = new Set(["appblocks.relay", "ab.relay"]);

/** IF compare — firmware function, one digital or temperature input. */
export const COMPARE_IF_IDS = new Set(["appblocks.compare_if", "ab.compare_if"]);

/** Temperature sensor — Backbone hardware, feeds IF only. */
export const TEMPERATURE_SENSOR_IDS = new Set(["appblocks.temperature_sensor", "ab.temperature_sensor"]);

/** Terminal block bay input — 6 analog/digital channels. */
export const TERMINAL_BLOCK_IDS = new Set(["appblocks.terminal_block", "ab.terminal_block"]);

/** Circular flow Start — authoring entry that enables blocks downstream of Schedule. */
export const FLOW_START_IDS = new Set(["native.flow_start", "ab.flow_start"]);

export type CompareOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte";

export type IfActuatorDrive = {
  readonly kind: "if";
  readonly ifId: string;
  readonly compare: CompareOp;
  readonly thenOutput: "high" | "low";
  readonly compareLevel: "high" | "low";
  readonly compareTempC: number;
  readonly source:
    | { readonly kind: "toggle" }
    | { readonly kind: "temperature"; readonly testC: number }
    | { readonly kind: "none" };
};

export type ActuatorDrive = { readonly kind: "toggle" } | IfActuatorDrive;

export type RelayBinding = {
  readonly id: string;
  readonly closeWhenHigh: boolean;
  readonly drive?: ActuatorDrive;
};

export type LedActuatorBinding = {
  readonly id: string;
  /** Accende se comando (0–100) ≥ soglia. */
  readonly threshold: number;
  /** Invert comando before soglia (100 − level). */
  readonly negated: boolean;
  /** Wait after segnale ON before soft start. */
  readonly delayOnMs: number;
  /** Wait after segnale OFF before soft stop. */
  readonly delayOffMs: number;
  /** Soft-start: ms to ramp 0→1 after delay ON (0 = instant). */
  readonly softOnMs: number;
  /** Soft-stop: ms to ramp 1→0 after delay OFF (0 = instant). */
  readonly softOffMs: number;
  /** When set, LED follows IF output instead of the Toggle line. */
  readonly drive?: ActuatorDrive;
};

export type DryRunPreviewChannel = {
  /** Schedule driving this channel. */
  readonly triggerId: string;
  /** Schedule period — each tick advances the Digital Out Toggle hysteresis counters. */
  readonly periodMs: number;
  /** Ticks while HIGH before flipping to LOW (`highToLow`, default 1). */
  readonly highTicks: number;
  /** Ticks while LOW before flipping to HIGH (`lowToHigh`, default 1). */
  readonly lowTicks: number;
  /** Start the cycle HIGH (`initial` property, default true). */
  readonly initialHigh: boolean;
  /** Digital Out Toggle mode (astable square vs monostable pulse). */
  readonly toggleMode: ToggleMode;
  /** Pulse width for `pulse_high` / `pulse_low` (ms within each Schedule period). */
  readonly pulseMs: number;
  /** LED actuators downstream of Digital Out Toggle on this channel. */
  readonly actuators: readonly LedActuatorBinding[];
  /** RGB LED sequence players on this channel. */
  readonly rgbActuators: readonly RgbActuatorBinding[];
  /** Digital Out Toggle node ids on this channel (line HIGH during their ON phase). */
  readonly toggleIds: readonly string[];
  /** Flow Start discs on this channel (pulse with Schedule). */
  readonly startIds: readonly string[];
  /**
   * How RGB LEDs are driven on this channel:
   * - `line` — while Digital Out Toggle is HIGH (phase = time since rising edge)
   * - `trigger` — each Schedule period restarts the sequence (no toggle required)
   */
  readonly rgbDrive?: "line" | "trigger";
  /** IF nodes on this channel (preview HIGH when the condition is met). */
  readonly ifIds?: readonly string[];
  /** IF evaluation bindings (condition + source). */
  readonly ifDrives?: readonly IfActuatorDrive[];
  /** Relay contacts on this channel. */
  readonly relayBindings?: readonly RelayBinding[];
  /** Temperature sensors feeding an IF on this channel. */
  readonly tempIds?: readonly string[];
};

/** Digital Out Toggle behaviour on each Schedule impulse. */
export type ToggleMode = "astable" | "pulse_high" | "pulse_low";

export type RgbActuatorBinding = {
  readonly id: string;
  readonly properties: Readonly<Record<string, unknown>>;
};

/**
 * Builds local Dry-run preview channels:
 * - Schedule → Start → Digital Out Toggle → LED / RGB (line-driven)
 * - Schedule → Start → RGB (trigger-driven, no toggle)
 * Start is a transparent entry; mono LED alone does not blink without a toggle.
 */
export function buildDryRunPreviewChannels(
  graph: GraphState<"device-processing">,
): readonly DryRunPreviewChannel[] {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n.data as DeviceProcessingNodeData]));
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const out = outgoing.get(edge.source) ?? [];
    out.push(edge.target);
    outgoing.set(edge.source, out);
    const inn = incoming.get(edge.target) ?? [];
    inn.push(edge.source);
    incoming.set(edge.target, inn);
  }

  const channels: DryRunPreviewChannel[] = [];
  const claimed = new Set<string>();
  for (const node of graph.nodes) {
    const data = node.data as DeviceProcessingNodeData;
    if (data.kind !== "schedule" || !data.enabled) continue;
    const periodMs = Number.isFinite(data.periodMs) && data.periodMs > 0 ? data.periodMs : 1000;
    const reach = reachableViaToggle(node.id, outgoing, incoming, nodesById);
    const hasToggle = reach.toggleIds.length > 0;
    if (!hasToggle && reach.rgbActuators.length === 0 && reach.ifIds.length === 0 && reach.relayBindings.length === 0) {
      continue;
    }
    for (const led of reach.actuators) claimed.add(led.id);
    for (const relay of reach.relayBindings) claimed.add(relay.id);
    channels.push({
      triggerId: node.id,
      periodMs,
      highTicks: reach.highTicks,
      lowTicks: reach.lowTicks,
      initialHigh: reach.initialHigh,
      toggleMode: reach.toggleMode,
      pulseMs: reach.pulseMs,
      toggleIds: reach.toggleIds,
      startIds: reach.startIds,
      // Mono LEDs still require a toggle; drop them on trigger-only channels.
      actuators: hasToggle ? reach.actuators : [],
      rgbActuators: reach.rgbActuators,
      rgbDrive: hasToggle ? "line" : "trigger",
      ...(reach.ifIds.length > 0 ? { ifIds: reach.ifIds, ifDrives: reach.ifDrives } : {}),
      ...(reach.relayBindings.length > 0 ? { relayBindings: reach.relayBindings } : {}),
      ...(reach.tempIds.length > 0 ? { tempIds: reach.tempIds } : {}),
    });
  }

  for (const node of graph.nodes) {
    const data = node.data as DeviceProcessingNodeData;
    if (!isCompareIf(data)) continue;
    const srcId = incoming.get(node.id)?.[0];
    const src = srcId ? nodesById.get(srcId) : undefined;
    if (!src || !isTemperatureSensor(src)) continue;
    const tempDrive = ifDriveFromNode(
      node.id,
      node.data as Extract<DeviceProcessingNodeData, { kind: "block" }>,
      incoming,
      nodesById,
    );
    const leds: LedActuatorBinding[] = [];
    const relays: RelayBinding[] = [];
    for (const outId of outgoing.get(node.id) ?? []) {
      if (claimed.has(outId)) continue;
      const outData = nodesById.get(outId);
      if (!outData || !isBlockNodeData(outData)) continue;
      const drive = actuatorDriveFor(outId, incoming, nodesById);
      if (isLedBlock(outData)) {
        leds.push({ ...ledBindingFromProperties(outId, outData.properties), drive });
        claimed.add(outId);
      } else if (isRelayBlock(outData)) {
        relays.push(relayBindingFromProperties(outId, outData.properties, drive));
        claimed.add(outId);
      }
    }
    channels.push({
      triggerId: `temp-drive:${node.id}`,
      periodMs: 1000,
      highTicks: 1,
      lowTicks: 1,
      initialHigh: true,
      toggleMode: "astable",
      pulseMs: 100,
      toggleIds: [],
      startIds: [],
      actuators: leds,
      rgbActuators: [],
      ifIds: [node.id],
      ifDrives: [tempDrive],
      relayBindings: relays,
      tempIds: srcId ? [srcId] : [],
    });
  }
  return channels;
}

function reachableViaToggle(
  startId: string,
  outgoing: ReadonlyMap<string, readonly string[]>,
  incoming: ReadonlyMap<string, readonly string[]>,
  nodesById: ReadonlyMap<string, DeviceProcessingNodeData>,
): {
  actuators: LedActuatorBinding[];
  rgbActuators: RgbActuatorBinding[];
  toggleIds: string[];
  startIds: string[];
  ifIds: string[];
  ifDrives: IfActuatorDrive[];
  relayBindings: RelayBinding[];
  tempIds: string[];
  highTicks: number;
  lowTicks: number;
  initialHigh: boolean;
  toggleMode: ToggleMode;
  pulseMs: number;
} {
  const foundLeds: LedActuatorBinding[] = [];
  const foundRgb: RgbActuatorBinding[] = [];
  const foundToggles: string[] = [];
  const foundStarts: string[] = [];
  const foundIfs: string[] = [];
  const foundIfDrives: IfActuatorDrive[] = [];
  const foundRelays: RelayBinding[] = [];
  const foundTemps: string[] = [];
  let highTicks = 1;
  let lowTicks = 1;
  let initialHigh = true;
  let toggleMode: ToggleMode = "astable";
  let pulseMs = 100;
  let hysteresisTaken = false;
  const seen = new Set<string>();
  const queue: { readonly id: string; readonly passedToggle: boolean }[] = [{ id: startId, passedToggle: false }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    const key = `${current.id}:${current.passedToggle ? 1 : 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const nextId of outgoing.get(current.id) ?? []) {
      const data = nodesById.get(nextId);
      if (!data) continue;
      if (isFlowStartBlock(data)) foundStarts.push(nextId);
      const isToggle = isDigitalOutToggle(data);
      if (isToggle) {
        foundToggles.push(nextId);
        if (!hysteresisTaken) {
          const props = isBlockNodeData(data) ? data.properties : {};
          const hyst = hysteresisTicksFromProperties(props);
          highTicks = hyst.highTicks;
          lowTicks = hyst.lowTicks;
          initialHigh = initialHighFromProperties(props);
          toggleMode = toggleModeFromProperties(props);
          pulseMs = pulseMsFromProperties(props);
          hysteresisTaken = true;
        }
      }
      if (isCompareIf(data) && isBlockNodeData(data)) {
        foundIfs.push(nextId);
        foundIfDrives.push(ifDriveFromNode(nextId, data, incoming, nodesById));
      }
      if (isTemperatureSensor(data)) foundTemps.push(nextId);
      const drive = actuatorDriveFor(nextId, incoming, nodesById);
      const passedToggle = current.passedToggle || isToggle;
      if (isLedBlock(data) || isRelayBlock(data)) {
        if (isBlockNodeData(data) && driveFollowsTogglePath(drive, passedToggle)) {
          if (isLedBlock(data)) {
            const binding = ledBindingFromProperties(nextId, data.properties);
            foundLeds.push(drive?.kind === "if" ? { ...binding, drive } : binding);
          } else {
            foundRelays.push(relayBindingFromProperties(nextId, data.properties, drive?.kind === "if" ? drive : undefined));
          }
        }
        continue;
      }
      if (isRgbLedBlock(data)) {
        // Trigger player: reachable from Schedule (with or without a Toggle).
        if (isBlockNodeData(data)) {
          foundRgb.push({ id: nextId, properties: data.properties });
        }
        continue;
      }
      queue.push({ id: nextId, passedToggle });
    }
  }
  const seenLed = new Set<string>();
  const actuators = foundLeds.filter((a) => {
    if (seenLed.has(a.id)) return false;
    seenLed.add(a.id);
    return true;
  });
  const seenRgb = new Set<string>();
  const rgbActuators = foundRgb.filter((a) => {
    if (seenRgb.has(a.id)) return false;
    seenRgb.add(a.id);
    return true;
  });
  return {
    actuators,
    rgbActuators,
    toggleIds: [...new Set(foundToggles)],
    startIds: [...new Set(foundStarts)],
    ifIds: [...new Set(foundIfs)],
    ifDrives: foundIfDrives.filter((drive, index, list) => list.findIndex((item) => item.ifId === drive.ifId) === index),
    relayBindings: foundRelays.filter((relay, index, list) => list.findIndex((item) => item.id === relay.id) === index),
    tempIds: [...new Set(foundTemps)],
    highTicks,
    lowTicks,
    initialHigh,
    toggleMode,
    pulseMs,
  };
}

export function isDigitalOutToggle(data: DeviceProcessingNodeData): boolean {
  if (!isBlockNodeData(data)) return false;
  if (data.catalogEntryId && DIGITAL_OUT_TOGGLE_IDS.has(data.catalogEntryId)) return true;
  return DIGITAL_OUT_TOGGLE_IDS.has(data.blockTypeId);
}

export function isCompareIf(data: DeviceProcessingNodeData): boolean {
  if (!isBlockNodeData(data)) return false;
  if (data.catalogEntryId && COMPARE_IF_IDS.has(data.catalogEntryId)) return true;
  return COMPARE_IF_IDS.has(data.blockTypeId);
}

export function isTemperatureSensor(data: DeviceProcessingNodeData): boolean {
  if (!isBlockNodeData(data)) return false;
  if (data.catalogEntryId && TEMPERATURE_SENSOR_IDS.has(data.catalogEntryId)) return true;
  return TEMPERATURE_SENSOR_IDS.has(data.blockTypeId);
}

export function isRelayBlock(data: DeviceProcessingNodeData): boolean {
  if (!isBlockNodeData(data)) return false;
  if (data.catalogEntryId && RELAY_BLOCK_IDS.has(data.catalogEntryId)) return true;
  return RELAY_BLOCK_IDS.has(data.blockTypeId);
}

export function compareOpFromProperties(properties: Readonly<Record<string, unknown>>): CompareOp {
  const raw = properties.compare;
  if (raw === "neq" || raw === "gt" || raw === "gte" || raw === "lt" || raw === "lte") return raw;
  return "eq";
}

export function compareNumeric(op: CompareOp, left: number, right: number): boolean {
  switch (op) {
    case "eq":
      return left === right;
    case "neq":
      return left !== right;
    case "gt":
      return left > right;
    case "gte":
      return left >= right;
    case "lt":
      return left < right;
    case "lte":
      return left <= right;
  }
}

export function compareDigital(op: CompareOp, leftHigh: boolean, rightHigh: boolean): boolean {
  return compareNumeric(op === "neq" ? "neq" : "eq", leftHigh ? 1 : 0, rightHigh ? 1 : 0);
}

export function numberFromProperty(raw: unknown, fallback: number): number {
  const n = typeof raw === "bigint" ? Number(raw) : typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

export function evaluateIfDrive(elapsedMs: number, channel: DryRunPreviewChannel, drive: IfActuatorDrive): boolean {
  if (drive.source.kind === "none") return false;
  const thenHigh = drive.thenOutput !== "low";
  const met =
    drive.source.kind === "temperature"
      ? compareNumeric(drive.compare, drive.source.testC, drive.compareTempC)
      : compareDigital(drive.compare, lineHighAtElapsed(elapsedMs, channel), drive.compareLevel !== "low");
  return met ? thenHigh : !thenHigh;
}

function driveFollowsTogglePath(drive: ActuatorDrive | undefined, passedToggle: boolean): boolean {
  if (drive?.kind === "if") return drive.source.kind === "toggle";
  return passedToggle;
}

export function commandLevelForActuator(
  elapsedMs: number,
  channel: DryRunPreviewChannel,
  drive: ActuatorDrive | undefined,
): number {
  if (drive?.kind === "if") return evaluateIfDrive(elapsedMs, channel, drive) ? 100 : 0;
  return commandLevelAtElapsed(elapsedMs, channel);
}

function actuatorDriveFor(
  nodeId: string,
  incoming: ReadonlyMap<string, readonly string[]>,
  nodesById: ReadonlyMap<string, DeviceProcessingNodeData>,
): ActuatorDrive | undefined {
  const srcIds = incoming.get(nodeId) ?? [];
  let toggleFallback: ActuatorDrive | undefined;
  for (const srcId of srcIds) {
    const src = nodesById.get(srcId);
    if (!src) continue;
    if (isCompareIf(src) && isBlockNodeData(src)) {
      return ifDriveFromNode(srcId, src, incoming, nodesById);
    }
    if (isDigitalOutToggle(src)) toggleFallback = { kind: "toggle" };
  }
  if (toggleFallback) return toggleFallback;
  if (srcIds.length > 0) return { kind: "toggle" };
  return undefined;
}

function ifDriveFromNode(
  ifId: string,
  data: Extract<DeviceProcessingNodeData, { kind: "block" }>,
  incoming: ReadonlyMap<string, readonly string[]>,
  nodesById: ReadonlyMap<string, DeviceProcessingNodeData>,
): IfActuatorDrive {
  const inId = incoming.get(ifId)?.[0];
  const inData = inId ? nodesById.get(inId) : undefined;
  const source: IfActuatorDrive["source"] =
    inData && isTemperatureSensor(inData) && isBlockNodeData(inData)
      ? { kind: "temperature", testC: numberFromProperty(inData.properties.testC, 22) }
      : inData && isDigitalOutToggle(inData)
        ? { kind: "toggle" }
        : { kind: "none" };
  return {
    kind: "if",
    ifId,
    compare: compareOpFromProperties(data.properties),
    thenOutput: data.properties.thenOutput === "low" ? "low" : "high",
    compareLevel: data.properties.compareLevel === "low" ? "low" : "high",
    compareTempC: numberFromProperty(data.properties.compareTempC, 25),
    source,
  };
}

function relayBindingFromProperties(
  id: string,
  properties: Readonly<Record<string, unknown>>,
  drive?: ActuatorDrive,
): RelayBinding {
  return {
    id,
    closeWhenHigh: properties.closeWhen !== "low",
    drive,
  };
}

function ifDriveOnChannel(channel: DryRunPreviewChannel, ifId: string): IfActuatorDrive | undefined {
  for (const drive of channel.ifDrives ?? []) {
    if (drive.ifId === ifId) return drive;
  }
  for (const led of channel.actuators) {
    if (led.drive?.kind === "if" && led.drive.ifId === ifId) return led.drive;
  }
  for (const relay of channel.relayBindings ?? []) {
    if (relay.drive?.kind === "if" && relay.drive.ifId === ifId) return relay.drive;
  }
  return undefined;
}

export function isLedBlock(data: DeviceProcessingNodeData): boolean {
  if (!isBlockNodeData(data)) return false;
  if (data.catalogEntryId && LED_BLOCK_IDS.has(data.catalogEntryId)) return true;
  if (LED_BLOCK_IDS.has(data.blockTypeId)) return true;
  return typeof data.properties.color === "string" && data.blockTypeId === "ab.led";
}

export function isRgbLedBlock(data: DeviceProcessingNodeData): boolean {
  if (!isBlockNodeData(data)) return false;
  if (data.catalogEntryId && RGB_LED_BLOCK_IDS.has(data.catalogEntryId)) return true;
  return RGB_LED_BLOCK_IDS.has(data.blockTypeId);
}

export function isFlowStartBlock(data: DeviceProcessingNodeData): boolean {
  if (!isBlockNodeData(data)) return false;
  if (data.catalogEntryId && FLOW_START_IDS.has(data.catalogEntryId)) return true;
  return FLOW_START_IDS.has(data.blockTypeId);
}

/** @deprecated use isDigitalOutToggle / isLedBlock — kept for call-site clarity in older tests. */
export function isDigitalOutputBlock(data: DeviceProcessingNodeData): boolean {
  return isLedBlock(data);
}

export function hysteresisTicksFromProperties(properties: Readonly<Record<string, unknown>>): {
  readonly highTicks: number;
  readonly lowTicks: number;
} {
  return {
    highTicks: positiveTickCount(properties.highToLow, 1),
    lowTicks: positiveTickCount(properties.lowToHigh, 1),
  };
}

export function initialHighFromProperties(properties: Readonly<Record<string, unknown>>): boolean {
  const raw = properties.initial;
  if (typeof raw === "string" && raw.trim().toLowerCase() === "low") return false;
  return true;
}

export function toggleModeFromProperties(properties: Readonly<Record<string, unknown>>): ToggleMode {
  const raw = properties.toggleMode;
  if (raw === "pulse_high" || raw === "pulse_low") return raw;
  return "astable";
}

export function pulseMsFromProperties(properties: Readonly<Record<string, unknown>>, fallback = 100): number {
  const n =
    typeof properties.pulseMs === "bigint"
      ? Number(properties.pulseMs)
      : typeof properties.pulseMs === "number"
        ? properties.pulseMs
        : Number(properties.pulseMs);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.trunc(n), 60_000);
}

export function ledNegatedFromProperties(properties: Readonly<Record<string, unknown>>): boolean {
  if (properties.negated === true) return true;
  if (typeof properties.negated === "string" && properties.negated.trim().toLowerCase() === "true") return true;
  return false;
}

function msFromProperty(raw: unknown, fallback: number, min = 1): number {
  const n = typeof raw === "bigint" ? Number(raw) : typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < min) return fallback;
  return Math.min(Math.trunc(n), 60_000);
}

function thresholdFromProperty(raw: unknown, fallback = 50): number {
  const n = typeof raw === "bigint" ? Number(raw) : typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, Math.trunc(n)));
}

export function ledBindingFromProperties(id: string, properties: Readonly<Record<string, unknown>>): LedActuatorBinding {
  const legacyOn =
    properties.delayOnMs !== undefined
      ? msFromProperty(properties.delayOnMs, 0, 0)
      : properties.delayRisingMs !== undefined
        ? msFromProperty(properties.delayRisingMs, 0, 0)
        : properties.delayMs !== undefined
          ? msFromProperty(properties.delayMs, 0, 0)
          : 0;
  const legacyOff =
    properties.delayOffMs !== undefined
      ? msFromProperty(properties.delayOffMs, 0, 0)
      : properties.delayFallingMs !== undefined
        ? msFromProperty(properties.delayFallingMs, 0, 0)
        : properties.delayMs !== undefined
          ? msFromProperty(properties.delayMs, 0, 0)
          : 0;
  return {
    id,
    threshold: thresholdFromProperty(properties.threshold, 50),
    negated: ledNegatedFromProperties(properties),
    delayOnMs: legacyOn,
    delayOffMs: legacyOff,
    softOnMs: msFromProperty(properties.softOnMs, 0, 0),
    softOffMs: msFromProperty(properties.softOffMs, 0, 0),
  };
}

function positiveTickCount(raw: unknown, fallback: number): number {
  const n = typeof raw === "bigint" ? Number(raw) : typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(Math.trunc(n), 1_000_000);
}

export function lineHighAtTick(
  tick: number,
  highTicks: number,
  lowTicks: number,
  initialHigh: boolean,
): boolean {
  const cycle = highTicks + lowTicks;
  const phase = ((tick % cycle) + cycle) % cycle;
  if (initialHigh) return phase < highTicks;
  return phase >= lowTicks;
}

/**
 * Digital Out line level at continuous time — supports astable (tick hysteresis)
 * and monostable pulses (HIGH or LOW notch at the start of each Schedule period).
 */
export function lineHighAtElapsed(elapsedMs: number, channel: DryRunPreviewChannel): boolean {
  const period = Math.max(1, channel.periodMs);
  const mode = channel.toggleMode ?? "astable";
  if (mode === "pulse_high" || mode === "pulse_low") {
    const phase = ((elapsedMs % period) + period) % period;
    const pulse = Math.min(Math.max(1, channel.pulseMs ?? 100), period);
    const inPulse = phase < pulse;
    return mode === "pulse_high" ? inPulse : !inPulse;
  }
  const tick = Math.floor(Math.max(0, elapsedMs) / period);
  return lineHighAtTick(tick, channel.highTicks, channel.lowTicks, channel.initialHigh);
}

export function waveformPlateaus(
  highTicks: number,
  lowTicks: number,
  initialHigh: boolean,
): readonly { readonly high: boolean; readonly ticks: number }[] {
  if (initialHigh) {
    return [
      { high: true, ticks: highTicks },
      { high: false, ticks: lowTicks },
    ];
  }
  return [
    { high: false, ticks: lowTicks },
    { high: true, ticks: highTicks },
  ];
}

function clamp01(n: number): number {
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

/** Digital Out Toggle line → comando 0–100. */
export function commandLevelAtTick(tick: number, channel: DryRunPreviewChannel): number {
  return lineHighAtElapsed(tick * channel.periodMs, channel) ? 100 : 0;
}

export function commandLevelAtElapsed(elapsedMs: number, channel: DryRunPreviewChannel): number {
  return lineHighAtElapsed(elapsedMs, channel) ? 100 : 0;
}

export function ledWantedOn(level: number, led: LedActuatorBinding): boolean {
  const v = led.negated ? 100 - level : level;
  return v >= led.threshold;
}

function ledActiveAtElapsed(elapsedMs: number, channel: DryRunPreviewChannel, led: LedActuatorBinding): boolean {
  return ledWantedOn(commandLevelForActuator(elapsedMs, channel, led.drive), led);
}

/** Time spent continuously in the LED's active phase, or null if inactive. */
export function activePhaseProgress(
  elapsedMs: number,
  channel: DryRunPreviewChannel,
  led: LedActuatorBinding,
): { readonly sinceMs: number; readonly plateauMs: number } | null {
  if (!ledActiveAtElapsed(elapsedMs, channel, led)) return null;

  const period = Math.max(1, channel.periodMs);
  const mode = channel.toggleMode ?? "astable";
  if (mode === "pulse_high" || mode === "pulse_low") {
    const phase = ((elapsedMs % period) + period) % period;
    const pulse = Math.min(Math.max(1, channel.pulseMs ?? 100), period);
    // Active notch within the period: pulse_high → [0, pulse); pulse_low → [pulse, period).
    if (mode === "pulse_high") {
      return { sinceMs: phase, plateauMs: pulse };
    }
    return { sinceMs: phase - pulse, plateauMs: period - pulse };
  }

  const tick = Math.floor(Math.max(0, elapsedMs) / period);
  let startTick = tick;
  while (startTick > 0) {
    if (!ledActiveAtElapsed((startTick - 1) * period, channel, led)) break;
    startTick -= 1;
  }
  const phaseInPeriod = ((elapsedMs % period) + period) % period;
  const sinceMs = (tick - startTick) * period + phaseInPeriod;
  const lineHigh = lineHighAtElapsed(elapsedMs, channel);
  const plateauTicks = lineHigh ? channel.highTicks : channel.lowTicks;
  return { sinceMs, plateauMs: plateauTicks * period };
}

/** Time since the LED left its active phase, or null if currently active / never was. */
export function inactivePhaseProgress(
  elapsedMs: number,
  channel: DryRunPreviewChannel,
  led: LedActuatorBinding,
): { readonly sinceMs: number; readonly plateauMs: number } | null {
  if (ledActiveAtElapsed(elapsedMs, channel, led)) return null;

  const period = Math.max(1, channel.periodMs);
  const mode = channel.toggleMode ?? "astable";
  if (mode === "pulse_high" || mode === "pulse_low") {
    const phase = ((elapsedMs % period) + period) % period;
    const pulse = Math.min(Math.max(1, channel.pulseMs ?? 100), period);
    if (mode === "pulse_high") {
      // Inactive for [pulse, period)
      if (phase < pulse) return null;
      return { sinceMs: phase - pulse, plateauMs: period - pulse };
    }
    // pulse_low: inactive during [0, pulse)
    return { sinceMs: phase, plateauMs: pulse };
  }

  const tick = Math.floor(Math.max(0, elapsedMs) / period);
  let firstInactiveTick = tick;
  while (firstInactiveTick > 0) {
    if (ledActiveAtElapsed((firstInactiveTick - 1) * period, channel, led)) break;
    firstInactiveTick -= 1;
  }
  if (firstInactiveTick === 0 && !ledActiveAtElapsed(0, channel, led)) return null;

  const phaseInPeriod = ((elapsedMs % period) + period) % period;
  const sinceMs = (tick - firstInactiveTick) * period + phaseInPeriod;
  return { sinceMs, plateauMs: period };
}

/** Raw intensity 0..1: comando vs soglia, ritardi ON/OFF, soft start/stop. */
export function ledRawIntensityAt(
  elapsedMs: number,
  channel: DryRunPreviewChannel,
  led: LedActuatorBinding,
): number {
  const delayOn = Math.max(0, led.delayOnMs);
  const delayOff = Math.max(0, led.delayOffMs);
  const softOn = Math.max(0, led.softOnMs);
  const softOff = Math.max(0, led.softOffMs);

  const progress = activePhaseProgress(elapsedMs, channel, led);
  if (progress) {
    const since = progress.sinceMs - delayOn;
    if (since < 0) return 0;
    if (softOn <= 0) return 1;
    return clamp01(since / softOn);
  }

  const inactive = inactivePhaseProgress(elapsedMs, channel, led);
  if (!inactive) return 0;
  if (inactive.sinceMs < delayOff) return 1; // hold ON during ritardo OFF
  const sinceSoft = inactive.sinceMs - delayOff;
  if (softOff <= 0) return 0;
  if (sinceSoft >= softOff) return 0;
  return 1 - sinceSoft / softOff;
}

export function ledIntensityAt(
  elapsedMs: number,
  channel: DryRunPreviewChannel,
  led: LedActuatorBinding,
): number {
  return clamp01(ledRawIntensityAt(elapsedMs, channel, led));
}

/** @deprecated prefer ledIntensityAt — true when intensity is visibly on. */
export function ledLitAt(
  elapsedMs: number,
  channel: DryRunPreviewChannel,
  led: LedActuatorBinding,
): boolean {
  return ledIntensityAt(elapsedMs, channel, led) > 0.08;
}

export function ledIntensitiesAt(
  elapsedMs: number,
  channels: readonly DryRunPreviewChannel[],
): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const channel of channels) {
    for (const led of channel.actuators) {
      out.set(led.id, ledIntensityAt(elapsedMs, channel, led));
    }
  }
  return out;
}

/** RGB swatch color + intensity from trigger edge / action on the drive line. */
export function rgbVisualsAt(
  elapsedMs: number,
  channels: readonly DryRunPreviewChannel[],
): ReadonlyMap<string, { readonly color: string; readonly intensity: number }> {
  const out = new Map<string, { readonly color: string; readonly intensity: number }>();
  for (const channel of channels) {
    const signal = rgbLineSignalAt(elapsedMs, channel);
    for (const rgb of channel.rgbActuators ?? []) {
      out.set(rgb.id, rgbLedPlaybackAt(signal, parseRgbLedConfig(rgb.properties), elapsedMs));
    }
  }
  return out;
}

/**
 * Digital line sample for RGB trigger semantics.
 * Uses Toggle hysteresis / pulse mode when present; otherwise the same 1/1
 * waveform defaults so Schedule→RGB still has rising/falling edges each period.
 */
export function rgbLineSignalAt(elapsedMs: number, channel: DryRunPreviewChannel): RgbLineSignal {
  const period = Math.max(1, channel.periodMs);
  const lineHigh = lineHighAtElapsed(elapsedMs, channel);
  const sampleStep = Math.max(1, Math.min(20, Math.floor(period / 40)));

  let lastRisingAt: number | null = null;
  let lastFallingAt: number | null = null;
  const tNow = Math.max(0, elapsedMs);
  // Walk backward to find the most recent edges (sub-period for pulse modes).
  let prev = lineHighAtElapsed(Math.max(0, tNow - sampleStep), channel);
  for (let t = tNow; t >= 0; t -= sampleStep) {
    const high = lineHighAtElapsed(t, channel);
    const earlier = t <= 0 ? false : lineHighAtElapsed(Math.max(0, t - sampleStep), channel);
    if (lastRisingAt === null && high && !earlier) lastRisingAt = t;
    if (lastFallingAt === null && !high && (t <= 0 || earlier)) lastFallingAt = t;
    if (lastRisingAt !== null && lastFallingAt !== null) break;
    prev = high;
  }
  void prev;

  // Exact edges for pulse modes at period boundaries.
  const mode = channel.toggleMode ?? "astable";
  if (mode === "pulse_high" || mode === "pulse_low") {
    const pulse = Math.min(Math.max(1, channel.pulseMs ?? 100), period);
    const periodIndex = Math.floor(tNow / period);
    const phase = ((tNow % period) + period) % period;
    if (mode === "pulse_high") {
      lastRisingAt = periodIndex * period;
      lastFallingAt = phase >= pulse ? periodIndex * period + pulse : periodIndex > 0 ? (periodIndex - 1) * period + pulse : null;
    } else {
      lastFallingAt = periodIndex * period;
      lastRisingAt = phase >= pulse ? periodIndex * period + pulse : periodIndex > 0 ? (periodIndex - 1) * period + pulse : null;
    }
  }

  const msSinceRising = lastRisingAt === null ? Number.POSITIVE_INFINITY : tNow - lastRisingAt;
  const msSinceFalling = lastFallingAt === null ? Number.POSITIVE_INFINITY : tNow - lastFallingAt;

  return {
    lineHigh,
    msSinceRising,
    msSinceFalling,
    highPhaseMs: lineHigh ? highPhaseMs(elapsedMs, channel) : 0,
    lowPhaseMs: !lineHigh ? lowPhaseMs(elapsedMs, channel) : 0,
  };
}

function lowPhaseMs(elapsedMs: number, channel: DryRunPreviewChannel): number {
  if (lineHighAtElapsed(elapsedMs, channel)) return 0;
  const period = Math.max(1, channel.periodMs);
  const mode = channel.toggleMode ?? "astable";
  if (mode === "pulse_high" || mode === "pulse_low") {
    const phase = ((elapsedMs % period) + period) % period;
    const pulse = Math.min(Math.max(1, channel.pulseMs ?? 100), period);
    if (mode === "pulse_high") return Math.max(0, phase - pulse);
    return phase; // pulse_low: low during [0, pulse)
  }
  const tick = Math.floor(Math.max(0, elapsedMs) / period);
  let startTick = tick;
  while (startTick > 0) {
    if (lineHighAtElapsed((startTick - 1) * period, channel)) break;
    startTick -= 1;
  }
  const phaseInPeriod = ((elapsedMs % period) + period) % period;
  return (tick - startTick) * period + phaseInPeriod;
}

function highPhaseMs(elapsedMs: number, channel: DryRunPreviewChannel): number {
  if (!lineHighAtElapsed(elapsedMs, channel)) return 0;
  const period = Math.max(1, channel.periodMs);
  const mode = channel.toggleMode ?? "astable";
  if (mode === "pulse_high" || mode === "pulse_low") {
    const phase = ((elapsedMs % period) + period) % period;
    const pulse = Math.min(Math.max(1, channel.pulseMs ?? 100), period);
    if (mode === "pulse_high") return phase;
    return Math.max(0, phase - pulse);
  }
  const tick = Math.floor(Math.max(0, elapsedMs) / period);
  let startTick = tick;
  while (startTick > 0) {
    if (!lineHighAtElapsed((startTick - 1) * period, channel)) break;
    startTick -= 1;
  }
  const phaseInPeriod = ((elapsedMs % period) + period) % period;
  return (tick - startTick) * period + phaseInPeriod;
}

/**
 * Nodes currently "active": toggles while line HIGH; LEDs when intensity > threshold.
 */
export function activeActuatorsAt(elapsedMs: number, channels: readonly DryRunPreviewChannel[]): ReadonlySet<string> {
  const on = new Set<string>();
  for (const channel of channels) {
    const lineHigh = lineHighAtElapsed(elapsedMs, channel);
    if (lineHigh) {
      for (const id of channel.toggleIds) on.add(id);
    }
    for (const led of channel.actuators) {
      if (ledIntensityAt(elapsedMs, channel, led) > 0.08) on.add(led.id);
    }
    for (const rgb of channel.rgbActuators ?? []) {
      const visual = rgbLedPlaybackAt(rgbLineSignalAt(elapsedMs, channel), parseRgbLedConfig(rgb.properties), elapsedMs);
      if (visual.intensity > 0.08) on.add(rgb.id);
    }
    for (const ifId of channel.ifIds ?? []) {
      const drive = ifDriveOnChannel(channel, ifId);
      if (drive ? evaluateIfDrive(elapsedMs, channel, drive) : lineHigh) on.add(ifId);
    }
    for (const relay of channel.relayBindings ?? []) {
      const high = commandLevelForActuator(elapsedMs, channel, relay.drive) >= 50;
      if (relay.closeWhenHigh ? high : !high) on.add(relay.id);
    }
  }
  return on;
}

export function previewParticipantIds(channels: readonly DryRunPreviewChannel[]): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const channel of channels) {
    for (const id of channel.toggleIds) ids.add(id);
    for (const id of channel.startIds) ids.add(id);
    for (const led of channel.actuators) ids.add(led.id);
    for (const rgb of channel.rgbActuators ?? []) ids.add(rgb.id);
    for (const id of channel.ifIds ?? []) ids.add(id);
    for (const relay of channel.relayBindings ?? []) ids.add(relay.id);
    for (const id of channel.tempIds ?? []) ids.add(id);
  }
  return ids;
}

export function activeTriggersAt(elapsedMs: number, channels: readonly DryRunPreviewChannel[]): ReadonlySet<string> {
  const on = new Set<string>();
  for (const channel of channels) {
    const phase = ((elapsedMs % channel.periodMs) + channel.periodMs) % channel.periodMs;
    const pulseMs = Math.max(40, Math.min(120, channel.periodMs * 0.12));
    if (phase < pulseMs) {
      on.add(channel.triggerId);
      for (const id of channel.startIds) on.add(id);
    }
  }
  return on;
}

export function ledColorFromProperties(properties: Readonly<Record<string, unknown>>, fallback = "#F5C518"): string {
  const raw = properties.color;
  if (typeof raw === "string" && /^#[0-9A-Fa-f]{6}$/.test(raw.trim())) return raw.trim();
  return fallback;
}
