import { blockHelp } from "./block-help.js";
import type { BlockHelp } from "./BlockInfoButton.js";
import { signalDurations } from "../../lib/signal-timing.js";
import { MANUAL_TRIGGER_TYPE } from "../../lib/flow-trigger.js";
import type { DataViewerUi, ViewerSource } from "./DataViewerValue.js";
import { rgbInputLabel } from "../../lib/rgb-module.js";
import { SEQUENCE_TYPE, sequenceSteps } from "../../lib/flow-sequence.js";
import { gpioSignalType } from "../../lib/gpio-operation-registry.js";
import type { GpioHardwareAppearance } from "../../lib/device-recipe-draft.js";
import {
  BACKBONE_SENSOR_MODULES_META_KEY,
  parseBackboneSensorModules,
} from "../../lib/backbone-sensor-modules.js";
import {
  propertiesForSensorModule,
  SENSOR_MODULE_ID_PROP,
} from "../../lib/backbone-sensor-block.js";
import {
  SENSOR_INSTANCE_PROP,
  SENSOR_ACTION_LABEL_PROP,
} from "../../lib/sensor-instance.js";
import {
  SENSOR_ACTION_ID_PROP,
  channelsFromNodeProperties,
} from "../../lib/backbone-sensor-block.js";
import type { AuthoringMetadata, GraphState } from "@spaghettilab/domain";
import {
  isBlockNodeData,
  isRuleNodeData,
  moduleReferenceOf,
  type DeviceProcessingNodeData,
} from "@spaghettilab/device-processing-graph-model";
import {
  formatFieldsSubtitle,
  isBayEntry,
  type BaySide,
} from "@spaghettilab/processing-block-catalog";
import {
  localizeCatalogEntry,
  localizeCatalogText,
  localizedBaySideLabel,
} from "../../lib/processing-catalog-copy.js";
import { processingGraphCopy } from "../../lib/processing-graph-copy.js";
import type { LocaleId } from "../../lib/locale.js";
import { Position, type Node } from "@xyflow/react";
import { ifSourceKind } from "./connection-rules.js";
import { catalogEntryForNode, propertiesOf } from "./catalog-entry-for-node.js";
import { formatConfiguredSubtitle } from "./configured-subtitle.js";
import { visualForCatalogEntryId, type CatalogTileGlyph } from "./block-visuals.js";
import {
  compareOpFromProperties,
  elseOutputFromProperties,
  hysteresisTicksFromProperties,
  ifInputType,
  ifOutputType,
  initialHighFromProperties,
  isCompareIf,
  isDigitalOutToggle,
  isFlowStartBlock,
  isLedBlock,
  isRelayBlock,
  isRgbLedBlock,
  isSquareWave,
  ledColorFromProperties,
  numberFromProperty,
  pulseMsFromProperties,
  squareWaveDutyPercent,
  squareWavePeriodMs,
  toggleModeFromProperties,
  type CompareOp,
} from "./dry-run-preview.js";
import { parseRgbLedConfig, rgbLedSubtitle, rgbLedVisualAt } from "./rgb-led-model.js";
import { INTERNAL_LED_FIRST_PORT_Y, INTERNAL_LED_PORT_SPACING, INTERNAL_LED_HEIGHT, FLOW_START_SIZE, IF_FOOTER_HEIGHT, NODE_HEIGHT } from "./layout-constants.js";
import { PROCESSING_NODE_KIND_CONFIG } from "./node-kinds.js";
import {
  handlesForNode,
  portsForNode,
  nodeHeightForPorts,
  nodeWidthForPorts,
  type PortKind,
} from "./node-ports.js";

export type ToggleWaveUi = {
  readonly mode: "astable" | "pulse_high" | "pulse_low";
  readonly highTicks: number;
  readonly lowTicks: number;
  readonly initialHigh: boolean;
  readonly pulseMs: number;
};

export type ProcessingNodeUiData = {
  readonly statusLed?: boolean;
  readonly logicIf?: { condition: string; whenTrue: string; whenFalse: string };
  readonly dataViewer?: DataViewerUi;
  readonly signalGenerator?: { bindingId?: string; source?: ViewerSource; onMs: number; offMs: number };
  readonly manualTrigger?: { bindingId?: string };
  readonly sensorSchematic?: boolean;
  readonly hardwareKind?: GpioHardwareAppearance["kind"];
  readonly hardwareSummary?: string;
  readonly domainId: string;
  readonly kind: DeviceProcessingNodeData["kind"];
  readonly label: string;
  readonly subtitle: string;
  readonly help?: BlockHelp;
  readonly hasError: boolean;
  readonly hasInput: boolean;
  readonly hasOutput: boolean;
  /** Dry-run: LED / toggle line currently HIGH. */
  readonly previewActive?: boolean;
  /** Dry-run: this node is part of an active preview channel. */
  readonly previewing?: boolean;
  /** LED block: solid swatch color from Inspector (no glyph inside the tile). */
  readonly ledColor?: string;
  /** Dry-run: continuous LED brightness 0..1 (soglia + soft start/stop). */
  readonly ledIntensity?: number;
  /**
   * RGB LED: authoring config for the canvas swatch. Dynamic presets
   * (color_cycle / breathe / blink) animate locally; dry-run overrides via
   * ledColor + ledIntensity while previewing.
   */
  readonly rgbSwatch?: {
    readonly mode: "preset" | "sequence";
    readonly preset: "solid" | "breathe" | "blink" | "color_cycle";
    readonly color: string;
    readonly intensity: number;
    readonly speedMs: number;
  };
  /** Catalog override: tile accent (e.g. Digital Out Toggle orange). */
  readonly accentColor?: string;
  /** Catalog override glyph: toggle | palette | power (see block-visuals). */
  readonly tileGlyph?: CatalogTileGlyph;
  /** Flow Start: bare dark-violet disc (Schedule tick plug). */
  readonly circular?: boolean;
  /** Digital Out Toggle: duty-cycle waveform on the output handle. */
  readonly toggleWave?: ToggleWaveUi;
  /** Dry-run: scroll the toggle waveform with the live clock. */
  readonly waveLive?: { readonly elapsedMs: number; readonly periodMs: number };
  /** Hardware bay endpoint (LED, Relay, …) — distinct chrome from functionality blocks. */
  readonly bay?: boolean;
  /** Bay I/O side when `bay` is true. */
  readonly baySide?: BaySide;
  /** Catalog input handles (multi-port cards). */
  readonly inputHandles?: readonly {
    readonly id: string;
    readonly label?: string;
    readonly kind?: PortKind;
  }[];
  /** Catalog output handles (multi-port cards). */
  readonly outputHandles?: readonly {
    readonly id: string;
    readonly label?: string;
    readonly kind?: PortKind;
  }[];
  /** Measured card height when stacked handles need more than NODE_HEIGHT. */
  readonly cardHeight?: number;
  /** Measured card width for multi-channel bay cards. */
  readonly cardWidth?: number;
  /** Temperature sensor: live test value + slider callback (demo). */
  readonly tempProbe?: {
    readonly celsius: number;
    readonly min: number;
    readonly max: number;
    readonly onChange?: (celsius: number) => void;
  };
  /** IF: output lane kind + configured then / else levels. */
  readonly ifOutput?: {
    readonly kind: "digital" | "boolean";
    readonly thenHigh: boolean;
    readonly elseHigh: boolean;
    readonly thenElse: string;
  };
  /** IF: selected input domain (auto from the wire, overridable). */
  readonly ifInput?: {
    readonly kind: "digital" | "analog";
  };
  /** Relay: contact closes when the input is HIGH or LOW. */
  readonly relayClose?: {
    readonly closeWhenHigh: boolean;
    readonly label: string;
  };
};

/**
 * Direct conversion, not `@spaghettilab/react-flow-adapter`'s `toReactFlowNodes()` —
 * same reasoning as the Physical Composition Editor's `to-nodes.ts`: that helper
 * resolves every node against `EditorModel` (S042), which only knows Module
 * Driver/Device Profile `typeId`s, not Schedule/Event source/Block/Rule.
 */
export function toProcessingNodes(
  graphState: GraphState<"device-processing">,
  authoringMetadata: Readonly<Record<string, AuthoringMetadata>>,
  errorNodeIds: ReadonlySet<string>,
  moduleLabel: (moduleNodeId: string) => string,
  fieldLabel: (moduleNodeId: string, fieldId: number) => string = (
    _moduleNodeId,
    fieldId,
  ) => String(fieldId),
  previewActiveIds: ReadonlySet<string> = new Set(),
  locale: LocaleId = "it",
): Node<ProcessingNodeUiData>[] {
  const devices = new Map(
    Object.values(
      parseBackboneSensorModules(
        authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment,
      ).byBinding,
    )
      .flat()
      .map((module) => [module.id, module]),
  );
  const titles = new Map<string, string>();
  for (const node of graphState.nodes) {
    titles.set(
      node.id,
      canvasTitle(
        node.data as DeviceProcessingNodeData,
        authoringMetadata[node.id],
        locale,
      ),
    );
  }

  const outputNames = new Map<string, ReadonlyMap<string, string>>();
  for (const node of graphState.nodes) {
    const data = node.data as DeviceProcessingNodeData;
    const names = new Map<string, string>();
    if (isBlockNodeData(data)) {
      const draft = devices.get(String(data.properties[SENSOR_MODULE_ID_PROP]))?.recipe.deviceDraft;
      for (const channel of draft?.channels ?? []) names.set(channel.id, channel.label);
    }
    for (const port of portsForNode(data).outputs) if (port.label) names.set(port.id, localizeCatalogText(port.label, locale));
    outputNames.set(node.id, names);
  }

  return graphState.nodes.map((node) => {
    const meta = authoringMetadata[node.id];
    let data = node.data as DeviceProcessingNodeData;
    const accent = blockAccentFields(data);
    const isTick =
      accent.circular === true || (isBlockNodeData(data) && isFlowStartBlock(data));
    let ports = portsForNode(data);
    const statusLed = isBlockNodeData(data) && data.properties.statusLed === true;
    if (statusLed) titles.set(node.id, locale === "it" ? "LED interno" : "Internal LED");

    const ifLane = isBlockNodeData(data) && isCompareIf(data);
    const relayCard = isBlockNodeData(data) && isRelayBlock(data);
    const schematic =
      isBlockNodeData(data) &&
      (data.properties[SENSOR_INSTANCE_PROP] === true ||
        data.properties.sensorDht22 === true);
    const hardwareDraft = isBlockNodeData(data)
      ? devices.get(String(data.properties[SENSOR_MODULE_ID_PROP]))?.recipe.deviceDraft
      : undefined;
    if (hardwareDraft?.temperatureSensorModel === "dht11" && isBlockNodeData(data)) {
      const module = devices.get(String(data.properties[SENSOR_MODULE_ID_PROP]))!;
      data = {
        ...data,
        properties: {
          ...data.properties,
          ...propertiesForSensorModule(module, module.recipe),
        },
      };
      ports = portsForNode(data);
      if (titles.get(node.id) === "DHT22") titles.set(node.id, "DHT11");
    }
    if (hardwareDraft?.rgbModule) {
      const config = hardwareDraft.rgbModule;
      ports = {
        ...ports,
        inputs: ports.inputs.map((port) => ({
          ...port,
          label: config.inputs.some((input) => input.id === port.id)
            ? rgbInputLabel(config.inputs.find((input) => input.id === port.id)!)
            : port.label,
        })),
        outputs: ports.outputs.map((port) => ({
          ...port,
          label:
            port.id === "state"
              ? "È acceso"
              : port.id === "color"
                ? "Colore emesso"
                : port.label,
        })),
      };
    }
    const hardwareKind = hardwareDraft?.gpioHardware?.kind;
    const signalCount = hardwareDraft?.binding.gpioSignals.length ?? 0;
    const outputsOnly = hardwareDraft?.binding.gpioSignals.every(
      (signal) => gpioSignalType(signal) === "digital_output",
    );
    const hardwareSummary = hardwareDraft?.rgbModule
      ? locale === "it"
        ? "3 canali PWM · LED RGB"
        : "3 PWM channels · RGB LED"
      : hardwareDraft?.binding.bus === "gpio" && outputsOnly && signalCount
        ? `${signalCount} ${locale === "it" ? (signalCount === 1 ? "uscita digitale" : "uscite digitali") : signalCount === 1 ? "digital output" : "digital outputs"}`
        : hardwareDraft
          ? `${locale === "it" ? "Dispositivo" : "Device"} ${hardwareDraft.binding.bus.toUpperCase()}`
          : undefined;
    const alternating = isSquareWave(data);
    const manual = isBlockNodeData(data) && data.blockTypeId === MANUAL_TRIGGER_TYPE;
    const viewer = isBlockNodeData(data) && data.blockTypeId === "ui.data_viewer";
    const sequence = isBlockNodeData(data) && data.blockTypeId === SEQUENCE_TYPE;
    const logicIf = isBlockNodeData(data) && data.blockTypeId === "logic_if"
      ? logicIfPresentation(data, incomingLabel(node.id, graphState, titles, outputNames), locale)
      : undefined;
    const cardHeight = statusLed ? INTERNAL_LED_HEIGHT : logicIf ? 118 : manual ? 80 : alternating
      ? 118
      : viewer
        ? 140
        : sequence
          ? 132
          : schematic
            ? 64 + Math.max(ports.inputs.length, ports.outputs.length, 1) * 22
            : isTick
              ? FLOW_START_SIZE
              : nodeHeightForPorts(ports) +
                (ifLane || relayCard ? IF_FOOTER_HEIGHT : 0);
    const cardWidth = statusLed ? 320 : logicIf ? 250 : manual || alternating
      ? 210
      : viewer
        ? 240
        : sequence
          ? 260
          : schematic
            ? 320
            : isTick
              ? FLOW_START_SIZE
              : nodeWidthForPorts(ports);
    return {
      id: node.id,
      type: "processing",
      position: meta?.position ?? { x: 0, y: 0 },
      selected: meta?.selected ?? false,
      // Explicit top-level dimensions (React Flow's own ResizeObserver corrects
      // these once the DOM settles) — any node that becomes a container's child
      // (parentId, see ProcessingGraphScreen) renders `visibility: hidden` until
      // React Flow considers it measured; a plain top-level node never hits that
      // gate, which is why this went unnoticed until blocks started getting
      // reparented into event containers.
      //
      // Static `handles` are required for the same rebuild: dragging a member
      // recreates every card (relative position + parentId + preview). Without
      // this list, handleBounds are cleared and edges disappear (getEdgePosition
      // returns null) — the same bug EventContainer nodes already guard against.
      width: cardWidth,
      height: cardHeight,
      handles: statusLed || logicIf
        ? [
            ...ports.inputs.map((port,index)=>({id:port.id,type:"target" as const,position:Position.Left,x:-8,y:(statusLed ? INTERNAL_LED_FIRST_PORT_Y + index * INTERNAL_LED_PORT_SPACING : 64)-8,width:16,height:16})),
            ...ports.outputs.map((port,index)=>({id:port.id,type:"source" as const,position:Position.Right,x:cardWidth-8,y:(statusLed ? INTERNAL_LED_FIRST_PORT_Y + index * INTERNAL_LED_PORT_SPACING : 64)-8,width:16,height:16})),
          ]
        : manual || alternating
        ? [
            {
              id: manual ? "trigger" : "0",
              type: "source" as const,
              position: Position.Right,
              x: cardWidth - 4,
              y: cardHeight / 2 - 6,
              width: 8,
              height: 12,
            },
          ]
        : sequence
          ? [
              ...ports.inputs.map((port, index) => ({
                id: port.id,
                type: "target" as const,
                position: Position.Left,
                x: -8,
                y: 57 + index * 22,
                width: 16,
                height: 16,
              })),
              ...ports.outputs.map((port, index) => ({
                id: port.id,
                type: "source" as const,
                position: Position.Right,
                x: cardWidth - 16,
                y: 57 + index * 22,
                width: 16,
                height: 16,
              })),
            ]
          : schematic
            ? [
                ...ports.inputs.map((port, index) => ({
                  id: port.id,
                  type: "target" as const,
                  position: Position.Left,
                  x: 14,
                  y: 65 + index * 22,
                  width: 8,
                  height: 12,
                })),
                ...ports.outputs.map((port, index) => ({
                  id: port.id,
                  type: "source" as const,
                  position: Position.Right,
                  x: cardWidth - 22,
                  y: 65 + index * 22,
                  width: 8,
                  height: 12,
                })),
              ]
            : handlesForNode(ports, {
                width: cardWidth,
                height: cardHeight,
                circular: isTick,
                bandHeight: ifLane || relayCard ? NODE_HEIGHT : undefined,
              }),
      data: {
        domainId: node.id,
        ...(alternating && isBlockNodeData(data) ? { signalGenerator: signalDurations(data.properties) } : {}),
        ...(manual
          ? {
              manualTrigger: {},
            }
          : {}),
        ...(viewer && isBlockNodeData(data)
          ? {
              dataViewer: {
                connected: graphState.edges.some((edge) => edge.target === node.id),
                caption: String(data.properties.caption ?? "Dato"),
                unit: String(data.properties.unit ?? ""),
                decimals: Number(data.properties.decimals ?? 2),
              },
            }
          : {}),
        sensorSchematic: schematic,
        hardwareKind,
        hardwareSummary,
        logicIf,
        statusLed,
        kind: data.kind,
        label: titles.get(node.id) ?? PROCESSING_NODE_KIND_CONFIG[data.kind].label,
        help: blockHelp(data, titles.get(node.id) ?? "Blocco", ports),
        subtitle: subtitleFor(
          node.id,
          data,
          graphState,
          titles,
          moduleLabel,
          fieldLabel,
          outputNames,
          locale,
        ),
        hasError: errorNodeIds.has(node.id),
        hasInput: ports.hasInput,
        hasOutput: ports.hasOutput,
        inputHandles: applySelectedPortKinds(
          node.id,
          data,
          graphState,
          localizeHandleLabels(ports.inputs, locale),
          "in",
        ),
        outputHandles: applySelectedPortKinds(
          node.id,
          data,
          graphState,
          localizeHandleLabels(ports.outputs, locale),
          "out",
        ),
        cardHeight,
        cardWidth,
        previewActive: previewActiveIds.has(node.id),
        ...(isBlockNodeData(data) && (isLedBlock(data) || isRgbLedBlock(data))
          ? (() => {
              if (isRgbLedBlock(data)) {
                const cfg = parseRgbLedConfig(data.properties);
                const dynamic =
                  cfg.mode === "preset" &&
                  (cfg.preset === "color_cycle" ||
                    cfg.preset === "breathe" ||
                    cfg.preset === "blink");
                // Avoid baking Solid's properties.color into ledColor for dynamic presets —
                // leftover solid color made solid→color_cycle look stuck.
                return {
                  ledColor: dynamic ? rgbLedVisualAt(0, cfg, true).color : cfg.color,
                  rgbSwatch: {
                    mode: cfg.mode,
                    preset: cfg.preset,
                    color: cfg.color,
                    intensity: cfg.intensity,
                    speedMs: cfg.speedMs,
                  },
                };
              }
              return { ledColor: ledColorFromProperties(data.properties, "#F5C518") };
            })()
          : {}),
        ...accent,
        ...toggleWaveFields(data),
        ...ifOutputFields(data, locale),
        ...ifInputFields(node.id, data, graphState),
        ...relayCloseFields(data, locale),
        ...bayChromeFields(data),
      },
    };
  });
}

function bayChromeFields(
  data: DeviceProcessingNodeData,
): Pick<ProcessingNodeUiData, "bay" | "baySide"> {
  const entry = catalogEntryForNode(data);
  if (!entry || !isBayEntry(entry)) return {};
  const raw = isBlockNodeData(data) ? data.properties.bayRole : undefined;
  const baySide: BaySide | undefined =
    raw === "input" || raw === "output"
      ? raw
      : entry.bayIo === "input"
        ? "input"
        : "output";
  return { bay: true, baySide };
}

export function formatIfCondition(
  nodeId: string,
  data: DeviceProcessingNodeData,
  graphState: GraphState<"device-processing">,
  locale: LocaleId,
): string {
  const copy = processingGraphCopy(locale);
  if (!isCompareIf(data) || !isBlockNodeData(data)) return copy.ifConditionNone;
  const source = ifSourceKind(nodeId, {
    nodes: graphState.nodes as readonly {
      readonly id: string;
      readonly data: DeviceProcessingNodeData;
    }[],
    edges: graphState.edges,
  });
  if (source === "none") return copy.ifConditionNone;
  const op = compareSymbol(compareOpFromProperties(data.properties));
  if (ifInputType(data, source) === "analog") {
    const tempC = numberFromProperty(data.properties.compareTempC, 25);
    return `${copy.ifConditionTemp} ${op} ${tempC}°`;
  }
  const level = data.properties.compareLevel === "low" ? "LOW" : "HIGH";
  return `${copy.ifConditionToggle} ${op} ${level}`;
}

function compareSymbol(op: CompareOp): string {
  switch (op) {
    case "neq":
      return "≠";
    case "gt":
      return ">";
    case "gte":
      return "≥";
    case "lt":
      return "<";
    case "lte":
      return "≤";
    default:
      return "=";
  }
}

function formatRelayClose(data: DeviceProcessingNodeData, locale: LocaleId): string {
  const copy = processingGraphCopy(locale);
  const closeWhenHigh = isBlockNodeData(data) && data.properties.closeWhen !== "low";
  return `${copy.relayClosedIf} ${closeWhenHigh ? "HIGH" : "LOW"}`;
}

function relayCloseFields(
  data: DeviceProcessingNodeData,
  locale: LocaleId,
): Pick<ProcessingNodeUiData, "relayClose"> {
  if (!isRelayBlock(data) || !isBlockNodeData(data)) return {};
  return {
    relayClose: {
      closeWhenHigh: data.properties.closeWhen !== "low",
      label: formatRelayClose(data, locale),
    },
  };
}

function ifInputFields(
  nodeId: string,
  data: DeviceProcessingNodeData,
  graphState: GraphState<"device-processing">,
): Pick<ProcessingNodeUiData, "ifInput"> {
  if (!isCompareIf(data)) return {};
  const source = ifSourceKind(nodeId, {
    nodes: graphState.nodes as readonly {
      readonly id: string;
      readonly data: DeviceProcessingNodeData;
    }[],
    edges: graphState.edges,
  });
  return { ifInput: { kind: ifInputType(data, source) } };
}

function ifOutputFields(
  data: DeviceProcessingNodeData,
  locale: LocaleId,
): Pick<ProcessingNodeUiData, "ifOutput"> {
  if (!isCompareIf(data) || !isBlockNodeData(data)) return {};
  const kind = ifOutputType(data);
  const thenHigh =
    data.properties.thenOutput !== "low" && data.properties.thenOutput !== "false";
  const elseHigh = elseOutputFromProperties(data.properties) === "high";
  const copy = processingGraphCopy(locale);
  const level = (high: boolean) =>
    kind === "boolean" ? (high ? "true" : "false") : high ? "HIGH" : "LOW";
  return {
    ifOutput: {
      kind,
      thenHigh,
      elseHigh,
      thenElse: `${copy.ifThenShort} ${level(thenHigh)} · ${copy.ifElseShort} ${level(elseHigh)}`,
    },
  };
}

function toggleWaveFields(
  data: DeviceProcessingNodeData,
): Pick<ProcessingNodeUiData, "toggleWave"> {
  if (isSquareWave(data) && isBlockNodeData(data)) {
    const period = squareWavePeriodMs(data.properties);
    const duty = squareWaveDutyPercent(data.properties);
    return {
      toggleWave: {
        mode: "pulse_high",
        highTicks: duty,
        lowTicks: Math.max(1, 100 - duty),
        initialHigh: true,
        pulseMs: Math.max(1, Math.round((period * duty) / 100)),
      },
    };
  }
  if (!isDigitalOutToggle(data) || !isBlockNodeData(data)) return {};
  const hyst = hysteresisTicksFromProperties(data.properties);
  return {
    toggleWave: {
      mode: toggleModeFromProperties(data.properties),
      highTicks: hyst.highTicks,
      lowTicks: hyst.lowTicks,
      initialHigh: initialHighFromProperties(data.properties),
      pulseMs: pulseMsFromProperties(data.properties),
    },
  };
}

function blockAccentFields(
  data: DeviceProcessingNodeData,
): Pick<ProcessingNodeUiData, "accentColor" | "tileGlyph" | "circular"> {
  if (!isBlockNodeData(data)) return {};
  const visual =
    visualForCatalogEntryId(data.catalogEntryId) ??
    visualForCatalogEntryId(data.blockTypeId);
  if (!visual) return {};
  if (visual.solidSwatch) return {};
  if (visual.circular) {
    return { accentColor: visual.colorVar, circular: true };
  }
  return {
    accentColor: visual.colorVar,
    ...(visual.tileGlyph ? { tileGlyph: visual.tileGlyph } : {}),
  };
}

function localizeHandleLabels(
  handles: readonly {
    readonly id: string;
    readonly label?: string;
    readonly kind?: PortKind;
  }[],
  locale: LocaleId,
): readonly {
  readonly id: string;
  readonly label?: string;
  readonly kind?: PortKind;
}[] {
  return handles.map((handle) =>
    handle.label
      ? { ...handle, label: localizeCatalogText(handle.label, locale) }
      : handle,
  );
}

function applySelectedPortKinds(
  nodeId: string,
  data: DeviceProcessingNodeData,
  graphState: GraphState<"device-processing">,
  handles: readonly {
    readonly id: string;
    readonly label?: string;
    readonly kind?: PortKind;
  }[],
  side: "in" | "out",
): readonly {
  readonly id: string;
  readonly label?: string;
  readonly kind?: PortKind;
}[] {
  if (!isCompareIf(data) || !isBlockNodeData(data)) return handles;
  const source = ifSourceKind(nodeId, {
    nodes: graphState.nodes as readonly {
      readonly id: string;
      readonly data: DeviceProcessingNodeData;
    }[],
    edges: graphState.edges,
  });
  const kind: PortKind = side === "in" ? ifInputType(data, source) : ifOutputType(data);
  return handles.map((handle) => ({ ...handle, kind }));
}

function canvasTitle(
  data: DeviceProcessingNodeData,
  meta: AuthoringMetadata | undefined,
  locale: LocaleId,
): string {
  if (isBlockNodeData(data) && ["ui.manual_trigger", "ab.square_wave"].includes(data.blockTypeId) &&
      (!meta?.comment || ["Genera trigger", "Generatore di segnali", "Generatore di trigger"].includes(meta.comment.trim())) && data.blockTypeId === "ui.manual_trigger") return locale === "it" ? "Attiva azione" : "Activate action";
  if (meta?.comment && meta.comment.trim() !== "") return meta.comment.trim();
  const entry = catalogEntryForNode(data);
  if (entry) return localizeCatalogEntry(entry, locale).label;
  return PROCESSING_NODE_KIND_CONFIG[data.kind].label;
}

function subtitleFor(
  nodeId: string,
  data: DeviceProcessingNodeData,
  graphState: GraphState<"device-processing">,
  titles: ReadonlyMap<string, string>,
  moduleLabel: (moduleNodeId: string) => string,
  fieldLabel: (moduleNodeId: string, fieldId: number) => string,
  outputNames: ReadonlyMap<string, ReadonlyMap<string, string>>,
  locale: LocaleId,
): string {
  const rawEntry = catalogEntryForNode(data);
  const entry = rawEntry ? localizeCatalogEntry(rawEntry, locale) : undefined;
  const copy = processingGraphCopy(locale);
  const placedId =
    data.kind === "block" || data.kind === "event-source"
      ? data.catalogEntryId
      : undefined;
  const placed = placedId ? entry : undefined;
  const fromFields = placed?.fields?.length
    ? formatFieldsSubtitle(placed.fields, propertiesOf(data))
    : undefined;

  if (data.kind === "schedule")
    return `${moduleLabel(data.moduleNodeId)} · ${copy.everyMs(data.periodMs)}${data.enabled ? "" : ` · ${copy.disabledSuffix}`}`;
  if (data.kind === "event-source") {
    const module =
      data.moduleNodeId.trim() !== "" ? moduleLabel(data.moduleNodeId) : undefined;
    return (
      [fromFields, module]
        .filter((part): part is string => Boolean(part))
        .join(" · ") ||
      entry?.subtitle ||
      "—"
    );
  }
  if (isBlockNodeData(data)) {
    if (data.blockTypeId === SEQUENCE_TYPE)
      return `${sequenceSteps(data.properties).length} ${sequenceSteps(data.properties).length === 1 ? "passo" : "passi"}${data.properties.repeat ? " · Ripeti" : ""}`;
    if (typeof data.properties[SENSOR_ACTION_ID_PROP] === "string") {
      const channels = channelsFromNodeProperties(data.properties);
      if (data.properties[SENSOR_INSTANCE_PROP] === true)
        return String(data.properties[SENSOR_ACTION_LABEL_PROP] ?? "");
      return channels.length
        ? channels.map((c) => `${c.label}${c.unit ? ` (${c.unit})` : ""}`).join(" · ")
        : locale === "it"
          ? "Azione di scrittura"
          : "Write action";
    }
    if (isCompareIf(data)) return formatIfCondition(nodeId, data, graphState, locale);
    if (isRelayBlock(data)) return formatRelayClose(data, locale);
    if (isDigitalOutToggle(data)) return "";
    if (isSquareWave(data) && isBlockNodeData(data)) {
      const period = squareWavePeriodMs(data.properties);
      const duty = squareWaveDutyPercent(data.properties);
      return `${locale === "it" ? "Acceso" : "On"} ${(period * duty / 100000).toLocaleString(locale)} s · ${locale === "it" ? "spento" : "off"} ${(period * (100 - duty) / 100000).toLocaleString(locale)} s`;
    }
    const input = incomingLabel(nodeId, graphState, titles, outputNames);
    if (data.blockTypeId === "logic_if") {
      const presentation = logicIfPresentation(data, input, locale);
      return `${presentation.condition} → ${locale === "it" ? "vera" : "true"}: ${presentation.whenTrue} · ${locale === "it" ? "falsa" : "false"}: ${presentation.whenFalse}`;
    }
    const bay = entry && isBayEntry(entry);
    const rawRole = data.properties.bayRole;
    const baySide: BaySide | undefined =
      rawRole === "input" || rawRole === "output"
        ? rawRole
        : entry?.bayIo === "input"
          ? "input"
          : bay
            ? "output"
            : undefined;
    const bayPrefix =
      bay && baySide ? `Bay · ${localizedBaySideLabel(baySide, locale)}` : undefined;
    // Terminal / RGB: keep subtitle short (details live in inspector / handles).
    if (
      entry?.id === "appblocks.terminal_block" ||
      entry?.typeId === "ab.terminal_block"
    ) {
      return bayPrefix ? `${bayPrefix} · ${copy.sixChannels}` : copy.sixChannels;
    }
    if (entry?.id === "appblocks.rgb_led" || entry?.typeId === "ab.rgb_led") {
      return rgbLedSubtitle(parseRgbLedConfig(data.properties), locale);
    }
    if (fromFields) {
      const body = input ? `${input} ${fromFields}` : fromFields;
      return bayPrefix ? `${bayPrefix} · ${body}` : body;
    }
    const fallback =
      formatConfiguredSubtitle(
        "block",
        data.blockTypeId,
        data.properties,
        input,
        locale,
      ) ??
      entry?.subtitle ??
      entry?.label ??
      (data.blockTypeId !== "" ? data.blockTypeId : "—");
    return bayPrefix ? `${bayPrefix} · ${fallback}` : fallback;
  }
  if (isRuleNodeData(data)) {
    const source = data.sourceReference
      ? `${moduleLabel(data.sourceReference.moduleNodeId)}.${fieldLabel(data.sourceReference.moduleNodeId, data.sourceReference.fieldId)}`
      : undefined;
    return (
      formatConfiguredSubtitle(
        "rule",
        data.ruleTypeId,
        data.properties,
        source,
        locale,
      ) ??
      entry?.subtitle ??
      entry?.label ??
      "—"
    );
  }
  return moduleReferenceOf(data) ?? "—";
}

function incomingLabel(
  nodeId: string,
  graphState: GraphState<"device-processing">,
  titles: ReadonlyMap<string, string>,
  outputNames: ReadonlyMap<string, ReadonlyMap<string, string>>,
): string | undefined {
  const names = [
    ...new Set(
      graphState.edges
        .filter((edge) => edge.target === nodeId)
        .map((edge) => (outputNames.get(edge.source)?.get(edge.sourceHandle ?? "0") ?? titles.get(edge.source))?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  if (names.length === 0) return undefined;
  return names.join(", ");
}

function logicIfPresentation(data: Extract<DeviceProcessingNodeData, { kind: "block" }>, input: string | undefined, locale: LocaleId) {
  const op = Number(data.properties.condition ?? 1);
  const operator = [locale === "it" ? "è falso" : "is false", locale === "it" ? "è vero" : "is true", "=", "≠", ">", "≥", "<", "≤"][op] ?? "";
  const high = locale === "it" ? "Alto" : "High";
  const low = locale === "it" ? "Basso" : "Low";
  return {
    condition: `${input ?? (locale === "it" ? "Valore" : "Value")} ${operator}${op >= 2 ? ` ${String(data.properties.value ?? 0)}` : ""}`,
    whenTrue: data.properties.whenTrue === "low" ? low : high,
    whenFalse: data.properties.whenFalse === "high" ? high : low,
  };
}
