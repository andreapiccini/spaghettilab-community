import type { ReactNode } from "react";
import { Plus, Copy, Trash2, Blocks, BookOpen, ChevronDown } from "lucide-react";
import {
  addCommand,
  removeCommand,
  updateCommand,
  describeDeviceOp,
  type DeviceRecipeDraft,
} from "../../lib/device-recipe-draft.js";
import { actionPorts, duplicateDriverAction } from "../../lib/i2c-driver-actions.js";

const button =
  "rounded-slsm border border-border-strong px-2 py-1.5 font-body text-xs text-ink hover:border-brand-blue";
type Props = {
  draft: DeviceRecipeDraft;
  it: boolean;
  activeId: string | null;
  onChange: (d: DeviceRecipeDraft) => void;
  onSelect: (id: string) => void;
  children?: ReactNode;
};

export function DriverActionsList({
  draft,
  it,
  activeId,
  onChange,
  onSelect,
  children,
}: Props) {
  function add() {
    const next = addCommand(draft, {
      label: `${it ? "Azione" : "Action"} ${draft.commands.length + 1}`,
    });
    onChange(next);
    onSelect(next.commands[next.commands.length - 1]!.id);
  }
  return (
    <details
      open
      className="group/actions overflow-hidden rounded-slmd border border-border-strong bg-surface shadow-sm"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2.5 bg-surface-sunken/60 px-3 py-3 font-body text-xs font-semibold text-ink [&::-webkit-details-marker]:hidden">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-blue/10 text-brand-blue">
          <Blocks size={16} aria-hidden />
        </span>
        <span className="flex-1">{it ? "Azioni del sensore" : "Sensor actions"}</span>
        <span className="rounded-full bg-brand-blue/10 px-1.5 py-0.5 font-mono text-[10px] text-brand-blue">
          {draft.commands.length}
        </span>
        <ChevronDown
          size={14}
          className="-rotate-90 text-ink-muted transition-transform group-open/actions:rotate-0"
          aria-hidden
        />
      </summary>
      <div className="mx-3 mb-3 ml-6 border-l-2 border-brand-blue/15 pl-3 pt-2">
        <p className="mb-3 font-body text-[11px] leading-snug text-ink-muted">
          {it
            ? "Questo è l’elenco delle azioni del driver. Ogni azione può diventare un blocco del canvas: scegli quale modificare."
            : "These are your driver actions. Each can become a canvas block: select one to edit."}
        </p>
        <div className="space-y-1">
          {draft.commands.map((action) => (
            <div
              key={action.id}
              className={`rounded-lg border p-2 ${activeId === action.id ? "border-brand-blue/25 bg-brand-blue/5" : "border-border bg-surface-sunken/40"}`}
            >
              <div className="flex items-center gap-1">
                {activeId === action.id ? (
                  <input
                    aria-label={it ? "Nome azione" : "Action name"}
                    value={action.label}
                    onChange={(e) =>
                      onChange(
                        updateCommand(draft, action.id, {
                          ...action,
                          label: e.target.value,
                        }),
                      )
                    }
                    className="min-w-0 flex-1 rounded border border-brand-blue/25 bg-surface px-1 py-1 font-body text-xs font-semibold text-ink"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelect(action.id)}
                    className="min-w-0 flex-1 text-left font-body text-xs font-semibold text-ink"
                  >
                    {action.label || action.name}
                  </button>
                )}
                <button
                  type="button"
                  aria-label={
                    it ? `Duplica ${action.label}` : `Duplicate ${action.label}`
                  }
                  onClick={() => {
                    const next = duplicateDriverAction(draft, action);
                    onChange(next);
                    onSelect(next.commands.at(-1)!.id);
                  }}
                  className="rounded border border-border bg-surface p-1 text-ink-muted"
                >
                  <Copy size={12} />
                </button>
                <button
                  type="button"
                  aria-label={it ? `Rimuovi ${action.label}` : `Remove ${action.label}`}
                  onClick={() => {
                    const next = removeCommand(draft, action.id);
                    onChange(next);
                    if (next.commands[0]) onSelect(next.commands[0].id);
                  }}
                  className="rounded border border-border bg-surface p-1 text-error"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <span className="font-body text-[10px] text-ink-muted">
                {action.steps.length} {it ? "passi I²C" : "I²C steps"}
              </span>
              {activeId === action.id && (
                <details className="mt-1">
                  <summary className="cursor-pointer font-body text-[10px] text-ink-muted">
                    {it ? "Opzioni dell’azione" : "Action options"}
                  </summary>
                  <label className="mt-1 flex gap-1 font-body text-[10px] text-ink">
                    <input
                      type="checkbox"
                      checked={action.exposeOnCanvas !== false}
                      onChange={(e) =>
                        onChange(
                          updateCommand(draft, action.id, {
                            ...action,
                            exposeOnCanvas: e.target.checked,
                          }),
                        )
                      }
                    />
                    {it ? "Esponi nel canvas" : "Expose on canvas"}
                  </label>
                  <label className="block font-body text-[10px] text-ink-muted">
                    {it ? "Identificatore tecnico" : "Technical identifier"}
                    <input
                      value={action.name}
                      onChange={(e) =>
                        onChange(
                          updateCommand(draft, action.id, {
                            ...action,
                            name: e.target.value,
                          }),
                        )
                      }
                      className="w-full rounded border border-border bg-surface p-1 font-mono text-[10px]"
                    />
                  </label>
                </details>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button type="button" className={button} onClick={() => add()}>
            <Plus size={12} className="mr-1 inline" />
            {it ? "Azione" : "Action"}
          </button>
        </div>
        {children}
      </div>
    </details>
  );
}

export function DriverSequence({
  draft,
  ops,
  it,
  selectedId,
  onSelect,
  initialization = false,
}: {
  draft: DeviceRecipeDraft;
  ops: DeviceRecipeDraft["commands"][number]["steps"];
  it: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  initialization?: boolean;
}) {
  return (
    <section className="mb-3 rounded-slmd border border-border-strong bg-surface p-3">
      <h2 className="mb-2 font-body text-xs font-semibold text-ink">
        <BookOpen size={14} className="mr-1 inline text-brand-blue" aria-hidden />
        {initialization
          ? it
            ? "Passi di avvio · eseguiti una volta"
            : "Startup steps · run once"
          : it
            ? "Passi dell’azione selezionata"
            : "Selected action steps"}
      </h2>
      {!ops.length && (
        <p className="font-body text-xs text-ink-muted">
          {it ? "Aggiungi un passo dalla libreria." : "Add a step from the library."}
        </p>
      )}
      <ol className="space-y-1">
        {ops.map((op, i) => (
          <li key={op.id}>
            <button
              type="button"
              onClick={() => onSelect(op.id)}
              aria-pressed={selectedId === op.id}
              className={`flex w-full items-center gap-3 rounded-slsm border px-2 py-1.5 text-left ${selectedId === op.id ? "border-brand-blue bg-brand-blue/5" : "border-border bg-surface-sunken"}`}
            >
              <span className="font-mono text-xs text-ink-muted">{i + 1}</span>
              <span className="font-body text-xs text-ink">
                {op.type === "i2c_write"
                  ? `${it ? "Scrivi messaggio" : "Write message"} · ${op.bytes.length} byte`
                  : op.type === "i2c_read" || op.type === "i2c_write_read"
                    ? `${it ? "Leggi" : "Read"} ${op.type === "i2c_read" ? op.len : op.readLen} byte → $${op.into}`
                    : describeDeviceOp(op)}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <p className="mt-2 font-body text-xs text-ink-muted">
        {draft.binding.i2c?.address} ·{" "}
        {it
          ? "Connessione condivisa da tutte le azioni"
          : "Connection shared by all actions"}
      </p>
    </section>
  );
}

export function DriverCanvasPreview({
  draft,
  it,
  activeId,
}: {
  draft: DeviceRecipeDraft;
  it: boolean;
  activeId?: string | null;
}) {
  return (
    <section className="space-y-3">
      <h2 className="font-heading text-sm font-semibold text-ink">{draft.name}</h2>
      <p className="font-body text-xs text-ink-muted">
        {it
          ? "Un dispositivo, un blocco per ogni azione."
          : "One device, one block per action."}
      </p>
      {draft.commands
        .filter((action) =>
          activeId !== undefined
            ? action.id === activeId
            : action.exposeOnCanvas !== false,
        )
        .map((action) => {
          const ports = actionPorts(draft, action);
          return (
            <div
              key={action.id}
              className="rounded-slmd border border-border-strong bg-surface-sunken p-3"
            >
              <h3 className="font-body text-sm font-semibold text-ink">
                {draft.name} · {action.label}
              </h3>
              <div className="mt-3 grid grid-cols-2 gap-3 font-body text-xs">
                <div>
                  <p className="mb-2 text-ink-muted">{it ? "Ingressi" : "Inputs"}</p>
                  <div className="mb-1 rounded-slsm border border-border px-2 py-1">
                    → {it ? "Esegui" : "Run"}
                  </div>
                  {ports.inputs.map((p) => (
                    <div
                      key={p.id}
                      className="mb-1 rounded-slsm border border-brand-blue/30 px-2 py-1 text-brand-blue"
                    >
                      → {p.label}
                      {p.unit ? ` (${p.unit})` : ""}
                    </div>
                  ))}
                </div>
                <div>
                  <p className="mb-2 text-ink-muted">{it ? "Uscite" : "Outputs"}</p>
                  {ports.outputs.map((p) => (
                    <div
                      key={p.id}
                      className="mb-1 rounded-slsm border border-success/30 px-2 py-1 text-ink"
                    >
                      {p.label}
                      {p.unit ? ` (${p.unit})` : ""} →
                    </div>
                  ))}
                  {!ports.outputs.length && (
                    <p className="text-ink-faint">
                      {it ? "Nessuna uscita pubblicata" : "No published outputs"}
                    </p>
                  )}
                </div>
              </div>
              <p className="mt-3 font-body text-[10px] text-ink-muted">
                {it
                  ? "Ingressi → variabili interne → passi I²C · variabili → Uscite"
                  : "Inputs → internal variables → I²C steps · variables → Outputs"}
              </p>
            </div>
          );
        })}
    </section>
  );
}
