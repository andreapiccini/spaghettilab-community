import { encodeConfigCbor, sha256 } from "@spaghettilab/config-compiler";
import { dryRunConfig, type DryRunResult } from "@spaghettilab/config-decompiler";
import type { DeviceProcessingNodeData } from "@spaghettilab/device-processing-graph-model";
import type { CoreBindingRecord, GraphNode, GraphState } from "@spaghettilab/domain";
import { isModuleNodeData, type PhysicalCompositionNodeData } from "@spaghettilab/physical-composition-model";
import { findCatalogEntryById, isBayEntry, shippedTypeIds, type ProcessingCatalogEntry } from "@spaghettilab/processing-block-catalog";
import { addGraphEdgeCommand, addGraphNodeCommand, deviceGraphLens, edgeChangesToCommands, nodeChangesToCommands, removeGraphEdgeCommand, removeGraphNodeCommand, toReactFlowEdges, updateGraphNodeCommand } from "@spaghettilab/react-flow-adapter";
import { applyEdgeChanges, applyNodeChanges, Background, Controls, MiniMap, Position, ReactFlow, ReactFlowProvider, type Connection, type Edge, type EdgeChange, type Node, type NodeChange, type ReactFlowInstance } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CircleAlert, PlayCircle, Square, Workflow } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { labelForNumericSignal } from "../../lib/port-protocol-mock.js";
import { usePortProtocol } from "../../state/port-protocol-context.js";
import { useSession } from "../../state/session-context.js";
import { portCardId } from "../physical-composition/ConfiguredPortNode.js";
import { DEFAULT_ENERGY, DISABLED_MQTT } from "../../lib/default-config-policy.js";
import { localizeCatalogEntry, localizedBaySideLabel } from "../../lib/processing-catalog-copy.js";
import { processingGraphCopy } from "../../lib/processing-graph-copy.js";
import { isDemoOnlyEnabled } from "../../lib/demo-only.js";
import { VisitorDemoTour } from "./VisitorDemoTour.js";
import { useLocale } from "../../state/locale-context.js";
import { CoreSelector } from "../catalog-topology/CoreSelector.js";
import {
  PROCESSING_BLOCK_MIME,
  decodePaletteDrag,
  nextSpawnPosition,
  nodeDataFromCatalogEntry,
  peekPaletteDragBaySide,
  peekPaletteDragKind,
  snapToGrid,
} from "./catalog-to-node.js";
import { catalogEntryForNode } from "./catalog-entry-for-node.js";
import { positionForBayDrop } from "./bay-layout.js";
import { isValidProcessingConnection } from "./connection-rules.js";
import { PROCESSING_EDGE_TYPES } from "./DeletableEdge.js";
import { NodeInspector, type ProcessingInspectorMode } from "./NodeInspector.js";
import { EVENT_CONTAINER_NODE_TYPES, type EventContainerNodeData } from "./EventContainerNode.js";
import {
  canBeNested,
  collectDescendantMemberIds,
  computeEventContainers,
  containerContainsTrigger,
  containerOriginToTrigger,
  detachMemberEdges,
  emptyEventContainerSize,
  isNestableContainer,
  memberEscapesContainer,
  overlappingPeerContainer,
  peerContainerObstacles,
  planMembershipDrop,
  triggerToContainerOrigin,
  type EventContainer,
} from "./event-containers.js";
import { activeActuatorsAt, activeTriggersAt, buildDryRunPreviewChannels, isFlowStartBlock, ledIntensitiesAt, previewParticipantIds, rgbVisualsAt, type DryRunPreviewChannel } from "./dry-run-preview.js";
import { NODE_HEIGHT, NODE_PADDING, NODE_WIDTH, ENTRY_FEED_INSET, EVENT_CONTAINER_HEADER_HEIGHT, FLOW_START_SIZE, fixedTickAbsolute, fixedTickRelativePosition } from "./layout-constants.js";
import { PROCESSING_NODE_KIND_CONFIG } from "./node-kinds.js";
import { containerAtPosition, resolveRectOverlap, resolveSiblingOverlap, type SizedRect } from "./node-overlap.js";
import { ProcessingBlockPalette } from "./ProcessingBlockPalette.js";
import { PROCESSING_NODE_TYPES } from "./ProcessingNode.js";
import { toProcessingNodes, type ProcessingNodeUiData } from "./to-nodes.js";

/** The member with no outgoing edge to another non-trigger member — where a chained-in block attaches next. Nested event-sources have their own chain. */
function chainTailId(container: EventContainer, edges: GraphState<"device-processing">["edges"], triggerIds: ReadonlySet<string>): string {
  const members = container.memberIds.filter((id) => !triggerIds.has(id));
  for (const id of members) {
    const hasDownstreamMember = edges.some((e) => e.source === id && members.includes(e.target));
    if (!hasDownstreamMember) return id;
  }
  return container.triggerId;
}

function layoutSizeForUiNode(node: Node<ProcessingNodeUiData>): { w: number; h: number } {
  if (node.data.circular) return { w: FLOW_START_SIZE, h: FLOW_START_SIZE };
  return { w: node.data.cardWidth ?? NODE_WIDTH, h: node.data.cardHeight ?? NODE_HEIGHT };
}

const NODE_TYPES = { ...PROCESSING_NODE_TYPES, ...EVENT_CONTAINER_NODE_TYPES };

const EMPTY_GRAPH: GraphState<"device-processing"> = { layer: "device-processing", nodes: [], edges: [] };
const EMPTY_PHYSICAL_GRAPH: GraphState<"physical-composition"> = { layer: "physical-composition", nodes: [], edges: [] };
const SHIPPED_TYPE_IDS = shippedTypeIds();

/**
 * `ux/screens/S070-processing-graph-editor/{visual,ui-behavior,backend-behavior}.md`
 * layout (260px palette, search, categorie) with the real functional catalog
 * (`@spaghettilab/processing-block-catalog`, S074) instead of the prototype's 11
 * fake blocks. Node kinds stay the four firmware-backed ones. Dry-run is local via
 * `@spaghettilab/config-compiler`/`config-decompiler` (S072/S073).
 */
export function ProcessingGraphScreen() {
  return (
    <ReactFlowProvider>
      <ProcessingGraphScreenInner />
    </ReactFlowProvider>
  );
}

function ProcessingGraphScreenInner() {
  const { session, execute, navigate } = useSession();
  const { locale } = useLocale();
  const copy = processingGraphCopy(locale);
  const demoOnly = isDemoOnlyEnabled();
  const demoAutoStarted = useRef(false);
  const demoInspectorSeeded = useRef(false);
  const { configuredPorts, pinMapOf, protocolFor, selectedBindingId, setSelectedBindingId } = usePortProtocol();
  const bindings = session?.stack.current.coreBindings ?? [];

  const selected: CoreBindingRecord | null = bindings.find((b) => b.bindingId === selectedBindingId) ?? bindings[0] ?? null;
  const bindingIndex = selected ? bindings.findIndex((b) => b.bindingId === selected.bindingId) : -1;

  const [inspector, setInspector] = useState<ProcessingInspectorMode | null>(null);
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [previewActiveIds, setPreviewActiveIds] = useState<ReadonlySet<string>>(() => new Set());
  const [previewElapsedMs, setPreviewElapsedMs] = useState(0);
  const [previewLedIntensity, setPreviewLedIntensity] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [previewRgbVisual, setPreviewRgbVisual] = useState<ReadonlyMap<string, { readonly color: string; readonly intensity: number }>>(() => new Map());
  const [previewTriggerIds, setPreviewTriggerIds] = useState<ReadonlySet<string>>(() => new Set());
  const [previewActuatorIds, setPreviewActuatorIds] = useState<ReadonlySet<string>>(() => new Set());
  const [hashHex, setHashHex] = useState<string | null>(null);
  const [rf, setRf] = useState<ReactFlowInstance<Node<ProcessingNodeUiData>> | null>(null);
  const [dropPreview, setDropPreview] = useState<{ x: number; y: number } | null>(null);
  const [overlapWarning, setOverlapWarning] = useState<string | null>(null);
  const [containerHint, setContainerHint] = useState<{
    readonly triggerId: string;
    readonly kind: "rejecting" | "accepting";
    readonly previewPosition?: { readonly x: number; readonly y: number };
    readonly previewWidth?: number;
    readonly previewHeight?: number;
  } | null>(null);
  const previewChannelsRef = useRef<readonly DryRunPreviewChannel[]>([]);
  const previewStartedAtRef = useRef(0);

  useEffect(() => {
    if (!overlapWarning) return;
    const timer = setTimeout(() => setOverlapWarning(null), 4000);
    return () => clearTimeout(timer);
  }, [overlapWarning]);

  const stopPreview = useCallback(() => {
    setSimulating(false);
    previewChannelsRef.current = [];
    setPreviewActiveIds(new Set());
    setPreviewTriggerIds(new Set());
    setPreviewActuatorIds(new Set());
    setPreviewLedIntensity(new Map());
    setPreviewRgbVisual(new Map());
    setPreviewElapsedMs(0);
  }, []);

  const graphState: GraphState<"device-processing"> = (bindingIndex >= 0 ? session?.stack.current.deviceGraphs[bindingIndex] : undefined) ?? EMPTY_GRAPH;
  const physicalGraphState: GraphState<"physical-composition"> = (bindingIndex >= 0 ? session?.stack.current.physicalGraphs[bindingIndex] : undefined) ?? EMPTY_PHYSICAL_GRAPH;
  const graphStateRef = useRef(graphState);
  graphStateRef.current = graphState;

  useEffect(() => {
    if (!simulating) return;
    const tick = () => {
      // Rebuild from the live graph so Inspector period edits apply immediately
      // without stopping and re-running Dry-run.
      const channels = buildDryRunPreviewChannels(graphStateRef.current);
      previewChannelsRef.current = channels;
      const actuators = previewParticipantIds(channels);
      setPreviewActuatorIds(actuators);
      const elapsed = performance.now() - previewStartedAtRef.current;
      setPreviewElapsedMs(elapsed);
      setPreviewActiveIds(activeActuatorsAt(elapsed, channels));
      setPreviewTriggerIds(activeTriggersAt(elapsed, channels));
      setPreviewLedIntensity(ledIntensitiesAt(elapsed, channels));
      setPreviewRgbVisual(rgbVisualsAt(elapsed, channels));
    };
    tick();
    const id = window.setInterval(tick, 50);
    return () => window.clearInterval(id);
  }, [simulating]);

  const domainNodes = graphState.nodes as readonly GraphNode<"device-processing", string, DeviceProcessingNodeData>[];
  const moduleNodes = physicalGraphState.nodes as readonly GraphNode<"physical-composition", string, PhysicalCompositionNodeData>[];
  const projectAuthoringMetadata = session?.stack.current.authoringMetadata;
  const authoringMetadata = useMemo(() => projectAuthoringMetadata ?? {}, [projectAuthoringMetadata]);

  useEffect(() => {
    if (!demoOnly || demoInspectorSeeded.current) return;
    const schedule = domainNodes.find((n) => n.id === "demo-schedule");
    if (!schedule) return;
    demoInspectorSeeded.current = true;
    const meta = authoringMetadata[schedule.id];
    setInspector({ kind: "edit", nodeId: schedule.id, data: schedule.data, comment: meta?.comment ?? "" });
  }, [demoOnly, domainNodes, authoringMetadata]);

  const moduleOptions = useMemo(() => {
    const fromModules = moduleNodes
      .filter((n) => isModuleNodeData(n.data))
      .map((n) => ({
        id: n.id,
        label: authoringMetadata[n.id]?.comment && authoringMetadata[n.id]!.comment!.trim() !== "" ? authoringMetadata[n.id]!.comment! : n.id,
        portId: isModuleNodeData(n.data) ? n.data.portId : undefined,
      }));
    const takenPorts = new Set(fromModules.map((m) => m.portId).filter((id): id is number => id !== undefined));
    const fromPorts = configuredPorts
      .filter((port) => !takenPorts.has(port.portId) && port.pins.some((pin) => pin.peripheral !== "unused"))
      .map((port) => ({
        id: portCardId(port.portId),
        label: `Porta ${port.portId}`,
        portId: port.portId,
      }));
    return [...fromModules, ...fromPorts];
  }, [moduleNodes, authoringMetadata, configuredPorts]);
  const knownModuleNodeIds = useMemo(() => new Set(moduleOptions.map((m) => m.id)), [moduleOptions]);
  const moduleLabel = useCallback((moduleNodeId: string) => moduleOptions.find((m) => m.id === moduleNodeId)?.label ?? moduleNodeId, [moduleOptions]);
  const fieldLabel = useCallback(
    (moduleNodeId: string, fieldId: number) => {
      const option = moduleOptions.find((m) => m.id === moduleNodeId);
      const map = option?.portId !== undefined ? pinMapOf(option.portId) : undefined;
      const protocol = protocolFor({ moduleNodeId, portId: option?.portId });
      return labelForNumericSignal(fieldId, map, protocol) ?? String(fieldId);
    },
    [moduleOptions, pinMapOf, protocolFor],
  );

  const errorsByNode = useMemo(() => {
    const map = new Map<string, string>();
    if (dryRun) for (const issue of dryRun.issues) for (const segment of issue.path) map.set(segment, issue.remediation);
    return map;
  }, [dryRun]);
  const errorCount = dryRun?.issues.filter((i) => i.severity !== "warning").length ?? 0;
  const warningCount = dryRun?.issues.filter((i) => i.severity === "warning").length ?? 0;

  const domainRfNodes = useMemo(() => toProcessingNodes(graphState, authoringMetadata, new Set(errorsByNode.keys()), moduleLabel, fieldLabel, new Set(), locale), [graphState, authoringMetadata, errorsByNode, moduleLabel, fieldLabel, locale]);
  // "deletable" (DeletableEdge.tsx) routes around other blocks on H/V
  // segments with rounded corners, plus a hover trash control.
  const edges = useMemo<Edge[]>(() => toReactFlowEdges(graphState).map((edge) => ({ ...edge, type: "deletable" })), [graphState]);
  const processingNodeLabel = useCallback((id: string) => domainRfNodes.find((n) => n.id === id)?.data.label ?? id, [domainRfNodes]);

  const resolveCatalogEntry = useCallback(
    (nodeId: string) => {
      const node = domainNodes.find((n) => n.id === nodeId);
      return node ? catalogEntryForNode(node.data) : undefined;
    },
    [domainNodes],
  );

  const isValidConnection = useCallback(
    (connection: Connection | { source?: string | null; target?: string | null; sourceHandle?: string | null; targetHandle?: string | null }) =>
      isValidProcessingConnection(connection, resolveCatalogEntry),
    [resolveCatalogEntry],
  );

  const [localNodes, setLocalNodes] = useState<Node<ProcessingNodeUiData>[]>(domainRfNodes);
  const [syncedFrom, setSyncedFrom] = useState(domainRfNodes);
  if (domainRfNodes !== syncedFrom) {
    setSyncedFrom(domainRfNodes);
    setLocalNodes(domainRfNodes);
  }

  // Purely derived from positions + edges already on the canvas — never part of
  // the domain graph or authoringMetadata, so these never generate a command.
  // livePositions comes from localNodes (updates every drag frame, not just on
  // drop), so a container grows/shrinks live while the trigger or a member is
  // still being dragged.
  const livePositions = useMemo(() => new Map(localNodes.map((n) => [n.id, n.position])), [localNodes]);
  const eventContainers = useMemo(
    () =>
      computeEventContainers(
        graphState,
        authoringMetadata,
        livePositions,
        containerHint?.kind === "accepting" && containerHint.previewPosition
          ? {
              triggerId: containerHint.triggerId,
              position: containerHint.previewPosition,
              width: containerHint.previewWidth,
              height: containerHint.previewHeight,
            }
          : undefined,
      ),
    [graphState, authoringMetadata, livePositions, containerHint],
  );
  const containerByTriggerId = useMemo(() => new Map(eventContainers.map((c) => [c.triggerId, c])), [eventContainers]);
  const containerByMemberId = useMemo(() => {
    const map = new Map<string, (typeof eventContainers)[number]>();
    for (const container of eventContainers) for (const memberId of container.memberIds) map.set(memberId, container);
    return map;
  }, [eventContainers]);
  // The container node's own id is the trigger's real domain id (not a "container-" prefix) —
  // it's the trigger's on-canvas representation now, not a decoration next to it, so
  // onNodeClick's existing `domainNodes.find(n => n.id === node.id)` lookup already
  // resolves it correctly.
  //
  // Explicit `handles` are required: container nodes are rebuilt whenever layout
  // recomputes, which clears React Flow's DOM-measured handleBounds. Without a
  // static handles list, Schedule → member edges silently vanish (getEdgePosition
  // returns null). Coordinates match EventContainerNode (right/left, top: 16).
  const containerNodes = useMemo<Node<EventContainerNodeData>[]>(
    () => {
      const depthOf = (c: EventContainer): number => {
        let d = 0;
        let parentId = c.parentTriggerId;
        const seen = new Set<string>();
        while (parentId && !seen.has(parentId)) {
          seen.add(parentId);
          d += 1;
          parentId = containerByTriggerId.get(parentId)?.parentTriggerId;
        }
        return d;
      };
      return [...eventContainers]
        .sort((a, b) => depthOf(a) - depthOf(b))
        .map((container) => {
          const triggerData = domainNodes.find((n) => n.id === container.triggerId)?.data;
          const parent = container.parentTriggerId ? containerByTriggerId.get(container.parentTriggerId) : undefined;
          const kind = triggerData?.kind === "schedule" ? "schedule" : "event-source";
          const handleY = 16;
          // Schedule wires to the tick are domain-only (hidden) — no canvas handles.
          const handles =
            kind === "event-source"
              ? [
                  { id: "0", type: "target" as const, position: Position.Left, x: -5, y: handleY, width: 10, height: 14 },
                  { id: "0", type: "source" as const, position: Position.Right, x: container.width - 14, y: handleY, width: 14, height: 14 },
                ]
              : [];
          return {
            id: container.triggerId,
            type: "event-container",
            parentId: parent?.triggerId,
            position: parent ? { x: container.x - parent.x, y: container.y - parent.y } : { x: container.x, y: container.y },
            width: container.width,
            height: container.height,
            style: { width: container.width, height: container.height, overflow: "visible" },
            handles,
            draggable: true,
            selectable: true,
            connectable: kind === "event-source",
            focusable: true,
            zIndex: parent ? 0 : -1,
            data: {
              label: container.label,
              kind,
              periodMs: container.periodMs,
              rejecting: containerHint?.kind === "rejecting" && containerHint.triggerId === container.triggerId,
              accepting: containerHint?.kind === "accepting" && containerHint.triggerId === container.triggerId,
              previewActive: previewTriggerIds.has(container.triggerId),
            },
          };
        });
    },
    [eventContainers, domainNodes, containerHint, containerByTriggerId, previewTriggerIds],
  );
  // Real React Flow children: relative-to-container position + parentId, so
  // dragging the container (or a sibling member) behaves natively instead of
  // the old floating-box-behind-independent-nodes hack. Deliberately no
  // `extent: 'parent'` clamp: that requires React Flow to know the parent's
  // measured size, which — combined with a container whose size changes every
  // render — is what caused the dimension-reconciliation infinite loop (see
  // the container node's own comment above). Containment is instead enforced
  // by this screen's own onNodesChange/placeFromCatalog logic (the
  // attachLowerBound clamp, resolveSiblingOverlap), which already needs to run
  // regardless since a fresh attach has no parentId yet on the frame it lands.
  // localNodes itself always stays absolute (synced from authoringMetadata via
  // domainRfNodes) — the relative conversion only happens here, at render
  // time, never stored.
  // Flow Start (violet tick disc) is a fixed Schedule plug: not palette-placed,
  // not draggable. Schedule → tick is domain-only (hidden); tick → first block
  // is the rewirable entry. Relative position is pinned inside the dashed box.
  const renderedNodes = useMemo<Node<ProcessingNodeUiData>[]>(() => {
    const periodByToggleId = new Map<string, number>();
    for (const channel of previewChannelsRef.current) {
      for (const toggleId of channel.toggleIds) periodByToggleId.set(toggleId, channel.periodMs);
    }
    const tickRel = fixedTickRelativePosition();
    const rest = localNodes
      .filter((n) => !containerByTriggerId.has(n.id))
      .map((n) => {
        const container = containerByMemberId.get(n.id);
        const previewing = previewActuatorIds.has(n.id) || previewRgbVisual.has(n.id);
        const wavePeriodMs = periodByToggleId.get(n.id);
        const isTick = n.data.circular === true;
        const rgb = previewRgbVisual.get(n.id);
        const withPreview = {
          ...n,
          draggable: isTick ? false : n.draggable !== false,
          data: {
            ...n.data,
            previewActive: previewActiveIds.has(n.id) || previewTriggerIds.has(n.id),
            previewing,
            ...(previewLedIntensity.has(n.id)
              ? { ledIntensity: previewLedIntensity.get(n.id) }
              : rgb
                ? { ledIntensity: rgb.intensity }
                : { ledIntensity: undefined }),
            ...(rgb ? { ledColor: rgb.color } : {}),
            ...(previewing && n.data.toggleWave && wavePeriodMs !== undefined
              ? { waveLive: { elapsedMs: previewElapsedMs, periodMs: wavePeriodMs } }
              : { waveLive: undefined }),
          },
        };
        if (!container) return withPreview;
        return {
          ...withPreview,
          parentId: container.triggerId,
          position: isTick ? { x: tickRel.x, y: tickRel.y } : { x: n.position.x - container.x, y: n.position.y - container.y },
        };
      });
    return [...containerNodes, ...rest] as unknown as Node<ProcessingNodeUiData>[];
  }, [containerNodes, localNodes, containerByTriggerId, containerByMemberId, previewActiveIds, previewActuatorIds, previewTriggerIds, previewElapsedMs, previewLedIntensity, previewRgbVisual]);

  // Domain keeps Schedule → entry edges for membership/dry-run; the canvas hides
  // them so the dashed box + “entry” badge carry that meaning instead of a
  // parent→child wire that competed with the inner chain.
  const [localEdges, setLocalEdges] = useState<Edge[]>(edges);
  const [edgesSyncedFrom, setEdgesSyncedFrom] = useState(edges);
  if (edges !== edgesSyncedFrom) {
    setEdgesSyncedFrom(edges);
    setLocalEdges(edges);
  }
  const visibleEdges = useMemo(
    () =>
      localEdges.filter((edge) => {
        if (!containerByTriggerId.has(edge.source)) return true;
        const memberOf = containerByMemberId.get(edge.target);
        return !memberOf || memberOf.triggerId !== edge.source;
      }),
    [localEdges, containerByTriggerId, containerByMemberId],
  );

  useEffect(() => {
    if (!session || bindingIndex < 0 || !execute) return;
    if (session.stack.current.deviceGraphs.length > bindingIndex) return;
    execute({
      kind: "RepairDeviceGraphAlignment",
      apply: (project) => {
        const physicalGraphs = [...project.physicalGraphs];
        const deviceGraphs = [...project.deviceGraphs];
        while (physicalGraphs.length <= bindingIndex) physicalGraphs.push({ layer: "physical-composition", nodes: [], edges: [] });
        while (deviceGraphs.length <= bindingIndex) deviceGraphs.push({ layer: "device-processing", nodes: [], edges: [] });
        return { ok: true, value: { ...project, physicalGraphs, deviceGraphs } };
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindingIndex, session?.stack.current.deviceGraphs.length]);

  // Every Schedule gets a fixed violet tick disc (not palette-placed). Insert
  // one when missing and rewire any direct Schedule → block edges through it.
  useEffect(() => {
    if (!execute || bindingIndex < 0) return;
    const startEntry = findCatalogEntryById("native.flow_start");
    if (!startEntry) return;
    const lens = deviceGraphLens(bindingIndex);
    for (const node of domainNodes) {
      if (node.data.kind !== "schedule") continue;
      const scheduleId = node.id;
      const outs = graphState.edges.filter((e) => e.source === scheduleId);
      const tickEdge = outs.find((e) => {
        const target = domainNodes.find((n) => n.id === e.target);
        return target ? isFlowStartBlock(target.data) : false;
      });
      if (tickEdge) continue;
      const startData = nodeDataFromCatalogEntry(startEntry, moduleOptions[0]?.id);
      if (!startData || startData.kind !== "block") continue;
      const tickId = `dp-tick-${scheduleId}`;
      if (domainNodes.some((n) => n.id === tickId)) continue;
      const schedulePos = authoringMetadata[scheduleId]?.position ?? { x: 40, y: 100 };
      const tickPos = fixedTickAbsolute(triggerToContainerOrigin(schedulePos));
      execute(addGraphNodeCommand(lens, { layer: "device-processing", id: tickId, data: startData }));
      for (const edge of outs) {
        execute(removeGraphEdgeCommand(lens, edge.id));
        execute(
          addGraphEdgeCommand(lens, {
            id: `dpe-rewire-${edge.id}`,
            source: tickId,
            target: edge.target,
            sourceHandle: edge.sourceHandle ?? "0",
            targetHandle: edge.targetHandle ?? "0",
          }),
        );
      }
      execute(
        addGraphEdgeCommand(lens, {
          id: `dpe-tick-${scheduleId}`,
          source: scheduleId,
          target: tickId,
          sourceHandle: "0",
          targetHandle: "0",
        }),
      );
      execute({
        kind: "UpdateAuthoringMetadata",
        apply: (project) => ({
          ok: true,
          value: {
            ...project,
            authoringMetadata: {
              ...project.authoringMetadata,
              [tickId]: { comment: "", position: tickPos },
            },
          },
        }),
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindingIndex, domainNodes.map((n) => n.id).join(","), graphState.edges.map((e) => e.id).join(",")]);

  function overlapObstaclesFor(draggedId: string, extraExclude: ReadonlySet<string> = new Set()): SizedRect[] {
    const skip = new Set(extraExclude);
    skip.add(draggedId);
    const dragged = containerByTriggerId.get(draggedId);
    if (dragged) {
      for (const id of collectDescendantMemberIds(dragged, containerByTriggerId)) skip.add(id);
    }
    const containers = peerContainerObstacles(draggedId, eventContainers, containerByTriggerId).filter((o) => !skip.has(o.id));
    const cards = localNodes
      .filter((n) => !containerByTriggerId.has(n.id) && !skip.has(n.id))
      .map((n) => {
        const size = layoutSizeForUiNode(n);
        return { id: n.id, position: n.position, w: size.w, h: size.h };
      });
    return [...containers, ...cards];
  }

  function onNodesChange(changes: NodeChange<Node<ProcessingNodeUiData>>[]) {
    if (inspector?.kind === "edit" && changes.some((change) => change.type === "remove" && change.id === inspector.nodeId)) {
      setInspector(null);
    }
    const newEdgeCommands: ReturnType<typeof addGraphEdgeCommand>[] = [];
    const removeEdgeCommands: ReturnType<typeof removeGraphEdgeCommand>[] = [];
    // Synthetic position changes for members carried along by a container drag
    // — React Flow only emits an event for the dragged node itself (the
    // container), never for the children it's visually moving with it.
    const carriedChanges: NodeChange<Node<ProcessingNodeUiData>>[] = [];

    // Tick discs are system-owned: never drag, detach, or delete from the canvas.
    const gatedChanges = changes.filter((change) => {
      if (!("id" in change)) return true;
      const data = domainNodes.find((n) => n.id === change.id)?.data;
      if (!data || !isFlowStartBlock(data)) return true;
      return change.type !== "position" && change.type !== "remove";
    });

    // React Flow reports a member's dragged position relative to its container
    // (parentId); localNodes/authoringMetadata always store absolute canvas
    // positions, so translate back before either touches them.
    const absoluteChanges = gatedChanges.map((change) => {
      if (change.type !== "position" || !change.position) return change;
      const isContainer = containerByTriggerId.has(change.id);
      const container = containerByMemberId.get(change.id);
      let position = container ? { x: change.position.x + container.x, y: change.position.y + container.y } : change.position;

      if (isContainer) {
        // React Flow reports the dashed-box origin (relative to a parent
        // container when this trigger is nested). Convert to the trigger's
        // stored absolute position, carry descendants, and handle nest/unnest.
        const info = containerByTriggerId.get(change.id);
        const parent = containerByMemberId.get(change.id);
        const boxOrigin = parent ? { x: change.position.x + parent.x, y: change.position.y + parent.y } : change.position;
        let triggerPosition = {
          x: boxOrigin.x + NODE_PADDING,
          y: boxOrigin.y + NODE_PADDING + EVENT_CONTAINER_HEADER_HEIGHT,
        };
        const draggedKind = domainNodes.find((n) => n.id === change.id)?.data.kind;
        const excludeSelf = new Set([change.id]);
        const nestTarget = (at: { x: number; y: number }) => {
          if (!draggedKind || !canBeNested(draggedKind)) return undefined;
          const hovered = containerAtPosition(at, eventContainers, excludeSelf);
          if (!hovered || hovered.triggerId === change.id) return undefined;
          if (info && containerContainsTrigger(info, hovered.triggerId, containerByTriggerId)) return undefined;
          return hovered;
        };

        const escapingParent = parent !== undefined && memberEscapesContainer(triggerPosition, parent);
        const target = nestTarget(triggerPosition);

        if (change.dragging === true) {
          if (target && info) {
            setContainerHint({
              triggerId: target.triggerId,
              kind: "accepting",
              previewPosition: boxOrigin,
              previewWidth: info.width,
              previewHeight: info.height,
            });
          } else if (parent && escapingParent) {
            setContainerHint({ triggerId: parent.triggerId, kind: "rejecting" });
          } else if (info) {
            const peer = overlappingPeerContainer({ x: boxOrigin.x, y: boxOrigin.y, width: info.width, height: info.height }, change.id, eventContainers, containerByTriggerId);
            setContainerHint(peer ? { triggerId: peer.triggerId, kind: "rejecting" } : null);
          }
        }

        if (change.dragging === false) {
          setContainerHint(null);
          const lens = deviceGraphLens(bindingIndex);
          if (parent && escapingParent) {
            const plan = detachMemberEdges(change.id, parent, graphState.edges);
            for (const edgeId of plan.removeIds) removeEdgeCommands.push(removeGraphEdgeCommand(lens, edgeId));
              setOverlapWarning(copy.removedFrom(parent.label));
          }
          if (target && target.triggerId !== parent?.triggerId) {
            const alreadyNested = graphState.edges.some((e) => e.source === target.triggerId && e.target === change.id);
            if (!alreadyNested) {
              newEdgeCommands.push(
                addGraphEdgeCommand(lens, {
                  id: `dpe-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
                  source: target.triggerId,
                  target: change.id,
                  sourceHandle: "0",
                  targetHandle: "0",
                }),
              );
              setOverlapWarning(copy.insertedInto(target.label));
            }
          } else if (!canBeNested(draggedKind ?? "block") && info) {
            const origin = triggerToContainerOrigin(triggerPosition);
            const peer = overlappingPeerContainer({ x: origin.x, y: origin.y, width: info.width, height: info.height }, change.id, eventContainers, containerByTriggerId);
            if (peer) setOverlapWarning(copy.scheduleInsideSchedule);
          }
        }

        if (info) {
          const extraExclude = new Set<string>();
          if (target) extraExclude.add(target.triggerId);
          if (parent && !escapingParent) extraExclude.add(parent.triggerId);
          const origin = triggerToContainerOrigin(triggerPosition);
          const resolved = resolveRectOverlap(change.id, origin, { w: info.width, h: info.height }, overlapObstaclesFor(change.id, extraExclude));
          triggerPosition = containerOriginToTrigger(resolved);
          if (parent && !escapingParent) {
            const bound = { x: parent.x + NODE_PADDING + ENTRY_FEED_INSET, y: parent.y + NODE_PADDING + EVENT_CONTAINER_HEADER_HEIGHT };
            triggerPosition = { x: Math.max(triggerPosition.x, bound.x), y: Math.max(triggerPosition.y, bound.y) };
          }
        }

        const oldPos = livePositions.get(change.id);
        if (info && oldPos) {
          const delta = { x: triggerPosition.x - oldPos.x, y: triggerPosition.y - oldPos.y };
          const moved = delta.x !== 0 || delta.y !== 0;
          const newOrigin = triggerToContainerOrigin(triggerPosition);
          for (const memberId of collectDescendantMemberIds(info, containerByTriggerId)) {
            const memberData = domainNodes.find((n) => n.id === memberId)?.data;
            if (memberData && isFlowStartBlock(memberData)) {
              carriedChanges.push({
                id: memberId,
                type: "position",
                position: fixedTickAbsolute(newOrigin),
                dragging: change.dragging,
              });
              continue;
            }
            const memberPos = livePositions.get(memberId);
            if (!memberPos) continue;
            if (!moved && change.dragging !== false) continue;
            carriedChanges.push({
              id: memberId,
              type: "position",
              position: moved ? { x: memberPos.x + delta.x, y: memberPos.y + delta.y } : memberPos,
              dragging: change.dragging,
            });
          }
        }
        return { ...change, position: triggerPosition };
      }

      const escaping = container !== undefined && memberEscapesContainer(position, container);
      const isChainableBlock = domainNodes.find((n) => n.id === change.id)?.data.kind === "block";
      const hovered = isChainableBlock
        ? containerAtPosition(position, eventContainers, escaping && container ? new Set([container.triggerId]) : undefined)
        : undefined;
      const sticky = containerHint?.kind === "accepting" ? eventContainers.find((c) => c.triggerId === containerHint.triggerId) : undefined;
      const acceptTarget = hovered ?? (sticky && !memberEscapesContainer(position, sticky) ? sticky : undefined);

      if (change.dragging === true) {
        if (escaping && container) {
          setContainerHint({ triggerId: container.triggerId, kind: "rejecting" });
        } else if (isChainableBlock && acceptTarget && acceptTarget.triggerId !== container?.triggerId) {
          setContainerHint({ triggerId: acceptTarget.triggerId, kind: "accepting", previewPosition: position });
        } else {
          setContainerHint(null);
        }
      }

      let attachLowerBound: { x: number; y: number } | undefined;
      // Attachment/detachment only settle on drop. Overlap is resolved every
      // frame so two cards never stack, including while the pointer is down.
      if (change.dragging === false) {
        setContainerHint(null);
        if (isChainableBlock) {
          const plan = planMembershipDrop({ current: container, hovered: acceptTarget, escaping });
          const lens = deviceGraphLens(bindingIndex);
          if (plan.detachFrom && container) {
            const detached = detachMemberEdges(change.id, container, graphState.edges);
            for (const edgeId of detached.removeIds) removeEdgeCommands.push(removeGraphEdgeCommand(lens, edgeId));
            if (detached.splice) {
              newEdgeCommands.push(
                addGraphEdgeCommand(lens, {
                  id: `dpe-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
                  source: detached.splice.source,
                  target: detached.splice.target,
                  sourceHandle: "0",
                  targetHandle: "0",
                }),
              );
            }
          }
          if (plan.attachTo) {
            const target = eventContainers.find((c) => c.triggerId === plan.attachTo);
            if (target) {
              const source = chainTailId(target, graphState.edges, new Set(containerByTriggerId.keys()));
              const alreadyLinked = graphState.edges.some((e) => e.source === source && e.target === change.id);
              if (!alreadyLinked) {
                newEdgeCommands.push(
                  addGraphEdgeCommand(lens, {
                    id: `dpe-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
                    source,
                    target: change.id,
                    sourceHandle: "0",
                    targetHandle: "0",
                  }),
                );
                setOverlapWarning(plan.detachFrom ? copy.movedInto(target.label) : copy.connectedTo(target.label));
              }
              attachLowerBound = { x: target.x + NODE_PADDING + ENTRY_FEED_INSET, y: target.y + NODE_PADDING + EVENT_CONTAINER_HEADER_HEIGHT };
              position = { x: Math.max(position.x, attachLowerBound.x), y: Math.max(position.y, attachLowerBound.y) };
            }
          } else if (plan.detachFrom && container) {
            setOverlapWarning(copy.removedFrom(container.label));
          }
        }
      }
      const insideIds = container && escaping ? new Set([container.triggerId, ...container.memberIds]) : null;
      const draggedNode = localNodes.find((n) => n.id === change.id);
      const selfSize = draggedNode ? layoutSizeForUiNode(draggedNode) : { w: NODE_WIDTH, h: NODE_HEIGHT };
      const siblings = localNodes
        .filter((n) => !containerByTriggerId.has(n.id) && !insideIds?.has(n.id))
        .map((n) => {
          const size = layoutSizeForUiNode(n);
          return { id: n.id, position: n.id === change.id ? position : n.position, w: size.w, h: size.h };
        });
      position = resolveSiblingOverlap(change.id, position, siblings, attachLowerBound, selfSize);

      return { ...change, position };
    });
    const allChanges = [...absoluteChanges, ...carriedChanges];
    setLocalNodes((nds) => applyNodeChanges(allChanges, nds));
    if (!execute || bindingIndex < 0) return;
    for (const command of removeEdgeCommands) execute(command);
    for (const command of newEdgeCommands) execute(command);
    const committable = allChanges.filter((c) => !(c.type === "position" && c.dragging === true));
    const commands = nodeChangesToCommands(committable, deviceGraphLens(bindingIndex));
    for (const command of commands) execute(command);
  }

  function onEdgesChange(changes: EdgeChange[]) {
    setLocalEdges((eds) => applyEdgeChanges(changes, eds));
    if (!execute || bindingIndex < 0) return;
    const commands = edgeChangesToCommands(changes, deviceGraphLens(bindingIndex));
    for (const command of commands) execute(command);
  }

  function onConnect(connection: Connection) {
    if (!execute || bindingIndex < 0 || !isValidConnection(connection)) return;
    const edgeId = `dpe-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    execute(
      addGraphEdgeCommand(deviceGraphLens(bindingIndex), {
        id: edgeId,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? undefined,
        targetHandle: connection.targetHandle ?? undefined,
      }),
    );
  }

  function onNodeClick(_: unknown, node: Node<ProcessingNodeUiData>) {
    const domainNode = domainNodes.find((n) => n.id === node.id);
    if (!domainNode) return;
    // The violet Activation disc is wiring-only — it must not open an inspector.
    if (node.data.circular || isFlowStartBlock(domainNode.data)) return;
    const meta = authoringMetadata[node.id];
    setInspector({ kind: "edit", nodeId: node.id, data: domainNode.data, comment: meta?.comment ?? "" });
  }

  function placeFromCatalog(
    entry: ProcessingCatalogEntry,
    requestedPosition = nextSpawnPosition(domainNodes.length),
    baySide = peekPaletteDragBaySide(),
  ) {
    if (!execute || bindingIndex < 0) return;
    // Tick discs are spawned with each Schedule — never from the palette.
    if (entry.id === "native.flow_start" || entry.typeId === "ab.flow_start") return;
    const data = nodeDataFromCatalogEntry(entry, moduleOptions[0]?.id, baySide);
    if (!data) return;

    const id = `dp-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    const bay = isBayEntry(entry);
    const resolvedBaySide = baySide ?? (bay ? "output" : undefined);

    // Same attachment handling as an existing block being dragged (onNodesChange):
    // a new Block dropped inside a dashed container has no edge yet, so chain it
    // onto that trigger (or its last member) instead of leaving it merely
    // overlapping. Only a Block can be chained this way — see onNodesChange.
    // Bay endpoints stay outside the box (left = ingresso, right = uscita).
    let position = requestedPosition;
    let attachEdgeCommand: ReturnType<typeof addGraphEdgeCommand> | undefined;
    let attachLowerBound: { x: number; y: number } | undefined;
    if (bay && resolvedBaySide) {
      position = positionForBayDrop(resolvedBaySide, requestedPosition, eventContainers);
    } else if (data.kind === "block") {
      const target = containerAtPosition(position, eventContainers);
      if (target) {
        attachEdgeCommand = addGraphEdgeCommand(deviceGraphLens(bindingIndex), {
          id: `dpe-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
          source: chainTailId(target, graphState.edges, new Set(containerByTriggerId.keys())),
          target: id,
          sourceHandle: "0",
          targetHandle: "0",
        });
        setOverlapWarning(copy.connectedTo(target.label));
        attachLowerBound = { x: target.x + NODE_PADDING + ENTRY_FEED_INSET, y: target.y + NODE_PADDING + EVENT_CONTAINER_HEADER_HEIGHT };
        position = { x: Math.max(position.x, attachLowerBound.x), y: Math.max(position.y, attachLowerBound.y) };
      }
    } else if (isNestableContainer(data.kind)) {
      const target = canBeNested(data.kind) ? containerAtPosition(position, eventContainers) : undefined;
      if (target) {
        attachEdgeCommand = addGraphEdgeCommand(deviceGraphLens(bindingIndex), {
          id: `dpe-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
          source: target.triggerId,
          target: id,
          sourceHandle: "0",
          targetHandle: "0",
        });
        setOverlapWarning(copy.insertedInto(target.label));
        attachLowerBound = { x: target.x + NODE_PADDING + ENTRY_FEED_INSET, y: target.y + NODE_PADDING + EVENT_CONTAINER_HEADER_HEIGHT };
        position = { x: Math.max(position.x, attachLowerBound.x), y: Math.max(position.y, attachLowerBound.y) };
      } else if (data.kind === "schedule" && containerAtPosition(position, eventContainers)) {
        setOverlapWarning(copy.scheduleInsideSchedule);
      }
      const size = emptyEventContainerSize();
      const origin = triggerToContainerOrigin(position);
      const extra = new Set(target ? [target.triggerId] : []);
      const resolved = resolveRectOverlap("", origin, { w: size.width, h: size.height }, overlapObstaclesFor("", extra));
      position = containerOriginToTrigger(resolved);
      if (attachLowerBound) position = { x: Math.max(position.x, attachLowerBound.x), y: Math.max(position.y, attachLowerBound.y) };
    }
    if (!isNestableContainer(data.kind)) {
      position = resolveSiblingOverlap(
        "",
        position,
        localNodes
          .filter((n) => !containerByTriggerId.has(n.id))
          .map((n) => {
            const size = layoutSizeForUiNode(n);
            return { id: n.id, position: n.position, w: size.w, h: size.h };
          }),
        attachLowerBound,
      );
    }

    // The node must exist before an edge can reference its id as a target.
    execute(addGraphNodeCommand(deviceGraphLens(bindingIndex), { layer: "device-processing", id, data }));
    if (attachEdgeCommand) execute(attachEdgeCommand);
    const comment =
      bay && resolvedBaySide
        ? `${localizeCatalogEntry(entry, locale).label} · ${localizedBaySideLabel(resolvedBaySide, locale)}`
        : localizeCatalogEntry(entry, locale).label;
    execute({
      kind: "UpdateAuthoringMetadata",
      apply: (project) => ({
        ok: true,
        value: {
          ...project,
          authoringMetadata: {
            ...project.authoringMetadata,
            [id]: { comment, position },
          },
        },
      }),
    });

    if (data.kind === "schedule") {
      spawnScheduleTick(id, position);
    }

    setInspector({ kind: "edit", nodeId: id, data, comment });
  }

  /** Creates the fixed violet tick disc for a Schedule and wires Schedule → tick. */
  function spawnScheduleTick(scheduleId: string, schedulePosition: { readonly x: number; readonly y: number }) {
    if (!execute || bindingIndex < 0) return;
    const startEntry = findCatalogEntryById("native.flow_start");
    if (!startEntry) return;
    const startData = nodeDataFromCatalogEntry(startEntry, moduleOptions[0]?.id);
    if (!startData || startData.kind !== "block") return;
    const tickId = `dp-tick-${scheduleId}`;
    if (domainNodes.some((n) => n.id === tickId)) return;
    const origin = triggerToContainerOrigin(schedulePosition);
    const tickPos = fixedTickAbsolute(origin);
    const lens = deviceGraphLens(bindingIndex);
    execute(addGraphNodeCommand(lens, { layer: "device-processing", id: tickId, data: startData }));
    execute(
      addGraphEdgeCommand(lens, {
        id: `dpe-tick-${scheduleId}`,
        source: scheduleId,
        target: tickId,
        sourceHandle: "0",
        targetHandle: "0",
      }),
    );
    execute({
      kind: "UpdateAuthoringMetadata",
      apply: (project) => ({
        ok: true,
        value: {
          ...project,
          authoringMetadata: {
            ...project.authoringMetadata,
            [tickId]: { comment: "", position: tickPos },
          },
        },
      }),
    });
  }

  function persistNode(nodeId: string, data: DeviceProcessingNodeData, comment: string) {
    if (!execute || bindingIndex < 0) return;
    const lens = deviceGraphLens(bindingIndex);
    execute(updateGraphNodeCommand(lens, { layer: "device-processing", id: nodeId, data }));
    execute({
      kind: "UpdateAuthoringMetadata",
      apply: (project) => ({
        ok: true,
        value: {
          ...project,
          authoringMetadata: {
            ...project.authoringMetadata,
            [nodeId]: { ...project.authoringMetadata[nodeId], comment },
          },
        },
      }),
    });
  }

  function handleApply(data: DeviceProcessingNodeData, comment: string) {
    if (inspector?.kind !== "edit") return;
    persistNode(inspector.nodeId, data, comment);
  }

  function handleSave(data: DeviceProcessingNodeData, comment: string) {
    if (!execute || bindingIndex < 0) return;
    const lens = deviceGraphLens(bindingIndex);
    if (inspector?.kind === "edit") {
      persistNode(inspector.nodeId, data, comment);
    } else if (inspector) {
      const id = `dp-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
      execute(addGraphNodeCommand(lens, { layer: "device-processing", id, data }));
      execute({
        kind: "UpdateAuthoringMetadata",
        apply: (project) => ({ ok: true, value: { ...project, authoringMetadata: { ...project.authoringMetadata, [id]: { comment, position: nextSpawnPosition(domainNodes.length) } } } }),
      });
    }
    setInspector(null);
  }

  function handleDelete() {
    if (!execute || bindingIndex < 0 || inspector?.kind !== "edit") return;
    execute(removeGraphNodeCommand(deviceGraphLens(bindingIndex), inspector.nodeId));
    setInspector(null);
  }

  function onCanvasDragOver(event: DragEvent<HTMLDivElement>) {
    if (![...event.dataTransfer.types].includes(PROCESSING_BLOCK_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    const rect = event.currentTarget.getBoundingClientRect();
    setDropPreview({ x: snapToGrid(event.clientX - rect.left), y: snapToGrid(event.clientY - rect.top) });
    const flowPosRaw = rf?.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    if (!flowPosRaw) return;
    const flowPos = { x: snapToGrid(flowPosRaw.x), y: snapToGrid(flowPosRaw.y) };
    const hovered = containerAtPosition(flowPos, eventContainers);
    const sticky = containerHint?.kind === "accepting" ? eventContainers.find((c) => c.triggerId === containerHint.triggerId) : undefined;
    const target = hovered ?? (sticky && !memberEscapesContainer(flowPos, sticky) ? sticky : undefined);
    if (!target) {
      setContainerHint(null);
      return;
    }
    if (peekPaletteDragKind() === "schedule") {
      setContainerHint({ triggerId: target.triggerId, kind: "rejecting" });
      return;
    }
    // Bay hardware stays outside the dashed box — no nest accept highlight.
    if (peekPaletteDragBaySide() !== undefined) {
      setContainerHint(null);
      return;
    }
    setContainerHint({ triggerId: target.triggerId, kind: "accepting", previewPosition: flowPos });
  }

  function onCanvasDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDropPreview(null);
    setContainerHint(null);
    const payload = decodePaletteDrag(event.dataTransfer.getData(PROCESSING_BLOCK_MIME));
    if (!payload) return;
    const entry = findCatalogEntryById(payload.entryId);
    if (!entry) return;
    const flowPos = rf?.screenToFlowPosition({ x: event.clientX, y: event.clientY }) ?? { x: 80, y: 80 };
    placeFromCatalog(entry, { x: snapToGrid(flowPos.x), y: snapToGrid(flowPos.y) }, payload.baySide);
  }

  async function handleDryRun() {
    if (simulating) {
      stopPreview();
      return;
    }
    setRunning(true);
    setHashHex(null);
    try {
      const result = dryRunConfig({ physicalGraph: physicalGraphState, processingGraph: graphState, mqtt: DISABLED_MQTT, connectivity: 0, energy: DEFAULT_ENERGY }, { availableBlockRuleTypeIds: SHIPPED_TYPE_IDS });
      setDryRun(result);
      const hardErrors = result.issues.filter((i) => i.severity !== "warning").length;
      // Start local LED/GPIO preview immediately after validate — before the
      // async hash — so the blink is not lost if something remounts mid-await.
      if (hardErrors === 0) {
        const channels = buildDryRunPreviewChannels(graphState);
        previewChannelsRef.current = channels;
        previewStartedAtRef.current = performance.now();
        if (channels.length > 0) {
          setSimulating(true);
          setPreviewElapsedMs(0);
          setPreviewActuatorIds(previewParticipantIds(channels));
          setPreviewActiveIds(activeActuatorsAt(0, channels));
          setPreviewTriggerIds(activeTriggersAt(0, channels));
          setPreviewLedIntensity(ledIntensitiesAt(0, channels));
          setPreviewRgbVisual(rgbVisualsAt(0, channels));
        } else {
          stopPreview();
        }
      } else {
        stopPreview();
      }
      if (result.compiled) {
        const digest = await sha256(encodeConfigCbor(result.compiled));
        setHashHex(Array.from(digest.slice(0, 8)).map((b) => b.toString(16).padStart(2, "0")).join(""));
      }
    } finally {
      setRunning(false);
    }
  }

  useEffect(() => {
    if (!demoOnly || demoAutoStarted.current || graphState.nodes.length === 0) return;
    demoAutoStarted.current = true;
    void handleDryRun();
    // First visitor paint only — later graph edits keep the live preview loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demoOnly, graphState.nodes.length]);

  const canDeploy = dryRun !== null && errorCount === 0;
  const statusColor = simulating
    ? "#F5C518"
    : !dryRun
      ? "var(--color-ink-faint)"
      : errorCount > 0
        ? "var(--color-error)"
        : warningCount > 0
          ? "var(--color-warning)"
          : "var(--color-success)";
  const statusText = simulating
    ? copy.previewInProgress
    : !dryRun
      ? copy.dryRunNotRun
      : errorCount > 0 || warningCount > 0
        ? copy.issuesCount(errorCount, warningCount)
        : copy.valid;

  return (
    <div className="flex h-full flex-col">
      {demoOnly && <VisitorDemoTour enabled />}
      <div className="flex h-14 shrink-0 items-center gap-3 overflow-hidden border-b border-border bg-surface px-4">
        {!demoOnly && (
          <div className="shrink-0">
            <CoreSelector bindings={bindings} selected={selected} onSelect={(b) => setSelectedBindingId(b.bindingId)} />
          </div>
        )}
        <h1 className="min-w-0 truncate font-heading text-lg font-semibold text-ink">{demoOnly ? "Flow" : copy.title}</h1>
        <div className="min-w-0 flex-1" />
        <button
          type="button"
          data-tour-target="demo-tour-run"
          onClick={() => void handleDryRun()}
          disabled={running}
          className={`flex shrink-0 items-center gap-1.5 rounded-slpill px-4 py-1.5 font-body-strong text-sm disabled:opacity-50 ${
            simulating
              ? "border border-[#F5C518] text-ink"
              : demoOnly
                ? "bg-brand-blue text-white hover:bg-brand-blue-dark"
                : "border border-border-strong font-body text-ink"
          }`}
          style={simulating ? { backgroundColor: "color-mix(in srgb, #F5C518 14%, transparent)" } : undefined}
        >
          {simulating ? <Square size={14} fill="currentColor" /> : <PlayCircle size={16} />}
          {running ? copy.running : simulating ? copy.stopPreview : demoOnly ? copy.run : copy.dryRun}
        </button>
        {errorCount > 0 && (
          <span className="flex shrink-0 items-center gap-1.5 rounded-slpill px-3 py-1.5 font-body text-sm text-error" style={{ backgroundColor: "color-mix(in srgb, var(--color-error) 10%, transparent)" }}>
            <CircleAlert size={14} />
            {copy.errorsCount(errorCount)}
          </span>
        )}
        {!demoOnly && (
          <button type="button" disabled={!canDeploy} onClick={() => navigate("deploy-diff")} className="shrink-0 rounded-slpill bg-brand-blue px-4 py-1.5 font-body-strong text-sm text-white hover:bg-brand-blue-dark disabled:opacity-50">
            {copy.sendToDeploy}
          </button>
        )}
      </div>

      {!selected ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="font-body text-sm text-ink-faint">{copy.noCore}</p>
        </div>
      ) : (
        <div className="relative flex flex-1 overflow-hidden">
          {!demoOnly && <ProcessingBlockPalette />}

          <div className="relative flex-1" onDragOver={onCanvasDragOver} onDragLeave={() => { setDropPreview(null); setContainerHint(null); }} onDrop={onCanvasDrop}>
            <ReactFlow
              nodeTypes={NODE_TYPES}
              edgeTypes={PROCESSING_EDGE_TYPES}
              // EventContainerNode reads its own `data` shape at runtime regardless of this
              // component's single node-data generic — ReactFlow itself is happy to render
              // heterogeneous node types side by side, TypeScript just needs the cast (done
              // inside `renderedNodes`). A contained trigger's own card is skipped from the
              // render — the dashed container (id'd with the same trigger id) is its on-canvas
              // representation now, not a separate node next to it; localNodes/the domain
              // graph still has it. Container nodes are listed first, a React Flow requirement
              // for `parentId` children to resolve.
              nodes={renderedNodes}
              edges={visibleEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              onNodeClick={onNodeClick}
              onInit={setRf}
              deleteKeyCode={demoOnly ? null : ["Backspace", "Delete"]}
              proOptions={demoOnly ? { hideAttribution: true } : undefined}
              defaultEdgeOptions={{ type: "deletable", interactionWidth: 24, style: { stroke: "var(--color-ink-faint)", strokeWidth: 1.75 } }}
              fitView
            >
              <Background gap={20} color="#E1E4EB" />
              <Controls position="bottom-left" />
              {domainNodes.length > 0 && <MiniMap position="bottom-right" pannable zoomable className="!rounded-slsm !border !border-border-strong !shadow-e1" nodeColor={(n) => PROCESSING_NODE_KIND_CONFIG[(n.data as ProcessingNodeUiData).kind]?.colorVar ?? "#8A8F99"} />}
            </ReactFlow>

            {domainNodes.length === 0 && !dropPreview && (
              <div className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-center${demoOnly || simulating ? "" : " mb-10"}`}>
                <Workflow size={48} strokeWidth={1.5} className="text-ink-faint" />
                <p className="mt-2 font-heading text-lg font-semibold text-ink">{copy.emptyTitle}</p>
                <p className="mt-2 rounded-slpill bg-brand-blue px-4 py-1.5 font-body-strong text-sm text-white opacity-70">{copy.emptyHint}</p>
              </div>
            )}

            {dropPreview && (
              <div
                className="pointer-events-none absolute rounded-slmd border-2 border-dashed border-brand-blue"
                style={{
                  width: 176,
                  height: 48,
                  left: dropPreview.x,
                  top: dropPreview.y,
                  backgroundColor: "color-mix(in srgb, var(--color-brand-blue) 8%, transparent)",
                }}
              />
            )}

            {overlapWarning && (
              <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-slpill bg-surface px-3 py-1.5 font-body text-sm text-ink shadow-e1" style={{ outline: "1px solid var(--color-warning)" }}>
                {overlapWarning}
              </div>
            )}

            {!demoOnly && !simulating && (
              <div className="absolute bottom-0 left-0 right-0 flex h-10 items-center gap-2 border-t border-border bg-surface px-4">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: statusColor }} />
                <span className="font-body text-xs text-ink-muted">{statusText}</span>
                {hashHex && <span className="font-mono text-xs text-ink-faint">hash: {hashHex}…</span>}
                <span className="ml-auto font-mono text-xs text-ink-faint">
                  {copy.nodesEdges(domainNodes.length, graphState.edges.length)}
                </span>
              </div>
            )}
          </div>

          {inspector && (
            <NodeInspector
              key={inspector.kind === "edit" ? inspector.nodeId : `create-${inspector.nodeKind}`}
              mode={inspector}
              moduleOptions={moduleOptions}
              existingNodes={domainNodes}
              existingEdges={graphState.edges}
              nodeLabel={processingNodeLabel}
              knownModuleNodeIds={knownModuleNodeIds}
              onSave={handleSave}
              onApply={handleApply}
              onDelete={!demoOnly && inspector.kind === "edit" ? handleDelete : undefined}
              onClose={() => setInspector(null)}
            />
          )}
        </div>
      )}
    </div>
  );
}
