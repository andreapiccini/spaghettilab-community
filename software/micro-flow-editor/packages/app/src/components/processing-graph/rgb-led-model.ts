/**
 * RGB LED bay block — sequence player. The strip (N LEDs from bay, stubbed)
 * is driven as one. Input is a trigger; presets are ready-made sequences;
 * custom mode stores ordered actions.
 */

export type RgbLedMode = "preset" | "sequence";

export type RgbLedPreset = "solid" | "breathe" | "blink" | "color_cycle";

export type RgbLedActionKind = "solid" | "fade" | "wait";

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
  /** Stub until bay/NFC reports the strip length. */
  readonly ledCount: number;
  readonly actions: readonly RgbLedAction[];
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
  return {
    mode,
    preset,
    color: hexColor(properties.color, "#FF3366"),
    intensity: clampInt(properties.intensity, 0, 100, 100),
    speedMs: clampInt(properties.speedMs, 50, 60_000, 1200),
    loop: properties.loop !== false && properties.loop !== "false",
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
 * Visual state while dry-run / live preview. `phaseMs` is time since the last
 * trigger rising edge (or continuous elapsed when the drive line is HIGH).
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
  if (config.mode === "sequence") return `Bay · uscita · sequenza (${config.actions.length}) ${n}`;
  const label = RGB_LED_PRESET_OPTIONS.find((o) => o.value === config.preset)?.label ?? config.preset;
  return `Bay · uscita · ${label} ${n}`;
}
