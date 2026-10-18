import { ArrowDown, ArrowUp, Clock3, Plus, Trash2 } from "lucide-react";
import type { BackboneSensorModule } from "../../lib/backbone-sensor-modules.js";
import { sequenceSteps, type SequenceStep } from "../../lib/flow-sequence.js";

const field =
  "w-full rounded-lg border border-border-strong bg-surface px-2 py-2 text-sm text-ink outline-none focus:border-brand-blue";
export function SequenceEditor({
  properties,
  modules,
  onChange,
}: {
  properties: Readonly<Record<string, unknown>>;
  modules: readonly BackboneSensorModule[];
  onChange(properties: Record<string, unknown>): void;
}) {
  const steps = sequenceSteps(properties);
  const available = modules.filter(
    (module) => module.recipe.deviceDraft?.commands.length,
  );
  const set = (rows: readonly SequenceStep[]) =>
    onChange({ ...properties, stepsJson: JSON.stringify(rows) });
  const patch = (index: number, row: SequenceStep) =>
    set(steps.map((step, i) => (i === index ? row : step)));
  const move = (index: number, delta: number) => {
    const rows = [...steps];
    [rows[index], rows[index + delta]] = [rows[index + delta]!, rows[index]!];
    set(rows);
  };
  return (
    <section className="mb-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-body text-sm font-semibold">Passi della sequenza</h3>
        <span className="text-xs text-ink-muted">{steps.length}/8</span>
      </div>
      <p className="text-xs leading-relaxed text-ink-muted">
        I passi vengono eseguiti in ordine sulla Backbone, anche senza browser aperto.
      </p>
      {steps.map((step, index) => {
        const module =
          step.kind === "action"
            ? available.find((item) => item.id === step.moduleId)
            : undefined;
        const actions = module?.recipe.deviceDraft?.commands ?? [];
        const action =
          step.kind === "action"
            ? actions.find((item) => item.id === step.actionId)
            : undefined;
        const position = action?.steps.some(
          (op) => op.type === "stepper" && op.command === "position",
        );
        return (
          <div
            key={step.id}
            className="space-y-2 rounded-xl border border-border bg-surface-raised/50 p-3"
          >
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-blue/10 text-xs font-semibold text-brand-blue">
                {index + 1}
              </span>
              <select
                aria-label={`Tipo del passo ${index + 1}`}
                className={field}
                value={step.kind}
                onChange={(e) =>
                  patch(
                    index,
                    e.target.value === "wait"
                      ? { id: step.id, kind: "wait", durationMs: 1000 }
                      : {
                          id: step.id,
                          kind: "action",
                          moduleId: "",
                          actionId: "",
                          value: 0,
                          waitForMotion: true,
                        },
                  )
                }
              >
                <option value="action">Esegui azione</option>
                <option value="wait">Attendi</option>
              </select>
              <button
                type="button"
                aria-label={`Sposta su passo ${index + 1}`}
                disabled={index === 0}
                className="text-ink-muted disabled:opacity-25"
                onClick={() => move(index, -1)}
              >
                <ArrowUp size={15} />
              </button>
              <button
                type="button"
                aria-label={`Sposta giù passo ${index + 1}`}
                disabled={index === steps.length - 1}
                className="text-ink-muted disabled:opacity-25"
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={15} />
              </button>
              <button
                type="button"
                aria-label={`Elimina passo ${index + 1}`}
                className="text-error"
                onClick={() => set(steps.filter((_, i) => i !== index))}
              >
                <Trash2 size={15} />
              </button>
            </div>
            {step.kind === "wait" ? (
              <label className="flex items-center gap-2 text-xs text-ink-muted">
                <Clock3 size={16} />
                <input
                  aria-label={`Attesa passo ${index + 1} in millisecondi`}
                  className={field}
                  type="number"
                  min={1}
                  max={60000}
                  value={step.durationMs}
                  onChange={(e) =>
                    patch(index, { ...step, durationMs: Number(e.target.value) })
                  }
                />
                ms
              </label>
            ) : (
              <>
                <select
                  aria-label={`Modulo passo ${index + 1}`}
                  className={field}
                  value={step.moduleId}
                  onChange={(e) =>
                    patch(index, { ...step, moduleId: e.target.value, actionId: "" })
                  }
                >
                  <option value="">Scegli un modulo…</option>
                  {available.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.recipe.deviceDraft?.name ?? item.recipe.chip}
                    </option>
                  ))}
                </select>
                <select
                  aria-label={`Azione passo ${index + 1}`}
                  className={field}
                  value={step.actionId}
                  onChange={(e) => patch(index, { ...step, actionId: e.target.value })}
                >
                  <option value="">Scegli un’azione…</option>
                  {actions.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label || item.name}
                    </option>
                  ))}
                </select>
                {position && (
                  <>
                    <label className="block text-xs text-ink-muted">
                      Posizione (°)
                      <input
                        aria-label={`Posizione passo ${index + 1}`}
                        className={`${field} mt-1`}
                        type="number"
                        min={0}
                        max={360}
                        step={1}
                        value={step.value}
                        onChange={(e) =>
                          patch(index, {
                            ...step,
                            value: Number(e.target.value),
                            waitForMotion: true,
                          })
                        }
                      />
                    </label>
                    <p className="text-xs text-brand-blue">
                      Attende «Movimento terminato» prima di proseguire.
                    </p>
                  </>
                )}
              </>
            )}
          </div>
        );
      })}
      {steps.length < 8 && (
        <button
          type="button"
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border-strong py-2 text-sm text-brand-blue"
          onClick={() =>
            set([
              ...steps,
              {
                id: crypto.randomUUID(),
                kind: "action",
                moduleId: "",
                actionId: "",
                value: 0,
                waitForMotion: true,
              },
            ])
          }
        >
          <Plus size={16} />
          Aggiungi passo
        </button>
      )}
      {!available.length && (
        <p className="text-xs text-ink-muted">
          Aggiungi prima un dispositivo dalla sezione Moduli.
        </p>
      )}
    </section>
  );
}
