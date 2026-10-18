import { workbenchStepLabel, workbenchStepKind } from "./sensor-workbench-labels.js";
import {
  Blocks,
  Cable,
  ChevronDown,
  ChevronRight,
  Copy,
  Pencil,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import {
  addCommand,
  removeCommand,
  updateCommand,
  type DeviceRecipeDraft,
  type DeviceRecipeOp,
} from "../../lib/device-recipe-draft.js";
import { duplicateDriverAction } from "../../lib/i2c-driver-actions.js";

type Shared = {
  draft: DeviceRecipeDraft;
  it: boolean;
  activeId: string | null;
  onChange: (draft: DeviceRecipeDraft) => void;
  onSelectAction: (id: string) => void;
};
export function SensorWorkbenchNav({
  draft,
  it,
  pane,
  activeId,
  selectedStepId,
  selectedInterfaceId,
  onChange,
  onSelectAction,
  onSelectFlow,
  onSelectConnections,
  onSelectInterface,
  onSelectInit,
  onSelectStep,
  onRemoveStep,
}: Shared & {
  pane: "flow" | "actions" | "init" | "connections";
  onSelectConnections?: () => void;
  selectedStepId: string | null;
  selectedInterfaceId: string | null;
  onSelectFlow: () => void;
  onSelectInit: () => void;
  onSelectInterface: (id: string) => void;
  onSelectStep: (id: string) => void;
  onRemoveStep: (id: string) => void;
}) {
  const [actionsExpanded, setActionsExpanded] = useState(true);
  const [renamingActionId, setRenamingActionId] = useState<string | null>(null);
  function stepList(steps: readonly DeviceRecipeOp[]) {
    return (
      <ol className="sensor-nav-steps">
        {steps.map((step, index) => (
          <li key={step.id} className={selectedStepId === step.id ? "is-selected" : ""}>
            <button
              type="button"
              aria-pressed={selectedStepId === step.id}
              onClick={() => onSelectStep(step.id)}
            >
              <span className="sensor-step-number">{index + 1}</span>
              <span className="sensor-nav-step-name">
                <span>{workbenchStepLabel(step, it)}</span>
                <small className="sensor-step-kind">
                  {workbenchStepKind(step, it)}
                </small>
              </span>
            </button>
            <button
              type="button"
              className="sensor-nav-remove"
              onClick={() => onRemoveStep(step.id)}
              aria-label={
                it ? `Rimuovi passo ${index + 1}` : `Remove step ${index + 1}`
              }
            >
              <Trash2 size={13} />
            </button>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <nav
      className="sensor-nav"
      aria-label={it ? "Editor del dispositivo" : "Device editor"}
    >
      {onSelectConnections && (
        <button
          type="button"
          className={`sensor-nav-primary ${pane === "connections" ? "is-selected" : ""}`}
          aria-pressed={pane === "connections"}
          onClick={onSelectConnections}
        >
          <Cable size={20} />
          <span>{it ? "Collegamenti" : "Connections"}</span>
        </button>
      )}
      <button
        type="button"
        className={`sensor-nav-primary ${pane === "flow" ? "is-selected" : ""}`}
        aria-pressed={pane === "flow"}
        onClick={onSelectFlow}
      >
        <Cable size={20} />
        <span>Input / Output</span>
      </button>
      {pane === "flow" && (
        <div className="sensor-nav-interfaces">
          {draft.flowInterfaces
            ?.filter((op) => op.type === "sample_external" || op.type === "emit")
            .map((op) => (
              <button
                key={op.id}
                type="button"
                aria-pressed={selectedInterfaceId === op.id}
                className={selectedInterfaceId === op.id ? "is-selected" : ""}
                onClick={() => onSelectInterface(op.id)}
              >
                {op.type === "sample_external"
                  ? (draft.channels.find((channel) => channel.id === op.fromChannelId)
                      ?.label ?? (it ? "Ingresso" : "Input"))
                  : op.type === "emit"
                    ? (draft.channels.find((channel) => channel.id === op.channelId)
                        ?.label ?? (it ? "Uscita" : "Output"))
                    : ""}
              </button>
            ))}
        </div>
      )}
      <div className="sensor-nav-init">
        <button
          type="button"
          className={`sensor-nav-primary ${pane === "init" ? "is-selected" : ""}`}
          aria-pressed={pane === "init"}
          onClick={onSelectInit}
        >
          <Play size={19} />
          <span>
            {it ? "Inizializzazione" : "Initialization"}
            <small>
              {draft.phases.init.length}{" "}
              {it
                ? draft.phases.init.length === 1
                  ? "passo · all’avvio"
                  : "passi · all’avvio"
                : draft.phases.init.length === 1
                  ? "step · at startup"
                  : "steps · at startup"}
            </small>
          </span>
        </button>
        {pane === "init" && stepList(draft.phases.init)}
      </div>
      <section className="sensor-nav-actions-group">
        <div className="sensor-nav-actions-heading">
          <button
            type="button"
            className="sensor-nav-primary"
            aria-expanded={actionsExpanded}
            aria-controls="sensor-actions-list"
            onClick={() => setActionsExpanded((value) => !value)}
          >
            <Blocks size={20} aria-hidden />
            <span>{it ? "Azioni" : "Actions"}</span>
            {actionsExpanded ? (
              <ChevronDown size={16} aria-hidden />
            ) : (
              <ChevronRight size={16} aria-hidden />
            )}
          </button>
          <button
            type="button"
            aria-label={it ? "Aggiungi azione" : "Add action"}
            onClick={() => {
              const next = addCommand(draft, {
                label: `${it ? "Azione" : "Action"} ${draft.commands.length + 1}`,
                exposeOnCanvas: true,
              });
              setActionsExpanded(true);
              onChange(next);
              onSelectAction(next.commands.at(-1)!.id);
            }}
          >
            <Plus size={17} />
          </button>
        </div>
        <div
          id="sensor-actions-list"
          className="sensor-nav-actions"
          hidden={!actionsExpanded}
        >
          {draft.commands.map((action) => {
            const active = pane === "actions" && activeId === action.id;
            return (
              <div key={action.id}>
                <div className={`sensor-nav-action-row ${active ? "is-selected" : ""}`}>
                  {renamingActionId === action.id ? (
                    <input
                      autoFocus
                      className="sensor-nav-action-rename"
                      aria-label={it ? "Nome azione nel menu" : "Action name in menu"}
                      value={action.label}
                      onFocus={(event) => event.currentTarget.select()}
                      onChange={(event) =>
                        onChange(
                          updateCommand(draft, action.id, {
                            ...action,
                            label: event.target.value,
                          }),
                        )
                      }
                      onBlur={() => setRenamingActionId(null)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === "Escape")
                          event.currentTarget.blur();
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      className="sensor-nav-action"
                      aria-pressed={active}
                      onClick={() => onSelectAction(action.id)}
                    >
                      {active ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      <span>
                        <strong>{action.label || action.name}</strong>
                        <small>
                          {action.steps.length}{" "}
                          {it
                            ? action.steps.length === 1
                              ? "passo"
                              : "passi"
                            : action.steps.length === 1
                              ? "step"
                              : "steps"}
                        </small>
                      </span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="sensor-nav-rename-action"
                    aria-label={
                      it
                        ? `Rinomina ${action.label || action.name}`
                        : `Rename ${action.label || action.name}`
                    }
                    onClick={() => {
                      onSelectAction(action.id);
                      setRenamingActionId(action.id);
                    }}
                  >
                    <Pencil size={13} aria-hidden />
                  </button>
                  <button
                    type="button"
                    className="sensor-nav-delete-action"
                    aria-label={
                      it
                        ? `Elimina azione ${action.label || action.name}`
                        : `Delete action ${action.label || action.name}`
                    }
                    title={it ? "Elimina azione" : "Delete action"}
                    onClick={() => {
                      const next = removeCommand(draft, action.id);
                      onChange(next);
                      if (active && next.commands.length) {
                        const index = draft.commands.findIndex(
                          (item) => item.id === action.id,
                        );
                        onSelectAction(
                          next.commands[Math.min(index, next.commands.length - 1)]!.id,
                        );
                      }
                    }}
                  >
                    <Trash2 size={15} aria-hidden />
                  </button>
                </div>
                {active && stepList(action.steps)}
              </div>
            );
          })}
        </div>
      </section>
      <p className="sensor-nav-help">
        {pane === "connections"
          ? it
            ? "Clicca un terminale nel disegno per configurarlo."
            : "Click a terminal in the drawing to configure it."
          : it
            ? "Seleziona un’azione o un passo per modificarlo."
            : "Select an action or a step to edit it."}
      </p>
    </nav>
  );
}
export function SensorWorkbenchHeading({
  draft,
  it,
  activeId,
  initialization,
  flow,
  onChange,
  onSelectAction,
}: Shared & { initialization: boolean; flow: boolean }) {
  const nameRef = useRef<HTMLInputElement>(null);
  const action = draft.commands.find((item) => item.id === activeId);
  const protocol = draft.binding.bus === "gpio" ? "GPIO" : "I²C";
  return (
    <div className="sensor-workbench-heading">
      <div>
        {flow ? (
          <h1>Input / Output</h1>
        ) : initialization ? (
          <h1>{it ? "Inizializzazione" : "Initialization"}</h1>
        ) : action ? (
          <div className="sensor-workbench-action-name">
            <input
              ref={nameRef}
              aria-label={it ? "Nome azione" : "Action name"}
              value={action.label}
              onChange={(event) =>
                onChange(
                  updateCommand(draft, action.id, {
                    ...action,
                    label: event.target.value,
                  }),
                )
              }
            />
            <button
              type="button"
              onClick={() => {
                nameRef.current?.focus();
                nameRef.current?.select();
              }}
              aria-label={it ? "Rinomina azione" : "Rename action"}
            >
              <Pencil size={15} />
            </button>
          </div>
        ) : (
          <h1>{it ? "Azioni" : "Actions"}</h1>
        )}
        <p>
          {flow
            ? it
              ? "Collega i dati del Flow alle variabili del dispositivo"
              : "Connect Flow data to device variables"
            : initialization
              ? it
                ? "Eseguita una volta all’avvio del programma"
                : "Runs once when the program starts"
              : `${action?.steps.length ?? 0} ${
                  it
                    ? action?.steps.length === 1
                      ? `passo ${protocol}`
                      : `passi ${protocol}`
                    : action?.steps.length === 1
                      ? `${protocol} step`
                      : `${protocol} steps`
                }`}
        </p>
      </div>
      {!flow && !initialization && action && (
        <div className="sensor-workbench-action-tools">
          <button
            type="button"
            onClick={() => {
              const next = duplicateDriverAction(draft, action);
              onChange(next);
              onSelectAction(next.commands.at(-1)!.id);
            }}
          >
            <Copy size={16} />
            <span>{it ? "Duplica" : "Duplicate"}</span>
          </button>
          <button
            type="button"
            aria-label={it ? "Rimuovi azione" : "Remove action"}
            onClick={() => {
              const next = removeCommand(draft, action.id);
              onChange(next);
              if (next.commands[0]) onSelectAction(next.commands[0].id);
            }}
          >
            <Trash2 size={17} />
          </button>
        </div>
      )}
    </div>
  );
}
