import { ModuleArtwork } from "../hardware/ModuleArtwork.js";
import { useEffect, useRef } from "react";
import { Cpu, Plus, Trash2 } from "lucide-react";
import type { BackboneSensorModule } from "../../lib/backbone-sensor-modules.js";
import { resolveRecipe } from "../../lib/backbone-sensor-modules.js";
import { STATUS_LED_LABEL } from "../../lib/backbone-physical.js";
import { useLocale } from "../../state/locale-context.js";

/**
 * Backbone box chrome on the Flow canvas: built-in STATUS LED, physical
 * modules as tiles, and “+” to open the sensor-recipe wizard.
 */
export function BackboneModulesPanel({
  modules,
  onAdd,
  onSelect,
  onEdit,
  onRemove,
  onUseStatusLed,
}: {
  readonly modules: readonly BackboneSensorModule[];
  readonly onAdd: () => void;
  readonly onSelect: (module: BackboneSensorModule) => void;
  readonly onEdit: (module: BackboneSensorModule) => void;
  readonly onRemove: (moduleId: string) => void;
  readonly onUseStatusLed: () => void;
}) {
  const { locale } = useLocale();
  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(clickTimer.current), []);
  const it = locale === "it";

  return (
    <div
      data-tour-target="backbone-modules-panel"
      className="pointer-events-auto absolute z-20 flex w-[min(100%-1.5rem,20rem)] flex-col overflow-hidden rounded-slmd border-2 border-dashed shadow-e1"
      style={{
        right: "max(0.75rem, env(safe-area-inset-right))",
        top: "0.75rem",
        borderColor: "#64748B",
        backgroundColor: "color-mix(in srgb, #64748B 8%, var(--color-surface))",
      }}
    >
      <div className="flex h-8 shrink-0 items-center gap-1.5 border-b border-slate-400/25 px-2">
        <Cpu size={13} className="shrink-0 text-slate-500" />
        <span className="min-w-0 truncate font-body text-xs font-semibold text-ink-muted">
          Backbone
        </span>
        <span
          className="ml-auto shrink-0 rounded-slsm px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-slate-600"
          style={{ backgroundColor: "color-mix(in srgb, #64748B 12%, transparent)" }}
        >
          {it ? "Moduli" : "Modules"}
        </span>
      </div>

      <div className="flex flex-wrap gap-2 p-2">
        <button
          type="button"
          onClick={onUseStatusLed}
          title={
            it
              ? STATUS_LED_LABEL
              : "Internal LED"
          }
          className="flex h-[4.5rem] w-[4.5rem] flex-col items-center justify-center gap-1 rounded-slsm border border-border-strong bg-surface px-1 text-center shadow-e1 hover:border-brand-blue"
          style={{ outline: "1px solid color-mix(in srgb, #22C55E 35%, transparent)" }}
        >
          <span className="h-8 w-8">
            <ModuleArtwork kind="led" name="LED interno" />
          </span>
          <span className="line-clamp-2 w-full font-body text-[10px] font-semibold leading-tight text-ink">
            {it ? "LED interno" : "Internal LED"}
          </span>
        </button>

        {modules.map((module) => {
          const recipe = resolveRecipe(module);
          return (
            <div key={module.id} className="group relative">
              <button
                type="button"
                onClick={() => {
                  clearTimeout(clickTimer.current);
                  clickTimer.current = setTimeout(() => onSelect(module), 400);
                }}
                onDoubleClick={() => { clearTimeout(clickTimer.current); onEdit(module); }}
                title={recipe.oneLiner}
                className="flex h-[4.5rem] w-[4.5rem] flex-col items-center justify-center gap-1 rounded-slsm border border-border-strong bg-surface px-1 text-center shadow-e1 hover:border-brand-blue"
              >
                <span className="h-8 w-8">
                  <ModuleArtwork
                    kind={recipe.deviceDraft?.gpioHardware?.kind ?? "generic"}
                    name={module.label}
                  />
                </span>
                <span className="line-clamp-2 w-full font-body text-[10px] font-semibold leading-tight text-ink">
                  {module.label}
                </span>
                <span className="font-mono text-[9px] uppercase text-ink-faint">
                  {module.bus}
                </span>
              </button>
              <button
                type="button"
                aria-label={it ? "Rimuovi modulo" : "Remove module"}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(module.id);
                }}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border-strong bg-surface text-ink-muted opacity-0 shadow-e1 hover:border-error hover:text-error group-hover:opacity-100"
              >
                <Trash2 size={10} />
              </button>
            </div>
          );
        })}

        <button
          type="button"
          onClick={onAdd}
          aria-label={it ? "Aggiungi modulo" : "Add module"}
          className="flex h-[4.5rem] w-[4.5rem] flex-col items-center justify-center gap-1 rounded-slsm border-2 border-dashed border-slate-400/50 bg-surface/60 text-slate-500 transition-colors hover:border-brand-blue hover:text-brand-blue"
        >
          <Plus size={22} strokeWidth={2} />
          <span className="font-body text-[10px] font-semibold">
            {it ? "Aggiungi" : "Add"}
          </span>
        </button>
      </div>

      {modules.length === 0 && (
        <p className="border-t border-slate-400/20 px-2.5 py-2 font-body text-[11px] text-ink-faint">
          {it
            ? "LED interno è il LED della Backbone. + scegli un sensore: compare il blocco con i canali sul canvas."
            : "Internal LED is the on-board LED. + pick a sensor: its channel block appears on the canvas."}
        </p>
      )}
    </div>
  );
}
