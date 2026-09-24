import type { AuthoringMetadata, GraphState } from "@spaghettilab/domain";
import { isBlockNodeData, isRuleNodeData, moduleReferenceOf, type DeviceProcessingNodeData } from "@spaghettilab/device-processing-graph-model";
import { baySideLabel, formatFieldsSubtitle, isBayEntry, type BaySide } from "@spaghettilab/processing-block-catalog";
import type { Node } from "@xyflow/react";
import { catalogEntryForNode, propertiesOf } from "./catalog-entry-for-node.js";
import { formatConfiguredSubtitle } from "./configured-subtitle.js";
import { visualForCatalogEntryId, type CatalogTileGlyph } from "./block-visuals.js";
import { hysteresisTicksFromProperties, initialHighFromProperties, isDigitalOutToggle, isFlowStartBlock, isLedBlock, isRgbLedBlock, ledColorFromProperties, pulseMsFromProperties, toggleModeFromProperties } from "./dry-run-preview.js";
import { parseRgbLedConfig, rgbLedSubtitle } from "./rgb-led-model.js";
import { FLOW_START_SIZE } from "./layout-constants.js";
import { PROCESSING_NODE_KIND_CONFIG } from "./node-kinds.js";
import { portsForNode, nodeHeightForPorts, nodeWidthForPorts } from "./node-ports.js";

export type ToggleWaveUi = {
  readonly mode: "astable" | "pulse_high" | "pulse_low";
  readonly highTicks: number;
  readonly lowTicks: number;
  readonly initialHigh: boolean;
  readonly pulseMs: number;
};

export type ProcessingNodeUiData = {
  readonly domainId: string;
  readonly kind: DeviceProcessingNodeData["kind"];
  readonly label: string;
  readonly subtitle: string;
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
  readonly inputHandles?: readonly { readonly id: string; readonly label?: string }[];
  /** Catalog output handles (multi-port cards). */
  readonly outputHandles?: readonly { readonly id: string; readonly label?: string }[];
  /** Measured card height when stacked handles need more than NODE_HEIGHT. */
  readonly cardHeight?: number;
  /** Measured card width for multi-channel bay cards. */
  readonly cardWidth?: number;
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
  fieldLabel: (moduleNodeId: string, fieldId: number) => string = (_moduleNodeId, fieldId) => String(fieldId),
  previewActiveIds: ReadonlySet<string> = new Set(),
): Node<ProcessingNodeUiData>[] {
  const titles = new Map<string, string>();
  for (const node of graphState.nodes) {
    titles.set(node.id, canvasTitle(node.data as DeviceProcessingNodeData, authoringMetadata[node.id]));
  }

  return graphState.nodes.map((node) => {
    const meta = authoringMetadata[node.id];
    const data = node.data as DeviceProcessingNodeData;
    const accent = blockAccentFields(data);
    const isTick = accent.circular === true || (isBlockNodeData(data) && isFlowStartBlock(data));
    const ports = portsForNode(data);
    const cardHeight = isTick ? FLOW_START_SIZE : nodeHeightForPorts(ports);
    const cardWidth = isTick ? FLOW_START_SIZE : nodeWidthForPorts(ports);
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
      width: cardWidth,
      height: cardHeight,
      data: {
        domainId: node.id,
        kind: data.kind,
        label: titles.get(node.id) ?? PROCESSING_NODE_KIND_CONFIG[data.kind].label,
        subtitle: subtitleFor(node.id, data, graphState, titles, moduleLabel, fieldLabel),
        hasError: errorNodeIds.has(node.id),
        hasInput: ports.hasInput,
        hasOutput: ports.hasOutput,
        inputHandles: ports.inputs,
        outputHandles: ports.outputs,
        cardHeight,
        cardWidth,
        previewActive: previewActiveIds.has(node.id),
        ...(isBlockNodeData(data) && (isLedBlock(data) || isRgbLedBlock(data))
          ? (() => {
              if (isRgbLedBlock(data)) {
                const cfg = parseRgbLedConfig(data.properties);
                return {
                  ledColor: cfg.color,
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
        ...bayChromeFields(data),
      },
    };
  });
}

function bayChromeFields(data: DeviceProcessingNodeData): Pick<ProcessingNodeUiData, "bay" | "baySide"> {
  const entry = catalogEntryForNode(data);
  if (!entry || !isBayEntry(entry)) return {};
  const raw = isBlockNodeData(data) ? data.properties.bayRole : undefined;
  const baySide: BaySide | undefined = raw === "input" || raw === "output" ? raw : entry.bayIo === "input" ? "input" : "output";
  return { bay: true, baySide };
}

function toggleWaveFields(data: DeviceProcessingNodeData): Pick<ProcessingNodeUiData, "toggleWave"> {
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
  const visual = visualForCatalogEntryId(data.catalogEntryId) ?? visualForCatalogEntryId(data.blockTypeId);
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

function canvasTitle(data: DeviceProcessingNodeData, meta: AuthoringMetadata | undefined): string {
  if (meta?.comment && meta.comment.trim() !== "") return meta.comment.trim();
  const entry = catalogEntryForNode(data);
  if (entry) return entry.label;
  return PROCESSING_NODE_KIND_CONFIG[data.kind].label;
}

function subtitleFor(
  nodeId: string,
  data: DeviceProcessingNodeData,
  graphState: GraphState<"device-processing">,
  titles: ReadonlyMap<string, string>,
  moduleLabel: (moduleNodeId: string) => string,
  fieldLabel: (moduleNodeId: string, fieldId: number) => string,
): string {
  const entry = catalogEntryForNode(data);
  const placedId = data.kind === "block" || data.kind === "event-source" ? data.catalogEntryId : undefined;
  const placed = placedId ? entry : undefined;
  const fromFields = placed?.fields?.length ? formatFieldsSubtitle(placed.fields, propertiesOf(data)) : undefined;

  if (data.kind === "schedule") return `${moduleLabel(data.moduleNodeId)} · ogni ${data.periodMs}ms${data.enabled ? "" : " · disabilitato"}`;
  if (data.kind === "event-source") {
    const module = data.moduleNodeId.trim() !== "" ? moduleLabel(data.moduleNodeId) : undefined;
    return [fromFields, module].filter((part): part is string => Boolean(part)).join(" · ") || entry?.subtitle || "—";
  }
  if (isBlockNodeData(data)) {
    const input = incomingLabel(nodeId, graphState, titles);
    const bay = entry && isBayEntry(entry);
    const rawRole = data.properties.bayRole;
    const baySide: BaySide | undefined = rawRole === "input" || rawRole === "output" ? rawRole : entry?.bayIo === "input" ? "input" : bay ? "output" : undefined;
    const bayPrefix = bay && baySide ? `Bay · ${baySideLabel(baySide)}` : undefined;
    // Terminal / RGB: keep subtitle short (details live in inspector / handles).
    if (entry?.id === "appblocks.terminal_block" || entry?.typeId === "ab.terminal_block") {
      return bayPrefix ? `${bayPrefix} · 6 canali` : "6 canali";
    }
    if (entry?.id === "appblocks.rgb_led" || entry?.typeId === "ab.rgb_led") {
      return rgbLedSubtitle(parseRgbLedConfig(data.properties));
    }
    if (fromFields) {
      const body = input ? `${input} ${fromFields}` : fromFields;
      return bayPrefix ? `${bayPrefix} · ${body}` : body;
    }
    const fallback =
      formatConfiguredSubtitle("block", data.blockTypeId, data.properties, input) ??
      entry?.subtitle ??
      entry?.label ??
      (data.blockTypeId !== "" ? data.blockTypeId : "—");
    return bayPrefix ? `${bayPrefix} · ${fallback}` : fallback;
  }
  if (isRuleNodeData(data)) {
    const source = data.sourceReference
      ? `${moduleLabel(data.sourceReference.moduleNodeId)}.${fieldLabel(data.sourceReference.moduleNodeId, data.sourceReference.fieldId)}`
      : undefined;
    return formatConfiguredSubtitle("rule", data.ruleTypeId, data.properties, source) ?? entry?.subtitle ?? entry?.label ?? "—";
  }
  return moduleReferenceOf(data) ?? "—";
}

function incomingLabel(nodeId: string, graphState: GraphState<"device-processing">, titles: ReadonlyMap<string, string>): string | undefined {
  const names = [
    ...new Set(
      graphState.edges
        .filter((edge) => edge.target === nodeId)
        .map((edge) => titles.get(edge.source)?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ];
  if (names.length === 0) return undefined;
  return names.join(", ");
}
