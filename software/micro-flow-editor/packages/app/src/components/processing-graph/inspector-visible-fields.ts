import type { CatalogField, ProcessingCatalogEntry } from "@spaghettilab/processing-block-catalog";
import { DIGITAL_OUT_TOGGLE_IDS, LED_BLOCK_IDS } from "./dry-run-preview.js";

/** Visitor-facing Digital Out Toggle settings. `line` and `pulseMs` stay on the model. */
export const DIGITAL_OUT_TOGGLE_INSPECTOR_FIELD_IDS = ["toggleMode", "initial", "lowToHigh", "highToLow"] as const;

/** Visitor-facing LED settings. `threshold` and `negated` stay on the model. */
export const LED_INSPECTOR_FIELD_IDS = ["color", "delayOnMs", "delayOffMs", "softOnMs", "softOffMs"] as const;

function entryMatches(entry: ProcessingCatalogEntry | undefined, ids: ReadonlySet<string>): boolean {
  if (!entry) return false;
  if (ids.has(entry.id)) return true;
  return Boolean(entry.typeId && ids.has(entry.typeId));
}

function allowlistFor(entry: ProcessingCatalogEntry | undefined): ReadonlySet<string> | undefined {
  if (entryMatches(entry, DIGITAL_OUT_TOGGLE_IDS)) return new Set(DIGITAL_OUT_TOGGLE_INSPECTOR_FIELD_IDS);
  if (entryMatches(entry, LED_BLOCK_IDS)) return new Set(LED_INSPECTOR_FIELD_IDS);
  return undefined;
}

/**
 * Named inspector fields for a catalog block. Hidden ids keep their catalog
 * defaults on the node so Dry-run / firmware still have values.
 */
export function inspectorVisibleFields(
  entry: ProcessingCatalogEntry | undefined,
  fields: readonly CatalogField[],
): readonly CatalogField[] {
  const allowed = allowlistFor(entry);
  if (!allowed) return fields;
  return fields
    .filter((field) => allowed.has(field.id))
    .map((field) => (field.when ? { ...field, when: undefined } : field));
}
