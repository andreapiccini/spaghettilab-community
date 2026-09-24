import { CirclePlay, ToggleLeft, type LucideIcon } from "lucide-react";
import { DIGITAL_OUT_TOGGLE_IDS, FLOW_START_IDS, LED_BLOCK_IDS } from "./dry-run-preview.js";

/**
 * Per-catalog accent colors / icons that override the generic `block` kind
 * (teal + SlidersHorizontal). LED keeps a solid swatch; Digital Out Toggle
 * gets a toggle glyph; Flow Start is a circular entry node.
 */
export type CatalogBlockVisual = {
  readonly colorVar: string;
  readonly icon: LucideIcon;
  /** LED: filled swatch, no glyph. */
  readonly solidSwatch?: boolean;
  /** Flow Start: circular canvas node. */
  readonly circular?: boolean;
};

const DIGITAL_OUT_TOGGLE_VISUAL: CatalogBlockVisual = {
  colorVar: "#EA580C",
  icon: ToggleLeft,
};

const FLOW_START_VISUAL: CatalogBlockVisual = {
  colorVar: "#16A34A",
  icon: CirclePlay,
  circular: true,
};

export function visualForCatalogEntryId(entryId: string | undefined): CatalogBlockVisual | undefined {
  if (!entryId) return undefined;
  if (FLOW_START_IDS.has(entryId)) return FLOW_START_VISUAL;
  if (DIGITAL_OUT_TOGGLE_IDS.has(entryId)) return DIGITAL_OUT_TOGGLE_VISUAL;
  if (LED_BLOCK_IDS.has(entryId)) {
    return { colorVar: "#F5C518", icon: ToggleLeft, solidSwatch: true };
  }
  return undefined;
}
