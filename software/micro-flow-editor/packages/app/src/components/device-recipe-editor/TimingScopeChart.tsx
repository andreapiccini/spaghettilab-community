/**
 * Logic-analyzer / oscilloscope-style timing diagram (illustrative SVG).
 * Phase bands align with datasheet ProtocolFrameStrip cells.
 */

import type {
  TimingEdge,
  TimingLane,
  TimingLevel,
  TimingPhaseBand,
} from "../../lib/timing-scope-types.js";

export type { TimingEdge, TimingLane, TimingLevel, TimingPhaseBand, TimingSpanAnnotation } from "../../lib/timing-scope-types.js";

type Props = {
  readonly title?: string;
  readonly caption?: string;
  readonly lanes: readonly TimingLane[];
  readonly durationMs: number;
  /** Vertical phase markers shared with the datasheet strip. */
  readonly phaseBands?: readonly TimingPhaseBand[];
  readonly highlightOpId?: string | null;
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
  highlightOpId = null,
  className,
}: Props) {
  const dur = Math.max(1, durationMs);
  const labelW = 56;
  const levelW = 22;
  const left = labelW + levelW;
  const padR = 16;
  const laneH = 64;
  const bandH = phaseBands.length ? 28 : 0;
  const padTop = (title ? 26 : 6) + bandH;
  const padBot = caption ? 22 : 10;
  const plotW = 520;
  const width = left + plotW + padR;
  const height = padTop + lanes.length * laneH + padBot;
  const bandY = title ? 24 : 4;

  const xAt = (t: number) => left + (Math.min(dur, Math.max(0, t)) / dur) * plotW;
  const yHigh = (laneIndex: number) => padTop + laneIndex * laneH + 18;
  const yLow = (laneIndex: number) => padTop + laneIndex * laneH + 46;
  const plotBottom = padTop + lanes.length * laneH - 8;

  return (
    <div className={className}>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" role="img" aria-label={title ?? "Timing"}>
        {title ? (
          <text x={4} y={16} fill={INK} style={{ fontSize: 13, fontWeight: 700, fontFamily: "Manrope, sans-serif" }}>
            {title}
          </text>
        ) : null}

        {/* Phase bands — same labels/order as datasheet strip */}
        {phaseBands.map((band) => {
          const x0 = xAt(band.t0);
          const x1 = xAt(band.t1);
          const w = Math.max(2, x1 - x0);
          const hi = highlightOpId && band.opId === highlightOpId;
          const fill = band.color ?? (hi ? "rgba(37,99,235,0.2)" : "rgba(148,163,184,0.12)");
          return (
            <g key={band.id}>
              <rect x={x0} y={bandY} width={w} height={bandH - 4} fill={fill} stroke={hi ? TRACE : "transparent"} strokeWidth={1} />
              {w > 14 ? (
                <text
                  x={x0 + w / 2}
                  y={bandY + 14}
                  textAnchor="middle"
                  fill={hi ? TRACE : MUTED}
                  style={{ fontSize: 8, fontWeight: 600, fontFamily: "ui-monospace, monospace" }}
                >
                  {band.label}
                </text>
              ) : null}
              <line
                x1={x0}
                y1={bandY}
                x2={x0}
                y2={plotBottom}
                stroke={hi ? TRACE : MUTED}
                strokeWidth={hi ? 1 : 0.75}
                strokeDasharray="3 3"
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
              <text x={4} y={midY + 4} fill={INK} style={{ fontSize: 12, fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>
                {lane.label}
              </text>
              <text x={labelW + 2} y={yh + 4} fill={MUTED} style={{ fontSize: 10, fontFamily: "ui-monospace, monospace" }}>
                H
              </text>
              <text x={labelW + 2} y={yl + 4} fill={MUTED} style={{ fontSize: 10, fontFamily: "ui-monospace, monospace" }}>
                L
              </text>
              <line x1={left} y1={yh} x2={left + plotW} y2={yh} stroke={GRID} strokeWidth={1} />
              <line x1={left} y1={yl} x2={left + plotW} y2={yl} stroke={GRID} strokeWidth={1} />

              {ann ? (
                <g>
                  <rect x={xAt(ann.t0)} y={yh - 8} width={Math.max(2, xAt(ann.t1) - xAt(ann.t0))} height={yl - yh + 16} fill={TRACE_SOFT} />
                  <line x1={xAt(ann.t0)} y1={yh - 10} x2={xAt(ann.t0)} y2={yl + 8} stroke={DASH} strokeWidth={1} strokeDasharray="3 3" />
                  <line x1={xAt(ann.t1)} y1={yh - 10} x2={xAt(ann.t1)} y2={yl + 8} stroke={DASH} strokeWidth={1} strokeDasharray="3 3" />
                  <line x1={xAt(ann.t0)} y1={yh - 16} x2={xAt(ann.t1)} y2={yh - 16} stroke={TRACE} strokeWidth={1.25} />
                  <text
                    x={(xAt(ann.t0) + xAt(ann.t1)) / 2}
                    y={yh - 20}
                    textAnchor="middle"
                    fill={TRACE}
                    style={{ fontSize: 11, fontWeight: 600, fontFamily: "Manrope, sans-serif" }}
                  >
                    {ann.label}
                  </text>
                </g>
              ) : null}

              <path d={path} fill="none" stroke={TRACE} strokeWidth={1.15} strokeLinejoin="miter" strokeLinecap="square" />

              {(lane.sampleTimes ?? []).map((t, i) => {
                const level = levelAt(lane.edges, t);
                const y = level === 1 ? yh : yl;
                return <circle key={`${lane.id}-s${i}`} cx={xAt(t)} cy={y} r={1.8} fill={TRACE} />;
              })}
            </g>
          );
        })}

        {caption ? (
          <text x={left} y={height - 6} fill={MUTED} style={{ fontSize: 9, fontFamily: "Noto Sans, sans-serif" }}>
            {caption}
          </text>
        ) : null}
      </svg>
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

export function durationFromLanes(lanes: readonly TimingLane[], fallbackMs: number): number {
  let max = fallbackMs;
  for (const lane of lanes) {
    for (const e of lane.edges) max = Math.max(max, e.t);
    for (const s of lane.sampleTimes ?? []) max = Math.max(max, s);
    if (lane.annotation) max = Math.max(max, lane.annotation.t1);
  }
  return max + 8;
}
