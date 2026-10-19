import { withDs18b20PowerMode } from "../../lib/gpio-driver-presets.js";
import {
  abortableModuleOperation,
  modulePinsAlreadyConfigured,
} from "../../lib/module-operation.js";
import { availableModuleDrivers } from "../../lib/module-catalog.js";
import { useEffect, useRef, useState } from "react";
import { Blocks, Plus, X, LoaderCircle, AlertCircle } from "lucide-react";
import { DEFAULT_PHYSICAL_SETTINGS } from "@spaghettilab/protocol-sdk";
import { useSession } from "../../state/session-context.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { useNfcPresence } from "../../state/nfc-presence-context.js";
import { useNfcWorkspace } from "../../state/nfc-workspace-context.js";
import { ModuleArtwork } from "../hardware/ModuleArtwork.js";
import {
  planModuleImport,
  commitModuleImport,
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
    onClose: () => void;
  };
} = {}) {
  const { session, execute, navigate } = useSession();
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
  const [bindingId, setBindingId] = useState(nfcImport?.bindingId ?? "");
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
  function propose(driver: DeviceRecipeDraft) {
    if (!project || !selected) {
      setMessage("Aggiungi una Backbone al progetto prima di importare un modulo.");
      return;
    }
    try {
      const row = rows.find((item) => item.binding.bindingId === selected.bindingId);
      const board = row?.attachedBackbones.find((item) => item.local);
      const boardKey = `${selected.bindingId}:${board?.deviceIdHex ?? selected.expectedDeviceId}`;
      const saved = parsePhysicalProject(
        project.authoringMetadata[PHYSICAL_META_KEY]?.comment,
      ).drafts[boardKey];
      const topology = topologyForBoard(getSnapshot(selected.bindingId)?.status, {
        local: true,
        nodeId: 0,
      });
      const physical = saved ?? {
        name: "Module Function",
        modes: topology?.modes
          ? [...topology.modes]
          : defaultModesForVariant(DEFAULT_FUNCTION_VARIANT),
        i2cSpeed: topology?.i2cSpeed ?? 0,
        local: true,
        nodeId: 0,
        backendPortId: topology?.backendPortId ?? 0,
        settings: topology?.settings,
      };
      const next = planModuleImport(project, selected.bindingId, boardKey, driver, {
        ...physical,
        variant: functionVariantOf(physical),
      });
      setMessage("");
      setPlan(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }
  useEffect(() => {
    if (nfcImport)
      propose(
        nfcImport.driver.temperatureSensorModel === "ds18b20"
          ? withDs18b20PowerMode(
              nfcImport.driver,
              plan?.driver.ds18b20PowerMode ??
                nfcImport.driver.ds18b20PowerMode ??
                "parasite",
            )
          : nfcImport.driver,
      );
    // Rebuild the proposal when the user chooses a different Backbone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nfcImport?.uid, bindingId]);
  async function add(replace: boolean) {
    if (!project || !plan || !execute || busy) return;
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
    const client = getClient(plan.bindingId);
    let confirmed = false;
    let locked = false;
    try {
      // Offline import prepares the pin map; it never claims a hardware ACK.
      if (
        client &&
        rows.find((row) => row.binding.bindingId === plan.bindingId)?.sessionState ===
          "READY"
      ) {
        pausePolling();
        lockTransport();
        locked = true;
        setStage("Verifica della Backbone…");
        await guarded(waitUntilIdle());
        signal.throwIfAborted();
        const status = await guarded(client.getStatus(signal));
        const actual = topologyForBoard(status, { local: true, nodeId: 0 });
        if (actual?.modes) {
          const fresh = planModuleImport(
            session!.stack.current,
            plan.bindingId,
            plan.boardKey,
            plan.driver,
            {
              ...plan.physical,
              modes: [...actual.modes],
              variant: actual.modes.length === 8 ? "v2" : "v1",
              settings: actual.settings ?? plan.physical.settings,
              i2cSpeed: actual.i2cSpeed,
              backendPortId: actual.backendPortId ?? plan.physical.backendPortId,
            },
          );
          if (
            JSON.stringify(fresh.physical.modes) !==
              JSON.stringify(plan.physical.modes) ||
            JSON.stringify(fresh.physical.settings) !==
              JSON.stringify(plan.physical.settings) ||
            fresh.physical.backendPortId !== plan.physical.backendPortId ||
            fresh.physical.variant !== plan.physical.variant ||
            fresh.physical.i2cSpeed !== plan.physical.i2cSpeed ||
            JSON.stringify(fresh.conflicts) !== JSON.stringify(plan.conflicts) ||
            JSON.stringify(fresh.pinChanges) !== JSON.stringify(plan.pinChanges)
          ) {
            setPlan(fresh);
            setMessage(
              "La configurazione dei pin è cambiata: controlla di nuovo i collegamenti proposti.",
            );
            return;
          }
        }
        setStage("Arresto del Flow prima di configurare i pin…");
        const stopped = await guarded(applyStoppedRuntime(client, signal));
        observeConfig(plan.bindingId, stopped.config);
        if (stopped.changed) await guarded(waitConfigWriteGap(signal));
        setStage(
          modulePinsAlreadyConfigured(actual, plan.physical)
            ? "Pin già configurati. Aggiunta del modulo…"
            : "Configurazione dei pin…",
        );
        if (!modulePinsAlreadyConfigured(actual, plan.physical))
          await guarded(
            client.applyPhysical(
              {
                nodeId: 0,
                modes: new Uint8Array(plan.physical.modes),
                i2cSpeed: plan.physical.i2cSpeed,
                settings:
                  topologyForBoard(status, { local: true, nodeId: 0 })?.version === 2
                    ? (plan.physical.settings ?? DEFAULT_PHYSICAL_SETTINGS)
                    : undefined,
                expectedTag: expectedFunctionTag(
                  tagForSlot(status, { local: true, nodeId: 0 }, 2),
                  false,
                ),
              },
              signal,
            ),
          );
        confirmed = true;
      }
      signal.throwIfAborted();
      const id = nfcImport?.uid ?? `local-${crypto.randomUUID()}`;
      const result = execute({
        kind: "ImportModule",
        apply: (current) => ({
          ok: true,
          value: commitModuleImport(current, plan, id, replace, confirmed),
        }),
      });
      if (!result.ok)
        throw new Error(
          "Il modulo non è stato inserito nel progetto. Controlla il canvas.",
        );
      setPlan(null);
      nfcImport?.onClose();
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
      {!nfcImport && (
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-3 text-2xl font-semibold">
              <Blocks className="text-brand-blue" />
              Moduli
            </h1>
            <p className="mt-2 text-sm text-ink-muted">
              Driver pronti e dispositivi creati da te. Aggiungili al canvas con i pin
              preconfigurati.
            </p>
          </div>
          <label className="text-xs text-ink-muted">
            Backbone master
            <select
              aria-label="Backbone per il modulo"
              className={`${button} ml-2`}
              value={selected?.bindingId ?? ""}
              onChange={(event) => setBindingId(event.target.value)}
            >
              {project?.coreBindings.map((binding) => (
                <option key={binding.bindingId} value={binding.bindingId}>
                  {binding.expectedDeviceId.slice(0, 12)}
                </option>
              ))}
            </select>
          </label>
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
      {!nfcImport && (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {drivers.map((driver) => (
            <article
              key={driver.id}
              className="flex flex-col rounded-2xl border border-border-strong bg-surface p-5 shadow-sm"
            >
              <div className="mb-3 flex items-center gap-3">
                <div className="h-16 w-16 shrink-0">
                  <ModuleArtwork
                    kind={driver.draft.gpioHardware?.kind ?? "generic"}
                    name={driver.draft.name}
                  />
                </div>
                <h2 className="text-lg font-semibold">{driver.draft.name}</h2>
              </div>
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
      {plan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 p-5">
          <section
            role="dialog"
            aria-modal="true"
            aria-label="Aggiungi modulo"
            className="w-full max-w-lg rounded-2xl border border-border-strong bg-surface p-6 shadow-xl"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">{plan.driver.name}</h2>
              <button
                className={button}
                aria-label="Chiudi importazione"
                disabled={busy}
                onClick={() => (nfcImport ? nfcImport.onClose() : setPlan(null))}
              >
                <X size={18} />
              </button>
            </div>
            {nfcImport && (
              <label className="mt-4 block text-sm">
                Backbone di destinazione
                <select
                  aria-label="Backbone per il modulo"
                  className={`${button} mt-2 w-full`}
                  disabled={busy}
                  value={selected?.bindingId ?? ""}
                  onChange={(event) => setBindingId(event.target.value)}
                >
                  {project?.coreBindings
                    .filter(
                      (binding) =>
                        !rows.some((row) =>
                          row.attachedBackbones.some(
                            (peer) =>
                              peer.deviceIdHex === binding.expectedDeviceId &&
                              peer.productKind === "nfc-reader",
                          ),
                        ),
                    )
                    .map((binding) => (
                      <option key={binding.bindingId} value={binding.bindingId}>
                        {rows.find((row) => row.binding.bindingId === binding.bindingId)
                          ?.displayName ?? binding.expectedDeviceId.slice(0, 12)}
                      </option>
                    ))}
                </select>
              </label>
            )}
            {plan.driver.temperatureSensorModel === "ds18b20" && (
              <label className="mt-4 block text-sm font-medium">
                Alimentazione DS18B20
                <select
                  aria-label="Alimentazione DS18B20"
                  className={`${button} mt-2 w-full`}
                  disabled={busy}
                  value={plan.driver.ds18b20PowerMode ?? "parasite"}
                  onChange={(event) =>
                    propose(
                      withDs18b20PowerMode(
                        plan.driver,
                        event.target.value as "parasite" | "gpio",
                      ),
                    )
                  }
                >
                  <option value="parasite">Parassita · solo DATA A0</option>
                  <option value="gpio">Da GPIO · DATA A0 e VCC A1</option>
                </select>
                <p className="mt-2 text-xs font-normal text-ink-muted">
                  La scelta configura i pin e il driver della singola istanza.
                </p>
              </label>
            )}
            <p className="mt-3 text-sm text-ink-muted">
              Collegamenti predefiniti · Module Function{" "}
              {functionVariantOf(plan.physical).toUpperCase()}
            </p>
            <dl className="my-4 divide-y divide-border rounded-xl border border-border px-4">
              {(Object.keys(plan.channels).length
                ? Object.entries(plan.channels)
                : [
                    ["SDA", 0],
                    ["SCL", 1],
                  ]
              ).map(([signal, channel]) => (
                <div key={signal} className="flex justify-between py-2 text-sm">
                  <dt>
                    {plan.driver.binding.gpioSignals.find((item) => item.id === signal)
                      ?.name ?? signal}
                  </dt>
                  <dd className="font-mono text-brand-blue">
                    {formatPinLabel(
                      modeIndexToPinId(
                        Number(channel),
                        functionVariantOf(plan.physical),
                      ),
                      functionVariantOf(plan.physical),
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            {plan.driver.temperatureSensorModel === "ds18b20" &&
              plan.driver.ds18b20PowerMode !== "gpio" && (
                <p className="mb-4 text-sm text-ink-muted">
                  Alimentazione parassita: DATA su A0, VDD e GND a massa. Pull-up
                  esterno DATA–3,3 V; il driver mantiene DATA alto durante la
                  conversione (750 ms). Un sensore per pin. Verifica il circuito della
                  schedina con R1 e LED prima del cablaggio.
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
                className="mb-4 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700"
              >
                {message}
              </p>
            )}
            {!getClient(plan.bindingId) && (
              <p className="mb-4 text-sm text-ink-muted">
                Backbone scollegata: i pin vengono preparati nel progetto. Applica la
                configurazione in Module Function dopo il collegamento.
              </p>
            )}
            {!!(plan.conflicts.length || plan.pinChanges.length) && (
              <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm">
                <strong className="flex items-center gap-2">
                  <AlertCircle size={16} />
                  Pin già utilizzati
                </strong>
                <p className="mt-2">
                  Scegli cosa mantenere. Sostituendo, i moduli in conflitto e i loro
                  collegamenti vengono rimossi dal canvas; i driver restano in libreria.
                </p>
                <ul className="mt-2 list-inside list-disc">
                  {plan.conflicts.map((conflict) => (
                    <li key={conflict.id}>{conflict.label}</li>
                  ))}
                  {plan.pinChanges.map((pin) => (
                    <li key={pin}>{pin}</li>
                  ))}
                </ul>
              </div>
            )}
            {message && (
              <p role="alert" className="mb-3 text-sm text-red-600">
                {message}
              </p>
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
                    : nfcImport
                      ? nfcImport.onClose()
                      : setPlan(null)
                }
              >
                {busy
                  ? "Interrompi attesa"
                  : plan.conflicts.length || plan.pinChanges.length
                    ? "Mantieni esistenti"
                    : "Annulla"}
              </button>
              <button
                className={`${button} flex items-center gap-2 !bg-brand-blue !text-white`}
                disabled={busy}
                onClick={() => void add(true)}
              >
                {busy && <LoaderCircle size={16} className="animate-spin" />}
                {plan.conflicts.length || plan.pinChanges.length
                  ? "Usa il nuovo modulo"
                  : "Configura e aggiungi"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
