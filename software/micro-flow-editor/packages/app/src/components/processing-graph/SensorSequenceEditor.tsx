import { ArrowDown, ArrowRight, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  describeStep,
  insertRecipeStep,
  moveRecipeStep,
  paletteStepTypes,
  readChannels,
  removeRecipeStep,
  stepBadge,
  updateRecipeStep,
  type SensorRecipe,
  type SensorRecipePhase,
  type SensorRecipeStep,
  type SensorRecipeStepType,
} from "../../lib/sensor-recipe.js";
import { useLocale } from "../../state/locale-context.js";

const PHASES: readonly SensorRecipePhase[] = ["init", "sample"];

const STEP_LABELS: Record<SensorRecipeStepType, { it: string; en: string }> = {
  wait: { it: "Attendi", en: "Wait" },
  i2c_write: { it: "Scrivi I2C", en: "I2C write" },
  i2c_read: { it: "Leggi I2C", en: "I2C read" },
  adc_read: { it: "Leggi ADC", en: "ADC read" },
  gpio_write: { it: "GPIO out", en: "GPIO write" },
  gpio_read: { it: "GPIO in", en: "GPIO read" },
  emit: { it: "Emetti", en: "Emit" },
};

function stepTone(type: SensorRecipeStepType): { bg: string; border: string; text: string } {
  switch (type) {
    case "wait":
      return { bg: "bg-surface-sunken", border: "border-dashed border-border-strong", text: "text-ink-muted" };
    case "i2c_write":
    case "gpio_write":
      return { bg: "bg-sky-50", border: "border-sky-300", text: "text-sky-800" };
    case "i2c_read":
    case "adc_read":
    case "gpio_read":
      return { bg: "bg-teal-50", border: "border-teal-300", text: "text-teal-800" };
    case "emit":
      return { bg: "bg-emerald-50", border: "border-emerald-300", text: "text-emerald-800" };
    default:
      return { bg: "bg-surface", border: "border-border-strong", text: "text-ink" };
  }
}

function hostArrow(step: SensorRecipeStep): "down" | "up" | "none" {
  switch (step.type) {
    case "i2c_write":
    case "gpio_write":
      return "down";
    case "i2c_read":
    case "adc_read":
    case "gpio_read":
      return "up";
    default:
      return "none";
  }
}

/**
 * Datasheet-style sequence editor for SensorRecipe init/sample steps.
 * Palette → timeline blocks (Host / Device lanes) → inspector fields.
 */
export function SensorSequenceEditor({
  recipe,
  onChange,
}: {
  readonly recipe: SensorRecipe;
  readonly onChange: (next: SensorRecipe) => void;
}) {
  const { locale } = useLocale();
  const it = locale === "it";
  const [phase, setPhase] = useState<SensorRecipePhase>("sample");
  const [selected, setSelected] = useState<number | null>(null);

  const steps = recipe.recipe[phase];
  const palette = paletteStepTypes(recipe.bus);
  const selectedStep = selected !== null ? steps[selected] : undefined;

  function addStep(type: SensorRecipeStepType) {
    const next = insertRecipeStep(recipe, phase, type);
    onChange(next);
    setSelected(next.recipe[phase].length - 1);
  }

  function patchSelected(nextStep: SensorRecipeStep) {
    if (selected === null) return;
    onChange(updateRecipeStep(recipe, phase, selected, nextStep));
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-slpill border border-border-strong bg-surface-sunken p-0.5">
          {PHASES.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                setPhase(item);
                setSelected(null);
              }}
              className={`rounded-slpill px-3 py-1 font-body text-xs font-semibold transition-colors ${
                phase === item ? "bg-surface text-ink shadow-e1" : "text-ink-muted hover:text-ink"
              }`}
            >
              {item === "init" ? (it ? "Init" : "Init") : it ? "Sample (lettura)" : "Sample"}
            </button>
          ))}
        </div>
        <p className="font-body text-[11px] text-ink-faint">
          {it
            ? "Timeline tipo datasheet — clicca un blocco per modificarlo."
            : "Datasheet-style timeline — click a block to edit."}
        </p>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {palette.map((type) => (
          <button
            key={type}
            type="button"
            onClick={() => addStep(type)}
            className="inline-flex items-center gap-1 rounded-slpill border border-border-strong bg-surface px-2.5 py-1 font-body text-[11px] font-semibold text-ink hover:border-brand-blue hover:text-brand-blue"
          >
            <Plus size={12} />
            {it ? STEP_LABELS[type].it : STEP_LABELS[type].en}
          </button>
        ))}
      </div>

      <div className="min-h-[9.5rem] overflow-x-auto rounded-slmd border border-border-strong bg-[linear-gradient(180deg,color-mix(in_srgb,#64748B_6%,transparent)_0%,transparent_48%)] px-3 py-3">
        <div className="mb-2 grid grid-cols-[3.25rem_1fr] gap-2 font-mono text-[9px] font-semibold uppercase tracking-wider text-ink-faint">
          <span />
          <div className="flex items-center gap-4">
            <span>{it ? "Corsia" : "Lane"}</span>
          </div>
        </div>

        <div className="grid grid-cols-[3.25rem_1fr] gap-2">
          <div className="flex flex-col justify-between py-1 font-mono text-[10px] font-semibold uppercase text-ink-faint">
            <span>Host</span>
            <span>{it ? "Dev" : "Dev"}</span>
          </div>

          <div className="flex min-w-min items-stretch gap-1">
            {steps.length === 0 ? (
              <div className="flex h-24 w-full items-center justify-center rounded-slsm border border-dashed border-border-strong font-body text-xs text-ink-faint">
                {it ? "Nessun passo — aggiungine dalla palette." : "No steps — add from the palette."}
              </div>
            ) : (
              steps.map((step, index) => {
                const tone = stepTone(step.type);
                const arrow = hostArrow(step);
                const active = selected === index;
                return (
                  <div key={`${phase}-${index}-${step.type}`} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setSelected(index)}
                      className={`flex h-24 w-[5.5rem] flex-col items-stretch rounded-slsm border px-1.5 py-1 text-left transition-shadow ${tone.bg} ${tone.border} ${
                        active ? "ring-2 ring-brand-blue shadow-e1" : "hover:shadow-e1"
                      }`}
                    >
                      <span className={`font-mono text-[10px] font-bold ${tone.text}`}>{stepBadge(step)}</span>
                      <span className="mt-0.5 line-clamp-2 font-body text-[9px] leading-tight text-ink-muted">
                        {it ? STEP_LABELS[step.type].it : STEP_LABELS[step.type].en}
                      </span>
                      <span className="mt-auto flex flex-1 flex-col items-center justify-center text-ink-faint">
                        {arrow === "down" ? <ArrowDown size={14} /> : null}
                        {arrow === "up" ? <ArrowUp size={14} /> : null}
                        {arrow === "none" ? <span className="h-px w-8 bg-border-strong" /> : null}
                      </span>
                      <span className="truncate text-center font-mono text-[8px] text-ink-faint">
                        {step.type === "i2c_write" || step.type === "i2c_read"
                          ? step.addr
                          : step.type === "emit"
                            ? step.from
                            : "·"}
                      </span>
                    </button>
                    {index < steps.length - 1 ? (
                      <ArrowRight size={12} className="shrink-0 text-ink-faint" aria-hidden />
                    ) : null}
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {selectedStep && selected !== null ? (
        <StepInspector
          step={selectedStep}
          index={selected}
          total={steps.length}
          outputs={readChannels(recipe).map((channel) => ({
            id: channel.id,
            label: channel.label,
            unit: channel.unit,
            kind: channel.quantity,
          }))}
          it={it}
          onChange={patchSelected}
          onRemove={() => {
            onChange(removeRecipeStep(recipe, phase, selected));
            setSelected(null);
          }}
          onMove={(dir) => {
            const to = selected + dir;
            onChange(moveRecipeStep(recipe, phase, selected, to));
            setSelected(to);
          }}
        />
      ) : (
        <p className="rounded-slsm bg-surface-sunken px-3 py-2 font-body text-[11px] text-ink-faint">
          {it
            ? "Seleziona un blocco sulla timeline, oppure aggiungine uno nuovo."
            : "Select a block on the timeline, or add a new one."}
        </p>
      )}

      {steps.length > 0 ? (
        <ol className="list-decimal space-y-0.5 pl-4 font-body text-[11px] text-ink-muted">
          {steps.map((step, index) => (
            <li key={`sum-${index}`}>{describeStep(step)}</li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function StepInspector({
  step,
  index,
  total,
  outputs,
  it,
  onChange,
  onRemove,
  onMove,
}: {
  readonly step: SensorRecipeStep;
  readonly index: number;
  readonly total: number;
  readonly outputs: SensorRecipe["outputs"];
  readonly it: boolean;
  readonly onChange: (next: SensorRecipeStep) => void;
  readonly onRemove: () => void;
  readonly onMove: (dir: -1 | 1) => void;
}) {
  return (
    <div className="rounded-slmd border border-border-strong bg-surface px-3 py-2.5">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-body text-xs font-semibold text-ink">
          {it ? "Blocco" : "Block"} {index + 1} · {it ? STEP_LABELS[step.type].it : STEP_LABELS[step.type].en}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            className="rounded-slsm border border-border px-1.5 py-0.5 font-body text-[10px] text-ink-muted disabled:opacity-30"
          >
            ←
          </button>
          <button
            type="button"
            disabled={index >= total - 1}
            onClick={() => onMove(1)}
            className="rounded-slsm border border-border px-1.5 py-0.5 font-body text-[10px] text-ink-muted disabled:opacity-30"
          >
            →
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="inline-flex items-center gap-1 rounded-slsm border border-border px-1.5 py-0.5 font-body text-[10px] text-error hover:border-error"
          >
            <Trash2 size={10} />
            {it ? "Rimuovi" : "Remove"}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {step.type === "wait" ? (
          <Field label="ms">
            <input
              type="number"
              min={0}
              value={step.ms}
              onChange={(e) => onChange({ type: "wait", ms: Number(e.target.value) || 0 })}
              className={fieldClass}
            />
          </Field>
        ) : null}

        {step.type === "i2c_write" ? (
          <>
            <Field label={it ? "Indirizzo" : "Address"}>
              <input
                value={step.addr}
                onChange={(e) => onChange({ ...step, addr: e.target.value })}
                className={fieldClass}
              />
            </Field>
            <Field label={it ? "Registro" : "Register"}>
              <input
                value={step.reg ?? ""}
                onChange={(e) => onChange({ ...step, reg: e.target.value || undefined })}
                className={fieldClass}
                placeholder="0xF4"
              />
            </Field>
            <Field label="Bytes">
              <input
                value={step.bytes.join(" ")}
                onChange={(e) =>
                  onChange({
                    ...step,
                    bytes: e.target.value
                      .trim()
                      .split(/\s+/)
                      .filter(Boolean),
                  })
                }
                className={`${fieldClass} w-40`}
                placeholder="0x27"
              />
            </Field>
          </>
        ) : null}

        {step.type === "i2c_read" ? (
          <>
            <Field label={it ? "Indirizzo" : "Address"}>
              <input
                value={step.addr}
                onChange={(e) => onChange({ ...step, addr: e.target.value })}
                className={fieldClass}
              />
            </Field>
            <Field label={it ? "Registro" : "Register"}>
              <input
                value={step.reg ?? ""}
                onChange={(e) => onChange({ ...step, reg: e.target.value || undefined })}
                className={fieldClass}
              />
            </Field>
            <Field label={it ? "Byte" : "Len"}>
              <input
                type="number"
                min={1}
                value={step.len}
                onChange={(e) => onChange({ ...step, len: Math.max(1, Number(e.target.value) || 1) })}
                className={fieldClass}
              />
            </Field>
            <Field label="into">
              <input
                value={step.into}
                onChange={(e) => onChange({ ...step, into: e.target.value })}
                className={fieldClass}
              />
            </Field>
          </>
        ) : null}

        {step.type === "adc_read" || step.type === "gpio_read" ? (
          <Field label="into">
            <input
              value={step.into}
              onChange={(e) => onChange({ ...step, into: e.target.value })}
              className={fieldClass}
            />
          </Field>
        ) : null}

        {step.type === "gpio_write" ? (
          <Field label="level">
            <select
              value={step.level}
              onChange={(e) => onChange({ type: "gpio_write", level: Number(e.target.value) as 0 | 1 })}
              className={fieldClass}
            >
              <option value={0}>0</option>
              <option value={1}>1</option>
            </select>
          </Field>
        ) : null}

        {step.type === "emit" ? (
          <>
            <Field label={it ? "Uscita" : "Output"}>
              <select
                value={step.outputId}
                onChange={(e) => onChange({ ...step, outputId: e.target.value })}
                className={fieldClass}
              >
                {outputs.map((output) => (
                  <option key={output.id} value={output.id}>
                    {output.label} ({output.id})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="from">
              <input
                value={step.from}
                onChange={(e) => onChange({ ...step, from: e.target.value })}
                className={fieldClass}
              />
            </Field>
          </>
        ) : null}
      </div>
    </div>
  );
}

const fieldClass =
  "rounded-slsm border border-border-strong bg-surface px-1.5 py-1 font-mono text-xs text-ink outline-none focus:border-brand-blue";

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <label className="flex min-w-[4.5rem] flex-col gap-0.5 font-body text-[10px] text-ink-muted">
      {label}
      {children}
    </label>
  );
}
