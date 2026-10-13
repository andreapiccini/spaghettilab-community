import {
  multiSampleSpanMs,
  type DeviceRecipeDraft,
  type DeviceRecipePhase,
} from "../../lib/device-recipe-draft.js";
import { buildProtocolTiming } from "../../lib/protocol-timing.js";
import {
  TimingScopeChart,
  durationFromLanes,
  gpioDebounceLane,
  type TimingLane,
} from "./TimingScopeChart.js";

/** Illustrative signal lanes derived from sequence — same segments as datasheet strip. */
export function DerivedSignalView({
  draft,
  phase,
  it,
  selectedOpId = null,
}: {
  readonly draft: DeviceRecipeDraft;
  readonly phase: DeviceRecipePhase;
  readonly it: boolean;
  readonly selectedOpId?: string | null;
}) {
  const bus = draft.binding.bus;

  if (bus === "adc") {
    return (
      <section className="rounded-slmd border border-border-strong bg-surface p-3">
        <AnalogSamplePreview draft={draft} phase={phase} it={it} />
      </section>
    );
  }

  if (bus === "w1") {
    const ops = draft.phases[phase];
    const resets = ops.filter((o) => o.type === "w1_reset").length;
    const writes = ops.filter((o) => o.type === "w1_write").length;
    const reads = ops.filter((o) => o.type === "w1_read").length;
    return (
      <section className="rounded-slmd border border-border-strong bg-surface p-3">
        <TimingScopeChart
          title={it ? "Segnale DQ (schematico)" : "DQ signal (schematic)"}
          caption={
            it
              ? `Derivato dalla sequenza: ${resets} reset, ${writes} write, ${reads} read. Timing bit reale nel firmware.`
              : `Derived from sequence: ${resets} reset, ${writes} write, ${reads} read. Real bit timing in firmware.`
          }
          durationMs={80}
          lanes={[
            {
              id: "dq",
              label: "DQ",
              edges: [
                { t: 0, level: 1 },
                { t: 4, level: 0 },
                { t: 10, level: 1 },
                { t: 14, level: 0 },
                { t: 18, level: 1 },
                { t: 22, level: 0 },
                { t: 26, level: 1 },
                { t: 40, level: 1 },
                { t: 44, level: 0 },
                { t: 50, level: 1 },
              ],
              sampleTimes: [6, 16, 24, 46],
              annotation:
                resets > 0
                  ? { t0: 2, t1: 12, label: it ? "Reset / presenza" : "Reset / presence" }
                  : undefined,
            },
          ]}
        />
      </section>
    );
  }

  if (bus === "i2c" || bus === "spi") {
    const model = buildProtocolTiming(draft, phase);
    if (model.lanes.length === 0) {
      return (
        <section className="rounded-slmd border border-border-strong bg-surface p-3">
          <p className="font-body text-xs text-ink-faint">
            {it ? "Aggiungi operazioni bus alla sequenza per vedere i segnali." : "Add bus operations to see signals."}
          </p>
        </section>
      );
    }
    return (
      <section className="rounded-slmd border border-border-strong bg-surface p-3">
        <TimingScopeChart
          title={it ? "Segnali nel tempo" : "Signals over time"}
          caption={
            it
              ? "Le fasce in alto ripetono i blocchi datasheet (S, ADDR, ACK, DATA…). Schema illustrativo."
              : "Top bands match the datasheet cells (S, ADDR, ACK, DATA…). Illustrative."
          }
          lanes={model.lanes}
          durationMs={model.durationMs}
          phaseBands={model.phaseBands}
          highlightOpId={selectedOpId}
        />
      </section>
    );
  }

  const { lanes, durationMs, caption } = buildGpioLanes(draft, phase, it);

  return (
    <section className="rounded-slmd border border-border-strong bg-surface p-3">
      {lanes.length === 0 ? (
        <p className="font-body text-xs text-ink-faint">
          {it ? "Nessun segnale da mostrare in questa sequenza." : "No signals to show for this sequence."}
        </p>
      ) : (
        <TimingScopeChart
          title={it ? "Segnali nel tempo" : "Signals over time"}
          caption={caption}
          lanes={lanes}
          durationMs={durationMs}
          highlightOpId={selectedOpId}
        />
      )}
    </section>
  );
}

function buildGpioLanes(
  draft: DeviceRecipeDraft,
  phase: DeviceRecipePhase,
  it: boolean,
): { lanes: TimingLane[]; durationMs: number; caption: string } {
  const ops = draft.phases[phase];
  const lanes: TimingLane[] = [];
  for (const sig of draft.binding.gpioSignals) {
    const debounce = ops.find((op) => op.type === "gpio_debounce" && op.signalId === sig.id);
    const used = ops.some(
      (op) =>
        (op.type === "gpio_read" || op.type === "gpio_write" || op.type === "gpio_debounce") && op.signalId === sig.id,
    );
    if (!used) continue;
    if (debounce && debounce.type === "gpio_debounce") {
      lanes.push(
        gpioDebounceLane({
          id: sig.id,
          label: sig.name,
          sampleMs: debounce.sampleMs || draft.sampleIntervalMs || 5,
          stableMs: debounce.stableMs,
          stableLabel: it ? `Stabile per ${debounce.stableMs} ms` : `Stable for ${debounce.stableMs} ms`,
        }),
      );
    } else {
      const sample = Math.max(2, draft.sampleIntervalMs || 5);
      lanes.push({
        id: sig.id,
        label: sig.name,
        edges: [
          { t: 0, level: 1 },
          { t: 10, level: 0 },
          { t: 18, level: 1 },
          { t: 40, level: 1 },
        ],
        sampleTimes: [12, 12 + sample, 12 + sample * 2, 30, 30 + sample],
      });
    }
  }
  return {
    lanes,
    durationMs: durationFromLanes(lanes, 60),
    caption: it
      ? `Campionamento ogni ${draft.sampleIntervalMs} ms · schema illustrativo (non in scala).`
      : `Sample every ${draft.sampleIntervalMs} ms · illustrative (not to scale).`,
  };
}

function AnalogSamplePreview({
  draft,
  phase,
  it,
}: {
  readonly draft: DeviceRecipeDraft;
  readonly phase: DeviceRecipePhase;
  readonly it: boolean;
}) {
  const multi = draft.phases[phase].find((op) => op.type === "adc_multi_sample");
  const count = multi?.type === "adc_multi_sample" ? multi.count : 8;
  const intervalMs = multi?.type === "adc_multi_sample" ? multi.intervalMs : 1;
  const spanMs = multiSampleSpanMs(count, intervalMs);
  const unit = draft.binding.adc?.displayUnit === "mV" && draft.binding.adc.supportsMv ? "mV" : "raw";
  const w = 480;
  const h = 140;
  const left = 48;
  const padR = 16;
  const padY = 36;
  const plotW = w - left - padR;
  const plotH = h - padY - 28;
  const yTop = padY;
  const yBot = padY + plotH;
  const points = Array.from({ length: count }, (_, i) => {
    const t = count <= 1 ? 0 : i / (count - 1);
    const x = left + t * plotW;
    const wave = 0.55 + 0.35 * Math.sin(t * Math.PI * 1.35) + 0.08 * Math.sin(t * Math.PI * 4);
    const y = yTop + plotH * (1 - Math.min(1, Math.max(0, wave)));
    return { x, y, i };
  });
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const adj = points.length >= 2 ? { a: points[0]!, b: points[1]! } : null;
  const TRACE = "#2563eb";

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" aria-hidden>
        <text x={4} y={18} fill="#0f172a" style={{ fontSize: 13, fontWeight: 700, fontFamily: "Manrope, sans-serif" }}>
          {it ? "Campionamento analogico" : "Analog sampling"}
        </text>
        <text x={4} y={yTop + 4} fill="#94a3b8" style={{ fontSize: 10, fontFamily: "ui-monospace, monospace" }}>
          {unit === "mV" ? "3000" : "4095"}
        </text>
        <text x={4} y={yBot + 4} fill="#94a3b8" style={{ fontSize: 10, fontFamily: "ui-monospace, monospace" }}>
          0
        </text>
        <text
          x={left - 28}
          y={(yTop + yBot) / 2 + 4}
          fill="#0f172a"
          style={{ fontSize: 11, fontWeight: 700, fontFamily: "ui-monospace, monospace" }}
        >
          {draft.binding.adc?.signalName ?? "SIG"}
        </text>
        <line x1={left} y1={yTop} x2={left + plotW} y2={yTop} stroke="#e2e8f0" strokeWidth={1} />
        <line x1={left} y1={yBot} x2={left + plotW} y2={yBot} stroke="#e2e8f0" strokeWidth={1} />
        <path d={pathD} fill="none" stroke={TRACE} strokeWidth={2} strokeLinejoin="round" />
        {points.map((p) => (
          <circle key={p.i} cx={p.x} cy={p.y} r={3.4} fill={TRACE} />
        ))}
        {adj ? (
          <g>
            <line x1={adj.a.x} y1={yBot + 14} x2={adj.b.x} y2={yBot + 14} stroke={TRACE} strokeWidth={1.25} />
            <text
              x={(adj.a.x + adj.b.x) / 2}
              y={yBot + 26}
              textAnchor="middle"
              fill={TRACE}
              style={{ fontSize: 10, fontWeight: 600, fontFamily: "Manrope, sans-serif" }}
            >
              {intervalMs} ms {it ? "tra campioni" : "between samples"}
            </text>
          </g>
        ) : null}
      </svg>
      <p className="font-body text-[10px] text-ink-faint">
        {it
          ? `${intervalMs} ms tra adiacenti · span 1→${count} = ${spanMs} ms. Curva illustrativa.`
          : `${intervalMs} ms adjacent · span 1→${count} = ${spanMs} ms. Illustrative curve.`}
      </p>
    </div>
  );
}
