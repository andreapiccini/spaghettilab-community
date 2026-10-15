import type { DeviceProfileDraft } from "@spaghettilab/device-profile-authoring-model";
import type {
  CompileConfigInput,
  CompileConfigOptions,
} from "@spaghettilab/config-compiler";
import {
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
import { Check, PackageX, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { installDriverProfiles } from "../../lib/driver-profile-deployment.js";
import { prepareDriverDeployment } from "../../lib/driver-deployment-plan.js";
import { deployDiffCopy } from "../../lib/deploy-diff-copy.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { useLocale } from "../../state/locale-context.js";
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
export function DeployDiffScreen() {
  const { locale } = useLocale();
  const copy = deployDiffCopy(locale);
  const { session, execute, navigate, deployRequestId } = useSession();
  const {
    getSnapshot,
    listDeviceProfiles,
    installProfile,
    removeProfile,
    deployConfig,
    discoverNetwork,
  } = useCoreSessions();
  const bindings = session?.stack.current.coreBindings ?? EMPTY_BINDINGS;

  const [selected, setSelected] = useState<ReadonlySet<CoreBindingId>>(new Set());
  const [profilesByBinding, setProfilesByBinding] = useState<
    Map<CoreBindingId, ReadonlySet<string>>
  >(new Map());
  const [results, setResults] = useState<Map<CoreBindingId, DeploymentResult>>(
    new Map(),
  );
  const [running, setRunning] = useState<ReadonlySet<CoreBindingId>>(new Set());
  const [deployError, setDeployError] = useState<string | null>(null);
  const handledRequestRef = useRef(0);

  const compilation = useMemo(() => {
    const out: CoreCandidate[] = [],
      errors: string[] = [];
    if (!session) return { candidates: out, errors };
    bindings.forEach((binding, bindingIndex) => {
      const snapshot = getSnapshot(binding.bindingId);
      if (!snapshot?.config) return;
      const liveDecoded = decodeConfigCbor(snapshot.config.configBytes);
      if (!liveDecoded.ok) {
        errors.push("Configurazione del Core non leggibile.");
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
          errors.push(...dryRun.issues.map((issue) => issue.remediation));
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
        errors.push(
          `${binding.expectedDeviceId}: ${cause instanceof Error ? cause.message : String(cause)}`,
        );
      }
    });
    return { candidates: out, errors };
  }, [session, bindings, getSnapshot, profilesByBinding]);
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

  const selectedCandidates = candidates.filter((c) =>
    selected.has(c.binding.bindingId),
  );
  const totalChanges = selectedCandidates.reduce(
    (sum, c) =>
      sum +
      c.diff.modules.added.length +
      c.diff.modules.removed.length +
      c.diff.modules.changed.length +
      c.diff.schedules.added.length +
      c.diff.schedules.removed.length +
      c.diff.schedules.changed.length +
      c.diff.rules.added.length +
      c.diff.rules.removed.length +
      c.diff.rules.changed.length +
      c.diff.blocks.added.length +
      c.diff.blocks.removed.length +
      c.diff.blocks.changed.length +
      c.diff.edges.added.length +
      c.diff.edges.removed.length,
    0,
  );
  const blockedCandidates = selectedCandidates.filter(
    (c) => c.missingProfiles.length > 0,
  );
  const canDeploy = running.size === 0;

  function toggle(bindingId: CoreBindingId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(bindingId)) next.delete(bindingId);
      else next.add(bindingId);
      return next;
    });
  }

  async function handleDeploy() {
    setDeployError(null);
    if (compilation.errors.length) {
      setDeployError(compilation.errors.join("\n"));
      return;
    }
    const discovered = await discoverNetwork();
    if (discovered.length === 0) {
      setDeployError("Nessuna Backbone rilevata. Deploy annullato.");
      return;
    }
    const targets = selectedCandidates.length > 0 ? selectedCandidates : candidates;
    if (targets.length === 0) {
      setDeployError("La configurazione non contiene modifiche distribuibili.");
      return;
    }
    const available = new Set(discovered.map(({ bindingId }) => bindingId));
    const missing = targets.filter(
      (candidate) => !available.has(candidate.binding.bindingId),
    );
    if (missing.length > 0) {
      setDeployError(
        `Backbone richiesta non disponibile: ${missing.map((candidate) => candidate.binding.expectedDeviceId).join(", ")}.`,
      );
      return;
    }
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
              const result = await installProfile(candidate.binding.bindingId, profile);
              if (!result || !result.ok)
                throw new Error(
                  result && !result.ok
                    ? result.error.remediation
                    : "Core scollegato durante l’installazione del driver.",
                );
            },
            remove: async (id, version) => {
              try {
                return (
                  (
                    await removeProfile(candidate.binding.bindingId, id, version, {
                      isReferencedLocally: false,
                    })
                  )?.ok ?? false
                );
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
        const installed = await listDeviceProfiles(candidate.binding.bindingId);
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
      setDeployError(cause instanceof Error ? cause.message : String(cause));
      setRunning(new Set());
      return;
    }
    try {
      await Promise.all(
        targets.map(async (c) => {
          const depId = deploymentId(crypto.randomUUID());
          if (!depId.ok || !session) return;
          const result = await deployConfig(c.binding.bindingId, c.input, {
            ...c.options,
            expectedGeneration: c.expectedGeneration,
            sourceProjectHash: canonicalProjectHash(session.stack.current),
            target: c.binding.bindingId,
            deploymentId: depId.value,
            timestamp: new Date().toISOString(),
          });
          if (result) {
            setResults((prev) => new Map(prev).set(c.binding.bindingId, result));
            if (result.record) execute?.(appendDeploymentRecord(result.record));
            if (result.outcome === DeploymentOutcomeKind.SUCCESS)
              await cleanupByBinding.get(c.binding.bindingId)?.();
          }
          setRunning((prev) => {
            const next = new Set(prev);
            next.delete(c.binding.bindingId);
            return next;
          });
        }),
      );
    } catch (cause) {
      setDeployError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(new Set());
    }
  }

  useEffect(() => {
    if (deployRequestId === 0 || deployRequestId === handledRequestRef.current) return;
    handledRequestRef.current = deployRequestId;
    void handleDeploy();
    // The request id represents an explicit click; candidates are captured from that render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deployRequestId]);

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <h1 className="font-heading text-lg font-semibold text-ink">Deploy & Diff</h1>
        <span className="ml-auto flex items-center gap-1.5 rounded-slpill border border-border-strong px-3 py-1.5 font-body text-sm text-ink-muted">
          {copy.changesCores(totalChanges, selectedCandidates.length)}
        </span>
        <button
          type="button"
          disabled={!canDeploy}
          onClick={() => void handleDeploy()}
          className="rounded-slpill bg-brand-blue px-4 py-1.5 font-body-strong text-sm text-white hover:bg-brand-blue-dark disabled:cursor-not-allowed disabled:opacity-40"
        >
          Run Deploy
        </button>
      </div>

      {compilation.errors.length > 0 && (
        <div
          role="alert"
          className="mx-6 mt-4 whitespace-pre-wrap rounded-slsm border border-error p-3 text-sm text-error"
        >
          {compilation.errors.join("\n")}
        </div>
      )}
      {deployError && (
        <div
          role="alert"
          className="mx-6 mt-4 rounded-slsm border border-error bg-error/5 px-4 py-3 font-body text-sm text-error"
        >
          {deployError}
        </div>
      )}

      {candidates.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="font-body text-sm text-ink-faint">{copy.noPending}</p>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-4 p-6">
          <div className="flex flex-wrap gap-2">
            {candidates.map((c) => {
              const result = results.get(c.binding.bindingId);
              const isRunning = running.has(c.binding.bindingId);
              return (
                <button
                  key={c.binding.bindingId}
                  type="button"
                  onClick={() => toggle(c.binding.bindingId)}
                  className="flex items-center gap-2 rounded-slpill px-3 py-1.5 font-body text-sm"
                  style={{
                    border: selected.has(c.binding.bindingId)
                      ? "2px solid var(--color-brand-blue)"
                      : "1px solid var(--color-border-strong)",
                    backgroundColor: selected.has(c.binding.bindingId)
                      ? "color-mix(in srgb, var(--color-brand-blue) 8%, transparent)"
                      : "transparent",
                  }}
                >
                  {c.missingProfiles.length > 0 ? (
                    <PackageX size={12} className="text-warning" />
                  ) : (
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{
                        backgroundColor: isRunning
                          ? "var(--color-info)"
                          : "var(--color-ink-faint)",
                      }}
                    />
                  )}
                  {c.binding.expectedDeviceId}
                  <span className="font-body text-xs text-ink-faint">
                    {copy.changes(
                      c.diff.modules.added.length +
                        c.diff.modules.removed.length +
                        c.diff.modules.changed.length +
                        c.diff.schedules.added.length +
                        c.diff.rules.added.length +
                        c.diff.blocks.added.length +
                        c.diff.edges.added.length,
                    )}
                  </span>
                  {result &&
                    (result.outcome === DeploymentOutcomeKind.SUCCESS ||
                    result.outcome === DeploymentOutcomeKind.NO_OP ? (
                      <Check size={12} className="text-success" />
                    ) : (
                      <X size={12} className="text-error" />
                    ))}
                </button>
              );
            })}
          </div>

          {blockedCandidates.length > 0 && (
            <div
              className="flex items-start gap-2 border-l-4 border-warning p-3"
              style={{
                backgroundColor:
                  "color-mix(in srgb, var(--color-warning) 8%, transparent)",
              }}
            >
              <PackageX size={16} className="mt-0.5 shrink-0 text-warning" />
              <div>
                <p className="font-body text-sm text-ink">
                  {copy.blocked(
                    blockedCandidates.reduce((n, c) => n + c.missingProfiles.length, 0),
                  )}
                </p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {blockedCandidates.flatMap((c) =>
                    c.missingProfiles.map((p) => (
                      <li
                        key={`${c.binding.bindingId}-${p}`}
                        className="font-body text-xs text-ink-muted"
                      >
                        {c.binding.expectedDeviceId}:{" "}
                        <span className="font-mono">{p}</span> —{" "}
                        <button
                          type="button"
                          onClick={() => navigate("device-profile-studio")}
                          className="font-semibold text-brand-blue underline"
                        >
                          {copy.goToStudio}
                        </button>
                      </li>
                    )),
                  )}
                </ul>
              </div>
            </div>
          )}

          {selectedCandidates.map((c) => {
            const result = results.get(c.binding.bindingId) ?? null;
            const isRunning = running.has(c.binding.bindingId);
            return (
              <div
                key={c.binding.bindingId}
                className="flex flex-col gap-2 rounded-slmd border border-border p-3"
              >
                <h2 className="font-body text-sm font-semibold text-ink">
                  {c.binding.expectedDeviceId}
                </h2>
                {result?.outcome === DeploymentOutcomeKind.STALE_GENERATION &&
                result.diff &&
                result.liveConfig ? (
                  <ConflictPanel
                    coreName={c.binding.expectedDeviceId}
                    diff={result.diff}
                    copy={copy}
                  />
                ) : (
                  <ConfigDiffView diff={c.diff} />
                )}
                {(isRunning || result) && (
                  <PipelineStepper result={result} running={isRunning} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConflictPanel({
  coreName,
  diff,
  copy,
}: {
  readonly coreName: string;
  readonly diff: ConfigDiff;
  readonly copy: ReturnType<typeof deployDiffCopy>;
}) {
  return (
    <div className="rounded-slmd border-2 border-error p-4">
      <h3 className="font-heading text-base font-semibold text-ink">
        {copy.conflictOn(coreName)}
      </h3>
      <p className="mt-1 font-body text-sm text-ink-muted">{copy.conflictBody}</p>
      <div className="mt-3">
        <ConfigDiffView diff={diff} />
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="flex-1 rounded-slsm border border-border-strong px-3 py-2 font-body text-sm text-ink hover:bg-surface-raised"
        >
          {copy.importLive}
        </button>
        <button
          type="button"
          disabled
          title="Non ancora implementato — il rebase/merge strutturato richiede il decompilatore collegato al progetto autore, non ancora cablato (gap dichiarato)"
          className="flex-1 rounded-slsm border border-border-strong px-3 py-2 font-body text-sm text-ink opacity-40"
        >
          {copy.rebase}
        </button>
        <button
          type="button"
          className="flex-1 rounded-slsm border border-border-strong px-3 py-2 font-body text-sm text-ink-muted hover:bg-surface-raised"
        >
          {copy.cancel}
        </button>
      </div>
    </div>
  );
}
