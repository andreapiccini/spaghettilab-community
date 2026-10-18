import { useLayoutEffect, useRef, useState } from "react";
import { readableTimingScale } from "../../lib/timing-scale.js";
/**
 * Logic-analyzer / oscilloscope-style timing diagram (illustrative SVG).
 * Phase bands show protocol framing (START/STOP/Sr/ACK/NACK/ADDR/DATA).
 */

import type {
  TimingEdge,
  TimingLane,
  TimingLevel,
  TimingPhaseBand,
  TimingStepSpan,
} from "../../lib/timing-scope-types.js";

export type {
  TimingEdge,
  TimingLane,
  TimingLevel,
  TimingPhaseBand,
  TimingSpanAnnotation,
  TimingStepSpan,
} from "../../lib/timing-scope-types.js";

type Props = {
  readonly title?: string;
  readonly caption?: string;
  readonly lanes: readonly TimingLane[];
  readonly durationMs: number;
  /** Protocol framing bands (START / ACK / …). */
  readonly phaseBands?: readonly TimingPhaseBand[];
  /** Recipe steps aligned on the same time axis. */
  readonly stepSpans?: readonly TimingStepSpan[];
  readonly highlightOpId?: string | null;
  readonly onSelectOp?: (opId: string) => void;
  readonly onChangeByte?: (opId: string, index: number, value: string) => void;
  readonly onAddByte?: (opId: string) => void;
  readonly className?: string;
};

const TRACE = "#2563eb";
const TRACE_SOFT = "rgba(37, 99, 235, 0.12)";
const GRID = "#e2e8f0";
const MUTED = "#94a3b8";
const INK = "#0f172a";
const DASH = "#94a3b8";

export function TimingScopeChart({
  title,
  caption,
  lanes,
  durationMs,
  phaseBands = [],
  stepSpans = [],
  highlightOpId = null,
  onSelectOp,
  className,
  onChangeByte,
  onAddByte,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [byteFormat, setByteFormat] = useState<"hex" | "binary">("hex");
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    function alignSelectedStep() {
      if (!viewport) return;
      const anchors = [
        ...viewport.querySelectorAll<SVGRectElement>("[data-timing-step-id]"),
      ];
      const anchor = anchors.find(
        (element) => element.dataset.timingStepId === highlightOpId,
      );
      if (!anchor || anchor === anchors[0]) {
        viewport.scrollLeft = 0;
        return;
      }
      // Keep the selected transaction start visible, with space for lane labels.
      const offset =
        anchor.getBoundingClientRect().left -
        viewport.getBoundingClientRect().left +
        viewport.scrollLeft;
      viewport.scrollTo({ left: Math.max(0, offset - 78), behavior: "auto" });
    }
    alignSelectedStep();
    const observer = new ResizeObserver(alignSelectedStep);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [highlightOpId, zoom, byteFormat]);

  const displayByte = (value: string) =>
    byteFormat === "binary" && /^(?:0x)?[0-9a-f]{1,2}$/i.test(value)
      ? `0b${Number.parseInt(value.replace(/^0x/i, ""), 16).toString(2).padStart(8, "0")}`
      : value;
  const dur = Math.max(1, durationMs);
  const labelW = 56;
  const levelW = 22;
  const left = labelW + levelW;
  const padR = 16;
  const laneH = 48;
  const stepH = stepSpans.length ? 36 : 0;
  const bandH = phaseBands.length ? 28 : 0;
  const titleH = 4;
  const padTop = titleH + stepH + bandH;
  const padBot = caption ? 18 : 8;
  const scale = readableTimingScale(
    dur,
    phaseBands,
    stepSpans,
    byteFormat === "binary" ? Math.max(1.4, zoom * 1.4) : zoom,
  );
  const plotW = scale.width;
  const width = left + plotW + padR;
  const height = padTop + lanes.length * laneH + padBot;
  const stepY = titleH;
  const bandY = titleH + stepH;

  const xAt = (t: number) => left + scale.xAt(Math.min(dur, Math.max(0, t)));
  const yHigh = (laneIndex: number) => padTop + laneIndex * laneH + 12;
  const yLow = (laneIndex: number) => padTop + laneIndex * laneH + 34;
  const plotBottom = padTop + lanes.length * laneH - 6;

  return (
    <div className={className}>
      {(title || phaseBands.length > 0) && (
        <div className="mb-2 flex items-center justify-between gap-3">
          {title ? (
            <h3 className="font-display text-sm font-bold text-ink">{title}</h3>
          ) : (
            <span />
          )}
          {phaseBands.length > 0 && (
            <div className="flex shrink-0 items-center gap-1 font-body text-xs">
              <select
                aria-label="Formato byte"
                value={byteFormat}
                onChange={(event) =>
                  setByteFormat(event.target.value as "hex" | "binary")
                }
                className="mr-2 rounded border border-border bg-surface px-2 py-1 text-ink"
              >
                <option value="hex">HEX</option>
                <option value="binary">Binario</option>
              </select>
              <button
                type="button"
                aria-label="Riduci diagramma"
                onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}
                className="rounded border border-border px-2 py-1"
              >
                −
              </button>
              <button
                type="button"
                aria-label="Ripristina zoom diagramma"
                onClick={() => setZoom(1)}
                className="rounded border border-border px-2 py-1"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                type="button"
                aria-label="Ingrandisci diagramma"
                onClick={() => setZoom((value) => Math.min(4, value + 0.25))}
                className="rounded border border-border px-2 py-1"
              >
                +
              </button>
            </div>
          )}
        </div>
      )}
      <div
        ref={viewportRef}
        className="max-w-full overflow-x-auto"
        tabIndex={0}
        aria-label="Diagramma scorrevole"
      >
        <svg
          style={{ width: phaseBands.length ? `${width}px` : "100%", minWidth: "100%" }}
          viewBox={`0 0 ${width} ${height}`}
          role={onChangeByte ? "group" : "img"}
          aria-label={title ?? "Timing"}
        >
          {/* Recipe steps — same time axis as SCL/SDA */}
          {stepSpans.length > 0 ? (
            <g>
              <text
                x={4}
                y={stepY + 14}
                fill={MUTED}
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  fontFamily: "Manrope, sans-serif",
                }}
              >
                AZIONE
              </text>
              {stepSpans.map((step) => {
                const x0 = xAt(step.t0);
                const x1 = xAt(step.t1);
                const w = Math.max(18, x1 - x0);
                const hi = highlightOpId === step.opId;
                const fill = hi
                  ? step.kind === "bus"
                    ? "rgba(15,23,42,0.92)"
                    : "rgba(37,99,235,0.18)"
                  : step.kind === "bus"
                    ? "rgba(15,23,42,0.78)"
                    : "rgba(148,163,184,0.18)";
                const ink = step.kind === "bus" || hi ? "#fff" : INK;
                const shortLabel =
                  w < 72
                    ? `${step.index + 1}`
                    : w < 120
                      ? `${step.index + 1}. ${step.label.slice(0, 18)}${step.label.length > 18 ? "…" : ""}`
                      : `${step.index + 1}. ${step.label}`;
                return (
                  <g
                    key={step.opId}
                    style={{ cursor: onSelectOp ? "pointer" : "default" }}
                    onClick={() => onSelectOp?.(step.opId)}
                  >
                    <title>{`${step.index + 1}. ${step.label}`}</title>
                    <rect
                      data-timing-step-id={step.opId}
                      x={x0}
                      y={stepY + 2}
                      width={w}
                      height={stepH - 8}
                      rx={4}
                      fill={fill}
                      stroke={hi ? TRACE : "rgba(15,23,42,0.15)"}
                      strokeWidth={hi ? 1.5 : 0.75}
                    />
                    <text
                      x={w > 500 ? x0 + 12 : x0 + w / 2}
                      y={stepY + 20}
                      textAnchor={w > 500 ? "start" : "middle"}
                      fill={step.kind === "bus" ? "#fff" : ink}
                      style={{
                        fontSize: 8,
                        fontWeight: 700,
                        fontFamily: "Manrope, sans-serif",
                      }}
                    >
                      {shortLabel}
                    </text>
                    <line
                      x1={x0}
                      y1={stepY + stepH - 6}
                      x2={x0}
                      y2={plotBottom}
                      stroke={hi ? TRACE : MUTED}
                      strokeWidth={hi ? 1 : 0.5}
                      strokeDasharray="2 3"
                      opacity={0.4}
                    />
                  </g>
                );
              })}
            </g>
          ) : null}

          {phaseBands.length > 0 && (
            <text
              x={4}
              y={bandY + 16}
              fill={MUTED}
              style={{
                fontSize: 9,
                fontWeight: 700,
                fontFamily: "Manrope, sans-serif",
              }}
            >
              BYTE
            </text>
          )}

          {/* Phase bands — START / STOP / Sr / ACK / NACK / ADDR / DATA */}
          {phaseBands.map((band) => {
            const x0 = xAt(band.t0);
            const x1 = xAt(band.t1);
            const w = Math.max(2, x1 - x0);
            const hi = highlightOpId && band.opId === highlightOpId;
            const fill =
              band.color ?? (hi ? "rgba(37,99,235,0.2)" : "rgba(148,163,184,0.12)");
            const short = band.label.length <= 2;
            const showLabel = short ? w >= 5 : w > 12;
            return (
              <g
                key={band.id}
                style={{ cursor: onSelectOp && band.opId ? "pointer" : "default" }}
                onClick={() => band.opId && onSelectOp?.(band.opId)}
              >
                <rect
                  x={x0}
                  y={bandY}
                  width={w}
                  height={bandH - 4}
                  fill={fill}
                  stroke={hi ? TRACE : "rgba(15,23,42,0.12)"}
                  strokeWidth={hi ? 1 : 0.5}
                />
                {band.editableByte && band.opId && onChangeByte ? (
                  <foreignObject
                    x={x0 + 1}
                    y={bandY + 1}
                    width={Math.max(20, w - 2)}
                    height={bandH - 6}
                  >
                    <div
                      className="flex h-full items-center"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <input
                        key={`${byteFormat}:${band.editableByte.value}`}
                        aria-label={`Byte ${band.editableByte.index + 1} · ${band.opId}`}
                        defaultValue={displayByte(band.editableByte.value)}
                        spellCheck={false}
                        className="h-full w-full min-w-0 rounded border border-transparent bg-transparent px-1 text-center font-mono text-[10px] font-bold text-ink hover:border-brand-blue focus:border-brand-blue focus:bg-surface focus:outline-none"
                        onFocus={(event) => {
                          onSelectOp?.(band.opId!);
                          event.currentTarget.select();
                        }}
                        onBlur={(event) => {
                          const value = event.currentTarget.value.trim();
                          if (
                            /^(?:0x)?[0-9a-f]{1,2}$/i.test(value) ||
                            /^0b[01]{1,8}$/i.test(value) ||
                            /^\$[a-zA-Z_][a-zA-Z0-9_]*$/.test(value)
                          ) {
                            onChangeByte(
                              band.opId!,
                              band.editableByte!.index,
                              value.startsWith("$")
                                ? value
                                : /^0b/i.test(value)
                                  ? Number.parseInt(value.slice(2), 2)
                                      .toString(16)
                                      .toUpperCase()
                                      .padStart(2, "0")
                                  : value
                                      .replace(/^0x/i, "")
                                      .toUpperCase()
                                      .padStart(2, "0"),
                            );
                          } else
                            event.currentTarget.value = displayByte(
                              band.editableByte!.value,
                            );
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                          if (event.key === "Escape") {
                            event.currentTarget.value = displayByte(
                              band.editableByte!.value,
                            );
                            event.currentTarget.blur();
                          }
                        }}
                      />
                      {band.editableByte.last && onAddByte && (
                        <button
                          type="button"
                          aria-label={`Aggiungi byte · ${band.opId}`}
                          title="Aggiungi byte"
                          className="h-full shrink-0 border-l border-brand-blue/30 px-1 font-bold text-brand-blue hover:bg-brand-blue/10"
                          onClick={() => onAddByte(band.opId!)}
                        >
                          +
                        </button>
                      )}
                    </div>
                  </foreignObject>
                ) : showLabel ? (
                  <text
                    x={x0 + w / 2}
                    y={bandY + 16}
                    textAnchor="middle"
                    fill={hi ? TRACE : INK}
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      fontFamily: "ui-monospace, monospace",
                    }}
                  >
                    {{ S: "START", P: "STOP", A: "ACK", N: "NACK" }[
                      band.label as "S" | "P" | "A" | "N"
                    ] ?? displayByte(band.label)}
                  </text>
                ) : null}
                <line
                  x1={x0}
                  y1={bandY}
                  x2={x0}
                  y2={plotBottom}
                  stroke={hi ? TRACE : MUTED}
                  strokeWidth={hi ? 1 : 0.5}
                  strokeDasharray={short ? "2 3" : "3 3"}
                  opacity={0.55}
                />
              </g>
            );
          })}

          {lanes.map((lane, li) => {
            const yh = yHigh(li);
            const yl = yLow(li);
            const midY = (yh + yl) / 2;
            const path = buildStepPath(lane.edges, dur, xAt, yh, yl);
            const ann = lane.annotation;

            return (
              <g key={lane.id}>
                <text
                  x={4}
                  y={midY + 4}
                  fill={INK}
                  style={{
                    fontSize: 12,
                    fontWeight: 700,
                    fontFamily: "ui-monospace, monospace",
                  }}
                >
                  {lane.label}
                </text>
                <text
                  x={labelW + 2}
                  y={yh + 4}
                  fill={MUTED}
                  style={{ fontSize: 10, fontFamily: "ui-monospace, monospace" }}
                >
                  H
                </text>
                <text
                  x={labelW + 2}
                  y={yl + 4}
                  fill={MUTED}
                  style={{ fontSize: 10, fontFamily: "ui-monospace, monospace" }}
                >
                  L
                </text>
                <line
                  x1={left}
                  y1={yh}
                  x2={left + plotW}
                  y2={yh}
                  stroke={GRID}
                  strokeWidth={1}
                />
                <line
                  x1={left}
                  y1={yl}
                  x2={left + plotW}
                  y2={yl}
                  stroke={GRID}
                  strokeWidth={1}
                />

                {ann ? (
                  <g>
                    <rect
                      x={xAt(ann.t0)}
                      y={yh - 8}
                      width={Math.max(2, xAt(ann.t1) - xAt(ann.t0))}
                      height={yl - yh + 16}
                      fill={TRACE_SOFT}
                    />
                    <line
                      x1={xAt(ann.t0)}
                      y1={yh - 10}
                      x2={xAt(ann.t0)}
                      y2={yl + 8}
                      stroke={DASH}
                      strokeWidth={1}
                      strokeDasharray="3 3"
                    />
                    <line
                      x1={xAt(ann.t1)}
                      y1={yh - 10}
                      x2={xAt(ann.t1)}
                      y2={yl + 8}
                      stroke={DASH}
                      strokeWidth={1}
                      strokeDasharray="3 3"
                    />
                    <line
                      x1={xAt(ann.t0)}
                      y1={yh - 16}
                      x2={xAt(ann.t1)}
                      y2={yh - 16}
                      stroke={TRACE}
                      strokeWidth={1.25}
                    />
                    <text
                      x={(xAt(ann.t0) + xAt(ann.t1)) / 2}
                      y={yh - 20}
                      textAnchor="middle"
                      fill={TRACE}
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        fontFamily: "Manrope, sans-serif",
                      }}
                    >
                      {ann.label}
                    </text>
                  </g>
                ) : null}

                <path
                  d={path}
                  fill="none"
                  stroke={TRACE}
                  strokeWidth={1.15}
                  strokeLinejoin="miter"
                  strokeLinecap="square"
                />

                {(lane.sampleTimes ?? []).map((t, i) => {
                  const level = levelAt(lane.edges, t);
                  const y = level === 1 ? yh : yl;
                  return (
                    <circle
                      key={`${lane.id}-s${i}`}
                      cx={xAt(t)}
                      cy={y}
                      r={1.8}
                      fill={TRACE}
                    />
                  );
                })}
              </g>
            );
          })}

          {caption ? (
            <text
              x={left}
              y={height - 6}
              fill={MUTED}
              style={{ fontSize: 9, fontFamily: "Noto Sans, sans-serif" }}
            >
              {caption}
            </text>
          ) : null}
        </svg>
      </div>
    </div>
  );
}

function levelAt(edges: readonly TimingEdge[], t: number): TimingLevel {
  let level: TimingLevel = edges[0]?.level ?? 0;
  for (const e of edges) {
    if (e.t <= t) level = e.level;
    else break;
  }
  return level;
}

function buildStepPath(
  edges: readonly TimingEdge[],
  durationMs: number,
  xAt: (t: number) => number,
  yHigh: number,
  yLow: number,
): string {
  if (edges.length === 0) {
    const y = yLow;
    return `M ${xAt(0)} ${y} L ${xAt(durationMs)} ${y}`;
  }
  const sorted = [...edges].sort((a, b) => a.t - b.t);
  const yOf = (level: TimingLevel) => (level === 1 ? yHigh : yLow);
  let d = `M ${xAt(sorted[0]!.t)} ${yOf(sorted[0]!.level)}`;
  let prev = sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    const e = sorted[i]!;
    d += ` L ${xAt(e.t)} ${yOf(prev.level)}`;
    d += ` L ${xAt(e.t)} ${yOf(e.level)}`;
    prev = e;
  }
  d += ` L ${xAt(durationMs)} ${yOf(prev.level)}`;
  return d;
}

export function clockBurstEdges(opts: {
  readonly startMs: number;
  readonly pulses: number;
  readonly halfPeriodMs: number;
  readonly idleHigh?: boolean;
}): TimingEdge[] {
  const idle: TimingLevel = opts.idleHigh === false ? 0 : 1;
  const edges: TimingEdge[] = [{ t: 0, level: idle }];
  let t = opts.startMs;
  edges.push({ t, level: idle });
  for (let i = 0; i < opts.pulses; i++) {
    edges.push({ t, level: idle === 1 ? 0 : 1 });
    t += opts.halfPeriodMs;
    edges.push({ t, level: idle });
    t += opts.halfPeriodMs;
  }
  return edges;
}

export function gpioDebounceLane(opts: {
  readonly id: string;
  readonly label: string;
  readonly sampleMs: number;
  readonly stableMs: number;
  readonly stableLabel: string;
}): TimingLane {
  const bounceStart = 8;
  const half = Math.max(1, opts.sampleMs / 2);
  const edges: TimingEdge[] = [
    { t: 0, level: 1 },
    { t: 4, level: 0 },
    { t: bounceStart, level: 0 },
  ];
  let t = bounceStart + 2;
  for (let i = 0; i < 4; i++) {
    edges.push({ t, level: 1 });
    t += half;
    edges.push({ t, level: 0 });
    t += half;
  }
  const stableStart = t + 2;
  edges.push({ t: stableStart, level: 1 });
  const stableEnd = stableStart + opts.stableMs;
  const sampleTimes: number[] = [];
  for (let s = stableStart + opts.sampleMs; s < stableEnd - 1; s += opts.sampleMs) {
    sampleTimes.push(s);
  }
  sampleTimes.unshift(bounceStart + 1, bounceStart + 1 + opts.sampleMs);

  return {
    id: opts.id,
    label: opts.label,
    edges,
    sampleTimes,
    annotation: { t0: stableStart, t1: stableEnd, label: opts.stableLabel },
  };
}

export function durationFromLanes(
  lanes: readonly TimingLane[],
  fallbackMs: number,
): number {
  let max = fallbackMs;
  for (const lane of lanes) {
    for (const e of lane.edges) max = Math.max(max, e.t);
    for (const s of lane.sampleTimes ?? []) max = Math.max(max, s);
    if (lane.annotation) max = Math.max(max, lane.annotation.t1);
  }
  return max + 8;
}
