import type { ProjectV1 } from "@spaghettilab/domain";
import {
  BACKBONE_SENSOR_MODULES_META_KEY,
  parseBackboneSensorModules,
} from "./backbone-sensor-modules.js";
import {
  DEVICE_RECIPE_DRAFT_META_KEY,
  migrateDraft,
  parseDeviceRecipeDraft,
  type DeviceRecipeDraft,
} from "./device-recipe-draft.js";

export const DEVICE_DRIVER_LIBRARY_META_KEY = "__deviceDriverLibrary";
export function savedDeviceDrivers(
  metadata: ProjectV1["authoringMetadata"],
): readonly DeviceRecipeDraft[] {
  const drivers = new Map<string, DeviceRecipeDraft>();
  const add = (draft: DeviceRecipeDraft | undefined | null) => {
    if (!draft?.id || !Array.isArray(draft.commands)) return;
    const existing = drivers.get(draft.id);
    if (!existing || draft.updatedAt >= existing.updatedAt)
      drivers.set(draft.id, migrateDraft(draft));
  };
  try {
    const saved: unknown = JSON.parse(
      metadata[DEVICE_DRIVER_LIBRARY_META_KEY]?.comment ?? "[]",
    );
    if (Array.isArray(saved)) saved.forEach((draft) => add(draft));
  } catch {
    /* Older projects have no driver library. */
  }
  const modules = parseBackboneSensorModules(
    metadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment,
  );
  Object.values(modules.byBinding)
    .flat()
    .forEach((module) => {
      add(module.recipe.deviceDraft);
      module.actions?.forEach((action) => add(action.deviceDraft));
    });
  add(parseDeviceRecipeDraft(metadata[DEVICE_RECIPE_DRAFT_META_KEY]?.comment));
  return [...drivers.values()].sort((a, b) => a.name.localeCompare(b.name));
}
export function saveDriverMetadata(
  metadata: ProjectV1["authoringMetadata"],
  draft: DeviceRecipeDraft,
) {
  const saved = savedDeviceDrivers(metadata).filter((driver) => driver.id !== draft.id);
  return {
    ...metadata,
    [DEVICE_DRIVER_LIBRARY_META_KEY]: { comment: JSON.stringify([...saved, draft]) },
  };
}
