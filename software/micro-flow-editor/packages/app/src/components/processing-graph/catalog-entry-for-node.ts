import { readLedDriver } from "../../lib/led-driver.js";
import type { DeviceProcessingNodeData } from "@spaghettilab/device-processing-graph-model";
import {
  findCatalogEntriesByTypeId,
  findCatalogEntryById,
  type ProcessingCatalogEntry,
} from "@spaghettilab/processing-block-catalog";
import { catalogEntryWithSensorChannels } from "../../lib/backbone-sensor-block.js";

/** Catalog row this canvas node was placed from, or the firmware type_id fallback. */
export function catalogEntryForNode(
  data: DeviceProcessingNodeData,
): ProcessingCatalogEntry | undefined {
  let entry: ProcessingCatalogEntry | undefined;
  if (data.kind === "event-source" && data.catalogEntryId) {
    entry = findCatalogEntryById(data.catalogEntryId);
  } else if (data.kind === "block" && data.catalogEntryId) {
    entry = findCatalogEntryById(data.catalogEntryId);
  } else if (data.kind === "block") {
    entry = pickCatalogEntry(findCatalogEntriesByTypeId(data.blockTypeId), "block");
  } else if (data.kind === "rule") {
    entry = pickCatalogEntry(findCatalogEntriesByTypeId(data.ruleTypeId), "rule");
  } else if (data.kind === "event-source") {
    entry = findCatalogEntryById("native.event-source");
  } else {
    entry = findCatalogEntryById("native.schedule");
  }

  if (entry && data.kind === "block") {
    if (data.blockTypeId === "led_driver")
      return {
        ...entry,
        outputs:
          readLedDriver(data.properties).outputMode === "rgb"
            ? ["Rosso (%)", "Verde (%)", "Blu (%)"].map((label, index) => ({
                direction: "out" as const,
                id: String(index + 1),
                label,
                types: [
                  {
                    domain: "analog" as const,
                    role: "comando" as const,
                    range: { min: 0, max: 100 },
                  },
                ],
              }))
            : [
                {
                  direction: "out" as const,
                  id: "0",
                  label: "Colore",
                  types: [{ domain: "text" as const, role: "comando" as const }],
                },
              ],
        inputs: readLedDriver(data.properties).presets.map((p) => ({
          direction: "in" as const,
          id: p.id,
          label: p.name,
          types: [
            { domain: "digital" as const, role: "comando" as const },
            { domain: "activation" as const, role: "trigger" as const },
            { domain: "event" as const, role: "trigger" as const },
          ],
        })),
      };
    if (data.properties.statusLed === true)
      return {
        ...entry,
        inputs: [
          {
            direction: "in",
            id: "0",
            label: "Accendi / spegni",
            types: [{ domain: "digital", role: "comando" }],
          },
          {
            direction: "in",
            id: "1",
            label: "Accendi",
            types: [
              { domain: "event", role: "comando" },
              { domain: "digital", role: "comando" },
            ],
          },
          {
            direction: "in",
            id: "2",
            label: "Spegni",
            types: [
              { domain: "event", role: "comando" },
              { domain: "digital", role: "comando" },
            ],
          },
          {
            direction: "in",
            id: "3",
            label: "Imposta intensità",
            types: [
              { domain: "event", role: "comando" },
              { domain: "digital", role: "comando" },
            ],
          },
          {
            direction: "in",
            id: "4",
            label: "Ricevi intensità (%)",
            types: [{ domain: "analog", role: "comando" }],
          },
        ],
        outputs: [
          {
            direction: "out",
            id: "0",
            label: "È acceso",
            types: [{ domain: "digital", role: "misura" }],
          },
          {
            direction: "out",
            id: "1",
            label: "Intensità attuale (%)",
            types: [{ domain: "analog", role: "misura" }],
          },
        ],
      };
    return catalogEntryWithSensorChannels(entry, data.properties);
  }
  return entry;
}

function pickCatalogEntry(
  entries: readonly ProcessingCatalogEntry[],
  kind: "block" | "rule",
): ProcessingCatalogEntry | undefined {
  const ofKind = entries.filter((entry) => entry.nodeKind === kind);
  return (
    ofKind.find(
      (entry) => entry.availability === "shipped" && (entry.fields?.length ?? 0) > 0,
    ) ??
    ofKind.find((entry) => entry.availability === "shipped") ??
    ofKind.find((entry) => (entry.fields?.length ?? 0) > 0) ??
    ofKind[0] ??
    entries[0]
  );
}

export function propertiesOf(
  data: DeviceProcessingNodeData,
): Readonly<Record<string, unknown>> {
  if (data.kind === "block" || data.kind === "rule") return data.properties;
  if (data.kind === "event-source") return data.properties ?? {};
  return {};
}
