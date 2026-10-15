import { SensorSchematic } from "./SensorSchematic.js";
import { sensorInterfaces } from "../../lib/sensor-instance.js";
import type { ReactNode } from "react";
import { Plus, Copy, Trash2, Blocks, BookOpen, ChevronDown } from "lucide-react";
import {
  addCommand,
  removeCommand,
  updateCommand,
  describeDeviceOp,
  type DeviceRecipeDraft,
} from "../../lib/device-recipe-draft.js";
import { readableI2cStep } from "../../lib/i2c-step-label.js";
import { duplicateDriverAction } from "../../lib/i2c-driver-actions.js";

const button =
  "rounded-slsm border border-border-strong px-2 py-1.5 font-body text-xs text-ink hover:border-brand-blue";
type Props = {
  draft: DeviceRecipeDraft;
  it: boolean;
  activeId: string | null;
  onChange: (d: DeviceRecipeDraft) => void;
  onSelect: (id: string) => void;
  children?: ReactNode;
  selectedStepId?: string | null;
  onSelectStep?: (id: string) => void;
  onRemoveStep: (actionId: string, stepId: string) => void;
};

export function DriverActionsList({
  draft,
  it,
  activeId,
  onChange,
  onSelect,
  children,
  selectedStepId,
  onSelectStep,
  onRemoveStep,
}: Props) {
  function add() {
    const next = addCommand(draft, {
      label: `${it ? "Azione" : "Action"} ${draft.commands.length + 1}`,
      exposeOnCanvas: true,
    });
    onChange(next);
    onSelect(next.commands[next.commands.length - 1]!.id);
  }
  return (
    <details
      open
      className="group/actions shrink-0 overflow-hidden rounded-slmd border border-border-strong bg-surface shadow-sm"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2.5 bg-surface-sunken/60 px-3 py-3 font-body text-xs font-semibold text-ink [&::-webkit-details-marker]:hidden">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-blue/10 text-brand-blue">
          <Blocks size={16} aria-hidden />
        </span>
        <span className="flex-1">{it ? "Azioni" : "Actions"}</span>
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
            ? "Questo è l’elenco delle azioni del driver. Scegli quale modificare; ogni blocco del sensore nel canvas può selezionarne una."
            : "These are your driver actions. Choose one to edit; each sensor block on the canvas selects one action."}
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
              {activeId === action.id && action.steps.length > 0 && (
                <div className="mt-2 space-y-1 border-t border-brand-blue/15 pt-2">
                  {action.steps.map((step, index) => (
                    <div key={step.id} className="flex items-start gap-1">
                      <button
                        type="button"
                        aria-pressed={selectedStepId === step.id}
                        onClick={() => onSelectStep?.(step.id)}
                        className={`flex min-w-0 flex-1 items-start gap-2 rounded-md px-2 py-1.5 text-left font-body text-[11px] ${selectedStepId === step.id ? "bg-brand-blue/10 text-brand-blue" : "text-ink-muted hover:bg-brand-blue/5"}`}
                      >
                        <span className="shrink-0 font-mono text-[10px]">
                          {index + 1}
                        </span>
                        <span className="min-w-0 break-words">
                          {draft.binding.bus === "i2c"
                            ? readableI2cStep(draft, step, undefined, it)
                            : describeDeviceOp(step)}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={
                          it
                            ? `Rimuovi passo ${index + 1} da ${action.label}`
                            : `Remove step ${index + 1} from ${action.label}`
                        }
                        onClick={() => onRemoveStep(action.id, step.id)}
                        className="shrink-0 rounded-md p-1.5 text-ink-faint hover:bg-error/10 hover:text-error"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {activeId === action.id && children}
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          <button type="button" className={button} onClick={() => add()}>
            <Plus size={12} className="mr-1 inline" />
            {it ? "Azione" : "Action"}
          </button>
        </div>
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
  controls,
  result,
}: {
  draft: DeviceRecipeDraft;
  ops: DeviceRecipeDraft["commands"][number]["steps"];
  it: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  initialization?: boolean;
  controls?: ReactNode;
  result?: ReactNode;
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
      <div className="mt-3">{controls}</div>
      {result}
    </section>
  );
}

export function DriverCanvasPreview({
  draft,
  it,
}: {
  draft: DeviceRecipeDraft;
  it: boolean;
  activeId?: string | null;
}) {
  const interfaces = sensorInterfaces(draft);
  const inputs = interfaces.inputs.flatMap((op) => {
    const channel = draft.channels.find((ch) => ch.id === op.fromChannelId);
    return channel
      ? [{ ...channel, inputMode: op.inputMode ?? ("data" as const), variable: op.into }]
      : [];
  });
  const outputs = interfaces.outputs.flatMap((op) => {
    const channel = draft.channels.find((ch) => ch.id === op.channelId);
    return channel ? [{ ...channel, variable: op.from }] : [];
  });
  return (
    <section className="space-y-2">
      <SensorSchematic
        name={draft.name}
        inputs={inputs}
        outputs={outputs}
        it={it}
      />
      <p className="font-body text-[10px] text-ink-muted">
        {it
          ? "Pin disponibili del sensore. Nel canvas ogni istanza sceglie una sola azione, un ingresso e un’uscita. Usa più blocchi per altre connessioni."
          : "Available sensor pins. Each canvas instance selects one action, input and output. Use more blocks for more connections."}
      </p>
    </section>
  );
}
