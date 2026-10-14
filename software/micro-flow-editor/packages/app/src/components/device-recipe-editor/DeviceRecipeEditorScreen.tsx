import {
  ArrowDown,
  ArrowUp,
  Check,
  CircuitBoard,
  Cpu,
  Info,
  Play,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import {
  createAnalogLevelExample,
  createBlankDraft,
  createDs18b20Example,
  createGpioDigitalExample,
  describeDeviceOp,
  ensureWriteChannel,
  hasValidAnalogAcquisition,
  insertOp,
  isAnalogCalibrationComplete,
  isVarRef,
  isVariableUsed,
  libraryOpsForBus,
  moveOp,
  multiSampleSpanMs,
  normalizeRecipeVarName,
  parseVarRef,
  recipeBlockPorts,
  removeOp,
  removeRecipeVariable,
  toVarRef,
  updateOp,
  upsertRecipeVariable,
  validateDraftForCreate,
  writeChannelsOf,
  type DeviceRecipeBus,
  type DeviceRecipeDraft,
  type DeviceRecipeMode,
  type DeviceRecipeOp,
  type DeviceRecipePhase,
  type GpioSignalDef,
  type RecipeVarType,
  type RecipeVariable,
} from "../../lib/device-recipe-draft.js";
import type { SensorOutputKind } from "../../lib/sensor-recipe.js";
import { ActionTriggerFields } from "./ActionTriggerFields.js";
import {
  busUnitLabel,
  draftForBinding,
  functionVariantOf,
  parsePhysicalProject,
  physicalLabelForSignalMode,
  PHYSICAL_META_KEY,
  selectedBusUnit,
  silkPinLabels,
  type BackbonePhysicalDraft,
} from "../../lib/backbone-physical.js";
import { validateOneWireRom } from "../../lib/onewire.js";
import { useLocale } from "../../state/locale-context.js";
import { useSession } from "../../state/session-context.js";
import { buildProtocolTiming, isBusOp, isPostOp } from "../../lib/protocol-timing.js";
import { DerivedSignalView } from "./DerivedSignalView.js";
import { DisplayCenter, DisplayInspector, DisplayLeftSidebar } from "./DisplayRecipePanels.js";
import { ProtocolFrameStrip } from "./ProtocolFrameStrip.js";

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
  const { navigate, session } = useSession();
  const physicalDraft = useMemo(() => {
    const project = parsePhysicalProject(
      session?.stack.current.authoringMetadata[PHYSICAL_META_KEY]?.comment,
    );
    const bindingId = session?.stack.current.coreBindings[0]?.bindingId;
    return draftForBinding(project, bindingId);
  }, [session]);
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
  const [showBlockPreview, setShowBlockPreview] = useState(false);

  const isDisplay = draft.category === "display";
  const ops = draft.phases[phase];
  const selected = ops.find((op) => op.id === selectedOpId) ?? null;
  const library = libraryOpsForBus(draft.binding.bus);
  const calibOk = isAnalogCalibrationComplete(draft);
  const createBlocked = validateDraftForCreate(draft).length > 0;

  const phaseTabs: {
    id: DeviceRecipePhase;
    label: string;
    hint: string;
    blurb: string;
  }[] = [
    {
      id: "init",
      label: it ? "Inizializzazione" : "Initialization",
      hint: it
        ? "Passi eseguiti una sola volta quando il sensore viene avviato / collegato."
        : "Steps run once when the sensor is started / connected.",
      blurb: it
        ? "Qui metti ciò che serve all’accensione: configurare registri, risolvere indirizzi, preparare il dispositivo. Non è un ciclo continuo."
        : "Put power-on setup here: configure registers, resolve addresses, prepare the device. Not a continuous loop.",
    },
    {
      id: "sample",
      label: "Task",
      hint: it
        ? "Compito periodico: gira da solo a intervallo fisso e pubblica i valori sul Flow."
        : "Periodic task: runs on its own at a fixed interval and publishes values to Flow.",
      blurb: it
        ? "È il compito di misura che il runtime esegue in background: ogni intervallo fa questa sequenza (es. scrivi registro → attendi → leggi → decodifica → emetti). Non va invocato a mano dal Flow."
        : "This is the measurement job the runtime runs in the background: each interval runs this sequence (e.g. write register → wait → read → decode → emit). It is not invoked manually from Flow.",
    },
    {
      id: "command",
      label: it ? "Azione" : "Action",
      hint: it
        ? "Azione eseguita quando arriva un trigger esterno."
        : "Action run when an external trigger arrives.",
      blurb: it
        ? "È un’azione che parte con un trigger esterno (non in automatico). Sotto puoi impostare tipo (fronte) e livello del trigger, come sui blocchi del canvas."
        : "An action that starts on an external trigger (not automatically). Below you set trigger type (edge) and level, same as canvas blocks.",
    },
  ];
  const activePhaseTab = phaseTabs.find((tab) => tab.id === phase) ?? phaseTabs[1]!;

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
    if (draft.binding.bus === "w1") {
      setTryMessage(
        it
          ? "Prova 1-Wire non disponibile: adapter runtime assente. Possibili esiti reali (quando collegato): presenza assente, timeout, CRC errato, bus occupato — nessun successo inventato."
          : "1-Wire test unavailable: runtime adapter missing. Real outcomes when connected: no presence, timeout, bad CRC, busy bus — no invented success.",
      );
      setDraft({
        ...draft,
        verification: {
          status: "unavailable",
          note: it ? "Prova 1-Wire indisponibile senza runtime" : "1-Wire test unavailable without runtime",
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

  function handleOpenBlockPreview() {
    const errors = validateDraftForCreate(draft);
    setFieldErrors(errors);
    if (errors.length) {
      setShowBlockPreview(false);
      return;
    }
    setShowBlockPreview(true);
  }

  function handleConfirmCreate() {
    const errors = validateDraftForCreate(draft);
    setFieldErrors(errors);
    if (errors.length) return;
    const next = { ...draft, status: "ready" as const, updatedAt: Date.now() };
    setDraft(next);
    setShowBlockPreview(false);
    onCreate?.(next);
  }

  function handleCancel() {
    if (onCancel) onCancel();
    else navigate("processing-graph");
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-sunken">
      <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-5 py-4">
        <span className="flex h-10 w-10 items-center justify-center rounded-slmd bg-brand-blue/10 text-brand-blue">
          <CircuitBoard size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-heading text-2xl font-bold text-ink">
              {it ? "Dispositivi" : "Devices"}
            </h1>
            <span className="rounded-slpill bg-warning/20 px-2 py-0.5 font-body text-[10px] font-semibold text-ink">
              {draft.status === "draft" ? (it ? "Bozza" : "Draft") : it ? "Pronta" : "Ready"}
            </span>
          </div>
          <p className="mt-1 font-body text-xs text-ink-muted">
            {isDisplay
              ? it
                ? "Definisci comandi tipizzati. Esponi l’interfaccia al Flow."
                : "Define typed commands. Expose the interface to Flow."
              : it
                ? "Disegna il protocollo del sensore. Esponi le grandezze al Flow."
                : "Draw the sensor protocol. Expose quantities to Flow."}
          </p>
          <label className="mt-2 block max-w-md">
            <span className="font-body text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
              {it ? "Nome sul canvas" : "Canvas name"}
            </span>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder={it ? "Es. Nome dispositivo" : "e.g. Device name"}
              className="mt-0.5 w-full rounded-slsm border border-border-strong bg-surface px-2.5 py-1.5 font-heading text-base font-semibold text-ink outline-none focus:border-brand-blue"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {(["i2c", "spi", "gpio", "adc", "w1", "display"] as const).map((mode) => {
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
                {mode === "adc" ? (it ? "analog" : "adc") : mode === "w1" ? "1-wire" : mode}
              </button>
            );
          })}
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
            <BindingPanel draft={draft} it={it} physical={physicalDraft} onChange={setDraft} onOpenPhysical={() => navigate("physical-composition")} />
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
            {draft.binding.bus === "w1" ? (
              <div className="mt-3">
                <p className="mb-1 font-body text-[10px] font-semibold text-ink-muted">{it ? "Modelli" : "Templates"}</p>
                <button
                  type="button"
                  onClick={() => {
                    const next = createDs18b20Example(draft.name);
                    setDraft(next);
                    setSelectedOpId(next.phases.sample[0]?.id ?? null);
                  }}
                  className="w-full rounded-slsm border border-border-strong px-2 py-1.5 font-body text-[11px] hover:border-brand-blue"
                >
                  DS18B20
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
          <div className="mb-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-slpill border border-border-strong bg-surface p-0.5">
                {phaseTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    title={tab.hint}
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
                  {it ? "Intervallo del Task" : "Task interval"}
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
            <div className="flex gap-2 rounded-slmd border border-brand-blue/25 bg-brand-blue/5 px-3 py-2">
              <Info size={14} className="mt-0.5 shrink-0 text-brand-blue" aria-hidden />
              <div className="min-w-0">
                <p className="font-body text-[11px] font-semibold text-ink">{activePhaseTab.label}</p>
                <p className="mt-0.5 font-body text-[11px] leading-snug text-ink-muted">{activePhaseTab.blurb}</p>
              </div>
            </div>
            {phase === "command" ? (
              <ActionTriggerFields
                it={it}
                value={draft.actionTrigger}
                onChange={(actionTrigger) => setDraft({ ...draft, actionTrigger })}
              />
            ) : null}
          </div>

          <DerivedSignalView draft={draft} phase={phase} it={it} selectedOpId={selectedOpId} />

          {draft.binding.bus === "adc" && phase === "sample" ? (
            <AnalogSamplingSummary draft={draft} it={it} />
          ) : null}

          {draft.binding.bus === "i2c" || draft.binding.bus === "spi" ? (
            <>
              <section className="mb-4 mt-4 rounded-slmd border border-border-strong bg-surface p-3">
                <h2 className="mb-2 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
                  {it ? "Passi sequenza" : "Sequence steps"}
                </h2>
                <div className="flex flex-wrap items-center gap-1.5">
                  {ops.length === 0 ? (
                    <p className="font-body text-xs text-ink-faint">
                      {it ? "Nessun passo — aggiungi dalla libreria." : "No steps — add from the library."}
                    </p>
                  ) : (
                    ops.map((op, index) => (
                      <div key={op.id} className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setSelectedOpId(op.id)}
                          className={`rounded-slsm border px-2.5 py-2 text-left ${
                            selectedOpId === op.id
                              ? "border-brand-blue bg-brand-blue/10 ring-2 ring-brand-blue/25"
                              : isBusOp(op)
                                ? "border-ink/30 bg-ink text-white hover:bg-ink/90"
                                : "border-border-strong bg-surface-sunken hover:border-brand-blue/40"
                          }`}
                        >
                          <span className={`block font-mono text-[9px] ${isBusOp(op) && selectedOpId !== op.id ? "text-white/60" : "text-ink-faint"}`}>
                            {index + 1}
                            {isBusOp(op) ? " · bus" : isPostOp(op) ? " · data" : ""}
                          </span>
                          <span className={`block font-body text-xs font-semibold ${isBusOp(op) && selectedOpId !== op.id ? "text-white" : "text-ink"}`}>
                            {describeDeviceOp(op)}
                          </span>
                        </button>
                        {index < ops.length - 1 ? <span className="text-ink-faint">→</span> : null}
                      </div>
                    ))
                  )}
                </div>
              </section>
              <ProtocolFrameStrip
                cells={buildProtocolTiming(draft, phase).cells}
                selectedOpId={selectedOpId}
                onSelectOp={setSelectedOpId}
                title={
                  draft.binding.bus === "i2c"
                    ? it
                      ? "Transazione I2C (vista datasheet)"
                      : "I2C transaction (datasheet view)"
                    : it
                      ? "Transazione SPI (vista datasheet)"
                      : "SPI transaction (datasheet view)"
                }
                hint={it ? "Stessi segmenti del grafico sopra" : "Same segments as the chart above"}
              />
            </>
          ) : (
            <section className="mb-4 mt-4 rounded-slmd border border-border-strong bg-surface p-3">
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
          )}

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
                onDraftChange={setDraft}
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

          <VariablesPanel draft={draft} it={it} onChange={setDraft} />

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
            onClick={handleOpenBlockPreview}
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
            {it ? "Genera blocco Flow" : "Generate Flow block"}
          </button>
        </div>
      </footer>

      {showBlockPreview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4" role="dialog" aria-modal="true">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-slmd border border-border-strong bg-surface p-4 shadow-e2">
            <BlockPreviewCard
              draft={draft}
              it={it}
              verified={draft.verification.status === "passed" || draft.verification.status === "simulated"}
            />
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowBlockPreview(false)}
                className="rounded-slpill px-3 py-1.5 font-body text-sm text-ink-muted hover:bg-surface-raised"
              >
                {it ? "Annulla" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={handleConfirmCreate}
                className="inline-flex items-center gap-1.5 rounded-slpill bg-brand-blue px-4 py-1.5 font-body-strong text-sm text-white hover:bg-brand-blue-dark"
              >
                <Check size={14} />
                {it ? "Salva sensore" : "Save sensor"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function BindingPanel({
  draft,
  it,
  physical,
  onChange,
  onOpenPhysical,
}: {
  draft: DeviceRecipeDraft;
  it: boolean;
  physical?: BackbonePhysicalDraft;
  onChange: (d: DeviceRecipeDraft) => void;
  onOpenPhysical: () => void;
}) {
  const variant = physical ? functionVariantOf(physical) : "v2";
  const pinOptions = silkPinLabels(variant);
  const modes = physical?.modes ?? [];
  const physicalHint = (
    <p className="rounded-slsm bg-brand-blue/10 px-2 py-1.5 font-body text-[10px] text-ink-muted">
      {it
        ? "I pin sono quelli del Module Function (A0…). Assegnali nel configuratore fisico."
        : "Pins come from Module Function (A0…). Assign them in the physical configurator."}{" "}
      <button type="button" className="font-semibold text-brand-blue underline" onClick={onOpenPhysical}>
        {it ? "Apri" : "Open"}
      </button>
    </p>
  );

  if (draft.binding.bus === "w1" && draft.binding.w1) {
    return <W1BindingPanel draft={draft} it={it} onChange={onChange} />;
  }

  if (draft.binding.bus === "adc" && draft.binding.adc) {
    const adc = draft.binding.adc;
    const physicalAdc = physicalLabelForSignalMode(modes, 14, variant);
    return (
      <div className="space-y-2 font-body text-xs">
        <p className="font-semibold text-ink">{it ? "Tipo: Analogico" : "Type: Analog"}</p>
        <Field label={it ? "Ruolo nel sensore" : "Sensor role"}>
          <input
            value={adc.signalName}
            onChange={(e) =>
              onChange({
                ...draft,
                binding: { ...draft.binding, adc: { ...adc, signalName: e.target.value || "SIGNAL" } },
              })
            }
            className={inputClass}
          />
        </Field>
        <div className="rounded-slsm border border-border bg-surface-sunken px-2 py-1.5 font-mono text-[10px] text-ink-muted">
          {it ? "Pin" : "Pin"} · {physicalAdc ?? (it ? "non assegnato" : "unassigned")}
        </div>
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
        {physicalHint}
      </div>
    );
  }

  if (draft.binding.bus === "i2c" && draft.binding.i2c) {
    const i2c = draft.binding.i2c;
    const physicalSda = physicalLabelForSignalMode(modes, 4, variant);
    const physicalScl = physicalLabelForSignalMode(modes, 5, variant);
    const physicalBus = physical
      ? busUnitLabel("i2c", selectedBusUnit(physical, "i2c"))
      : undefined;
    return (
      <div className="space-y-2 font-body text-xs">
        <Field label={it ? "Indirizzo modulo" : "Module address"}>
          <input
            value={i2c.address}
            onChange={(e) => onChange({ ...draft, binding: { ...draft.binding, i2c: { ...i2c, address: e.target.value } } })}
            className={inputClass}
            placeholder="0x48"
          />
        </Field>
        <div className="rounded-slsm border border-border bg-surface-sunken px-2 py-1.5 font-mono text-[10px] text-ink-muted">
          <div>SDA · {physicalSda ?? (it ? "non assegnato" : "unassigned")}</div>
          <div>SCL · {physicalScl ?? (it ? "non assegnato" : "unassigned")}</div>
          <div>{it ? "Bus" : "Bus"} · {physicalBus ?? "—"}</div>
        </div>
        {physicalHint}
      </div>
    );
  }
  if (draft.binding.bus === "spi" && draft.binding.spi) {
    const spi = draft.binding.spi;
    const signalModes = { SCK: 8, MOSI: 9, MISO: 10, CS: 11 } as const;
    return (
      <div className="space-y-2 font-body text-xs">
        <div className="rounded-slsm border border-border bg-surface-sunken px-2 py-1.5 font-mono text-[10px] text-ink-muted">
          {Object.entries(signalModes).map(([label, mode]) => (
            <div key={label}>
              {label} · {physicalLabelForSignalMode(modes, mode, variant) ?? (it ? "non assegnato" : "unassigned")}
            </div>
          ))}
        </div>
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
        {physicalHint}
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
            pinLabel: `A${Math.min(n - 1, pinOptions.length - 1)}`,
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
  onDraftChange,
  onRemove,
  onMove,
}: {
  op: DeviceRecipeOp;
  draft: DeviceRecipeDraft;
  it: boolean;
  onChange: (op: DeviceRecipeOp) => void;
  onDraftChange: (draft: DeviceRecipeDraft) => void;
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

      {op.type === "sample_external" ? (
        <SampleExternalFields
          op={op}
          draft={draft}
          it={it}
          onChange={onChange}
          onDraftChange={onDraftChange}
        />
      ) : null}

      {op.type === "i2c_write" ? (
        <>
          <RegOrVarField
            it={it}
            label={it ? "Registro" : "Register"}
            value={op.reg ?? ""}
            variables={draft.variables}
            onChange={(reg) => onChange({ ...op, reg: reg || undefined })}
          />
          <Field label={it ? "Byte (hex o $var)" : "Bytes (hex or $var)"}>
            <input
              value={op.bytes.join(" ")}
              onChange={(e) =>
                onChange({
                  ...op,
                  bytes: e.target.value
                    .split(/\s+/)
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              className={inputClass}
            />
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

      {op.type === "i2c_write_read" ? (
        <>
          <RegOrVarField
            it={it}
            label={it ? "Registro" : "Register"}
            value={op.reg ?? ""}
            variables={draft.variables}
            onChange={(reg) => onChange({ ...op, reg: reg || undefined })}
          />
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
        <DecodeFields op={op} draft={draft} it={it} onChange={onChange} />
      ) : null}

      {op.type === "encode" ? (
        <EncodeFields op={op} draft={draft} it={it} onChange={onChange} />
      ) : null}

      {op.type === "emit" ? (
        <EmitOutputFields
          op={op}
          draft={draft}
          it={it}
          onChange={onChange}
          onDraftChange={onDraftChange}
        />
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

      {op.type === "w1_reset" ? (
        <Field label={it ? "Salva presenza in" : "Presence into"}>
          <input value={op.intoPresence} onChange={(e) => onChange({ ...op, intoPresence: e.target.value })} className={inputClass} />
        </Field>
      ) : null}
      {op.type === "w1_match_rom" ? (
        <>
          <Field label="ROM">
            <input
              value={op.rom}
              placeholder={draft.binding.w1?.rom || (it ? "Usa ROM del binding" : "Use binding ROM")}
              onChange={(e) => onChange({ ...op, rom: e.target.value })}
              className={inputClass}
            />
          </Field>
          <p className="font-body text-[10px] text-ink-faint">
            {it ? "Vuoto = ROM del dispositivo nella sidebar." : "Empty = device ROM from the sidebar."}
          </p>
        </>
      ) : null}
      {op.type === "w1_write" ? (
        <Field label={it ? "Byte (hex)" : "Bytes (hex)"}>
          <input
            value={op.bytes.join(" ")}
            onChange={(e) =>
              onChange({
                ...op,
                bytes: e.target.value
                  .split(/\s+/)
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
            className={inputClass}
          />
        </Field>
      ) : null}
      {op.type === "w1_read" ? (
        <>
          <Field label={it ? "Lunghezza" : "Length"}>
            <input
              type="number"
              min={1}
              value={op.len}
              onChange={(e) => onChange({ ...op, len: Math.max(1, Number(e.target.value) || 1) })}
              className={inputClass}
            />
          </Field>
          <Field label={it ? "Salva in" : "Save to"}>
            <input value={op.into} onChange={(e) => onChange({ ...op, into: e.target.value })} className={inputClass} />
          </Field>
        </>
      ) : null}
      {op.type === "w1_wait_convert" ? (
        <>
          <Field label={it ? "Strategia" : "Strategy"}>
            <select
              value={op.strategy}
              onChange={(e) => onChange({ ...op, strategy: e.target.value as "fixed_max" | "poll" })}
              className={inputClass}
            >
              <option value="fixed_max">{it ? "Timeout max (datasheet)" : "Fixed max (datasheet)"}</option>
              <option value="poll" disabled>
                {it ? "Poll (runtime non disponibile)" : "Poll (runtime unavailable)"}
              </option>
            </select>
          </Field>
          <Field label="timeout ms">
            <input
              type="number"
              min={1}
              value={op.timeoutMs}
              onChange={(e) => onChange({ ...op, timeoutMs: Math.max(1, Number(e.target.value) || 1) })}
              className={inputClass}
            />
          </Field>
          <p className="font-body text-[10px] text-ink-faint">
            {it
              ? "DS18B20 @12-bit: max 750 ms (datasheet). Non usare ritardi UI."
              : "DS18B20 @12-bit: max 750 ms (datasheet). Do not use UI delays."}
          </p>
        </>
      ) : null}
      {op.type === "w1_crc" ? (
        <>
          <Field label="Input">
            <input value={op.input} onChange={(e) => onChange({ ...op, input: e.target.value })} className={inputClass} />
          </Field>
          <Field label={it ? "Byte (incl. CRC)" : "Bytes (incl. CRC)"}>
            <input
              type="number"
              min={2}
              value={op.len}
              onChange={(e) => onChange({ ...op, len: Math.max(2, Number(e.target.value) || 2) })}
              className={inputClass}
            />
          </Field>
          <Field label={it ? "Esito in" : "OK into"}>
            <input value={op.intoOk} onChange={(e) => onChange({ ...op, intoOk: e.target.value })} className={inputClass} />
          </Field>
        </>
      ) : null}
    </div>
  );
}

function W1BindingPanel({
  draft,
  it,
  onChange,
}: {
  draft: DeviceRecipeDraft;
  it: boolean;
  onChange: (d: DeviceRecipeDraft) => void;
}) {
  const w1 = draft.binding.w1!;
  const [romDraft, setRomDraft] = useState(w1.rom);
  const [romError, setRomError] = useState<string | null>(null);
  const [searchNote, setSearchNote] = useState<string | null>(null);
  const { navigate } = useSession();

  function applyRom(raw: string) {
    setRomDraft(raw);
    if (!raw.trim()) {
      setRomError(null);
      onChange({ ...draft, binding: { ...draft.binding, w1: { ...w1, rom: "" } } });
      return;
    }
    const check = validateOneWireRom(raw);
    if (!check.ok) {
      setRomError(check.message);
      onChange({ ...draft, binding: { ...draft.binding, w1: { ...w1, rom: raw } } });
      return;
    }
    setRomError(null);
    onChange({ ...draft, binding: { ...draft.binding, w1: { ...w1, rom: check.rom } } });
    setRomDraft(check.rom);
  }

  return (
    <div className="space-y-2 font-body text-xs">
      <p className="font-semibold text-ink">{it ? "Tipo: 1-Wire" : "Type: 1-Wire"}</p>
      <Field label={it ? "Bus (configuratore)" : "Bus (configurator)"}>
        <input value={w1.busName} readOnly className={`${inputClass} opacity-70`} />
      </Field>
      <Field label="DQ">
        <input value={w1.dqPinLabel} readOnly className={`${inputClass} opacity-70`} />
      </Field>
      <button
        type="button"
        onClick={() => navigate("physical-composition")}
        className="w-full rounded-slsm border border-border-strong px-2 py-1.5 text-left font-body text-[11px] text-brand-blue hover:border-brand-blue"
      >
        {it ? "Modifica pin DQ nel Cablaggio →" : "Edit DQ pin in Wiring →"}
      </button>
      <p className="rounded-slsm bg-brand-blue/10 px-2 py-1.5 font-body text-[10px] text-ink-muted">
        {it
          ? "Pull-up esterno obbligatorio · open-drain · alimentazione esterna. Più dispositivi condividono questo bus."
          : "External pull-up required · open-drain · external power. Multiple devices share this bus."}
      </p>
      <Field label={it ? "ROM dispositivo" : "Device ROM"}>
        <input
          value={romDraft}
          placeholder="28 FF … CRC"
          onChange={(e) => applyRom(e.target.value)}
          className={inputClass}
        />
      </Field>
      {romError ? <p className="font-body text-[10px] text-error">{romError}</p> : null}
      <button
        type="button"
        onClick={() => {
          setSearchNote(
            it
              ? "Cerca dispositivi: non disponibile senza runtime 1-Wire. Inserisci la ROM manualmente (nessun risultato inventato)."
              : "Search devices: unavailable without 1-Wire runtime. Enter ROM manually (no invented results).",
          );
          onChange({
            ...draft,
            verification: {
              status: "unavailable",
              note: it ? "Search ROM non disponibile" : "ROM search unavailable",
            },
          });
        }}
        className="w-full rounded-slsm border border-dashed border-border-strong px-2 py-1.5 font-body text-[11px] text-ink-muted hover:border-brand-blue"
      >
        {it ? "Cerca dispositivi" : "Search devices"}
      </button>
      {searchNote ? <p className="font-body text-[10px] text-ink-faint">{searchNote}</p> : null}
      <Field label={it ? "Risoluzione (°C)" : "Resolution"}>
        <select
          value={w1.resolutionBits ?? 12}
          onChange={(e) =>
            onChange({
              ...draft,
              binding: {
                ...draft.binding,
                w1: { ...w1, resolutionBits: Number(e.target.value) as 9 | 10 | 11 | 12 },
              },
            })
          }
          className={inputClass}
        >
          <option value={9}>9 bit · 93.75 ms</option>
          <option value={10}>10 bit · 187.5 ms</option>
          <option value={11}>11 bit · 375 ms</option>
          <option value={12}>12 bit · 750 ms</option>
        </select>
      </Field>
    </div>
  );
}

const inputClass =
  "w-full rounded-slsm border border-border-strong bg-surface px-1.5 py-1 font-mono text-xs outline-none focus:border-brand-blue";

function BlockPreviewCard({
  draft,
  it,
  verified,
}: {
  readonly draft: DeviceRecipeDraft;
  readonly it: boolean;
  readonly verified: boolean;
}) {
  const { inputs, outputs } = recipeBlockPorts(draft);
  return (
    <section className="rounded-slmd border border-brand-blue/30 bg-brand-blue/5 p-3">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
          {it ? "Anteprima blocco Flow" : "Flow block preview"}
        </h2>
        {verified ? (
          <span className="rounded-slpill bg-emerald-100 px-2 py-0.5 font-body text-[10px] font-semibold text-emerald-800">
            {it ? "Testato" : "Verified"}
          </span>
        ) : null}
      </div>
      <p className="mb-3 font-body text-[11px] text-ink-muted">
        {it
          ? "Controlla input/output, poi salva il sensore sul canvas."
          : "Check inputs/outputs, then save the sensor to the canvas."}
      </p>
      <div className="mx-auto flex max-w-sm items-stretch gap-2">
        <div className="flex w-28 flex-col justify-center gap-1.5">
          {inputs.length === 0 ? (
            <p className="font-body text-[10px] text-ink-faint">{it ? "Nessun input" : "No inputs"}</p>
          ) : (
            inputs.map((p) => (
              <div key={p.id} className="rounded-slsm border border-border-strong bg-surface px-1.5 py-1 text-right">
                <p className="font-body text-[10px] font-semibold text-ink">{p.label}</p>
                <p className="font-mono text-[9px] text-ink-faint">{p.valueType}{p.unit ? ` · ${p.unit}` : ""}</p>
              </div>
            ))
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center rounded-slmd border-2 border-ink bg-surface px-3 py-4 shadow-e1">
          <p className="text-center font-heading text-sm font-bold text-ink">{draft.name || (it ? "Dispositivo" : "Device")}</p>
          <p className="mt-0.5 font-mono text-[10px] uppercase text-ink-faint">{draft.binding.bus}</p>
        </div>
        <div className="flex w-28 flex-col justify-center gap-1.5">
          {outputs.length === 0 ? (
            <p className="font-body text-[10px] text-ink-faint">{it ? "Nessun output" : "No outputs"}</p>
          ) : (
            outputs.map((p) => (
              <div key={p.id} className="rounded-slsm border border-border-strong bg-surface px-1.5 py-1">
                <p className="font-body text-[10px] font-semibold text-ink">{p.label}</p>
                <p className="font-mono text-[9px] text-ink-faint">{p.valueType}{p.unit ? ` · ${p.unit}` : ""}</p>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function EmitOutputFields({
  op,
  draft,
  it,
  onChange,
  onDraftChange,
}: {
  readonly op: Extract<DeviceRecipeOp, { type: "emit" }>;
  readonly draft: DeviceRecipeDraft;
  readonly it: boolean;
  readonly onChange: (op: DeviceRecipeOp) => void;
  readonly onDraftChange: (draft: DeviceRecipeDraft) => void;
}) {
  const readChannels = draft.channels.filter((c) => c.direction === "read");
  const channel = readChannels.find((c) => c.id === op.channelId) ?? readChannels[0];
  const quantities: SensorOutputKind[] = [
    "temperature",
    "humidity",
    "pressure",
    "distance",
    "light",
    "digital",
    "analog",
    "other",
  ];

  function patchChannel(patch: Partial<NonNullable<typeof channel>>) {
    if (!channel) return;
    onDraftChange({
      ...draft,
      channels: draft.channels.map((c) => (c.id === channel.id ? { ...c, ...patch } : c)),
    });
  }

  return (
    <>
      <p className="font-body text-[11px] leading-snug text-ink-muted">
        {it
          ? "Definisce un output del blocco sul canvas (tipo e etichetta)."
          : "Defines a canvas block output (type and label)."}
      </p>
      <Field label={it ? "Output" : "Output"}>
        <select
          value={op.channelId}
          onChange={(e) => onChange({ ...op, channelId: e.target.value })}
          className={inputClass}
        >
          {readChannels.map((ch) => (
            <option key={ch.id} value={ch.id}>
              {ch.label}
            </option>
          ))}
        </select>
      </Field>
      <button
        type="button"
        className="w-full rounded-slsm border border-dashed border-border-strong py-1 font-body text-[10px] text-brand-blue"
        onClick={() => {
          const id = `out_${readChannels.length}`;
          const phase = (["init", "sample", "command"] as const).find((p) =>
            draft.phases[p].some((o) => o.id === op.id),
          );
          const withChannel: DeviceRecipeDraft = {
            ...draft,
            channels: [
              ...draft.channels,
              {
                id,
                label: it ? `Uscita ${readChannels.length + 1}` : `Output ${readChannels.length + 1}`,
                unit: "",
                quantity: "other",
                direction: "read",
              },
            ],
          };
          onDraftChange(
            phase ? updateOp(withChannel, phase, op.id, { ...op, channelId: id }) : withChannel,
          );
        }}
      >
        + {it ? "Nuovo output" : "New output"}
      </button>
      {channel ? (
        <>
          <Field label={it ? "Etichetta sul blocco" : "Block label"}>
            <input value={channel.label} onChange={(e) => patchChannel({ label: e.target.value })} className={inputClass} />
          </Field>
          <Field label={it ? "Tipo grandezza" : "Quantity type"}>
            <select
              value={channel.quantity}
              onChange={(e) => patchChannel({ quantity: e.target.value as SensorOutputKind })}
              className={inputClass}
            >
              {quantities.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </Field>
          <Field label={it ? "Unità" : "Unit"}>
            <input value={channel.unit} onChange={(e) => patchChannel({ unit: e.target.value })} className={inputClass} placeholder="°C, %, …" />
          </Field>
        </>
      ) : null}
      <Field label="from">
        <input value={op.from} onChange={(e) => onChange({ ...op, from: e.target.value })} className={inputClass} />
      </Field>
    </>
  );
}

function DecodeFields({
  op,
  draft,
  it,
  onChange,
}: {
  readonly op: Extract<DeviceRecipeOp, { type: "decode" }>;
  readonly draft: DeviceRecipeDraft;
  readonly it: boolean;
  readonly onChange: (op: DeviceRecipeOp) => void;
}) {
  const varNames = draft.variables.map((v) => v.name);
  return (
    <>
      <p className="font-body text-[11px] leading-snug text-ink-muted">
        {it
          ? "Dal sensore o da una variabile interna → variabile di uscita (usabile con Emetti)."
          : "From sensor or an internal variable → output variable (for Emit)."}
      </p>
      <Field label={it ? "Sorgente (buffer / var)" : "Source (buffer / var)"}>
        <input
          list="recipe-var-names"
          value={op.input}
          onChange={(e) => onChange({ ...op, input: e.target.value })}
          className={inputClass}
          placeholder="raw"
        />
        <datalist id="recipe-var-names">
          {varNames.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </Field>
      <Field label={it ? "Variabile di uscita" : "Output variable"}>
        <input
          value={op.into}
          onChange={(e) => onChange({ ...op, into: normalizeRecipeVarName(e.target.value) })}
          className={inputClass}
        />
      </Field>
      <Field label={it ? "Tipo uscita" : "Output type"}>
        <select
          value={op.outType ?? "number"}
          onChange={(e) => onChange({ ...op, outType: e.target.value as RecipeVarType })}
          className={inputClass}
        >
          <option value="number">number</option>
          <option value="hex">hex</option>
          <option value="bool">bool</option>
          <option value="string">string</option>
        </select>
      </Field>
      <Field label={it ? "Byte (inizio–fine)" : "Bytes (start–end)"}>
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
      <Field label={it ? "Ordine byte" : "Byte order"}>
        <select
          value={op.byteOrder}
          onChange={(e) => onChange({ ...op, byteOrder: e.target.value as "be" | "le" })}
          className={inputClass}
        >
          <option value="be">BE</option>
          <option value="le">LE</option>
        </select>
      </Field>
      <label className="flex items-center gap-2 font-body text-[11px] text-ink-muted">
        <input
          type="checkbox"
          checked={op.signed}
          onChange={(e) => onChange({ ...op, signed: e.target.checked })}
        />
        {it ? "Con segno" : "Signed"}
      </label>
      <div className="grid grid-cols-3 gap-1">
        <Field label="×">
          <input
            type="number"
            value={op.multiply ?? 1}
            onChange={(e) => onChange({ ...op, multiply: Number(e.target.value) || 1 })}
            className={inputClass}
          />
        </Field>
        <Field label="÷">
          <input
            type="number"
            value={op.divide ?? 1}
            onChange={(e) => onChange({ ...op, divide: Number(e.target.value) || 1 })}
            className={inputClass}
          />
        </Field>
        <Field label="+">
          <input
            type="number"
            value={op.offset ?? 0}
            onChange={(e) => onChange({ ...op, offset: Number(e.target.value) || 0 })}
            className={inputClass}
          />
        </Field>
      </div>
    </>
  );
}

function EncodeFields({
  op,
  draft,
  it,
  onChange,
}: {
  readonly op: Extract<DeviceRecipeOp, { type: "encode" }>;
  readonly draft: DeviceRecipeDraft;
  readonly it: boolean;
  readonly onChange: (op: DeviceRecipeOp) => void;
}) {
  const varNames = draft.variables.map((v) => v.name);
  return (
    <>
      <p className="font-body text-[11px] leading-snug text-ink-muted">
        {it
          ? "Da un ingresso (es. Campiona) a una variabile interna: cambio tipo o regole di conversione."
          : "From an input (e.g. Campiona) to an internal variable: type change or conversion rules."}
      </p>
      <Field label={it ? "Ingresso" : "Input"}>
        <select
          value={op.input}
          onChange={(e) => {
            const name = e.target.value;
            const v = draft.variables.find((x) => x.name === name);
            onChange({ ...op, input: name, fromType: v?.valueType ?? op.fromType });
          }}
          className={inputClass}
        >
          {varNames.length === 0 ? <option value={op.input}>{op.input}</option> : null}
          {varNames.map((n) => (
            <option key={n} value={n}>
              ${n}
            </option>
          ))}
        </select>
      </Field>
      <Field label={it ? "Da tipo" : "From type"}>
        <select
          value={op.fromType}
          onChange={(e) => onChange({ ...op, fromType: e.target.value as RecipeVarType })}
          className={inputClass}
        >
          <option value="number">number</option>
          <option value="hex">hex</option>
          <option value="bool">bool</option>
          <option value="string">string</option>
        </select>
      </Field>
      <Field label={it ? "A tipo" : "To type"}>
        <select
          value={op.toType}
          onChange={(e) => onChange({ ...op, toType: e.target.value as RecipeVarType })}
          className={inputClass}
        >
          <option value="number">number</option>
          <option value="hex">hex</option>
          <option value="bool">bool</option>
          <option value="string">string</option>
        </select>
      </Field>
      <Field label={it ? "Variabile destinazione" : "Destination variable"}>
        <input
          value={op.into}
          onChange={(e) => onChange({ ...op, into: normalizeRecipeVarName(e.target.value) })}
          className={inputClass}
        />
      </Field>
      {op.toType === "hex" ? (
        <>
          <Field label={it ? "Larghezza (byte)" : "Width (bytes)"}>
            <input
              type="number"
              min={1}
              max={8}
              value={op.widthBytes}
              onChange={(e) => onChange({ ...op, widthBytes: Math.max(1, Math.min(8, Number(e.target.value) || 1)) })}
              className={inputClass}
            />
          </Field>
          <Field label={it ? "Ordine byte" : "Byte order"}>
            <select
              value={op.byteOrder}
              onChange={(e) => onChange({ ...op, byteOrder: e.target.value as "be" | "le" })}
              className={inputClass}
            >
              <option value="be">BE</option>
              <option value="le">LE</option>
            </select>
          </Field>
        </>
      ) : null}
      <div className="grid grid-cols-3 gap-1">
        <Field label="×">
          <input
            type="number"
            value={op.multiply ?? 1}
            onChange={(e) => onChange({ ...op, multiply: Number(e.target.value) || 1 })}
            className={inputClass}
          />
        </Field>
        <Field label="÷">
          <input
            type="number"
            value={op.divide ?? 1}
            onChange={(e) => onChange({ ...op, divide: Number(e.target.value) || 1 })}
            className={inputClass}
          />
        </Field>
        <Field label="+">
          <input
            type="number"
            value={op.offset ?? 0}
            onChange={(e) => onChange({ ...op, offset: Number(e.target.value) || 0 })}
            className={inputClass}
          />
        </Field>
      </div>
    </>
  );
}

function RegOrVarField({
  it,
  label,
  value,
  variables,
  onChange,
}: {
  readonly it: boolean;
  readonly label: string;
  readonly value: string;
  readonly variables: readonly RecipeVariable[];
  readonly onChange: (next: string) => void;
}) {
  const mode = isVarRef(value) ? "var" : "literal";
  const varName = parseVarRef(value) ?? variables[0]?.name ?? "";
  return (
    <Field label={label}>
      <div className="flex flex-col gap-1">
        <select
          value={mode}
          onChange={(e) => {
            if (e.target.value === "var") {
              onChange(toVarRef(varName || variables[0]?.name || "reg"));
            } else {
              onChange(isVarRef(value) ? "0x00" : value || "0x00");
            }
          }}
          className={inputClass}
        >
          <option value="literal">{it ? "Letterale" : "Literal"}</option>
          <option value="var">{it ? "Variabile" : "Variable"}</option>
        </select>
        {mode === "var" ? (
          <select
            value={varName}
            onChange={(e) => onChange(toVarRef(e.target.value))}
            className={inputClass}
            disabled={variables.length === 0}
          >
            {variables.length === 0 ? (
              <option value="">{it ? "Nessuna variabile — usa Campiona" : "No variables — use Campiona"}</option>
            ) : (
              variables.map((v) => (
                <option key={v.id} value={v.name}>
                  ${v.name} · {v.valueType}
                </option>
              ))
            )}
          </select>
        ) : (
          <input value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} placeholder="0x00" />
        )}
      </div>
    </Field>
  );
}

function SampleExternalFields({
  op,
  draft,
  it,
  onChange,
  onDraftChange,
}: {
  readonly op: Extract<DeviceRecipeOp, { type: "sample_external" }>;
  readonly draft: DeviceRecipeDraft;
  readonly it: boolean;
  readonly onChange: (op: DeviceRecipeOp) => void;
  readonly onDraftChange: (draft: DeviceRecipeDraft) => void;
}) {
  const writeChannels = writeChannelsOf(draft);
  return (
    <>
      <p className="font-body text-[11px] leading-snug text-ink-muted">
        {it
          ? "Legge un ingresso Flow e lo mette in una variabile globale (usabile in Task e Azione)."
          : "Reads a Flow input into a global variable (usable in Task and Action)."}
      </p>
      <Field label={it ? "Ingresso Flow" : "Flow input"}>
        <div className="flex gap-1">
          <select
            value={op.fromChannelId}
            onChange={(e) => onChange({ ...op, fromChannelId: e.target.value })}
            className={inputClass}
          >
            {writeChannels.length === 0 ? (
              <option value={op.fromChannelId}>{op.fromChannelId}</option>
            ) : (
              writeChannels.map((ch) => (
                <option key={ch.id} value={ch.id}>
                  {ch.label} ({ch.id})
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            className="shrink-0 rounded-slsm border border-border px-2 font-body text-[10px] text-brand-blue hover:bg-brand-blue/5"
            onClick={() => {
              const ensured = ensureWriteChannel(draft, {
                id: `ingresso_${writeChannels.length + 1}`,
                label: it ? `Ingresso ${writeChannels.length + 1}` : `Input ${writeChannels.length + 1}`,
              });
              const phase = (["init", "sample", "command"] as const).find((p) =>
                ensured.draft.phases[p].some((o) => o.id === op.id),
              );
              if (!phase) {
                onDraftChange(ensured.draft);
                return;
              }
              onDraftChange(
                updateOp(ensured.draft, phase, op.id, { ...op, fromChannelId: ensured.channelId }),
              );
            }}
          >
            +
          </button>
        </div>
      </Field>
      <Field label={it ? "Variabile" : "Variable"}>
        <input
          value={op.into}
          onChange={(e) =>
            onChange({
              ...op,
              into: normalizeRecipeVarName(e.target.value),
            })
          }
          className={inputClass}
        />
      </Field>
      <Field label={it ? "Tipo input" : "Input type"}>
        <select
          value={op.valueType}
          onChange={(e) => {
            const valueType = e.target.value as RecipeVarType;
            const phase = (["init", "sample", "command"] as const).find((p) =>
              draft.phases[p].some((o) => o.id === op.id),
            );
            const channels = draft.channels.map((c) =>
              c.id === op.fromChannelId
                ? {
                    ...c,
                    quantity:
                      valueType === "bool"
                        ? ("digital" as const)
                        : valueType === "number" || valueType === "hex"
                          ? ("analog" as const)
                          : ("other" as const),
                  }
                : c,
            );
            const next = { ...draft, channels };
            onDraftChange(phase ? updateOp(next, phase, op.id, { ...op, valueType }) : next);
          }}
          className={inputClass}
        >
          <option value="hex">hex</option>
          <option value="number">number</option>
          <option value="bool">bool</option>
          <option value="string">string</option>
        </select>
      </Field>
      <Field label={it ? "Etichetta ingresso" : "Input label"}>
        <input
          value={draft.channels.find((c) => c.id === op.fromChannelId)?.label ?? op.fromChannelId}
          onChange={(e) => {
            onDraftChange({
              ...draft,
              channels: draft.channels.map((c) =>
                c.id === op.fromChannelId ? { ...c, label: e.target.value } : c,
              ),
            });
          }}
          className={inputClass}
        />
      </Field>
    </>
  );
}

function VariablesPanel({
  draft,
  it,
  onChange,
}: {
  readonly draft: DeviceRecipeDraft;
  readonly it: boolean;
  readonly onChange: (draft: DeviceRecipeDraft) => void;
}) {
  const writeChannels = writeChannelsOf(draft);
  return (
    <section className="rounded-slmd border border-border-strong p-3">
      <h2 className="mb-1 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
        {it ? "Variabili" : "Variables"}
      </h2>
      <p className="mb-2 font-body text-[10px] leading-snug text-ink-muted">
        {it
          ? "Globali tra Inizializzazione, Task e Azione. Campiona le aggiorna da un ingresso Flow."
          : "Shared across Initialization, Task and Action. Campiona fills them from a Flow input."}
      </p>
      <ul className="mb-2 space-y-1.5">
        {draft.variables.length === 0 ? (
          <li className="font-body text-[11px] text-ink-faint">
            {it ? "Nessuna — aggiungi Campiona o crea qui." : "None — add Campiona or create here."}
          </li>
        ) : (
          draft.variables.map((v) => (
            <li key={v.id} className="rounded-slsm border border-border p-1.5">
              <div className="flex items-center gap-1">
                <input
                  value={v.name}
                  onChange={(e) =>
                    onChange(
                      upsertRecipeVariable(draft, {
                        ...v,
                        name: normalizeRecipeVarName(e.target.value),
                      }),
                    )
                  }
                  className={`${inputClass} flex-1`}
                />
                <select
                  value={v.valueType}
                  onChange={(e) =>
                    onChange(upsertRecipeVariable(draft, { ...v, valueType: e.target.value as RecipeVarType }))
                  }
                  className={`${inputClass} w-20`}
                >
                  <option value="hex">hex</option>
                  <option value="number">number</option>
                  <option value="bool">bool</option>
                  <option value="string">string</option>
                </select>
                <button
                  type="button"
                  disabled={isVariableUsed(draft, v.name)}
                  title={
                    isVariableUsed(draft, v.name)
                      ? it
                        ? "In uso nella sequenza"
                        : "Used in sequence"
                      : it
                        ? "Elimina"
                        : "Delete"
                  }
                  onClick={() => onChange(removeRecipeVariable(draft, v.id))}
                  className="rounded-slsm border border-border p-0.5 text-error disabled:opacity-30"
                >
                  <Trash2 size={12} />
                </button>
              </div>
              <input
                value={v.defaultValue ?? ""}
                placeholder={it ? "Default (opzionale)" : "Default (optional)"}
                onChange={(e) =>
                  onChange(upsertRecipeVariable(draft, { ...v, defaultValue: e.target.value || undefined }))
                }
                className={`${inputClass} mt-1`}
              />
            </li>
          ))
        )}
      </ul>
      <button
        type="button"
        onClick={() =>
          onChange(
            upsertRecipeVariable(draft, {
              name: `var_${draft.variables.length + 1}`,
              valueType: "hex",
              label: `var_${draft.variables.length + 1}`,
            }),
          )
        }
        className="mb-3 flex w-full items-center justify-center gap-1 rounded-slsm border border-dashed border-border-strong py-1 font-body text-[11px] text-brand-blue hover:bg-brand-blue/5"
      >
        <Plus size={12} /> {it ? "Aggiungi variabile" : "Add variable"}
      </button>

      <h3 className="mb-1 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
        {it ? "Ingressi Flow" : "Flow inputs"}
      </h3>
      <p className="mb-1 font-body text-[10px] text-ink-muted">
        {it ? "Canali in scrittura esposti al canvas." : "Write channels exposed to the canvas."}
      </p>
      <ul className="mb-1 space-y-1">
        {writeChannels.length === 0 ? (
          <li className="font-body text-[11px] text-ink-faint">{it ? "Nessun ingresso." : "No inputs."}</li>
        ) : (
          writeChannels.map((ch) => (
            <li key={ch.id} className="rounded-slpill bg-brand-blue/10 px-2 py-0.5 font-body text-[11px] text-brand-blue">
              {ch.label} · {ch.id}
            </li>
          ))
        )}
      </ul>
      <button
        type="button"
        onClick={() => {
          const ensured = ensureWriteChannel(draft, {
            id: `ingresso_${writeChannels.length + 1}`,
            label: it ? `Ingresso ${writeChannels.length + 1}` : `Input ${writeChannels.length + 1}`,
          });
          onChange(ensured.draft);
        }}
        className="flex w-full items-center justify-center gap-1 rounded-slsm border border-dashed border-border-strong py-1 font-body text-[11px] text-brand-blue hover:bg-brand-blue/5"
      >
        <Plus size={12} /> {it ? "Aggiungi ingresso" : "Add input"}
      </button>
    </section>
  );
}

function libraryOpHint(type: DeviceRecipeOp["type"], it: boolean): string {
  const hints: Partial<Record<DeviceRecipeOp["type"], { it: string; en: string }>> = {
    sample_external: {
      it: "Copia un valore in ingresso dal Flow in una variabile usabile nei passi successivi (es. registro I2C).",
      en: "Copy a Flow input value into a variable usable in later steps (e.g. I2C register).",
    },
    i2c_write: {
      it: "Invia uno o più byte al dispositivo su I2C (scrive un registro o un comando).",
      en: "Send one or more bytes to the device over I2C (write a register or command).",
    },
    i2c_read: {
      it: "Legge bytes dal dispositivo I2C e li salva in un buffer della sequenza.",
      en: "Read bytes from the I2C device into a sequence buffer.",
    },
    i2c_write_read: {
      it: "Scrive e subito dopo legge (transazione tipica: indirizzo registro + dati).",
      en: "Write then immediately read (typical register-address + data transaction).",
    },
    wait: {
      it: "Pausa la sequenza per un tempo fisso (es. conversione del sensore).",
      en: "Pause the sequence for a fixed time (e.g. sensor conversion).",
    },
    decode: {
      it: "Prende byte grezzi o una variabile interna e li converte in una variabile di uscita (prima di Emetti).",
      en: "Takes raw bytes or an internal variable and converts them into an output variable (before Emit).",
    },
    encode: {
      it: "Converte un ingresso (variabile / Flow) in un’altra variabile: cambio tipo o regole di scala/packing.",
      en: "Converts an input (variable / Flow) into another variable: type change or scale/packing rules.",
    },
    emit: {
      it: "Pubblica un valore sul canale del Flow (quello che vedi sul canvas).",
      en: "Publish a value on the Flow channel (what you see on the canvas).",
    },
    spi_cs: {
      it: "Attiva o rilascia il chip-select SPI prima/dopo un trasferimento.",
      en: "Assert or release SPI chip-select before/after a transfer.",
    },
    spi_transfer: {
      it: "Scambia bytes sul bus SPI (invio e ricezione insieme).",
      en: "Exchange bytes on the SPI bus (send and receive together).",
    },
    gpio_read: {
      it: "Legge il livello logico di un pin GPIO.",
      en: "Read the logic level of a GPIO pin.",
    },
    gpio_write: {
      it: "Imposta alto/basso un pin GPIO di uscita.",
      en: "Drive a GPIO output pin high or low.",
    },
    gpio_debounce: {
      it: "Filtra i rimbalzi di un ingresso digitale nel tempo.",
      en: "Filter digital input bounce over time.",
    },
    adc_sample: {
      it: "Campiona una volta l’ingresso analogico (pin ADC).",
      en: "Take a single analog sample from the ADC pin.",
    },
    adc_multi_sample: {
      it: "Campiona più volte a intervallo fisso (poi puoi fare la media).",
      en: "Sample several times at a fixed interval (then you can average).",
    },
    average: {
      it: "Calcola la media di una serie di campioni.",
      en: "Average a series of samples.",
    },
    filter: {
      it: "Applica un filtro semplice ai campioni (riduce il rumore).",
      en: "Apply a simple filter to samples (reduce noise).",
    },
    map_range: {
      it: "Rimappa un valore da un intervallo a un altro (es. conteggi → °C).",
      en: "Remap a value from one range to another (e.g. counts → °C).",
    },
    w1_reset: {
      it: "Reset del bus 1-Wire e controllo presenza del dispositivo.",
      en: "1-Wire bus reset and device presence check.",
    },
    w1_match_rom: {
      it: "Seleziona un dispositivo specifico tramite ROM.",
      en: "Select a specific device by ROM.",
    },
    w1_write: {
      it: "Scrive bytes sul bus 1-Wire.",
      en: "Write bytes on the 1-Wire bus.",
    },
    w1_read: {
      it: "Legge bytes dal bus 1-Wire.",
      en: "Read bytes from the 1-Wire bus.",
    },
    w1_wait_convert: {
      it: "Attende la fine della conversione (es. DS18B20).",
      en: "Wait until conversion finishes (e.g. DS18B20).",
    },
    w1_crc: {
      it: "Verifica il CRC sui dati letti.",
      en: "Verify CRC on read data.",
    },
  };
  const hint = hints[type];
  return hint ? (it ? hint.it : hint.en) : it ? "Aggiungi questo passo alla sequenza." : "Add this step to the sequence.";
}

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
            title: it ? "Ingressi / variabili" : "Inputs / vars",
            types: ["sample_external"] as const,
          },
          {
            title: it ? "Analogico" : "Analog",
            types: ["adc_sample", "adc_multi_sample"] as const,
          },
          {
            title: it ? "Dati" : "Data",
            types: ["average", "filter", "map_range", "encode", "decode", "emit", "wait"] as const,
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
              {items.map((item) => {
                const hint = libraryOpHint(item.type, it);
                return (
                  <li key={item.type}>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => onAdd(item.type)}
                        className="flex min-w-0 flex-1 items-center gap-2 rounded-slsm border border-border px-2 py-1.5 text-left font-body text-xs hover:border-brand-blue hover:bg-brand-blue/5"
                      >
                        <Plus size={12} className="shrink-0 text-brand-blue" />
                        <span className="truncate">{item.label}</span>
                      </button>
                      <span className="group relative flex h-8 w-8 shrink-0 items-center justify-center rounded-slsm text-ink-faint hover:bg-surface-raised hover:text-brand-blue">
                        <Info size={14} aria-hidden />
                        <span className="pointer-events-none absolute right-full top-1/2 z-50 mr-2 hidden w-52 -translate-y-1/2 rounded-slsm bg-ink px-2 py-1.5 font-body text-[10px] leading-snug text-white shadow-e2 group-hover:block">
                          {hint}
                        </span>
                        <span className="sr-only">{hint}</span>
                      </span>
                    </div>
                  </li>
                );
              })}
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
