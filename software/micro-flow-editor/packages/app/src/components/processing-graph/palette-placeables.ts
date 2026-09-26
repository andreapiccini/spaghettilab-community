import {
  bayFamilyIdOf,
  baySidesForEntry,
  blockFamilyOf,
  isBayEntry,
  type BaySide,
  type ProcessingCatalogEntry,
} from "@spaghettilab/processing-block-catalog";
import { localizeCatalogEntry, localizedBayChoiceHint, localizedBaySideLabel } from "../../lib/processing-catalog-copy.js";
import type { LocaleId } from "../../lib/locale.js";

export const PROCESSING_BLOCK_MIME = "application/x-spaghettilab-processing-block";

export type PaletteDragPayload = {
  readonly entryId: string;
  /** Set when dragging a bay half (ingresso / uscita). */
  readonly baySide?: BaySide;
};

export function encodePaletteDrag(payload: PaletteDragPayload): string {
  return JSON.stringify(payload);
}

export function decodePaletteDrag(raw: string): PaletteDragPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && "entryId" in parsed && typeof (parsed as PaletteDragPayload).entryId === "string") {
      const p = parsed as PaletteDragPayload;
      if (p.baySide === "input" || p.baySide === "output" || p.baySide === undefined) return p;
    }
  } catch {
    // Legacy: plain catalog entry id.
  }
  return { entryId: raw };
}

export type PalettePlaceable = {
  readonly entry: ProcessingCatalogEntry;
  readonly baySide?: BaySide;
  readonly rowKey: string;
  readonly label: string;
  readonly subtitle: string;
};

/** Expand bay both/either into separate palette rows; functionality stays one row. */
export function expandPalettePlaceables(
  entries: readonly ProcessingCatalogEntry[],
  locale: LocaleId = "it",
): readonly PalettePlaceable[] {
  const rows: PalettePlaceable[] = [];
  for (const raw of entries) {
    const entry = localizeCatalogEntry(raw, locale);
    if (!isBayEntry(entry)) {
      rows.push({
        entry: raw,
        rowKey: entry.id,
        label: entry.label,
        subtitle: entry.subtitle,
      });
      continue;
    }
    const sides = baySidesForEntry(entry);
    const hint = localizedBayChoiceHint(entry.bayIo, locale);
    for (const side of sides) {
      const sideLabel = localizedBaySideLabel(side, locale);
      rows.push({
        entry: raw,
        baySide: side,
        rowKey: `${entry.id}::${side}`,
        label: sides.length > 1 ? `${entry.label} · ${sideLabel}` : entry.label,
        subtitle: hint ? `${hint} · ${entry.subtitle}` : `Bay · ${sideLabel} · ${entry.subtitle}`,
      });
    }
  }
  return rows;
}

export function groupPlaceablesByFamily(
  placeables: readonly PalettePlaceable[],
): { readonly functionality: readonly PalettePlaceable[]; readonly bay: readonly PalettePlaceable[] } {
  const functionality: PalettePlaceable[] = [];
  const bay: PalettePlaceable[] = [];
  for (const row of placeables) {
    if (blockFamilyOf(row.entry) === "bay") bay.push(row);
    else functionality.push(row);
  }
  return { functionality, bay };
}

export function bayPropertiesForPlace(entry: ProcessingCatalogEntry, baySide: BaySide | undefined): Record<string, string | number | boolean> {
  if (!isBayEntry(entry) || !baySide) return {};
  return {
    bayRole: baySide,
    bayFamilyId: bayFamilyIdOf(entry),
  };
}
