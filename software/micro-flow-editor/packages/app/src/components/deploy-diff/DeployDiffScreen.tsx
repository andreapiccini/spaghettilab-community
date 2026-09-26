import type { CompileConfigInput } from "@spaghettilab/config-compiler";
import { diffConfigs, isConfigDiffEmpty, DeploymentOutcomeKind, type ConfigDiff, type DeploymentResult } from "@spaghettilab/config-deployment";
import { decodeConfigCbor, dryRunConfig } from "@spaghettilab/config-decompiler";
import { appendDeploymentRecord, canonicalProjectHash, deploymentId, type CoreBindingId, type CoreBindingRecord, type GraphState } from "@spaghettilab/domain";
import { Check, PackageX, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { DEFAULT_ENERGY, DISABLED_MQTT } from "../../lib/default-config-policy.js";
import { deployDiffCopy } from "../../lib/deploy-diff-copy.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { useLocale } from "../../state/locale-context.js";
import { useSession } from "../../state/session-context.js";
import { ConfigDiffView } from "./ConfigDiffView.js";
import { PipelineStepper } from "./PipelineStepper.js";

const EMPTY_PHYSICAL: GraphState<"physical-composition"> = { layer: "physical-composition", nodes: [], edges: [] };
const EMPTY_PROCESSING: GraphState<"device-processing"> = { layer: "device-processing", nodes: [], edges: [] };
const EMPTY_BINDINGS: readonly CoreBindingRecord[] = [];

type CoreCandidate = {
  readonly binding: CoreBindingRecord;
  readonly bindingIndex: number;
  readonly input: CompileConfigInput;
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
  const { session, execute, navigate } = useSession();
  const { getSnapshot, listDeviceProfiles, deployConfig } = useCoreSessions();
  const bindings = session?.stack.current.coreBindings ?? EMPTY_BINDINGS;

  const [selected, setSelected] = useState<ReadonlySet<CoreBindingId>>(new Set());
  const [profilesByBinding, setProfilesByBinding] = useState<Map<CoreBindingId, ReadonlySet<string>>>(new Map());
  const [results, setResults] = useState<Map<CoreBindingId, DeploymentResult>>(new Map());
  const [running, setRunning] = useState<ReadonlySet<CoreBindingId>>(new Set());

  const candidates = useMemo<readonly CoreCandidate[]>(() => {
    if (!session) return [];
    const out: CoreCandidate[] = [];
    bindings.forEach((binding, bindingIndex) => {
      const snapshot = getSnapshot(binding.bindingId);
      if (!snapshot?.config) return;
      const liveDecoded = decodeConfigCbor(snapshot.config.configBytes);
      if (!liveDecoded.ok) return;
      const physicalGraph = session.stack.current.physicalGraphs[bindingIndex] ?? EMPTY_PHYSICAL;
      const processingGraph = session.stack.current.deviceGraphs[bindingIndex] ?? EMPTY_PROCESSING;
      const input: CompileConfigInput = { physicalGraph, processingGraph, mqtt: DISABLED_MQTT, connectivity: 0, energy: DEFAULT_ENERGY };
      const available = profilesByBinding.get(binding.bindingId);
      const dryRun = dryRunConfig(input, available ? { availableProfileIds: available } : {});
      if (!dryRun.compiled) return;
      const diff = diffConfigs(liveDecoded.value, dryRun.compiled);
      if (isConfigDiffEmpty(diff)) return;
      const missingProfiles = dryRun.issues.filter((i) => i.code === "config-decompiler.missing_profile").map((i) => i.target);
      out.push({ binding, bindingIndex, input, diff, expectedGeneration: snapshot.config.generation, missingProfiles });
    });
    return out;
  }, [session, bindings, getSnapshot, profilesByBinding]);

  useEffect(() => {
    let cancelled = false;
    for (const c of candidates) {
      if (profilesByBinding.has(c.binding.bindingId)) continue;
      listDeviceProfiles(c.binding.bindingId)
        ?.then((list) => !cancelled && setProfilesByBinding((prev) => new Map(prev).set(c.binding.bindingId, new Set(list.map((p) => p.profileId)))))
        .catch(() => undefined);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates.map((c) => c.binding.bindingId).join(",")]);

  const selectedCandidates = candidates.filter((c) => selected.has(c.binding.bindingId));
  const totalChanges = selectedCandidates.reduce((sum, c) => sum + c.diff.modules.added.length + c.diff.modules.removed.length + c.diff.modules.changed.length + c.diff.schedules.added.length + c.diff.schedules.removed.length + c.diff.schedules.changed.length + c.diff.rules.added.length + c.diff.rules.removed.length + c.diff.rules.changed.length + c.diff.blocks.added.length + c.diff.blocks.removed.length + c.diff.blocks.changed.length + c.diff.edges.added.length + c.diff.edges.removed.length, 0);
  const blockedCandidates = selectedCandidates.filter((c) => c.missingProfiles.length > 0);
  const canDeploy = selectedCandidates.length > 0 && blockedCandidates.length === 0 && ![...selected].some((id) => running.has(id));

  function toggle(bindingId: CoreBindingId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(bindingId)) next.delete(bindingId);
      else next.add(bindingId);
      return next;
    });
  }

  async function handleDeploy() {
    setRunning(new Set(selectedCandidates.map((c) => c.binding.bindingId)));
    await Promise.all(
      selectedCandidates.map(async (c) => {
        const depId = deploymentId(crypto.randomUUID());
        if (!depId.ok || !session) return;
        const result = await deployConfig(c.binding.bindingId, c.input, {
          expectedGeneration: c.expectedGeneration,
          sourceProjectHash: canonicalProjectHash(session.stack.current),
          target: c.binding.bindingId,
          deploymentId: depId.value,
          timestamp: new Date().toISOString(),
        });
        if (result) {
          setResults((prev) => new Map(prev).set(c.binding.bindingId, result));
          if (result.record) execute?.(appendDeploymentRecord(result.record));
        }
        setRunning((prev) => {
          const next = new Set(prev);
          next.delete(c.binding.bindingId);
          return next;
        });
      }),
    );
  }

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <h1 className="font-heading text-lg font-semibold text-ink">Deploy & Diff</h1>
        <span className="ml-auto flex items-center gap-1.5 rounded-slpill border border-border-strong px-3 py-1.5 font-body text-sm text-ink-muted">
          {copy.changesCores(totalChanges, selectedCandidates.length)}
        </span>
        <button type="button" disabled={!canDeploy} onClick={() => void handleDeploy()} className="rounded-slpill bg-brand-blue px-4 py-1.5 font-body-strong text-sm text-white hover:bg-brand-blue-dark disabled:cursor-not-allowed disabled:opacity-40">
          {copy.startDeploy}
        </button>
      </div>

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
                  style={{ border: selected.has(c.binding.bindingId) ? "2px solid var(--color-brand-blue)" : "1px solid var(--color-border-strong)", backgroundColor: selected.has(c.binding.bindingId) ? "color-mix(in srgb, var(--color-brand-blue) 8%, transparent)" : "transparent" }}
                >
                  {c.missingProfiles.length > 0 ? <PackageX size={12} className="text-warning" /> : <span className="h-2 w-2 rounded-full" style={{ backgroundColor: isRunning ? "var(--color-info)" : "var(--color-ink-faint)" }} />}
                  {c.binding.expectedDeviceId}
                  <span className="font-body text-xs text-ink-faint">
                    {copy.changes(c.diff.modules.added.length + c.diff.modules.removed.length + c.diff.modules.changed.length + c.diff.schedules.added.length + c.diff.rules.added.length + c.diff.blocks.added.length + c.diff.edges.added.length)}
                  </span>
                  {result && (result.outcome === DeploymentOutcomeKind.SUCCESS || result.outcome === DeploymentOutcomeKind.NO_OP ? <Check size={12} className="text-success" /> : <X size={12} className="text-error" />)}
                </button>
              );
            })}
          </div>

          {blockedCandidates.length > 0 && (
            <div className="flex items-start gap-2 border-l-4 border-warning p-3" style={{ backgroundColor: "color-mix(in srgb, var(--color-warning) 8%, transparent)" }}>
              <PackageX size={16} className="mt-0.5 shrink-0 text-warning" />
              <div>
                <p className="font-body text-sm text-ink">{copy.blocked(blockedCandidates.reduce((n, c) => n + c.missingProfiles.length, 0))}</p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {blockedCandidates.flatMap((c) => c.missingProfiles.map((p) => (
                    <li key={`${c.binding.bindingId}-${p}`} className="font-body text-xs text-ink-muted">
                      {c.binding.expectedDeviceId}: <span className="font-mono">{p}</span> —{" "}
                      <button type="button" onClick={() => navigate("device-profile-studio")} className="font-semibold text-brand-blue underline">
                        {copy.goToStudio}
                      </button>
                    </li>
                  )))}
                </ul>
              </div>
            </div>
          )}

          {selectedCandidates.map((c) => {
            const result = results.get(c.binding.bindingId) ?? null;
            const isRunning = running.has(c.binding.bindingId);
            return (
              <div key={c.binding.bindingId} className="flex flex-col gap-2 rounded-slmd border border-border p-3">
                <h2 className="font-body text-sm font-semibold text-ink">{c.binding.expectedDeviceId}</h2>
                {result?.outcome === DeploymentOutcomeKind.STALE_GENERATION && result.diff && result.liveConfig ? (
                  <ConflictPanel coreName={c.binding.expectedDeviceId} diff={result.diff} copy={copy} />
                ) : (
                  <ConfigDiffView diff={c.diff} />
                )}
                {(isRunning || result) && <PipelineStepper result={result} running={isRunning} />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConflictPanel({ coreName, diff, copy }: { readonly coreName: string; readonly diff: ConfigDiff; readonly copy: ReturnType<typeof deployDiffCopy> }) {
  return (
    <div className="rounded-slmd border-2 border-error p-4">
      <h3 className="font-heading text-base font-semibold text-ink">{copy.conflictOn(coreName)}</h3>
      <p className="mt-1 font-body text-sm text-ink-muted">{copy.conflictBody}</p>
      <div className="mt-3">
        <ConfigDiffView diff={diff} />
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" className="flex-1 rounded-slsm border border-border-strong px-3 py-2 font-body text-sm text-ink hover:bg-surface-raised">
          {copy.importLive}
        </button>
        <button type="button" disabled title="Non ancora implementato — il rebase/merge strutturato richiede il decompilatore collegato al progetto autore, non ancora cablato (gap dichiarato)" className="flex-1 rounded-slsm border border-border-strong px-3 py-2 font-body text-sm text-ink opacity-40">
          {copy.rebase}
        </button>
        <button type="button" className="flex-1 rounded-slsm border border-border-strong px-3 py-2 font-body text-sm text-ink-muted hover:bg-surface-raised">
          {copy.cancel}
        </button>
      </div>
    </div>
  );
}
