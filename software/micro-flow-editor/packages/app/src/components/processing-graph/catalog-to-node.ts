import type { DeviceProcessingNodeData } from "@spaghettilab/device-processing-graph-model";
import {
  defaultPropertiesFromFields,
  isBayEntry,
  isPlaceableOnDeviceGraph,
  type ProcessingCatalogEntry,
} from "@spaghettilab/processing-block-catalog";
import type { BaySide } from "@spaghettilab/processing-block-catalog";
import { withThresholdFirmwareFields } from "./threshold-rule-fields.js";
import { bayPropertiesForPlace } from "./palette-placeables.js";

export { PROCESSING_BLOCK_MIME, decodePaletteDrag, encodePaletteDrag, type PaletteDragPayload } from "./palette-placeables.js";

let paletteDragNodeKind: DeviceProcessingNodeData["kind"] | undefined;
let paletteDragBaySide: BaySide | undefined;

export function beginPaletteDrag(kind: DeviceProcessingNodeData["kind"] | undefined, baySide?: BaySide): void {
  paletteDragNodeKind = kind;
  paletteDragBaySide = baySide;
}

export function endPaletteDrag(): void {
  paletteDragNodeKind = undefined;
  paletteDragBaySide = undefined;
}

export function peekPaletteDragKind(): DeviceProcessingNodeData["kind"] | undefined {
  return paletteDragNodeKind;
}

export function peekPaletteDragBaySide(): BaySide | undefined {
  return paletteDragBaySide;
}

export function nodeDataFromCatalogEntry(
  entry: ProcessingCatalogEntry,
  firstModuleId: string | undefined,
  baySide?: BaySide,
): DeviceProcessingNodeData | null {
  if (!isPlaceableOnDeviceGraph(entry) || entry.nodeKind === undefined) return null;
  switch (entry.nodeKind) {
    case "schedule":
      return { kind: "schedule", moduleNodeId: firstModuleId ?? "", periodMs: 1000, enabled: true };
    case "event-source":
      return {
        kind: "event-source",
        moduleNodeId: entry.needsModule === false ? "" : (firstModuleId ?? ""),
        catalogEntryId: entry.id,
        properties: defaultPropertiesFromFields(entry.fields ?? []),
      };
    case "block": {
      const base = defaultPropertiesFromFields(entry.fields ?? []);
      const bayProps = bayPropertiesForPlace(entry, baySide ?? (isBayEntry(entry) ? "output" : undefined));
      return {
        kind: "block",
        blockTypeId: entry.typeId ?? "",
        catalogEntryId: entry.id,
        properties: { ...base, ...bayProps },
      };
    }
    case "rule":
      return {
        kind: "rule",
        ruleTypeId: entry.typeId ?? "",
        properties:
          entry.typeId === "threshold"
            ? withThresholdFirmwareFields(defaultPropertiesFromFields(entry.fields ?? []))
            : defaultPropertiesFromFields(entry.fields ?? []),
      };
  }
}

/** Keep a custom name; follow the catalog when the label was still the previous type. */
export function commentAfterCatalogChange(
  currentComment: string,
  previousLabel: string | undefined,
  nextLabel: string | undefined,
): string {
  if (!nextLabel) return currentComment;
  const trimmed = currentComment.trim();
  if (trimmed === "" || trimmed === previousLabel) return nextLabel;
  return currentComment;
}

export function snapToGrid(value: number, grid = 20): number {
  return Math.round(value / grid) * grid;
}

/**
 * Blocks placed by clicking a palette entry (as opposed to dragging one onto
 * a chosen canvas spot) have no drop coordinate to snap to — cascading them
 * by node count keeps each new block visible instead of stacking every one
 * at the same fixed point, which reads as a single overlapping mess and
 * makes it look like earlier blocks vanished.
 */
export function nextSpawnPosition(existingNodeCount: number, perRow = 4, colStep = 260, rowStep = 80): { x: number; y: number } {
  const col = existingNodeCount % perRow;
  const row = Math.floor(existingNodeCount / perRow);
  return { x: 80 + col * colStep, y: 80 + row * rowStep };
}
