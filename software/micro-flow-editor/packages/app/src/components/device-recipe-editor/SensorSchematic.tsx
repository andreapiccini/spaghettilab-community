import type { SensorChannel } from "../../lib/sensor-recipe.js";

/** Driver symbol: the interfaces are external pins, never I²C action steps. */
export function SensorSchematic({
  name,
  action,
  inputs,
  outputs,
}: {
  name: string;
  action?: string;
  inputs: readonly SensorChannel[];
  outputs: readonly SensorChannel[];
}) {
  return (
    <div
      className="grid grid-cols-[minmax(0,1fr)_minmax(70px,1fr)_minmax(0,1fr)] items-stretch py-3"
      aria-label={name}
    >
      <div className="flex flex-col justify-center gap-3 py-3">
        {inputs.map((pin) => (
          <div key={pin.id} className="flex min-w-0 items-center text-brand-blue">
            <span className="h-2 w-2 shrink-0 rounded-full border-2 border-current bg-surface" />
            <span className="h-px w-3 shrink-0 bg-current" />
            <span className="min-w-0 flex-1 break-words pr-1 font-body text-[10px]">
              {pin.label}
              <small className="block text-[9px] text-ink-muted">
                {pin.inputMode === "trigger" ? "Trigger" : "Dato"}
              </small>
            </span>
            <span className="h-px w-2 shrink-0 bg-current" />
          </div>
        ))}
      </div>
      <div className="flex min-h-24 flex-col items-center justify-center rounded-sm border-2 border-brand-blue/50 bg-brand-blue/5 p-2 text-center">
        <span className="font-mono text-[9px] text-brand-blue">SENSOR</span>
        <strong className="w-full break-words font-body text-xs text-ink">
          {name}
        </strong>
        {action && (
          <span className="mt-2 w-full break-words font-body text-[10px] text-ink-muted">
            {action}
          </span>
        )}
      </div>
      <div className="flex flex-col justify-center gap-3 py-3">
        {outputs.map((pin) => (
          <div key={pin.id} className="flex min-w-0 items-center text-emerald-600">
            <span className="h-px w-2 shrink-0 bg-current" />
            <span className="min-w-0 flex-1 break-words pl-1 font-body text-[10px]">
              {pin.label}
              <small className="block text-[9px] text-ink-muted">{pin.unit}</small>
            </span>
            <span className="h-px w-3 shrink-0 bg-current" />
            <span className="h-2 w-2 shrink-0 rounded-full border-2 border-current bg-surface" />
          </div>
        ))}
      </div>
    </div>
  );
}
