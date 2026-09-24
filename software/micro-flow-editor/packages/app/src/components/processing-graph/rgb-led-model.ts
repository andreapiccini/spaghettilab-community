/**
 * RGB LED bay block — sequence player. The strip (N LEDs from bay, stubbed)
 * is driven as one. Input is a digital trigger with rising/falling edge and
 * follow vs fire-and-forget action; presets are ready-made sequences;
 * custom mode stores ordered actions.
 */

export type RgbLedMode = "preset" | "sequence";

export type RgbLedPreset = "solid" | "breathe" | "blink" | "color_cycle";

export type RgbLedActionKind = "solid" | "fade" | "wait";

/** Which edge starts (or gates) the sequence. */
export type RgbTriggerEdge = "rising" | "falling";

/**
 * - `follow` — active after the chosen edge; opposite edge stops and turns LED off
 * - `start` — chosen edge starts playback; opposite edge does not stop it
 */
export type RgbTriggerAction = "follow" | "start";

export type RgbLedAction = {
  readonly kind: RgbLedActionKind;
  /** Hex color for solid/fade. */
  readonly color?: string;
  /** 0–100. */
  readonly intensity?: number;
  /** Duration ms. */
  readonly durationMs: number;
};

export type RgbLedConfig = {
  readonly mode: RgbLedMode;
  readonly preset: RgbLedPreset;
  readonly color: string;
  readonly intensity: number;
  readonly speedMs: number;
  readonly loop: boolean;
  readonly triggerEdge: RgbTriggerEdge;
  readonly triggerAction: RgbTriggerAction;
  /** Stub until bay/NFC reports the strip length. */
  readonly ledCount: number;
  readonly actions: readonly RgbLedAction[];
};

/** Digital line sample used to resolve trigger edge / action. */
export type RgbLineSignal = {
  readonly lineHigh: boolean;
  /** Continuous ms since last rising edge; `Infinity` if none yet. */
  readonly msSinceRising: number;
  /** Continuous ms since last falling edge; `Infinity` if none yet. */
  readonly msSinceFalling: number;
  /** Ms in the current HIGH plateau (0 while LOW). */
  readonly highPhaseMs: number;
  /** Ms in the current LOW plateau (0 while HIGH). */
  readonly lowPhaseMs: number;
};

export const RGB_LED_PRESET_OPTIONS = [
  { value: "solid", label: "Solid" },
  { value: "breathe", label: "Breathe" },
  { value: "blink", label: "Blink" },
  { value: "color_cycle", label: "Color cycle" },
] as const;

const DEFAULT_ACTIONS: readonly RgbLedAction[] = [
  { kind: "solid", color: "#FF3366", intensity: 100, durationMs: 400 },
  { kind: "fade", color: "#3366FF", intensity: 80, durationMs: 600 },
  { kind: "wait", durationMs: 200 },
];

export function parseRgbLedConfig(properties: Readonly<Record<string, unknown>>): RgbLedConfig {
  const mode = properties.mode === "sequence" ? "sequence" : "preset";
  const presetRaw = typeof properties.preset === "string" ? properties.preset : "solid";
  const preset: RgbLedPreset =
    presetRaw === "breathe" || presetRaw === "blink" || presetRaw === "color_cycle" || presetRaw === "solid"
      ? presetRaw
      : "solid";
  const triggerEdge: RgbTriggerEdge = properties.triggerEdge === "falling" ? "falling" : "rising";
  const triggerAction: RgbTriggerAction = properties.triggerAction === "start" ? "start" : "follow";
  return {
    mode,
    preset,
    color: hexColor(properties.color, "#FF3366"),
    intensity: clampInt(properties.intensity, 0, 100, 100),
    speedMs: clampInt(properties.speedMs, 50, 60_000, 1200),
    loop: properties.loop !== false && properties.loop !== "false",
    triggerEdge,
    triggerAction,
    ledCount: clampInt(properties.ledCount, 1, 512, 1),
    actions: parseActions(properties.sequenceJson) ?? DEFAULT_ACTIONS,
  };
}

export function serializeRgbLedActions(actions: readonly RgbLedAction[]): string {
  return JSON.stringify(actions);
}

function parseActions(raw: unknown): readonly RgbLedAction[] | undefined {
  if (typeof raw !== "string" || raw.trim() === "") return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return undefined;
    const out: RgbLedAction[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const kind = (item as RgbLedAction).kind;
      if (kind !== "solid" && kind !== "fade" && kind !== "wait") continue;
      const durationMs = clampInt((item as RgbLedAction).durationMs, 0, 60_000, 300);
      if (kind === "wait") {
        out.push({ kind, durationMs });
        continue;
      }
      out.push({
        kind,
        color: hexColor((item as RgbLedAction).color, "#FF3366"),
        intensity: clampInt((item as RgbLedAction).intensity, 0, 100, 100),
        durationMs,
      });
    }
    return out.length > 0 ? out : undefined;
  } catch {
    return undefined;
  }
}

export type RgbLedVisual = {
  readonly color: string;
  readonly intensity: number;
};

/**
 * Resolve playback from a digital line + trigger edge/action.
 * `elapsedMs` advances color_cycle / breathe / blink while driven so the
 * canvas swatch isn't stuck on hue 0 (red) when the HIGH plateau is short
 * or highPhaseMs resets each edge.
 */
export function rgbLedPlaybackAt(
  signal: RgbLineSignal,
  config: RgbLedConfig,
  elapsedMs = 0,
): RgbLedVisual {
  if (config.triggerAction === "follow") {
    const driven = config.triggerEdge === "rising" ? signal.lineHigh : !signal.lineHigh;
    const phaseMs = config.triggerEdge === "rising" ? signal.highPhaseMs : signal.lowPhaseMs;
    return rgbLedVisualAt(effectPhaseMs(config, phaseMs, elapsedMs, driven), config, driven);
  }
  // start: chosen edge begins playback; opposite edge ignored
  const since = config.triggerEdge === "rising" ? signal.msSinceRising : signal.msSinceFalling;
  if (!Number.isFinite(since) || since < 0) return rgbLedVisualAt(0, config, false);
  return rgbLedVisualAt(effectPhaseMs(config, since, elapsedMs, true), config, true);
}

/** Dynamic presets keep a continuous clock while ON so color_cycle visibly cycles. */
function effectPhaseMs(config: RgbLedConfig, edgePhaseMs: number, elapsedMs: number, driven: boolean): number {
  if (!driven) return edgePhaseMs;
  if (config.mode === "preset" && (config.preset === "color_cycle" || config.preset === "breathe" || config.preset === "blink")) {
    return Math.max(0, elapsedMs);
  }
  return edgePhaseMs;
}

/**
 * Visual state while driven. `phaseMs` is time since the activating edge
 * (or since the start of the active plateau in follow mode).
 */
export function rgbLedVisualAt(phaseMs: number, config: RgbLedConfig, driven: boolean): RgbLedVisual {
  if (!driven) return { color: config.color, intensity: 0 };
  if (config.mode === "sequence") return sequenceVisualAt(phaseMs, config);
  return presetVisualAt(phaseMs, config);
}

function presetVisualAt(phaseMs: number, config: RgbLedConfig): RgbLedVisual {
  const base = config.intensity / 100;
  switch (config.preset) {
    case "solid":
      return { color: config.color, intensity: base };
    case "blink": {
      const half = Math.max(50, config.speedMs / 2);
      const on = Math.floor(phaseMs / half) % 2 === 0;
      return { color: config.color, intensity: on ? base : 0 };
    }
    case "breathe": {
      const period = Math.max(200, config.speedMs);
      const t = (phaseMs % period) / period;
      const wave = 0.5 - 0.5 * Math.cos(t * Math.PI * 2);
      return { color: config.color, intensity: base * wave };
    }
    case "color_cycle": {
      const period = Math.max(400, config.speedMs);
      const hue = ((phaseMs % period) / period) * 360;
      return { color: hslToHex(hue, 85, 55), intensity: base };
    }
  }
}

function sequenceVisualAt(phaseMs: number, config: RgbLedConfig): RgbLedVisual {
  const actions = config.actions;
  if (actions.length === 0) return { color: config.color, intensity: config.intensity / 100 };
  const total = actions.reduce((sum, a) => sum + Math.max(1, a.durationMs), 0);
  if (total <= 0) return { color: config.color, intensity: config.intensity / 100 };
  let t = config.loop ? ((phaseMs % total) + total) % total : Math.min(phaseMs, total - 1);
  if (!config.loop && phaseMs >= total) {
    const last = actions[actions.length - 1]!;
    if (last.kind === "wait") return { color: config.color, intensity: 0 };
    return { color: last.color ?? config.color, intensity: (last.intensity ?? config.intensity) / 100 };
  }
  let prevColor = config.color;
  let prevIntensity = config.intensity / 100;
  for (const action of actions) {
    const dur = Math.max(1, action.durationMs);
    if (t < dur) {
      if (action.kind === "wait") return { color: prevColor, intensity: 0 };
      if (action.kind === "solid") {
        return { color: action.color ?? config.color, intensity: (action.intensity ?? config.intensity) / 100 };
      }
      // fade
      const u = t / dur;
      const toColor = action.color ?? config.color;
      const toInt = (action.intensity ?? config.intensity) / 100;
      return {
        color: mixHex(prevColor, toColor, u),
        intensity: prevIntensity + (toInt - prevIntensity) * u,
      };
    }
    t -= dur;
    if (action.kind === "solid" || action.kind === "fade") {
      prevColor = action.color ?? prevColor;
      prevIntensity = (action.intensity ?? config.intensity) / 100;
    }
  }
  return { color: prevColor, intensity: prevIntensity };
}

function hexColor(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const t = raw.trim();
  return /^#[0-9a-fA-F]{6}$/.test(t) ? t.toUpperCase() : fallback;
}

function clampInt(raw: unknown, min: number, max: number, fallback: number): number {
  const n = typeof raw === "bigint" ? Number(raw) : typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function hslToHex(h: number, s: number, l: number): string {
  const S = s / 100;
  const L = l / 100;
  const C = (1 - Math.abs(2 * L - 1)) * S;
  const X = C * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = L - C / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [C, X, 0];
  else if (h < 120) [r, g, b] = [X, C, 0];
  else if (h < 180) [r, g, b] = [0, C, X];
  else if (h < 240) [r, g, b] = [0, X, C];
  else if (h < 300) [r, g, b] = [X, 0, C];
  else [r, g, b] = [C, 0, X];
  const to = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`.toUpperCase();
}

function mixHex(a: string, b: string, u: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  if (!pa || !pb) return b;
  const t = Math.min(1, Math.max(0, u));
  const mix = (x: number, y: number) => Math.round(x + (y - x) * t);
  const to = (v: number) => v.toString(16).padStart(2, "0");
  return `#${to(mix(pa.r, pb.r))}${to(mix(pa.g, pb.g))}${to(mix(pa.b, pb.b))}`.toUpperCase();
}

function parseHex(hex: string): { r: number; g: number; b: number } | undefined {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return undefined;
  const n = Number.parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export function rgbLedSubtitle(config: RgbLedConfig): string {
  const n = `×${config.ledCount}`;
  const edge = config.triggerEdge === "falling" ? "falling" : "rising";
  const action = config.triggerAction === "start" ? "avvia" : "segue";
  const trigger = `${edge} · ${action}`;
  if (config.mode === "sequence") return `Bay · uscita · sequenza (${config.actions.length}) · ${trigger} ${n}`;
  const label = RGB_LED_PRESET_OPTIONS.find((o) => o.value === config.preset)?.label ?? config.preset;
  return `Bay · uscita · ${label} · ${trigger} ${n}`;
}
