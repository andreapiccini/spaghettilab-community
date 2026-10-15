import { ArrowRight } from "lucide-react";
import type { SensorChannel } from "../../lib/sensor-recipe.js";

type PreviewPin = SensorChannel & { readonly variable?: string };

/** Continuous pin wires show the direction of data through the driver interfaces. */
export function SensorSchematic({
  name,
  inputs,
  outputs,
  it = true,
}: {
  name: string;
  inputs: readonly PreviewPin[];
  outputs: readonly PreviewPin[];
  it?: boolean;
}) {
  const variable = (pin: PreviewPin) =>
    pin.variable
      ? `$${pin.variable.replace(/^\$/, "")}`
      : it
        ? "Variabile"
        : "Variable";
  return (
    <div className="overflow-x-auto py-3" aria-label={name}>
      <div className="grid min-w-[360px] grid-cols-[minmax(110px,1fr)_minmax(110px,0.8fr)_minmax(110px,1fr)] items-stretch">
        <div className="flex flex-col justify-center gap-4 py-4">
          {inputs.map((pin) => (
            <div key={pin.id} className="min-w-0 text-brand-blue">
              <div className="mb-1 break-words pr-3 font-body text-[10px] font-semibold">
                {pin.label}
              </div>
              <div className="flex h-3 items-center" aria-hidden>
                <span className="h-2 w-2 shrink-0 rounded-full border-2 border-current bg-surface" />
                <span className="h-px flex-1 bg-current" />
                <ArrowRight size={14} className="-ml-2 -mr-px shrink-0" />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1 pr-3 font-body text-[9px] text-ink-muted">
                <span>
                  {pin.inputMode === "trigger" ? "Trigger" : it ? "Dato" : "Data"}
                </span>
                <ArrowRight size={11} aria-hidden />
                <span className="break-all font-mono text-brand-blue">
                  {pin.inputMode === "trigger"
                    ? it
                      ? "Esegui azione"
                      : "Run action"
                    : variable(pin)}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="flex min-h-28 flex-col items-center justify-center rounded-sm border-2 border-brand-blue/50 bg-brand-blue/5 p-3 text-center">
          <span className="font-mono text-[9px] text-brand-blue">
            {it ? "SENSORE" : "SENSOR"}
          </span>
          <strong className="mt-1 w-full break-words font-body text-xs text-ink">
            {name}
          </strong>
        </div>
        <div className="flex flex-col justify-center gap-4 py-4">
          {outputs.map((pin) => (
            <div key={pin.id} className="min-w-0 text-emerald-600">
              <div className="mb-1 break-words pl-3 font-body text-[10px] font-semibold">
                {pin.label}
              </div>
              <div className="flex h-3 items-center" aria-hidden>
                <span className="h-px flex-1 bg-current" />
                <ArrowRight size={14} className="-ml-2 shrink-0" />
                <span className="h-2 w-2 shrink-0 rounded-full border-2 border-current bg-surface" />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-1 pl-3 font-body text-[9px] text-ink-muted">
                <span className="break-all font-mono text-emerald-600">
                  {variable(pin)}
                </span>
                <ArrowRight size={11} aria-hidden />
                <span>
                  {it ? "Dato" : "Data"}
                  {pin.unit ? ` · ${pin.unit}` : ""}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
