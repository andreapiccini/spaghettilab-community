import type { ReactNode } from "react";
import {
  multiSampleSpanMs,
  type DeviceRecipeDraft,
  type DeviceRecipePhase,
} from "../../lib/device-recipe-draft.js";

/** Illustrative signal lanes derived from sequence — not a second source of truth. */
export function DerivedSignalView({
  draft,
  phase,
  it,
}: {
  readonly draft: DeviceRecipeDraft;
  readonly phase: DeviceRecipePhase;
  readonly it: boolean;
}) {
  const ops = draft.phases[phase];
  const bus = draft.binding.bus;

  return (
    <section className="rounded-slmd border border-border-strong bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
          {it ? "Dettaglio segnali" : "Signal detail"}
        </h2>
        <span className="font-body text-[10px] text-ink-faint">{it ? "Schema non in scala" : "Not to scale"}</span>
      </div>

      {bus === "i2c" ? (
        <div className="space-y-2 font-mono text-[10px] text-ink-muted">
          <Lane label="SCL" hint={it ? "clock derivato dalla transazione" : "clock derived from transaction"}>
            <PulseBar count={Math.max(8, ops.reduce((n, op) => n + (op.type === "i2c_write_read" ? op.readLen * 9 : 8), 0))} />
          </Lane>
          <Lane label="SDA">
            <div className="flex h-6 flex-1 overflow-hidden rounded-sm">
              <span className="flex flex-1 items-center justify-center bg-sky-100 text-[9px] text-sky-800">
                {draft.binding.i2c?.address ?? "0x??"} · W
              </span>
              <span className="flex flex-1 items-center justify-center bg-teal-100 text-[9px] text-teal-800">
                {draft.binding.i2c?.address ?? "0x??"} · R
              </span>
            </div>
          </Lane>
          <p className="text-[9px] text-ink-faint">
            {it
              ? "ACK/NACK e burst di clock sono illustrativi, calcolati dalla sequenza."
              : "ACK/NACK and clock bursts are illustrative, derived from the sequence."}
          </p>
        </div>
      ) : null}

      {bus === "spi" && draft.binding.spi ? (
        <div className="space-y-2 font-mono text-[10px] text-ink-muted">
          <Lane label={`CS (idle HIGH)`}>
            <div className="flex h-5 flex-1 items-center">
              <span className="h-0.5 flex-1 bg-ink-faint" />
              <span className="mx-1 h-3 flex-[2] rounded-sm bg-brand-blue/30" />
              <span className="h-0.5 flex-1 bg-ink-faint" />
            </div>
          </Lane>
          <Lane label={`SCK (mode ${draft.binding.spi.mode})`}>
            <PulseBar
              count={
                8 *
                Math.max(
                  1,
                  ...ops.filter((o) => o.type === "spi_transfer").map((o) => (o.type === "spi_transfer" ? Math.max(o.txBytes.length, o.rxLen) : 1)),
                )
              }
            />
          </Lane>
          <Lane label="MOSI">
            <div className="flex h-5 flex-1 gap-0.5">
              {ops
                .filter((o) => o.type === "spi_transfer")
                .flatMap((o) => (o.type === "spi_transfer" ? o.txBytes : []))
                .map((b, i) => (
                  <span key={i} className="flex flex-1 items-center justify-center rounded-sm bg-sky-100 text-[8px] text-sky-800">
                    {b}
                  </span>
                ))}
            </div>
          </Lane>
          {draft.binding.spi.misoRequired ? (
            <Lane label="MISO">
              <div className="flex h-5 flex-1 gap-0.5">
                <span className="flex flex-1 items-center justify-center rounded-sm bg-surface-sunken text-[8px]">{it ? "Ignora" : "Ignore"}</span>
                <span className="flex flex-[2] items-center justify-center rounded-sm bg-teal-100 text-[8px] text-teal-800">raw</span>
              </div>
            </Lane>
          ) : null}
        </div>
      ) : null}

      {bus === "adc" ? (
        <AnalogSamplePreview draft={draft} phase={phase} it={it} />
      ) : null}

      {bus === "gpio" ? (
        <div className="space-y-2 font-mono text-[10px] text-ink-muted">
          {draft.binding.gpioSignals.map((sig) => {
            const used = ops.some(
              (op) =>
                (op.type === "gpio_read" || op.type === "gpio_write" || op.type === "gpio_debounce") && op.signalId === sig.id,
            );
            const debounce = ops.find((op) => op.type === "gpio_debounce" && op.signalId === sig.id);
            return (
              <Lane key={sig.id} label={sig.name}>
                {used ? (
                  <div className="flex h-6 flex-1 items-center gap-1">
                    <span className="text-[9px]">H</span>
                    <span className="h-3 flex-1 rounded-sm bg-brand-blue/25" />
                    <span className="text-[9px]">L</span>
                    {debounce && debounce.type === "gpio_debounce" ? (
                      <span className="rounded-sm bg-teal-100 px-1 text-[8px] text-teal-800">
                        {it ? `Stabile ${debounce.stableMs} ms` : `Stable ${debounce.stableMs} ms`}
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <span className="font-body text-[10px] text-ink-faint">
                    {it ? "Non usato in questa sequenza" : "Unused in this sequence"}
                  </span>
                )}
              </Lane>
            );
          })}
          <p className="text-[9px] text-ink-faint">
            {it
              ? `Campionamento ogni ${draft.sampleIntervalMs} ms · antirimbalzo da passi sequenza (non duplicato).`
              : `Sample every ${draft.sampleIntervalMs} ms · debounce from sequence steps (not duplicated).`}
          </p>
        </div>
      ) : null}
    </section>
  );
}

/** Illustrative ADC curve: adjacent-sample gap = intervalMs; first→last span = (n-1)×interval. */
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
  const w = 320;
  const h = 96;
  const padX = 28;
  const padY = 16;
  const plotW = w - padX * 2;
  const plotH = h - padY * 2;
  const points = Array.from({ length: count }, (_, i) => {
    const t = count <= 1 ? 0 : i / (count - 1);
    const x = padX + t * plotW;
    const wave = 0.55 + 0.35 * Math.sin(t * Math.PI * 1.35) + 0.08 * Math.sin(t * Math.PI * 4);
    const y = padY + plotH * (1 - Math.min(1, Math.max(0, wave)));
    return { x, y, i };
  });
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  const adj = points.length >= 2 ? { a: points[0]!, b: points[1]! } : null;

  return (
    <div className="mb-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-body text-[11px] font-semibold text-ink">
          {it ? "Anteprima del campionamento" : "Sampling preview"}
        </h3>
        <span className="font-mono text-[9px] text-ink-faint">
          {count} × {intervalMs} ms · {it ? "span" : "span"} {spanMs} ms
        </span>
      </div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full rounded-sm border border-border bg-sky-50/40" aria-hidden>
        <text x={6} y={14} className="fill-ink-faint" style={{ fontSize: 8 }}>
          {unit === "mV" ? "3000" : "4095"}
        </text>
        <text x={6} y={h - 6} className="fill-ink-faint" style={{ fontSize: 8 }}>
          0
        </text>
        <path d={pathD} fill="none" stroke="#2563eb" strokeWidth={1.5} opacity={0.85} />
        {points.map((p) => (
          <circle key={p.i} cx={p.x} cy={p.y} r={3.2} fill="#2563eb" />
        ))}
        {adj ? (
          <>
            <line
              x1={adj.a.x}
              y1={h - 10}
              x2={adj.b.x}
              y2={h - 10}
              stroke="#64748b"
              strokeWidth={1}
            />
            <text
              x={(adj.a.x + adj.b.x) / 2}
              y={h - 2}
              textAnchor="middle"
              className="fill-ink-muted"
              style={{ fontSize: 8 }}
            >
              {intervalMs} ms {it ? "tra campioni" : "between samples"}
            </text>
          </>
        ) : null}
      </svg>
      <p className="font-body text-[9px] text-ink-faint">
        {it
          ? `${intervalMs} ms è lo scarto tra due campioni adiacenti; dal 1° all'${count}° passano ${spanMs} ms. Curva illustrativa, non elettrica.`
          : `${intervalMs} ms is the gap between adjacent samples; first→${count}th spans ${spanMs} ms. Illustrative curve, not electrical.`}
      </p>
      <div className="flex items-center gap-2 font-mono text-[10px] text-ink-muted">
        <span className="rounded-sm bg-sky-100 px-2 py-0.5 text-sky-800">
          {draft.binding.adc?.signalName ?? "SIGNAL"}
        </span>
        <span>→</span>
        <span className="rounded-sm bg-surface-sunken px-2 py-0.5">
          samples · {unit === "mV" ? "mV[]" : "raw[]"}
        </span>
      </div>
    </div>
  );
}

function Lane({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[4.5rem_1fr] items-center gap-2">
      <div>
        <div className="font-mono text-[10px] font-semibold text-ink">{label}</div>
        {hint ? <div className="font-body text-[8px] text-ink-faint">{hint}</div> : null}
      </div>
      {children}
    </div>
  );
}

function PulseBar({ count }: { count: number }) {
  const n = Math.min(48, Math.max(4, count));
  return (
    <div className="flex h-5 flex-1 items-end gap-px">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={`w-0.5 flex-1 rounded-sm ${i % 2 === 0 ? "h-4 bg-brand-blue/50" : "h-1 bg-border-strong"}`} />
      ))}
    </div>
  );
}
