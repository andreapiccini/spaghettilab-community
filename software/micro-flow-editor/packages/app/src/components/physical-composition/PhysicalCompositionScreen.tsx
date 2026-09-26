import { normalizeCatalogPages, normalizeProfilePages, normalizeTopologyPages, type CatalogIndex, type ProfileIndex, type TopologyIndex } from "@spaghettilab/catalog-model";
import { contentHash, createPhysicalCompositionGraph, deployableSnapshot, type CoreBindingRecord, type GraphNode, type GraphState } from "@spaghettilab/domain";
import { moduleFromAcceptedDiscovery, previewDiscoveryAccept, validateComposition, type DiscoveryAcceptChoice, type PhysicalCompositionNodeData } from "@spaghettilab/physical-composition-model";
import type { AcceptDiscoveryRequest, DiscoveryCandidate } from "@spaghettilab/protocol-sdk";
import { addGraphNodeCommand, nodeChangesToCommands, physicalGraphLens, removeGraphNodeCommand, toReactFlowEdges, updateGraphNodeCommand } from "@spaghettilab/react-flow-adapter";
import { applyNodeChanges, Background, Controls, ReactFlow, ReactFlowProvider, type Node, type NodeChange } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CircleAlert, Plug, Plus, Radar, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { declaredPortsOf, resizePinMap, summarizeConfiguredPort } from "../../lib/port-protocol-mock.js";
import { physicalCompositionCopy } from "../../lib/physical-composition-copy.js";
import { useLocale } from "../../state/locale-context.js";
import { usePortProtocol } from "../../state/port-protocol-context.js";
import { useSession } from "../../state/session-context.js";
import { CoreSelector } from "../catalog-topology/CoreSelector.js";
import { DiscoveryTray } from "./DiscoveryTray.js";
import { NodeInspector, type InspectorMode } from "./NodeInspector.js";
import { PortSetupTray } from "./PortSetupTray.js";
import type { PortSetupRequest } from "./port-setup-types.js";
import { isPortCardId, portCardId, portIdFromCardId, toConfiguredPortNode, type ConfiguredPortNodeData } from "./ConfiguredPortNode.js";
import { PHYSICAL_NODE_TYPES } from "./PhysicalNode.js";
import { toPhysicalNodes, type PhysicalNodeData } from "./to-nodes.js";

type CanvasNode = Node<PhysicalNodeData> | Node<ConfiguredPortNodeData>;

const EMPTY_GRAPH: GraphState<"physical-composition"> = { layer: "physical-composition", nodes: [], edges: [] };

/**
 * Nodes created via the toolbar have no drop coordinate to snap to —
 * cascading them by node count keeps each new node visible instead of
 * stacking every one at the same fixed point, which reads as a single
 * overlapping mess and makes it look like earlier nodes vanished.
 */
function nextSpawnPosition(existingNodeCount: number, perRow = 4, colStep = 260, rowStep = 80): { x: number; y: number } {
  const col = existingNodeCount % perRow;
  const row = Math.floor(existingNodeCount / perRow);
  return { x: 80 + col * colStep, y: 80 + row * rowStep };
}

/**
 * `ux/screens/S050-physical-composition/{visual,ui-behavior,backend-behavior}.md`.
 * The header's "hash compilato" isn't shown — that's the compiled Config's hash
 * (S072, not wired into any screen yet); instead the status bar shows `contentHash`
 * of the graph's own `deployableSnapshot` (`@spaghettilab/domain`), which is real
 * and already guarantees the spec's actual requirement — "cambiare label/posizione
 * non cambia [questo] hash" — without claiming to be a compiled artifact it isn't.
 */
export function PhysicalCompositionScreen() {
  return (
    <ReactFlowProvider>
      <PhysicalCompositionScreenInner />
    </ReactFlowProvider>
  );
}

function PhysicalCompositionScreenInner() {
  const { locale } = useLocale();
  const copy = physicalCompositionCopy(locale);
  const { session, execute, navigate } = useSession();
  const { rows, getSnapshot, getClient, listDeviceProfiles, listDiscoveryCandidates, acceptDiscovery } = useCoreSessions();
  const { configuredPorts, protocolFor, cardPositionOf, setCardPosition, rememberCapabilities, selectedBindingId, setSelectedBindingId } = usePortProtocol();
  const bindings = session?.stack.current.coreBindings ?? [];

  const selected: CoreBindingRecord | null = bindings.find((b) => b.bindingId === selectedBindingId) ?? bindings[0] ?? null;
  if (selected && selected.bindingId !== selectedBindingId) {
    setSelectedBindingId(selected.bindingId);
  }
  const bindingIndex = selected ? bindings.findIndex((b) => b.bindingId === selected.bindingId) : -1;
  const row = rows.find((r) => r.binding.bindingId === selected?.bindingId);
  const snapshot = selected ? getSnapshot(selected.bindingId) : undefined;

  const [inspector, setInspector] = useState<InspectorMode | null>(null);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [portSetup, setPortSetup] = useState<PortSetupRequest | null>(null);
  const [candidates, setCandidates] = useState<readonly DiscoveryCandidate[]>([]);
  const [acknowledged, setAcknowledged] = useState<ReadonlySet<string>>(new Set());
  const [profileIndex, setProfileIndex] = useState<ProfileIndex | null>(null);
  const [liveTopology, setLiveTopology] = useState<TopologyIndex | null>(null);
  const [topologyLoading, setTopologyLoading] = useState(false);

  const reloadTopology = useCallback(() => {
    if (!selected || row?.sessionState !== "READY") return;
    const client = getClient(selected.bindingId);
    if (!client) return;
    setTopologyLoading(true);
    client
      .getFullTopology(16)
      .then((flows) => setLiveTopology(normalizeTopologyPages([{ flows, nextCursor: 0 }], true)))
      .catch(() => setLiveTopology(null))
      .finally(() => setTopologyLoading(false));
  }, [selected, row?.sessionState, getClient]);

  useEffect(() => {
    if (!selected || row?.sessionState !== "READY") return;
    let cancelled = false;
    listDiscoveryCandidates(selected.bindingId)
      ?.then((list) => !cancelled && setCandidates(list))
      .catch(() => !cancelled && setCandidates([]));
    listDeviceProfiles(selected.bindingId)
      ?.then((list) => !cancelled && setProfileIndex(normalizeProfilePages([{ profiles: list, nextCursor: 0 }], true)))
      .catch(() => !cancelled && setProfileIndex(null));
    setTopologyLoading(true);
    getClient(selected.bindingId)
      ?.getFullTopology(16)
      .then((flows) => !cancelled && setLiveTopology(normalizeTopologyPages([{ flows, nextCursor: 0 }], true)))
      .catch(() => !cancelled && setLiveTopology(null))
      .finally(() => {
        if (!cancelled) setTopologyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, row?.sessionState, listDiscoveryCandidates, listDeviceProfiles, getClient]);

  // Gated at read time instead of reset synchronously in the effect above (would
  // trip `react-hooks/set-state-in-effect`) — switching to a Core that isn't READY
  // hides the previous Core's candidates/profiles without an extra render.
  const visibleCandidates = row?.sessionState === "READY" ? candidates : [];
  const visibleProfileIndex = row?.sessionState === "READY" ? profileIndex : null;

  const catalogIndex: CatalogIndex | null = useMemo(() => (snapshot?.catalog ? normalizeCatalogPages([snapshot.catalog], true) : null), [snapshot]);
  const snapshotTopology: TopologyIndex | null = useMemo(() => (snapshot?.topology ? normalizeTopologyPages([snapshot.topology], true) : null), [snapshot]);
  const topologyIndex = (liveTopology?.flows.length ?? 0) >= (snapshotTopology?.flows.length ?? 0) ? liveTopology ?? snapshotTopology : snapshotTopology;
  const declaredPorts = useMemo(() => declaredPortsOf(topologyIndex), [topologyIndex]);
  useEffect(() => {
    for (const port of declaredPorts) {
      if (port.capabilities !== undefined) rememberCapabilities(port.portId, port.capabilities);
    }
  }, [declaredPorts, rememberCapabilities]);
  const canvasPorts = useMemo(
    () =>
      configuredPorts.map((saved) => {
        const meta = declaredPorts.find((d) => d.portId === saved.portId) ?? { portId: saved.portId, signalCount: saved.pins.length || 5, fromCore: false };
        const map = resizePinMap({ portId: saved.portId, pins: saved.pins }, meta.signalCount);
        return summarizeConfiguredPort(saved.portId, map, protocolFor({ portId: saved.portId }), meta);
      }),
    [configuredPorts, declaredPorts, protocolFor],
  );

  const graphState: GraphState<"physical-composition"> = (bindingIndex >= 0 ? session?.stack.current.physicalGraphs[bindingIndex] : undefined) ?? EMPTY_GRAPH;
  const domainNodes = graphState.nodes as readonly GraphNode<"physical-composition", string, PhysicalCompositionNodeData>[];
  const projectAuthoringMetadata = session?.stack.current.authoringMetadata;
  const authoringMetadata = useMemo(() => projectAuthoringMetadata ?? {}, [projectAuthoringMetadata]);

  const validation = useMemo(() => (topologyIndex ? validateComposition(domainNodes, topologyIndex, { acknowledgedModuleNodeIds: acknowledged }) : null), [domainNodes, topologyIndex, acknowledged]);
  const errorsByNode = useMemo(() => {
    const map = new Map<string, string>();
    if (validation && !validation.ok) for (const e of validation.error) map.set(e.target, e.remediation);
    return map;
  }, [validation]);
  const collisionCount = validation && !validation.ok ? validation.error.filter((e) => e.code === "physical-composition.endpoint_collision" || e.code === "physical-composition.module_key_conflict").length : 0;

  const domainRfNodes = useMemo(() => toPhysicalNodes(graphState, authoringMetadata, new Set(errorsByNode.keys()), locale), [graphState, authoringMetadata, errorsByNode, locale]);
  const edges = useMemo(() => toReactFlowEdges(graphState), [graphState]);

  // Local mirror for smooth dragging — `applyNodeChanges` gives immediate visual
  // feedback on every mouse-move; the domain (source of truth) is only updated
  // once per gesture (see `onNodesChange` below), not once per pixel. Resynced
  // during render (React's documented "adjusting state when a prop changes"
  // pattern: https://react.dev/learn/you-might-not-need-an-effect) rather than in
  // a `useEffect`, so switching Core/undo/redo doesn't need an extra render pass.
  const [localNodes, setLocalNodes] = useState<Node<PhysicalNodeData>[]>(domainRfNodes);
  const [syncedFrom, setSyncedFrom] = useState(domainRfNodes);
  if (domainRfNodes !== syncedFrom) {
    setSyncedFrom(domainRfNodes);
    setLocalNodes(domainRfNodes);
  }

  const [portLocalNodes, setPortLocalNodes] = useState<Node<ConfiguredPortNodeData>[]>([]);
  const portSyncKey = canvasPorts.map((p) => `${p.portId}:${p.protocolName ?? ""}:${p.dialect ?? ""}:${p.fromCore ? "c" : "m"}:${p.pins.length}:${p.fields.map((f) => `${f.id}:${f.label}:${f.spec.kind}`).join(",")}:${p.pins.map((pin) => `${pin.peripheral}${pin.signal}${pin.label}`).join("|")}`).join(";");
  // `null` until the first paint so leaving the screen and coming back
  // rebuilds the Core's port cards. Initializing from `portSyncKey` skipped
  // that rebuild (key already matched) and left an empty canvas.
  const [syncedPortKey, setSyncedPortKey] = useState<string | null>(null);
  if (portSyncKey !== syncedPortKey) {
    setSyncedPortKey(portSyncKey);
    setPortLocalNodes((prev) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      return canvasPorts.map((summary, i) => {
        const existing = byId.get(portCardId(summary.portId));
        const stored = cardPositionOf(summary.portId);
        const seed = existing ?? (stored ? { position: stored } : undefined);
        return toConfiguredPortNode(summary, i, seed, (portId, pinIndex) => {
          setInspector(null);
          setPortSetup({ kind: "pin", portId, pinIndex });
        });
      });
    });
  }

  const displayNodes: CanvasNode[] = useMemo(() => [...localNodes, ...portLocalNodes], [localNodes, portLocalNodes]);

  const contentDigest = useMemo(() => {
    const g = createPhysicalCompositionGraph<string, string, unknown>();
    for (const n of graphState.nodes) g.addNode(n);
    for (const e of graphState.edges) g.addEdge(e);
    return contentHash(deployableSnapshot(g)).slice(0, 8);
  }, [graphState]);

  useEffect(() => {
    if (!session || bindingIndex < 0 || !execute) return;
    if (session.stack.current.physicalGraphs.length > bindingIndex) return;
    // Pre-existing data created before `addCoreBinding` was fixed (this task) to keep
    // `physicalGraphs`/`deviceGraphs` index-aligned with `coreBindings` — repaired
    // lazily here rather than crashing `physicalGraphLens`.
    execute({
      kind: "RepairPhysicalGraphAlignment",
      apply: (project) => {
        const physicalGraphs = [...project.physicalGraphs];
        const deviceGraphs = [...project.deviceGraphs];
        while (physicalGraphs.length <= bindingIndex) physicalGraphs.push({ layer: "physical-composition", nodes: [], edges: [] });
        while (deviceGraphs.length <= bindingIndex) deviceGraphs.push({ layer: "device-processing", nodes: [], edges: [] });
        return { ok: true, value: { ...project, physicalGraphs, deviceGraphs } };
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindingIndex, session?.stack.current.physicalGraphs.length]);

  function onNodesChange(changes: NodeChange<CanvasNode>[]) {
    const domainChanges = changes.filter((c) => !("id" in c) || !isPortCardId(c.id));
    const portChanges = changes.filter((c): c is NodeChange<CanvasNode> & { id: string } => "id" in c && isPortCardId(c.id));
    if (domainChanges.length > 0) setLocalNodes((nds) => applyNodeChanges(domainChanges as NodeChange<Node<PhysicalNodeData>>[], nds));
    if (portChanges.length > 0) {
      const next = applyNodeChanges(portChanges as NodeChange<Node<ConfiguredPortNodeData>>[], portLocalNodes);
      setPortLocalNodes(next);
      for (const change of portChanges) {
        if (change.type === "position" && change.dragging === false && change.position) {
          setCardPosition(portIdFromCardId(change.id), change.position);
        }
      }
    }
    if (!execute || bindingIndex < 0) return;
    const committable = domainChanges.filter((c) => !(c.type === "position" && c.dragging === true));
    const commands = nodeChangesToCommands(committable, physicalGraphLens(bindingIndex));
    for (const command of commands) execute(command);
  }

  function onNodeClick(_: unknown, node: CanvasNode) {
    if (node.type === "configured-port") {
      setInspector(null);
      setPortSetup({ kind: "pin", portId: (node.data as ConfiguredPortNodeData).portId });
      return;
    }
    const domainNode = domainNodes.find((n) => n.id === node.id);
    const meta = authoringMetadata[node.id];
    if (domainNode) setInspector({ kind: "edit", nodeId: node.id, data: domainNode.data, comment: meta?.comment ?? "" });
  }

  function setComment(nodeId: string, comment: string) {
    execute?.({
      kind: "UpdateAuthoringMetadata",
      apply: (project) => ({ ok: true, value: { ...project, authoringMetadata: { ...project.authoringMetadata, [nodeId]: { ...project.authoringMetadata[nodeId], comment } } } }),
    });
  }

  function handleSave(data: PhysicalCompositionNodeData, comment: string) {
    if (!execute || bindingIndex < 0) return;
    const lens = physicalGraphLens(bindingIndex);
    if (inspector?.kind === "edit") {
      execute(updateGraphNodeCommand(lens, { layer: "physical-composition", id: inspector.nodeId, data }));
      setComment(inspector.nodeId, comment);
    } else if (inspector) {
      const id = `pc-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      execute(addGraphNodeCommand(lens, { layer: "physical-composition", id, data }));
      execute({
        kind: "UpdateAuthoringMetadata",
        apply: (project) => ({ ok: true, value: { ...project, authoringMetadata: { ...project.authoringMetadata, [id]: { comment, position: nextSpawnPosition(domainNodes.length) } } } }),
      });
    }
    setInspector(null);
  }

  function handleDelete() {
    if (!execute || bindingIndex < 0 || inspector?.kind !== "edit") return;
    execute(removeGraphNodeCommand(physicalGraphLens(bindingIndex), inspector.nodeId));
    setInspector(null);
  }

  async function handleAcceptDiscovery(candidate: DiscoveryCandidate, choice: DiscoveryAcceptChoice) {
    if (!selected || bindingIndex < 0 || !execute) return;
    const req: AcceptDiscoveryRequest = { candidateId: candidate.id, key: choice.key, generation: candidate.generation };
    const response = await acceptDiscovery(selected.bindingId, req);
    if (!response) return;
    const preview = previewDiscoveryAccept(candidate, choice);
    const moduleData = moduleFromAcceptedDiscovery(preview, response.moduleKey);
    const id = `pc-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    execute(addGraphNodeCommand(physicalGraphLens(bindingIndex), { layer: "physical-composition", id, data: moduleData }));
    setCandidates((prev) => prev.filter((c) => c.id !== candidate.id));
  }

  const noPorts = configuredPorts.length === 0;
  const subtitle = !selected
    ? copy.noCoreShort
    : `${copy.portsRead(declaredPorts.length)}${configuredPorts.length > 0 ? ` · ${copy.onCanvas(configuredPorts.length)}` : ""} · ${copy.conflicts(collisionCount)}`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 overflow-hidden border-b border-border bg-surface px-4">
        <div className="shrink-0">
          <CoreSelector bindings={bindings} selected={selected} onSelect={(b) => setSelectedBindingId(b.bindingId)} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-heading text-[28px] font-bold leading-none text-ink">{copy.title}</h1>
          <p className="font-body text-xs text-ink-muted">{subtitle}</p>
        </div>
        {selected && (
          <button
            type="button"
            onClick={() => setPortSetup({ kind: "pick" })}
            className="flex shrink-0 items-center gap-1.5 rounded-slpill bg-brand-blue px-4 py-2 font-body-strong text-sm text-white hover:bg-brand-blue-dark"
          >
            <Plus size={16} />
            {copy.addPort}
          </button>
        )}
        {visibleCandidates.length > 0 && (
          <button type="button" onClick={() => setDiscoveryOpen(true)} className="flex shrink-0 items-center gap-1.5 rounded-slpill border border-border-strong px-3 py-1.5 font-body text-sm text-ink">
            <Radar size={14} />
            {copy.candidates(visibleCandidates.length)}
          </button>
        )}
        {collisionCount > 0 && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-slpill px-3 py-1.5 font-body text-sm text-error" style={{ backgroundColor: "color-mix(in srgb, var(--color-error) 10%, transparent)" }}>
            <CircleAlert size={14} />
            {copy.addressConflicts(collisionCount)}
          </span>
        )}
        {selected && !noPorts && (
          <button type="button" onClick={() => navigate("deploy-diff")} className="shrink-0 rounded-slpill bg-brand-blue px-4 py-1.5 font-body-strong text-sm text-white hover:bg-brand-blue-dark">
            {copy.sendToDeploy}
          </button>
        )}
      </div>

      {!selected ? (
        <EmptyHero icon={Plug} title={copy.noCoreTitle} body={copy.noCoreBody} actionLabel={copy.goCoreConnections} onAction={() => navigate("core-connections")} />
      ) : (
        <div className="relative flex flex-1 overflow-hidden">
          {noPorts ? (
            <EmptyHero
              icon={Plug}
              title={copy.noPortTitle}
              body={declaredPorts.length > 0 ? copy.noPortBody : copy.noTopologyBody}
              actionLabel={copy.addAPort}
              onAction={() => setPortSetup({ kind: "pick" })}
            />
          ) : (
            <div className="relative flex-1">
            <ReactFlow nodeTypes={PHYSICAL_NODE_TYPES} nodes={displayNodes} edges={edges} onNodesChange={onNodesChange} onNodeClick={onNodeClick} fitView>
              <Background gap={20} color="#E1E4EB" />
              <Controls position="bottom-left" />
            </ReactFlow>

            <div className="absolute bottom-0 left-0 right-0 flex h-10 items-center gap-2 border-t border-border bg-surface px-4">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: collisionCount > 0 ? "var(--color-error)" : "var(--color-success)" }} />
              <span className="font-body text-xs text-ink-muted">{subtitle}</span>
              <span className="ml-auto font-mono text-xs text-ink-faint">content: {contentDigest}</span>
            </div>
            </div>
          )}

          {inspector && (
            <NodeInspector
              key={inspector.kind === "edit" ? inspector.nodeId : `create-${inspector.nodeKind}`}
              mode={inspector}
              topology={topologyIndex}
              catalog={catalogIndex}
              profiles={visibleProfileIndex}
              existingNodes={domainNodes}
              acknowledgedModuleNodeIds={acknowledged}
              onSave={handleSave}
              onDelete={inspector.kind === "edit" ? handleDelete : undefined}
              onAcknowledge={() => {
                const id = inspector.kind === "edit" ? inspector.nodeId : "__draft__";
                setAcknowledged((prev) => {
                  const next = new Set(prev);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                });
              }}
              onClose={() => setInspector(null)}
              discoveryCandidates={visibleCandidates}
              onOpenDiscovery={() => setDiscoveryOpen(true)}
              onConfigurePort={(portId) => setPortSetup({ kind: "pin", portId, moduleNodeId: inspector.kind === "edit" ? inspector.nodeId : undefined })}
            />
          )}

          <DiscoveryTray
            open={discoveryOpen}
            candidates={visibleCandidates}
            topology={topologyIndex}
            existingNodes={domainNodes}
            onAccept={(c, choice) => void handleAcceptDiscovery(c, choice)}
            onReject={(id) => setCandidates((prev) => prev.filter((c) => c.id !== id))}
            onClose={() => setDiscoveryOpen(false)}
            onConfigureManually={(portId) => {
              setDiscoveryOpen(false);
              setPortSetup(portId !== undefined && portId >= 0 ? { kind: "pin", portId } : { kind: "pick" });
            }}
          />

          <PortSetupTray
            key={portSetup ? `${portSetup.kind}-${portSetup.kind === "pick" ? "add" : `${portSetup.portId}-${portSetup.kind === "pin" ? portSetup.pinIndex ?? "any" : "proto"}`}` : "closed"}
            open={portSetup !== null}
            request={portSetup}
            topology={topologyIndex}
            extraPortIds={[]}
            placedPortIds={configuredPorts.map((p) => p.portId)}
            topologyLoading={topologyLoading}
            onReloadTopology={reloadTopology}
            onClose={() => setPortSetup(null)}
          />
        </div>
      )}
    </div>
  );
}

function EmptyHero({
  icon: Icon,
  title,
  body,
  actionLabel,
  onAction,
}: {
  readonly icon: LucideIcon;
  readonly title: string;
  readonly body: string;
  readonly actionLabel: string;
  readonly onAction: () => void;
}) {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center gap-3 overflow-hidden">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(circle at 30% 30%, color-mix(in srgb, var(--color-brand-cyan-glow) 10%, transparent), transparent 60%), radial-gradient(circle at 70% 70%, color-mix(in srgb, var(--color-brand-purple-glow) 10%, transparent), transparent 60%)",
        }}
      />
      <Icon size={48} className="relative text-ink-faint" />
      <h2 className="relative font-heading text-lg font-semibold text-ink">{title}</h2>
      <p className="relative max-w-md text-center font-body text-sm text-ink-muted">{body}</p>
      <button type="button" onClick={onAction} className="relative mt-2 rounded-slpill bg-brand-blue px-4 py-2 font-body-strong text-sm text-white hover:bg-brand-blue-dark">
        {actionLabel}
      </button>
    </div>
  );
}
