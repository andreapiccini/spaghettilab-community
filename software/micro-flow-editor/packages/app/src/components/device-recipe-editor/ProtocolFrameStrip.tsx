import { cellFill, cellInk, type ProtocolCell } from "../../lib/protocol-timing.js";

/** Datasheet-style I2C/SPI transaction strip — same cells as the timing chart. */
export function ProtocolFrameStrip({
  cells,
  selectedOpId,
  onSelectOp,
  title,
  hint,
}: {
  readonly cells: readonly ProtocolCell[];
  readonly selectedOpId: string | null;
  readonly onSelectOp: (opId: string) => void;
  readonly title: string;
  readonly hint?: string;
}) {
  if (cells.length === 0) return null;
  const totalUnits = cells.reduce((n, c) => n + c.units, 0);

  return (
    <section className="mb-4 rounded-slmd border border-border-strong bg-surface p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">{title}</h2>
        {hint ? <span className="font-body text-[10px] text-ink-faint">{hint}</span> : null}
      </div>
      <div className="overflow-x-auto">
        <div className="inline-flex min-w-full border border-ink/50 bg-white">
          {cells.map((cell) => {
            const selected = cell.opId === selectedOpId;
            const flex = Math.max(cell.units, cell.kind === "ack" || cell.kind === "nack" ? 1.2 : cell.units);
            return (
              <button
                key={cell.id}
                type="button"
                title={`${cell.label} · ${cell.kind}`}
                onClick={() => onSelectOp(cell.opId)}
                style={{
                  flexGrow: flex,
                  flexBasis: `${(cell.units / totalUnits) * 100}%`,
                  backgroundColor: cellFill(cell.kind),
                  color: cellInk(cell.kind),
                }}
                className={`relative min-w-[1.5rem] border-r border-ink/25 px-1 py-2 text-center font-mono text-[10px] font-semibold transition ${
                  selected ? "ring-2 ring-inset ring-brand-blue/60" : "hover:brightness-[0.98]"
                }`}
              >
                {cell.label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1.5 border-t border-border pt-2 font-body text-[10px] text-ink-muted">
        <span className="w-full font-semibold uppercase tracking-wide text-ink-faint">
          Legenda
        </span>
        <Legend swatch={cellFill("start")} label="S — start" />
        <Legend swatch={cellFill("restart")} label="Sr — restart" />
        <Legend swatch={cellFill("stop")} label="P — stop" />
        <Legend swatch={cellFill("addr_w")} label="ADDR / DATA" />
        <Legend swatch={cellFill("ack")} label="ACK" />
        <Legend swatch={cellFill("nack")} label="NACK" />
        <Legend swatch={cellFill("cs")} label="CS (SPI)" />
      </div>
    </section>
  );
}

function Legend({ swatch, label }: { swatch: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-2.5 w-3.5 shrink-0 rounded-sm border border-ink/20"
        style={{ backgroundColor: swatch }}
      />
      {label}
    </span>
  );
}
