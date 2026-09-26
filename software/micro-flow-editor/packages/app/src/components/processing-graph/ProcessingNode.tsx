import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Cable, Cpu, GitBranch, Palette, Power, Thermometer, ToggleLeft } from "lucide-react";
import { processingGraphCopy } from "../../lib/processing-graph-copy.js";
import { useLocale } from "../../state/locale-context.js";
import { FLOW_START_COLOR } from "./block-visuals.js";
import { lineHighAtElapsed, lineHighAtTick, waveformPlateaus, type ToggleMode } from "./dry-run-preview.js";
import { HoverDeleteButton } from "./HoverDeleteButton.js";
import { FLOW_START_SIZE, NODE_WIDTH } from "./layout-constants.js";
import { PROCESSING_NODE_KIND_CONFIG } from "./node-kinds.js";
import {
  nodeShellRadius,
  SOURCE_HANDLE_STYLE,
  stackedHandleTop,
  TARGET_HANDLE_STYLE,
} from "./node-ports.js";
import type { ProcessingNodeUiData } from "./to-nodes.js";

/** Slate chrome for hardware bay endpoints — distinct from solid functionality cards. */
const BAY_EDGE = "#64748B";
const CHANNEL_ROW_H = 22;

/**
 * Canvas card: n8n-like (solid icon tile + title/subtitle).
 * LED: filled swatch. Toggle: waveform. Flow Start: bare dark-violet disc —
 * the movable Schedule tick plug you wire to the first block inside the box.
 * Bay hardware: dashed slate shell + CPU badge (vs solid functionality blocks).
 * Multi-channel (Terminal block): named rows with a handle beside each label.
 */
export function ProcessingNode({ id, data, selected }: NodeProps & { readonly data: ProcessingNodeUiData }) {
  const { locale } = useLocale();
  const copy = processingGraphCopy(locale);
  const config = PROCESSING_NODE_KIND_CONFIG[data.kind];
  const Icon =
    data.tileGlyph === "toggle"
      ? ToggleLeft
      : data.tileGlyph === "palette"
        ? Palette
        : data.tileGlyph === "power"
          ? Power
          : data.tileGlyph === "cable"
            ? Cable
            : data.tileGlyph === "if"
              ? GitBranch
              : data.tileGlyph === "thermometer"
                ? Thermometer
                : config.icon;
  const inputHandles = data.inputHandles ?? (data.hasInput ? [{ id: "0" }] : []);
  const outputHandles = data.outputHandles ?? (data.hasOutput ? [{ id: "0" }] : []);
  const ports = { hasInput: inputHandles.length > 0, hasOutput: outputHandles.length > 0 };
  const multiChannel = outputHandles.length > 1 || inputHandles.length > 1;
  const previewOn = data.previewActive === true;
  const isRgb = data.rgbSwatch !== undefined;
  const isLed = data.ledColor !== undefined || isRgb;
  const isToggle = data.toggleWave !== undefined;
  const isTick = data.circular === true;
  const isBay = data.bay === true;
  // RGB is trigger-gated: off unless dry-run reports a driven intensity.
  // Never idle-animate color_cycle / breathe / blink — that looked "on" with no input.
  const ledColor = data.ledColor ?? data.rgbSwatch?.color ?? "#F5C518";
  const accent = data.accentColor ?? config.colorVar;
  const intensity = isLed && data.previewing ? (data.ledIntensity ?? (previewOn && !isRgb ? 1 : 0)) : isRgb ? 0 : undefined;
  const ledLit = intensity !== undefined && intensity > 0.08;
  const tileColor = data.hasError
    ? "var(--color-error)"
    : isLed
      ? intensity !== undefined
        ? mixLedTowardBlack(ledColor, intensity)
        : ledColor
      : accent;
  const cardHeight = data.cardHeight;
  const cardWidth = data.cardWidth ?? NODE_WIDTH;

  const isRelay = data.tileGlyph === "power";
  const isIf = data.tileGlyph === "if";
  const subtitle =
    isLed && data.previewing && intensity !== undefined
      ? intensity > 0.85
        ? "ON"
        : intensity < 0.15
          ? "OFF"
          : `${Math.round(intensity * 100)}%`
      : isRelay && data.previewing
        ? previewOn
          ? "CLOSED"
          : "OPEN"
        : isIf && data.previewing
          ? previewOn
            ? "HIGH"
            : "LOW"
          : data.tempProbe
            ? `${Math.round(data.tempProbe.celsius)}°C`
            : data.subtitle;

  if (isTick) {
    const fill = data.hasError ? "var(--color-error)" : (data.accentColor ?? FLOW_START_COLOR);
    return (
      <div className="group relative" style={{ width: FLOW_START_SIZE, height: FLOW_START_SIZE }}>
        <div
          className="relative h-full w-full rounded-full shadow-e1 transition-[box-shadow,outline]"
          style={{
            backgroundColor: fill,
            outline: selected
              ? "2px solid var(--color-brand-blue)"
              : previewOn
                ? `2px solid color-mix(in srgb, ${fill} 70%, white)`
                : "1px solid color-mix(in srgb, #000 22%, transparent)",
            boxShadow: previewOn
              ? `0 0 0 4px color-mix(in srgb, ${fill} 35%, transparent), var(--shadow-e1)`
              : undefined,
            cursor: "default",
          }}
          title={copy.scheduleActivation}
        >
          <Handle
            type="source"
            position={Position.Right}
            id="0"
            style={{
              ...SOURCE_HANDLE_STYLE,
              width: 8,
              height: 8,
              right: -2,
              border: `1.5px solid ${fill}`,
              background: "var(--color-surface)",
            }}
          />
        </div>
      </div>
    );
  }

  const shellRadius = isBay ? "2px" : nodeShellRadius(ports);
  const idleOutline = isBay
    ? `1.5px dashed color-mix(in srgb, ${BAY_EDGE} 75%, transparent)`
    : "1px solid var(--color-border)";
  const selectedOutline = selected
    ? "2px solid var(--color-brand-blue)"
    : ledLit
      ? `2px solid ${ledColor}`
      : undefined;

  return (
    <div className="group relative" style={{ width: cardWidth }} data-tour-target={`flow-node-${id}`}>
      <HoverDeleteButton
        id={id}
        label={copy.deleteBlock}
        forceVisible={selected}
        corner={multiChannel ? "left" : "right"}
      />
      {isBay && !multiChannel && (
        <span
          className="pointer-events-none absolute -top-2 right-1 z-10 inline-flex items-center gap-0.5 rounded-[3px] px-1 py-px font-mono text-[9px] font-semibold uppercase tracking-wide"
          style={{
            color: BAY_EDGE,
            backgroundColor: "var(--color-surface)",
            outline: `1px solid color-mix(in srgb, ${BAY_EDGE} 45%, transparent)`,
          }}
          title={copy.bayModule}
        >
          <Cpu size={9} strokeWidth={2.5} aria-hidden />
          Bay
        </span>
      )}
      <div
        className={`relative flex shadow-e1 transition-[outline,box-shadow] group-hover:shadow-e2 ${multiChannel ? "flex-col gap-1 px-2.5 py-2" : `w-full items-center gap-2 py-2 ${isLed ? "pl-4 pr-2.5" : "px-2.5"}`} ${selected || ledLit ? "" : "group-hover:outline-2"}`}
        style={{
          width: cardWidth,
          minHeight: cardHeight,
          borderRadius: shellRadius,
          backgroundColor: isBay
            ? `color-mix(in srgb, ${BAY_EDGE} 6%, var(--color-surface))`
            : "var(--color-surface)",
          outline: selectedOutline ?? idleOutline,
          // LED glow must not be clipped by the card / bay chrome.
          overflow: isLed ? "visible" : undefined,
          boxShadow: ledLit
            ? `0 0 0 4px ${ledGlowRgba(ledColor, 0.12 + (intensity ?? 1) * 0.2)}, var(--shadow-e1)`
            : undefined,
        }}
      >
        {isBay && (
          <span
            className="absolute inset-y-1.5 left-0 w-0.5 rounded-full"
            style={{ backgroundColor: `color-mix(in srgb, ${BAY_EDGE} 70%, transparent)` }}
            aria-hidden
          />
        )}

        {!multiChannel &&
          inputHandles.map((handle, index) => (
            <Handle
              key={`in-${handle.id}`}
              type="target"
              position={Position.Left}
              id={handle.id}
              title={handle.label}
              style={{
                ...TARGET_HANDLE_STYLE,
                top: stackedHandleTop(index, inputHandles.length),
              }}
            />
          ))}

        {/* No overflow-hidden on LED: tile box-shadow (glow) would get clipped on the left. */}
        <div className={`flex min-w-0 flex-1 items-center gap-2 ${multiChannel ? "w-full pr-1" : isLed ? "" : "overflow-hidden"}`}>
          <div
            key={`led-${ledColor}-${Math.round((intensity ?? 1) * 100)}`}
            className={`h-7 w-7 shrink-0 ${isBay ? "rounded-[3px]" : "rounded-slsm"}`}
            style={{
              backgroundColor: isRelay ? (previewOn ? "#0F766E" : "#64748B") : tileColor,
              transition: isRelay ? "background-color 180ms ease, box-shadow 180ms ease" : undefined,
              boxShadow: ledLit
                ? `0 0 ${Math.round(4 + (intensity ?? 1) * 10)}px ${Math.round(1 + (intensity ?? 1) * 2)}px ${ledGlowRgba(ledColor, 0.35 + (intensity ?? 1) * 0.45)}`
                : isRelay && previewOn
                  ? "0 0 0 3px color-mix(in srgb, #0F766E 35%, transparent)"
                  : undefined,
            }}
            aria-hidden
          >
            {isRelay ? (
              <RelayContact closed={previewOn} />
            ) : !isLed ? (
              <div className="flex h-full w-full items-center justify-center">
                <Icon size={14} color="#fff" />
              </div>
            ) : null}
          </div>
          <div className="min-w-0 flex-1 overflow-hidden">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="min-w-0 truncate font-body text-sm font-semibold text-ink" title={data.label}>
                {data.label}
              </div>
              {isBay && multiChannel && (
                <span
                  className="inline-flex shrink-0 items-center gap-0.5 rounded-[3px] px-1 py-px font-mono text-[9px] font-semibold uppercase tracking-wide"
                  style={{
                    color: BAY_EDGE,
                    outline: `1px solid color-mix(in srgb, ${BAY_EDGE} 45%, transparent)`,
                  }}
                  title={copy.bayModule}
                >
                  <Cpu size={9} strokeWidth={2.5} aria-hidden />
                  Bay
                </span>
              )}
            </div>
            <div className="truncate font-body text-xs text-ink-faint" title={subtitle}>
              {subtitle}
            </div>
          </div>
        </div>

        {multiChannel ? (
          <div className="relative flex flex-col">
            {outputHandles.map((handle) => (
              <div
                key={`out-row-${handle.id}`}
                className="relative flex items-center justify-end gap-1.5 pr-3"
                style={{ height: CHANNEL_ROW_H }}
              >
                <span className="min-w-0 truncate text-right font-mono text-[10px] font-medium text-ink-muted" title={handle.label}>
                  {handle.label ?? handle.id}
                </span>
                <Handle
                  type="source"
                  position={Position.Right}
                  id={handle.id}
                  title={handle.label}
                  style={{
                    ...SOURCE_HANDLE_STYLE,
                    width: 10,
                    height: 10,
                    right: -2,
                    top: "50%",
                    transform: "translateY(-50%)",
                  }}
                />
              </div>
            ))}
            {inputHandles.map((handle, index) => (
              <Handle
                key={`in-${handle.id}`}
                type="target"
                position={Position.Left}
                id={handle.id}
                title={handle.label}
                style={{
                  ...TARGET_HANDLE_STYLE,
                  top: stackedHandleTop(index, Math.max(inputHandles.length, outputHandles.length)),
                }}
              />
            ))}
          </div>
        ) : (
          <>
            {outputHandles.map((handle, index) => (
              <Handle
                key={`out-${handle.id}`}
                type="source"
                position={Position.Right}
                id={handle.id}
                title={handle.label}
                style={{
                  ...SOURCE_HANDLE_STYLE,
                  top: stackedHandleTop(index, outputHandles.length),
                }}
              />
            ))}
            {isToggle && data.toggleWave && ports.hasOutput && (
              <ToggleOutputWaveform
                mode={data.toggleWave.mode}
                highTicks={data.toggleWave.highTicks}
                lowTicks={data.toggleWave.lowTicks}
                initialHigh={data.toggleWave.initialHigh}
                pulseMs={data.toggleWave.pulseMs}
                live={data.waveLive}
                lineHigh={previewOn}
                color={accent}
              />
            )}
          </>
        )}
      </div>
      {data.tempProbe && (
        <div
          className="nodrag nowheel nopan absolute left-0 right-0 top-full z-20 mt-1.5 px-0.5"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <input
            type="range"
            min={data.tempProbe.min}
            max={data.tempProbe.max}
            step={1}
            value={data.tempProbe.celsius}
            aria-label="Test temperature"
            onChange={(event) => data.tempProbe?.onChange?.(Number(event.target.value))}
            className="h-1.5 w-full cursor-ew-resize appearance-none rounded-full"
            style={{
              background: "linear-gradient(90deg, #38BDF8, #F97316)",
              accentColor: "#0EA5E9",
            }}
          />
          <div className="mt-0.5 text-center font-mono text-[10px] font-semibold text-ink-muted">
            {Math.round(data.tempProbe.celsius)}°C
          </div>
        </div>
      )}
    </div>
  );
}

function RelayContact({ closed }: { readonly closed: boolean }) {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" className="block">
      <circle cx="7" cy="19" r="2.2" fill="#fff" />
      <circle cx="21" cy="19" r="2.2" fill="#fff" />
      <path d="M7 19H21" stroke="rgba(255,255,255,0.28)" strokeWidth="1.25" />
      <g
        style={{
          transformOrigin: "7px 19px",
          transform: closed ? "rotate(0deg)" : "rotate(-34deg)",
          transition: "transform 180ms ease",
        }}
      >
        <path d="M7 19H21.5" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" />
      </g>
    </svg>
  );
}

function ToggleOutputWaveform({
  mode,
  highTicks,
  lowTicks,
  initialHigh,
  pulseMs,
  live,
  lineHigh,
  color,
}: {
  readonly mode: ToggleMode;
  readonly highTicks: number;
  readonly lowTicks: number;
  readonly initialHigh: boolean;
  readonly pulseMs: number;
  readonly live: ProcessingNodeUiData["waveLive"];
  readonly lineHigh: boolean;
  readonly color: string;
}) {
  const w = live ? 52 : 34;
  const h = 16;
  const highY = 3;
  const lowY = 13;
  const path = live
    ? scrollingWavePath(live.elapsedMs, live.periodMs, mode, highTicks, lowTicks, initialHigh, pulseMs, w, highY, lowY)
    : staticWavePath(mode, highTicks, lowTicks, initialHigh, pulseMs, w, highY, lowY);
  const stroke = live ? (lineHigh ? color : "color-mix(in srgb, var(--color-ink-faint) 65%, transparent)") : color;
  const opacity = live ? 1 : 0.72;

  return (
    <span
      className="pointer-events-none absolute right-0 top-1/2 z-10 -translate-y-1/2 translate-x-[calc(100%+10px)] rounded-[3px] px-0.5 py-px"
      style={{
        backgroundColor: "var(--color-surface)",
        outline: `1px solid color-mix(in srgb, ${color} 28%, var(--color-border))`,
        boxShadow: live && lineHigh ? `0 0 0 2px color-mix(in srgb, ${color} 22%, transparent)` : undefined,
      }}
      aria-hidden
    >
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="block">
        <path d={path} fill="none" stroke={stroke} strokeWidth={1.6} strokeLinejoin="miter" strokeLinecap="square" opacity={opacity} />
        {live && (
          <circle cx={w - 2.5} cy={lineHigh ? highY : lowY} r={1.7} fill={lineHigh ? color : "var(--color-ink-faint)"} />
        )}
      </svg>
    </span>
  );
}

function staticWavePath(
  mode: ToggleMode,
  highTicks: number,
  lowTicks: number,
  initialHigh: boolean,
  pulseMs: number,
  w: number,
  highY: number,
  lowY: number,
): string {
  if (mode === "pulse_high" || mode === "pulse_low") {
    const pulseFrac = Math.min(0.45, Math.max(0.12, pulseMs / 1000));
    const xPulse = Math.max(4, w * pulseFrac);
    if (mode === "pulse_high") {
      return `M 1 ${lowY} L 1 ${highY} L ${xPulse.toFixed(1)} ${highY} L ${xPulse.toFixed(1)} ${lowY} L ${(w - 1).toFixed(1)} ${lowY}`;
    }
    return `M 1 ${highY} L 1 ${lowY} L ${xPulse.toFixed(1)} ${lowY} L ${xPulse.toFixed(1)} ${highY} L ${(w - 1).toFixed(1)} ${highY}`;
  }
  const plateaus = waveformPlateaus(highTicks, lowTicks, initialHigh);
  const total = Math.max(1, highTicks + lowTicks);
  const padX = 1;
  const usable = w - padX * 2;
  let x = padX;
  const parts: string[] = [];
  let first = true;
  for (const plateau of plateaus) {
    const y = plateau.high ? highY : lowY;
    const segW = (plateau.ticks / total) * usable;
    if (first) {
      parts.push(`M ${x.toFixed(1)} ${y}`);
      first = false;
    } else {
      parts.push(`L ${x.toFixed(1)} ${y}`);
    }
    x += segW;
    parts.push(`L ${x.toFixed(1)} ${y}`);
  }
  return parts.join(" ");
}

function scrollingWavePath(
  elapsedMs: number,
  periodMs: number,
  mode: ToggleMode,
  highTicks: number,
  lowTicks: number,
  initialHigh: boolean,
  pulseMs: number,
  w: number,
  highY: number,
  lowY: number,
): string {
  const safePeriod = Math.max(1, periodMs);
  const cycleMs = mode === "astable" ? safePeriod * Math.max(1, highTicks + lowTicks) : safePeriod;
  const windowMs = Math.max(cycleMs * 2, safePeriod * 2);
  const samples = 48;
  const padX = 1;
  const usable = w - padX * 2;
  let d = "";
  let prevY: number | null = null;
  const channel = {
    triggerId: "",
    periodMs: safePeriod,
    highTicks,
    lowTicks,
    initialHigh,
    toggleMode: mode,
    pulseMs,
    actuators: [] as const,
    rgbActuators: [] as const,
    toggleIds: [] as const,
    startIds: [] as const,
  };
  for (let i = 0; i <= samples; i++) {
    const t = elapsedMs - windowMs + (i / samples) * windowMs;
    const x = padX + (i / samples) * usable;
    let high: boolean;
    if (t < 0) {
      high = mode === "pulse_low" ? true : mode === "pulse_high" ? false : initialHigh;
    } else if (mode === "astable") {
      high = lineHighAtTick(Math.floor(t / safePeriod), highTicks, lowTicks, initialHigh);
    } else {
      high = lineHighAtElapsed(t, channel);
    }
    const y = high ? highY : lowY;
    if (prevY === null) {
      d = `M ${x.toFixed(2)} ${y}`;
    } else if (y !== prevY) {
      d += ` L ${x.toFixed(2)} ${prevY} L ${x.toFixed(2)} ${y}`;
    } else {
      d += ` L ${x.toFixed(2)} ${y}`;
    }
    prevY = y;
  }
  return d;
}

/** Dim an LED hex toward black by intensity (0–1), keeping the same hue. */
function mixLedTowardBlack(hex: string, intensity: number): string {
  const rgb = parseCssHex(hex);
  if (!rgb) return hex;
  const t = Math.min(1, Math.max(0, intensity));
  // Keep a visible floor so the swatch never collapses to pure black while "on".
  const gain = 0.18 + t * 0.82;
  const to = (v: number) => Math.round(v * gain).toString(16).padStart(2, "0");
  return `#${to(rgb.r)}${to(rgb.g)}${to(rgb.b)}`;
}

function ledGlowRgba(hex: string, alpha: number): string {
  const rgb = parseCssHex(hex);
  if (!rgb) return `rgba(245, 197, 24, ${alpha})`;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.min(1, Math.max(0, alpha))})`;
}

function parseCssHex(hex: string): { r: number; g: number; b: number } | undefined {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return undefined;
  const n = Number.parseInt(m[1]!, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

export const PROCESSING_NODE_TYPES = { processing: ProcessingNode };
