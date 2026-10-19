import { DEFAULT_PHYSICAL_SETTINGS } from "@spaghettilab/protocol-sdk";
import type { CoreBindingId } from "@spaghettilab/domain";
import type { ProjectV1 } from "@spaghettilab/domain";
import type { DeviceRecipeDraft } from "./device-recipe-draft.js";
import {
  PHYSICAL_META_KEY,
  parsePhysicalProject,
  functionVariantOf,
  formatPinLabel,
  modeIndexToPinId,
  type BackbonePhysicalDraft,
} from "./backbone-physical.js";
import {
  BACKBONE_SENSOR_MODULES_META_KEY,
  parseBackboneSensorModules,
} from "./backbone-sensor-modules.js";
import { installNfcDriver } from "./nfc-installation.js";
import { addConfirmedPinModules } from "./physical-pin-bindings.js";

export type ModuleImportPlan = {
  readonly bindingId: CoreBindingId;
  readonly boardKey: string;
  readonly driver: DeviceRecipeDraft;
  readonly physical: BackbonePhysicalDraft;
  readonly channels: Readonly<Record<string, number>>;
  readonly conflicts: readonly { id: string; label: string }[];
  readonly pinChanges: readonly string[];
};

/** Pure proposal: never mutates a graph or silently evicts an existing module. */
export function planModuleImport(
  project: ProjectV1,
  bindingId: CoreBindingId,
  boardKey: string,
  driver: DeviceRecipeDraft,
  physical: BackbonePhysicalDraft,
): ModuleImportPlan {
  if (!["gpio", "i2c"].includes(driver.binding.bus))
    throw new Error("Importazione rapida disponibile per GPIO e I²C.");
  const multi = driver.binding.bus === "gpio" && driver.binding.gpioSignals.length > 1;
  if (
    multi &&
    driver.id !== "uln2003-28byj48" &&
    !driver.rgbModule &&
    !driver.dht22Module
  )
    throw new Error("Questo driver multipin richiede una mappatura dedicata.");
  if (driver.binding.bus === "gpio" && !driver.binding.gpioSignals.length)
    throw new Error("Il driver non dichiara segnali GPIO.");
  const requirements =
    driver.binding.bus === "i2c"
      ? [4, 5]
      : driver.temperatureSensorModel === "ds18b20"
        ? driver.ds18b20PowerMode === "gpio"
          ? [1, 2]
          : [1]
        : driver.dht22Module
          ? [1, 2]
          : Array.from({ length: driver.rgbModule ? 3 : multi ? 4 : 1 }, () =>
              driver.rgbModule
                ? 12
                : driver.binding.gpioSignals[0]?.direction === "in"
                  ? 1
                  : 2,
            );
  let channels =
    driver.binding.bus === "gpio"
      ? Object.fromEntries(
          driver.binding.gpioSignals.map((signal, i) => [signal.id, i]),
        )
      : {};
  const modules =
    parseBackboneSensorModules(
      project.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment,
    ).byBinding[bindingId] ?? [];
  // Keep a calibrated RGB channel order when replacing the same installed driver.
  const previousRgb = driver.rgbModule
    ? modules.find(
        (module) =>
          module.recipe.deviceDraft?.rgbModule &&
          (module.recipe.deviceDraft.id === driver.id ||
            module.label === driver.name) &&
          module.gpioAssignments?.boardKey === boardKey,
      )?.gpioAssignments?.channels
    : undefined;
  if (
    previousRgb &&
    ["RED", "GREEN", "BLUE"].every(
      (signal) =>
        Number.isInteger(previousRgb[signal]) &&
        previousRgb[signal]! >= 0 &&
        previousRgb[signal]! < 3,
    ) &&
    new Set([previousRgb.RED, previousRgb.GREEN, previousRgb.BLUE]).size === 3
  )
    channels = {
      RED: previousRgb.RED!,
      GREEN: previousRgb.GREEN!,
      BLUE: previousRgb.BLUE!,
    };
  const touched = new Set(requirements.map((_, i) => i));
  const conflicts = modules
    .filter((module) => {
      if (module.gpioAssignments)
        return (
          module.gpioAssignments.boardKey === boardKey &&
          Object.values(module.gpioAssignments.channels).some((channel) =>
            touched.has(channel),
          )
        );
      if (module.gpioAssignment)
        return (
          module.gpioAssignment.boardKey === boardKey &&
          touched.has(module.gpioAssignment.channel)
        );
      if (module.bus === "i2c" && driver.binding.bus === "i2c")
        return (
          Number.parseInt(module.recipe.address ?? "", 16) ===
          Number.parseInt(driver.binding.i2c?.address ?? "", 16)
        );
      return true; // Legacy unassigned modules cannot safely be assumed to use another pin.
    })
    .map((module) => ({
      id: module.id,
      label: module.recipe.deviceDraft?.name ?? module.label,
    }));
  const modes = [...physical.modes];
  const pinChanges: string[] = [];
  requirements.forEach((mode, index) => {
    const old = modes[index] ?? 0;
    if (old !== 0 && (old & 15) !== mode)
      pinChanges.push(`A${index}: configurazione esistente`);
    modes[index] = mode;
  });
  // Release pins belonging only to retired modules (e.g. POWER when choosing parasite).
  const retired = new Set(conflicts.map((item) => item.id));
  const retained = new Set(
    modules
      .filter(
        (item) => !retired.has(item.id) && item.gpioAssignments?.boardKey === boardKey,
      )
      .flatMap((item) => Object.values(item.gpioAssignments!.channels)),
  );
  for (const item of modules.filter(
    (item) => retired.has(item.id) && item.gpioAssignments?.boardKey === boardKey,
  ))
    for (const channel of Object.values(item.gpioAssignments!.channels))
      if (!touched.has(channel) && !retained.has(channel)) modes[channel] = 0;
  // Replacing one pin of a bus retires the whole bus, avoiding invalid half-routes.
  for (const group of [
    [4, 5],
    [6, 7],
    [8, 9, 10, 11],
  ]) {
    if (
      !requirements.some(
        (mode, i) =>
          group.includes((physical.modes[i] ?? 0) & 15) && !group.includes(mode),
      )
    )
      continue;
    modes.forEach((mode, i) => {
      if (!touched.has(i) && group.includes(mode & 15)) modes[i] = 0;
    });
  }
  return {
    bindingId,
    boardKey,
    driver,
    channels,
    conflicts,
    pinChanges,
    physical: {
      ...physical,
      modes,
      ...(driver.rgbModule
        ? {
            settings: {
              ...DEFAULT_PHYSICAL_SETTINGS,
              ...physical.settings,
              pwmHz: 1000,
              pwmInverted: false,
            },
          }
        : {}),
      applied: false,
      automatic: false,
    },
  };
}

export function commitModuleImport(
  project: ProjectV1,
  plan: ModuleImportPlan,
  instanceId: string,
  replace: boolean,
  confirmed: boolean,
): ProjectV1 {
  if ((plan.conflicts.length || plan.pinChanges.length) && !replace)
    throw new Error("Scegli quale modulo mantenere prima di continuare.");
  const retired = new Set(plan.conflicts.map((item) => item.id));
  const stored = parseBackboneSensorModules(
    project.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment,
  );
  const nodesToRemove = new Set(
    (stored.byBinding[plan.bindingId] ?? [])
      .filter((module) => retired.has(module.id))
      .flatMap(
        (module) =>
          module.graphNodeIds ?? (module.graphNodeId ? [module.graphNodeId] : []),
      ),
  );
  const index = project.coreBindings.findIndex(
    (binding) => binding.bindingId === plan.bindingId,
  );
  if (index < 0) throw new Error("Backbone non presente.");
  const graphs = project.deviceGraphs.map((graph, i) =>
    i !== index
      ? graph
      : {
          ...graph,
          nodes: graph.nodes.filter((node) => !nodesToRemove.has(node.id)),
          edges: graph.edges.filter(
            (edge) =>
              !nodesToRemove.has(edge.source) && !nodesToRemove.has(edge.target),
          ),
        },
  );
  const physical = { ...plan.physical, applied: confirmed };
  const physicalProject = parsePhysicalProject(
    project.authoringMetadata[PHYSICAL_META_KEY]?.comment,
  );
  let next: ProjectV1 = {
    ...project,
    deviceGraphs: graphs,
    authoringMetadata: {
      ...project.authoringMetadata,
      [BACKBONE_SENSOR_MODULES_META_KEY]: {
        comment: JSON.stringify({
          ...stored,
          byBinding: {
            ...stored.byBinding,
            [plan.bindingId]: (stored.byBinding[plan.bindingId] ?? []).filter(
              (module) => !retired.has(module.id),
            ),
          },
        }),
      },
      [PHYSICAL_META_KEY]: {
        comment: JSON.stringify({
          ...physicalProject,
          drafts: { ...physicalProject.drafts, [plan.boardKey]: physical },
        }),
      },
    },
  };
  // Reuse the same unit/driver installation path as NFC, with a unique local identity.
  const singleChannel = Object.values(plan.channels)[0];
  next = installNfcDriver(
    next,
    plan.bindingId,
    instanceId,
    plan.driver,
    String(plan.driver.updatedAt),
    plan.driver.gpioHardware?.power === "3.3" ? "3.3V" : "5V",
    singleChannel !== undefined
      ? { boardKey: plan.boardKey, channel: singleChannel }
      : undefined,
    {
      variant: functionVariantOf(physical),
      physical,
      boardKey: plan.boardKey,
      lines:
        plan.driver.binding.bus === "i2c"
          ? [0, 1].map((channel, index) => ({
              signal: index === 0 ? "SDA" : "SCL",
              pin: formatPinLabel(
                modeIndexToPinId(channel, functionVariantOf(physical)),
                functionVariantOf(physical),
              ),
            }))
          : [],
      gpioAssignment:
        singleChannel !== undefined
          ? { boardKey: plan.boardKey, channel: singleChannel }
          : undefined,
    },
  );
  const installed = parseBackboneSensorModules(
    next.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment,
  );
  next = {
    ...next,
    authoringMetadata: {
      ...next.authoringMetadata,
      [BACKBONE_SENSOR_MODULES_META_KEY]: {
        comment: JSON.stringify({
          ...installed,
          byBinding: {
            ...installed.byBinding,
            [plan.bindingId]: (installed.byBinding[plan.bindingId] ?? []).map(
              (module) =>
                module.id !== `nfc-module-${instanceId}`
                  ? module
                  : {
                      ...module,
                      ...(Object.keys(plan.channels).length > 1
                        ? {
                            gpioAssignment: undefined,
                            gpioAssignments: {
                              boardKey: plan.boardKey,
                              channels: plan.channels,
                            },
                          }
                        : {}),
                    },
            ),
          },
        }),
      },
    },
  };
  if (confirmed)
    next = addConfirmedPinModules(next, plan.bindingId, plan.boardKey, physical);
  return next;
}
