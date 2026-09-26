import { Cable, GitBranch, Palette, Power, Thermometer, ToggleLeft, type LucideIcon } from "lucide-react";
import {
  COMPARE_IF_IDS,
  DIGITAL_OUT_TOGGLE_IDS,
  FLOW_START_IDS,
  LED_BLOCK_IDS,
  RELAY_BLOCK_IDS,
  RGB_LED_BLOCK_IDS,
  TEMPERATURE_SENSOR_IDS,
  TERMINAL_BLOCK_IDS,
} from "./dry-run-preview.js";

/**
 * Per-catalog accent colors / icons that override the generic `block` kind
 * (teal + SlidersHorizontal). LED keeps a solid swatch; Digital Out Toggle
 * gets a toggle glyph; Flow Start is a bare dark-violet disc (Schedule tick).
 */
export type CatalogTileGlyph = "toggle" | "palette" | "power" | "cable" | "if" | "thermometer";

export type CatalogBlockVisual = {
  readonly colorVar: string;
  readonly icon: LucideIcon;
  /** LED: filled swatch, no glyph. */
  readonly solidSwatch?: boolean;
  /** Flow Start: small circular canvas node, no label. */
  readonly circular?: boolean;
  /** Canvas tile glyph override (when not solidSwatch / circular). */
  readonly tileGlyph?: CatalogTileGlyph;
};

/** Darker than Schedule `#7C5CFC` — the movable tick plug inside the box. */
export const FLOW_START_COLOR = "#4C2FB8";

const DIGITAL_OUT_TOGGLE_VISUAL: CatalogBlockVisual = {
  colorVar: "#EA580C",
  icon: ToggleLeft,
  tileGlyph: "toggle",
};

const FLOW_START_VISUAL: CatalogBlockVisual = {
  colorVar: FLOW_START_COLOR,
  icon: ToggleLeft,
  circular: true,
};

const RGB_LED_VISUAL: CatalogBlockVisual = {
  colorVar: "#E11D48",
  icon: Palette,
  solidSwatch: true,
};

const RELAY_VISUAL: CatalogBlockVisual = {
  colorVar: "#64748B",
  icon: Power,
  tileGlyph: "power",
};

const COMPARE_IF_VISUAL: CatalogBlockVisual = {
  colorVar: "#4F46E5",
  icon: GitBranch,
  tileGlyph: "if",
};

const TEMPERATURE_VISUAL: CatalogBlockVisual = {
  colorVar: "#0EA5E9",
  icon: Thermometer,
  tileGlyph: "thermometer",
};

const TERMINAL_BLOCK_VISUAL: CatalogBlockVisual = {
  colorVar: "#0F766E",
  icon: Cable,
  tileGlyph: "cable",
};

export function visualForCatalogEntryId(entryId: string | undefined): CatalogBlockVisual | undefined {
  if (!entryId) return undefined;
  if (FLOW_START_IDS.has(entryId)) return FLOW_START_VISUAL;
  if (DIGITAL_OUT_TOGGLE_IDS.has(entryId)) return DIGITAL_OUT_TOGGLE_VISUAL;
  if (LED_BLOCK_IDS.has(entryId)) {
    return { colorVar: "#F5C518", icon: ToggleLeft, solidSwatch: true };
  }
  if (RGB_LED_BLOCK_IDS.has(entryId)) return RGB_LED_VISUAL;
  if (RELAY_BLOCK_IDS.has(entryId)) return RELAY_VISUAL;
  if (COMPARE_IF_IDS.has(entryId)) return COMPARE_IF_VISUAL;
  if (TEMPERATURE_SENSOR_IDS.has(entryId)) return TEMPERATURE_VISUAL;
  if (TERMINAL_BLOCK_IDS.has(entryId)) return TERMINAL_BLOCK_VISUAL;
  return undefined;
}
