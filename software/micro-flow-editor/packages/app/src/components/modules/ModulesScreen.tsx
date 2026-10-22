import { BACKBONE_SENSOR_MODULES_META_KEY, parseBackboneSensorModules } from "../../lib/backbone-sensor-modules.js";
import { topologyNeedsReconfiguration } from "../../lib/backbone-topology-change.js";
import { modulePinOwners } from "../../lib/module-pin-ownership.js";
import { logicalBackboneKey } from "../../lib/logical-backbone-slots.js";
import {
  newDeviceDriverMetadata,
  editModuleMetadata,
} from "../../lib/new-device-driver.js";
import { BackboneTargetPicker } from "../backbone/BackboneTargetPicker.js";
import { withDs18b20PowerMode } from "../../lib/gpio-driver-presets.js";
import {
  abortableModuleOperation,
  modulePinsAlreadyConfigured,
} from "../../lib/module-operation.js";
import { availableModuleDrivers } from "../../lib/module-catalog.js";
import { useEffect, useRef, useState } from "react";
import {
  Blocks,
  Plus,
  X,
  LoaderCircle,
  AlertCircle,
  ScanLine,
  Info,
  Users,
} from "lucide-react";
import { DEFAULT_PHYSICAL_SETTINGS } from "@spaghettilab/protocol-sdk";
import { useSession } from "../../state/session-context.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { useNfcPresence } from "../../state/nfc-presence-context.js";
import { useNfcWorkspace } from "../../state/nfc-workspace-context.js";
import { ModuleArtwork } from "../hardware/ModuleArtwork.js";
import {
  planModuleImport,
  commitModuleImport,
  commitModulePinConfiguration,
  removeInstalledModule,
  type ModuleImportPlan,
} from "../../lib/module-import.js";
import {
  DEFAULT_FUNCTION_VARIANT,
  defaultModesForVariant,
  PHYSICAL_META_KEY,
  parsePhysicalProject,
  topologyForBoard,
  functionVariantOf,
  expectedFunctionTag,
  tagForSlot,
  modeIndexToPinId,
  formatPinLabel,
} from "../../lib/backbone-physical.js";
import {
  applyStoppedRuntime,
  waitConfigWriteGap,
} from "../../lib/stop-deployed-runtime.js";
import type { DeviceRecipeDraft } from "../../lib/device-recipe-draft.js";

const button =
  "rounded-xl border border-border-strong bg-surface px-4 py-2 text-sm font-medium text-ink hover:border-brand-blue disabled:opacity-40";
export function ModulesScreen({
  nfcImport,
}: {
  nfcImport?: {
    driver: DeviceRecipeDraft;
    uid: string;
    bindingId: string;
    editingModule?: { id: string; boardKey: string; channels: Readonly<Record<string, number>> };
    onClose: () => void;
  };
} = {}) {
  const [destination, setDestination] = useState<{ bindingId: string; deviceIdHex: string }>();
  const [editingImport, setEditingImport] = useState<typeof nfcImport>(undefined);
  const importContext = nfcImport ?? editingImport;
  const { session, execute, navigate, moduleTarget, requestTopologyReview } = useSession();
  const { library, busy: nfcBusy, writeSession } = useNfcWorkspace();
  const {
    rows,
    getClient,
    getSnapshot,
    observeConfig,
    lockTransport,
    unlockTransport,
  } = useCoreSessions();
  const { pausePolling, resumePolling, waitUntilIdle } = useNfcPresence();
  const [bindingId, setBindingId] = useState(
    importContext?.bindingId ?? moduleTarget?.bindingId ?? "",
  );
  const [plan, setPlan] = useState<ModuleImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const [message, setMessage] = useState("");
  const project = session?.stack.current;
  const selected =
    project?.coreBindings.find((binding) => binding.bindingId === bindingId) ??
    project?.coreBindings[0];
  const drivers = availableModuleDrivers(project, library);
  function edit(driver: DeviceRecipeDraft, duplicate = false) {
    if (!execute) return;
    execute({
      kind: "EditModuleRecipe",
      apply: (current) => ({
        ok: true,
        value: {
          ...current,
          authoringMetadata: editModuleMetadata(
            current.authoringMetadata,
            driver,
            duplicate,
          ),
        },
      }),
    });
    navigate("device-recipe-editor");
  }
  function propose(driver: DeviceRecipeDraft, pins?: Readonly<Record<string, number>>) {
    if (driver.temperatureSensorModel === "ds18b20")
      driver = withDs18b20PowerMode(
        driver,
        driver.ds18b20PowerMode === "gpio"
          ? "vcc"
          : (driver.ds18b20PowerMode ?? "vcc"),
      );
    if (!project || !selected) {
      setMessage("Aggiungi una Backbone al progetto prima di importare un modulo.");
      return;
    }
    try {
      if (topologyNeedsReconfiguration(project, selected.bindingId, getSnapshot(selected.bindingId)?.status)) {
        setMessage("");
        requestTopologyReview();
        return;
      }
      const row = rows.find((item) => item.binding.bindingId === selected.bindingId);
      const editing = importContext?.editingModule;
      const existingPhysical = editing && parsePhysicalProject(project.authoringMetadata[PHYSICAL_META_KEY]?.comment).drafts[editing.boardKey];
      const board =
        (destination ? row?.attachedBackbones.find(item => item.deviceIdHex === destination.deviceIdHex) : undefined) ??
        (existingPhysical ? row?.attachedBackbones.find(item => existingPhysical.local !== false ? item.local : item.nodeId === existingPhysical.nodeId) : undefined) ??
        row?.attachedBackbones.find(
          (item) => item.deviceIdHex === moduleTarget?.deviceIdHex,
        ) ?? row?.attachedBackbones.find((item) => item.local);
      const boardKey = (!destination ? editing?.boardKey : undefined) ??
        (board
          ? logicalBackboneKey(
              project,
              selected.bindingId,
              getSnapshot(selected.bindingId)?.status,
              board.nodeId,
            )
          : undefined) ??
        `${selected.bindingId}:${board?.deviceIdHex ?? selected.expectedDeviceId}`;
      const saved = parsePhysicalProject(
        project.authoringMetadata[PHYSICAL_META_KEY]?.comment,
      ).drafts[boardKey];
      const topology = topologyForBoard(getSnapshot(selected.bindingId)?.status, {
        local: board?.local ?? true,
        nodeId: board?.nodeId ?? 0,
      });
      const physical = saved ?? {
        name: "Module Function",
        modes: topology?.modes
          ? [...topology.modes]
          : defaultModesForVariant(DEFAULT_FUNCTION_VARIANT),
        i2cSpeed: topology?.i2cSpeed ?? 0,
        local: board?.local ?? true,
        nodeId: board?.nodeId ?? 0,
        backendPortId: topology?.backendPortId ?? 0,
        settings: topology?.settings,
      };
      const next = planModuleImport(
        project,
        selected.bindingId,
        boardKey,
        driver,
        {
          ...physical,
          logicalSlot:
            board && row
              ? row.attachedBackbones
                  .filter((item) => item.productKind !== "nfc-reader")
                  .findIndex((item) => item.deviceIdHex === board.deviceIdHex) + 1
              : physical.logicalSlot,
          local: board?.local ?? true,
          nodeId: board?.local === false ? board.nodeId : 0,
          variant: topology?.layout === 2 ? "v2" : functionVariantOf(physical),
        },
        pins ?? (plan?.driver.id === driver.id ? plan.channels : editing?.channels),
        editing?.id,
      );
      setMessage("");
      setPlan(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }
  useEffect(() => {
    if (importContext) setBindingId(importContext.bindingId);
    if (!importContext && plan && !busy) propose(plan.driver);
    if (importContext)
      propose(
        importContext.driver.temperatureSensorModel === "ds18b20"
          ? withDs18b20PowerMode(
              importContext.driver,
              plan?.driver.ds18b20PowerMode ??
                importContext.driver.ds18b20PowerMode ??
                "vcc",
            )
          : importContext.driver,
      );
    // Rebuild the proposal when the user chooses a different Backbone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importContext?.uid, bindingId, moduleTarget?.deviceIdHex, destination?.deviceIdHex]);
  async function add(replace: boolean) {
    if (!project || !plan || !execute || busy) return;
    let activePlan = plan;
    if (nfcBusy || writeSession) {
      setMessage(
        "Attendi il completamento dell’operazione NFC prima di configurare i pin.",
      );
      return;
    }
    setBusy(true);
    setMessage("");
    const controller = new AbortController();
    operation.current = controller;
    const { signal } = controller;
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 20000);
    const guarded = <T,>(promise: Promise<T>) =>
      abortableModuleOperation(promise, signal);
    const client = getClient(activePlan.bindingId);
    let confirmed = false;
    let locked = false;
    try {
      // Offline import prepares the pin map; it never claims a hardware ACK.
      if (
        client &&
        rows.find((row) => row.binding.bindingId === activePlan.bindingId)
          ?.sessionState === "READY"
      ) {
        pausePolling();
        lockTransport();
        locked = true;
        setStage("Verifica della Backbone…");
        await guarded(waitUntilIdle());
        signal.throwIfAborted();
        const status = await guarded(client.getStatus(signal));
        const target = {
          local: activePlan.physical.local !== false,
          nodeId: activePlan.physical.nodeId ?? 0,
        };
        const actual = topologyForBoard(status, target);
        if (!actual)
          throw new Error(
            "La Backbone selezionata non è disponibile: aggiorna la connessione e riprova.",
          );
        if (actual?.modes) {
          const fresh = planModuleImport(
            session!.stack.current,
            activePlan.bindingId,
            activePlan.boardKey,
            activePlan.driver,
            {
              ...activePlan.physical,
              modes: [...actual.modes],
              variant:
                actual.layout === 2 ? "v2" : actual.modes.length === 8 ? "v2" : "v1",
              settings: actual.settings ?? activePlan.physical.settings,
              i2cSpeed: actual.i2cSpeed,
              backendPortId: actual.backendPortId ?? activePlan.physical.backendPortId,
            },
            activePlan.channels,
            importContext?.editingModule?.id,
          );
          activePlan = fresh;
          setPlan(fresh);
        }
        if (!modulePinsAlreadyConfigured(actual, activePlan.physical)) {
          setStage("Arresto del Flow sulla Backbone USB…");
          const stopped = await guarded(applyStoppedRuntime(client, signal));
          observeConfig(activePlan.bindingId, stopped.config);
          if (stopped.changed) await guarded(waitConfigWriteGap(signal));
          if (!target.local) {
            setStage("Arresto del Flow sulla Backbone CAN selezionata…");
            const remote = client.forCanNode(target.nodeId);
            try {
              const remoteStopped = await guarded(applyStoppedRuntime(remote, signal));
              if (remoteStopped.changed) await guarded(waitConfigWriteGap(signal));
            } finally {
              remote.dispose();
            }
          }
          setStage("Configurazione dei pin sulla Backbone selezionata…");
          await guarded(
            client.applyPhysical(
              {
                nodeId: target.local ? 0 : target.nodeId,
                modes: new Uint8Array(activePlan.physical.modes),
                i2cSpeed: activePlan.physical.i2cSpeed,
                settings:
                  (actual?.version ?? 0) >= 2
                    ? (activePlan.physical.settings ?? DEFAULT_PHYSICAL_SETTINGS)
                    : undefined,
                expectedTag: expectedFunctionTag(tagForSlot(status, target, 2), false),
              },
              signal,
            ),
          );
        } else {
          setStage("Pin già configurati. Aggiunta del modulo…");
        }
        confirmed = true;
      }
      signal.throwIfAborted();
      const id = importContext?.uid ?? `local-${crypto.randomUUID()}`;
      const result = execute({
        kind: "ImportModule",
        apply: (current) => ({
          ok: true,
          value: importContext?.editingModule
            ? commitModulePinConfiguration(current, activePlan, importContext.editingModule.id, confirmed)
            : commitModuleImport(current, activePlan, id, replace, confirmed),
        }),
      });
      if (!result.ok)
        throw new Error(
          "Il modulo non è stato inserito nel progetto. Controlla il canvas.",
        );
      setPlan(null);
      importContext?.onClose();
      navigate("processing-graph");
    } catch (error) {
      setMessage(
        signal.aborted
          ? timedOut
            ? "La Backbone non ha risposto in tempo. Il modulo non è stato aggiunto. Ricollega la Backbone e riprova: i pin verranno verificati di nuovo."
            : "Operazione interrotta. Il modulo non è stato aggiunto. Prima di riprovare verranno verificati i pin sulla Backbone."
          : `Configurazione non completata: ${error instanceof Error ? error.message : String(error)}. Puoi riprovare.`,
      );
    } finally {
      window.clearTimeout(timer);
      operation.current = null;
      setStage("");
      if (locked) {
        unlockTransport();
        resumePolling();
      }
      setBusy(false);
    }
  }
  return (
    <div className="h-full overflow-auto bg-surface-sunken/40 p-6 font-body text-ink">
      {!importContext && (
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-semibold">
              <Blocks className="text-brand-blue" />
              Moduli
            </h1>
            <p className="mt-2 text-sm text-ink-muted">
              Moduli pronti e moduli creati da te. Aggiungili al canvas con i pin
              preconfigurati.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <BackboneTargetPicker
              onChange={(target) => setBindingId(target.bindingId)}
            />
            <div className="flex items-center gap-1">
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-2 rounded-xl border border-border-strong px-3 py-2 text-sm text-ink-muted opacity-50"
              >
                <ScanLine size={16} />
                Rileva modulo
              </button>
              <span className="group relative">
                <button
                  type="button"
                  aria-label="Informazioni sul rilevamento"
                  className="rounded-full p-2 text-ink-muted"
                >
                  <Info size={16} />
                </button>
                <span
                  role="tooltip"
                  className="pointer-events-none absolute right-0 top-full z-50 hidden w-64 rounded-xl border border-border bg-surface p-3 text-xs leading-relaxed shadow-lg group-hover:block group-focus-within:block"
                >
                  I moduli ufficiali SpaghettiLAB verranno rilevati e configurati
                  automaticamente: non sarà necessario il cablaggio manuale. Disponibile
                  prossimamente.
                </span>
              </span>
            </div>
            <button
              type="button"
              disabled={!project || !execute}
              className="inline-flex items-center gap-2 rounded-xl bg-brand-blue px-4 py-2 text-sm font-medium text-white hover:bg-brand-blue/90 disabled:opacity-40"
              onClick={() => {
                if (!project || !execute) return;
                execute({
                  kind: "StartNewDeviceDriver",
                  apply: (current) => ({
                    ok: true,
                    value: {
                      ...current,
                      authoringMetadata: newDeviceDriverMetadata(
                        current.authoringMetadata,
                      ),
                    },
                  }),
                });
                navigate("device-recipe-editor");
              }}
            >
              <Plus size={16} />
              Crea modulo
            </button>
          </div>
        </header>
      )}
      {message && (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm"
        >
          {message}
        </p>
      )}
      {!importContext && project && selected && (
        <section className="mb-6 space-y-3" aria-label="Moduli configurati">
          <h2 className="font-semibold">Moduli configurati · modifica i collegamenti</h2>
          {(parseBackboneSensorModules(project.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment)
            .byBinding[selected.bindingId] ?? []).filter(module => module.bus === "gpio" && module.recipe.deviceDraft)
            .map(module => {
              const driver = module.recipe.deviceDraft!;
              const boardKey = module.gpioAssignments?.boardKey ?? module.gpioAssignment?.boardKey;
              if (!boardKey) return null;
              const channels = module.gpioAssignments?.channels ?? {
                [driver.binding.gpioSignals[0]?.id ?? "DATA"]: module.gpioAssignment!.channel,
              };
              const board = parsePhysicalProject(project.authoringMetadata[PHYSICAL_META_KEY]?.comment).drafts[boardKey];
              return <div key={module.id} className="inline-flex flex-wrap items-center gap-3 rounded-xl border border-border-strong bg-surface p-3 mr-3">
                <button type="button" className="text-left"
                onClick={() => { setDestination(undefined); setEditingImport({ driver, uid: module.id, bindingId: selected.bindingId,
                  editingModule: { id: module.id, boardKey, channels }, onClose: () => { setEditingImport(undefined); setDestination(undefined); } }); }}>
                <strong>{driver.name}</strong> · Backbone {board?.logicalSlot ?? (board?.local === false ? "CAN" : "1")}
                <span className="ml-3 font-mono text-xs">{Object.entries(channels).map(([signal, pin]) => `${signal}: A${pin}`).join(" · ")}</span>
                <span className="ml-3 text-brand-blue">Pin e Backbone</span>
                </button>
                <button type="button" className="text-sm text-error hover:underline" aria-label={`Elimina ${driver.name}`}
                  onClick={() => execute?.({ kind: "RemoveInstalledModule", apply: current => ({ ok: true,
                    value: removeInstalledModule(current, selected.bindingId, module.id) }) })}>Elimina</button>
              </div>;
            })}
        </section>
      )}
      {!importContext && (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {drivers.map((driver) => (
            <article
              key={driver.id}
              className="flex flex-col rounded-2xl border border-border-strong bg-surface p-5 shadow-sm"
            >
              <button
                type="button"
                onClick={() => { setDestination(undefined); propose(driver.draft); }}
                className="mb-3 flex items-center gap-3 text-left"
                aria-label={`Configura ${driver.draft.name}`}
              >
                <div className="h-16 w-16 shrink-0">
                  <ModuleArtwork
                    kind={driver.draft.gpioHardware?.kind ?? "generic"}
                    name={driver.draft.name}
                  />
                </div>
                <h2 className="text-lg font-semibold">{driver.draft.name}</h2>
              </button>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-ink-muted">
                {driver.draft.temperatureSensorModel === "dht11"
                  ? "Temperatura e umidità su richiesta. DATA A0, alimentazione A1, GND comune. Trigger sul fronte di salita; uscite °C e %RH."
                  : driver.draft.description}
              </p>
              <div className="my-4 flex flex-wrap gap-2">
                {driver.draft.commands.map((action) => (
                  <span
                    key={action.id}
                    className="rounded-md bg-brand-blue/10 px-2 py-1 text-xs text-brand-blue"
                  >
                    {action.label}
                  </span>
                ))}
              </div>
              <div className="mb-3 flex gap-3 text-sm text-brand-blue">
                <button type="button" onClick={() => edit(driver.draft)}>
                  Modifica modulo
                </button>
                <button type="button" onClick={() => edit(driver.draft, true)}>
                  Duplica
                </button>
              </div>
              <button
                className={`${button} flex items-center justify-center gap-2`}
                onClick={() => propose(driver.draft)}
              >
                <Plus size={16} />
                Aggiungi al canvas
              </button>
            </article>
          ))}
        </div>
      )}
      {!importContext && (
        <aside className="mt-6 flex items-start gap-3 text-sm text-ink-muted">
          <Users size={20} className="shrink-0 text-brand-blue" />
          <div>
            <p className="font-semibold text-ink">
              Il prossimo modulo ufficiale potrebbe essere il tuo.
            </p>
            <p className="mt-1">
              Realizza un modulo e mostralo alla community. I più votati diventeranno
              moduli ufficiali SpaghettiLAB.
            </p>
          </div>
        </aside>
      )}
      {plan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-5">
          <section
            role="dialog"
            aria-modal="true"
            aria-label={importContext?.editingModule ? "Modifica pin del modulo" : "Aggiungi modulo"}
            className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border-strong bg-surface p-6 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">{plan.driver.name}</h2>
              <button
                className={button}
                aria-label="Chiudi importazione"
                disabled={busy}
                onClick={() => (importContext ? importContext.onClose() : setPlan(null))}
              >
                <X size={18} />
              </button>
            </div>
            <div className="mt-4">
              <p className="mb-2 text-xs text-ink-muted">Backbone di destinazione</p>
              <BackboneTargetPicker
                disabled={busy}
                bindingId={importContext?.editingModule ? importContext.bindingId : undefined}
                value={importContext?.editingModule ? (() => {
                  const board = rows.find(row => row.binding.bindingId === plan.bindingId)?.attachedBackbones
                    .find(board => plan.physical.local !== false ? board.local : board.nodeId === plan.physical.nodeId);
                  return board ? { bindingId: plan.bindingId, deviceIdHex: board.deviceIdHex } : undefined;
                })() : undefined}
                onChange={(target) => {
                  setDestination(target);
                  setBindingId(target.bindingId);
                }}
              />
            </div>
            {plan.driver.rgbModule && (
              <button type="button" disabled={busy} className="mt-3 text-sm font-semibold text-brand-blue hover:underline"
                onClick={() => propose(plan.driver, { RED: 1, GREEN: 0, BLUE: 2 })}>
                Usa pin predefiniti · RED A1 · GREEN A0 · BLUE A2
              </button>
            )}
            {plan.driver.temperatureSensorModel === "ds18b20" && (
              <label className="mt-4 block text-sm font-medium">
                Alimentazione DS18B20
                <select
                  aria-label="Alimentazione DS18B20"
                  className={`${button} mt-2 w-full`}
                  disabled={busy}
                  value={
                    (plan.driver.ds18b20PowerMode ?? "vcc") === "parasite"
                      ? "parasite"
                      : "vcc"
                  }
                  onChange={(event) =>
                    propose(
                      withDs18b20PowerMode(
                        plan.driver,
                        event.target.value === "parasite" ? "parasite" : "vcc",
                        "3.3",
                      ),
                    )
                  }
                >
                  <option value="parasite">Parassita · solo DATA</option>
                  <option value="vcc">VCC · 3,3 V</option>
                </select>
                <p className="mt-2 text-xs font-normal text-ink-muted">
                  La scelta configura i pin e il driver della singola istanza.
                </p>
              </label>
            )}
            <p className="mt-3 text-sm text-ink-muted">
              Scegli i pin · Module Function{" "}
              {functionVariantOf(plan.physical).toUpperCase()}
            </p>
            <dl className="my-4 divide-y divide-border rounded-xl border border-border px-4">
              {Object.entries(plan.channels).map(([signal, channel]) => (
                <div key={signal} className="flex justify-between py-2 text-sm">
                  <dt>
                    {plan.driver.binding.gpioSignals.find((item) => item.id === signal)
                      ?.name ?? signal}
                  </dt>
                  <dd>
                    <select
                      aria-label={`Pin ${signal}`}
                      disabled={busy}
                      className={`${button} !py-1 font-mono text-brand-blue`}
                      value={Number(channel)}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        const pins = { ...plan.channels };
                        const previous = pins[signal];
                        const occupied = Object.keys(pins).find(
                          (key) => key !== signal && pins[key] === next,
                        );
                        if (occupied && previous !== undefined)
                          pins[occupied] = previous;
                        pins[signal] = next;
                        propose(plan.driver, pins);
                      }}
                    >
                      {Array.from(
                        {
                          length:
                            plan.driver.binding.bus === "gpio"
                              ? Math.min(4, plan.physical.modes.length)
                              : plan.physical.modes.length,
                        },
                        (_, pin) => {
                          const owner = modulePinOwners(
                            project,
                            plan.bindingId,
                            plan.boardKey,
                            plan.physical,
                          ).find((item) => Object.values(item.channels).includes(pin));
                          return (
                            <option key={pin} value={pin}>
                              {formatPinLabel(
                                modeIndexToPinId(pin, functionVariantOf(plan.physical)),
                                functionVariantOf(plan.physical),
                              )}{" "}
                              ·{" "}
                              {owner?.module.recipe.deviceDraft?.name ??
                                owner?.module.label ??
                                "Libero"}
                            </option>
                          );
                        },
                      )}
                    </select>
                  </dd>
                </div>
              ))}
              {plan.driver.temperatureSensorModel === "ds18b20" &&
                plan.driver.ds18b20PowerMode === "vcc" && (
                  <div className="flex justify-between py-2 text-sm">
                    <dt>VCC</dt>
                    <dd className="font-mono text-brand-blue">3,3 V</dd>
                  </div>
                )}
              {plan.driver.temperatureSensorModel === "ds18b20" && (
                <div className="flex justify-between py-2 text-sm">
                  <dt>GND</dt>
                  <dd className="font-mono text-brand-blue">GND</dd>
                </div>
              )}
            </dl>
            {plan.driver.temperatureSensorModel === "ds18b20" &&
              (plan.driver.ds18b20PowerMode ?? "vcc") === "parasite" && (
                <p className="mb-4 text-sm text-ink-muted">
                  Alimentazione parassita: DATA sul pin scelto, VDD e GND a massa.
                  Pull-up esterno DATA–3,3 V; il driver mantiene DATA alto durante la
                  conversione (750 ms). Un sensore per pin. Verifica il circuito della
                  schedina con R1 e LED prima del cablaggio.
                </p>
              )}
            {plan.driver.temperatureSensorModel === "ds18b20" &&
              plan.driver.ds18b20PowerMode === "vcc" && (
                <p className="mb-4 text-sm text-ink-muted">
                  VCC alla linea 3,3 V, GND comune. Solo DATA usa un GPIO. Non usare 5
                  V: il pull-up della schedina porterebbe DATA a 5 V.
                </p>
              )}
            {plan.driver.temperatureSensorModel === "ds18b20" &&
              plan.driver.ds18b20PowerMode === "gpio" && (
                <p className="mb-4 text-sm text-ink-muted">
                  DATA su A0, VCC su A1, GND comune. Il driver tiene A1 HIGH durante
                  avvio, conversione e lettura; Stop generale spegne A1. DATA viene
                  rilasciato durante la conversione. Usa questa modalità con il tuo
                  cablaggio attuale.
                </p>
              )}
            {plan.driver.dht22Module &&
              plan.driver.temperatureSensorModel !== "ds18b20" && (
                <p className="mb-4 text-sm text-ink-muted">
                  DATA usa un GPIO bidirezionale gestito dal driver. Alimentazione: GPIO
                  HIGH fisso a circa 3,3 V; GND comune. Avvio: 2 secondi; lettura
                  soltanto sul fronte di salita del trigger. Stop generale spegne il
                  sensore.
                </p>
              )}
            {plan.driver.rgbModule && (
              <p className="mb-4 text-sm text-ink-muted">
                R, G e B usano tre uscite PWM. Pin comune:{" "}
                {plan.driver.rgbModule.common === "cathode"
                  ? "GND (catodo comune)"
                  : "VCC (anodo comune)"}
                . Stato e colore iniziali vengono mantenuti come configurati nel driver.
              </p>
            )}
            {plan.driver.id === "uln2003-28byj48" && (
              <p className="mb-4 text-sm text-ink-muted">
                28BYJ-48 da 5 V. Alimenta il motore tramite la scheda ULN2003, con massa
                comune. Lo zero è la posizione all’avvio; non viene cercato un
                finecorsa. Stop mantiene le bobine attive; Stop generale le disattiva.
              </p>
            )}
            {message && (
              <p
                role="alert"
                className={`mb-4 rounded-xl border p-3 text-sm ${message.startsWith("Collegamenti aggiornati") ? "border-border bg-surface-sunken text-ink-muted" : "border-red-200 bg-red-50 text-red-700"}`}
              >
                {message}
              </p>
            )}
            {!getClient(plan.bindingId) && (
              <p className="mb-4 text-sm text-ink-muted">
                Backbone scollegata: il modulo e i pin vengono preparati nel progetto.
                Verranno configurati quando carichi il programma sulla scheda.
              </p>
            )}
            {!!(plan.conflicts.length || (!importContext?.editingModule && plan.pinChanges.length)) && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
                <strong className="flex items-center gap-2">
                  <AlertCircle size={16} />
                  Moduli da sostituire
                </strong>
                <p className="mt-2">
                  Aggiungendo il nuovo modulo, questi moduli vengono rimossi interamente
                  insieme ai loro collegamenti nel canvas. I pin che non servono più
                  vengono liberati.
                </p>
                <ul className="mt-2 list-inside list-disc">
                  {plan.conflicts.map((conflict) => (
                    <li key={conflict.id}>{conflict.label}</li>
                  ))}
                  {(importContext?.editingModule ? [] : plan.pinChanges).map((pin) => (
                    <li key={pin}>{pin}</li>
                  ))}
                </ul>
              </div>
            )}
            {busy && (
              <p role="status" className="mb-3 text-sm text-ink-muted">
                {stage}
              </p>
            )}
            <footer className="flex justify-end gap-2">
              <button
                className={button}
                onClick={() =>
                  busy
                    ? operation.current?.abort()
                    : importContext
                      ? importContext.onClose()
                      : setPlan(null)
                }
              >
                {busy ? "Interrompi attesa" : "Annulla"}
              </button>
              <button
                className={`${button} flex items-center gap-2 !bg-brand-blue !text-white`}
                disabled={busy}
                onClick={() => void add(true)}
              >
                {busy && <LoaderCircle size={16} className="animate-spin" />}
                {importContext?.editingModule ? "Salva modifiche" : plan.conflicts.length || plan.pinChanges.length
                  ? "Sostituisci e aggiungi"
                  : "Configura e aggiungi"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
