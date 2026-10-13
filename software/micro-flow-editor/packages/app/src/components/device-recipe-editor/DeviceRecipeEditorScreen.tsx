import {
  ArrowDown,
  ArrowUp,
  Check,
  CircuitBoard,
  Cpu,
  Play,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  createAnalogLevelExample,
  createBlankDraft,
  createGpioDigitalExample,
  describeDeviceOp,
  hasValidAnalogAcquisition,
  insertOp,
  isAnalogCalibrationComplete,
  libraryOpsForBus,
  moveOp,
  multiSampleSpanMs,
  removeOp,
  updateOp,
  validateDraftForCreate,
  type DeviceRecipeBus,
  type DeviceRecipeDraft,
  type DeviceRecipeMode,
  type DeviceRecipeOp,
  type DeviceRecipePhase,
  type GpioSignalDef,
} from "../../lib/device-recipe-draft.js";
import { useLocale } from "../../state/locale-context.js";
import { useSession } from "../../state/session-context.js";
import { DerivedSignalView } from "./DerivedSignalView.js";
import { DisplayCenter, DisplayInspector, DisplayLeftSidebar } from "./DisplayRecipePanels.js";

type Props = {
  readonly initialDraft?: DeviceRecipeDraft;
  readonly onCancel?: () => void;
  readonly onSaveDraft?: (draft: DeviceRecipeDraft) => void;
  readonly onCreate?: (draft: DeviceRecipeDraft) => void;
};

/**
 * Full-screen device recipe editor (I2C / SPI / GPIO / ADC) — shared left/center/right layout.
 */
export function DeviceRecipeEditorScreen({ initialDraft, onCancel, onSaveDraft, onCreate }: Props) {
  const { locale } = useLocale();
  const it = locale === "it";
  const { navigate } = useSession();
  const [draft, setDraft] = useState<DeviceRecipeDraft>(() => initialDraft ?? createBlankDraft("i2c"));
  const [phase, setPhase] = useState<DeviceRecipePhase>(
    () => (initialDraft?.category === "display" ? "command" : "sample"),
  );
  const [selectedOpId, setSelectedOpId] = useState<string | null>(draft.phases.sample[0]?.id ?? null);
  const [selectedCommandId, setSelectedCommandId] = useState<string | null>(draft.commands[0]?.id ?? null);
  const [selectedCommandStepId, setSelectedCommandStepId] = useState<string | null>(
    draft.commands[0]?.steps[0]?.id ?? null,
  );
  const [fieldErrors, setFieldErrors] = useState<readonly { field: string; message: string }[]>([]);
  const [tryMessage, setTryMessage] = useState<string | null>(null);

  const isDisplay = draft.category === "display";
  const ops = draft.phases[phase];
  const selected = ops.find((op) => op.id === selectedOpId) ?? null;
  const library = libraryOpsForBus(draft.binding.bus);
  const calibOk = isAnalogCalibrationComplete(draft);
  const createBlocked = validateDraftForCreate(draft).length > 0;

  const phaseTabs: { id: DeviceRecipePhase; label: string }[] = [
    { id: "init", label: it ? "Avvio" : "Init" },
    { id: "sample", label: it ? "Lettura" : "Sample" },
    { id: "command", label: it ? "Comando" : "Command" },
  ];

  function switchMode(mode: DeviceRecipeMode) {
    const next = createBlankDraft(mode, draft.name);
    setDraft({ ...next, name: draft.name || next.name });
    setPhase(mode === "display" ? "command" : "sample");
    setSelectedOpId(next.phases.sample[0]?.id ?? next.phases.init[0]?.id ?? null);
    setSelectedCommandId(next.commands[0]?.id ?? null);
    setSelectedCommandStepId(next.commands[0]?.steps[0]?.id ?? null);
    setFieldErrors([]);
    setTryMessage(null);
  }

  function patchSelected(next: DeviceRecipeOp) {
    if (!selected) return;
    setDraft(updateOp(draft, phase, selected.id, next));
  }

  function handleTry() {
    if (isDisplay) {
      setTryMessage(
        it
          ? "Prova comando non disponibile: runtime display non collegato. Usa Simula per anteprima locale (dichiarata)."
          : "Command test unavailable: display runtime not connected. Use Simulate for local preview (declared).",
      );
      setDraft({
        ...draft,
        verification: {
          status: "unavailable",
          note: it ? "Prova HW indisponibile · simulazione locale separata" : "HW test unavailable · local simulation separate",
        },
      });
      return;
    }
    if (draft.binding.bus === "adc" && hasValidAnalogAcquisition(draft) && !calibOk) {
      setTryMessage(
        it
          ? "Acquisizione grezza: prova non disponibile senza runtime. Canale calibrato (%) non disponibile finché min/max non sono impostati."
          : "Raw acquisition: test unavailable without runtime. Calibrated channel (%) unavailable until min/max are set.",
      );
      setDraft({
        ...draft,
        verification: {
          status: "unavailable",
          note: it ? "Grezzo ok in bozza · calibrato bloccato" : "Raw ok in draft · calibrated blocked",
        },
      });
      return;
    }
    setTryMessage(
      it
        ? "Prova lettura non disponibile: runtime dispositivo non collegato (nessun successo simulato)."
        : "Test read unavailable: device runtime not connected (no fake success).",
    );
    setDraft({
      ...draft,
      verification: { status: "unavailable", note: it ? "Prova indisponibile senza hardware" : "Test unavailable without hardware" },
    });
  }

  function handleSaveDraft() {
    const next = { ...draft, status: "draft" as const, updatedAt: Date.now() };
    setDraft(next);
    onSaveDraft?.(next);
    setFieldErrors([]);
  }

  function handleCreate() {
    const errors = validateDraftForCreate(draft);
    setFieldErrors(errors);
    if (errors.length) return;
    const next = { ...draft, status: "ready" as const, updatedAt: Date.now() };
    setDraft(next);
    onCreate?.(next);
  }

  function handleCancel() {
    if (onCancel) onCancel();
    else navigate("processing-graph");
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-sunken">
      {/* Top: Cablaggio / Dispositivi / Flow */}
      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border bg-surface px-3">
        <span className="mr-3 font-heading text-sm font-semibold text-ink">Hardware Flow</span>
        <NavChip active={false} label={it ? "Cablaggio" : "Wiring"} onClick={() => navigate("physical-composition")} />
        <NavChip active label={it ? "Dispositivi" : "Devices"} />
        <NavChip active={false} label="Flow" onClick={() => navigate("processing-graph")} />
        <div className="ml-auto flex items-center gap-1.5">
          {(["i2c", "spi", "gpio", "adc", "display"] as const).map((mode) => {
            const active = mode === "display" ? isDisplay : !isDisplay && draft.binding.bus === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() => switchMode(mode)}
                className={`rounded-slpill px-2.5 py-1 font-mono text-[10px] font-bold uppercase ${
                  active ? "bg-brand-blue text-white" : "bg-surface-sunken text-ink-muted hover:text-ink"
                }`}
              >
                {mode === "adc" ? (it ? "analog" : "adc") : mode}
              </button>
            );
          })}
        </div>
      </div>

      <header className="flex shrink-0 items-center gap-3 border-b border-border bg-surface px-4 py-2.5">
        <CircuitBoard size={18} className="text-brand-blue" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="font-heading text-sm font-semibold text-ink">{it ? "Editor ricetta" : "Recipe editor"}</h1>
            <span className="rounded-slpill bg-warning/20 px-2 py-0.5 font-body text-[10px] font-semibold text-ink">
              {draft.status === "draft" ? (it ? "Bozza" : "Draft") : it ? "Pronta" : "Ready"}
            </span>
          </div>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="mt-0.5 w-full max-w-md border-0 bg-transparent font-heading text-lg font-semibold text-ink outline-none focus:underline"
          />
          <p className="mt-0.5 font-body text-[11px] text-ink-faint">
            {isDisplay
              ? it
                ? "Definisci comandi tipizzati. Esponi l'interfaccia al Flow."
                : "Define typed commands. Expose the interface to Flow."
              : it
                ? "Disegna il protocollo. Esponi le grandezze al Flow."
                : "Draw the protocol. Expose quantities to Flow."}
          </p>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 xl:grid-cols-[272px_minmax(0,1fr)_300px]">
        {/* LEFT */}
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-r border-border bg-surface p-3">
          {isDisplay && draft.display ? (
            <DisplayLeftSidebar
              draft={draft}
              it={it}
              onChange={setDraft}
              selectedCommandId={selectedCommandId}
              onSelectCommand={(id) => {
                setSelectedCommandId(id);
                const c = draft.commands.find((x) => x.id === id);
                setSelectedCommandStepId(c?.steps[0]?.id ?? null);
              }}
              selectedStepId={selectedCommandStepId}
              onSelectStep={setSelectedCommandStepId}
            />
          ) : (
            <>
          <section className="rounded-slmd border border-border-strong p-3">
            <h2 className="mb-2 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
              {it ? "Connessioni" : "Connections"}
            </h2>
            <BindingPanel draft={draft} it={it} onChange={setDraft} />
          </section>
          <section className="rounded-slmd border border-border-strong p-3">
            <h2 className="mb-2 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
              {it ? "Libreria operazioni" : "Operations library"}
            </h2>
            <LibraryList
              library={library}
              bus={draft.binding.bus}
              it={it}
              onAdd={(type) => {
                const next = insertOp(draft, phase, type);
                setDraft(next);
                const added = next.phases[phase][next.phases[phase].length - 1];
                setSelectedOpId(added?.id ?? null);
              }}
            />
            {draft.binding.bus === "gpio" ? (
              <div className="mt-3">
                <p className="mb-1 font-body text-[10px] font-semibold text-ink-muted">{it ? "Modelli" : "Templates"}</p>
                <button
                  type="button"
                  onClick={() => {
                    const next = createGpioDigitalExample(draft.name);
                    setDraft(next);
                    setSelectedOpId(next.phases.sample[0]?.id ?? null);
                  }}
                  className="w-full rounded-slsm border border-border-strong px-2 py-1.5 font-body text-[11px] hover:border-brand-blue"
                >
                  {it ? "Ingresso digitale" : "Digital input"}
                </button>
              </div>
            ) : null}
            {draft.binding.bus === "adc" ? (
              <div className="mt-3">
                <p className="mb-1 font-body text-[10px] font-semibold text-ink-muted">{it ? "Modelli" : "Templates"}</p>
                <button
                  type="button"
                  onClick={() => {
                    const next = createAnalogLevelExample(draft.name);
                    setDraft(next);
                    setSelectedOpId(next.phases.sample[0]?.id ?? null);
                  }}
                  className="w-full rounded-slsm border border-border-strong px-2 py-1.5 font-body text-[11px] hover:border-brand-blue"
                >
                  {it ? "Livello analogico" : "Analog level"}
                </button>
              </div>
            ) : null}
          </section>
            </>
          )}
        </aside>

        {/* CENTER */}
        <main className="flex min-h-0 flex-col overflow-y-auto p-4">
          {isDisplay && draft.display ? (
            <DisplayCenter
              draft={draft}
              it={it}
              onChange={setDraft}
              selectedCommandId={selectedCommandId}
              onSelectCommand={(id) => {
                setSelectedCommandId(id);
                const c = draft.commands.find((x) => x.id === id);
                setSelectedCommandStepId(c?.steps[0]?.id ?? null);
              }}
              selectedStepId={selectedCommandStepId}
              onSelectStep={setSelectedCommandStepId}
            />
          ) : (
            <>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-slpill border border-border-strong bg-surface p-0.5">
              {phaseTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setPhase(tab.id);
                    setSelectedOpId(draft.phases[tab.id][0]?.id ?? null);
                  }}
                  className={`rounded-slpill px-3 py-1 font-body text-xs font-semibold ${
                    phase === tab.id ? "bg-brand-blue text-white" : "text-ink-muted"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {phase === "sample" ? (
              <label className="ml-auto flex items-center gap-2 font-body text-xs text-ink-muted">
                {it ? "Intervallo di lettura" : "Sample interval"}
                <input
                  type="number"
                  min={1}
                  value={draft.sampleIntervalMs}
                  onChange={(e) => setDraft({ ...draft, sampleIntervalMs: Math.max(1, Number(e.target.value) || 1) })}
                  className="w-20 rounded-slsm border border-border-strong px-2 py-1 font-mono text-xs"
                />
                ms
              </label>
            ) : null}
          </div>

          <section className="mb-4 rounded-slmd border border-border-strong bg-surface p-3">
            <h2 className="mb-2 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
              {it ? `Sequenza ${draft.binding.bus.toUpperCase()}` : `${draft.binding.bus.toUpperCase()} sequence`}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5">
              {ops.length === 0 ? (
                <p className="font-body text-xs text-ink-faint">{it ? "Nessun passo — aggiungi dalla libreria." : "No steps — add from the library."}</p>
              ) : (
                ops.map((op, index) => (
                  <div key={op.id} className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setSelectedOpId(op.id)}
                      className={`rounded-slsm border px-2.5 py-2 text-left ${
                        selectedOpId === op.id
                          ? "border-brand-blue bg-brand-blue/10 ring-2 ring-brand-blue/25"
                          : "border-border-strong bg-surface-sunken hover:border-brand-blue/40"
                      }`}
                    >
                      <span className="block font-mono text-[9px] text-ink-faint">{index + 1}</span>
                      <span className="block font-body text-xs font-semibold text-ink">{describeDeviceOp(op)}</span>
                    </button>
                    {index < ops.length - 1 ? <span className="text-ink-faint">→</span> : null}
                  </div>
                ))
              )}
            </div>
          </section>

          {draft.binding.bus === "adc" && phase === "sample" ? (
            <AnalogSamplingSummary draft={draft} it={it} />
          ) : null}

          <DerivedSignalView draft={draft} phase={phase} it={it} />

          <section className="mt-4 rounded-slmd border border-border-strong bg-surface p-3">
            <h2 className="mb-2 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
              {it ? "Trasformazione e uscita" : "Transform & output"}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              {ops
                .filter(
                  (op) =>
                    op.type === "decode" ||
                    op.type === "emit" ||
                    op.type === "gpio_debounce" ||
                    op.type === "average" ||
                    op.type === "filter" ||
                    op.type === "map_range",
                )
                .map((op) => (
                  <span key={op.id} className="rounded-slpill bg-surface-sunken px-2.5 py-1 font-body text-[11px] text-ink">
                    {describeDeviceOp(op)}
                  </span>
                ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="font-body text-[10px] font-semibold uppercase text-ink-faint">
                {it ? "Canali esposti" : "Exposed channels"}
              </span>
              {draft.channels.map((ch) => (
                <span key={ch.id} className="rounded-slpill bg-brand-blue/10 px-2.5 py-1 font-body text-[11px] text-brand-blue">
                  {ch.label} · {ch.unit} · {ch.direction === "read" ? (it ? "lettura" : "read") : it ? "scrittura" : "write"}
                </span>
              ))}
            </div>
          </section>

            </>
          )}

          {fieldErrors.length > 0 ? (
            <ul className="mt-3 rounded-slmd border border-error/40 bg-error/5 px-3 py-2 font-body text-xs text-error">
              {fieldErrors.map((err) => (
                <li key={err.field}>
                  {err.field}: {err.message}
                </li>
              ))}
            </ul>
          ) : null}
          {tryMessage ? (
            <p className="mt-3 rounded-slmd border border-border-strong bg-surface px-3 py-2 font-body text-xs text-ink-muted">{tryMessage}</p>
          ) : null}
        </main>

        {/* RIGHT */}
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto border-l border-border bg-surface p-3">
          {isDisplay && draft.display ? (
            <DisplayInspector
              draft={draft}
              it={it}
              onChange={setDraft}
              selectedCommandId={selectedCommandId}
              onSelectCommand={setSelectedCommandId}
              selectedStepId={selectedCommandStepId}
              onSelectStep={setSelectedCommandStepId}
              createBlocked={createBlocked}
            />
          ) : (
            <>
          <section className="rounded-slmd border border-border-strong p-3">
            <h2 className="mb-2 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
              {it ? "Passo selezionato" : "Selected step"}
            </h2>
            {selected ? (
              <StepInspector
                op={selected}
                draft={draft}
                it={it}
                onChange={patchSelected}
                onRemove={() => {
                  setDraft(removeOp(draft, phase, selected.id));
                  setSelectedOpId(null);
                }}
                onMove={(dir) => setDraft(moveOp(draft, phase, selected.id, dir))}
              />
            ) : (
              <p className="font-body text-xs text-ink-faint">{it ? "Seleziona un passo nella sequenza." : "Select a step in the sequence."}</p>
            )}
          </section>

          {draft.binding.bus === "adc" && draft.binding.adc ? (
            <section className="rounded-slmd border border-border-strong p-3">
              <h2 className="mb-2 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
                {it ? "Calibrazione" : "Calibration"}
              </h2>
              <div className="space-y-2">
                <Field label={it ? "Minimo (mV)" : "Minimum (mV)"}>
                  <input
                    type="number"
                    placeholder={it ? "Da impostare" : "Unset"}
                    value={draft.binding.adc.calibMinMv ?? ""}
                    onChange={(e) => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      const adc = { ...draft.binding.adc!, calibMinMv: v };
                      const sample = draft.phases.sample.map((op) =>
                        op.type === "map_range" ? { ...op, inMin: v } : op,
                      );
                      setDraft({ ...draft, binding: { ...draft.binding, adc }, phases: { ...draft.phases, sample } });
                    }}
                    className={inputClass}
                  />
                </Field>
                <Field label={it ? "Massimo (mV)" : "Maximum (mV)"}>
                  <input
                    type="number"
                    placeholder={it ? "Da impostare" : "Unset"}
                    value={draft.binding.adc.calibMaxMv ?? ""}
                    onChange={(e) => {
                      const v = e.target.value === "" ? null : Number(e.target.value);
                      const adc = { ...draft.binding.adc!, calibMaxMv: v };
                      const sample = draft.phases.sample.map((op) =>
                        op.type === "map_range" ? { ...op, inMax: v } : op,
                      );
                      setDraft({ ...draft, binding: { ...draft.binding, adc }, phases: { ...draft.phases, sample } });
                    }}
                    className={inputClass}
                  />
                </Field>
                {!calibOk ? (
                  <p className="rounded-slsm bg-warning/15 px-2 py-1.5 font-body text-[11px] text-ink">
                    {it
                      ? "Calibrazione mancante — puoi salvare la bozza; Crea sensore resta bloccato. Canale % non disponibile."
                      : "Calibration missing — draft save ok; Create sensor blocked. % channel unavailable."}
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}

          <section className="rounded-slmd border border-border-strong p-3">
            <h2 className="mb-2 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
              {it ? "Anteprima nel Flow" : "Flow preview"}
            </h2>
            <div className="rounded-slmd border border-border-strong bg-surface-sunken p-3">
              <div className="flex items-center gap-2">
                <Cpu size={16} className="text-brand-blue" />
                <span className="font-body text-sm font-semibold text-ink">{draft.name}</span>
              </div>
              <ul className="mt-2 space-y-1">
                {draft.channels
                  .filter((ch) => ch.direction === "read")
                  .map((ch) => {
                    const calibratedBlocked = draft.binding.bus === "adc" && !calibOk;
                    return (
                      <li
                        key={ch.id}
                        className={`flex items-center justify-end gap-2 font-body text-xs ${
                          calibratedBlocked ? "text-ink-faint line-through" : "text-ink"
                        }`}
                      >
                        {ch.label} · {ch.unit}
                        {calibratedBlocked ? (
                          <span className="font-body text-[9px] no-underline">{it ? "non disponibile" : "unavailable"}</span>
                        ) : null}
                        <span className="h-2.5 w-2.5 rounded-full border-2 border-brand-blue bg-surface" />
                      </li>
                    );
                  })}
              </ul>
              <p className="mt-3 rounded-slsm bg-warning/15 px-2 py-1.5 font-body text-[11px] text-ink-muted">
                {it ? "Stato:" : "Status:"} {draft.verification.note}
              </p>
            </div>
            {draft.runtimeUnavailable.length > 0 ? (
              <p className="mt-2 font-body text-[10px] text-ink-faint">
                {it ? "Runtime non disponibile:" : "Runtime unavailable:"} {draft.runtimeUnavailable.join(", ")}
              </p>
            ) : null}
          </section>
            </>
          )}
        </aside>
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-surface px-4 py-2.5">
        <span className="font-body text-[11px] text-ink-faint">
          {it ? "Ultima modifica:" : "Last edited:"} {new Date(draft.updatedAt).toLocaleString()}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={handleCancel} className="rounded-slpill px-3 py-1.5 font-body text-sm text-ink-muted hover:bg-surface-raised">
            {it ? "Annulla" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={handleTry}
            className="inline-flex items-center gap-1.5 rounded-slpill border border-border-strong px-3 py-1.5 font-body text-sm text-ink hover:border-brand-blue"
          >
            <Play size={14} />
            {isDisplay ? (it ? "Prova comando" : "Test command") : it ? "Prova lettura" : "Test read"}
          </button>
          <button
            type="button"
            onClick={handleSaveDraft}
            className="inline-flex items-center gap-1.5 rounded-slpill border border-border-strong px-3 py-1.5 font-body text-sm text-ink hover:border-brand-blue"
          >
            <Save size={14} />
            {it ? "Salva bozza" : "Save draft"}
          </button>
          <button
            type="button"
            disabled={createBlocked}
            onClick={handleCreate}
            title={
              createBlocked
                ? validateDraftForCreate(draft)
                    .map((e) => e.message)
                    .join("; ") || (it ? "Dati mancanti" : "Missing data")
                : undefined
            }
            className="inline-flex items-center gap-1.5 rounded-slpill bg-brand-blue px-4 py-1.5 font-body-strong text-sm text-white hover:bg-brand-blue-dark disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check size={14} />
            {isDisplay
              ? it
                ? "Crea dispositivo"
                : "Create device"
              : it
                ? "Crea sensore"
                : "Create sensor"}
          </button>
        </div>
      </footer>
    </div>
  );
}

function NavChip({ label, active, onClick }: { label: string; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-slpill px-3 py-1 font-body text-xs font-semibold ${
        active ? "bg-brand-blue/15 text-brand-blue" : "text-ink-muted hover:bg-surface-raised"
      }`}
    >
      {label}
    </button>
  );
}

function BindingPanel({
  draft,
  it,
  onChange,
}: {
  draft: DeviceRecipeDraft;
  it: boolean;
  onChange: (d: DeviceRecipeDraft) => void;
}) {
  if (draft.binding.bus === "adc" && draft.binding.adc) {
    const adc = draft.binding.adc;
    return (
      <div className="space-y-2 font-body text-xs">
        <p className="font-semibold text-ink">{it ? "Tipo: Analogico" : "Type: Analog"}</p>
        <Field label={it ? "Ruolo nel sensore" : "Sensor role"}>
          <input
            value={`${adc.signalName} → ${adc.pinLabel}`}
            onChange={(e) => {
              const parts = e.target.value.split("→").map((s) => s.trim());
              onChange({
                ...draft,
                binding: {
                  ...draft.binding,
                  adc: {
                    ...adc,
                    signalName: parts[0] || "SIGNAL",
                    pinLabel: parts[1] || adc.pinLabel,
                  },
                },
              });
            }}
            className={inputClass}
          />
        </Field>
        <Field label={it ? "Ingresso" : "Input"}>
          <input value="ADC" readOnly className={`${inputClass} opacity-70`} />
        </Field>
        <Field label={it ? "Unità acquisizione" : "Acquisition unit"}>
          <select
            value={adc.displayUnit}
            disabled={!adc.supportsMv}
            onChange={(e) =>
              onChange({
                ...draft,
                binding: { ...draft.binding, adc: { ...adc, displayUnit: e.target.value as "raw" | "mV" } },
              })
            }
            className={inputClass}
          >
            {adc.supportsMv ? <option value="mV">mV</option> : null}
            <option value="raw">{it ? "conteggi grezzi" : "raw counts"}</option>
          </select>
        </Field>
        <p className="rounded-slsm bg-brand-blue/10 px-2 py-1.5 font-body text-[10px] text-ink-muted">
          {it
            ? "Parametri ADC dalla scheda. mV solo se la piattaforma espone la conversione."
            : "ADC parameters come from the board. mV only if the platform exposes conversion."}
        </p>
      </div>
    );
  }

  if (draft.binding.bus === "i2c" && draft.binding.i2c) {
    const i2c = draft.binding.i2c;
    return (
      <div className="space-y-2 font-body text-xs">
        <Field label="SDA">
          <input
            value={i2c.sdaLabel}
            onChange={(e) => onChange({ ...draft, binding: { ...draft.binding, i2c: { ...i2c, sdaLabel: e.target.value } } })}
            className={inputClass}
          />
        </Field>
        <Field label="SCL">
          <input
            value={i2c.sclLabel}
            onChange={(e) => onChange({ ...draft, binding: { ...draft.binding, i2c: { ...i2c, sclLabel: e.target.value } } })}
            className={inputClass}
          />
        </Field>
        <Field label={it ? "Bus" : "Bus"}>
          <input
            value={i2c.busUnit}
            onChange={(e) => onChange({ ...draft, binding: { ...draft.binding, i2c: { ...i2c, busUnit: e.target.value } } })}
            className={inputClass}
          />
        </Field>
        <Field label={it ? "Indirizzo" : "Address"}>
          <input
            value={i2c.address}
            onChange={(e) => onChange({ ...draft, binding: { ...draft.binding, i2c: { ...i2c, address: e.target.value } } })}
            className={inputClass}
          />
        </Field>
      </div>
    );
  }
  if (draft.binding.bus === "spi" && draft.binding.spi) {
    const spi = draft.binding.spi;
    return (
      <div className="space-y-2 font-body text-xs">
        {(
          [
            ["sckLabel", "SCK"],
            ["mosiLabel", "MOSI"],
            ["misoLabel", "MISO"],
            ["csLabel", "CS"],
          ] as const
        ).map(([key, label]) => (
          <Field key={key} label={label}>
            <input
              value={spi[key]}
              onChange={(e) => onChange({ ...draft, binding: { ...draft.binding, spi: { ...spi, [key]: e.target.value } } })}
              className={inputClass}
            />
          </Field>
        ))}
        <Field label={it ? "Modo" : "Mode"}>
          <select
            value={spi.mode}
            onChange={(e) =>
              onChange({
                ...draft,
                binding: { ...draft.binding, spi: { ...spi, mode: Number(e.target.value) as 0 | 1 | 2 | 3 } },
              })
            }
            className={inputClass}
          >
            {[0, 1, 2, 3].map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </Field>
        <Field label={it ? "Frequenza" : "Frequency"}>
          <select
            value={spi.freqHz}
            onChange={(e) => onChange({ ...draft, binding: { ...draft.binding, spi: { ...spi, freqHz: Number(e.target.value) } } })}
            className={inputClass}
          >
            <option value={1_000_000}>1 MHz</option>
            <option value={500_000}>500 kHz</option>
            <option value={100_000}>100 kHz</option>
          </select>
        </Field>
        <label className="flex items-center gap-2 text-ink-muted">
          <input
            type="checkbox"
            checked={spi.misoRequired}
            onChange={(e) => onChange({ ...draft, binding: { ...draft.binding, spi: { ...spi, misoRequired: e.target.checked } } })}
          />
          {it ? "MISO obbligatorio" : "MISO required"}
        </label>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <table className="w-full font-body text-[10px]">
        <thead>
          <tr className="text-left text-ink-faint">
            <th className="pb-1">{it ? "Nome" : "Name"}</th>
            <th className="pb-1">{it ? "Dir" : "Dir"}</th>
            <th className="pb-1">Pin</th>
          </tr>
        </thead>
        <tbody>
          {draft.binding.gpioSignals.map((sig) => (
            <tr key={sig.id} className="text-ink">
              <td className="py-0.5 font-semibold">{sig.name}</td>
              <td>{sig.direction === "in" ? (it ? "ingresso" : "in") : it ? "uscita" : "out"}</td>
              <td className="font-mono">{sig.pinLabel}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button
        type="button"
        onClick={() => {
          const n = draft.binding.gpioSignals.length + 1;
          const sig: GpioSignalDef = {
            id: `SIG_${n}`,
            name: `SIG_${n}`,
            role: "generico",
            direction: "in",
            pinLabel: `GPIO ${17 + n}`,
            pull: "none",
            activeLow: false,
          };
          onChange({ ...draft, binding: { ...draft.binding, gpioSignals: [...draft.binding.gpioSignals, sig] } });
        }}
        className="inline-flex items-center gap-1 rounded-slsm border border-dashed border-border-strong px-2 py-1 font-body text-[11px] text-ink-muted hover:border-brand-blue"
      >
        <Plus size={12} />
        {it ? "Aggiungi segnale" : "Add signal"}
      </button>
    </div>
  );
}

function StepInspector({
  op,
  draft,
  it,
  onChange,
  onRemove,
  onMove,
}: {
  op: DeviceRecipeOp;
  draft: DeviceRecipeDraft;
  it: boolean;
  onChange: (op: DeviceRecipeOp) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1">
        <span className="font-body text-xs font-semibold text-ink">{describeDeviceOp(op)}</span>
        <button type="button" onClick={() => onMove(-1)} className="ml-auto rounded-slsm border border-border p-0.5 text-ink-faint">
          <ArrowUp size={12} />
        </button>
        <button type="button" onClick={() => onMove(1)} className="rounded-slsm border border-border p-0.5 text-ink-faint">
          <ArrowDown size={12} />
        </button>
        <button type="button" onClick={onRemove} className="rounded-slsm border border-border p-0.5 text-error">
          <Trash2 size={12} />
        </button>
      </div>

      {op.type === "i2c_write_read" ? (
        <>
          <Field label={it ? "Registro" : "Register"}>
            <input value={op.reg ?? ""} onChange={(e) => onChange({ ...op, reg: e.target.value || undefined })} className={inputClass} />
          </Field>
          <Field label={it ? "Byte da leggere" : "Bytes to read"}>
            <input
              type="number"
              min={1}
              value={op.readLen}
              onChange={(e) => onChange({ ...op, readLen: Math.max(1, Number(e.target.value) || 1) })}
              className={inputClass}
            />
          </Field>
          <label className="flex items-center gap-2 font-body text-[11px] text-ink-muted">
            <input type="checkbox" checked={op.repeatedStart} onChange={(e) => onChange({ ...op, repeatedStart: e.target.checked })} />
            {it ? "Riavvio ripetuto" : "Repeated start"}
          </label>
          <Field label={it ? "Salva in" : "Save to"}>
            <input value={op.into} onChange={(e) => onChange({ ...op, into: e.target.value })} className={inputClass} />
          </Field>
          <Field label="Timeout">
            <input
              type="number"
              value={op.timeoutMs ?? 20}
              onChange={(e) => onChange({ ...op, timeoutMs: Number(e.target.value) || 20 })}
              className={inputClass}
            />
          </Field>
        </>
      ) : null}

      {op.type === "spi_transfer" ? (
        <>
          <Field label={it ? "Byte da inviare" : "TX bytes"}>
            <input
              value={op.txBytes.join(" ")}
              onChange={(e) =>
                onChange({
                  ...op,
                  txBytes: e.target.value.trim().split(/\s+/).filter(Boolean),
                })
              }
              className={inputClass}
            />
          </Field>
          <Field label={it ? "Byte da ricevere" : "RX length"}>
            <input
              type="number"
              min={0}
              value={op.rxLen}
              onChange={(e) => onChange({ ...op, rxLen: Math.max(0, Number(e.target.value) || 0) })}
              className={inputClass}
            />
          </Field>
          <Field label={it ? "Salva in" : "Save to"}>
            <input value={op.into} onChange={(e) => onChange({ ...op, into: e.target.value })} className={inputClass} />
          </Field>
          <label className="flex items-center gap-2 font-body text-[11px] text-ink-muted">
            <input type="checkbox" checked={op.keepCs} onChange={(e) => onChange({ ...op, keepCs: e.target.checked })} />
            {it ? "Mantieni CS attivo" : "Keep CS active"}
          </label>
          <p className="font-body text-[10px] text-ink-faint">{it ? "Invio e ricezione avvengono insieme." : "TX and RX happen together."}</p>
        </>
      ) : null}

      {op.type === "gpio_read" || op.type === "gpio_debounce" ? (
        <>
          <Field label={it ? "Segnale" : "Signal"}>
            <select
              value={op.signalId}
              onChange={(e) => onChange({ ...op, signalId: e.target.value })}
              className={inputClass}
            >
              {draft.binding.gpioSignals.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          {op.type === "gpio_debounce" ? (
            <>
              <Field label={it ? "Campione (ms)" : "Sample (ms)"}>
                <input
                  type="number"
                  value={op.sampleMs}
                  onChange={(e) => onChange({ ...op, sampleMs: Number(e.target.value) || 5 })}
                  className={inputClass}
                />
              </Field>
              <Field label={it ? "Stabilità (ms)" : "Stable (ms)"}>
                <input
                  type="number"
                  value={op.stableMs}
                  onChange={(e) => onChange({ ...op, stableMs: Number(e.target.value) || 20 })}
                  className={inputClass}
                />
              </Field>
            </>
          ) : null}
          <Field label={it ? "Salva in" : "Save to"}>
            <input value={op.into} onChange={(e) => onChange({ ...op, into: e.target.value })} className={inputClass} />
          </Field>
        </>
      ) : null}

      {op.type === "decode" ? (
        <>
          <Field label="Input">
            <input value={op.input} onChange={(e) => onChange({ ...op, input: e.target.value })} className={inputClass} />
          </Field>
          <Field label={it ? "Byte" : "Bytes"}>
            <div className="flex gap-1">
              <input
                type="number"
                value={op.startByte}
                onChange={(e) => onChange({ ...op, startByte: Number(e.target.value) || 0 })}
                className={inputClass}
              />
              <input
                type="number"
                value={op.endByte}
                onChange={(e) => onChange({ ...op, endByte: Number(e.target.value) || 0 })}
                className={inputClass}
              />
            </div>
          </Field>
          <Field label={it ? "Ordine" : "Order"}>
            <select
              value={op.byteOrder}
              onChange={(e) => onChange({ ...op, byteOrder: e.target.value as "be" | "le" })}
              className={inputClass}
            >
              <option value="be">BE</option>
              <option value="le">LE</option>
            </select>
          </Field>
          <Field label="÷">
            <input
              type="number"
              value={op.divide ?? 1}
              onChange={(e) => onChange({ ...op, divide: Number(e.target.value) || 1 })}
              className={inputClass}
            />
          </Field>
        </>
      ) : null}

      {op.type === "emit" ? (
        <>
          <Field label={it ? "Canale" : "Channel"}>
            <select
              value={op.channelId}
              onChange={(e) => onChange({ ...op, channelId: e.target.value })}
              className={inputClass}
            >
              {draft.channels.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="from">
            <input value={op.from} onChange={(e) => onChange({ ...op, from: e.target.value })} className={inputClass} />
          </Field>
        </>
      ) : null}

      {op.type === "wait" ? (
        <Field label="ms">
          <input type="number" value={op.ms} onChange={(e) => onChange({ ...op, ms: Number(e.target.value) || 0 })} className={inputClass} />
        </Field>
      ) : null}

      {op.type === "adc_sample" ? (
        <>
          <Field label={it ? "Ingresso" : "Input"}>
            <input value={draft.binding.adc?.signalName ?? "SIGNAL"} readOnly className={`${inputClass} opacity-70`} />
          </Field>
          <Field label={it ? "Formato" : "Format"}>
            <select
              value={draft.binding.adc?.supportsMv ? op.format : "raw"}
              onChange={(e) => onChange({ ...op, format: e.target.value as "raw" | "mV" })}
              className={inputClass}
              disabled={!draft.binding.adc?.supportsMv}
            >
              {draft.binding.adc?.supportsMv ? <option value="mV">mV</option> : null}
              <option value="raw">raw</option>
            </select>
          </Field>
          <Field label={it ? "Salva in" : "Save to"}>
            <input value={op.into} onChange={(e) => onChange({ ...op, into: e.target.value })} className={inputClass} />
          </Field>
        </>
      ) : null}

      {op.type === "adc_multi_sample" ? (
        <>
          <Field label={it ? "Ingresso" : "Input"}>
            <input value={draft.binding.adc?.signalName ?? "SIGNAL"} readOnly className={`${inputClass} opacity-70`} />
          </Field>
          <Field label={it ? "Numero campioni" : "Sample count"}>
            <input
              type="number"
              min={2}
              value={op.count}
              onChange={(e) => onChange({ ...op, count: Math.max(2, Number(e.target.value) || 2) })}
              className={inputClass}
            />
          </Field>
          <Field label={it ? "Intervallo tra campioni (ms)" : "Gap between samples (ms)"}>
            <input
              type="number"
              min={0}
              value={op.intervalMs}
              onChange={(e) => onChange({ ...op, intervalMs: Math.max(0, Number(e.target.value) || 0) })}
              className={inputClass}
            />
          </Field>
          <p className="font-body text-[10px] text-ink-faint">
            {it
              ? `Tra due campioni adiacenti: ${op.intervalMs} ms · dal 1° all'ultimo: ${multiSampleSpanMs(op.count, op.intervalMs)} ms`
              : `Adjacent gap: ${op.intervalMs} ms · first→last: ${multiSampleSpanMs(op.count, op.intervalMs)} ms`}
          </p>
          <Field label={it ? "Formato" : "Format"}>
            <select
              value={draft.binding.adc?.supportsMv ? op.format : "raw"}
              onChange={(e) => onChange({ ...op, format: e.target.value as "raw" | "mV" })}
              className={inputClass}
              disabled={!draft.binding.adc?.supportsMv}
            >
              {draft.binding.adc?.supportsMv ? <option value="mV">mV</option> : null}
              <option value="raw">raw</option>
            </select>
          </Field>
          <Field label={it ? "Salva in" : "Save to"}>
            <input value={op.into} onChange={(e) => onChange({ ...op, into: e.target.value })} className={inputClass} />
          </Field>
        </>
      ) : null}

      {op.type === "average" ? (
        <>
          <Field label="Input">
            <input value={op.input} onChange={(e) => onChange({ ...op, input: e.target.value })} className={inputClass} />
          </Field>
          <Field label={it ? "Salva in" : "Save to"}>
            <input value={op.into} onChange={(e) => onChange({ ...op, into: e.target.value })} className={inputClass} />
          </Field>
          <p className="font-body text-[10px] text-ink-faint">
            {it ? "Un solo passo Media (anche se riassunto altrove)." : "Single Average step (even if summarized elsewhere)."}
          </p>
        </>
      ) : null}

      {op.type === "filter" ? (
        <>
          <Field label="Input">
            <input value={op.input} onChange={(e) => onChange({ ...op, input: e.target.value })} className={inputClass} />
          </Field>
          <Field label={it ? "Tipo" : "Kind"}>
            <select
              value={op.kind}
              onChange={(e) => onChange({ ...op, kind: e.target.value as "moving_avg" | "median" })}
              className={inputClass}
            >
              <option value="moving_avg">{it ? "Media mobile" : "Moving average"}</option>
              <option value="median">{it ? "Mediana" : "Median"}</option>
            </select>
          </Field>
          <Field label={it ? "Finestra" : "Window"}>
            <input
              type="number"
              min={2}
              value={op.window}
              onChange={(e) => onChange({ ...op, window: Math.max(2, Number(e.target.value) || 2) })}
              className={inputClass}
            />
          </Field>
          <Field label={it ? "Salva in" : "Save to"}>
            <input value={op.into} onChange={(e) => onChange({ ...op, into: e.target.value })} className={inputClass} />
          </Field>
        </>
      ) : null}

      {op.type === "map_range" ? (
        <>
          <Field label="Input">
            <input value={op.input} onChange={(e) => onChange({ ...op, input: e.target.value })} className={inputClass} />
          </Field>
          <Field label={it ? "Out min/max" : "Out min/max"}>
            <div className="flex gap-1">
              <input
                type="number"
                value={op.outMin}
                onChange={(e) => onChange({ ...op, outMin: Number(e.target.value) || 0 })}
                className={inputClass}
              />
              <input
                type="number"
                value={op.outMax}
                onChange={(e) => onChange({ ...op, outMax: Number(e.target.value) || 0 })}
                className={inputClass}
              />
            </div>
          </Field>
          <p className="font-body text-[10px] text-ink-faint">
            {it
              ? "In min/max dalla calibrazione (intervallo invertito ammesso; valori uguali invalidi)."
              : "In min/max from calibration (inverted range allowed; equal values invalid)."}
          </p>
          <label className="flex items-center gap-2 font-body text-[11px] text-ink-muted">
            <input type="checkbox" checked={op.saturate} onChange={(e) => onChange({ ...op, saturate: e.target.checked })} />
            {it ? "Saturazione esplicita fuori range" : "Explicit saturation outside range"}
          </label>
          <Field label={it ? "Salva in" : "Save to"}>
            <input value={op.into} onChange={(e) => onChange({ ...op, into: e.target.value })} className={inputClass} />
          </Field>
        </>
      ) : null}

      {op.type === "spi_cs" ? (
        <label className="flex items-center gap-2 font-body text-[11px] text-ink-muted">
          <input type="checkbox" checked={op.assert} onChange={(e) => onChange({ ...op, assert: e.target.checked })} />
          {it ? "CS basso (assert)" : "Assert CS (low)"}
        </label>
      ) : null}
    </div>
  );
}

const inputClass =
  "w-full rounded-slsm border border-border-strong bg-surface px-1.5 py-1 font-mono text-xs outline-none focus:border-brand-blue";

function LibraryList({
  library,
  bus,
  it,
  onAdd,
}: {
  library: ReturnType<typeof libraryOpsForBus>;
  bus: DeviceRecipeBus;
  it: boolean;
  onAdd: (type: DeviceRecipeOp["type"]) => void;
}) {
  const groups =
    bus === "adc"
      ? [
          {
            title: it ? "Analogico" : "Analog",
            types: ["adc_sample", "adc_multi_sample"] as const,
          },
          {
            title: it ? "Dati" : "Data",
            types: ["average", "filter", "map_range", "emit", "wait"] as const,
          },
        ]
      : [{ title: null as string | null, types: library.map((i) => i.type) }];

  return (
    <div className="flex flex-col gap-2">
      {groups.map((group) => {
        const items = library.filter((item) => (group.types as readonly string[]).includes(item.type));
        if (items.length === 0) return null;
        return (
          <div key={group.title ?? "all"}>
            {group.title ? (
              <p className="mb-1 font-body text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{group.title}</p>
            ) : null}
            <ul className="flex flex-col gap-1">
              {items.map((item) => (
                <li key={item.type}>
                  <button
                    type="button"
                    onClick={() => onAdd(item.type)}
                    className="flex w-full items-center gap-2 rounded-slsm border border-border px-2 py-1.5 text-left font-body text-xs hover:border-brand-blue hover:bg-brand-blue/5"
                  >
                    <Plus size={12} className="text-brand-blue" />
                    {item.label}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

/** Summary of acquire → average (average remains a single sequence step). */
function AnalogSamplingSummary({ draft, it }: { readonly draft: DeviceRecipeDraft; readonly it: boolean }) {
  const multi = draft.phases.sample.find((op) => op.type === "adc_multi_sample");
  const single = draft.phases.sample.find((op) => op.type === "adc_sample");
  const avg = draft.phases.sample.find((op) => op.type === "average");
  const count = multi?.type === "adc_multi_sample" ? multi.count : 1;
  const intervalMs = multi?.type === "adc_multi_sample" ? multi.intervalMs : 0;
  const into = multi?.type === "adc_multi_sample" ? multi.into : single?.type === "adc_sample" ? single.into : "samples";

  return (
    <section className="mb-4 rounded-slmd border border-border-strong bg-surface p-3">
      <h2 className="mb-2 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
        {it ? "Campionamento analogico" : "Analog sampling"}
      </h2>
      <div className="flex flex-wrap items-center gap-2 font-body text-xs text-ink">
        <span className="rounded-slsm border border-border-strong bg-sky-50 px-2.5 py-2">
          1. {it ? `Acquisisci ${count} campioni` : `Acquire ${count} samples`}
          {multi ? (
            <span className="mt-0.5 block font-mono text-[10px] text-ink-faint">
              {intervalMs} ms {it ? "tra adiacenti" : "adjacent"} · span {multiSampleSpanMs(count, intervalMs)} ms
            </span>
          ) : null}
        </span>
        {avg ? (
          <>
            <span className="text-ink-faint">→</span>
            <span className="rounded-slsm border border-border-strong bg-surface-sunken px-2.5 py-2">
              2. {it ? "Calcola media" : "Compute average"}
              <span className="mt-0.5 block font-mono text-[10px] text-ink-faint">
                {into} → {avg.into}
              </span>
            </span>
          </>
        ) : null}
      </div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block font-body text-[10px] text-ink-muted">
      <span className="mb-0.5 block">{label}</span>
      {children}
    </label>
  );
}
