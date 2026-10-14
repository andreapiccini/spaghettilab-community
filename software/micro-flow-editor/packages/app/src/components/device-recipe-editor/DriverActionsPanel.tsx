import {
  Plus,
  Copy,
  Trash2,
  Blocks,
  BookOpen,
  ArrowDownToLine,
  Pencil,
} from "lucide-react";
import {
  addCommand,
  removeCommand,
  updateCommand,
  describeDeviceOp,
  type DeviceRecipeDraft,
} from "../../lib/device-recipe-draft.js";
import {
  actionPorts,
  addRegisterAction,
  duplicateDriverAction,
} from "../../lib/i2c-driver-actions.js";

const button =
  "rounded-slsm border border-border-strong px-2 py-1.5 font-body text-xs text-ink hover:border-brand-blue";
const input =
  "w-full rounded-slsm border border-border-strong bg-surface px-2 py-1.5 font-body text-xs text-ink";
type Props = {
  draft: DeviceRecipeDraft;
  it: boolean;
  activeId: string | null;
  onChange: (d: DeviceRecipeDraft) => void;
  onSelect: (id: string) => void;
};

export function DriverActionsList({ draft, it, activeId, onChange, onSelect }: Props) {
  function add(kind?: "read" | "write") {
    const next = kind
      ? addRegisterAction(draft, kind, it)
      : addCommand(draft, { label: it ? "Nuova azione" : "New action" });
    onChange(next);
    onSelect(next.commands[next.commands.length - 1]!.id);
  }
  return (
    <section className="rounded-slmd border border-border-strong p-3">
      <h2 className="mb-2 font-body text-xs font-semibold text-ink">
        <Blocks size={14} className="mr-1 inline text-brand-blue" aria-hidden />
        {it ? "Azioni del sensore" : "Sensor actions"}
      </h2>
      <p className="mb-3 font-body text-[11px] leading-snug text-ink-muted">
        {it
          ? "Questo è l’elenco delle azioni del driver. Ogni azione può diventare un blocco del canvas: scegli quale modificare."
          : "These are your driver actions. Each can become a canvas block: select one to edit."}
      </p>
      <div className="space-y-1">
        {draft.commands.map((action) => (
          <button
            key={action.id}
            type="button"
            aria-pressed={activeId === action.id}
            onClick={() => onSelect(action.id)}
            className={`w-full rounded-slsm px-2 py-2 text-left font-body text-xs ${activeId === action.id ? "bg-brand-blue/10 text-brand-blue" : "text-ink hover:bg-surface-sunken"}`}
          >
            <span className="block font-semibold">{action.label || action.name}</span>
            <span className="text-ink-muted">
              {action.steps.length} {it ? "passi" : "steps"} ·{" "}
              {action.exposeOnCanvas === false
                ? it
                  ? "solo driver"
                  : "driver only"
                : it
                  ? "blocco canvas"
                  : "canvas block"}
            </span>
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5">
        <button type="button" className={button} onClick={() => add()}>
          <Plus size={12} className="mr-1 inline" />
          {it ? "Azione" : "Action"}
        </button>
        {draft.binding.bus === "i2c" && (
          <>
            <button type="button" className={button} onClick={() => add("read")}>
              <ArrowDownToLine size={12} className="mr-1 inline" aria-hidden />
              {it ? "Leggi registro" : "Read register"}
            </button>
            <button type="button" className={button} onClick={() => add("write")}>
              <Pencil size={12} className="mr-1 inline" aria-hidden />
              {it ? "Scrivi registro" : "Write register"}
            </button>
          </>
        )}
      </div>
    </section>
  );
}

export function DriverActionSettings({
  draft,
  it,
  activeId,
  onChange,
  onSelect,
}: Props) {
  const action = draft.commands.find((a) => a.id === activeId);
  if (!action) return null;
  const ports = actionPorts(draft, action);
  return (
    <section className="mb-3 rounded-slmd border border-border-strong bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-heading text-sm font-semibold text-ink">
          {it ? "Azione" : "Action"}: {action.label}
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            className={button}
            onClick={() => {
              const next = duplicateDriverAction(draft, action);
              onChange(next);
              onSelect(next.commands[next.commands.length - 1]!.id);
            }}
          >
            <Copy size={12} className="mr-1 inline" />
            {it ? "Duplica" : "Duplicate"}
          </button>
          <button
            type="button"
            className={button}
            onClick={() => {
              const next = removeCommand(draft, action.id);
              onChange(next);
              if (next.commands[0]) onSelect(next.commands[0].id);
            }}
          >
            <Trash2 size={12} className="mr-1 inline" />
            {it ? "Rimuovi azione" : "Remove action"}
          </button>
        </div>
      </div>
      <details>
        <summary className="cursor-pointer font-body text-xs text-ink-muted">
          {it
            ? "Nome, blocco canvas e dettagli dell’azione"
            : "Name, canvas block and action details"}
        </summary>
        <div className="mt-2">
          <label className="mb-3 flex items-center gap-2 font-body text-xs text-ink-muted">
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
            {it
              ? "Esponi questa azione come blocco nel canvas"
              : "Expose this action as a canvas block"}
          </label>
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="font-body text-xs text-ink-muted">
              {it ? "Nome del blocco" : "Block label"}
              <input
                aria-label={it ? "Nome azione" : "Action label"}
                className={input}
                value={action.label}
                onChange={(e) =>
                  onChange(
                    updateCommand(draft, action.id, {
                      ...action,
                      label: e.target.value,
                    }),
                  )
                }
              />
            </label>
            <details>
              <summary className="cursor-pointer font-body text-xs text-ink-muted">
                {it ? "Identificatore tecnico" : "Technical identifier"}
              </summary>{" "}
              <label className="font-body text-xs text-ink-muted">
                {it ? "Identificatore" : "Identifier"}
                <input
                  className={input}
                  value={action.name}
                  onChange={(e) =>
                    onChange(
                      updateCommand(draft, action.id, {
                        ...action,
                        name: e.target.value,
                      }),
                    )
                  }
                />
              </label>
            </details>
          </div>
          <p className="mt-2 font-body text-xs text-ink-muted">
            {it ? "Ingressi" : "Inputs"}:{" "}
            {ports.inputs.map((p) => p.label).join(", ") || "—"} ·{" "}
            {it ? "Risultati" : "Results"}:{" "}
            {ports.outputs.map((p) => p.label).join(", ") ||
              (it ? "Nessuna uscita" : "No output")}
          </p>
        </div>
      </details>
    </section>
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
                {(op.type === "i2c_write" || op.type === "i2c_write_read") &&
                op.registerWidth
                  ? `${it ? (op.type === "i2c_write" ? "Scrivi registro" : "Leggi registro") : op.type === "i2c_write" ? "Write register" : "Read register"} 0x${(op.type === "i2c_write" ? op.bytes : op.writeBytes).slice(0, op.registerWidth).join("")}`
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
}: {
  draft: DeviceRecipeDraft;
  it: boolean;
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
        .filter((action) => action.exposeOnCanvas !== false)
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
              <div className="mt-2 flex flex-wrap justify-between gap-2 font-body text-xs text-ink-muted">
                <span>
                  → {it ? "Esegui" : "Run"}
                  {ports.inputs.length
                    ? `, ${ports.inputs.map((p) => p.label).join(", ")}`
                    : ""}
                </span>
                <span>
                  {ports.outputs.length
                    ? ports.outputs
                        .map((p) => `${p.label}${p.unit ? ` (${p.unit})` : ""}`)
                        .join(", ")
                    : it
                      ? "Scrittura"
                      : "Write"}{" "}
                  →
                </span>
              </div>
            </div>
          );
        })}
    </section>
  );
}
