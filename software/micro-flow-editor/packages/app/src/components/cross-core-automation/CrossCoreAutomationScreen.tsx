import type { GraphState } from "@spaghettilab/domain";
import { useMemo, useState } from "react";
import { automationsCopy } from "../../lib/automations-copy.js";
import { useLocale } from "../../state/locale-context.js";
import { useSession } from "../../state/session-context.js";
import { DeployTab } from "./DeployTab.js";
import { DiagnosticsTab } from "./DiagnosticsTab.js";
import { GraphTab } from "./GraphTab.js";
import { NodeRedRuntimeBar } from "./NodeRedRuntimeBar.js";
import type { AppLink, LinkMeta } from "./link-meta.js";
import type { CrossCoreNodeData } from "./node-data.js";

const TAB_IDS = ["grafo", "deploy", "diagnostica"] as const;
type TabId = (typeof TAB_IDS)[number];

const EMPTY_GRAPH: GraphState<"system-automation"> = { layer: "system-automation", nodes: [], edges: [] };

/**
 * `ux/screens/S110-cross-core-automation/{visual,ui-behavior,backend-behavior}.md`,
 * cablato su `@spaghettilab/system-automation-graph` (S111), `@spaghettilab/node-red-nodes`
 * (S112) e `@spaghettilab/node-red-deploy` (S113) — tutti reali, contrariamente
 * alla nota "⬜ TODO" stantia del `backend-behavior.md` (scritto prima che il
 * backend fosse costruito). `linkMeta` (transformation/validatedFingerprints
 * per link, mai persistibile in `ProjectV1` — vedi `GraphTab.tsx`) è
 * sollevato qui e condiviso fra i tre tab.
 */
export function CrossCoreAutomationScreen() {
  const { locale } = useLocale();
  const copy = automationsCopy(locale);
  const { session } = useSession();
  const [tab, setTab] = useState<TabId>("grafo");
  const [linkMeta, setLinkMeta] = useState<Map<string, LinkMeta>>(new Map());

  const graphState: GraphState<"system-automation"> = session?.stack.current.systemAutomationGraph ?? EMPTY_GRAPH;
  const bindings = session?.stack.current.coreBindings ?? [];

  const links: readonly AppLink[] = useMemo(() => {
    const out: AppLink[] = [];
    for (const edge of graphState.edges) {
      const sourceNode = graphState.nodes.find((n) => n.id === edge.source);
      const targetNode = graphState.nodes.find((n) => n.id === edge.target);
      if (!sourceNode || !targetNode) continue;
      const meta = linkMeta.get(edge.id);
      out.push({ id: edge.id, source: sourceNode.data as CrossCoreNodeData, target: targetNode.data as CrossCoreNodeData, transformation: meta?.transformation, validatedFingerprints: meta?.validatedFingerprints ?? new Map() });
    }
    return out;
  }, [graphState, linkMeta]);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex min-h-14 shrink-0 flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-2">
        <h1 className="font-heading text-lg font-semibold text-ink">{copy.title}</h1>
        <NodeRedRuntimeBar />
        <span className="ml-auto flex items-center gap-1.5 rounded-slpill border border-border-strong px-3 py-1.5 font-body text-sm text-ink-muted">
          {copy.nodesLinks(graphState.nodes.length, graphState.edges.length)}
        </span>
      </div>

      <div className="flex shrink-0 gap-1 border-b border-border bg-surface px-4">
        {TAB_IDS.map((id) => {
          const t = {
            id,
            label: id === "grafo" ? copy.graph : id === "deploy" ? copy.deploy : copy.diagnostics,
          };
          const active = tab === t.id;
          return (
            <button key={t.id} type="button" onClick={() => setTab(t.id)} className="flex items-center gap-1.5 border-b-2 px-3 py-2.5 font-body text-sm" style={{ borderColor: active ? "var(--color-brand-blue)" : "transparent", color: active ? "var(--color-brand-blue)" : "var(--color-ink-muted)" }}>
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {tab === "grafo" && <GraphTab linkMeta={linkMeta} setLinkMeta={setLinkMeta} />}
        {tab === "deploy" && <DeployTab links={links} />}
        {tab === "diagnostica" && <DiagnosticsTab links={links} bindings={bindings} />}
      </div>
    </div>
  );
}
