import type { ProjectV1 } from "@spaghettilab/domain";
import {
  BACKBONE_SENSOR_MODULES_META_KEY,
  modulesForBinding,
  parseBackboneSensorModules,
} from "./backbone-sensor-modules.js";
import {
  PHYSICAL_META_KEY,
  parsePhysicalProject,
  derivePortInterfaces,
  functionVariantOf,
  pinIdToModeIndex,
  type BackbonePhysicalDraft,
} from "./backbone-physical.js";

/** One ownership model for module replacement and the read-only board overview. */
export function modulePinOwners(
  project: ProjectV1 | undefined,
  bindingId: string,
  boardKey: string,
  draft: BackbonePhysicalDraft,
) {
  const authored =
    parsePhysicalProject(project?.authoringMetadata[PHYSICAL_META_KEY]?.comment).drafts[
      boardKey
    ] ?? draft;
  const modules = modulesForBinding(
    parseBackboneSensorModules(
      project?.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment,
    ),
    bindingId,
  );
  let installs: Record<string, { moduleId?: string; boardKey?: string }> = {};
  try {
    installs = JSON.parse(
      project?.authoringMetadata.__nfcInstallations?.comment ?? "{}",
    );
  } catch {
    /* Legacy project. */
  }
  return modules.flatMap((module) => {
    const device = module.recipe.deviceDraft;
    const assignment =
      module.gpioAssignments ??
      (module.gpioAssignment
        ? {
            boardKey: module.gpioAssignment.boardKey,
            channels: {
              [device?.binding.gpioSignals[0]?.id ?? "DATA"]:
                module.gpioAssignment.channel,
            },
          }
        : undefined);
    if (assignment)
      return assignment.boardKey === boardKey
        ? [{ module, channels: assignment.channels }]
        : [];
    const installation = Object.values(installs).find(
      (item) => item?.moduleId === module.id,
    );
    if (installation?.boardKey !== boardKey) return [];
    const bus = derivePortInterfaces(authored.modes, functionVariantOf(authored)).find(
      (item) => item.kind === module.bus,
    );
    return bus
      ? [
          {
            module,
            channels: Object.fromEntries(
              bus.signals.map((signal) => [
                signal.label,
                pinIdToModeIndex(signal.pin, functionVariantOf(authored)),
              ]),
            ),
          },
        ]
      : [];
  });
}
