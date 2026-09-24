import { Handle, Position, type NodeProps } from "@xyflow/react";
import { CirclePlay, Clock, Radio, ToggleLeft } from "lucide-react";
import { lineHighAtTick, waveformPlateaus } from "./dry-run-preview.js";
import { formatSchedulePeriod } from "./event-containers.js";
import { HoverDeleteButton } from "./HoverDeleteButton.js";
import { PROCESSING_NODE_KIND_CONFIG } from "./node-kinds.js";
import { nodeShellRadius, SOURCE_HANDLE_STYLE, TARGET_HANDLE_STYLE } from "./node-ports.js";
import type { ProcessingNodeUiData } from "./to-nodes.js";

/**
 * Canvas card: n8n-like (solid icon tile + title/subtitle, no category stripe).
 * LED: filled swatch + soglia/soft. Toggle: waveform. Schedule/Event feed:
 * clock chip on the input instead of a separate Start circle.
 */
export function ProcessingNode({ id, data, selected }: NodeProps & { readonly data: ProcessingNodeUiData }) {
  const config = PROCESSING_NODE_KIND_CONFIG[data.kind];
  const Icon = data.circular ? CirclePlay : data.toggleIcon ? ToggleLeft : config.icon;
  const ports = { hasInput: data.hasInput, hasOutput: data.hasOutput };
  const previewOn = data.previewActive === true;
  const isLed = data.ledColor !== undefined;
  const isToggle = data.toggleWave !== undefined;
  const isStart = data.circular === true;
  const feed = data.triggerFeed;
  const ledColor = data.ledColor ?? "#F5C518";
  const accent = data.accentColor ?? config.colorVar;
  const intensity = isLed && data.previewing ? (data.ledIntensity ?? (previewOn ? 1 : 0)) : undefined;
  const ledLit = intensity !== undefined && intensity > 0.08;
  const tileColor = data.hasError
    ? "var(--color-error)"
    : isLed
      ? intensity !== undefined
        ? `color-mix(in srgb, ${ledColor} ${Math.round(22 + intensity * 78)}%, #2A2E38)`
        : ledColor
      : accent;

  const subtitle =
    isLed && data.previewing && intensity !== undefined
      ? intensity > 0.85
        ? "ON"
        : intensity < 0.15
          ? "OFF"
          : `${Math.round(intensity * 100)}%`
      : data.subtitle;

  if (isStart) {
    return (
      <div className="group relative">
        <HoverDeleteButton id={id} label="Elimina blocco" forceVisible={selected} />
        <div
          className="relative flex h-16 w-16 items-center justify-center bg-surface shadow-e1 transition-[outline,box-shadow] group-hover:shadow-e2"
          style={{
            borderRadius: 9999,
            outline: selected
              ? "2px solid var(--color-brand-blue)"
              : previewOn
                ? `2px solid ${accent}`
                : "1px solid var(--color-border)",
            boxShadow: previewOn
              ? `0 0 0 4px color-mix(in srgb, ${accent} 28%, transparent), var(--shadow-e1)`
              : undefined,
          }}
          title={data.label}
        >
          {ports.hasInput && <Handle type="target" position={Position.Left} id="0" style={TARGET_HANDLE_STYLE} />}
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full"
            style={{ backgroundColor: tileColor }}
            aria-hidden
          >
            <Icon size={18} color="#fff" />
          </div>
          {ports.hasOutput && <Handle type="source" position={Position.Right} id="0" style={SOURCE_HANDLE_STYLE} />}
        </div>
        <div className="pointer-events-none absolute left-1/2 top-full mt-1 w-24 -translate-x-1/2 text-center font-body text-[10px] font-semibold text-ink-muted">
          {data.label}
        </div>
      </div>
    );
  }

  return (
    <div className="group relative">
      <HoverDeleteButton id={id} label="Elimina blocco" forceVisible={selected} />
      {feed && <TriggerFeedChip feed={feed} previewActive={previewOn} />}
      <div
        className={`relative flex w-56 items-center gap-3 bg-surface px-3 py-2.5 shadow-e1 transition-[outline,box-shadow] group-hover:shadow-e2 ${selected ? "" : "outline outline-1 outline-[var(--color-border)] group-hover:outline-2 group-hover:outline-[var(--color-brand-blue)]"}`}
        style={{
          borderRadius: nodeShellRadius(ports),
          outline: selected ? "2px solid var(--color-brand-blue)" : ledLit ? `2px solid ${ledColor}` : undefined,
          boxShadow: ledLit
            ? `0 0 0 4px color-mix(in srgb, ${ledColor} ${Math.round(12 + (intensity ?? 1) * 20)}%, transparent), var(--shadow-e1)`
            : undefined,
        }}
      >
        {ports.hasInput && (
          <Handle
            type="target"
            position={Position.Left}
            id="0"
            style={
              feed
                ? {
                    ...TARGET_HANDLE_STYLE,
                    width: 12,
                    height: 12,
                    borderRadius: 9999,
                    border: `2px solid ${PROCESSING_NODE_KIND_CONFIG[feed.kind].colorVar}`,
                    background: "var(--color-surface)",
                  }
                : TARGET_HANDLE_STYLE
            }
          />
        )}
        <div
          className="h-8 w-8 shrink-0 rounded-slsm transition-[background-color,box-shadow] duration-75"
          style={{
            backgroundColor: tileColor,
            boxShadow: ledLit
              ? `0 0 ${Math.round(4 + (intensity ?? 1) * 10)}px ${Math.round(1 + (intensity ?? 1) * 2)}px color-mix(in srgb, ${ledColor} ${Math.round(40 + (intensity ?? 1) * 40)}%, transparent)`
              : undefined,
          }}
          aria-hidden
        >
          {!isLed && (
            <div className="flex h-full w-full items-center justify-center">
              <Icon size={16} color="#fff" />
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-body text-sm font-semibold text-ink">{data.label}</div>
          <div className="truncate font-body text-xs text-ink-faint">{subtitle}</div>
        </div>
        {ports.hasOutput && (
          <>
            <Handle type="source" position={Position.Right} id="0" style={SOURCE_HANDLE_STYLE} />
            {isToggle && data.toggleWave && (
              <ToggleOutputWaveform
                highTicks={data.toggleWave.highTicks}
                lowTicks={data.toggleWave.lowTicks}
                initialHigh={data.toggleWave.initialHigh}
                live={data.waveLive}
                lineHigh={previewOn}
                color={accent}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** Clock/radio chip: this block’s input is driven by the enclosing trigger. */
function TriggerFeedChip({
  feed,
  previewActive,
}: {
  readonly feed: NonNullable<ProcessingNodeUiData["triggerFeed"]>;
  readonly previewActive: boolean;
}) {
  const kindConfig = PROCESSING_NODE_KIND_CONFIG[feed.kind];
  const FeedIcon = feed.kind === "schedule" ? Clock : Radio;
  const text =
    feed.kind === "schedule" && feed.periodMs !== undefined ? formatSchedulePeriod(feed.periodMs) : feed.label;
  const color = kindConfig.colorVar;

  return (
    <div
      className="pointer-events-none absolute left-0 top-1/2 z-10 flex -translate-x-[calc(100%+10px)] -translate-y-1/2 items-center gap-1"
      title={`${feed.label} → ingresso di questo blocco`}
    >
      <span
        className="flex items-center gap-1 rounded-slsm px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums"
        style={{
          color,
          backgroundColor: "var(--color-surface)",
          outline: `1px solid color-mix(in srgb, ${color} 40%, var(--color-border))`,
          boxShadow: previewActive ? `0 0 0 3px color-mix(in srgb, ${color} 28%, transparent)` : "var(--shadow-e1)",
        }}
      >
        <FeedIcon size={11} strokeWidth={2.25} aria-hidden />
        {text}
      </span>
      <span className="h-px w-2.5" style={{ backgroundColor: color }} aria-hidden />
    </div>
  );
}

function ToggleOutputWaveform({
  highTicks,
  lowTicks,
  initialHigh,
  live,
  lineHigh,
  color,
}: {
  readonly highTicks: number;
  readonly lowTicks: number;
  readonly initialHigh: boolean;
  readonly live: ProcessingNodeUiData["waveLive"];
  readonly lineHigh: boolean;
  readonly color: string;
}) {
  const w = live ? 52 : 34;
  const h = 16;
  const highY = 3;
  const lowY = 13;
  const path = live
    ? scrollingWavePath(live.elapsedMs, live.periodMs, highTicks, lowTicks, initialHigh, w, highY, lowY)
    : staticWavePath(highTicks, lowTicks, initialHigh, w, highY, lowY);
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
  highTicks: number,
  lowTicks: number,
  initialHigh: boolean,
  w: number,
  highY: number,
  lowY: number,
): string {
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
  highTicks: number,
  lowTicks: number,
  initialHigh: boolean,
  w: number,
  highY: number,
  lowY: number,
): string {
  const safePeriod = Math.max(1, periodMs);
  const cycleMs = safePeriod * Math.max(1, highTicks + lowTicks);
  const windowMs = Math.max(cycleMs * 2, safePeriod * 2);
  const samples = 48;
  const padX = 1;
  const usable = w - padX * 2;
  let d = "";
  let prevY: number | null = null;
  for (let i = 0; i <= samples; i++) {
    const t = elapsedMs - windowMs + (i / samples) * windowMs;
    const x = padX + (i / samples) * usable;
    let high: boolean;
    if (t < 0) {
      high = initialHigh;
    } else {
      high = lineHighAtTick(Math.floor(t / safePeriod), highTicks, lowTicks, initialHigh);
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

export const PROCESSING_NODE_TYPES = { processing: ProcessingNode };
