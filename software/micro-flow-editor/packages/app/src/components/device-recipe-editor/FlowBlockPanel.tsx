import {
  Braces,
  Cable,
  Plus,
  ChevronDown,
  ArrowDownToLine,
  ArrowUpFromLine,
  Binary,
  ScanLine,
} from "lucide-react";
import {
  describeDeviceOp,
  toVarRef,
  type DeviceRecipeDraft,
  type DeviceRecipeOp,
} from "../../lib/device-recipe-draft.js";
import type { FlowInterfaceKind } from "../../lib/flow-interfaces.js";
export function FlowBlockPanel({
  draft,
  it,
  selectedId,
  onSelect,
  onAdd,
  onEdit,
}: {
  draft: DeviceRecipeDraft;
  it: boolean;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (kind: FlowInterfaceKind) => void;
  onEdit?: () => void;
}) {
  const bufferNames = draft.commands.flatMap((command) =>
    command.steps.flatMap((op) => ("into" in op ? [op.into] : [])),
  );
  const variables = [
    ...new Set(
      [...draft.variables.map((v) => v.name), ...(draft.flowInterfaces ?? []).flatMap(op => op.type === "sample_external" && op.inputMode !== "trigger" ? [op.into] : []), ...bufferNames].filter(
        (name): name is string => typeof name === "string",
      ),
    ),
  ];
  const labels: Record<FlowInterfaceKind, string> = {
    sample_external: it ? "Ingresso" : "Input",
    encode: "Encoder",
    decode: "Decoder",
    emit: it ? "Uscita" : "Output",
  };
  const icons = {
    sample_external: ArrowDownToLine,
    encode: Binary,
    decode: ScanLine,
    emit: ArrowUpFromLine,
  };
  return (
    <details
      open
      className="group/flow shrink-0 overflow-hidden rounded-slmd border border-border-strong bg-surface shadow-sm"
    >
      <summary onClick={onEdit} className="flex cursor-pointer list-none items-center gap-2.5 bg-surface-sunken/60 px-3 py-3 font-body text-xs font-semibold text-ink [&::-webkit-details-marker]:hidden">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-brand-blue/10 text-brand-blue">
          <Cable size={16} aria-hidden />
        </span>
        <span className="flex-1">
          {it ? "Blocco Flow del sensore" : "Sensor Flow block"}
        </span>
        <ChevronDown
          size={14}
          className="-rotate-90 text-ink-muted transition-transform group-open/flow:rotate-0"
          aria-hidden
        />
      </summary>
      <div className="mx-3 mb-3 ml-6 border-l-2 border-brand-blue/15 pl-3">
        <p className="my-2 font-body text-[11px] text-ink-muted">
          {it
            ? "Interfacce e variabili condivise dal driver. I passi I²C le usano con $nome."
            : "Driver interfaces and variables. I²C steps use them as $name."}
        </p>
        <details className="group/interfaces mb-2 rounded-lg border border-border bg-surface-sunken/40">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-2.5 py-2 font-body text-[11px] font-medium text-brand-blue [&::-webkit-details-marker]:hidden">
            <Plus size={13} aria-hidden />
            <span className="flex-1">
              {it ? "Aggiungi interfaccia" : "Add interface"}
            </span>
            <ChevronDown
              size={12}
              className="-rotate-90 transition-transform group-open/interfaces:rotate-0"
              aria-hidden
            />
          </summary>
          <div className="grid grid-cols-2 gap-1 px-2 pb-2">
            {(["sample_external", "emit"] as const).map((kind) => {
              const Icon = icons[kind];
              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => onAdd(kind)}
                  className="rounded-slsm border border-border px-2 py-1.5 text-left font-body text-xs"
                >
                  <Icon
                    size={12}
                    className="mr-1.5 inline text-brand-blue"
                    aria-hidden
                  />
                  {labels[kind]}
                </button>
              );
            })}
          </div>
        </details>
        <div className="space-y-1">
          {draft.flowInterfaces
            ?.filter((op) => op.type === "sample_external" || op.type === "emit")
            .map((op) => (
              <button
                key={op.id}
                type="button"
                aria-pressed={selectedId === op.id}
                onClick={() => onSelect(op.id)}
                className={`w-full rounded-slsm px-2 py-1.5 text-left font-body text-xs ${selectedId === op.id ? "bg-brand-blue/10 text-brand-blue" : "bg-surface-sunken text-ink"}`}
              >
                {interfaceLabel(op, labels)}
                <span className="block truncate text-[10px] text-ink-muted">
                  {op.type === "sample_external"
                    ? op.inputMode === "trigger" ? "Trigger → azione selezionata nel canvas" : `${draft.channels.find((channel) => channel.id === op.fromChannelId)?.label ?? op.fromChannelId} → $${op.into}`
                    : op.type === "emit"
                      ? `$${op.from} → ${draft.channels.find((channel) => channel.id === op.channelId)?.label ?? op.channelId}`
                      : describeDeviceOp(op)}
                </span>
              </button>
            ))}
        </div>
        <details
          open
          className="group/variables mt-3 rounded-lg border border-border bg-surface-sunken/40 p-2.5"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 font-body text-[11px] font-medium text-ink [&::-webkit-details-marker]:hidden">
            <Braces size={13} className="text-brand-blue" aria-hidden />
            <span className="flex-1">
              {it ? "Variabili disponibili" : "Available variables"}
            </span>
            <span className="rounded-full bg-brand-blue/10 px-1.5 py-0.5 font-mono text-[10px] text-brand-blue">
              {variables.length}
            </span>
            <ChevronDown
              size={12}
              className="-rotate-90 text-ink-muted transition-transform group-open/variables:rotate-0"
              aria-hidden
            />
          </summary>
          <p className="my-1 font-body text-[10px] text-ink-muted">
            {it
              ? "Trascina una variabile in una casella del messaggio, oppure scrivi $nome."
              : "Drag a variable into a message cell, or type $name."}
          </p>
          <div className="flex flex-wrap gap-1">
            {variables.map((name) => (
              <span
                key={name}
                draggable
                onDragStart={(event) => {
                  event.dataTransfer.setData("text/plain", toVarRef(name));
                  event.dataTransfer.effectAllowed = "copy";
                }}
                className="cursor-grab rounded-slsm border border-brand-blue/25 bg-brand-blue/5 px-1.5 py-1 font-mono text-[11px] text-brand-blue"
              >
                {toVarRef(name)}
              </span>
            ))}
          </div>
        </details>
      </div>
    </details>
  );
}
function interfaceLabel(
  op: DeviceRecipeOp,
  labels: Record<FlowInterfaceKind, string>,
): string {
  return op.type in labels ? labels[op.type as FlowInterfaceKind] : op.type;
}
