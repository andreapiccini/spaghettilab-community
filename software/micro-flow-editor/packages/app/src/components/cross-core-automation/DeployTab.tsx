import { contentHash } from "@spaghettilab/domain";
import {
  classifyNodeRedSync,
  compileSystemAutomationFlow,
  deployNodeRedFlow,
  NodeRedAdminApiClient,
  reconcileFlows,
  type DeployResult,
  type NodeRedFlowNode,
} from "@spaghettilab/node-red-deploy";
import { Rocket, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { automationsCopy } from "../../lib/automations-copy.js";
import { useLocale } from "../../state/locale-context.js";
import { useSession } from "../../state/session-context.js";
import { useNodeRedRuntime } from "../../state/node-red-runtime-context.js";
import type { AppLink } from "./link-meta.js";
import type { CrossCoreNodeData } from "./node-data.js";

type DiffRow = { readonly id: string; readonly change: "added" | "removed" | "modified" };

/**
 * `ux/screens/S110-cross-core-automation/visual.md` § Tab Deploy Node-RED,
 * cablato su `@spaghettilab/node-red-deploy` (S113, reale) — `deployNodeRedFlow()`
 * fa una vera chiamata HTTP verso l'Admin API di un'istanza Node-RED reale
 * (`NodeRedAdminApiClient`, `fetch`-based), non un calcolo locale come
 * `ota-preflight`. Gap dichiarato: nessun campo `ProjectV1` persiste
 * l'ultimo hash di flow deployato (a differenza di `deploymentRecords` per
 * il Config Core) — `lastDeployedFlowHash` passa sempre `null`, quindi
 * `classifyNodeRedSync` non può mai distinguere "mai deployato" da "questo
 * progetto non ricorda l'ultimo deploy" nella sessione corrente. Nessun
 * tipo di "diff" dedicato esiste nel pacchetto (`reconcileFlows` calcola
 * solo la riconciliazione, non un oggetto diff) — la tabella qui è
 * ricostruita a livello app confrontando gli id dei nodi posseduti prima/dopo.
 */
export function DeployTab({ links }: { readonly links: readonly AppLink[] }) {
  const { locale } = useLocale();
  const copy = automationsCopy(locale);
  const { session } = useSession();
  const { target, token, reachability } = useNodeRedRuntime();
  const [diff, setDiff] = useState<readonly DiffRow[] | null>(null);
  const [liveRev, setLiveRev] = useState<string | null>(null);
  const [merged, setMerged] = useState<readonly NodeRedFlowNode[] | null>(null);
  const [result, setResult] = useState<DeployResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const project = session?.stack.current;
  const bindings = project?.coreBindings ?? [];
  const connectionProfileByCoreBinding = new Map(bindings.map((b) => [b.bindingId, b.connectionProfileId]));

  const compiled = project ? compileSystemAutomationFlow(links, project.projectId, connectionProfileByCoreBinding) : null;
  const hostFunctionCount = project?.systemAutomationGraph.nodes.filter((n) => (n.data as CrossCoreNodeData).kind === "nodered").length ?? 0;

  async function handlePreviewDiff() {
    if (!project || !compiled) return;
    setError(null);
    setLoading(true);
    try {
      const adminApi = new NodeRedAdminApiClient({ baseUrl: target.baseUrl, token: token || undefined });
      const live = await adminApi.getFlows();
      const mergedNodes = reconcileFlows(live.nodes, compiled.nodes, project.projectId);
      setMerged(mergedNodes);
      setLiveRev(live.rev);

      const ownedBefore = new Set(live.nodes.filter((n) => n.spaghettiOwned && n.spaghettiProjectId === project.projectId).map((n) => n.id));
      const ownedAfter = new Map(compiled.nodes.map((n) => [n.id, n]));
      const rows: DiffRow[] = [];
      for (const id of ownedAfter.keys()) if (!ownedBefore.has(id)) rows.push({ id, change: "added" });
      for (const id of ownedBefore) if (!ownedAfter.has(id)) rows.push({ id, change: "removed" });
      for (const id of ownedAfter.keys()) {
        if (!ownedBefore.has(id)) continue;
        const liveNode = live.nodes.find((n) => n.id === id);
        if (liveNode && JSON.stringify(liveNode) !== JSON.stringify(ownedAfter.get(id))) rows.push({ id, change: "modified" });
      }
      setDiff(rows);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  async function handleDeploy() {
    if (!project || !compiled) return;
    setLoading(true);
    try {
      const adminApi = new NodeRedAdminApiClient({ baseUrl: target.baseUrl, token: token || undefined });
      const outcome = await deployNodeRedFlow(adminApi, project.projectId, compiled.nodes);
      setResult(outcome);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  const sync = compiled && merged ? classifyNodeRedSync({ lastDeployedFlowHash: null, currentCompiledFlowHash: contentHash(compiled.nodes), liveOwnedFlowHash: contentHash(merged.filter((n) => n.spaghettiOwned)) }) : null;

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-6">
      <div className="flex items-start gap-2 border-l-4 border-info p-3" style={{ backgroundColor: "color-mix(in srgb, var(--color-info) 8%, transparent)" }}>
        <ShieldCheck size={16} className="mt-0.5 shrink-0 text-info" />
        <p className="font-body text-sm text-ink">
          Questo deploy tocca solo i nodi/flow di questo progetto ({compiled?.nodes.length ?? 0} nodi) — flow Node-RED estranei restano intatti (tag `spaghettiOwned`+`spaghettiProjectId`, mai un match per nome/posizione).
        </p>
      </div>

      {hostFunctionCount > 0 && (
        <p className="font-body text-sm text-ink-muted">
          {hostFunctionCount} funzioni host sul grafo (HTTP/socket/cron). Il compilatore attuale deploya i link record→comando fra Core; quelle funzioni restano nell&apos;editor finché il mapping Node-RED nativo non è cablato.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-2 rounded-slmd border border-border p-3">
        <p className="w-full font-mono text-xs text-ink-muted">
          Destinazione: {target.baseUrl}
          {reachability === "reachable" ? " · raggiungibile" : reachability === "unreachable" ? " · non raggiungibile (CORS o server spento)" : ""}
        </p>
        <button type="button" disabled={loading} onClick={() => void handlePreviewDiff()} className="rounded-slpill border border-border-strong px-3 py-1.5 font-body-strong text-xs text-ink hover:bg-surface-raised disabled:opacity-40">
          Calcola diff
        </button>
        <button type="button" disabled={loading || !diff} onClick={() => void handleDeploy()} className="flex items-center gap-1.5 rounded-slpill bg-brand-blue px-4 py-1.5 font-body-strong text-sm text-white hover:bg-brand-blue-dark disabled:opacity-40">
          <Rocket size={14} />
          Invia a Deploy
        </button>
        {sync && (
          <span className="rounded-slpill px-2 py-0.5 font-body text-xs" style={{ backgroundColor: sync === "IN_SYNC" ? "color-mix(in srgb, var(--color-success) 12%, transparent)" : "color-mix(in srgb, var(--color-warning) 12%, transparent)", color: sync === "IN_SYNC" ? "var(--color-success)" : "var(--color-warning)" }}>
            {sync}
          </span>
        )}
      </div>

      {error && <p className="font-body text-sm text-error">{error}</p>}

      {diff && (
        <div>
          <h2 className="font-heading text-sm font-semibold text-ink">Diff ({diff.length})</h2>
          <div className="mt-2 flex flex-col gap-1">
            {diff.length === 0 ? (
              <p className="font-body text-sm text-ink-faint">{copy.noChanges}</p>
            ) : (
              diff.map((row) => (
                <div
                  key={row.id}
                  className="flex items-center gap-2 rounded-slsm border-l-3 p-2 font-mono text-xs"
                  style={{ borderLeftColor: row.change === "added" ? "var(--color-success)" : row.change === "removed" ? "var(--color-error)" : "var(--color-warning)", backgroundColor: "var(--color-surface-sunken)" }}
                >
                  <span className="text-ink-faint">{row.change}</span>
                  <span className="text-ink">{row.id}</span>
                  <span className="ml-auto text-ink-faint">owner: {session?.stack.current.name}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {liveRev && <p className="font-mono text-xs text-ink-faint">live rev: {liveRev}</p>}

      {result && (
        <div className="flex items-center gap-2 rounded-slmd border-2 p-3" style={{ borderColor: result.kind === "SUCCESS" ? "var(--color-success)" : "var(--color-error)" }}>
          <p className="font-body-strong text-sm text-ink">{result.kind}</p>
          {result.issue && <p className="font-body text-xs text-ink-muted">{result.issue.remediation}</p>}
        </div>
      )}
    </div>
  );
}
