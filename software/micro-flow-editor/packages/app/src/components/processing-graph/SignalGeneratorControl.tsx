import type { CoreBindingId } from "@spaghettilab/domain";
import { useEffect, useState } from "react";
import { MousePointerClick } from "lucide-react";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import type { ProcessingNodeUiData } from "./to-nodes.js";

type Point = { at: number; high: boolean };
export function SignalGeneratorControl({ config }: { config: NonNullable<ProcessingNodeUiData["signalGenerator"]> }) {
  const { onRecordEvent, rows, getExecutionMode } = useCoreSessions();
  const ready = rows.some(row => row.binding.bindingId === config.bindingId && row.sessionState === "READY");
  const running = config.bindingId && getExecutionMode(config.bindingId as CoreBindingId) === "continuous";
  const [history, setHistory] = useState<Point[]>([]);
  const [now, setNow] = useState(Date.now);
  const windowMs = Math.max(1000, (config.onMs + config.offMs) * 2);
  const source = config.source;
  useEffect(() => {
    setHistory([]);
    if (!ready || !config.bindingId || !source) return;
    return onRecordEvent(config.bindingId as CoreBindingId, record => {
      if (record.sourceKey !== source.key || (source.schemaId && record.schemaId !== source.schemaId)) return;
      const value = record.fields?.[source.field];
      if (typeof value !== "boolean" && value !== 0 && value !== 1 && value !== 0n && value !== 1n) return;
      const high = value === true || value === 1 || value === 1n;
      const at = Date.now();
      setHistory(previous => previous.at(-1)?.high === high ? previous : [...previous.slice(-79), { at, high }]);
      setNow(at);
    });
  }, [ready, config.bindingId, source?.key, source?.schemaId, source?.field, onRecordEvent]);
  useEffect(() => {
    if (!ready || !running) return;
    const timer = setInterval(() => setNow(Date.now()), 50);
    return () => clearInterval(timer);
  }, [ready, running]);
  const last = ready ? history.at(-1) : undefined;
  const width = 180, height = 32;
  const x = (at: number) => Math.max(0, Math.min(width, (at - (now - windowMs)) / windowMs * width));
  const y = (high: boolean) => high ? 5 : 27;
  let path = "";
  history.forEach((point, index) => {
    if (!index) path = `M${x(point.at)},${y(point.high)}`;
    else path += ` H${x(point.at)} V${y(point.high)}`;
  });
  if (last) path += ` H${width}`;
  return <div className="pointer-events-none flex h-full flex-col gap-1.5 p-3">
    <div className="flex items-center gap-2 text-xs font-semibold text-brand-blue"><MousePointerClick size={16} /><span>Generatore di segnali</span></div>
    <div className="flex items-center justify-between text-[10px] text-ink-muted"><span>Alterna acceso/spento</span><span className="font-semibold text-brand-blue">{last ? last.high ? "1 · Alto" : "0 · Basso" : "—"}</span></div>
    <svg role="img" aria-label="Andamento reale dell’uscita digitale" viewBox={`0 0 ${width} ${height}`} className="min-h-0 w-full flex-1 text-brand-blue">
      <path d={`M0,5 H${width} M0,27 H${width}`} fill="none" stroke="currentColor" opacity=".12" />
      {last && <><path d={path} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /><circle cx={width - 2} cy={y(last.high)} r="2.5" fill="currentColor" /></>}
    </svg>
    <p className="truncate text-[9px] text-ink-muted">{!ready ? "" : !source ? "Collega un modulo e ricarica il Flow" : !last ? "In attesa dello stato dalla Backbone" : running ? "Segnale in esecuzione · stato reale" : "In pausa · stato reale"}</p>
  </div>;
}
