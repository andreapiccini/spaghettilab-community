import {
  bayChoiceHint,
  bayFamilyIdOf,
  baySideLabel,
  baySidesForEntry,
  blockFamilyOf,
  isBayEntry,
  type BaySide,
  type ProcessingCatalogEntry,
} from "@spaghettilab/processing-block-catalog";

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
export function expandPalettePlaceables(entries: readonly ProcessingCatalogEntry[]): readonly PalettePlaceable[] {
  const rows: PalettePlaceable[] = [];
  for (const entry of entries) {
    if (!isBayEntry(entry)) {
      rows.push({
        entry,
        rowKey: entry.id,
        label: entry.label,
        subtitle: entry.subtitle,
      });
      continue;
    }
    const sides = baySidesForEntry(entry);
    const hint = bayChoiceHint(entry);
    for (const side of sides) {
      const sideLabel = baySideLabel(side);
      rows.push({
        entry,
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
