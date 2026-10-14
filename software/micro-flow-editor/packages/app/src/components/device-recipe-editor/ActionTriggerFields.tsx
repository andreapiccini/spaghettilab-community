import type {
  DeviceActionTrigger,
  DeviceActionTriggerEdge,
  DeviceActionTriggerLevel,
} from "../../lib/device-recipe-draft.js";

const inputClass =
  "w-full rounded-slsm border border-border-strong bg-surface px-1.5 py-1 font-mono text-xs outline-none focus:border-brand-blue";

export function ActionTriggerFields({
  it,
  value,
  onChange,
}: {
  readonly it: boolean;
  readonly value: DeviceActionTrigger;
  readonly onChange: (next: DeviceActionTrigger) => void;
}) {
  return (
    <section className="rounded-slmd border border-border-strong bg-surface p-3">
      <h2 className="mb-1 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
        {it ? "Trigger esterno" : "External trigger"}
      </h2>
      <p className="mb-2 font-body text-[11px] leading-snug text-ink-muted">
        {it
          ? "Tipo di fronte e livello attivo — stessi valori dei blocchi canvas e della configurazione pin GPIO."
          : "Edge type and active level — same values as canvas blocks and GPIO pin settings."}
      </p>
      <div className="flex flex-wrap gap-3">
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 font-body text-[11px] text-ink-muted">
          {it ? "Tipo (fronte)" : "Type (edge)"}
          <select
            value={value.edge}
            onChange={(e) => onChange({ ...value, edge: e.target.value as DeviceActionTriggerEdge })}
            className={inputClass}
          >
            <option value="rising">{it ? "Rising (salita)" : "Rising"}</option>
            <option value="falling">{it ? "Falling (discesa)" : "Falling"}</option>
            <option value="both">{it ? "Both (entrambi)" : "Both"}</option>
          </select>
        </label>
        <label className="flex min-w-[10rem] flex-1 flex-col gap-1 font-body text-[11px] text-ink-muted">
          {it ? "Livello" : "Level"}
          <select
            value={value.level}
            onChange={(e) => onChange({ ...value, level: e.target.value as DeviceActionTriggerLevel })}
            className={inputClass}
          >
            <option value="high">{it ? "High (alto)" : "High"}</option>
            <option value="low">{it ? "Low (basso)" : "Low"}</option>
          </select>
        </label>
      </div>
    </section>
  );
}
