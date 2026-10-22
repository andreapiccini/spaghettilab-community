import { useState } from "react";
import { topologyNeedsReconfiguration } from "../../lib/backbone-topology-change.js";
import { logicalBackboneKey } from "../../lib/logical-backbone-slots.js";
import { BackboneTargetPicker } from "../backbone/BackboneTargetPicker.js";
import { useSession } from "../../state/session-context.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { NFC_INSTALL_META } from "../../lib/nfc-workspace.js";
import { ModuleArtwork } from "../hardware/ModuleArtwork.js";
import { Cpu, Plus, Trash2, ChevronDown, ChevronUp } from "lucide-react";
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
  bindingId,
  onAdd,
  onSelect,
  onRemove,
  onUseStatusLed,
}: {
  readonly bindingId?: string;
  readonly modules: readonly BackboneSensorModule[];
  readonly onAdd: () => void;
  readonly onSelect: (module: BackboneSensorModule) => void;
  readonly onRemove: (moduleId: string) => void;
  readonly onUseStatusLed: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const { locale } = useLocale();
  const it = locale === "it";
  const { session, moduleTarget } = useSession();
  const { rows, getSnapshot } = useCoreSessions();
  const choices = rows.filter(row => !bindingId || row.binding.bindingId === bindingId).flatMap(row => row.attachedBackbones.filter(board => board.productKind !== "nfc-reader").map(board => ({ ...board, bindingId: row.binding.bindingId })));
  const board = choices.find(item => item.bindingId === moduleTarget?.bindingId && item.deviceIdHex === moduleTarget.deviceIdHex) ?? choices[0];
  const boardKey = board ? logicalBackboneKey(session?.stack.current, board.bindingId, getSnapshot(board.bindingId)?.status, board.nodeId) ?? `${board.bindingId}:${board.deviceIdHex}` : undefined;
  let installations: Record<string, { moduleId?: string; boardKey?: string }> = {};
  try { installations = JSON.parse(session?.stack.current.authoringMetadata[NFC_INSTALL_META]?.comment ?? "{}"); } catch { /* No installations yet. */ }
  const topologyPending = !!(session && board && topologyNeedsReconfiguration(session.stack.current, board.bindingId, getSnapshot(board.bindingId)?.status));
  const visibleModules = topologyPending ? [] : modules.filter(module => {
    const key = module.gpioAssignments?.boardKey ?? module.gpioAssignment?.boardKey ?? Object.values(installations).find(item => item?.moduleId === module.id)?.boardKey;
    return key ? key === boardKey : board?.local === true;
  });

  return (
    <div
      data-tour-target="backbone-modules-panel"
      className={`pointer-events-auto absolute z-20 flex ${collapsed ? "w-44" : "w-[min(100%-1.5rem,20rem)]"} flex-col overflow-hidden rounded-slmd border-2 border-dashed shadow-e1`}
      style={{
        right: "max(0.75rem, env(safe-area-inset-right))",
        top: "0.75rem",
        borderColor: "#64748B",
        backgroundColor: "color-mix(in srgb, #64748B 8%, var(--color-surface))",
      }}
    >
      <button type="button" onClick={() => setCollapsed(value => !value)} aria-expanded={!collapsed}
        aria-label={it ? (collapsed ? "Espandi pannello Backbone" : "Riduci pannello Backbone") : (collapsed ? "Expand Backbone panel" : "Collapse Backbone panel")}
        className="flex h-9 shrink-0 items-center gap-1.5 border-b border-slate-400/25 px-2 hover:bg-surface-raised">
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
        {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
      </button>

      {!collapsed && <>
      <div className="border-b border-border px-2 py-2"><BackboneTargetPicker bindingId={bindingId} /></div>
      {topologyPending && <p className="p-3 text-sm text-ink-muted">Assegnazioni da riconfigurare. Controlla la nuova disposizione delle Backbone nell’avviso in alto.</p>}
      <div className="flex flex-wrap gap-2 p-2">
        <button
          type="button"
          onClick={onUseStatusLed}
          disabled={board?.local === false}
          data-tooltip={board?.local === false ? (it ? "Il blocco LED interno è disponibile per il master" : "The internal LED block is available for the master") : undefined}
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

        {visibleModules.map((module) => {
          const recipe = resolveRecipe(module);
          return (
            <div key={module.id} className="group relative">
              <button
                type="button"
                onClick={() => onSelect(module)}
                title={it ? `Aggiungi ${module.label} al canvas` : `Add ${module.label} to canvas`}
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

      {visibleModules.length === 0 && (
        <p className="border-t border-slate-400/20 px-2.5 py-2 font-body text-[11px] text-ink-faint">
          {it
            ? "LED interno è il LED della Backbone. + scegli un sensore: compare il blocco con i canali sul canvas."
            : "Internal LED is the on-board LED. + pick a sensor: its channel block appears on the canvas."}
        </p>
      )}
      </>}
    </div>
  );
}
