import { deployWire } from "../../lib/deploy-wire.js";
import { abortableModuleOperation } from "../../lib/module-operation.js";
import { installProfile as installProfileWorkflow } from "@spaghettilab/device-profile-install";
import { verifyDeployConnections } from "../../lib/deploy-connections.js";
import type { DeviceProfileDraft } from "@spaghettilab/device-profile-authoring-model";
import type {
  CompileConfigInput,
  CompileConfigOptions,
} from "@spaghettilab/config-compiler";
import {
  deployConfig as deployConfigWorkflow,
  diffConfigs,
  isConfigDiffEmpty,
  DeploymentOutcomeKind,
  type ConfigDiff,
  type DeploymentResult,
} from "@spaghettilab/config-deployment";
import { decodeConfigCbor, dryRunConfig } from "@spaghettilab/config-decompiler";
import {
  appendDeploymentRecord,
  canonicalProjectHash,
  deploymentId,
  type CoreBindingId,
  type CoreBindingRecord,
  type GraphState,
} from "@spaghettilab/domain";
import {
  Check,
  CircleAlert,
  Cpu,
  Info,
  LoaderCircle,
  LocateFixed,
  Play,
  RefreshCw,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { installDriverProfiles } from "../../lib/driver-profile-deployment.js";
import { prepareDriverDeployment } from "../../lib/driver-deployment-plan.js";
import {
  describeDeployProblem,
  uniqueDeployProblems,
  type DeployProblem,
} from "../../lib/deploy-feedback.js";
import {
  BACKBONE_SENSOR_MODULES_META_KEY,
  modulesForBinding,
  parseBackboneSensorModules,
} from "../../lib/backbone-sensor-modules.js";
import { ModuleArtwork } from "../hardware/ModuleArtwork.js";
import "./deploy-dialog.css";
import {
  applyStoppedRuntime,
  formatApplyConfigError,
  isRetryableConfigApply,
  waitConfigWriteGap,
} from "../../lib/stop-deployed-runtime.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { useLocale } from "../../state/locale-context.js";
import { useNfcPresence } from "../../state/nfc-presence-context.js";
import { useSession } from "../../state/session-context.js";
import { ConfigDiffView } from "./ConfigDiffView.js";
import { PipelineStepper } from "./PipelineStepper.js";

const EMPTY_PHYSICAL: GraphState<"physical-composition"> = {
  layer: "physical-composition",
  nodes: [],
  edges: [],
};
const EMPTY_PROCESSING: GraphState<"device-processing"> = {
  layer: "device-processing",
  nodes: [],
  edges: [],
};
const EMPTY_BINDINGS: readonly CoreBindingRecord[] = [];

type CoreCandidate = {
  readonly binding: CoreBindingRecord;
  readonly bindingIndex: number;
  readonly input: CompileConfigInput;
  readonly profiles: readonly DeviceProfileDraft[];
  readonly options: CompileConfigOptions;
  readonly diff: ConfigDiff;
  readonly expectedGeneration: number;
  readonly missingProfiles: readonly string[];
};

/**
 * `ux/screens/S080-deploy-diff/{visual,ui-behavior,backend-behavior}.md`, cablato su
 * `@spaghettilab/config-deployment` (S080, reale). Il diff qui non riusa
 * `syncRelationship` di S030 (calcolato una sola volta al connect, può diventare
 * stantio non appena l'utente modifica il grafo dopo essersi connesso) — ricalcola
 * sempre il diff fresco da `diffConfigs(live, candidate)`, così un Core compare in
 * questa lista solo se ha davvero modifiche pendenti in questo momento.
 */
export function DeployDiffScreen({ onClose }: { onClose?: () => void }) {
  const { locale } = useLocale();
  const it = locale === "it";
  const { session, execute, navigate, closeDeploy, focusCanvas } = useSession();
  const close =
    onClose ??
    (() => {
      closeDeploy();
      navigate("processing-graph");
    });
  const {
    getSnapshot,
    getClient,
    observeConfig,
    setExecutionMode,
    listDeviceProfiles,
    observeStatus,
    lockTransport,
    unlockTransport,
  } = useCoreSessions();
  const { pausePolling, resumePolling, waitUntilIdle } = useNfcPresence();
  const bindings = session?.stack.current.coreBindings ?? EMPTY_BINDINGS;

  const [selected, setSelected] = useState<ReadonlySet<CoreBindingId> | null>(null);
  const [profilesByBinding, setProfilesByBinding] = useState<
    Map<CoreBindingId, ReadonlySet<string>>
  >(new Map());
  const [results, setResults] = useState<Map<CoreBindingId, DeploymentResult>>(
    new Map(),
  );
  const [running, setRunning] = useState<ReadonlySet<CoreBindingId>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(true);
  const [connectionErrors, setConnectionErrors] = useState<DeployProblem[]>([]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const submittingRef = useRef(false);
  const deployAbort = useRef<AbortController | null>(null);
  const [deployPhase, setDeployPhase] = useState("");
  const deployPhaseRef = useRef("");
  const updateDeployPhase = (phase: string) => {
    deployPhaseRef.current = phase;
    setDeployPhase(phase);
  };
  useEffect(() => () => deployAbort.current?.abort(), []);
  const [deployError, setDeployError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  async function refresh() {
    setChecking(true);
    setDeployError(null);
    setResults(new Map());
    const errors: DeployProblem[] = [];
    await Promise.all(
      bindings.map(async (binding) => {
        try {
          const client = getClient(binding.bindingId);
          if (!client)
            throw new Error(it ? "Backbone scollegata." : "Backbone disconnected.");
          const config = await client.getConfig();
          observeConfig(binding.bindingId, config);
        } catch (cause) {
          errors.push({
            bindingId: binding.bindingId,
            code: "offline",
            technical: String(cause),
          });
        }
      }),
    );
    setConnectionErrors(errors);
    setChecking(false);
  }
  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) return refresh();
    });
    return () => {
      cancelled = true;
    };
    // A fresh read is performed once each time the dialog opens, never a write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const compilation = (() => {
    const out: CoreCandidate[] = [],
      errors: DeployProblem[] = [];
    if (!session) return { candidates: out, errors };
    bindings.forEach((binding, bindingIndex) => {
      const snapshot = getSnapshot(binding.bindingId);
      if (!snapshot?.config) return;
      const liveDecoded = decodeConfigCbor(snapshot.config.configBytes);
      if (!liveDecoded.ok) {
        errors.push({
          bindingId: binding.bindingId,
          technical: "Configurazione della Backbone non leggibile.",
        });
        return;
      }
      try {
        const base: CompileConfigInput = {
          physicalGraph:
            session.stack.current.physicalGraphs[bindingIndex] ?? EMPTY_PHYSICAL,
          processingGraph:
            session.stack.current.deviceGraphs[bindingIndex] ?? EMPTY_PROCESSING,
          mqtt: liveDecoded.value.mqtt,
          connectivity: liveDecoded.value.connectivity,
          energy: liveDecoded.value.energy,
        };
        const plan = prepareDriverDeployment(
          session.stack.current,
          binding.bindingId,
          base,
        );
        if (
          plan.profiles.some((profile) =>
            profile.sampleOps.some((op) => op.op === "RGB_PROGRAM"),
          )
        ) {
          const version = snapshot.status?.version?.match(/^(\d+)\.(\d+)\.(\d+)/);
          if (
            !version ||
            (Number(version[1]) === 0 &&
              (Number(version[2]) < 5 ||
                (Number(version[2]) === 5 && Number(version[3]) < 9)))
          )
            throw new Error(
              "Aggiorna la Backbone al firmware 0.5.9 o successivo per il modulo LED RGB.",
            );
        }
        const needsMotionFirmware =
          plan.input.physicalGraph.nodes.some(
            (node) =>
              (node.data as { driverTypeId?: string }).driverTypeId === "sequence",
          ) ||
          plan.profiles.some((profile) =>
            profile.sampleOps.some((op) => op.op === "STEPPER"),
          );
        if (needsMotionFirmware) {
          const version = snapshot.status?.version?.match(/^(\d+)\.(\d+)\.(\d+)/);
          if (
            !version ||
            (Number(version[1]) === 0 &&
              (Number(version[2]) < 5 ||
                (Number(version[2]) === 5 && Number(version[3]) < 8)))
          )
            throw new Error(
              "Aggiorna la Backbone al firmware 0.5.8 o successivo per Sequenza e Movimento terminato dello stepper.",
            );
        }
        const available = profilesByBinding.get(binding.bindingId);
        const known = new Set([
          ...(available ?? []),
          ...plan.profiles.map((profile) => profile.profileId),
        ]);
        const dryRun = dryRunConfig(plan.input, {
          ...plan.options,
          ...(available ? { availableProfileIds: known } : {}),
        });
        if (!dryRun.compiled) {
          errors.push(
            ...dryRun.issues
              .filter((issue) => issue.severity !== "warning")
              .map((issue) => ({
                bindingId: binding.bindingId,
                technical: issue.remediation,
                nodeId: base.processingGraph.nodes.some(
                  (node) => node.id === issue.target,
                )
                  ? issue.target
                  : undefined,
              })),
          );
          return;
        }
        const diff = diffConfigs(liveDecoded.value, dryRun.compiled);
        if (isConfigDiffEmpty(diff)) return;
        const missingProfiles = dryRun.issues
          .filter((issue) => issue.code === "config-decompiler.missing_profile")
          .map((issue) => issue.target);
        out.push({
          binding,
          bindingIndex,
          input: plan.input,
          profiles: plan.profiles,
          options: plan.options,
          diff,
          expectedGeneration: snapshot.config.generation,
          missingProfiles,
        });
      } catch (cause) {
        const detail = cause as { nodeId?: string; code?: string };
        errors.push({
          bindingId: binding.bindingId,
          nodeId: detail?.nodeId,
          code: detail?.code,
          technical: cause instanceof Error ? cause.message : String(cause),
        });
      }
    });
    return { candidates: out, errors };
  })();
  const candidates = compilation.candidates;

  useEffect(() => {
    let cancelled = false;
    for (const c of candidates) {
      if (profilesByBinding.has(c.binding.bindingId)) continue;
      listDeviceProfiles(c.binding.bindingId)
        ?.then(
          (list) =>
            !cancelled &&
            setProfilesByBinding((prev) =>
              new Map(prev).set(
                c.binding.bindingId,
                new Set(list.map((p) => p.profileId)),
              ),
            ),
        )
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates.map((c) => c.binding.bindingId).join(",")]);

  const selectedCandidates = candidates.filter(
    (c) => selected === null || selected.has(c.binding.bindingId),
  );
  const problems = uniqueDeployProblems([
    ...compilation.errors,
    ...connectionErrors,
  ]).filter(
    (problem) =>
      selected === null ||
      !problem.bindingId ||
      [...selected].some((id) => id === problem.bindingId),
  );
  const busy = submitting || running.size > 0;
  const successful = [...results.values()].filter((r) =>
    [
      DeploymentOutcomeKind.SUCCESS,
      DeploymentOutcomeKind.NO_OP,
      DeploymentOutcomeKind.AMBIGUOUS_RESOLVED_APPLIED,
    ].includes(r.outcome as "SUCCESS"),
  );
  const failed = [...results.entries()].filter(
    ([, result]) => !successful.includes(result),
  );
  const blocked = problems.length > 0 || Boolean(deployError) || failed.length > 0;
  const canDeploy =
    !busy && !checking && !problems.length && selectedCandidates.length > 0;
  function toggle(bindingId: CoreBindingId) {
    setSelected((prev) => {
      const next = new Set(prev ?? bindings.map((binding) => binding.bindingId));
      if (next.has(bindingId)) next.delete(bindingId);
      else next.add(bindingId);
      return next;
    });
  }
  async function handleDeploy() {
    if (submittingRef.current || !canDeploy) return;
    submittingRef.current = true;
    setSubmitting(true);
    setResults(new Map());
    const controller = new AbortController();
    deployAbort.current = controller;
    let timedOut = false;
    const timer = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 60000);
    pausePolling();
    lockTransport();
    try {
      updateDeployPhase("Attesa delle comunicazioni in corso…");
      await abortableModuleOperation(waitUntilIdle(), controller.signal);
      await abortableModuleOperation(
        performDeploy(controller.signal),
        controller.signal,
      );
    } catch (cause) {
      setDeployError(
        controller.signal.aborted
          ? timedOut
            ? `Nessuna conferma durante «${deployPhaseRef.current}» entro 60 secondi. Esito non confermato: premi Ricontrolla prima di riprovare.`
            : "Attesa interrotta. La Backbone potrebbe aver ricevuto il programma: premi Ricontrolla prima di riprovare."
          : formatApplyConfigError(cause, it),
      );
    } finally {
      window.clearTimeout(timer);
      deployAbort.current = null;
      setDeployPhase("");
      setRunning(new Set());
      unlockTransport();
      resumePolling();
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  async function performDeploy(signal: AbortSignal) {
    const wireFor = (bindingId: CoreBindingId) => {
      signal.throwIfAborted();
      const client = getClient(bindingId);
      if (!client) throw new Error("Backbone scollegata durante il caricamento.");
      return deployWire(client, signal, updateDeployPhase);
    };
    setDeployError(null);
    if (problems.length) return;
    const targets = selectedCandidates;
    if (targets.length === 0) {
      setDeployError("La configurazione non contiene modifiche distribuibili.");
      return;
    }
    const verified = await verifyDeployConnections(
      targets.map((candidate) => ({
        bindingId: candidate.binding.bindingId,
        label: `Backbone ${candidate.bindingIndex + 1}`,
      })),
      wireFor,
    );
    verified.forEach(({ bindingId, status }) => observeStatus(bindingId, status));
    setRunning(new Set(targets.map((candidate) => candidate.binding.bindingId)));
    const cleanupByBinding = new Map<CoreBindingId, () => Promise<void>>();
    try {
      for (const candidate of targets) {
        if (candidate.profiles.length) {
          const version = getSnapshot(candidate.binding.bindingId)?.status?.version;
          const match = version?.match(/^(\d+)\.(\d+)\.(\d+)/);
          if (
            match &&
            Number(match[1]) === 0 &&
            (Number(match[2]) < 3 || (Number(match[2]) === 3 && Number(match[3]) < 6))
          )
            throw new Error(
              "Aggiorna il firmware a 0.3.6 o successivo per i driver multi-azione.",
            );
        }
        const ownershipKey = `spaghettilab.driver-profiles:${candidate.binding.expectedDeviceId}`;
        let owned: { profileId: string; version: number }[] = [];
        try {
          const saved: unknown = JSON.parse(localStorage.getItem(ownershipKey) ?? "[]");
          if (Array.isArray(saved))
            owned = saved.filter(
              (item): item is { profileId: string; version: number } =>
                typeof item?.profileId === "string" && Number.isInteger(item?.version),
            );
        } catch {
          /* Storage may be disabled; profile installation still works. */
        }
        cleanupByBinding.set(
          candidate.binding.bindingId,
          await installDriverProfiles(candidate.profiles, owned, {
            install: async (profile) => {
              const result = await installProfileWorkflow(
                wireFor(candidate.binding.bindingId),
                profile,
              );
              signal.throwIfAborted();
              if (!result || !result.ok)
                throw new Error(
                  result && !result.ok
                    ? result.error.remediation
                    : "Core scollegato durante l’installazione del driver.",
                );
            },
            remove: async (id, version) => {
              try {
                await wireFor(candidate.binding.bindingId).removeDeviceProfile({
                  idBytes: new TextEncoder().encode(id),
                  version,
                });
                return true;
              } catch {
                return false;
              }
            },
            remember: (entries) => {
              try {
                localStorage.setItem(ownershipKey, JSON.stringify(entries));
              } catch {
                /* Optional ownership tracking. */
              }
            },
          }),
        );
        const installed = await wireFor(
          candidate.binding.bindingId,
        ).getFullDeviceProfileList();
        const validation = dryRunConfig(candidate.input, {
          ...candidate.options,
          availableProfileIds: new Set(
            (installed ?? []).map((profile) => profile.profileId),
          ),
        });
        if (
          validation.issues.some(
            (issue) => issue.code === "config-decompiler.missing_profile",
          )
        )
          throw new Error("Un profilo necessario non risulta installato sul Core.");
      }
    } catch (cause) {
      if (signal.aborted) throw cause;
      setDeployError(cause instanceof Error ? cause.message : String(cause));
      setRunning(new Set());
      return;
    }
    try {
      await Promise.all(
        targets.map(async (c) => {
          setExecutionMode(c.binding.bindingId, "busy");
          const depId = deploymentId(crypto.randomUUID());
          if (!depId.ok || !session) return;
          const result = await deployConfigWorkflow(
            wireFor(c.binding.bindingId),
            c.input,
            {
              ...c.options,
              expectedGeneration: c.expectedGeneration,
              sourceProjectHash: canonicalProjectHash(session.stack.current),
              target: c.binding.bindingId,
              deploymentId: depId.value,
              timestamp: new Date().toISOString(),
            },
          );
          signal.throwIfAborted();
          if (!result)
            throw new Error(
              "La Backbone non ha confermato il caricamento. Ricontrolla la connessione.",
            );
          if (result) {
            setResults((prev) => new Map(prev).set(c.binding.bindingId, result));
            if (result.record) execute?.(appendDeploymentRecord(result.record));
            if (result.outcome === DeploymentOutcomeKind.SUCCESS) {
              setExecutionMode(c.binding.bindingId, "continuous");
              await cleanupByBinding.get(c.binding.bindingId)?.();
              try {
                const live = await wireFor(c.binding.bindingId).getConfig();
                if (live) observeConfig(c.binding.bindingId, live);
              } catch {
                /* Pause still works from the next GET_CONFIG. */
              }
            }
          }
          setRunning((prev) => {
            const next = new Set(prev);
            next.delete(c.binding.bindingId);
            return next;
          });
        }),
      );
    } catch (cause) {
      if (signal.aborted) throw cause;
      if (isRetryableConfigApply(cause)) {
        for (const candidate of targets) {
          const client = getClient(candidate.binding.bindingId);
          if (!client) continue;
          try {
            const stopped = await applyStoppedRuntime(client, signal);
            observeConfig(candidate.binding.bindingId, stopped.config);
            if (stopped.changed) await waitConfigWriteGap(signal);
          } catch {
            /* Best-effort free of slots before asking for another deploy. */
          }
        }
      }
      setDeployError(formatApplyConfigError(cause, locale === "it"));
    } finally {
      setRunning(new Set());
    }
  }

  const modules = parseBackboneSensorModules(
    session?.stack.current.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment,
  );
  const shownProblems = uniqueDeployProblems([
    ...problems,
    ...(deployError
      ? [
          {
            technical: deployError,
            phase: deployPhaseRef.current,
            ...(/conferma|confermato|Attesa interrotta|timeout|timed out|connection.*closed/i.test(
              deployError,
            )
              ? { code: "upload-unconfirmed" }
              : /Backbone.*(collegamento|risponde|rilevata)/i.test(deployError)
                ? { code: "offline" }
                : {}),
          },
        ]
      : []),
    ...failed.flatMap(([bindingId, result]) =>
      result.issues.length
        ? result.issues.map((issue) => ({
            bindingId,
            technical: issue.cause
              ? formatApplyConfigError(issue.cause, it)
              : issue.remediation,
            code: issue.code,
          }))
        : [
            {
              bindingId,
              technical: it
                ? "Caricamento non confermato. Ricontrolla lo stato della Backbone."
                : "Upload not confirmed. Check the board status.",
            },
          ],
    ),
  ]);
  const showProblem = (problem: DeployProblem) => {
    closeDeploy();
    if (onClose) onClose();
    const id = problem.bindingId ?? bindings[0]?.bindingId;
    if (id) focusCanvas(id, problem.nodeId);
    else navigate("processing-graph");
  };
  return (
    <dialog
      ref={dialogRef}
      className="deploy-dialog"
      aria-labelledby="deploy-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <header className="flex items-start gap-4 px-6 pt-6 pb-4">
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-brand-blue text-brand-blue">
          <Play size={23} />
        </span>
        <div className="min-w-0 flex-1">
          <h1
            id="deploy-dialog-title"
            className="font-heading text-xl font-bold text-ink"
          >
            {it ? "Avvia il programma" : "Start the program"}
          </h1>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            {it
              ? "Carica il Flow sulla Backbone e avvia le azioni configurate."
              : "Upload the Flow to your Backbone and start its configured actions."}
          </p>
        </div>
        <button
          autoFocus
          type="button"
          aria-label={it ? "Chiudi" : "Close"}
          disabled={busy}
          onClick={close}
          className="rounded-md p-1 text-ink-faint hover:bg-surface-sunken disabled:opacity-30"
        >
          <X size={19} />
        </button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 pb-5">
        <div
          role="status"
          aria-live="polite"
          className={`flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold ${checking || busy ? "bg-brand-blue/5 text-brand-blue" : blocked ? "bg-warning/10 text-amber-800" : "bg-success/10 text-success"}`}
        >
          {checking || busy ? (
            <LoaderCircle size={19} className="animate-spin" />
          ) : blocked ? (
            <CircleAlert size={19} />
          ) : (
            <Check size={19} />
          )}
          {checking
            ? it
              ? "Controllo delle Backbone…"
              : "Checking Backbones…"
            : busy
              ? it
                ? deployPhase || "Caricamento e verifica in corso…"
                : "Uploading and verifying…"
              : blocked
                ? it
                  ? `${shownProblems.length} ${shownProblems.length === 1 ? "problema da risolvere" : "problemi da risolvere"}`
                  : `${shownProblems.length} issues to resolve`
                : successful.length
                  ? it
                    ? "Programma caricato e verificato"
                    : "Program uploaded and verified"
                  : !bindings.length
                    ? it
                      ? "Collega una Backbone per iniziare"
                      : "Connect a Backbone to begin"
                    : !candidates.length
                      ? it
                        ? "Nessuna modifica da caricare"
                        : "No changes to upload"
                      : it
                        ? "Pronto per essere caricato"
                        : "Ready to upload"}
        </div>
        {bindings.map((binding, index) => {
          const candidate = candidates.find(
            (c) => c.binding.bindingId === binding.bindingId,
          );
          const result = results.get(binding.bindingId);
          const deviceModules = modulesForBinding(modules, binding.bindingId);
          const graph = session?.stack.current.deviceGraphs[index];
          const online =
            !connectionErrors.some((error) => error.bindingId === binding.bindingId) &&
            Boolean(getSnapshot(binding.bindingId)?.config);
          return (
            <section
              key={binding.bindingId}
              className="overflow-hidden rounded-xl border border-border"
            >
              <div className="flex items-center gap-3 bg-surface-sunken/30 px-4 py-3">
                {bindings.length > 1 && (
                  <input
                    type="checkbox"
                    checked={selected === null || selected.has(binding.bindingId)}
                    disabled={busy}
                    onChange={() => toggle(binding.bindingId)}
                    aria-label={`${it ? "Carica su" : "Upload to"} Backbone ${index + 1}`}
                  />
                )}
                <Cpu size={26} className="text-ink-muted" />
                <div className="flex-1">
                  <h2 className="text-sm font-semibold text-ink">
                    Backbone {index + 1}
                  </h2>
                  <p className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-muted">
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${online ? "bg-success" : "bg-ink-faint"}`}
                    />
                    {online
                      ? it
                        ? "Connessa"
                        : "Connected"
                      : it
                        ? "Non connessa"
                        : "Disconnected"}
                  </p>
                </div>
                {result && successful.includes(result) && (
                  <Check size={18} className="text-success" />
                )}
              </div>
              {!blocked && !checking && (
                <div className="space-y-3 border-t border-border p-4">
                  <h3 className="text-xs font-semibold text-ink">
                    {it ? "Cosa contiene il programma" : "What the program contains"}
                  </h3>
                  {deviceModules
                    .filter((module) =>
                      graph?.nodes.some(
                        (node) =>
                          (node.data as { properties?: Record<string, unknown> })
                            .properties?.backboneSensorModuleId === module.id,
                      ),
                    )
                    .map((module) => {
                      const actions = graph?.nodes
                        .filter(
                          (node) =>
                            (node.data as { properties?: Record<string, unknown> })
                              .properties?.backboneSensorModuleId === module.id,
                        )
                        .map((node) => {
                          const props = (
                            node.data as { properties?: Record<string, unknown> }
                          ).properties;
                          return module.recipe.deviceDraft?.commands.find(
                            (command) => command.id === props?.sensorActionId,
                          )?.label;
                        })
                        .filter(Boolean);
                      return (
                        <div key={module.id} className="flex items-center gap-3">
                          <div className="w-12 shrink-0">
                            <ModuleArtwork
                              kind={
                                module.recipe.deviceDraft?.gpioHardware?.kind ??
                                "generic"
                              }
                              name={module.label}
                            />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-ink">
                              {module.label}
                            </p>
                            <p className="mt-1 text-xs text-ink-muted">
                              {[...new Set(actions)].join(" · ") ||
                                (it
                                  ? "Azioni definite nel canvas"
                                  : "Actions defined on the canvas")}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  <p className="text-xs text-ink-muted">
                    {graph?.nodes.length ?? 0}{" "}
                    {it ? "blocchi nel canvas" : "canvas blocks"} ·{" "}
                    {graph?.edges.length ?? 0} {it ? "collegamenti" : "connections"}
                  </p>
                  {!candidate && !result && (
                    <p className="text-xs text-ink-muted">
                      {it
                        ? "La configurazione corrisponde a quella sulla Backbone. Non verrà inviata di nuovo."
                        : "The configuration matches the Backbone. It will not be sent again."}
                    </p>
                  )}
                </div>
              )}
              {candidate && (
                <details className="border-t border-border px-4 py-3">
                  <summary className="cursor-pointer text-xs text-ink-muted">
                    {it ? "Dettagli delle modifiche" : "Change details"}
                  </summary>
                  <div className="mt-3">
                    <ConfigDiffView diff={candidate.diff} />
                  </div>
                </details>
              )}
              {result && (
                <details className="border-t border-border px-4 py-3">
                  <summary className="cursor-pointer text-xs text-ink-muted">
                    {it ? "Verifica del caricamento" : "Upload verification"}
                  </summary>
                  <PipelineStepper result={result} running={false} />
                </details>
              )}
            </section>
          );
        })}
        {shownProblems.map((problem, index) => {
          const text = describeDeployProblem(problem, it);
          return (
            <section
              key={`${problem.bindingId}-${index}`}
              className="rounded-xl border border-warning/30 border-l-4 border-l-warning bg-warning/5 p-4"
            >
              <h3 className="text-sm font-semibold text-ink">{text.title}</h3>
              {problem.bindingId && bindings.length > 1 && (
                <p className="mt-1 text-xs text-ink-muted">
                  Backbone{" "}
                  {bindings.findIndex((b) => b.bindingId === problem.bindingId) + 1}
                </p>
              )}
              {problem.code === "wave-stepper-start" && (
                <div className="my-3 flex items-center gap-2 text-xs text-ink-muted">
                  <span className="rounded-md border border-border bg-surface px-2 py-2">
                    {it ? "Onda quadra" : "Square wave"}
                  </span>
                  <span className="h-px flex-1 bg-border" />
                  <CircleAlert size={16} className="text-warning" />
                  <span className="h-px flex-1 bg-border" />
                  <span className="rounded-md border border-border bg-surface px-2 py-2">
                    Stepper · Start
                  </span>
                </div>
              )}
              <p className="mt-2 text-xs leading-relaxed text-ink-muted">{text.body}</p>
              <h4 className="mt-3 text-xs font-semibold text-ink">
                {it ? "Come risolvere" : "How to fix"}
              </h4>
              <p className="mt-1 text-xs leading-relaxed text-ink-muted">
                {text.remedy}
              </p>
              {["offline", "upload-unconfirmed"].includes(problem.code ?? "") ? (
                <button
                  disabled={busy || checking}
                  onClick={() => {
                    setChecking(true);
                    void refresh();
                  }}
                  className="mt-3 inline-flex items-center gap-2 rounded-md border border-brand-blue px-3 py-2 text-xs text-brand-blue"
                >
                  <RefreshCw size={14} />
                  {it ? "Ricontrolla" : "Check again"}
                </button>
              ) : (
                <button
                  disabled={busy}
                  onClick={() => showProblem(problem)}
                  className="mt-3 inline-flex items-center gap-2 rounded-md border border-brand-blue px-3 py-2 text-xs text-brand-blue"
                >
                  <LocateFixed size={14} />
                  {it ? "Mostra nel canvas" : "Show on canvas"}
                </button>
              )}
              <details className="mt-3 text-[11px] text-ink-muted">
                <summary className="cursor-pointer">
                  {it ? "Dettagli tecnici" : "Technical details"}
                </summary>
                <pre className="mt-2 whitespace-pre-wrap break-all font-mono">
                  {problem.technical}
                </pre>
              </details>
            </section>
          );
        })}
        <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-muted">
          <Info size={15} className="mt-0.5 shrink-0 text-brand-blue" />
          {busy
            ? it
              ? "Attendi la conferma prima di scollegare la Backbone."
              : "Wait for confirmation before disconnecting."
            : failed.length || deployError
              ? it
                ? "Il caricamento non è confermato. Ricontrolla la Backbone prima di riprovare."
                : "Upload is not confirmed. Check the Backbone before retrying."
              : problems.length
                ? it
                  ? "Nessuna modifica inviata alla Backbone."
                  : "No changes sent to the Backbone."
                : successful.length
                  ? it
                    ? "Il programma sulla Backbone è stato verificato. Usa Stop dal canvas per fermarlo."
                    : "The program was verified on the Backbone. Use Stop on the canvas to stop it."
                  : !bindings.length
                    ? it
                      ? "Aggiungi e collega una Backbone dalla sezione Discover."
                      : "Add and connect a Backbone in Discover."
                    : !candidates.length
                      ? it
                        ? "Non verrà inviato nulla. Puoi tornare al canvas e continuare a lavorare."
                        : "Nothing will be sent. Return to the canvas to keep working."
                      : it
                        ? "Il programma sulla Backbone verrà sostituito. Il canvas rimane nel progetto."
                        : "The program on the Backbone will be replaced. The canvas stays in the project."}
        </p>
      </div>
      <footer className="flex shrink-0 items-center justify-between gap-3 border-t border-border bg-surface-sunken/30 px-6 py-4">
        <button
          disabled={busy}
          onClick={() => {
            close();
            navigate("processing-graph");
          }}
          className="rounded-lg border border-border-strong px-4 py-2.5 text-xs font-semibold text-ink disabled:opacity-40"
        >
          {it ? "Torna al canvas" : "Back to canvas"}
        </button>
        {busy && (
          <button
            type="button"
            className="rounded-xl border border-border-strong px-4 py-2 text-sm text-ink"
            onClick={() => deployAbort.current?.abort()}
          >
            Interrompi attesa
          </button>
        )}
        {blocked && shownProblems[0] ? (
          <button
            disabled={busy || checking}
            onClick={() =>
              ["offline", "upload-unconfirmed"].includes(shownProblems[0]?.code ?? "")
                ? void refresh()
                : showProblem(shownProblems[0]!)
            }
            className="inline-flex items-center gap-2 rounded-lg bg-brand-blue px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            <LocateFixed size={15} />
            {["offline", "upload-unconfirmed"].includes(shownProblems[0].code ?? "")
              ? it
                ? "Ricontrolla"
                : "Check again"
              : it
                ? "Torna al collegamento"
                : "Go to connection"}
          </button>
        ) : canDeploy ? (
          <button
            onClick={() => void handleDeploy()}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-blue px-5 py-2.5 text-xs font-semibold text-white disabled:opacity-40"
          >
            <Play size={15} />
            {it ? "Carica e avvia" : "Upload and start"}
          </button>
        ) : successful.length && !busy ? (
          <button
            onClick={close}
            className="rounded-lg bg-brand-blue px-5 py-2.5 text-xs font-semibold text-white"
          >
            {it ? "Fatto" : "Done"}
          </button>
        ) : null}
      </footer>
    </dialog>
  );
}
