import type { DeviceProcessingNodeData } from "@spaghettilab/device-processing-graph-model";
import { isBlockNodeData } from "@spaghettilab/device-processing-graph-model";
import type { GraphState } from "@spaghettilab/domain";

/** Catalog / type ids for Digital Out Toggle — flips the line after hysteresis ticks. */
export const DIGITAL_OUT_TOGGLE_IDS = new Set(["appblocks.digital_out_toggle", "ab.digital_out_toggle"]);

/** Catalog / type ids for the visual LED indicator (solid color swatch). */
export const LED_BLOCK_IDS = new Set(["appblocks.led", "ab.led"]);

/** Circular flow Start — authoring entry that enables blocks downstream of Schedule. */
export const FLOW_START_IDS = new Set(["native.flow_start", "ab.flow_start"]);

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
  /** Digital Out Toggle nodes whose output follows this channel's line state. */
  readonly toggleIds: readonly string[];
  /** Flow Start nodes on the path (entry point that enables the toggle). */
  readonly startIds: readonly string[];
  /** LED nodes driven by this channel. */
  readonly actuators: readonly LedActuatorBinding[];
};

/**
 * Builds local Dry-run preview channels: Schedule → Start → Digital Out Toggle → LED.
 * Start is a transparent entry that enables the toggle; LED alone does not blink.
 */
export function buildDryRunPreviewChannels(
  graph: GraphState<"device-processing">,
): readonly DryRunPreviewChannel[] {
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n.data as DeviceProcessingNodeData]));
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = outgoing.get(edge.source) ?? [];
    list.push(edge.target);
    outgoing.set(edge.source, list);
  }

  const channels: DryRunPreviewChannel[] = [];
  for (const node of graph.nodes) {
    const data = node.data as DeviceProcessingNodeData;
    if (data.kind !== "schedule" || !data.enabled) continue;
    const periodMs = Number.isFinite(data.periodMs) && data.periodMs > 0 ? data.periodMs : 1000;
    const reach = reachableViaToggle(node.id, outgoing, nodesById);
    if (reach.toggleIds.length === 0) continue;
    channels.push({
      triggerId: node.id,
      periodMs,
      highTicks: reach.highTicks,
      lowTicks: reach.lowTicks,
      initialHigh: reach.initialHigh,
      toggleIds: reach.toggleIds,
      startIds: reach.startIds,
      actuators: reach.actuators,
    });
  }
  return channels;
}

function reachableViaToggle(
  startId: string,
  outgoing: ReadonlyMap<string, readonly string[]>,
  nodesById: ReadonlyMap<string, DeviceProcessingNodeData>,
): {
  actuators: LedActuatorBinding[];
  toggleIds: string[];
  startIds: string[];
  highTicks: number;
  lowTicks: number;
  initialHigh: boolean;
} {
  const foundLeds: LedActuatorBinding[] = [];
  const foundToggles: string[] = [];
  const foundStarts: string[] = [];
  let highTicks = 1;
  let lowTicks = 1;
  let initialHigh = true;
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
          hysteresisTaken = true;
        }
      }
      const passedToggle = current.passedToggle || isToggle;
      if (isLedBlock(data)) {
        if (passedToggle && isBlockNodeData(data)) {
          foundLeds.push(ledBindingFromProperties(nextId, data.properties));
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
  return {
    actuators,
    toggleIds: [...new Set(foundToggles)],
    startIds: [...new Set(foundStarts)],
    highTicks,
    lowTicks,
    initialHigh,
  };
}

export function isDigitalOutToggle(data: DeviceProcessingNodeData): boolean {
  if (!isBlockNodeData(data)) return false;
  if (data.catalogEntryId && DIGITAL_OUT_TOGGLE_IDS.has(data.catalogEntryId)) return true;
  return DIGITAL_OUT_TOGGLE_IDS.has(data.blockTypeId);
}

export function isLedBlock(data: DeviceProcessingNodeData): boolean {
  if (!isBlockNodeData(data)) return false;
  if (data.catalogEntryId && LED_BLOCK_IDS.has(data.catalogEntryId)) return true;
  if (LED_BLOCK_IDS.has(data.blockTypeId)) return true;
  return typeof data.properties.color === "string" && data.blockTypeId === "ab.led";
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
  return lineHighAtTick(tick, channel.highTicks, channel.lowTicks, channel.initialHigh) ? 100 : 0;
}

export function ledWantedOn(level: number, led: LedActuatorBinding): boolean {
  const v = led.negated ? 100 - level : level;
  return v >= led.threshold;
}

function ledActiveAtTick(tick: number, channel: DryRunPreviewChannel, led: LedActuatorBinding): boolean {
  return ledWantedOn(commandLevelAtTick(tick, channel), led);
}

/** Time spent continuously in the LED's active phase, or null if inactive. */
export function activePhaseProgress(
  elapsedMs: number,
  channel: DryRunPreviewChannel,
  led: LedActuatorBinding,
): { readonly sinceMs: number; readonly plateauMs: number } | null {
  const tick = Math.floor(Math.max(0, elapsedMs) / channel.periodMs);
  if (!ledActiveAtTick(tick, channel, led)) return null;

  let startTick = tick;
  while (startTick > 0) {
    if (!ledActiveAtTick(startTick - 1, channel, led)) break;
    startTick -= 1;
  }
  const phaseInPeriod = ((elapsedMs % channel.periodMs) + channel.periodMs) % channel.periodMs;
  const sinceMs = (tick - startTick) * channel.periodMs + phaseInPeriod;
  const lineHigh = lineHighAtTick(tick, channel.highTicks, channel.lowTicks, channel.initialHigh);
  const plateauTicks = lineHigh ? channel.highTicks : channel.lowTicks;
  return { sinceMs, plateauMs: plateauTicks * channel.periodMs };
}

/** Time since the LED left its active phase, or null if currently active / never was. */
export function inactivePhaseProgress(
  elapsedMs: number,
  channel: DryRunPreviewChannel,
  led: LedActuatorBinding,
): { readonly sinceMs: number; readonly plateauMs: number } | null {
  const tick = Math.floor(Math.max(0, elapsedMs) / channel.periodMs);
  if (ledActiveAtTick(tick, channel, led)) return null;

  let firstInactiveTick = tick;
  while (firstInactiveTick > 0) {
    if (ledActiveAtTick(firstInactiveTick - 1, channel, led)) break;
    firstInactiveTick -= 1;
  }
  if (firstInactiveTick === 0 && !ledActiveAtTick(0, channel, led)) return null;

  const phaseInPeriod = ((elapsedMs % channel.periodMs) + channel.periodMs) % channel.periodMs;
  const sinceMs = (tick - firstInactiveTick) * channel.periodMs + phaseInPeriod;
  return { sinceMs, plateauMs: channel.periodMs };
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

/**
 * Nodes currently "active": toggles while line HIGH; LEDs when intensity > threshold.
 */
export function activeActuatorsAt(elapsedMs: number, channels: readonly DryRunPreviewChannel[]): ReadonlySet<string> {
  const on = new Set<string>();
  for (const channel of channels) {
    const tick = Math.floor(Math.max(0, elapsedMs) / channel.periodMs);
    const lineHigh = lineHighAtTick(tick, channel.highTicks, channel.lowTicks, channel.initialHigh);
    if (lineHigh) {
      for (const id of channel.toggleIds) on.add(id);
    }
    for (const led of channel.actuators) {
      if (ledIntensityAt(elapsedMs, channel, led) > 0.08) on.add(led.id);
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
