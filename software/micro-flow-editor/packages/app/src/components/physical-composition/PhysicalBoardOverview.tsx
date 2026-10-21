import { useState, type ReactNode } from "react";
import { PinFunctionEditor } from "./PinFunctionEditor.js";
import { PhysicalWiringDiagram } from "./PhysicalWiringDiagram.js";
import { Cpu, Info, Plus, ScanLine, Users, Cable, Lightbulb } from "lucide-react";
import { useSession } from "../../state/session-context.js";
import { modulePinOwners } from "../../lib/module-pin-ownership.js";
import {
  derivePortInterfaces,
  formatPinLabel,
  functionPinGrid,
  functionVariantOf,
  modeIndexToPinId,
  pinIdToModeIndex,
  interfaceDisplayName,
  type BackbonePhysicalDraft,
} from "../../lib/backbone-physical.js";

/** Connector overview and manual signal editing share one screen and one draft. */
export function PhysicalBoardOverview({
  draft,
  readOnly = false,
  bindingId,
  boardKey,
  it,
  capabilities,
  disabled,
  driverAssignments,
  onChange,
  onPendingChange,
}: {
  readonly readOnly?: boolean;
  readonly draft: BackbonePhysicalDraft;
  readonly bindingId: string;
  readonly boardKey: string;
  readonly it: boolean;
  readonly capabilities: number;
  readonly disabled: boolean;
  readonly driverAssignments?: ReactNode;
  readonly onChange: (draft: BackbonePhysicalDraft) => void;
  readonly onPendingChange: (pending: boolean) => void;
}) {
  const { session, navigate, setModuleTarget } = useSession();
  const project = session?.stack.current;
  const [selectedPin, setSelectedPin] = useState(0);
  const [showWiring, setShowWiring] = useState(false);
  const variant = functionVariantOf(draft);
  const interfaces = derivePortInterfaces(draft.modes, variant);
  const assigned = modulePinOwners(project, bindingId, boardKey, draft).map(
    ({ module, channels }) => ({
      module,
      signals: Object.entries(channels).map(([id, channel]) => ({
        channel,
        name:
          module.recipe.deviceDraft?.binding.gpioSignals.find(
            (signal) => signal.id === id,
          )?.name ?? id,
      })),
    }),
  );
  const palette = [
    "#0f887e",
    "#7555b8",
    "#bd6b20",
    "#3476cf",
    "#b64674",
    "#45813d",
    "#287d95",
    "#a35134",
  ];
  const colors = new Map<string, string>();
  const used = new Set<string>();
  const visibleInterfaces = interfaces.filter((item) =>
    item.signals.some(
      (signal) =>
        !assigned.some((owner) =>
          owner.signals.some(
            (owned) => owned.channel === pinIdToModeIndex(signal.pin, variant),
          ),
        ),
    ),
  );
  const keys = [
    ...new Set([
      ...assigned.map((item) => item.module.id).sort(),
      ...visibleInterfaces.map((item) => item.id).sort(),
    ]),
  ];
  for (const key of keys) {
    const seed = Array.from(key).reduce(
      (sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0,
      0,
    );
    const available = palette.filter((color) => !used.has(color));
    const color = available.length
      ? available[seed % available.length]!
      : palette[seed % palette.length]!;
    colors.set(key, color);
    used.add(color);
  }
  const colorFor = (key: string) => colors.get(key) ?? palette[0]!;
  const info = it
    ? "I moduli ufficiali SpaghettiLAB vengono rilevati e configurati automaticamente: non sarà necessario il cablaggio manuale. La funzione sarà disponibile prossimamente."
    : "Official SpaghettiLAB modules are detected and configured automatically: no manual wiring will be needed. Coming soon.";
  return (
    <div className="flex shrink-0 flex-col gap-4 rounded-slmd border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-heading text-base font-semibold text-ink">
          {it ? "Pin e moduli" : "Pins and modules"}
        </h2>
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-2 rounded-slpill border border-border-strong px-3 py-2 text-sm text-ink-muted opacity-50"
            >
              <ScanLine size={16} />
              {it ? "Rileva modulo" : "Detect module"}
            </button>
            <span className="group relative">
              <button
                type="button"
                aria-label={
                  it ? "Informazioni sul rilevamento" : "Detection information"
                }
                aria-describedby="module-detection-info"
                className="rounded-full p-2 text-ink-muted"
              >
                <Info size={17} />
              </button>
              <span
                id="module-detection-info"
                role="tooltip"
                className="pointer-events-none absolute right-0 top-full z-50 hidden w-64 rounded-slmd border border-border bg-surface p-3 text-xs leading-relaxed text-ink shadow-e2 group-hover:block group-focus-within:block"
              >
                {info}
              </span>
            </span>
            <button
              type="button"
              onClick={() => {
                setModuleTarget({
                  bindingId,
                  deviceIdHex: boardKey.slice(bindingId.length + 1),
                });
                navigate("modules");
              }}
              className="inline-flex items-center gap-2 rounded-slpill bg-brand-blue px-4 py-2 text-sm font-semibold text-white"
            >
              <Plus size={16} />
              {it ? "Aggiungi modulo" : "Add module"}
            </button>
          </div>
        )}
      </div>
      <div
        className={`grid items-start gap-5 ${readOnly ? "" : "lg:grid-cols-[minmax(0,1fr)_240px]"}`}
      >
        <div className="min-w-0 space-y-4">
          <section className="min-w-0 rounded-slmd border border-border bg-surface-sunken/40 p-3">
            <div className="grid grid-cols-3 gap-2 xl:grid-cols-6">
              {functionPinGrid(draft.modes, variant)
                .flat()
                .map((cell, index) => {
                  const channel = cell.modeIndex;
                  const ownerIndex = assigned.findIndex((item) =>
                    item.signals.some((signal) => signal.channel === channel),
                  );
                  const owner = assigned[ownerIndex];
                  const signal = owner?.signals.find(
                    (item) => item.channel === channel,
                  );
                  const peripheral =
                    channel === undefined
                      ? undefined
                      : interfaces.find((item) =>
                          item.signals.some(
                            (s) => pinIdToModeIndex(s.pin, variant) === channel,
                          ),
                        );
                  const accent = owner
                    ? colorFor(owner.module.id)
                    : peripheral
                      ? colorFor(peripheral.id)
                      : undefined;
                  const pin =
                    channel === undefined
                      ? cell.label
                      : formatPinLabel(modeIndexToPinId(channel, variant), variant);
                  return (
                    <button
                      type="button"
                      key={index}
                      disabled={readOnly || channel === undefined}
                      aria-pressed={
                        readOnly || channel === undefined
                          ? undefined
                          : channel === selectedPin
                      }
                      aria-label={`${pin}: ${owner?.module.label ?? peripheral?.signals.find((s) => pinIdToModeIndex(s.pin, variant) === channel)?.label ?? (channel === undefined ? "Fisso" : "Libero")}`}
                      onClick={() => {
                        if (channel !== undefined) {
                          setSelectedPin(channel);
                          onPendingChange(false);
                        }
                      }}
                      className={`group min-w-0 rounded-xl border px-3 py-2.5 text-left transition-[border-color,box-shadow,background-color] hover:shadow-sm disabled:cursor-default disabled:hover:shadow-none ${!readOnly && channel === selectedPin ? "ring-2 ring-brand-blue ring-offset-2 ring-offset-surface" : ""}`}
                      style={
                        accent
                          ? {
                              borderColor: `color-mix(in srgb, ${accent} 30%, var(--color-border))`,
                              boxShadow: `inset 0 3px 0 ${accent}`,
                              backgroundColor: `color-mix(in srgb, ${accent} 9%, var(--color-surface))`,
                            }
                          : {
                              borderColor: "var(--color-border)",
                              backgroundColor: "var(--color-surface)",
                            }
                      }
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-mono text-xs font-semibold text-ink">
                          {pin}
                        </p>
                        <span
                          aria-hidden="true"
                          className="h-3 w-3 shrink-0 rounded-[3px] border"
                          style={{
                            borderColor: accent ?? "var(--color-border-strong)",
                            backgroundColor:
                              accent ??
                              (channel === undefined
                                ? "var(--color-ink-faint)"
                                : "transparent"),
                            boxShadow: accent
                              ? `0 0 0 3px color-mix(in srgb, ${accent} 12%, transparent)`
                              : undefined,
                          }}
                        />
                      </div>
                      <p className="mt-2 break-words text-xs font-semibold leading-snug text-ink">
                        {owner?.module.label ??
                          (peripheral
                            ? interfaceDisplayName(
                                peripheral,
                                draft.busUnits,
                                draft.w1Config,
                              )
                            : channel === undefined
                              ? cell.label === "GND"
                                ? it
                                  ? "Massa"
                                  : "Ground"
                                : it
                                  ? "Alimentazione"
                                  : "Power"
                              : it
                                ? "Libero"
                                : "Free")}
                      </p>
                      <p className="mt-1 break-words text-[11px] leading-snug text-ink-muted">
                        {signal?.name ??
                          peripheral?.signals.find(
                            (s) => pinIdToModeIndex(s.pin, variant) === channel,
                          )?.label ??
                          (channel === undefined ? (it ? "Fisso" : "Fixed") : "—")}
                      </p>
                    </button>
                  );
                })}
            </div>
            {!readOnly && (
              <p className="mt-3 text-xs text-ink-muted">
                {it
                  ? "Seleziona un pin per assegnargli una funzione. Alimentazione e GND sono fissi."
                  : "Select a pin to assign its function. Power and GND are fixed."}
              </p>
            )}
          </section>
          <section>
            <div className="mb-3 flex items-center gap-2 rounded-slmd bg-surface-sunken/60 px-3 py-2">
              <Lightbulb size={18} className="text-ink-muted" />
              <div>
                <p className="text-sm font-semibold text-ink">
                  {it ? "LED interno" : "Internal LED"}
                </p>
                <p className="text-xs text-ink-muted">
                  {it
                    ? "Integrato · nessun cablaggio esterno"
                    : "Built-in · no external wiring"}
                </p>
              </div>
            </div>
            <h3 className="mb-2 text-sm font-semibold text-ink">
              {it
                ? "Moduli assegnati a questa Backbone"
                : "Modules assigned to this Backbone"}
            </h3>
            {assigned.length === 0 ? (
              <p className="text-xs text-ink-muted">
                {it ? "Nessun modulo assegnato." : "No modules assigned."}
              </p>
            ) : (
              assigned.map((item) => (
                <div
                  key={item.module.id}
                  className="flex flex-wrap items-center gap-3 rounded-slmd border border-border px-3 py-2"
                  style={{ borderLeft: `3px solid ${colorFor(item.module.id)}` }}
                >
                  <Cpu size={18} style={{ color: colorFor(item.module.id) }} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink">
                      {item.module.label}
                    </p>
                    <p className="break-words text-xs text-ink-muted">
                      {item.signals
                        .map(
                          (s) =>
                            `${s.name}: ${formatPinLabel(modeIndexToPinId(s.channel, variant), variant)}`,
                        )
                        .join(" · ")}
                    </p>
                  </div>
                  {!readOnly && (
                    <button
                      type="button"
                      onClick={() => setShowWiring((open) => !open)}
                      className="inline-flex items-center gap-1 text-xs text-brand-blue"
                    >
                      <Cable size={14} />
                      {it ? "Collegamenti" : "Connections"}
                    </button>
                  )}
                </div>
              ))
            )}
          </section>
          {!readOnly && (
            <aside className="flex items-start gap-2 border-t border-border pt-3 text-ink-muted">
              <Users size={19} className="shrink-0 text-brand-blue" />
              <div>
                <h3 className="text-sm font-semibold text-ink">
                  {it
                    ? "Il prossimo modulo ufficiale potrebbe essere il tuo."
                    : "The next official module could be yours."}
                </h3>
                <p className="mt-1 text-xs">
                  {it
                    ? "Realizza un modulo e mostralo alla community. I più votati diventeranno moduli ufficiali SpaghettiLAB."
                    : "Build a module and share it with the community. The most voted will become official SpaghettiLAB modules."}
                </p>
              </div>
            </aside>
          )}
        </div>
        {!readOnly && (
          <PinFunctionEditor
            key={selectedPin}
            draft={draft}
            index={selectedPin}
            owner={
              assigned.find((item) =>
                item.signals.some((signal) => signal.channel === selectedPin),
              )?.module.label
            }
            capabilities={capabilities}
            disabled={disabled}
            it={it}
            onChange={onChange}
            onPendingChange={onPendingChange}
          />
        )}
      </div>
      {showWiring && (
        <section className="min-w-0 border-t border-border pt-4">
          <h3 className="mb-3 text-sm font-semibold text-ink">
            {it ? "Collegamenti dei moduli" : "Module connections"}
          </h3>
          <PhysicalWiringDiagram
            modes={draft.modes}
            variant={variant}
            bindingId={bindingId}
            boardKey={boardKey}
            disabled
            pendingSignal={null}
            signals={[]}
            it={it}
            onAssign={() => {}}
            onClear={() => {}}
          />
          {driverAssignments}
        </section>
      )}
    </div>
  );
}
