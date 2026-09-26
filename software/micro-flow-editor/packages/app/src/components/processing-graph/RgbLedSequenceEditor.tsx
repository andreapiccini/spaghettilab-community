import { Plus, Trash2 } from "lucide-react";
import {
  parseRgbLedConfig,
  serializeRgbLedActions,
  type RgbLedAction,
  type RgbLedActionKind,
} from "./rgb-led-model.js";

export function RgbLedSequenceEditor({
  properties,
  onChange,
}: {
  readonly properties: Readonly<Record<string, unknown>>;
  readonly onChange: (next: Record<string, unknown>) => void;
}) {
  const config = parseRgbLedConfig(properties);
  if (config.mode !== "sequence") return null;

  function setActions(actions: readonly RgbLedAction[]) {
    onChange({ ...properties, sequenceJson: serializeRgbLedActions(actions) });
  }

  function updateAt(index: number, patch: Partial<RgbLedAction>) {
    setActions(config.actions.map((a, i) => (i === index ? { ...a, ...patch } : a)));
  }

  function addAction(kind: RgbLedActionKind) {
    const next: RgbLedAction =
      kind === "wait"
        ? { kind: "wait", durationMs: 200 }
        : { kind, color: "#FF3366", intensity: 100, durationMs: 400 };
    setActions([...config.actions, next]);
  }

  function removeAt(index: number) {
    setActions(config.actions.filter((_, i) => i !== index));
  }

  return (
    <div className="mb-4 rounded-slsm border border-border-strong p-3">
      <div className="mb-2 font-body text-xs font-semibold text-ink-muted">Azioni della sequenza</div>
      <p className="mb-3 font-body text-[11px] leading-snug text-ink-faint">
        Ogni azione è un passo. Gli effetti pronti (Color cycle, Breathe…) restano parametrici — qui componi solo solid / fade / wait.
      </p>
      <div className="flex flex-col gap-2">
        {config.actions.map((action, index) => (
          <div key={index} className="flex flex-wrap items-end gap-2 rounded-slsm bg-surface-sunken px-2 py-2">
            <label className="flex min-w-[5.5rem] flex-col gap-0.5 font-body text-[10px] text-ink-muted">
              Tipo
              <select
                value={action.kind}
                onChange={(e) => {
                  const kind = e.target.value as RgbLedActionKind;
                  if (kind === "wait") updateAt(index, { kind, color: undefined, intensity: undefined });
                  else updateAt(index, { kind, color: action.color ?? "#FF3366", intensity: action.intensity ?? 100 });
                }}
                className="rounded-slsm border border-border-strong px-1.5 py-1 font-body text-xs text-ink outline-none"
              >
                <option value="solid">Solid</option>
                <option value="fade">Fade</option>
                <option value="wait">Wait</option>
              </select>
            </label>
            {action.kind !== "wait" && (
              <>
                <label className="flex flex-col gap-0.5 font-body text-[10px] text-ink-muted">
                  Colore
                  <input
                    type="color"
                    value={action.color ?? "#FF3366"}
                    onChange={(e) => updateAt(index, { color: e.target.value })}
                    className="h-7 w-10 cursor-pointer rounded-slsm border border-border-strong bg-surface"
                  />
                </label>
                <label className="flex w-16 flex-col gap-0.5 font-body text-[10px] text-ink-muted">
                  Intensità
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={action.intensity ?? 100}
                    onChange={(e) => updateAt(index, { intensity: Number(e.target.value) })}
                    className="rounded-slsm border border-border-strong px-1.5 py-1 font-mono text-xs outline-none"
                  />
                </label>
              </>
            )}
            <label className="flex w-20 flex-col gap-0.5 font-body text-[10px] text-ink-muted">
              ms
              <input
                type="number"
                min={0}
                value={action.durationMs}
                onChange={(e) => updateAt(index, { durationMs: Number(e.target.value) })}
                className="rounded-slsm border border-border-strong px-1.5 py-1 font-mono text-xs outline-none"
              />
            </label>
            <button
              type="button"
              aria-label="Rimuovi azione"
              onClick={() => removeAt(index)}
              className="ml-auto flex h-7 w-7 items-center justify-center rounded-full text-ink-muted hover:bg-surface hover:text-error"
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {(["solid", "fade", "wait"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            onClick={() => addAction(kind)}
            className="inline-flex items-center gap-1 rounded-slsm border border-border-strong px-2 py-1 font-body text-[11px] text-ink hover:bg-surface-raised"
          >
            <Plus size={12} /> {kind}
          </button>
        ))}
      </div>
    </div>
  );
}
