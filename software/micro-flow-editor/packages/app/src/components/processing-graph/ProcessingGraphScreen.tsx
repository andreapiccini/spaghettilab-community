import { SIGNAL_STYLES, wireSignalType, type WireSignalType } from "./signal-colors.js";
import { decodeConfigCbor as decodeDeploymentConfig } from "@spaghettilab/config-decompiler";
import { deploymentIsCurrent } from "../../lib/manual-deployment-current.js";
import { savedCanvasViewport, saveCanvasViewport } from "./canvas-viewport.js";
import { WhiteLedModuleEditor } from "../device-recipe-editor/WhiteLedModuleEditor.js";
import { useSignalNodeGlow } from "./use-signal-node-glow.js";
import { activeEdgesForRecord, SignalWavePlanner, SIGNAL_ACTIVITY_MS } from "../../lib/edge-activity.js";
import { upgradeDht22Driver } from "../../lib/gpio-driver-presets.js";
import {
  SENSOR_INSTANCE_PROP,
  SENSOR_INPUT_PROP,
  SENSOR_OUTPUT_PROP,
} from "../../lib/sensor-instance.js";
import { prepareDriverDeployment } from "../../lib/driver-deployment-plan.js";
import { planDriverCanvasChanges } from "../../lib/driver-canvas-plan.js";
import { encodeConfigCbor, sha256 } from "@spaghettilab/config-compiler";
import { physicalPinsForBinding } from "../../lib/physical-pin-bindings.js";
import { dryRunConfig, type DryRunResult } from "@spaghettilab/config-decompiler";
import {
  isBlockNodeData,
  type DeviceProcessingNodeData,
} from "@spaghettilab/device-processing-graph-model";
import type { CoreBindingRecord, GraphNode, GraphState } from "@spaghettilab/domain";
import {
  isModuleNodeData,
  type PhysicalCompositionNodeData,
} from "@spaghettilab/physical-composition-model";
import {
  findCatalogEntryById,
  isBayEntry,
  shippedTypeIds,
  type ProcessingCatalogEntry,
} from "@spaghettilab/processing-block-catalog";
import {
  addGraphEdgeCommand,
  addGraphNodeCommand,
  deviceGraphLens,
  edgeChangesToCommands,
  nodeChangesToCommands,
  removeGraphEdgeCommand,
  removeGraphNodeCommand,
  toReactFlowEdges,
  updateGraphNodeCommand,
} from "@spaghettilab/react-flow-adapter";
import {
  applyEdgeChanges,
  applyNodeChanges,
  Background,
  Controls,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { CircleAlert, PlayCircle, Square, Workflow } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { labelForNumericSignal } from "../../lib/port-protocol-mock.js";
import { usePortProtocol } from "../../state/port-protocol-context.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { useNfcPresence } from "../../state/nfc-presence-context.js";
import { useSession } from "../../state/session-context.js";
import {
  pauseContinuousRuntime,
  configBytesHaveLiveRuntime,
  formatApplyConfigError,
} from "../../lib/stop-deployed-runtime.js";
import { portCardId } from "../physical-composition/ConfiguredPortNode.js";
import { DEFAULT_ENERGY, DISABLED_MQTT } from "../../lib/default-config-policy.js";
import {
  localizeCatalogEntry,
  localizedBaySideLabel,
} from "../../lib/processing-catalog-copy.js";
import { processingGraphCopy } from "../../lib/processing-graph-copy.js";
import { DEMO_VISITOR_PROJECT_NAME } from "../../lib/demo-project.js";
import { DEMO_ADD_BLOCK_IDS, isDemoOnlyEnabled } from "../../lib/demo-only.js";
import {
  BACKBONE_SENSOR_MODULES_META_KEY,
  createModuleFromRecipe,
  modulesForBinding,
  parseBackboneSensorModules,
  removeModule,
  resolveRecipe,
  upsertModule,
  type BackboneSensorModule,
} from "../../lib/backbone-sensor-modules.js";
import {
  BACKBONE_SENSOR_BLOCK_CATALOG_ID,
  propertiesForSensorModule,
  SENSOR_MODULE_ID_PROP,
  SENSOR_ACTION_ID_PROP,
} from "../../lib/backbone-sensor-block.js";
import {
  DEVICE_RECIPE_DRAFT_META_KEY,
  DEVICE_RECIPE_PENDING_CREATE_META_KEY,
  draftToCanvasSensorRecipes,
  parseDeviceRecipeDraft,
  serializeDeviceRecipeDraft,
} from "../../lib/device-recipe-draft.js";
import {
  draftModesForBinding,
  modesProvideBus,
  parsePhysicalProject,
  PHYSICAL_META_KEY,
  STATUS_LED_GPIO,
  STATUS_LED_LABEL,
} from "../../lib/backbone-physical.js";
import type { SensorBus, SensorRecipe } from "../../lib/sensor-recipe.js";
import { findSensorRecipeById, recipeChannels } from "../../lib/sensor-recipe.js";
import { VisitorDemoTour } from "./VisitorDemoTour.js";
import { DemoRadialAdd } from "./DemoRadialAdd.js";
import { BackboneModulesPanel } from "./BackboneModulesPanel.js";
import { PhysicalBusMissingModal } from "./PhysicalBusMissingModal.js";
import { ModuleGpioPinField } from "./ModuleGpioPinField.js";
import { SensorRecipeCard, SensorRecipeWizard } from "./SensorRecipeWizard.js";
import { useLocale } from "../../state/locale-context.js";
import { CoreSelector } from "../catalog-topology/CoreSelector.js";
import {
  PROCESSING_BLOCK_MIME,
  decodePaletteDrag,
  nextSpawnPosition,
  nodeDataFromCatalogEntry,
  peekPaletteDragBaySide,
  peekPaletteDragChainable,
  peekPaletteDragKind,
  snapToGrid,
} from "./catalog-to-node.js";
import { catalogEntryForNode } from "./catalog-entry-for-node.js";
import { positionForBayDrop } from "./bay-layout.js";
import {
  isIncompatibleDemoEdge,
  isValidDemoProcessingConnection,
  isValidProcessingConnection,
} from "./connection-rules.js";
import { PROCESSING_EDGE_TYPES } from "./DeletableEdge.js";
import { NodeInspector, type ProcessingInspectorMode } from "./NodeInspector.js";
import { DemoInspectorBubble } from "./DemoInspectorBubble.js";
import {
  DEMO_BACKBONE_FRAME_ID,
  DEMO_BACKBONE_NODE_TYPES,
} from "./DemoBackboneFrame.js";
import {
  EVENT_CONTAINER_NODE_TYPES,
  type EventContainerNodeData,
} from "./EventContainerNode.js";
import {
  canBeNested,
  canChainIntoEventContainer,
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
import {
  activeActuatorsAt,
  activeTriggersAt,
  buildDryRunPreviewChannels,
  isBackboneSensorBlock,
  isCompareIf,
  isDigitalCommandSource,
  isFlowStartBlock,
  isLedBlock,
  isRelayBlock,
  isTemperatureSensor,
  ledIntensitiesAt,
  numberFromProperty,
  previewParticipantIds,
  rgbVisualsAt,
} from "./dry-run-preview.js";
import {
  NODE_HEIGHT,
  NODE_PADDING,
  NODE_WIDTH,
  ENTRY_FEED_INSET,
  EVENT_CONTAINER_HEADER_HEIGHT,
  FLOW_START_SIZE,
  fixedTickAbsolute,
  fixedTickRelativePosition,
} from "./layout-constants.js";
import {
  containerAtPosition,
  resolveRectOverlap,
  resolveSiblingOverlap,
  type SizedRect,
} from "./node-overlap.js";
import { ProcessingBlockPalette } from "./ProcessingBlockPalette.js";
import { PROCESSING_NODE_TYPES } from "./ProcessingNode.js";
import { toProcessingNodes, type ProcessingNodeUiData } from "./to-nodes.js";

/** The member with no outgoing edge to another non-trigger member — where a chained-in block attaches next. Nested event-sources have their own chain. */
function chainTailId(
  container: EventContainer,
  edges: GraphState<"device-processing">["edges"],
  triggerIds: ReadonlySet<string>,
): string {
  const members = container.memberIds.filter((id) => !triggerIds.has(id));
  for (const id of members) {
    const hasDownstreamMember = edges.some(
      (e) => e.source === id && members.includes(e.target),
    );
    if (!hasDownstreamMember) return id;
  }
  return container.triggerId;
}

const TEMP_PROBE_EXTRA_H = 36;

function layoutSizeForUiNode(node: Node<ProcessingNodeUiData>): {
  w: number;
  h: number;
} {
  if (node.data.circular) return { w: FLOW_START_SIZE, h: FLOW_START_SIZE };
  return {
    w: node.measured?.width ?? node.data.cardWidth ?? NODE_WIDTH,
    h: node.measured?.height ??
      (node.data.cardHeight ?? NODE_HEIGHT) +
      (node.data.tempProbe ? TEMP_PROBE_EXTRA_H : 0),
  };
}

function demoSpawnPosition(entryId: (typeof DEMO_ADD_BLOCK_IDS)[number]): {
  x: number;
  y: number;
} {
  if (entryId === "appblocks.compare_if") return { x: 300, y: 36 };
  if (entryId === "appblocks.relay") return { x: 420, y: 260 };
  return { x: 20, y: 280 };
}

const NODE_TYPES = {
  ...PROCESSING_NODE_TYPES,
  ...EVENT_CONTAINER_NODE_TYPES,
  ...DEMO_BACKBONE_NODE_TYPES,
};

const EMPTY_GRAPH: GraphState<"device-processing"> = {
  layer: "device-processing",
  nodes: [],
  edges: [],
};
const EMPTY_PHYSICAL_GRAPH: GraphState<"physical-composition"> = {
  layer: "physical-composition",
  nodes: [],
  edges: [],
};
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
  const { session, revision, deployOpen, execute, navigate, requestDeploy, canvasFocus } = useSession();
  const {
    rows,
    getClient,
    getSnapshot,
    onRecordEvent,
    getExecutionMode,
    setExecutionMode,
    observeConfig,
    lockTransport,
    unlockTransport,
  } = useCoreSessions();
  const { pausePolling, resumePolling, waitUntilIdle } = useNfcPresence();
  const { locale } = useLocale();
  const copy = processingGraphCopy(locale);
  const demoOnly = isDemoOnlyEnabled();
  const demoAutoStarted = useRef(false);
  const createdDriverToken = useRef<string | null>(null);
  const {
    configuredPorts,
    pinMapOf,
    protocolFor,
    selectedBindingId,
    setSelectedBindingId,
  } = usePortProtocol();
  const bindings = session?.stack.current.coreBindings ?? [];

  const selected: CoreBindingRecord | null =
    bindings.find((b) => b.bindingId === selectedBindingId) ?? bindings[0] ?? null;
  const bindingIndex = selected
    ? bindings.findIndex((b) => b.bindingId === selected.bindingId)
    : -1;

  const [whiteLedEditor, setWhiteLedEditor] = useState<string | null>(null);
  const [inspector, setInspector] = useState<ProcessingInspectorMode | null>(null);
  const [sensorWizardOpen, setSensorWizardOpen] = useState(false);
  const [sensorWizardInitialStep] = useState<"name" | "manual">("name");
  const [sensorDetail, setSensorDetail] = useState<BackboneSensorModule | null>(null);
  const [missingBus, setMissingBus] = useState<SensorBus | null>(null);
  const [dryRun, setDryRun] = useState<DryRunResult | null>(null);
  const [running, setRunning] = useState(false);
  const [pausing, setPausing] = useState(false);
  const [pauseError, setPauseError] = useState<string | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [previewActiveIds, setPreviewActiveIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [previewElapsedMs, setPreviewElapsedMs] = useState(0);
  const [previewLedIntensity, setPreviewLedIntensity] = useState<
    ReadonlyMap<string, number>
  >(() => new Map());
  const [previewRgbVisual, setPreviewRgbVisual] = useState<
    ReadonlyMap<string, { readonly color: string; readonly intensity: number }>
  >(() => new Map());
  const [previewTriggerIds, setPreviewTriggerIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [previewActuatorIds, setPreviewActuatorIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [hashHex, setHashHex] = useState<string | null>(null);
  const [rf, setRf] = useState<ReactFlowInstance<Node<ProcessingNodeUiData>> | null>(
    null,
  );
  const savedViewport = session && selected
    ? savedCanvasViewport(session.stack, selected.bindingId)
    : undefined;
  useEffect(() => {
    if (!rf || !session || !selected) return;
    const project = session.stack;
    const bindingId = selected.bindingId;
    return () => saveCanvasViewport(project, bindingId, rf.getViewport());
  }, [rf, session?.stack, selected?.bindingId]);
  const [dropPreview, setDropPreview] = useState<{ x: number; y: number } | null>(null);
  const [overlapWarning, setOverlapWarning] = useState<string | null>(null);
  const [containerHint, setContainerHint] = useState<{
    readonly triggerId: string;
    readonly kind: "rejecting" | "accepting";
    readonly previewPosition?: { readonly x: number; readonly y: number };
    readonly previewWidth?: number;
    readonly previewHeight?: number;
  } | null>(null);
  const previewStartedAtRef = useRef(0);
  const persistTempTestRef = useRef<(nodeId: string, celsius: number) => void>(
    () => {},
  );

  useEffect(() => {
    if (!overlapWarning) return;
    const timer = setTimeout(() => setOverlapWarning(null), 4000);
    return () => clearTimeout(timer);
  }, [overlapWarning]);

  const stopPreview = useCallback(() => {
    setSimulating(false);
    setPreviewActiveIds(new Set());
    setPreviewTriggerIds(new Set());
    setPreviewActuatorIds(new Set());
    setPreviewLedIntensity(new Map());
    setPreviewRgbVisual(new Map());
    setPreviewElapsedMs(0);
  }, []);

  const graphState: GraphState<"device-processing"> =
    (bindingIndex >= 0
      ? session?.stack.current.deviceGraphs[bindingIndex]
      : undefined) ?? EMPTY_GRAPH;
  const focusedDeployRequest = useRef(0);
  useEffect(() => {
    if (!canvasFocus || !rf || canvasFocus.request === focusedDeployRequest.current)
      return;
    if (selected?.bindingId !== canvasFocus.bindingId) {
      const binding = bindings.find((item) => item.bindingId === canvasFocus.bindingId);
      if (binding) setSelectedBindingId(binding.bindingId);
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (
        canvasFocus.nodeId &&
        graphState.nodes.some((node) => node.id === canvasFocus.nodeId)
      ) {
        rf.updateNode(canvasFocus.nodeId, { selected: true });
        void rf.fitView({
          nodes: [{ id: canvasFocus.nodeId }],
          padding: 0.7,
          maxZoom: 1.3,
          duration: 250,
        });
      } else void rf.fitView({ padding: 0.2, maxZoom: 0.8, duration: 250 });
      focusedDeployRequest.current = canvasFocus.request;
    });
    return () => cancelAnimationFrame(frame);
  }, [
    canvasFocus,
    rf,
    selected?.bindingId,
    setSelectedBindingId,
    graphState,
    bindings,
  ]);
  const physicalGraphState: GraphState<"physical-composition"> =
    (bindingIndex >= 0
      ? session?.stack.current.physicalGraphs[bindingIndex]
      : undefined) ?? EMPTY_PHYSICAL_GRAPH;
  const graphStateRef = useRef(graphState);
  useEffect(() => {
    graphStateRef.current = graphState;
  }, [graphState]);
  const previewChannelsForRender = useMemo(
    () => (simulating ? buildDryRunPreviewChannels(graphState) : []),
    [simulating, graphState],
  );

  useEffect(() => {
    if (!simulating) return;
    const tick = () => {
      // Rebuild from the live graph so Inspector period edits apply immediately
      // without stopping and re-running Dry-run.
      const channels = buildDryRunPreviewChannels(graphStateRef.current);
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

  const domainNodes = graphState.nodes as readonly GraphNode<
    "device-processing",
    string,
    DeviceProcessingNodeData
  >[];
  const moduleNodes = physicalGraphState.nodes as readonly GraphNode<
    "physical-composition",
    string,
    PhysicalCompositionNodeData
  >[];
  const projectAuthoringMetadata = session?.stack.current.authoringMetadata;
  const authoringMetadata = useMemo(
    () => projectAuthoringMetadata ?? {},
    [projectAuthoringMetadata],
  );
  const sensorModulesProject = useMemo(
    () =>
      parseBackboneSensorModules(
        authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment,
      ),
    [authoringMetadata],
  );
  const backboneSensorModules = useMemo(
    () => modulesForBinding(sensorModulesProject, selected?.bindingId),
    [sensorModulesProject, selected?.bindingId],
  );
  const physicalProject = useMemo(
    () => parsePhysicalProject(authoringMetadata[PHYSICAL_META_KEY]?.comment),
    [authoringMetadata],
  );
  const physicalModes = useMemo(
    () => draftModesForBinding(physicalProject, selected?.bindingId),
    [physicalProject, selected?.bindingId],
  );

  const persistSensorModules = useCallback(
    (next: ReturnType<typeof parseBackboneSensorModules>) => {
      if (!execute) return;
      execute({
        kind: "SaveBackboneSensorModules",
        apply: (project) => ({
          ok: true,
          value: {
            ...project,
            authoringMetadata: {
              ...project.authoringMetadata,
              [BACKBONE_SENSOR_MODULES_META_KEY]: { comment: JSON.stringify(next) },
            },
          },
        }),
      });
    },
    [execute],
  );

  /** Creates the fixed violet tick disc for a Schedule and wires Schedule → tick. */
  function spawnScheduleTick(
    scheduleId: string,
    schedulePosition: { readonly x: number; readonly y: number },
  ) {
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
    execute(
      addGraphNodeCommand(lens, {
        layer: "device-processing",
        id: tickId,
        data: startData,
      }),
    );
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

  function placeFromCatalog(
    entry: ProcessingCatalogEntry,
    requestedPosition = nextSpawnPosition(domainNodes.length),
    baySide = peekPaletteDragBaySide(),
    physicalPinId?: string,
    overrides?: {
      readonly comment?: string;
      readonly properties?: Readonly<
        Record<string, string | number | boolean | bigint>
      >;
    },
  ): string | undefined {
    if (!execute || bindingIndex < 0) return undefined;
    // Tick discs are spawned with each Schedule — never from the palette.
    if (entry.id === "native.flow_start" || entry.typeId === "ab.flow_start")
      return undefined;
    let data = nodeDataFromCatalogEntry(entry, moduleOptions[0]?.id, baySide);
    if (!data) return undefined;
    if (physicalPinId) {
      const pin = physicalPinsForBinding(
        session?.stack.current,
        selected?.bindingId,
      ).find(
        (item) => item.id === physicalPinId && item.local && item.entryId === entry.id,
      );
      if (!pin) return undefined;
      if (data.kind === "event-source")
        data = {
          ...data,
          moduleNodeId: pin.moduleNodeId,
          properties: { ...data.properties, physicalPinId },
        };
      else if (data.kind === "block")
        data = {
          ...data,
          properties: {
            ...data.properties,
            "1": BigInt(pin.backendPortId),
            "2": BigInt(pin.channel),
            physicalPinId,
          },
        };
    }
    if (overrides?.properties && data.kind === "block") {
      data = { ...data, properties: { ...data.properties, ...overrides.properties } };
    }

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
      position = positionForBayDrop(
        resolvedBaySide,
        requestedPosition,
        eventContainers,
      );
    } else if (canChainIntoEventContainer(data)) {
      const target = containerAtPosition(position, eventContainers);
      if (target) {
        attachEdgeCommand = addGraphEdgeCommand(deviceGraphLens(bindingIndex), {
          id: `dpe-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
          source:
            data.kind === "block" && data.blockTypeId === "ui.manual_trigger"
              ? target.triggerId
              : chainTailId(
                  target,
                  graphState.edges,
                  new Set(containerByTriggerId.keys()),
                ),
          target: id,
          sourceHandle: "0",
          targetHandle: "0",
        });
        setOverlapWarning(copy.connectedTo(target.label));
        attachLowerBound = {
          x: target.x + NODE_PADDING,
          y: target.y + NODE_PADDING + EVENT_CONTAINER_HEADER_HEIGHT,
        };
        position = {
          x: Math.max(position.x, attachLowerBound.x),
          y: Math.max(position.y, attachLowerBound.y),
        };
      }
    } else if (isNestableContainer(data.kind)) {
      const target = canBeNested(data.kind)
        ? containerAtPosition(position, eventContainers)
        : undefined;
      if (target) {
        attachEdgeCommand = addGraphEdgeCommand(deviceGraphLens(bindingIndex), {
          id: `dpe-${Date.now()}-${Math.round(Math.random() * 1e6)}`,
          source: target.triggerId,
          target: id,
          sourceHandle: "0",
          targetHandle: "0",
        });
        setOverlapWarning(copy.insertedInto(target.label));
        attachLowerBound = {
          x: target.x + NODE_PADDING,
          y: target.y + NODE_PADDING + EVENT_CONTAINER_HEADER_HEIGHT,
        };
        position = {
          x: Math.max(position.x, attachLowerBound.x),
          y: Math.max(position.y, attachLowerBound.y),
        };
      } else if (
        data.kind === "schedule" &&
        containerAtPosition(position, eventContainers)
      ) {
        setOverlapWarning(copy.scheduleInsideSchedule);
      }
      const size = emptyEventContainerSize();
      const origin = triggerToContainerOrigin(position);
      const extra = new Set(target ? [target.triggerId] : []);
      const resolved = resolveRectOverlap(
        "",
        origin,
        { w: size.width, h: size.height },
        overlapObstaclesFor("", extra),
      );
      position = containerOriginToTrigger(resolved);
      if (attachLowerBound)
        position = {
          x: Math.max(position.x, attachLowerBound.x),
          y: Math.max(position.y, attachLowerBound.y),
        };
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
    execute(
      addGraphNodeCommand(deviceGraphLens(bindingIndex), {
        layer: "device-processing",
        id,
        data,
      }),
    );
    if (attachEdgeCommand) execute(attachEdgeCommand);
    const comment =
      overrides?.comment ??
      (demoOnly || !bay || !resolvedBaySide
        ? localizeCatalogEntry(entry, locale).label
        : `${localizeCatalogEntry(entry, locale).label} · ${localizedBaySideLabel(resolvedBaySide, locale)}`);
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
    return id;
  }

  function placeSensorRecipeOnCanvas(
    recipe: SensorRecipe,
    position?: { readonly x: number; readonly y: number },
  ): boolean {
    if (!selected) return false;
    if (!recipe.driverInstanceId && !modesProvideBus(physicalModes, recipe.bus)) {
      setSensorWizardOpen(false);
      setMissingBus(recipe.bus);
      return false;
    }
    let module =
      backboneSensorModules.find(
        (m) =>
          recipe.driverInstanceId &&
          m.recipe.driverInstanceId === recipe.driverInstanceId,
      ) ?? createModuleFromRecipe(recipe);
    const entry = findCatalogEntryById(BACKBONE_SENSOR_BLOCK_CATALOG_ID);
    if (entry && (recipeChannels(recipe).length > 0 || recipe.actionId)) {
      const graphNodeId = placeFromCatalog(
        entry,
        position ?? nextSpawnPosition(domainNodes.length),
        "input",
        undefined,
        {
          comment: recipe.deviceDraft?.name ?? recipe.chip,
          properties: propertiesForSensorModule(module, recipe),
        },
      );
      if (graphNodeId)
        module = {
          ...module,
          graphNodeId: module.graphNodeId ?? graphNodeId,
          graphNodeIds: [
            ...(module.graphNodeIds ??
              (module.graphNodeId ? [module.graphNodeId] : [])),
            graphNodeId,
          ],
        };
    }
    persistSensorModules(
      upsertModule(sensorModulesProject, selected.bindingId, module),
    );
    return true;
  }

  function handleSensorRecipeConfirm(recipe: SensorRecipe): boolean {
    return placeSensorRecipeOnCanvas(recipe);
  }

  useEffect(() => {
    if (!execute || !selected) return;
    const pending =
      authoringMetadata[DEVICE_RECIPE_PENDING_CREATE_META_KEY]?.comment === "1";
    if (!pending) return;
    const draft = parseDeviceRecipeDraft(
      authoringMetadata[DEVICE_RECIPE_DRAFT_META_KEY]?.comment,
    );
    if (!draft) return;
    const recipes = draftToCanvasSensorRecipes(draft);
    const base = nextSpawnPosition(domainNodes.length);
    const entry = findCatalogEntryById(BACKBONE_SENSOR_BLOCK_CATALOG_ID);
    if (!entry || !recipes[0]) return;
    const token = `${selected.bindingId}:${draft.id}:${draft.updatedAt}`;
    if (createdDriverToken.current === token) return;
    createdDriverToken.current = token;
    const existing = backboneSensorModules.find(
      (m) => m.recipe.driverInstanceId === draft.id,
    );
    let module = existing ?? createModuleFromRecipe(recipes[0]);
    const graphNodeIds: string[] = [];
    const changes = planDriverCanvasChanges(
      recipes,
      module.id,
      domainNodes.flatMap((node) =>
        isBlockNodeData(node.data)
          ? [{ id: node.id, properties: node.data.properties }]
          : [],
      ),
    );
    for (const nodeId of changes.removals)
      execute(removeGraphNodeCommand(deviceGraphLens(bindingIndex), nodeId));
    for (const update of changes.updates) {
      const node = domainNodes.find((n) => n.id === update.id);
      if (!node || !isBlockNodeData(node.data)) continue;
      execute(
        updateGraphNodeCommand(deviceGraphLens(bindingIndex), {
          layer: "device-processing",
          id: node.id,
          data: {
            ...node.data,
            properties: {
              ...node.data.properties,
              ...propertiesForSensorModule(
                module,
                update.recipe,
                node.data.properties[SENSOR_INSTANCE_PROP] === true
                  ? {
                      inputId: String(node.data.properties[SENSOR_INPUT_PROP] ?? ""),
                      outputId: String(node.data.properties[SENSOR_OUTPUT_PROP] ?? ""),
                    }
                  : undefined,
              ),
            },
          },
        }),
      );
      const selectedProperties = propertiesForSensorModule(
        module,
        update.recipe,
        node.data.properties[SENSOR_INSTANCE_PROP] === true
          ? {
              inputId: String(node.data.properties[SENSOR_INPUT_PROP] ?? ""),
              outputId: String(node.data.properties[SENSOR_OUTPUT_PROP] ?? ""),
            }
          : undefined,
      );
      for (const edge of selectedProperties[SENSOR_INSTANCE_PROP] === true
        ? graphState.edges
        : []) {
        if (
          (edge.target === node.id &&
            edge.targetHandle !== selectedProperties[SENSOR_INPUT_PROP]) ||
          (edge.source === node.id &&
            edge.sourceHandle !== selectedProperties[SENSOR_OUTPUT_PROP])
        )
          execute(removeGraphEdgeCommand(deviceGraphLens(bindingIndex), edge.id));
      }
      graphNodeIds.push(node.id);
      const oldRecipe = existing?.actions?.find(
        (r) => r.actionId === update.recipe.actionId,
      );
      if (authoringMetadata[node.id]?.comment === oldRecipe?.chip) {
        execute({
          kind: "RenameDriverActionBlock",
          apply: (project) => ({
            ok: true,
            value: {
              ...project,
              authoringMetadata: {
                ...project.authoringMetadata,
                [node.id]: {
                  ...project.authoringMetadata[node.id],
                  comment: update.recipe.deviceDraft?.name ?? update.recipe.chip,
                },
              },
            },
          }),
        });
      }
    }
    changes.additions.forEach((recipe, index) => {
      const nodeId = placeFromCatalog(
        entry,
        {
          x: base.x + (index % 3) * 240,
          y: base.y + Math.floor(index / 3) * 180,
        },
        "input",
        undefined,
        {
          comment: recipe.deviceDraft?.name ?? recipe.chip,
          properties: propertiesForSensorModule(module, recipe),
        },
      );
      if (nodeId) graphNodeIds.push(nodeId);
    });
    module = {
      ...module,
      recipe: recipes[0],
      recipeId: recipes[0].id,
      label: draft.name,
      actions: recipes,
      graphNodeId: graphNodeIds[0],
      graphNodeIds,
    };
    persistSensorModules(
      upsertModule(sensorModulesProject, selected.bindingId, module),
    );
    execute({
      kind: "ClearDeviceRecipePendingCreate",
      apply: (project) => ({
        ok: true,
        value: {
          ...project,
          authoringMetadata: {
            ...project.authoringMetadata,
            [DEVICE_RECIPE_PENDING_CREATE_META_KEY]: { comment: "" },
          },
        },
      }),
    });
    // Intentionally run once when landing with a pending create flag.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- place once from metadata handoff
  }, [
    authoringMetadata[DEVICE_RECIPE_PENDING_CREATE_META_KEY]?.comment,
    selected?.bindingId,
    execute,
  ]);

  function recipeForActionNode(
    data: DeviceProcessingNodeData,
  ): SensorRecipe | undefined {
    if (!isBlockNodeData(data)) return undefined;
    const module = backboneSensorModules.find(
      (m) => m.id === data.properties[SENSOR_MODULE_ID_PROP],
    );
    return module?.actions?.find(
      (r) =>
        r.actionId === data.properties[SENSOR_ACTION_ID_PROP] &&
        ["i2c", "gpio"].includes(r.deviceDraft?.binding.bus ?? ""),
    );
  }

  function handleSensorModuleRemove(moduleId: string) {
    if (!selected) return;
    const existing = modulesForBinding(sensorModulesProject, selected.bindingId).find(
      (item) => item.id === moduleId,
    );
    if (execute && bindingIndex >= 0) {
      const linked = new Set(
        existing?.graphNodeIds ?? (existing?.graphNodeId ? [existing.graphNodeId] : []),
      );
      for (const node of domainNodes) {
        if (
          linked.has(node.id) ||
          (isBlockNodeData(node.data) &&
            node.data.properties[SENSOR_MODULE_ID_PROP] === moduleId)
        ) {
          execute(removeGraphNodeCommand(deviceGraphLens(bindingIndex), node.id));
        }
      }
    }
    persistSensorModules(
      removeModule(sensorModulesProject, selected.bindingId, moduleId),
    );
    if (sensorDetail?.id === moduleId) setSensorDetail(null);
  }

  function handleSensorRecipeEdit(next: SensorRecipe) {
    if (!selected || !sensorDetail) return;
    const updated: BackboneSensorModule = {
      ...sensorDetail,
      recipe: next,
      recipeId: next.id,
      bus: next.bus,
      label: next.chip,
    };
    setSensorDetail(updated);
    persistSensorModules(
      upsertModule(sensorModulesProject, selected.bindingId, updated),
    );
    const nodeId =
      updated.graphNodeId ??
      domainNodes.find(
        (node) =>
          isBlockNodeData(node.data) &&
          node.data.properties[SENSOR_MODULE_ID_PROP] === updated.id,
      )?.id;
    if (nodeId && execute && bindingIndex >= 0) {
      const domainNode = domainNodes.find((node) => node.id === nodeId);
      if (domainNode && isBlockNodeData(domainNode.data)) {
        const data: DeviceProcessingNodeData = {
          ...domainNode.data,
          properties: {
            ...domainNode.data.properties,
            ...propertiesForSensorModule(updated, next),
          },
        };
        execute(
          updateGraphNodeCommand(deviceGraphLens(bindingIndex), {
            layer: "device-processing",
            id: nodeId,
            data,
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
                [nodeId]: { ...project.authoringMetadata[nodeId], comment: next.chip },
              },
            },
          }),
        });
      }
    }
  }

  function findExistingStatusLedNodeId(): string | undefined {
    for (const node of domainNodes) {
      if (!isBlockNodeData(node.data) || !isLedBlock(node.data)) continue;
      const props = node.data.properties;
      if (
        props.statusLed === true ||
        props.statusLed === "true" ||
        props.statusLed === 1 ||
        props.statusLed === 1n
      ) {
        return node.id;
      }
      const comment = authoringMetadata[node.id]?.comment ?? "";
      if (comment.includes(STATUS_LED_LABEL) || comment.includes("STATUS LED"))
        return node.id;
    }
    return undefined;
  }

  function handleUseStatusLed() {
    const existingId = findExistingStatusLedNodeId();
    if (existingId) {
      const existing = domainNodes.find((node) => node.id === existingId);
      if (existing) {
        setInspector(null);
        setWhiteLedEditor(existingId);
        return;
      }
      return;
    }
    const entry = findCatalogEntryById("appblocks.led");
    if (!entry) return;
    placeFromCatalog(
      entry,
      nextSpawnPosition(domainNodes.length),
      "output",
      undefined,
      {
        comment: STATUS_LED_LABEL,
        properties: {
          statusLed: true,
          gpio: STATUS_LED_GPIO,
          color: "#FFFFFF",
          threshold: 1,
          negated: false,
          line: "STATUS",
        },
      },
    );
  }

  useEffect(() => {
    if (!demoOnly || !rf) return;
    const fit = () => {
      void rf.fitView({ padding: 0.22, duration: 180, minZoom: 0.18, maxZoom: 1.15 });
    };
    const raf = window.requestAnimationFrame(() => window.requestAnimationFrame(fit));
    window.addEventListener("resize", fit);
    window.addEventListener("orientationchange", fit);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("resize", fit);
      window.removeEventListener("orientationchange", fit);
    };
  }, [demoOnly, rf, domainNodes.length]);

  const moduleOptions = useMemo(() => {
    const fromModules = moduleNodes
      .filter((n) => isModuleNodeData(n.data))
      .map((n) => ({
        id: n.id,
        label:
          authoringMetadata[n.id]?.comment &&
          authoringMetadata[n.id]!.comment!.trim() !== ""
            ? authoringMetadata[n.id]!.comment!
            : n.id,
        portId: isModuleNodeData(n.data) ? n.data.portId : undefined,
      }));
    const takenPorts = new Set(
      fromModules.map((m) => m.portId).filter((id): id is number => id !== undefined),
    );
    const fromPorts = configuredPorts
      .filter(
        (port) =>
          !takenPorts.has(port.portId) &&
          port.pins.some((pin) => pin.peripheral !== "unused"),
      )
      .map((port) => ({
        id: portCardId(port.portId),
        label: `Porta ${port.portId}`,
        portId: port.portId,
      }));
    return [...fromModules, ...fromPorts];
  }, [moduleNodes, authoringMetadata, configuredPorts]);
  const knownModuleNodeIds = useMemo(
    () => new Set(moduleOptions.map((m) => m.id)),
    [moduleOptions],
  );
  const moduleLabel = useCallback(
    (moduleNodeId: string) =>
      moduleOptions.find((m) => m.id === moduleNodeId)?.label ?? moduleNodeId,
    [moduleOptions],
  );
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
    if (dryRun)
      for (const issue of dryRun.issues)
        for (const segment of issue.path) map.set(segment, issue.remediation);
    return map;
  }, [dryRun]);
  const errorCount = dryRun?.issues.filter((i) => i.severity !== "warning").length ?? 0;
  const warningCount =
    dryRun?.issues.filter((i) => i.severity === "warning").length ?? 0;

  const viewerPlan = useMemo(() => {
    if (!session || !selected) return { observations: [] };
    try {
      return prepareDriverDeployment(session.stack.current, selected.bindingId, {
        physicalGraph: physicalGraphState,
        processingGraph: graphState,
        mqtt: DISABLED_MQTT,
        connectivity: 0,
        energy: DEFAULT_ENERGY,
      });
    } catch (error) {
      return {
        observations: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [
    session?.stack.current,
    selected?.bindingId,
    graphState,
    physicalGraphState,
    domainNodes,
  ]);
  const [wirePulses, setWirePulses] = useState<
    ReadonlyMap<string, { token: number; kind: "trigger" | "data" }>
  >(new Map());
  const wireToken = useRef(0);
  useEffect(() => {
    setWirePulses(new Map());
    if (!selected || !("activityRoutes" in viewerPlan)) return;
    const routes = viewerPlan.activityRoutes ?? [];
    const seen = new Map<string, number>();
    const gpioLevels = new Map<string, string>();
    const planner = new SignalWavePlanner(graphState.edges);
    const pending = new Map<string, (typeof routes)[number]>();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let batchTimer: ReturnType<typeof setTimeout> | undefined;
    function later(callback: () => void, delay: number) {
      const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay);
      timers.add(timer);
    }
    function flush() {
      batchTimer = undefined;
      const wave = planner.plan([...pending.values()], performance.now());
      pending.clear();
      for (const { route, delay } of wave) later(() => {
        const pulse = { token: ++wireToken.current, kind: route.kind };
        setWirePulses(previous => new Map(previous).set(route.edgeId, pulse));
        later(() => setWirePulses(previous => {
          if (previous.get(route.edgeId)?.token !== pulse.token) return previous;
          const next = new Map(previous); next.delete(route.edgeId); return next;
        }), SIGNAL_ACTIVITY_MS);
      }, delay);
    }
    const unsubscribe = onRecordEvent(selected.bindingId, (record) => {
      const key = `${record.sourceKey}:${record.schemaId}:${record.actionId ?? 0}`;
      if (seen.get(key) === record.sequence) return;
      seen.set(key, record.sequence);
      if (record.schemaId.startsWith("flow.gpio-state.")) {
        const level = Object.entries(record.fields ?? {}).map(([field, value]) => `${field}:${String(value)}`).join(";");
        if (gpioLevels.get(key) === level) return;
        gpioLevels.set(key, level);
      }
      const active = activeEdgesForRecord(routes, record);
      if (!active.length) return;
      for (const route of active) pending.set(route.edgeId, route);
      // A short collection window also orders packets delivered in the same burst.
      if (!batchTimer) batchTimer = setTimeout(flush, 35);
    });
    return () => {
      unsubscribe?.();
      clearTimeout(batchTimer);
      for (const timer of timers) clearTimeout(timer);
    };
  }, [selected?.bindingId, viewerPlan, graphState.edges, onRecordEvent]);

  const domainRfNodes = useMemo(
    () =>
      toProcessingNodes(
        graphState,
        authoringMetadata,
        new Set(errorsByNode.keys()),
        moduleLabel,
        fieldLabel,
        new Set(),
        locale,
      ).map((node) =>
        node.data.signalGenerator
          ? { ...node, data: { ...node.data, signalGenerator: { ...node.data.signalGenerator, bindingId: selected?.bindingId,
              source: "signalObservations" in viewerPlan ? viewerPlan.signalObservations?.find(item => item.generatorId === node.id) : undefined } } }
          : node.data.manualTrigger
          ? {
              ...node,
              data: {
                ...node.data,
                manualTrigger: {
                  ...node.data.manualTrigger,
                  bindingId: selected?.bindingId,
                },
              },
            }
          : node.data.dataViewer
            ? {
                ...node,
                data: {
                  ...node.data,
                  dataViewer: {
                    ...node.data.dataViewer,
                    bindingId: selected?.bindingId,
                    source: viewerPlan.observations?.find(
                      (item) => item.viewerId === node.id,
                    ),
                    error: "error" in viewerPlan ? viewerPlan.error : undefined,
                  },
                },
              }
            : node,
      ),
    [
      graphState,
      authoringMetadata,
      errorsByNode,
      moduleLabel,
      fieldLabel,
      locale,
      selected?.bindingId,
      viewerPlan,
    ],
  );
  // "deletable" (DeletableEdge.tsx) routes around other blocks on H/V
  // segments with rounded corners, plus a hover trash control.
  const edges = useMemo<Edge[]>(() => {
    const ctx = { nodes: domainNodes, edges: graphState.edges };
    return toReactFlowEdges(graphState).map((edge) => {
      const invalid = demoOnly && isIncompatibleDemoEdge(edge, ctx);
      const signalType = wireSignalType(domainNodes.find(node => node.id === edge.source)?.data, edge.sourceHandle);
      return {
        ...edge,
        type: "deletable",
        data: { invalid, signalType },
        style: invalid
          ? { stroke: "var(--color-error)", strokeWidth: 2, strokeDasharray: "6 4" }
          : undefined,
      };
    });
  }, [graphState, demoOnly, domainNodes]);
  const processingNodeLabel = useCallback(
    (id: string) => domainRfNodes.find((n) => n.id === id)?.data.label ?? id,
    [domainRfNodes],
  );

  const resolveCatalogEntry = useCallback(
    (nodeId: string) => {
      const node = domainNodes.find((n) => n.id === nodeId);
      return node ? catalogEntryForNode(node.data) : undefined;
    },
    [domainNodes],
  );

  const isValidConnection = useCallback(
    (
      connection:
        | Connection
        | {
            source?: string | null;
            target?: string | null;
            sourceHandle?: string | null;
            targetHandle?: string | null;
          },
    ) => {
      if (!isValidProcessingConnection(connection, resolveCatalogEntry)) return false;
      if (!demoOnly) return true;
      return isValidDemoProcessingConnection(connection, {
        nodes: domainNodes,
        edges: graphState.edges,
      });
    },
    [resolveCatalogEntry, demoOnly, domainNodes, graphState.edges],
  );

  const [localNodes, setLocalNodes] =
    useState<Node<ProcessingNodeUiData>[]>(domainRfNodes);
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
  const livePositions = useMemo(
    () => new Map(localNodes.map((n) => [n.id, n.position])),
    [localNodes],
  );
  const memberSizes = useMemo(
    () => new Map(localNodes.filter((n) => !n.data.circular).map((n) => [n.id, layoutSizeForUiNode(n)])),
    [localNodes],
  );
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
        memberSizes,
      ),
    [graphState, authoringMetadata, livePositions, containerHint, memberSizes],
  );
  const containerByTriggerId = useMemo(
    () => new Map(eventContainers.map((c) => [c.triggerId, c])),
    [eventContainers],
  );
  const containerByMemberId = useMemo(() => {
    const map = new Map<string, (typeof eventContainers)[number]>();
    for (const container of eventContainers)
      for (const memberId of container.memberIds) map.set(memberId, container);
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
  const containerNodes = useMemo<Node<EventContainerNodeData>[]>(() => {
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
        const parent = container.parentTriggerId
          ? containerByTriggerId.get(container.parentTriggerId)
          : undefined;
        const kind = triggerData?.kind === "schedule" ? "schedule" : "event-source";
        const handleY = 16;
        // Schedule wires to the tick are domain-only (hidden) — no canvas handles.
        const handles =
          kind === "event-source"
            ? [
                {
                  id: "0",
                  type: "target" as const,
                  position: Position.Left,
                  x: -5,
                  y: handleY,
                  width: 10,
                  height: 14,
                },
                {
                  id: "0",
                  type: "source" as const,
                  position: Position.Right,
                  x: container.width - 14,
                  y: handleY,
                  width: 14,
                  height: 14,
                },
              ]
            : [];
        return {
          id: container.triggerId,
          type: "event-container",
          parentId: parent?.triggerId,
          position: parent
            ? { x: container.x - parent.x, y: container.y - parent.y }
            : { x: container.x, y: container.y },
          width: container.width,
          height: container.height,
          style: {
            width: container.width,
            height: container.height,
            overflow: "visible",
          },
          handles,
          draggable: true,
          selectable: true,
          connectable: kind === "event-source",
          focusable: true,
          zIndex: parent ? 0 : -1,
          data: {
            label: container.label,
            kind,
            roleLabel: demoOnly && kind === "schedule" ? "Firmware" : undefined,
            periodMs: container.periodMs,
            rejecting:
              containerHint?.kind === "rejecting" &&
              containerHint.triggerId === container.triggerId,
            accepting:
              containerHint?.kind === "accepting" &&
              containerHint.triggerId === container.triggerId,
            previewActive: previewTriggerIds.has(container.triggerId),
            enabled: triggerData?.kind === "schedule" ? triggerData.enabled : true,
            empty: !container.memberIds.some((id) =>
              localNodes.some((node) => node.id === id && !node.data.circular),
            ),
          },
        };
      });
  }, [
    demoOnly,
    eventContainers,
    domainNodes,
    containerHint,
    containerByTriggerId,
    previewTriggerIds,
    localNodes,
    graphState.edges,
  ]);
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
    for (const channel of previewChannelsForRender) {
      for (const toggleId of channel.toggleIds)
        periodByToggleId.set(toggleId, channel.periodMs);
    }
    const tickRel = fixedTickRelativePosition();
    const rest = localNodes
      .filter((n) => {
        if (containerByTriggerId.has(n.id)) return false;
        // Internal activation nodes remain in the model, not on the canvas.
        return !n.data.circular;
      })
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
          position: isTick
            ? { x: tickRel.x, y: tickRel.y }
            : { x: n.position.x - container.x, y: n.position.y - container.y },
        };
      })
      .map((n) => {
        if (!demoOnly) return n;
        const domain = domainNodes.find((node) => node.id === n.id)?.data;
        if (!domain) return n;
        if (isLedBlock(domain)) {
          return { ...n, data: { ...n.data, subtitle: "Hardware module" } };
        }
        if (isTemperatureSensor(domain) && isBlockNodeData(domain)) {
          const celsius = numberFromProperty(domain.properties.testC, 22);
          return {
            ...n,
            data: {
              ...n.data,
              subtitle: "Hardware module",
              tempProbe: {
                celsius,
                min: -10,
                max: 80,
                onChange: (next: number) => persistTempTestRef.current(n.id, next),
              },
            },
          };
        }
        return n;
      });
    if (!demoOnly)
      return [...containerNodes, ...rest] as unknown as Node<ProcessingNodeUiData>[];
    const led = rest.find((n) => n.id === "demo-led");
    const outputHardware = rest.filter(
      (n) => n.id === "demo-led" || n.data.tileGlyph === "power",
    );
    const temps = rest.filter((n) => n.data.tempProbe);
    const pad = NODE_PADDING;
    const header = EVENT_CONTAINER_HEADER_HEIGHT;
    const frames: Node[] = [];
    if (led && outputHardware.length > 0) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const node of outputHardware) {
        const size = layoutSizeForUiNode(node);
        minX = Math.min(minX, node.position.x);
        minY = Math.min(minY, node.position.y);
        maxX = Math.max(maxX, node.position.x + size.w);
        maxY = Math.max(maxY, node.position.y + size.h);
      }
      const frameW = maxX - minX + pad * 2;
      const frameH = maxY - minY + pad * 2 + header;
      frames.push({
        id: DEMO_BACKBONE_FRAME_ID,
        type: "demo-backbone",
        position: { x: minX - pad, y: minY - header - pad },
        width: frameW,
        height: frameH,
        style: {
          width: frameW,
          height: frameH,
          overflow: "visible",
          pointerEvents: "none",
        },
        className: "!pointer-events-none",
        draggable: false,
        selectable: false,
        focusable: false,
        zIndex: -1,
        data: { label: "Backbone", caption: "Hardware" },
      });
    }
    for (const temp of temps) {
      const size = layoutSizeForUiNode(temp);
      const frameW = size.w + pad * 2;
      const frameH = size.h + pad * 2 + header;
      frames.push({
        id: `demo-hw-${temp.id}`,
        type: "demo-backbone",
        position: { x: temp.position.x - pad, y: temp.position.y - header - pad },
        width: frameW,
        height: frameH,
        style: {
          width: frameW,
          height: frameH,
          overflow: "visible",
          pointerEvents: "none",
        },
        className: "!pointer-events-none",
        draggable: false,
        selectable: false,
        focusable: false,
        zIndex: -1,
        data: { label: "Backbone", caption: "Hardware" },
      });
    }
    return [
      ...frames,
      ...containerNodes,
      ...rest,
    ] as unknown as Node<ProcessingNodeUiData>[];
  }, [
    demoOnly,
    containerNodes,
    localNodes,
    containerByTriggerId,
    containerByMemberId,
    previewActiveIds,
    previewActuatorIds,
    previewTriggerIds,
    previewElapsedMs,
    previewChannelsForRender,
    previewLedIntensity,
    previewRgbVisual,
    domainNodes,
  ]);

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
      localEdges
        .filter((edge) => {
          if (localNodes.some(node => node.data.circular && (node.id === edge.source || node.id === edge.target))) return false;
          if (
            containerByMemberId.has(edge.target) &&
            localNodes.find((node) => node.id === edge.target)?.data.manualTrigger
          )
            return false;
          if (!containerByTriggerId.has(edge.source)) return true;
          const memberOf = containerByMemberId.get(edge.target);
          return !memberOf || memberOf.triggerId !== edge.source;
        })
        .map((edge) => {
          const live = wirePulses.get(edge.id);
          const preview =
            simulating &&
            (previewActiveIds.has(edge.source) ||
              previewTriggerIds.has(edge.source) ||
              previewTriggerIds.has(
                containerByMemberId.get(edge.source)?.triggerId ?? "",
              ));
          return {
            ...edge,
            data: { ...edge.data, signalPulse: live, previewSignal: preview },
          };
        }),
    [
      localEdges,
      localNodes,
      containerByTriggerId,
      containerByMemberId,
      wirePulses,
      simulating,
      previewActiveIds,
      previewTriggerIds,
    ],
  );

  const nodeGlows = useSignalNodeGlow(wirePulses, visibleEdges, selected?.bindingId);
  const illuminatedNodes = useMemo(() => renderedNodes.map((node) => {
    const pulse = nodeGlows.get(node.id);
    const preview = simulating && (previewActiveIds.has(node.id) || previewTriggerIds.has(node.id));
    if (!pulse && !preview) return node;
    return { ...node, className: `${node.className ?? ""} signal-node-glow signal-node-glow-${(pulse?.token ?? 0) % 2} ${pulse?.kind === "data" ? "signal-node-data" : ""}` };
  }), [renderedNodes, nodeGlows, simulating, previewActiveIds, previewTriggerIds]);

  useEffect(() => {
    if (!session || bindingIndex < 0 || !execute) return;
    if (session.stack.current.deviceGraphs.length > bindingIndex) return;
    execute({
      kind: "RepairDeviceGraphAlignment",
      apply: (project) => {
        const physicalGraphs = [...project.physicalGraphs];
        const deviceGraphs = [...project.deviceGraphs];
        while (physicalGraphs.length <= bindingIndex)
          physicalGraphs.push({ layer: "physical-composition", nodes: [], edges: [] });
        while (deviceGraphs.length <= bindingIndex)
          deviceGraphs.push({ layer: "device-processing", nodes: [], edges: [] });
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
      execute(
        addGraphNodeCommand(lens, {
          layer: "device-processing",
          id: tickId,
          data: startData,
        }),
      );
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
  }, [
    bindingIndex,
    domainNodes.map((n) => n.id).join(","),
    graphState.edges.map((e) => e.id).join(","),
  ]);

  function overlapObstaclesFor(
    draggedId: string,
    extraExclude: ReadonlySet<string> = new Set(),
  ): SizedRect[] {
    const skip = new Set(extraExclude);
    skip.add(draggedId);
    const dragged = containerByTriggerId.get(draggedId);
    if (dragged) {
      for (const id of collectDescendantMemberIds(dragged, containerByTriggerId))
        skip.add(id);
    }
    const containers = peerContainerObstacles(
      draggedId,
      eventContainers,
      containerByTriggerId,
    ).filter((o) => !skip.has(o.id));
    const cards = localNodes
      .filter((n) => !containerByTriggerId.has(n.id) && !skip.has(n.id))
      .map((n) => {
        const size = layoutSizeForUiNode(n);
        return { id: n.id, position: n.position, w: size.w, h: size.h };
      });
    return [...containers, ...cards];
  }

  function onNodesChange(changes: NodeChange<Node<ProcessingNodeUiData>>[]) {
    if (
      inspector?.kind === "edit" &&
      changes.some(
        (change) => change.type === "remove" && change.id === inspector.nodeId,
      )
    ) {
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
      // A drag-stop can contain only `dragging: false`. Settle membership from
      // its last live position too, rather than requiring a final motion event.
      if (change.type === "position" && !change.position && change.dragging === false) {
        const changedId = change.id;
        const local = localNodes.find((node) => node.id === changedId);
        const parent = containerByMemberId.get(changedId);
        if (local)
          change = {
            ...change,
            position: parent
              ? { x: local.position.x - parent.x, y: local.position.y - parent.y }
              : local.position,
          };
      }
      if (change.type !== "position" || !change.position) return change;
      const isContainer = containerByTriggerId.has(change.id);
      const container = containerByMemberId.get(change.id);
      let position = container
        ? { x: change.position.x + container.x, y: change.position.y + container.y }
        : change.position;

      if (isContainer) {
        // React Flow reports the dashed-box origin (relative to a parent
        // container when this trigger is nested). Convert to the trigger's
        // stored absolute position, carry descendants, and handle nest/unnest.
        const info = containerByTriggerId.get(change.id);
        const parent = containerByMemberId.get(change.id);
        const boxOrigin = parent
          ? { x: change.position.x + parent.x, y: change.position.y + parent.y }
          : change.position;
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
          if (
            info &&
            containerContainsTrigger(info, hovered.triggerId, containerByTriggerId)
          )
            return undefined;
          return hovered;
        };

        const escapingParent =
          parent !== undefined && memberEscapesContainer(triggerPosition, parent);
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
            const peer = overlappingPeerContainer(
              {
                x: boxOrigin.x,
                y: boxOrigin.y,
                width: info.width,
                height: info.height,
              },
              change.id,
              eventContainers,
              containerByTriggerId,
            );
            setContainerHint(
              peer ? { triggerId: peer.triggerId, kind: "rejecting" } : null,
            );
          }
        }

        if (change.dragging === false) {
          setContainerHint(null);
          const lens = deviceGraphLens(bindingIndex);
          if (parent && escapingParent) {
            const plan = detachMemberEdges(change.id, parent, graphState.edges);
            for (const edgeId of plan.removeIds)
              removeEdgeCommands.push(removeGraphEdgeCommand(lens, edgeId));
            setOverlapWarning(copy.removedFrom(parent.label));
          }
          if (target && target.triggerId !== parent?.triggerId) {
            const alreadyNested = graphState.edges.some(
              (e) => e.source === target.triggerId && e.target === change.id,
            );
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
            const peer = overlappingPeerContainer(
              { x: origin.x, y: origin.y, width: info.width, height: info.height },
              change.id,
              eventContainers,
              containerByTriggerId,
            );
            if (peer) setOverlapWarning(copy.scheduleInsideSchedule);
          }
        }

        if (info) {
          const extraExclude = new Set<string>();
          if (target) extraExclude.add(target.triggerId);
          if (parent && !escapingParent) extraExclude.add(parent.triggerId);
          const origin = triggerToContainerOrigin(triggerPosition);
          const resolved = resolveRectOverlap(
            change.id,
            origin,
            { w: info.width, h: info.height },
            overlapObstaclesFor(change.id, extraExclude),
          );
          triggerPosition = containerOriginToTrigger(resolved);
          if (parent && !escapingParent) {
            const bound = {
              x: parent.x + NODE_PADDING + ENTRY_FEED_INSET,
              y: parent.y + NODE_PADDING + EVENT_CONTAINER_HEADER_HEIGHT,
            };
            triggerPosition = {
              x: Math.max(triggerPosition.x, bound.x),
              y: Math.max(triggerPosition.y, bound.y),
            };
          }
        }

        const oldPos = livePositions.get(change.id);
        if (info && oldPos) {
          const delta = {
            x: triggerPosition.x - oldPos.x,
            y: triggerPosition.y - oldPos.y,
          };
          const moved = delta.x !== 0 || delta.y !== 0;
          const newOrigin = triggerToContainerOrigin(triggerPosition);
          for (const memberId of collectDescendantMemberIds(
            info,
            containerByTriggerId,
          )) {
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
              position: moved
                ? { x: memberPos.x + delta.x, y: memberPos.y + delta.y }
                : memberPos,
              dragging: change.dragging,
            });
          }
        }
        return { ...change, position: triggerPosition };
      }

      const escaping =
        container !== undefined && memberEscapesContainer(position, container);
      const draggedData = domainNodes.find((n) => n.id === change.id)?.data;
      const isChainableBlock = canChainIntoEventContainer(draggedData);
      const hovered = isChainableBlock
        ? containerAtPosition(
            position,
            eventContainers,
            escaping && container ? new Set([container.triggerId]) : undefined,
          )
        : undefined;
      const sticky =
        containerHint?.kind === "accepting"
          ? eventContainers.find((c) => c.triggerId === containerHint.triggerId)
          : undefined;
      const acceptTarget =
        hovered ??
        (sticky && !memberEscapesContainer(position, sticky) ? sticky : undefined);

      if (change.dragging === true) {
        if (escaping && container) {
          setContainerHint({ triggerId: container.triggerId, kind: "rejecting" });
        } else if (
          isChainableBlock &&
          acceptTarget &&
          acceptTarget.triggerId !== container?.triggerId
        ) {
          setContainerHint({
            triggerId: acceptTarget.triggerId,
            kind: "accepting",
            previewPosition: position,
          });
        } else {
          setContainerHint(null);
        }
      }

      let attachLowerBound: { x: number; y: number } | undefined;
      // Keep the card under the pointer; settle membership and spacing on drop.
      if (change.dragging === true) return { ...change, position };
      {
        setContainerHint(null);
        if (isChainableBlock) {
          const plan = planMembershipDrop({
            current: container,
            hovered: acceptTarget,
            escaping,
          });
          const lens = deviceGraphLens(bindingIndex);
          if (plan.detachFrom && container) {
            const detached = detachMemberEdges(change.id, container, graphState.edges);
            for (const edgeId of detached.removeIds)
              removeEdgeCommands.push(removeGraphEdgeCommand(lens, edgeId));
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
              const source =
                draggedData?.kind === "block" &&
                draggedData.blockTypeId === "ui.manual_trigger"
                  ? target.triggerId
                  : chainTailId(
                      target,
                      graphState.edges,
                      new Set(containerByTriggerId.keys()),
                    );
              if (
                draggedData?.kind === "block" &&
                draggedData.blockTypeId === "ui.manual_trigger"
              ) {
                const destinations = graphState.edges.filter(
                  (edge) => edge.source === change.id,
                );
                for (const edge of graphState.edges) {
                  const from = domainNodes.find(
                    (node) => node.id === edge.source,
                  )?.data;
                  const sourceContainer = containerByMemberId.get(edge.source);
                  if (
                    (edge.source === target.triggerId ||
                      (from &&
                        isFlowStartBlock(from) &&
                        sourceContainer?.triggerId === target.triggerId)) &&
                    destinations.some(
                      (out) =>
                        out.target === edge.target &&
                        out.targetHandle === edge.targetHandle,
                    )
                  )
                    removeEdgeCommands.push(removeGraphEdgeCommand(lens, edge.id));
                }
              }
              const alreadyLinked = graphState.edges.some(
                (e) => e.source === source && e.target === change.id,
              );
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
                setOverlapWarning(
                  plan.detachFrom
                    ? copy.movedInto(target.label)
                    : copy.connectedTo(target.label),
                );
              }
              attachLowerBound = {
                x: target.x + NODE_PADDING,
                y: target.y + NODE_PADDING + EVENT_CONTAINER_HEADER_HEIGHT,
              };
              position = {
                x: Math.max(position.x, attachLowerBound.x),
                y: Math.max(position.y, attachLowerBound.y),
              };
            }
          } else if (plan.detachFrom && container) {
            setOverlapWarning(copy.removedFrom(container.label));
          }
        }
      }
      if (container && !escaping && !attachLowerBound) {
        attachLowerBound = {
          x: container.x + NODE_PADDING,
          y: container.y + NODE_PADDING + EVENT_CONTAINER_HEADER_HEIGHT,
        };
      }
      const insideIds =
        container && escaping
          ? new Set([container.triggerId, ...container.memberIds])
          : null;
      const draggedNode = localNodes.find((n) => n.id === change.id);
      const selfSize = draggedNode
        ? layoutSizeForUiNode(draggedNode)
        : { w: NODE_WIDTH, h: NODE_HEIGHT };
      const siblings = localNodes
        .filter((n) => !n.data.circular && !containerByTriggerId.has(n.id) && !insideIds?.has(n.id))
        .map((n) => {
          const size = layoutSizeForUiNode(n);
          return {
            id: n.id,
            position: n.id === change.id ? position : n.position,
            w: size.w,
            h: size.h,
          };
        });
      position = resolveSiblingOverlap(
        change.id,
        position,
        siblings,
        attachLowerBound,
        selfSize,
      );

      return { ...change, position };
    });
    const allChanges = [...absoluteChanges, ...carriedChanges];
    setLocalNodes((nds) => applyNodeChanges(allChanges, nds));
    if (!execute || bindingIndex < 0) return;
    for (const command of removeEdgeCommands) execute(command);
    for (const command of newEdgeCommands) execute(command);
    const committable = allChanges.filter(
      (c) => !(c.type === "position" && c.dragging === true),
    );
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
    const lens = deviceGraphLens(bindingIndex);
    const targetData = connection.target
      ? domainNodes.find((node) => node.id === connection.target)?.data
      : undefined;
    if (demoOnly && connection.target) {
      const oneInput =
        !!targetData &&
        (isCompareIf(targetData) ||
          isLedBlock(targetData) ||
          isRelayBlock(targetData) ||
          isBackboneSensorBlock(targetData));
      if (oneInput) {
        for (const edge of graphState.edges) {
          if (edge.target === connection.target)
            execute(removeGraphEdgeCommand(lens, edge.id));
        }
      }
    }
    const edgeId = `dpe-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    execute(
      addGraphEdgeCommand(lens, {
        id: edgeId,
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? undefined,
        targetHandle: connection.targetHandle ?? undefined,
      }),
    );
    if (
      demoOnly &&
      connection.source &&
      connection.target &&
      targetData &&
      isCompareIf(targetData) &&
      isBlockNodeData(targetData)
    ) {
      const src = domainNodes.find((node) => node.id === connection.source)?.data;
      if (src && (isDigitalCommandSource(src) || isTemperatureSensor(src))) {
        persistNode(
          connection.target,
          {
            ...targetData,
            properties: {
              ...targetData.properties,
              inputType: isTemperatureSensor(src) ? "analog" : "digital",
            },
          },
          authoringMetadata[connection.target]?.comment ?? "",
        );
      }
    }
  }

  function openRgbModule(module: BackboneSensorModule): boolean {
    const draft =
      module.recipe.deviceDraft && upgradeDht22Driver(module.recipe.deviceDraft);
    if (!draft || !execute) return false;
    execute({
      kind: "EditRgbModule",
      apply: (project) => ({
        ok: true,
        value: {
          ...project,
          authoringMetadata: {
            ...project.authoringMetadata,
            [DEVICE_RECIPE_DRAFT_META_KEY]: {
              comment: serializeDeviceRecipeDraft(draft),
            },
          },
        },
      }),
    });
    navigate("device-recipe-editor");
    return true;
  }
  function onNodeClick(_: unknown, node: Node<ProcessingNodeUiData>) {
    const domainNode = domainNodes.find((n) => n.id === node.id);
    if (!domainNode) return;
    // The violet Activation disc is wiring-only — it must not open an inspector.
    if (node.id === DEMO_BACKBONE_FRAME_ID || node.id.startsWith("demo-hw-")) return;
    if (node.data.circular || isFlowStartBlock(domainNode.data)) return;
    const meta = authoringMetadata[node.id];
    setInspector({
      kind: "edit",
      nodeId: node.id,
      data: domainNode.data,
      comment: meta?.comment ?? "",
    });
  }

  function onNodeDoubleClick(_: unknown, node: Node<ProcessingNodeUiData>) {
    const domain = domainNodes.find((item) => item.id === node.id);
    if (!domain || domain.data.kind !== "block") return;
    if (domain.data.properties.statusLed === true) { setInspector(null); setWhiteLedEditor(node.id); return; }
    const moduleId = domain.data.properties[SENSOR_MODULE_ID_PROP];
    const module = backboneSensorModules.find((item) => item.id === moduleId);
    if (module) {
      setInspector(null);
      openRgbModule(module);
    }
  }

  function persistNode(
    nodeId: string,
    data: DeviceProcessingNodeData,
    comment: string,
  ) {
    if (!execute || bindingIndex < 0) return;
    const lens = deviceGraphLens(bindingIndex);
    execute(
      updateGraphNodeCommand(lens, { layer: "device-processing", id: nodeId, data }),
    );
    const oldData = domainNodes.find(node => node.id === nodeId)?.data;
    if (data.kind === "block" && oldData?.kind === "block" &&
        ["ui.manual_trigger", "ab.square_wave"].includes(data.blockTypeId) &&
        ["ui.manual_trigger", "ab.square_wave"].includes(oldData.blockTypeId) &&
        data.blockTypeId !== oldData.blockTypeId) {
      for (const edge of graphState.edges) {
        if (edge.source === nodeId) {
          execute(removeGraphEdgeCommand(lens, edge.id));
          execute(addGraphEdgeCommand(lens, { ...edge, sourceHandle: data.blockTypeId === "ui.manual_trigger" ? "trigger" : "0" }));
        } else if (edge.target === nodeId && data.blockTypeId === "ab.square_wave") {
          execute(removeGraphEdgeCommand(lens, edge.id));
        }
      }
    }

    if (data.kind === "block" && data.properties[SENSOR_INSTANCE_PROP] === true) {
      const entry = catalogEntryForNode(data);
      const inputs = new Set(entry?.inputs?.map((port) => port.id));
      const outputs = new Set(entry?.outputs?.map((port) => port.id));
      for (const edge of graphState.edges) {
        if (
          (edge.target === nodeId && !inputs.has(edge.targetHandle ?? "")) ||
          (edge.source === nodeId && !outputs.has(edge.sourceHandle ?? ""))
        )
          execute(removeGraphEdgeCommand(lens, edge.id));
      }
    }
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

  useEffect(() => {
    persistTempTestRef.current = (nodeId, celsius) => {
      const node = domainNodes.find((item) => item.id === nodeId);
      if (!node || !isBlockNodeData(node.data)) return;
      persistNode(
        nodeId,
        {
          ...node.data,
          properties: { ...node.data.properties, testC: BigInt(Math.round(celsius)) },
        },
        authoringMetadata[nodeId]?.comment ?? "",
      );
    };
  });

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
        apply: (project) => ({
          ok: true,
          value: {
            ...project,
            authoringMetadata: {
              ...project.authoringMetadata,
              [id]: { comment, position: nextSpawnPosition(domainNodes.length) },
            },
          },
        }),
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
    setDropPreview({
      x: snapToGrid(event.clientX - rect.left),
      y: snapToGrid(event.clientY - rect.top),
    });
    const flowPosRaw = rf?.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    if (!flowPosRaw) return;
    const flowPos = { x: snapToGrid(flowPosRaw.x), y: snapToGrid(flowPosRaw.y) };
    const hovered = containerAtPosition(flowPos, eventContainers);
    const sticky =
      containerHint?.kind === "accepting"
        ? eventContainers.find((c) => c.triggerId === containerHint.triggerId)
        : undefined;
    const target =
      hovered ??
      (sticky && !memberEscapesContainer(flowPos, sticky) ? sticky : undefined);
    if (!target) {
      setContainerHint(null);
      return;
    }
    if (peekPaletteDragKind() === "schedule") {
      setContainerHint({ triggerId: target.triggerId, kind: "rejecting" });
      return;
    }
    // Bay hardware and source-only blocks (Square wave) stay outside the dashed box.
    if (peekPaletteDragBaySide() !== undefined || !peekPaletteDragChainable()) {
      setContainerHint(null);
      return;
    }
    setContainerHint({
      triggerId: target.triggerId,
      kind: "accepting",
      previewPosition: flowPos,
    });
  }

  function onCanvasDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDropPreview(null);
    setContainerHint(null);
    const payload = decodePaletteDrag(
      event.dataTransfer.getData(PROCESSING_BLOCK_MIME),
    );
    if (!payload) return;
    const flowPos = rf?.screenToFlowPosition({
      x: event.clientX,
      y: event.clientY,
    }) ?? { x: 80, y: 80 };
    const position = { x: snapToGrid(flowPos.x), y: snapToGrid(flowPos.y) };
    if (payload.sensorRecipeId) {
      const recipe =
        findSensorRecipeById(payload.sensorRecipeId) ??
        backboneSensorModules
          .flatMap((m) => m.actions ?? [m.recipe])
          .find((r) => r.id === payload.sensorRecipeId);
      if (!recipe) return;
      placeSensorRecipeOnCanvas(recipe, position);
      return;
    }
    const entry = findCatalogEntryById(payload.entryId);
    if (!entry) return;
    placeFromCatalog(entry, position, payload.baySide, payload.physicalPinId);
  }

  const executionMode = selected ? getExecutionMode(selected.bindingId) : "one-shot";
  const backboneConnected = rows.some(
    (row) => row.binding.bindingId === selected?.bindingId && row.sessionState === "READY",
  );

  const liveRuntime = configBytesHaveLiveRuntime(
    selected ? getSnapshot(selected.bindingId)?.config?.configBytes : undefined,
  );

  const deploymentBytes = selected ? getSnapshot(selected.bindingId)?.config?.configBytes : undefined;
  const deploymentCurrent = useMemo(() => {
    if (!session || !selected || !deploymentBytes) return undefined;
    const decoded = decodeDeploymentConfig(deploymentBytes);
    return decoded.ok && deploymentIsCurrent(session.stack.current, selected.bindingId, decoded.value);
  }, [session, revision, selected?.bindingId, deploymentBytes]);
  const staleStopAttempt = useRef("");
  useEffect(() => {
    if (demoOnly || deployOpen || !backboneConnected || deploymentCurrent !== false || executionMode !== "continuous" || pausing) return;
    const attempt = `${selected?.bindingId}:${revision}`;
    if (staleStopAttempt.current === attempt) return;
    staleStopAttempt.current = attempt;
    void handlePauseRuntime();
  }, [demoOnly, deployOpen, backboneConnected, deploymentCurrent, executionMode, pausing, selected?.bindingId, revision]);

  async function handlePauseRuntime() {
    stopPreview();
    if (!selected || bindingIndex < 0) return;
    const client = getClient(selected.bindingId);
    if (!client) {
      setPauseError(
        locale === "it"
          ? "Collega la Backbone per lo Stop."
          : "Connect the Backbone to Stop.",
      );
      return;
    }
    setPausing(true);
    setPauseError(null);
    pausePolling();
    lockTransport();
    try {
      await waitUntilIdle();
      setExecutionMode(selected.bindingId, "busy");
      const completionProfiles =
        "profiles" in viewerPlan
          ? viewerPlan.profiles
              .filter((profile) =>
                profile.profileId.startsWith("flow.gpio-state.") || profile.sampleOps.some((op) =>
                  ["DS18B20_READ", "DHT22_READ", "STEPPER", "RGB_PROGRAM"].includes(
                    op.op,
                  ),
                ),
              )
              .map((profile) => profile.profileId)
          : [];
      const stopped = await pauseContinuousRuntime(
        client,
        AbortSignal.timeout(20000),
        completionProfiles,
      );
      observeConfig(selected.bindingId, stopped);
      setExecutionMode(selected.bindingId, "one-shot");
      // Stop leaves the current canvas visible; physical setup has its own navigation.
    } catch (cause) {
      setExecutionMode(selected.bindingId, "continuous");
      setPauseError(formatApplyConfigError(cause, locale === "it"));
    } finally {
      unlockTransport();
      resumePolling();
      setPausing(false);
    }
  }

  async function handleDryRun() {
    if (simulating) {
      stopPreview();
      return;
    }
    setRunning(true);
    setHashHex(null);
    try {
      const input = {
        physicalGraph: physicalGraphState,
        processingGraph: graphState,
        mqtt: DISABLED_MQTT,
        connectivity: 0,
        energy: DEFAULT_ENERGY,
      };
      const plan =
        !demoOnly && session && selected
          ? prepareDriverDeployment(session.stack.current, selected.bindingId, input)
          : { input, profiles: [], options: {} };
      const result = dryRunConfig(plan.input, {
        ...plan.options,
        availableBlockRuleTypeIds: demoOnly
          ? new Set([
              ...SHIPPED_TYPE_IDS,
              "ab.relay",
              "ab.compare_if",
              "ab.temperature_sensor",
            ])
          : new Set([...SHIPPED_TYPE_IDS, "device-action", "status_led"]),
      });
      setDryRun(result);
      const hardErrors = result.issues.filter((i) => i.severity !== "warning").length;
      // Start local LED/GPIO preview immediately after validate — before the
      // async hash — so the blink is not lost if something remounts mid-await.
      if (hardErrors === 0) {
        const channels = buildDryRunPreviewChannels(graphState);
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
        setHashHex(
          Array.from(digest.slice(0, 8))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(""),
        );
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

  const whiteLedNode = domainNodes.find(node => node.id === whiteLedEditor);
  if (whiteLedNode?.data.kind === "block") return <WhiteLedModuleEditor properties={whiteLedNode.data.properties} onCancel={()=>setWhiteLedEditor(null)} onSave={config=>{persistNode(whiteLedNode.id,{...whiteLedNode.data,properties:{...(whiteLedNode.data.kind === "block" ? whiteLedNode.data.properties : {}),whiteLedConfig:JSON.stringify(config)}} as DeviceProcessingNodeData,authoringMetadata[whiteLedNode.id]?.comment ?? "LED interno");setWhiteLedEditor(null);}} />;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {demoOnly && <VisitorDemoTour enabled />}
      <div className="flex h-12 shrink-0 items-center gap-2 overflow-hidden border-b border-border bg-surface px-3 sm:h-14 sm:gap-3 sm:px-4">
        {!demoOnly && (
          <div className="shrink-0">
            <CoreSelector
              bindings={bindings}
              selected={selected}
              onSelect={(b) => setSelectedBindingId(b.bindingId)}
            />
          </div>
        )}
        {!demoOnly && (
          <div className="flex shrink-0 gap-1">
            <button
              type="button"
              className="rounded-slpill px-3 py-1 text-xs text-ink-muted"
              onClick={() => navigate("physical-composition")}
            >
              Modules
            </button>
            <button
              type="button"
              className="rounded-slpill bg-brand-blue/10 px-3 py-1 text-xs text-brand-blue"
            >
              Logic
            </button>
          </div>
        )}
        <div className="min-w-0">
          <h1 className="truncate font-heading text-lg font-semibold text-ink">
            {demoOnly ? DEMO_VISITOR_PROJECT_NAME : copy.title}
          </h1>
          {demoOnly && (
            <p className="hidden truncate font-body text-[11px] text-ink-muted sm:block">
              Firmware functions command hardware modules on the Backbone
            </p>
          )}
        </div>
        <div className="min-w-0 flex-1" />
        {!demoOnly && (
          <span
            role="status"
            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${executionMode === "continuous" ? "bg-success/10 text-success" : "bg-brand-blue/5 text-brand-blue"}`}
          >
            {executionMode === "continuous" && <span aria-hidden="true" className="logic-running-light" />}
            {executionMode === "continuous"
              ? "Logica in esecuzione continua"
              : executionMode === "busy"
                ? "Operazione sulla Backbone…"
                : "One-shot · test manuali"}
          </span>
        )}
        {!demoOnly && !backboneConnected && (
          <span role="status" className="shrink-0 text-xs text-ink-muted">
            {locale === "it" ? "Collega la Backbone" : "Connect the Backbone"}
          </span>
        )}
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
          style={
            simulating
              ? { backgroundColor: "color-mix(in srgb, #F5C518 14%, transparent)" }
              : undefined
          }
        >
          {simulating ? (
            <Square size={14} fill="currentColor" />
          ) : (
            <PlayCircle size={16} />
          )}
          {running
            ? copy.running
            : simulating
              ? copy.stopPreview
              : demoOnly
                ? copy.run
                : copy.dryRun}
        </button>
        {errorCount > 0 && (
          <span
            className="flex shrink-0 items-center gap-1.5 rounded-slpill px-3 py-1.5 font-body text-sm text-error"
            style={{
              backgroundColor:
                "color-mix(in srgb, var(--color-error) 10%, transparent)",
            }}
          >
            <CircleAlert size={14} />
            {copy.errorsCount(errorCount)}
          </span>
        )}
        {!demoOnly && (selected || liveRuntime || graphState.nodes.length > 0) && (
          <button
            type="button"
            onClick={() => void handlePauseRuntime()}
            disabled={pausing || executionMode !== "continuous"}
            className="flex shrink-0 items-center gap-1.5 rounded-slpill border border-border-strong px-4 py-1.5 font-body-strong text-sm text-ink hover:bg-surface-raised disabled:opacity-50"
          >
            <Square size={14} fill="currentColor" />
            {pausing ? copy.pausing : copy.pause}
          </button>
        )}
        {!demoOnly && (
          <button
            type="button"
            onClick={() => requestDeploy()}
            disabled={executionMode !== "one-shot" || pausing}
            title={executionMode === "continuous" ? "Premi Stop prima di caricare un nuovo programma" : undefined}
            className="shrink-0 rounded-slpill bg-brand-blue px-4 py-1.5 font-body-strong text-sm text-white hover:enabled:bg-brand-blue-dark disabled:cursor-not-allowed disabled:bg-surface-raised disabled:text-ink-muted"
          >
            Deploy & Run
          </button>
        )}
      </div>
      {!demoOnly && deploymentCurrent === false && (
        <div role="status" className="flex items-center justify-between gap-3 border-b border-warning/30 bg-warning/10 px-4 py-2 text-sm">
          <span>Versioni diverse: il canvas contiene modifiche non caricate sulla Backbone. Carica di nuovo il programma prima di avviarlo.</span>
          <button type="button" disabled={pausing || executionMode === "busy" || executionMode === "continuous"} onClick={() => requestDeploy()} className="shrink-0 font-semibold text-brand-blue disabled:opacity-40">Carica configurazione</button>
        </div>
      )}
      <div aria-label="Tipi di segnale sui fili" className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-surface px-4 py-1.5 text-[11px] text-ink-muted">
        <span className="font-semibold">Segnali</span>
        {[...new Set(edges.map(edge => (edge.data?.signalType ?? "any") as WireSignalType))].map(type => (
          <span key={type} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="h-0.5 w-4 rounded-full" style={{backgroundColor:SIGNAL_STYLES[type].color}} />
            {SIGNAL_STYLES[type].label}
          </span>
        ))}
      </div>
      {pauseError && (
        <div
          role="alert"
          className="border-b border-error bg-error/5 px-4 py-2 font-body text-sm text-error"
        >
          {pauseError}
        </div>
      )}

      {!selected ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="font-body text-sm text-ink-faint">{copy.noCore}</p>
        </div>
      ) : (
        <div className="relative flex flex-1 overflow-hidden">
          {!demoOnly && (
            <ProcessingBlockPalette
              bindingId={selected?.bindingId}
              onCreateRecipe={() => navigate("device-recipe-editor")}
              onAddSchedule={() => {
                const entry = findCatalogEntryById("native.schedule");
                if (entry) placeFromCatalog(entry);
              }}
              onAddTrigger={() => {
                const entry = findCatalogEntryById("appblocks.manual_trigger");
                if (entry) placeFromCatalog(entry);
              }}
              onAddViewer={() => {
                const entry = findCatalogEntryById("appblocks.data_viewer");
                if (entry) placeFromCatalog(entry);
              }}
            />
          )}

          <div
            className="relative flex-1"
            onDragOver={onCanvasDragOver}
            onDragLeave={() => {
              setDropPreview(null);
              setContainerHint(null);
            }}
            onDrop={onCanvasDrop}
          >
            {!demoOnly && (
              <BackboneModulesPanel
                modules={backboneSensorModules}
                onAdd={() => navigate("device-recipe-editor")}
                onSelect={setSensorDetail}
                onEdit={(module) => {
                  setSensorDetail(null);
                  openRgbModule(module);
                }}
                onRemove={handleSensorModuleRemove}
                onUseStatusLed={handleUseStatusLed}
              />
            )}
            <SensorRecipeWizard
              open={sensorWizardOpen}
              initialStep={sensorWizardInitialStep}
              onClose={() => setSensorWizardOpen(false)}
              onConfirm={handleSensorRecipeConfirm}
            />
            <PhysicalBusMissingModal
              open={missingBus !== null}
              bus={missingBus ?? "i2c"}
              onClose={() => setMissingBus(null)}
              onGoConfigure={() => {
                setMissingBus(null);
                setSensorWizardOpen(false);
                navigate("physical-composition");
              }}
            />
            {sensorDetail && (
              <div className="absolute inset-0 z-40 flex items-center justify-center bg-ink/25 p-4">
                <button
                  type="button"
                  aria-label="Close"
                  className="absolute inset-0 cursor-default"
                  onClick={() => setSensorDetail(null)}
                />
                <div className="relative z-10 max-h-[min(90dvh,44rem)] w-full max-w-3xl overflow-y-auto rounded-slmd border border-border-strong bg-surface p-4 shadow-e2">
                  <SensorRecipeCard
                    recipe={resolveRecipe(
                      backboneSensorModules.find(
                        (module) => module.id === sensorDetail.id,
                      ) ?? sensorDetail,
                    )}
                    it={locale === "it"}
                    editable
                    onRecipeChange={handleSensorRecipeEdit}
                  />
                  {selected && (
                    <div className="mt-4 border-t border-border pt-4">
                      <ModuleGpioPinField
                        module={
                          backboneSensorModules.find(
                            (module) => module.id === sensorDetail.id,
                          ) ?? sensorDetail
                        }
                        bindingId={selected.bindingId}
                        it={locale === "it"}
                      />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => setSensorDetail(null)}
                    className="mt-4 w-full rounded-slpill bg-brand-blue px-4 py-2 font-body-strong text-sm text-white hover:bg-brand-blue-dark"
                  >
                    {locale === "it" ? "Chiudi" : "Close"}
                  </button>
                </div>
              </div>
            )}
            <ReactFlow
              key={`${session?.projectId}:${selected?.bindingId}`}
              defaultViewport={savedViewport}
              onMoveEnd={(_, viewport) => {
                if (session && selected) saveCanvasViewport(session.stack, selected.bindingId, viewport);
              }}
              className="processing-canvas"
              nodesDraggable
              selectNodesOnDrag
              nodeDragThreshold={1}
              nodeClickDistance={3}
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
              nodes={illuminatedNodes}
              edges={visibleEdges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              isValidConnection={isValidConnection}
              connectionRadius={28}
              onNodeClick={onNodeClick}
              onNodeDoubleClick={onNodeDoubleClick}
              zoomOnDoubleClick={false}
              onInit={setRf}
              deleteKeyCode={demoOnly ? null : ["Backspace", "Delete"]}
              proOptions={demoOnly ? { hideAttribution: true } : undefined}
              defaultEdgeOptions={{
                type: "deletable",
                interactionWidth: 24,
                style: { stroke: "var(--color-ink-faint)", strokeWidth: 1.75 },
              }}
              fitView={!savedViewport}
              fitViewOptions={
                demoOnly
                  ? { padding: 0.22, minZoom: 0.18, maxZoom: 1.15 }
                  : { padding: 0.2, maxZoom: 0.8 }
              }
              minZoom={demoOnly ? 0.15 : undefined}
              maxZoom={demoOnly ? 1.5 : undefined}
              panOnScroll={!demoOnly}
              zoomOnPinch
              preventScrolling={demoOnly}
            >
              <Background gap={20} color="#E1E4EB" />
              <Controls
                position="bottom-left"
                showInteractive={false}
                fitViewOptions={{ padding: 0.2, maxZoom: demoOnly ? 1.15 : 0.8 }}
              />
            </ReactFlow>
            {demoOnly && (
              <DemoRadialAdd
                onPick={(entryId) => {
                  const entry = findCatalogEntryById(entryId);
                  if (!entry) return;
                  const baySide =
                    entry.family === "bay"
                      ? entry.bayIo === "input"
                        ? "input"
                        : "output"
                      : undefined;
                  placeFromCatalog(entry, demoSpawnPosition(entryId), baySide);
                }}
              />
            )}

            {domainNodes.length === 0 && !dropPreview && (
              <div
                className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-center${demoOnly || simulating ? "" : " mb-10"}`}
              >
                <Workflow size={48} strokeWidth={1.5} className="text-ink-faint" />
                <p className="mt-2 font-heading text-lg font-semibold text-ink">
                  {copy.emptyTitle}
                </p>
                <p className="mt-2 rounded-slpill bg-brand-blue px-4 py-1.5 font-body-strong text-sm text-white opacity-70">
                  {copy.emptyHint}
                </p>
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
                  backgroundColor:
                    "color-mix(in srgb, var(--color-brand-blue) 8%, transparent)",
                }}
              />
            )}

            {overlapWarning && (
              <div
                className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-slpill bg-surface px-3 py-1.5 font-body text-sm text-ink shadow-e1"
                style={{ outline: "1px solid var(--color-warning)" }}
              >
                {overlapWarning}
              </div>
            )}

            {!demoOnly && !simulating && (
              <div className="absolute bottom-0 left-0 right-0 flex h-10 items-center gap-2 border-t border-border bg-surface px-4">
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ backgroundColor: statusColor }}
                />
                <span className="font-body text-xs text-ink-muted">{statusText}</span>
                {hashHex && (
                  <span className="font-mono text-xs text-ink-faint">
                    hash: {hashHex}…
                  </span>
                )}
                <span className="ml-auto font-mono text-xs text-ink-faint">
                  {copy.nodesEdges(domainNodes.length, graphState.edges.length)}
                </span>
              </div>
            )}
          </div>

          {inspector &&
            (demoOnly ||
              (inspector.kind === "edit" && recipeForActionNode(inspector.data))) && (
              <DemoInspectorBubble
                nodeId={inspector.kind === "edit" ? inspector.nodeId : undefined}
                onDismiss={() => setInspector(null)}
              >
                <NodeInspector
                  driverBindingId={selected?.bindingId}
                  driverRecipe={
                    inspector.kind === "edit"
                      ? recipeForActionNode(inspector.data)
                      : undefined
                  }
                  key={
                    inspector.kind === "edit"
                      ? inspector.nodeId
                      : `create-${inspector.nodeKind}`
                  }
                  mode={inspector}
                  moduleOptions={moduleOptions}
                  existingNodes={domainNodes}
                  existingEdges={graphState.edges}
                  nodeLabel={processingNodeLabel}
                  knownModuleNodeIds={knownModuleNodeIds}
                  onSave={handleSave}
                  onApply={handleApply}
                  onDelete={
                    inspector.kind === "edit" && !demoOnly ? handleDelete : undefined
                  }
                  onClose={() => setInspector(null)}
                />
              </DemoInspectorBubble>
            )}
          {inspector &&
            !demoOnly &&
            !(inspector.kind === "edit" && recipeForActionNode(inspector.data)) && (
              <NodeInspector
                driverBindingId={selected?.bindingId}
                driverRecipe={
                  inspector.kind === "edit"
                    ? recipeForActionNode(inspector.data)
                    : undefined
                }
                key={
                  inspector.kind === "edit"
                    ? inspector.nodeId
                    : `create-${inspector.nodeKind}`
                }
                mode={inspector}
                moduleOptions={moduleOptions}
                existingNodes={domainNodes}
                existingEdges={graphState.edges}
                nodeLabel={processingNodeLabel}
                knownModuleNodeIds={knownModuleNodeIds}
                onSave={handleSave}
                onApply={handleApply}
                onDelete={inspector.kind === "edit" ? handleDelete : undefined}
                onClose={() => setInspector(null)}
              />
            )}
        </div>
      )}
    </div>
  );
}
