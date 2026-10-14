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
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  addCommand,
  createAnalogLevelExample,
  createBlankDraft,
  createDs18b20Example,
  createGpioDigitalExample,
  describeDeviceOp,
  ensureWriteChannel,
  insertCommandStep,
  insertOp,
  isAnalogCalibrationComplete,
  isVariableUsed,
  libraryOpsForBus,
  moveCommandStep,
  moveOp,
  multiSampleSpanMs,
  normalizeRecipeVarName,
  opsForEditorPane,
  recipeBlockPorts,
  removeCommandStep,
  removeOp,
  removeRecipeVariable,
  updateCommandStep,
  updateOp,
  updateOpAnywhere,
  upsertRecipeVariable,
  validateDraftForCreate,
  validateI2cTransactionPhases,
  writeChannelsOf,
  type DeviceRecipeBus,
  type DeviceRecipeDraft,
  type DeviceRecipeEditorPane,
  type DeviceRecipeMode,
  type DeviceRecipeOp,
  type GpioSignalDef,
  type I2cTransactionPhase,
  type WaitTimeUnit,
  type RecipeVarType,
} from "../../lib/device-recipe-draft.js";
import type { SensorOutputKind } from "../../lib/sensor-recipe.js";
import {
  draftForBinding,
  functionVariantOf,
  parsePhysicalProject,
  physicalLabelForSignalMode,
  PHYSICAL_META_KEY,
  silkPinLabels,
  type BackbonePhysicalDraft,
} from "../../lib/backbone-physical.js";
import { validateOneWireRom } from "../../lib/onewire.js";
import { rxBlocksOf } from "../../lib/recipe-bus-capture.js";
import {
  runRecipeHardwareTest,
  type RecipeHardwareTestResult,
  type RecipeTestSelection,
  type RecipeTestTarget,
} from "../../lib/recipe-hardware-test.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { useLocale } from "../../state/locale-context.js";
import { useSession } from "../../state/session-context.js";
import { formatHexByte, parseHexByteToken } from "../../lib/i2c-hex.js";
import { buildProtocolTimingFromOps } from "../../lib/protocol-timing.js";
import { DerivedSignalView } from "./DerivedSignalView.js";
import {
  DisplayCenter,
  DisplayInspector,
  DisplayLeftSidebar,
} from "./DisplayRecipePanels.js";
import {
  DriverActionsList,
  DriverActionSettings,
  DriverSequence,
  DriverCanvasPreview,
} from "./DriverActionsPanel.js";
import { registerStep } from "../../lib/i2c-driver-actions.js";
import { TimingScopeChart } from "./TimingScopeChart.js";

type Props = {
  readonly initialDraft?: DeviceRecipeDraft;
  readonly onCancel?: () => void;
  readonly onSaveDraft?: (draft: DeviceRecipeDraft) => void;
  readonly onCreate?: (draft: DeviceRecipeDraft) => void;
};

/**
 * Full-screen device recipe editor (I2C / SPI / GPIO / ADC) — shared left/center/right layout.
 */
export function DeviceRecipeEditorScreen({
  initialDraft,
  onCancel,
  onSaveDraft,
  onCreate,
}: Props) {
  const { locale } = useLocale();
  const it = locale === "it";
  const { navigate, session } = useSession();
  const { rows, getClient, installProfile, listDeviceProfiles, removeProfile } =
    useCoreSessions();
  const physicalDraft = useMemo(() => {
    const project = parsePhysicalProject(
      session?.stack.current.authoringMetadata[PHYSICAL_META_KEY]?.comment,
    );
    const bindingId = session?.stack.current.coreBindings[0]?.bindingId;
    return draftForBinding(project, bindingId);
  }, [session]);
  const connectedBindingId = useMemo(() => {
    const fromSession = session?.stack.current.coreBindings[0]?.bindingId;
    if (
      fromSession &&
      rows.some(
        (r) => r.binding.bindingId === fromSession && r.sessionState === "READY",
      )
    ) {
      return fromSession;
    }
    return rows.find((r) => r.sessionState === "READY")?.binding.bindingId;
  }, [session, rows]);
  const [draft, setDraft] = useState<DeviceRecipeDraft>(
    () => initialDraft ?? createBlankDraft("i2c"),
  );
  const [editorPane, setEditorPane] = useState<DeviceRecipeEditorPane>("actions");
  const [selectedCommandId, setSelectedCommandId] = useState<string | null>(
    draft.commands[0]?.id ?? null,
  );
  const [selectedOpId, setSelectedOpId] = useState<string | null>(
    () => draft.commands[0]?.steps[0]?.id ?? draft.phases.init[0]?.id ?? null,
  );
  const [selectedCommandStepId, setSelectedCommandStepId] = useState<string | null>(
    draft.commands[0]?.steps[0]?.id ?? null,
  );
  const [fieldErrors, setFieldErrors] = useState<
    readonly { field: string; message: string }[]
  >([]);
  const [tryMessage, setTryMessage] = useState<string | null>(null);
  const [showBlockPreview, setShowBlockPreview] = useState(false);
  const [testRunInitFirst, setTestRunInitFirst] = useState(false);
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<RecipeHardwareTestResult | null>(null);

  const isDisplay = draft.category === "display";
  const activeActionId =
    draft.commands.find((c) => c.id === selectedCommandId)?.id ??
    draft.commands[0]?.id ??
    null;
  const ops = opsForEditorPane(draft, editorPane, activeActionId);
  const selected = ops.find((op) => op.id === selectedOpId) ?? ops[0] ?? null;
  const library = libraryOpsForBus(draft.binding.bus);
  const calibOk = isAnalogCalibrationComplete(draft);
  const createBlocked = validateDraftForCreate(draft).length > 0;
  const canvasActionCount = draft.commands.filter(
    (c) => c.exposeOnCanvas !== false,
  ).length;
  const paneTabs: {
    id: DeviceRecipeEditorPane;
    label: string;
    hint: string;
    blurb: string;
  }[] = [
    {
      id: "init",
      label: it ? "Inizializzazione" : "Initialization",
      hint: it
        ? "Eseguita una volta all’avvio, quando il blocco è sul canvas."
        : "Runs once at startup when the block is on the canvas.",
      blurb: it
        ? "Setup all’accensione: registri, indirizzi, preparazione dispositivo. Non è un ciclo."
        : "Power-on setup: registers, addresses, device prep. Not a loop.",
    },
    {
      id: "actions",
      label: it ? "Azioni" : "Actions",
      hint: it
        ? "Sequenza eseguita quando il blocco viene attivato sul canvas."
        : "Sequence run when the block is triggered on the canvas.",
      blurb: it
        ? "Sequenza del driver (scrivi / scrivi e leggi → variabili → uscita). L’intervallo lo decidi sul canvas."
        : "Driver sequence (write / write-read → variables → output). Interval is set on the canvas.",
    },
  ];

  function switchMode(mode: DeviceRecipeMode) {
    const next = createBlankDraft(mode, draft.name);
    setDraft({ ...next, name: draft.name || next.name });
    setEditorPane("actions");
    setSelectedCommandId(next.commands[0]?.id ?? null);
    setSelectedCommandStepId(next.commands[0]?.steps[0]?.id ?? null);
    setSelectedOpId(next.commands[0]?.steps[0]?.id ?? next.phases.init[0]?.id ?? null);
    setFieldErrors([]);
    setTryMessage(null);
  }

  function selectDriverAction(id: string) {
    setSelectedCommandId(id);
    setEditorPane("actions");
    const first = draft.commands.find((c) => c.id === id)?.steps[0]?.id ?? null;
    setSelectedOpId(first);
    setSelectedCommandStepId(first);
    setTestResult(null);
    setTryMessage(null);
  }

  function addRegisterStep(kind: "read" | "write") {
    const op = registerStep(kind);
    if (editorPane === "init") {
      setDraft({
        ...draft,
        phases: { ...draft.phases, init: [...draft.phases.init, op] },
      });
    } else {
      const base = activeActionId
        ? draft
        : addCommand(draft, {
            name: "azione",
            label: it ? "Azione" : "Action",
          });
      const id = activeActionId ?? base.commands[0]!.id;
      setDraft({
        ...base,
        commands: base.commands.map((c) =>
          c.id === id ? { ...c, steps: [...c.steps, op] } : c,
        ),
      });
      setSelectedCommandId(id);
    }
    setSelectedOpId(op.id);
  }

  function patchSelected(next: DeviceRecipeOp) {
    if (!selected) return;
    if (editorPane === "init") {
      setDraft(updateOp(draft, "init", selected.id, next));
      return;
    }
    if (!activeActionId) return;
    setDraft(updateCommandStep(draft, activeActionId, selected.id, next));
  }

  function addLibraryOp(type: DeviceRecipeOp["type"]) {
    if (editorPane === "init") {
      const next = insertOp(draft, "init", type);
      setDraft(next);
      setSelectedOpId(next.phases.init[next.phases.init.length - 1]?.id ?? null);
      return;
    }
    let base = draft;
    let actionId = activeActionId;
    if (!actionId) {
      base = addCommand(draft, { name: "misura", label: it ? "Misura" : "Measure" });
      actionId = base.commands[base.commands.length - 1]!.id;
      setSelectedCommandId(actionId);
    }
    const next = insertCommandStep(base, actionId, type);
    setDraft(next);
    const steps = next.commands.find((c) => c.id === actionId)?.steps ?? [];
    const added = steps[steps.length - 1];
    setSelectedOpId(added?.id ?? null);
    setSelectedCommandStepId(added?.id ?? null);
  }

  const testLabels = useMemo(
    () => ({
      init: it ? "Inizializzazione" : "Initialization",
      task: it ? "Azione" : "Action",
      action: it ? "Azione" : "Action",
    }),
    [it],
  );

  function currentTestSelection(): RecipeTestSelection {
    const target: RecipeTestTarget =
      editorPane === "init"
        ? { kind: "init" }
        : {
            kind: "action",
            commandId: activeActionId ?? draft.commands[0]?.id,
          };
    return { target, runInitFirst: testRunInitFirst };
  }

  async function handleRunHardwareTest() {
    setTestRunning(true);
    setTryMessage(null);
    setTestResult(null);
    const selection = currentTestSelection();
    try {
      const client = connectedBindingId ? getClient(connectedBindingId) : undefined;
      const addrRaw = draft.binding.i2c?.address;
      const i2cAddress = addrRaw
        ? Number.parseInt(addrRaw.replace(/^0x/i, ""), 16)
        : undefined;
      const result = await runRecipeHardwareTest({
        client,
        draft,
        selection,
        labels: testLabels,
        i2cAddress: Number.isFinite(i2cAddress) ? i2cAddress : undefined,
        preferredPhysicalModes: physicalDraft?.modes,
        preferredI2cSpeed: physicalDraft?.i2cSpeed,
        preferredPhysicalSettings: physicalDraft?.settings,
        cleanupTryProfiles: connectedBindingId
          ? async () => {
              const listed = await listDeviceProfiles(connectedBindingId);
              for (const p of listed ?? []) {
                if (!p.profileId.startsWith("try.")) continue;
                await removeProfile(connectedBindingId, p.profileId, p.version, {
                  isReferencedLocally: false,
                });
              }
            }
          : undefined,
        installProfile: connectedBindingId
          ? async (profileDraft) => {
              const out = await installProfile(connectedBindingId, profileDraft);
              if (!out) return { ok: false, error: "installProfile unavailable" };
              if (!out.ok) {
                return {
                  ok: false,
                  error: `${out.error.code}: ${out.error.remediation}`,
                };
              }
              return { ok: true };
            }
          : undefined,
      });

      const note = recipeTestNote(result, it);
      setTryMessage(note);
      setTestResult(result);

      if (result.ok) {
        setDraft((current) => ({
          ...current,
          verification: { status: "passed", note, lastTriedAt: Date.now() },
        }));
        return;
      }

      const status =
        result.kind === "no_client" ? ("unavailable" as const) : ("failed" as const);
      setDraft((current) => ({
        ...current,
        verification: { status, note, lastTriedAt: Date.now() },
      }));
    } finally {
      setTestRunning(false);
    }
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
      <header className="flex flex-wrap items-end gap-3 border-b border-border bg-surface px-4 py-2">
        <CircuitBoard size={22} className="mb-2 shrink-0 text-brand-blue" aria-hidden />
        <label className="min-w-40 flex-1 max-w-xs">
          <span className="font-body text-[10px] text-ink-muted">
            {it ? "Dispositivo · nome sul canvas" : "Device · canvas name"}
          </span>
          <input
            aria-label={it ? "Nome dispositivo" : "Device name"}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="w-full rounded-slsm border border-border-strong px-2 py-1 font-heading text-base font-semibold text-ink"
          />
        </label>
        <label className="w-28 font-body text-[10px] text-ink-muted">
          {it ? "Protocollo" : "Protocol"}
          <select
            aria-label={it ? "Protocollo" : "Protocol"}
            value={isDisplay ? "display" : draft.binding.bus}
            onChange={(e) =>
              switchMode(
                e.target.value as "i2c" | "spi" | "gpio" | "adc" | "w1" | "display",
              )
            }
            className={inputClass}
          >
            {(["i2c", "spi", "gpio", "adc", "w1", "display"] as const).map((mode) => (
              <option key={mode} value={mode}>
                {mode.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        {!isDisplay && draft.binding.bus === "i2c" && draft.binding.i2c && (
          <>
            <label className="w-24 font-body text-[10px] text-ink-muted">
              {it ? "Indirizzo I²C" : "I²C address"}
              <input
                aria-label={it ? "Indirizzo I²C" : "I²C address"}
                spellCheck={false}
                value={draft.binding.i2c.address}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    binding: {
                      ...draft.binding,
                      i2c: { ...draft.binding.i2c!, address: e.target.value },
                    },
                  })
                }
                className={inputClass}
              />
            </label>
            <label className="w-20 font-body text-[10px] text-ink-muted">
              {it ? "Bit indirizzo" : "Address bits"}
              <select
                aria-label={it ? "Bit indirizzo" : "Address bits"}
                value={draft.binding.i2c.addressBits ?? 7}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    binding: {
                      ...draft.binding,
                      i2c: {
                        ...draft.binding.i2c!,
                        addressBits: Number(e.target.value) as 7 | 10,
                      },
                    },
                  })
                }
                className={inputClass}
              >
                <option value={7}>7 bit</option>
                <option value={10}>10 bit</option>
              </select>
            </label>
          </>
        )}
        <span className="mb-2 ml-auto rounded-slpill bg-warning/20 px-2 py-0.5 font-body text-[10px] text-ink">
          {draft.status === "draft"
            ? it
              ? "Bozza"
              : "Draft"
            : it
              ? "Pronta"
              : "Ready"}
        </span>
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
              <DriverActionsList
                draft={draft}
                it={it}
                activeId={editorPane === "actions" ? activeActionId : null}
                onChange={setDraft}
                onSelect={selectDriverAction}
              />
              {draft.binding.bus !== "i2c" && (
                <>
                  <section className="rounded-slmd border border-border-strong p-3">
                    <h2 className="mb-2 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
                      {it ? "Connessioni" : "Connections"}
                    </h2>
                    <BindingPanel
                      draft={draft}
                      it={it}
                      physical={physicalDraft}
                      onChange={setDraft}
                      onOpenPhysical={() => navigate("physical-composition")}
                    />
                  </section>
                </>
              )}
              <section className="rounded-slmd border border-border-strong p-3">
                <h2 className="mb-2 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
                  {it ? "Aggiungi un passo" : "Add a step"}
                </h2>
                {draft.binding.bus === "i2c" && (
                  <div className="mb-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => addRegisterStep("read")}
                      className="rounded-slsm border border-border-strong px-2 py-2 font-body text-xs text-ink"
                    >
                      {it ? "+ Leggi registro" : "+ Read register"}
                    </button>
                    <button
                      type="button"
                      onClick={() => addRegisterStep("write")}
                      className="rounded-slsm border border-border-strong px-2 py-2 font-body text-xs text-ink"
                    >
                      {it ? "+ Scrivi registro" : "+ Write register"}
                    </button>
                  </div>
                )}
                <details open={draft.binding.bus !== "i2c"}>
                  <summary className="mb-2 cursor-pointer font-body text-xs text-ink-muted">
                    {it
                      ? "Tutte le operazioni · avanzate"
                      : "All operations · advanced"}
                  </summary>
                  <LibraryList
                    library={library}
                    bus={draft.binding.bus}
                    it={it}
                    onAdd={addLibraryOp}
                  />
                </details>
                {draft.binding.bus === "gpio" ? (
                  <div className="mt-3">
                    <p className="mb-1 font-body text-[10px] font-semibold text-ink-muted">
                      {it ? "Modelli" : "Templates"}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        const next = createGpioDigitalExample(draft.name);
                        setDraft(next);
                        setEditorPane("actions");
                        setSelectedCommandId(next.commands[0]?.id ?? null);
                        setSelectedOpId(next.commands[0]?.steps[0]?.id ?? null);
                      }}
                      className="w-full rounded-slsm border border-border-strong px-2 py-1.5 font-body text-[11px] hover:border-brand-blue"
                    >
                      {it ? "Ingresso digitale" : "Digital input"}
                    </button>
                  </div>
                ) : null}
                {draft.binding.bus === "adc" ? (
                  <div className="mt-3">
                    <p className="mb-1 font-body text-[10px] font-semibold text-ink-muted">
                      {it ? "Modelli" : "Templates"}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        const next = createAnalogLevelExample(draft.name);
                        setDraft(next);
                        setEditorPane("actions");
                        setSelectedCommandId(next.commands[0]?.id ?? null);
                        setSelectedOpId(next.commands[0]?.steps[0]?.id ?? null);
                      }}
                      className="w-full rounded-slsm border border-border-strong px-2 py-1.5 font-body text-[11px] hover:border-brand-blue"
                    >
                      {it ? "Livello analogico" : "Analog level"}
                    </button>
                  </div>
                ) : null}
                {draft.binding.bus === "w1" ? (
                  <div className="mt-3">
                    <p className="mb-1 font-body text-[10px] font-semibold text-ink-muted">
                      {it ? "Modelli" : "Templates"}
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        const next = createDs18b20Example(draft.name);
                        setDraft(next);
                        setEditorPane("actions");
                        setSelectedCommandId(next.commands[0]?.id ?? null);
                        setSelectedOpId(next.commands[0]?.steps[0]?.id ?? null);
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
              <DerivedSignalView
                draft={draft}
                ops={ops}
                it={it}
                selectedOpId={selectedOpId}
                onSelectOp={setSelectedOpId}
              />
              <div className="mb-3 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex rounded-slpill border border-border-strong bg-surface p-0.5">
                    {paneTabs.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        title={tab.hint}
                        onClick={() => {
                          setEditorPane(tab.id);
                          if (tab.id === "init") {
                            setSelectedOpId(draft.phases.init[0]?.id ?? null);
                          } else {
                            setSelectedOpId(
                              draft.commands.find((c) => c.id === activeActionId)
                                ?.steps[0]?.id ??
                                draft.commands[0]?.steps[0]?.id ??
                                null,
                            );
                          }
                        }}
                        className={`rounded-slpill px-3 py-1 font-body text-xs font-semibold ${
                          editorPane === tab.id
                            ? "bg-brand-blue text-white"
                            : "text-ink-muted"
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {draft.binding.bus === "i2c" && (
                <>
                  {editorPane === "actions" && (
                    <DriverActionSettings
                      draft={draft}
                      it={it}
                      activeId={activeActionId}
                      onChange={setDraft}
                      onSelect={selectDriverAction}
                    />
                  )}
                  <DriverSequence
                    initialization={editorPane === "init"}
                    draft={draft}
                    ops={ops}
                    it={it}
                    selectedId={selected?.id ?? null}
                    onSelect={setSelectedOpId}
                  />
                </>
              )}

              {draft.binding.bus === "adc" && editorPane === "actions" ? (
                <AnalogSamplingSummary ops={ops} it={it} />
              ) : null}

              {draft.binding.bus === "i2c" || draft.binding.bus === "spi" ? null : (
                <section className="mb-4 mt-4 rounded-slmd border border-border-strong bg-surface p-3">
                  <h2 className="mb-2 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
                    {it
                      ? `Sequenza ${draft.binding.bus.toUpperCase()}`
                      : `${draft.binding.bus.toUpperCase()} sequence`}
                  </h2>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {ops.length === 0 ? (
                      <p className="font-body text-xs text-ink-faint">
                        {it
                          ? "Nessun passo — aggiungi dalla libreria."
                          : "No steps — add from the library."}
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
                                : "border-border-strong bg-surface-sunken hover:border-brand-blue/40"
                            }`}
                          >
                            <span className="block font-mono text-[9px] text-ink-faint">
                              {index + 1}
                            </span>
                            <span className="block font-body text-xs font-semibold text-ink">
                              {describeDeviceOp(op)}
                            </span>
                          </button>
                          {index < ops.length - 1 ? (
                            <span className="text-ink-faint">→</span>
                          ) : null}
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
            <p className="mt-3 rounded-slmd border border-border-strong bg-surface px-3 py-2 font-body text-xs text-ink-muted">
              {tryMessage}
            </p>
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
                  {it ? "Configura il passo" : "Configure step"}
                </h2>
                {selected ? (
                  <StepInspector
                    op={selected}
                    draft={draft}
                    it={it}
                    onChange={patchSelected}
                    onDraftChange={setDraft}
                    onRemove={() => {
                      if (editorPane === "init") {
                        setDraft(removeOp(draft, "init", selected.id));
                      } else if (activeActionId) {
                        setDraft(removeCommandStep(draft, activeActionId, selected.id));
                      }
                      setSelectedOpId(null);
                    }}
                    onMove={(dir) => {
                      if (editorPane === "init") {
                        setDraft(moveOp(draft, "init", selected.id, dir));
                      } else if (activeActionId) {
                        setDraft(
                          moveCommandStep(draft, activeActionId, selected.id, dir),
                        );
                      }
                    }}
                  />
                ) : (
                  <p className="font-body text-xs text-ink-faint">
                    {it
                      ? "Seleziona un passo nella sequenza."
                      : "Select a step in the sequence."}
                  </p>
                )}
              </section>

              <details className="rounded-slmd border border-border p-2">
                <summary className="cursor-pointer font-body text-xs font-semibold text-ink">
                  {it
                    ? "Variabili e ingressi del canvas"
                    : "Variables and canvas inputs"}
                </summary>
                <VariablesPanel draft={draft} it={it} onChange={setDraft} />
              </details>

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
                          const v =
                            e.target.value === "" ? null : Number(e.target.value);
                          const adc = { ...draft.binding.adc!, calibMinMv: v };
                          const commands = draft.commands.map((c) => ({
                            ...c,
                            steps: c.steps.map((op) =>
                              op.type === "map_range" ? { ...op, inMin: v } : op,
                            ),
                          }));
                          setDraft({
                            ...draft,
                            binding: { ...draft.binding, adc },
                            commands,
                          });
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
                          const v =
                            e.target.value === "" ? null : Number(e.target.value);
                          const adc = { ...draft.binding.adc!, calibMaxMv: v };
                          const commands = draft.commands.map((c) => ({
                            ...c,
                            steps: c.steps.map((op) =>
                              op.type === "map_range" ? { ...op, inMax: v } : op,
                            ),
                          }));
                          setDraft({
                            ...draft,
                            binding: { ...draft.binding, adc },
                            commands,
                          });
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
                {draft.binding.bus === "i2c" ? (
                  <DriverCanvasPreview draft={draft} it={it} />
                ) : (
                  <>
                    <div className="rounded-slmd border border-border-strong bg-surface-sunken p-3">
                      <div className="flex items-center gap-2">
                        <Cpu size={16} className="text-brand-blue" />
                        <span className="font-body text-sm font-semibold text-ink">
                          {draft.name}
                        </span>
                      </div>
                      <ul className="mt-2 space-y-1">
                        {draft.channels
                          .filter((ch) => ch.direction === "read")
                          .map((ch) => {
                            const calibratedBlocked =
                              draft.binding.bus === "adc" && !calibOk;
                            return (
                              <li
                                key={ch.id}
                                className={`flex items-center justify-end gap-2 font-body text-xs ${
                                  calibratedBlocked
                                    ? "text-ink-faint line-through"
                                    : "text-ink"
                                }`}
                              >
                                {ch.label} · {ch.unit}
                                {calibratedBlocked ? (
                                  <span className="font-body text-[9px] no-underline">
                                    {it ? "non disponibile" : "unavailable"}
                                  </span>
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
                  </>
                )}
                {draft.runtimeUnavailable.length > 0 ? (
                  <p className="mt-2 font-body text-[10px] text-ink-faint">
                    {it ? "Runtime non disponibile:" : "Runtime unavailable:"}{" "}
                    {draft.runtimeUnavailable.join(", ")}
                  </p>
                ) : null}
              </section>
            </>
          )}
        </aside>
      </div>

      <footer className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-surface px-4 py-2.5">
        <span className="font-body text-[11px] text-ink-faint">
          {it ? "Ultima modifica:" : "Last edited:"}{" "}
          {new Date(draft.updatedAt).toLocaleString()}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleCancel}
            className="rounded-slpill px-3 py-1.5 font-body text-sm text-ink-muted hover:bg-surface-raised"
          >
            {it ? "Annulla" : "Cancel"}
          </button>
          <label className="inline-flex items-center gap-1.5 font-body text-xs text-ink-muted">
            <input
              type="checkbox"
              checked={testRunInitFirst}
              onChange={(e) => setTestRunInitFirst(e.target.checked)}
            />
            {it ? "con Init" : "with Init"}
          </label>
          <button
            type="button"
            disabled={testRunning}
            onClick={() => void handleRunHardwareTest()}
            className="inline-flex items-center gap-1.5 rounded-slpill border border-border-strong px-3 py-1.5 font-body text-sm text-ink hover:border-brand-blue disabled:opacity-40"
          >
            <Play size={14} />
            {testRunning
              ? it
                ? "Test…"
                : "Testing…"
              : it
                ? editorPane === "init"
                  ? "Testa init"
                  : "Testa azione"
                : editorPane === "init"
                  ? "Test init"
                  : "Test action"}
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
            {canvasActionCount > 1
              ? it
                ? `Genera ${canvasActionCount} blocchi Flow`
                : `Generate ${canvasActionCount} Flow blocks`
              : it
                ? "Genera blocco Flow"
                : "Generate Flow block"}
          </button>
        </div>
      </footer>

      {showBlockPreview ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-slmd border border-border-strong bg-surface p-4 shadow-e2">
            {draft.binding.bus === "i2c" ? (
              <DriverCanvasPreview draft={draft} it={it} />
            ) : (
              <BlockPreviewCard
                draft={draft}
                it={it}
                verified={
                  draft.verification.status === "passed" ||
                  draft.verification.status === "simulated"
                }
              />
            )}
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
                {it ? "Crea blocchi nel canvas" : "Create canvas blocks"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {testResult ? (
        <RecipeTestResultModal
          draft={draft}
          result={testResult}
          it={it}
          onClose={() => setTestResult(null)}
        />
      ) : null}
    </div>
  );
}

function recipeTestNote(result: RecipeHardwareTestResult, it: boolean): string {
  const err = result.error ? ` (${result.error})` : "";
  if (result.ok) {
    return (
      (it
        ? "Prova eseguita sulla Backbone. Canvas invariato."
        : "Test ran on Backbone. Canvas unchanged.") + err
    );
  }
  switch (result.kind) {
    case "no_client":
      return it
        ? "Diagramma pronto. Collega un Core READY per eseguire sul bus reale."
        : "Diagram ready. Connect a READY Core to run on the real bus.";
    case "empty_plan":
      return it
        ? "Nessun passo da eseguire (scegli un'azione con operazioni)."
        : "No steps to run.";
    case "profile_failed":
      return (
        (it
          ? "Profilo/config di prova non installabile."
          : "Test profile/config could not be installed.") + err
      );
    case "restore_failed":
      return (
        (it
          ? "Prova fallita e ripristino config non riuscito."
          : "Test failed and config restore failed.") + err
      );
    case "command_failed":
      return (
        (it
          ? "MODULE_COMMAND fallito. Canvas invariato."
          : "MODULE_COMMAND failed. Canvas unchanged.") + err
      );
    case "apply_failed":
      return (
        (result.restored
          ? it
            ? "Prova fallita; config precedente ripristinata."
            : "Test failed; previous config restored."
          : it
            ? "Prova fallita."
            : "Test failed.") + err
      );
    default:
      return result.note + err;
  }
}

function RecipeTestResultModal({
  draft,
  result,
  it,
  onClose,
}: {
  readonly draft: DeviceRecipeDraft;
  readonly result: RecipeHardwareTestResult;
  readonly it: boolean;
  readonly onClose: () => void;
}) {
  const ops = result.plan.steps.map((s) => s.op);
  const timing = buildProtocolTimingFromOps(draft, ops, {
    rxByOpId: result.capture.rxByOpId,
    emphasizeRx: true,
  });
  const rx = rxBlocksOf(result.capture);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-slmd border border-border-strong bg-surface p-4 shadow-e2">
        <h2 className="font-body-strong text-base text-ink">
          {it ? "Risultato prova" : "Test result"}
          <span
            className={`ml-2 rounded-slpill px-2 py-0.5 font-body text-[10px] font-semibold ${
              result.ok
                ? "bg-emerald-500/15 text-emerald-700"
                : "bg-amber-500/15 text-amber-800"
            }`}
          >
            {result.ok ? (it ? "OK" : "OK") : it ? "Attenzione" : "Notice"}
          </span>
        </h2>
        <p className="mt-1 font-body text-[11px] leading-snug text-ink-muted">
          {recipeTestNote(result, it)}
        </p>

        {rx.length > 0 ? (
          <div className="mt-3">
            <p className="mb-1.5 font-body text-[10px] font-bold uppercase tracking-widest text-ink-faint">
              {it ? "Blocchi ricevuti dal sensore" : "Blocks received from sensor"}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {rx.map((b) => (
                <span
                  key={`${b.opId}-${b.index}`}
                  className="rounded-slsm border border-emerald-600/30 bg-emerald-500/10 px-2 py-1 font-mono text-[11px] text-ink"
                >
                  RX{b.index}
                  <span className="ml-1.5 font-semibold text-emerald-700">
                    {b.value === null ? "—" : b.label}
                  </span>
                </span>
              ))}
            </div>
            {result.rxTruncated && (
              <p className="mt-1 font-body text-xs text-amber-700">
                {it
                  ? "Cattura parziale: sono mostrate le prime 8 letture."
                  : "Partial capture: only the first 8 reads are shown."}
              </p>
            )}
            <p className="mt-1 font-body text-[10px] text-ink-faint">
              {it
                ? "I byte ricevuti realmente dal sensore sono mostrati in HEX. «—» indica un valore non disponibile."
                : "Actual bytes received from the sensor are shown in HEX. “—” means unavailable."}
            </p>
          </div>
        ) : (
          <p className="mt-3 font-body text-xs text-ink-faint">
            {it
              ? "Solo scritture in questa selezione — nessuna lettura RX da mostrare (normale per Scrivi)."
              : "Write-only selection — no RX bytes to show (expected for Write)."}
          </p>
        )}

        {!!result.readResults?.length && (
          <section className="mt-3 rounded-slmd border border-border-strong p-3">
            <h3 className="mb-2 font-body text-xs font-semibold text-ink">
              {it ? "Risultati decodificati" : "Decoded results"}
            </h3>
            {result.readResults.map((value, index) => (
              <p key={`${value.id}-${index}`} className="font-body text-sm text-ink">
                {value.label}: <span className="font-mono">{value.value ?? "—"}</span>{" "}
                {value.unit}
              </p>
            ))}
          </section>
        )}

        {timing.lanes.length > 0 ? (
          <div className="mt-4 rounded-slmd border border-border-strong bg-surface p-3">
            <TimingScopeChart
              title={
                it ? "Segnali nel tempo (risposta)" : "Signals over time (response)"
              }
              caption={
                it
                  ? "STEP allineati · fasce verdi = RX dal sensore."
                  : "Aligned STEP · green bands = sensor RX."
              }
              lanes={timing.lanes}
              durationMs={timing.durationMs}
              phaseBands={timing.phaseBands}
              stepSpans={timing.stepSpans}
            />
          </div>
        ) : null}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-slpill bg-brand-blue px-4 py-1.5 font-body-strong text-sm text-white hover:bg-brand-blue-dark"
          >
            {it ? "Chiudi" : "Close"}
          </button>
        </div>
      </div>
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
      <button
        type="button"
        className="font-semibold text-brand-blue underline"
        onClick={onOpenPhysical}
      >
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
        <p className="font-semibold text-ink">
          {it ? "Tipo: Analogico" : "Type: Analog"}
        </p>
        <Field label={it ? "Ruolo nel sensore" : "Sensor role"}>
          <input
            value={adc.signalName}
            onChange={(e) =>
              onChange({
                ...draft,
                binding: {
                  ...draft.binding,
                  adc: { ...adc, signalName: e.target.value || "SIGNAL" },
                },
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
                binding: {
                  ...draft.binding,
                  adc: { ...adc, displayUnit: e.target.value as "raw" | "mV" },
                },
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
    const addressBits: 7 | 10 = i2c.addressBits === 10 ? 10 : 7;
    return (
      <div className="space-y-2 font-body text-xs">
        <Field label={it ? "Bit indirizzo" : "Address bits"}>
          <select
            value={addressBits}
            onChange={(e) => {
              const nextBits = e.target.value === "10" ? 10 : 7;
              onChange({
                ...draft,
                binding: {
                  ...draft.binding,
                  i2c: { ...i2c, addressBits: nextBits },
                },
              });
            }}
            className={inputClass}
          >
            <option value={7}>7 bit</option>
            <option value={10}>10 bit</option>
          </select>
        </Field>
        <Field label={it ? "Indirizzo" : "Address"}>
          <input
            value={i2c.address}
            onChange={(e) =>
              onChange({
                ...draft,
                binding: {
                  ...draft.binding,
                  i2c: { ...i2c, address: e.target.value, addressBits },
                },
              })
            }
            className={inputClass}
            placeholder={addressBits === 10 ? "0x048" : "0x48"}
            spellCheck={false}
            autoComplete="off"
          />
        </Field>
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
              {label} ·{" "}
              {physicalLabelForSignalMode(modes, mode, variant) ??
                (it ? "non assegnato" : "unassigned")}
            </div>
          ))}
        </div>
        <Field label={it ? "Modo" : "Mode"}>
          <select
            value={spi.mode}
            onChange={(e) =>
              onChange({
                ...draft,
                binding: {
                  ...draft.binding,
                  spi: { ...spi, mode: Number(e.target.value) as 0 | 1 | 2 | 3 },
                },
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
            onChange={(e) =>
              onChange({
                ...draft,
                binding: {
                  ...draft.binding,
                  spi: { ...spi, freqHz: Number(e.target.value) },
                },
              })
            }
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
            onChange={(e) =>
              onChange({
                ...draft,
                binding: {
                  ...draft.binding,
                  spi: { ...spi, misoRequired: e.target.checked },
                },
              })
            }
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
              <td>
                {sig.direction === "in"
                  ? it
                    ? "ingresso"
                    : "in"
                  : it
                    ? "uscita"
                    : "out"}
              </td>
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
          onChange({
            ...draft,
            binding: {
              ...draft.binding,
              gpioSignals: [...draft.binding.gpioSignals, sig],
            },
          });
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
        <span className="font-body text-xs font-semibold text-ink">
          {describeDeviceOp(op)}
        </span>
        <button
          type="button"
          aria-label={it ? "Sposta passo prima" : "Move step earlier"}
          onClick={() => onMove(-1)}
          className="ml-auto rounded-slsm border border-border p-0.5 text-ink-faint"
        >
          <ArrowUp size={12} />
        </button>
        <button
          type="button"
          aria-label={it ? "Sposta passo dopo" : "Move step later"}
          onClick={() => onMove(1)}
          className="rounded-slsm border border-border p-0.5 text-ink-faint"
        >
          <ArrowDown size={12} />
        </button>
        <button
          type="button"
          aria-label={it ? "Rimuovi passo" : "Remove step"}
          onClick={onRemove}
          className="rounded-slsm border border-border p-0.5 text-error"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {(op.type === "i2c_write" || op.type === "i2c_write_read") &&
        op.registerWidth && <RegisterStepFields op={op} it={it} onChange={onChange} />}
      {op.type === "sample_external" ? (
        <SampleExternalFields
          op={op}
          draft={draft}
          it={it}
          onChange={onChange}
          onDraftChange={onDraftChange}
        />
      ) : null}

      {op.type === "i2c_write" && !op.registerWidth ? (
        <I2cWriteFields op={op} draft={draft} it={it} onChange={onChange} />
      ) : null}

      {op.type === "i2c_read" ? (
        <>
          <Field
            label={
              it ? "Indirizzo dispositivo (7 bit HEX)" : "Device address (7-bit HEX)"
            }
          >
            <input
              value={op.address ?? draft.binding.i2c?.address ?? ""}
              onChange={(e) =>
                onChange({ ...op, address: e.target.value.trim() || undefined })
              }
              className={inputClass}
              placeholder="0x48"
              spellCheck={false}
            />
          </Field>
          <Field label={it ? "Byte da leggere" : "Bytes to read"}>
            <input
              type="number"
              min={1}
              value={op.len}
              onChange={(e) =>
                onChange({ ...op, len: Math.max(1, Number(e.target.value) || 1) })
              }
              className={inputClass}
            />
          </Field>
          <Field label={it ? "Salva in" : "Save to"}>
            <input
              value={op.into}
              onChange={(e) => onChange({ ...op, into: e.target.value })}
              className={inputClass}
            />
          </Field>
        </>
      ) : null}

      {op.type === "i2c_write_read" && !op.registerWidth ? (
        <>
          <Field
            label={
              it ? "Indirizzo dispositivo (7 bit HEX)" : "Device address (7-bit HEX)"
            }
          >
            <input
              value={op.address ?? draft.binding.i2c?.address ?? ""}
              onChange={(e) =>
                onChange({ ...op, address: e.target.value.trim() || undefined })
              }
              className={inputClass}
              placeholder="0x48"
              spellCheck={false}
            />
          </Field>
          <HexByteCellsEditor
            opId={op.id}
            bytes={op.writeBytes}
            it={it}
            label={it ? "Byte da scrivere" : "Bytes to write"}
            onChange={(writeBytes) => onChange({ ...op, writeBytes })}
          />
          <Field label={it ? "Byte da leggere" : "Bytes to read"}>
            <input
              type="number"
              min={1}
              value={op.readLen}
              onChange={(e) =>
                onChange({ ...op, readLen: Math.max(1, Number(e.target.value) || 1) })
              }
              className={inputClass}
            />
          </Field>
          <Field label={it ? "Salva in" : "Save to"}>
            <input
              value={op.into}
              onChange={(e) => onChange({ ...op, into: e.target.value })}
              className={inputClass}
            />
          </Field>
          <p className="font-body text-[10px] text-ink-faint">
            {it
              ? "RESTART generato automaticamente (nessuno STOP intermedio)."
              : "RESTART is generated automatically (no intermediate STOP)."}
          </p>
        </>
      ) : null}

      {op.type === "i2c_scan" ? (
        <>
          <Field label={it ? "Da indirizzo" : "From address"}>
            <input
              value={op.fromAddress}
              onChange={(e) =>
                onChange({ ...op, fromAddress: e.target.value.trim() || "0x08" })
              }
              className={inputClass}
              placeholder="0x08"
              spellCheck={false}
            />
          </Field>
          <Field label={it ? "A indirizzo" : "To address"}>
            <input
              value={op.toAddress}
              onChange={(e) =>
                onChange({ ...op, toAddress: e.target.value.trim() || "0x77" })
              }
              className={inputClass}
              placeholder="0x77"
              spellCheck={false}
            />
          </Field>
          <Field label={it ? "Salva in" : "Save to"}>
            <input
              value={op.into ?? "found"}
              onChange={(e) => onChange({ ...op, into: e.target.value })}
              className={inputClass}
            />
          </Field>
        </>
      ) : null}

      {op.type === "i2c_transaction" ? (
        <I2cTransactionFields op={op} draft={draft} it={it} onChange={onChange} />
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
              onChange={(e) =>
                onChange({ ...op, rxLen: Math.max(0, Number(e.target.value) || 0) })
              }
              className={inputClass}
            />
          </Field>
          <Field label={it ? "Salva in" : "Save to"}>
            <input
              value={op.into}
              onChange={(e) => onChange({ ...op, into: e.target.value })}
              className={inputClass}
            />
          </Field>
          <label className="flex items-center gap-2 font-body text-[11px] text-ink-muted">
            <input
              type="checkbox"
              checked={op.keepCs}
              onChange={(e) => onChange({ ...op, keepCs: e.target.checked })}
            />
            {it ? "Mantieni CS attivo" : "Keep CS active"}
          </label>
          <p className="font-body text-[10px] text-ink-faint">
            {it ? "Invio e ricezione avvengono insieme." : "TX and RX happen together."}
          </p>
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
                  onChange={(e) =>
                    onChange({ ...op, sampleMs: Number(e.target.value) || 5 })
                  }
                  className={inputClass}
                />
              </Field>
              <Field label={it ? "Stabilità (ms)" : "Stable (ms)"}>
                <input
                  type="number"
                  value={op.stableMs}
                  onChange={(e) =>
                    onChange({ ...op, stableMs: Number(e.target.value) || 20 })
                  }
                  className={inputClass}
                />
              </Field>
            </>
          ) : null}
          <Field label={it ? "Salva in" : "Save to"}>
            <input
              value={op.into}
              onChange={(e) => onChange({ ...op, into: e.target.value })}
              className={inputClass}
            />
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
        <div className="flex gap-1.5">
          <Field label={it ? "Durata" : "Duration"}>
            <input
              type="number"
              min={0}
              value={op.ms}
              onChange={(e) =>
                onChange({ ...op, ms: Math.max(0, Number(e.target.value) || 0) })
              }
              className={inputClass}
            />
          </Field>
          <Field label={it ? "Unità" : "Unit"}>
            <select
              value={op.unit === "us" ? "us" : "ms"}
              onChange={(e) =>
                onChange({ ...op, unit: e.target.value as WaitTimeUnit })
              }
              className={inputClass}
            >
              <option value="ms">ms</option>
              <option value="us">µs</option>
            </select>
          </Field>
        </div>
      ) : null}

      {op.type === "adc_sample" ? (
        <>
          <Field label={it ? "Ingresso" : "Input"}>
            <input
              value={draft.binding.adc?.signalName ?? "SIGNAL"}
              readOnly
              className={`${inputClass} opacity-70`}
            />
          </Field>
          <Field label={it ? "Formato" : "Format"}>
            <select
              value={draft.binding.adc?.supportsMv ? op.format : "raw"}
              onChange={(e) =>
                onChange({ ...op, format: e.target.value as "raw" | "mV" })
              }
              className={inputClass}
              disabled={!draft.binding.adc?.supportsMv}
            >
              {draft.binding.adc?.supportsMv ? <option value="mV">mV</option> : null}
              <option value="raw">raw</option>
            </select>
          </Field>
          <Field label={it ? "Salva in" : "Save to"}>
            <input
              value={op.into}
              onChange={(e) => onChange({ ...op, into: e.target.value })}
              className={inputClass}
            />
          </Field>
        </>
      ) : null}

      {op.type === "adc_multi_sample" ? (
        <>
          <Field label={it ? "Ingresso" : "Input"}>
            <input
              value={draft.binding.adc?.signalName ?? "SIGNAL"}
              readOnly
              className={`${inputClass} opacity-70`}
            />
          </Field>
          <Field label={it ? "Numero campioni" : "Sample count"}>
            <input
              type="number"
              min={2}
              value={op.count}
              onChange={(e) =>
                onChange({ ...op, count: Math.max(2, Number(e.target.value) || 2) })
              }
              className={inputClass}
            />
          </Field>
          <Field
            label={it ? "Intervallo tra campioni (ms)" : "Gap between samples (ms)"}
          >
            <input
              type="number"
              min={0}
              value={op.intervalMs}
              onChange={(e) =>
                onChange({
                  ...op,
                  intervalMs: Math.max(0, Number(e.target.value) || 0),
                })
              }
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
              onChange={(e) =>
                onChange({ ...op, format: e.target.value as "raw" | "mV" })
              }
              className={inputClass}
              disabled={!draft.binding.adc?.supportsMv}
            >
              {draft.binding.adc?.supportsMv ? <option value="mV">mV</option> : null}
              <option value="raw">raw</option>
            </select>
          </Field>
          <Field label={it ? "Salva in" : "Save to"}>
            <input
              value={op.into}
              onChange={(e) => onChange({ ...op, into: e.target.value })}
              className={inputClass}
            />
          </Field>
        </>
      ) : null}

      {op.type === "average" ? (
        <>
          <Field label="Input">
            <input
              value={op.input}
              onChange={(e) => onChange({ ...op, input: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label={it ? "Salva in" : "Save to"}>
            <input
              value={op.into}
              onChange={(e) => onChange({ ...op, into: e.target.value })}
              className={inputClass}
            />
          </Field>
          <p className="font-body text-[10px] text-ink-faint">
            {it
              ? "Un solo passo Media (anche se riassunto altrove)."
              : "Single Average step (even if summarized elsewhere)."}
          </p>
        </>
      ) : null}

      {op.type === "filter" ? (
        <>
          <Field label="Input">
            <input
              value={op.input}
              onChange={(e) => onChange({ ...op, input: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label={it ? "Tipo" : "Kind"}>
            <select
              value={op.kind}
              onChange={(e) =>
                onChange({ ...op, kind: e.target.value as "moving_avg" | "median" })
              }
              className={inputClass}
            >
              <option value="moving_avg">
                {it ? "Media mobile" : "Moving average"}
              </option>
              <option value="median">{it ? "Mediana" : "Median"}</option>
            </select>
          </Field>
          <Field label={it ? "Finestra" : "Window"}>
            <input
              type="number"
              min={2}
              value={op.window}
              onChange={(e) =>
                onChange({ ...op, window: Math.max(2, Number(e.target.value) || 2) })
              }
              className={inputClass}
            />
          </Field>
          <Field label={it ? "Salva in" : "Save to"}>
            <input
              value={op.into}
              onChange={(e) => onChange({ ...op, into: e.target.value })}
              className={inputClass}
            />
          </Field>
        </>
      ) : null}

      {op.type === "map_range" ? (
        <>
          <Field label="Input">
            <input
              value={op.input}
              onChange={(e) => onChange({ ...op, input: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label={it ? "Out min/max" : "Out min/max"}>
            <div className="flex gap-1">
              <input
                type="number"
                value={op.outMin}
                onChange={(e) =>
                  onChange({ ...op, outMin: Number(e.target.value) || 0 })
                }
                className={inputClass}
              />
              <input
                type="number"
                value={op.outMax}
                onChange={(e) =>
                  onChange({ ...op, outMax: Number(e.target.value) || 0 })
                }
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
            <input
              type="checkbox"
              checked={op.saturate}
              onChange={(e) => onChange({ ...op, saturate: e.target.checked })}
            />
            {it
              ? "Saturazione esplicita fuori range"
              : "Explicit saturation outside range"}
          </label>
          <Field label={it ? "Salva in" : "Save to"}>
            <input
              value={op.into}
              onChange={(e) => onChange({ ...op, into: e.target.value })}
              className={inputClass}
            />
          </Field>
        </>
      ) : null}

      {op.type === "spi_cs" ? (
        <label className="flex items-center gap-2 font-body text-[11px] text-ink-muted">
          <input
            type="checkbox"
            checked={op.assert}
            onChange={(e) => onChange({ ...op, assert: e.target.checked })}
          />
          {it ? "CS basso (assert)" : "Assert CS (low)"}
        </label>
      ) : null}

      {op.type === "w1_reset" ? (
        <Field label={it ? "Salva presenza in" : "Presence into"}>
          <input
            value={op.intoPresence}
            onChange={(e) => onChange({ ...op, intoPresence: e.target.value })}
            className={inputClass}
          />
        </Field>
      ) : null}
      {op.type === "w1_match_rom" ? (
        <>
          <Field label="ROM">
            <input
              value={op.rom}
              placeholder={
                draft.binding.w1?.rom ||
                (it ? "Usa ROM del binding" : "Use binding ROM")
              }
              onChange={(e) => onChange({ ...op, rom: e.target.value })}
              className={inputClass}
            />
          </Field>
          <p className="font-body text-[10px] text-ink-faint">
            {it
              ? "Vuoto = ROM del dispositivo nella sidebar."
              : "Empty = device ROM from the sidebar."}
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
              onChange={(e) =>
                onChange({ ...op, len: Math.max(1, Number(e.target.value) || 1) })
              }
              className={inputClass}
            />
          </Field>
          <Field label={it ? "Salva in" : "Save to"}>
            <input
              value={op.into}
              onChange={(e) => onChange({ ...op, into: e.target.value })}
              className={inputClass}
            />
          </Field>
        </>
      ) : null}
      {op.type === "w1_wait_convert" ? (
        <>
          <Field label={it ? "Strategia" : "Strategy"}>
            <select
              value={op.strategy}
              onChange={(e) =>
                onChange({ ...op, strategy: e.target.value as "fixed_max" | "poll" })
              }
              className={inputClass}
            >
              <option value="fixed_max">
                {it ? "Timeout max (datasheet)" : "Fixed max (datasheet)"}
              </option>
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
              onChange={(e) =>
                onChange({ ...op, timeoutMs: Math.max(1, Number(e.target.value) || 1) })
              }
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
            <input
              value={op.input}
              onChange={(e) => onChange({ ...op, input: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label={it ? "Byte (incl. CRC)" : "Bytes (incl. CRC)"}>
            <input
              type="number"
              min={2}
              value={op.len}
              onChange={(e) =>
                onChange({ ...op, len: Math.max(2, Number(e.target.value) || 2) })
              }
              className={inputClass}
            />
          </Field>
          <Field label={it ? "Esito in" : "OK into"}>
            <input
              value={op.intoOk}
              onChange={(e) => onChange({ ...op, intoOk: e.target.value })}
              className={inputClass}
            />
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
    onChange({
      ...draft,
      binding: { ...draft.binding, w1: { ...w1, rom: check.rom } },
    });
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
      {searchNote ? (
        <p className="font-body text-[10px] text-ink-faint">{searchNote}</p>
      ) : null}
      <Field label={it ? "Risoluzione (°C)" : "Resolution"}>
        <select
          value={w1.resolutionBits ?? 12}
          onChange={(e) =>
            onChange({
              ...draft,
              binding: {
                ...draft.binding,
                w1: {
                  ...w1,
                  resolutionBits: Number(e.target.value) as 9 | 10 | 11 | 12,
                },
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
            <p className="font-body text-[10px] text-ink-faint">
              {it ? "Nessun input" : "No inputs"}
            </p>
          ) : (
            inputs.map((p) => (
              <div
                key={p.id}
                className="rounded-slsm border border-border-strong bg-surface px-1.5 py-1 text-right"
              >
                <p className="font-body text-[10px] font-semibold text-ink">
                  {p.label}
                </p>
                <p className="font-mono text-[9px] text-ink-faint">
                  {p.valueType}
                  {p.unit ? ` · ${p.unit}` : ""}
                </p>
              </div>
            ))
          )}
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-center justify-center rounded-slmd border-2 border-ink bg-surface px-3 py-4 shadow-e1">
          <p className="text-center font-heading text-sm font-bold text-ink">
            {draft.name || (it ? "Dispositivo" : "Device")}
          </p>
          <p className="mt-0.5 font-mono text-[10px] uppercase text-ink-faint">
            {draft.binding.bus}
          </p>
        </div>
        <div className="flex w-28 flex-col justify-center gap-1.5">
          {outputs.length === 0 ? (
            <p className="font-body text-[10px] text-ink-faint">
              {it ? "Nessun output" : "No outputs"}
            </p>
          ) : (
            outputs.map((p) => (
              <div
                key={p.id}
                className="rounded-slsm border border-border-strong bg-surface px-1.5 py-1"
              >
                <p className="font-body text-[10px] font-semibold text-ink">
                  {p.label}
                </p>
                <p className="font-mono text-[9px] text-ink-faint">
                  {p.valueType}
                  {p.unit ? ` · ${p.unit}` : ""}
                </p>
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
      channels: draft.channels.map((c) =>
        c.id === channel.id ? { ...c, ...patch } : c,
      ),
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
          const withChannel: DeviceRecipeDraft = {
            ...draft,
            channels: [
              ...draft.channels,
              {
                id,
                label: it
                  ? `Uscita ${readChannels.length + 1}`
                  : `Output ${readChannels.length + 1}`,
                unit: "",
                quantity: "other",
                direction: "read",
              },
            ],
          };
          onDraftChange(updateOpAnywhere(withChannel, op.id, { ...op, channelId: id }));
        }}
      >
        + {it ? "Nuovo output" : "New output"}
      </button>
      {channel ? (
        <>
          <Field label={it ? "Etichetta sul blocco" : "Block label"}>
            <input
              value={channel.label}
              onChange={(e) => patchChannel({ label: e.target.value })}
              className={inputClass}
            />
          </Field>
          <Field label={it ? "Tipo grandezza" : "Quantity type"}>
            <select
              value={channel.quantity}
              onChange={(e) =>
                patchChannel({ quantity: e.target.value as SensorOutputKind })
              }
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
            <input
              value={channel.unit}
              onChange={(e) => patchChannel({ unit: e.target.value })}
              className={inputClass}
              placeholder="°C, %, …"
            />
          </Field>
        </>
      ) : null}
      <Field label="from">
        <input
          value={op.from}
          onChange={(e) => onChange({ ...op, from: e.target.value })}
          className={inputClass}
        />
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
          onChange={(e) =>
            onChange({ ...op, into: normalizeRecipeVarName(e.target.value) })
          }
          className={inputClass}
        />
      </Field>
      <Field label={it ? "Tipo uscita" : "Output type"}>
        <select
          value={op.outType ?? "number"}
          onChange={(e) =>
            onChange({ ...op, outType: e.target.value as RecipeVarType })
          }
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
            onChange={(e) =>
              onChange({ ...op, startByte: Number(e.target.value) || 0 })
            }
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
          onChange={(e) =>
            onChange({ ...op, byteOrder: e.target.value as "be" | "le" })
          }
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
          onChange={(e) =>
            onChange({ ...op, fromType: e.target.value as RecipeVarType })
          }
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
          onChange={(e) =>
            onChange({ ...op, into: normalizeRecipeVarName(e.target.value) })
          }
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
              onChange={(e) =>
                onChange({
                  ...op,
                  widthBytes: Math.max(1, Math.min(8, Number(e.target.value) || 1)),
                })
              }
              className={inputClass}
            />
          </Field>
          <Field label={it ? "Ordine byte" : "Byte order"}>
            <select
              value={op.byteOrder}
              onChange={(e) =>
                onChange({ ...op, byteOrder: e.target.value as "be" | "le" })
              }
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

function stripHexPrefix(raw: string): string {
  return raw.trim().replace(/^0x/i, "").toUpperCase();
}

/**
 * Per-byte HEX cells (local typing state). Avoids free-form parse-on-keystroke
 * that pads `A` → `0x0A` and then drops the second digit as invalid.
 */
function HexByteCellsEditor({
  opId,
  bytes,
  it,
  label,
  onChange,
}: {
  readonly opId: string;
  readonly bytes: readonly string[];
  readonly it: boolean;
  readonly label: string;
  readonly onChange: (tokens: readonly string[]) => void;
}) {
  const [cells, setCells] = useState<string[]>(() =>
    (bytes.length > 0 ? bytes : ["0x00"]).map(stripHexPrefix),
  );

  useEffect(() => {
    setCells((bytes.length > 0 ? bytes : ["0x00"]).map(stripHexPrefix));
  }, [opId]);

  function persist(nextCells: readonly string[]) {
    const stored = nextCells.map((c) => {
      const n = parseHexByteToken(c);
      return n === null ? "0x00" : formatHexByte(n);
    });
    onChange(stored);
  }

  function updateCell(index: number, value: string) {
    let v = value.replace(/^0x/i, "").toUpperCase();
    v = v.replace(/[^0-9A-F]/g, "").slice(0, 2);
    const next = [...cells];
    next[index] = v;
    setCells(next);
    persist(next);
  }

  function addByte() {
    const next = [...cells, ""];
    setCells(next);
    persist(next.map((c) => (c === "" ? "00" : c)));
    requestAnimationFrame(() => {
      const el = document.querySelector<HTMLInputElement>(
        `[data-i2c-byte="${opId}-${cells.length}"]`,
      );
      el?.focus();
      el?.select();
    });
  }

  function removeByte(index: number) {
    if (cells.length <= 1) return;
    const next = cells.filter((_, i) => i !== index);
    setCells(next);
    persist(next);
  }

  return (
    <div className="space-y-1">
      <span className="block font-body text-[10px] text-ink-muted">
        {label}{" "}
        <span className="text-ink-faint">
          ({cells.length} {it ? "nella stessa transazione" : "in one transaction"})
        </span>
      </span>
      <ul className="flex flex-col gap-1">
        {cells.map((cell, index) => {
          const valid = cell === "" || parseHexByteToken(cell) !== null;
          return (
            <li key={`${opId}-b${index}`} className="flex items-center gap-1.5">
              <span className="w-4 shrink-0 text-right font-mono text-[10px] text-ink-faint">
                {index}
              </span>
              <span className="font-mono text-[11px] text-ink-faint">0x</span>
              <input
                data-i2c-byte={`${opId}-${index}`}
                value={cell}
                onChange={(e) => updateCell(index, e.target.value)}
                onBlur={() => {
                  if (cell === "") {
                    updateCell(index, "00");
                    return;
                  }
                  if (cell.length === 1 && parseHexByteToken(cell) !== null) {
                    updateCell(index, cell.padStart(2, "0"));
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || (e.key === " " && cell.length >= 2)) {
                    e.preventDefault();
                    if (index === cells.length - 1) addByte();
                    else {
                      document
                        .querySelector<HTMLInputElement>(
                          `[data-i2c-byte="${opId}-${index + 1}"]`,
                        )
                        ?.focus();
                      document
                        .querySelector<HTMLInputElement>(
                          `[data-i2c-byte="${opId}-${index + 1}"]`,
                        )
                        ?.select();
                    }
                  }
                  if (e.key === "Backspace" && cell === "" && cells.length > 1) {
                    e.preventDefault();
                    removeByte(index);
                    requestAnimationFrame(() => {
                      document
                        .querySelector<HTMLInputElement>(
                          `[data-i2c-byte="${opId}-${Math.max(0, index - 1)}"]`,
                        )
                        ?.focus();
                    });
                  }
                }}
                className={`${inputClass} w-14 text-center font-mono text-sm ${
                  valid ? "" : "border-error"
                }`}
                placeholder="00"
                spellCheck={false}
                autoComplete="off"
                autoCorrect="off"
                inputMode="text"
                maxLength={2}
                aria-label={it ? `Byte ${index}` : `Byte ${index}`}
              />
              <button
                type="button"
                disabled={cells.length <= 1}
                onClick={() => removeByte(index)}
                className="rounded p-1 text-ink-faint hover:bg-surface-raised hover:text-error disabled:opacity-30"
                aria-label={it ? "Rimuovi byte" : "Remove byte"}
              >
                <Trash2 size={12} />
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={addByte}
        className="flex w-full items-center justify-center gap-1 rounded-slsm border border-dashed border-border-strong py-1.5 font-body text-[11px] text-brand-blue hover:bg-brand-blue/5"
      >
        <Plus size={12} />
        {it ? "Aggiungi byte" : "Add byte"}
      </button>
      <p className="font-body text-[10px] text-ink-faint">
        {it
          ? "Due cifre HEX per campo (00–FF). Invio o spazio: campo successivo."
          : "Two HEX digits per field (00–FF). Enter or space: next field."}
      </p>
    </div>
  );
}

function RegisterAddressField({
  value,
  width,
  it,
  onCommit,
}: {
  value: string;
  width: number;
  it: boolean;
  onCommit: (value: string) => void;
}) {
  const [text, setText] = useState(value);
  const [error, setError] = useState(false);
  return (
    <>
      <input
        aria-label={it ? "Registro HEX" : "Register HEX"}
        aria-invalid={error}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setError(false);
        }}
        onBlur={() => {
          const raw = text.trim().replace(/^0x/i, "");
          if (!new RegExp(`^[0-9a-fA-F]{1,${width * 2}}$`).test(raw)) {
            setError(true);
            return;
          }
          const normalized = raw.toUpperCase().padStart(width * 2, "0");
          setText(normalized);
          onCommit(normalized);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className={inputClass}
        spellCheck={false}
      />
      {error && (
        <p role="alert" className="font-body text-xs text-error">
          {it ? "Inserisci un indirizzo HEX valido." : "Enter a valid HEX address."}
        </p>
      )}
    </>
  );
}

function RegisterStepFields({
  op,
  it,
  onChange,
}: {
  op: Extract<DeviceRecipeOp, { type: "i2c_write" | "i2c_write_read" }>;
  it: boolean;
  onChange: (op: DeviceRecipeOp) => void;
}) {
  const width = op.registerWidth ?? 1;
  const bytes = op.type === "i2c_write" ? op.bytes : op.writeBytes;
  const register = bytes.slice(0, width);
  const payload = bytes.slice(width);
  function changeBytes(next: readonly string[]) {
    onChange(
      op.type === "i2c_write" ? { ...op, bytes: next } : { ...op, writeBytes: next },
    );
  }
  return (
    <>
      <Field label={it ? "Indirizzo del registro" : "Register address"}>
        <RegisterAddressField
          key={`${op.id}-${width}`}
          value={register.join("")}
          width={width}
          it={it}
          onCommit={(raw) =>
            changeBytes([
              ...Array.from({ length: width }, (_, i) => raw.slice(i * 2, i * 2 + 2)),
              ...payload,
            ])
          }
        />
      </Field>
      {op.type === "i2c_write" ? (
        <HexByteCellsEditor
          opId={op.id}
          bytes={payload}
          it={it}
          label={it ? "Valore da scrivere" : "Value to write"}
          onChange={(next) => changeBytes([...register, ...next])}
        />
      ) : (
        <>
          <Field label={it ? "Byte da leggere" : "Bytes to read"}>
            <input
              type="number"
              min={1}
              max={8}
              value={op.readLen}
              onChange={(e) =>
                onChange({
                  ...op,
                  readLen: Math.max(1, Math.min(8, Number(e.target.value) || 1)),
                })
              }
              className={inputClass}
            />
          </Field>
          <Field label={it ? "Salva byte in" : "Save bytes to"}>
            <input
              className={inputClass}
              value={op.into}
              onChange={(e) => onChange({ ...op, into: e.target.value })}
            />
          </Field>
          <p className="font-body text-xs text-ink-muted">
            {it
              ? "Scrittura del registro + RESTART + lettura. Usa Decodifica e Pubblica risultato per l’uscita."
              : "Write register + RESTART + read. Use Decode and Publish result for the output."}
          </p>
        </>
      )}
      <details className="rounded-slsm border border-border p-2">
        <summary className="cursor-pointer font-body text-xs text-ink-muted">
          {it ? "Dettagli tecnici del registro" : "Register technical details"}
        </summary>{" "}
        <Field label={it ? "Dimensione indirizzo registro" : "Register address width"}>
          <select
            className={inputClass}
            value={width}
            onChange={(e) => {
              const nextWidth = Number(e.target.value) as 1 | 2;
              const nextRegister = register
                .join("")
                .padStart(nextWidth * 2, "0")
                .slice(-nextWidth * 2);
              const nextBytes = [
                ...Array.from({ length: nextWidth }, (_, i) =>
                  nextRegister.slice(i * 2, i * 2 + 2),
                ),
                ...payload,
              ];
              onChange(
                op.type === "i2c_write"
                  ? { ...op, registerWidth: nextWidth, bytes: nextBytes }
                  : { ...op, registerWidth: nextWidth, writeBytes: nextBytes },
              );
            }}
          >
            <option value={1}>8 bit</option>
            <option value={2}>16 bit · MSB first</option>
          </select>
        </Field>
      </details>
    </>
  );
}

function I2cWriteFields({
  op,
  draft,
  it,
  onChange,
}: {
  readonly op: Extract<DeviceRecipeOp, { type: "i2c_write" }>;
  readonly draft: DeviceRecipeDraft;
  readonly it: boolean;
  readonly onChange: (next: DeviceRecipeOp) => void;
}) {
  return (
    <div className="space-y-2">
      <div>
        <span className="mb-0.5 block font-body text-[10px] text-ink-muted">
          {it ? "Indirizzo (7 bit HEX)" : "Address (7-bit HEX)"}
        </span>
        <input
          value={op.address ?? draft.binding.i2c?.address ?? ""}
          onChange={(e) =>
            onChange({ ...op, address: e.target.value.trim() || undefined })
          }
          className={inputClass}
          placeholder="3C"
          spellCheck={false}
          autoComplete="off"
        />
      </div>
      <HexByteCellsEditor
        opId={op.id}
        bytes={op.bytes}
        it={it}
        label={it ? "Byte da inviare" : "Bytes to send"}
        onChange={(bytes) => onChange({ ...op, bytes })}
      />
    </div>
  );
}

function I2cTransactionFields({
  op,
  draft,
  it,
  onChange,
}: {
  readonly op: Extract<DeviceRecipeOp, { type: "i2c_transaction" }>;
  readonly draft: DeviceRecipeDraft;
  readonly it: boolean;
  readonly onChange: (next: DeviceRecipeOp) => void;
}) {
  const errors = validateI2cTransactionPhases(op.phases);
  const setPhases = (phases: readonly I2cTransactionPhase[]) =>
    onChange({ ...op, phases });
  const patchPhase = (index: number, phase: I2cTransactionPhase) => {
    const next = op.phases.map((p, i) => (i === index ? phase : p));
    setPhases(next);
  };
  const removePhase = (index: number) =>
    setPhases(op.phases.filter((_, i) => i !== index));
  const addPhase = (kind: I2cTransactionPhase["kind"]) => {
    const phase: I2cTransactionPhase =
      kind === "write"
        ? { kind: "write", bytes: ["0x00"] }
        : kind === "read"
          ? { kind: "read", len: 1 }
          : { kind };
    setPhases([...op.phases, phase]);
  };

  return (
    <>
      <Field
        label={it ? "Indirizzo dispositivo (7 bit HEX)" : "Device address (7-bit HEX)"}
      >
        <input
          value={op.address ?? draft.binding.i2c?.address ?? ""}
          onChange={(e) =>
            onChange({ ...op, address: e.target.value.trim() || undefined })
          }
          className={inputClass}
          placeholder="0x48"
          spellCheck={false}
        />
      </Field>
      <div className="space-y-1.5">
        <p className="font-body text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
          {it ? "Fasi" : "Phases"}
        </p>
        {op.phases.map((phase, index) => (
          <div
            key={`${phase.kind}-${index}`}
            className="flex items-start gap-1 rounded-slsm border border-border bg-surface-sunken px-1.5 py-1"
          >
            <span className="w-14 shrink-0 pt-1 font-mono text-[10px] font-semibold uppercase text-ink">
              {phase.kind === "restart" ? "Sr" : phase.kind}
            </span>
            {phase.kind === "write" ? (
              <input
                value={phase.bytes.join(" ")}
                onChange={(e) =>
                  patchPhase(index, {
                    kind: "write",
                    bytes: e.target.value
                      .split(/\s+/)
                      .map((s) => s.trim())
                      .filter(Boolean),
                  })
                }
                className={`${inputClass} flex-1`}
                placeholder="0x00 0x1A"
                spellCheck={false}
              />
            ) : null}
            {phase.kind === "read" ? (
              <input
                type="number"
                min={1}
                value={phase.len}
                onChange={(e) =>
                  patchPhase(index, {
                    kind: "read",
                    len: Math.max(1, Number(e.target.value) || 1),
                  })
                }
                className={`${inputClass} w-20`}
              />
            ) : null}
            {phase.kind === "start" ||
            phase.kind === "restart" ||
            phase.kind === "stop" ? (
              <span className="flex-1 pt-1 font-body text-[10px] text-ink-faint">
                {phase.kind === "start"
                  ? "START"
                  : phase.kind === "restart"
                    ? "RESTART"
                    : "STOP"}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => removePhase(index)}
              className="rounded p-1 text-ink-faint hover:bg-surface hover:text-error"
              aria-label={it ? "Rimuovi fase" : "Remove phase"}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        <div className="flex flex-wrap gap-1">
          {(["start", "write", "read", "restart", "stop"] as const).map((kind) => (
            <button
              key={kind}
              type="button"
              onClick={() => addPhase(kind)}
              className="rounded-slsm border border-border px-1.5 py-0.5 font-mono text-[10px] uppercase text-ink-muted hover:border-brand-blue hover:text-brand-blue"
            >
              + {kind === "restart" ? "Sr" : kind}
            </button>
          ))}
        </div>
        {errors.length > 0 ? (
          <ul className="space-y-0.5 font-body text-[10px] text-error">
            {errors.map((msg) => (
              <li key={msg}>{msg}</li>
            ))}
          </ul>
        ) : (
          <p className="font-body text-[10px] text-ink-faint">
            {it ? "Sequenza valida." : "Sequence valid."}
          </p>
        )}
      </div>
      <Field label={it ? "Salva in" : "Save to"}>
        <input
          value={op.into ?? "raw"}
          onChange={(e) => onChange({ ...op, into: e.target.value })}
          className={inputClass}
        />
      </Field>
    </>
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
          ? "Legge un ingresso Flow e lo mette in una variabile (usabile in Init e Azioni)."
          : "Reads a Flow input into a variable (usable in Init and Actions)."}
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
                label: it
                  ? `Ingresso ${writeChannels.length + 1}`
                  : `Input ${writeChannels.length + 1}`,
              });
              onDraftChange(
                updateOpAnywhere(ensured.draft, op.id, {
                  ...op,
                  fromChannelId: ensured.channelId,
                }),
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
            onDraftChange(
              updateOpAnywhere({ ...draft, channels }, op.id, { ...op, valueType }),
            );
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
          value={
            draft.channels.find((c) => c.id === op.fromChannelId)?.label ??
            op.fromChannelId
          }
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
          ? "Globali tra Inizializzazione e Azioni. Ingresso le aggiorna da un ingresso Flow."
          : "Shared across Initialization and Actions. Ingresso fills them from a Flow input."}
      </p>
      <ul className="mb-2 space-y-1.5">
        {draft.variables.length === 0 ? (
          <li className="font-body text-[11px] text-ink-faint">
            {it
              ? "Nessuna — aggiungi Ingresso o crea qui."
              : "None — add Ingresso or create here."}
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
                    onChange(
                      upsertRecipeVariable(draft, {
                        ...v,
                        valueType: e.target.value as RecipeVarType,
                      }),
                    )
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
                  onChange(
                    upsertRecipeVariable(draft, {
                      ...v,
                      defaultValue: e.target.value || undefined,
                    }),
                  )
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
        {it
          ? "Canali in scrittura esposti al canvas."
          : "Write channels exposed to the canvas."}
      </p>
      <ul className="mb-1 space-y-1">
        {writeChannels.length === 0 ? (
          <li className="font-body text-[11px] text-ink-faint">
            {it ? "Nessun ingresso." : "No inputs."}
          </li>
        ) : (
          writeChannels.map((ch) => (
            <li
              key={ch.id}
              className="rounded-slpill bg-brand-blue/10 px-2 py-0.5 font-body text-[11px] text-brand-blue"
            >
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
            label: it
              ? `Ingresso ${writeChannels.length + 1}`
              : `Input ${writeChannels.length + 1}`,
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
      it: "START → ADDRESS+WRITE → DATA[] → STOP. Tutti i byte nella stessa transazione, senza STOP intermedi.",
      en: "START → ADDRESS+WRITE → DATA[] → STOP. All bytes in one transaction, no intermediate STOPs.",
    },
    i2c_read: {
      it: "START → ADDRESS+READ → DATA[N] → STOP. ACK su ogni byte tranne l’ultimo (NACK).",
      en: "START → ADDRESS+READ → DATA[N] → STOP. ACK on every byte except the last (NACK).",
    },
    i2c_write_read: {
      it: "START → WRITE → RESTART → READ → STOP. Il RESTART è automatico (nessuno STOP intermedio).",
      en: "START → WRITE → RESTART → READ → STOP. RESTART is automatic (no intermediate STOP).",
    },
    i2c_scan: {
      it: "Scansiona un intervallo di indirizzi (default 0x08–0x77) e elenca i dispositivi che rispondono con ACK.",
      en: "Scan an address range (default 0x08–0x77) and list devices that ACK.",
    },
    i2c_transaction: {
      it: "Componi fasi START / WRITE / READ / RESTART / STOP. La sequenza viene validata.",
      en: "Compose START / WRITE / READ / RESTART / STOP phases. The sequence is validated.",
    },
    wait: {
      it: "Ritardo tra due operazioni consecutive (ms o µs).",
      en: "Delay between two consecutive operations (ms or µs).",
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
  return hint
    ? it
      ? hint.it
      : hint.en
    : it
      ? "Aggiungi questo passo alla sequenza."
      : "Add this step to the sequence.";
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
            types: [
              "average",
              "filter",
              "map_range",
              "encode",
              "decode",
              "emit",
              "wait",
            ] as const,
          },
        ]
      : [{ title: null as string | null, types: library.map((i) => i.type) }];

  return (
    <div className="flex flex-col gap-2">
      {groups.map((group) => {
        const items = library.filter((item) =>
          (group.types as readonly string[]).includes(item.type),
        );
        if (items.length === 0) return null;
        return (
          <div key={group.title ?? "all"}>
            {group.title ? (
              <p className="mb-1 font-body text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                {group.title}
              </p>
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
function AnalogSamplingSummary({
  ops,
  it,
}: {
  readonly ops: readonly DeviceRecipeOp[];
  readonly it: boolean;
}) {
  const multi = ops.find((op) => op.type === "adc_multi_sample");
  const single = ops.find((op) => op.type === "adc_sample");
  const avg = ops.find((op) => op.type === "average");
  const count = multi?.type === "adc_multi_sample" ? multi.count : 1;
  const intervalMs = multi?.type === "adc_multi_sample" ? multi.intervalMs : 0;
  const into =
    multi?.type === "adc_multi_sample"
      ? multi.into
      : single?.type === "adc_sample"
        ? single.into
        : "samples";

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
              {intervalMs} ms {it ? "tra adiacenti" : "adjacent"} · span{" "}
              {multiSampleSpanMs(count, intervalMs)} ms
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
