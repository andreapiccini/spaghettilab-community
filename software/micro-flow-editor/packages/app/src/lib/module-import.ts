import { SENSOR_MODULE_ID_PROP } from "./backbone-sensor-block.js";
import { modulePinOwners } from "./module-pin-ownership.js";
import { gpioSignalType } from "./gpio-operation-registry.js";
import { configureDs18b20 } from "./ds18b20-configuration.js";
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
  selectedChannels?: Readonly<Record<string, number>>,
  editingModuleId?: string,
): ModuleImportPlan {
  if (!["gpio", "i2c"].includes(driver.binding.bus) && !driver.moduleProgram)
    throw new Error("Importazione rapida disponibile per GPIO e I²C.");
  const multi = driver.binding.bus === "gpio" && driver.binding.gpioSignals.length > 1;
  if (
    multi &&
    driver.id !== "uln2003-28byj48" &&
    !driver.rgbModule &&
    !driver.dht22Module &&
    !driver.moduleProgram
  )
    throw new Error("Questo driver multipin richiede una mappatura dedicata.");
  if (driver.binding.bus === "gpio" && !driver.binding.gpioSignals.length)
    throw new Error("Il driver non dichiara segnali GPIO.");
  const requirements =
    driver.binding.bus === "i2c"
      ? [4, 5]
      : driver.binding.bus === "spi"
        ? [8, 9, 10, 11]
        : driver.binding.bus === "uart"
          ? [6, 7]
          : driver.binding.bus === "adc"
            ? [14]
            : driver.binding.bus === "w1"
              ? [13]
              : driver.temperatureSensorModel === "ds18b20"
                ? driver.ds18b20PowerMode === "gpio"
                  ? [1, 2]
                  : [1]
                : driver.dht22Module
                  ? [1, 2]
                  : driver.binding.gpioSignals.map((signal) =>
                      gpioSignalType(signal) === "pwm_output"
                        ? 12
                        : signal.direction === "in"
                          ? 1
                          : 2,
                    );
  let channels =
    driver.binding.bus === "gpio"
      ? Object.fromEntries(
          driver.binding.gpioSignals.map((signal, i) => [signal.id, i]),
        )
      : Object.fromEntries(
          (driver.binding.bus === "i2c"
            ? ["SDA", "SCL"]
            : driver.binding.bus === "spi"
              ? ["SCK", "MOSI", "MISO", "CS"]
              : driver.binding.bus === "uart"
                ? ["TX", "RX"]
                : ["DATA"]
          ).map((signal, index) => [signal, index]),
        );
  const modules =
    parseBackboneSensorModules(
      project.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment,
    ).byBinding[bindingId] ?? [];
  if (driver.rgbModule) channels = { RED: 1, GREEN: 0, BLUE: 2 };
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
  if (selectedChannels)
    channels = Object.fromEntries(
      Object.entries(channels).map(([signal, channel]) => [
        signal,
        selectedChannels[signal] ?? channel,
      ]),
    );
  const values = Object.values(channels);
  const limit =
    driver.binding.bus === "gpio"
      ? Math.min(4, physical.modes.length)
      : physical.modes.length;
  if (
    values.some(
      (channel) => !Number.isInteger(channel) || channel < 0 || channel >= limit,
    ) ||
    new Set(values).size !== values.length
  )
    throw new Error(
      "Scegli un pin supportato e distinto per ciascun segnale del modulo.",
    );
  const assignments = Object.entries(channels).map(([signal, channel], index) => ({
    signal,
    channel,
    mode: requirements[index]!,
  }));
  const touched = new Set(values);
  const owners = modulePinOwners(project, bindingId, boardKey, physical);
  const conflicts = owners
    .filter((owner) =>
      owner.module.id !== editingModuleId &&
      Object.values(owner.channels).some((channel) => touched.has(channel)),
    )
    .map((owner) => ({
      id: owner.module.id,
      label: owner.module.recipe.deviceDraft?.name ?? owner.module.label,
    }));
  const conflictedIds = new Set(conflicts.map((item) => item.id));
  if (
    ["i2c", "spi", "uart"].includes(driver.binding.bus) &&
    owners.some(
      (owner) =>
        !conflictedIds.has(owner.module.id) &&
        owner.module.bus === driver.binding.bus &&
        Object.entries(channels).some(
          ([signal, channel]) => owner.channels[signal] !== channel,
        ),
    )
  )
    throw new Error(
      "Questo bus è già assegnato su altri pin. Usa gli stessi segnali oppure scegli un’altra Backbone.",
    );
  const modes = [...physical.modes];
  const pinChanges: string[] = [];
  assignments.forEach(({ mode, channel: index }) => {
    const old = modes[index] ?? 0;
    if (old !== 0 && (old & 15) !== mode)
      pinChanges.push(`A${index}: configurazione esistente`);
    modes[index] = mode;
  });
  // Release pins belonging only to retired modules (e.g. POWER when choosing parasite).
  const retired = new Set(conflicts.map((item) => item.id));
  if (editingModuleId) retired.add(editingModuleId);
  const retained = new Set(
    owners
      .filter((owner) => !retired.has(owner.module.id))
      .flatMap((owner) => Object.values(owner.channels)),
  );
  for (const owner of owners.filter((owner) => retired.has(owner.module.id)))
    for (const channel of Object.values(owner.channels))
      if (!touched.has(channel) && !retained.has(channel)) modes[channel] = 0;
  // Replacing one pin of a bus retires the whole bus, avoiding invalid half-routes.
  for (const group of [
    [4, 5],
    [6, 7],
    [8, 9, 10, 11],
  ]) {
    if (
      !assignments.some(
        ({ mode, channel }) =>
          group.includes((physical.modes[channel] ?? 0) & 15) && !group.includes(mode),
      )
    )
      continue;
    modes.forEach((mode, i) => {
      if (!touched.has(i) && group.includes(mode & 15)) modes[i] = 0;
    });
  }
  for (const group of [
    [4, 5],
    [6, 7],
    [8, 9, 10, 11],
  ]) {
    if (assignments.some((item) => group.includes(item.mode)))
      modes.forEach((mode, index) => {
        if (!touched.has(index) && group.includes(mode & 15)) modes[index] = 0;
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
  for (const node of project.deviceGraphs[index]?.nodes ?? []) {
    const data = node.data as { properties?: Record<string, unknown> };
    if (retired.has(String(data.properties?.[SENSOR_MODULE_ID_PROP] ?? "")))
      nodesToRemove.add(node.id);
  }

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
  let installations: Record<string, { moduleId?: string }> = {};
  try {
    installations = JSON.parse(
      project.authoringMetadata.__nfcInstallations?.comment ?? "{}",
    );
  } catch {
    /* Legacy project. */
  }
  const retainedInstallations = Object.fromEntries(
    Object.entries(installations).filter(
      ([, entry]) => !retired.has(entry?.moduleId ?? ""),
    ),
  );
  let next: ProjectV1 = {
    ...project,
    deviceGraphs: graphs,
    authoringMetadata: {
      ...project.authoringMetadata,
      __nfcInstallations: { comment: JSON.stringify(retainedInstallations) },
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
          ? Object.entries(plan.channels).map(([signal, channel]) => ({
              signal,
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

/** Change an installed sensor in place; never delete its canvas nodes or wires. */
export function commitDs18b20Configuration(
  project: ProjectV1,
  plan: ModuleImportPlan,
  moduleId: string,
  confirmed: boolean,
): ProjectV1 {
  const next = configureDs18b20(
    project,
    plan.bindingId,
    moduleId,
    plan.driver.ds18b20PowerMode === "parasite" ? "parasite" : "vcc",
    plan.channels.DATA ?? 0,
    1,
    confirmed,
    plan.driver.gpioHardware?.power === "5" ? "5" : "3.3",
  );
  const physical = parsePhysicalProject(
    next.authoringMetadata[PHYSICAL_META_KEY]?.comment,
  );
  return {
    ...next,
    authoringMetadata: {
      ...next.authoringMetadata,
      [PHYSICAL_META_KEY]: {
        ...next.authoringMetadata[PHYSICAL_META_KEY],
        comment: JSON.stringify({
          ...physical,
          drafts: {
            ...physical.drafts,
            [plan.boardKey]: { ...plan.physical, applied: confirmed },
          },
        }),
      },
    },
  };
}

/** Remap an installed GPIO module without changing its canvas identity or wires. */
export function commitModulePinConfiguration(
  project: ProjectV1, plan: ModuleImportPlan, moduleId: string, confirmed: boolean,
): ProjectV1 {
  const stored = parseBackboneSensorModules(project.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment);
  const modules = stored.byBinding[plan.bindingId] ?? [];
  const current = modules.find(module => module.id === moduleId);
  if (!current) throw new Error("Modulo non più presente nel progetto.");
  if (current.bus !== "gpio") throw new Error("Modifica pin disponibile per i moduli GPIO.");
  const retired = new Set(plan.conflicts.filter(item => item.id !== moduleId).map(item => item.id));
  const removedNodes = new Set(modules.filter(module => retired.has(module.id))
    .flatMap(module => module.graphNodeIds ?? (module.graphNodeId ? [module.graphNodeId] : [])));
  const index = project.coreBindings.findIndex(binding => binding.bindingId === plan.bindingId);
  for (const node of project.deviceGraphs[index]?.nodes ?? []) {
    const data = node.data as { properties?: Record<string, unknown> };
    if (retired.has(String(data.properties?.[SENSOR_MODULE_ID_PROP] ?? ""))) removedNodes.add(node.id);
  }
  const sourceBoardKey = current.gpioAssignments?.boardKey ?? current.gpioAssignment?.boardKey;
  const physical = sourceBoardKey !== plan.boardKey
    ? releaseModulePins(project, plan.bindingId, moduleId)
    : parsePhysicalProject(project.authoringMetadata[PHYSICAL_META_KEY]?.comment);
  let installations: Record<string, { moduleId?: string }> = {};
  try { installations = JSON.parse(project.authoringMetadata.__nfcInstallations?.comment ?? "{}"); } catch { /* Legacy project. */ }
  const retainedInstallations = Object.fromEntries(Object.entries(installations)
    .filter(([, entry]) => !retired.has(entry?.moduleId ?? "")));
  const first = Object.values(plan.channels)[0]!;
  const updated = { ...current,
    recipe: { ...current.recipe, deviceDraft: plan.driver },
    actions: current.actions?.map(action => ({ ...action, deviceDraft: plan.driver })),
    gpioAssignment: { boardKey: plan.boardKey, channel: first },
    gpioAssignments: { boardKey: plan.boardKey, channels: plan.channels },
  };
  return { ...project,
    deviceGraphs: project.deviceGraphs.map((graph, i) => i !== index ? graph : {
      ...graph, nodes: graph.nodes.filter(node => !removedNodes.has(node.id)),
      edges: graph.edges.filter(edge => !removedNodes.has(edge.source) && !removedNodes.has(edge.target)),
    }),
    authoringMetadata: { ...project.authoringMetadata,
      __nfcInstallations: { comment: JSON.stringify(retainedInstallations) },
      [BACKBONE_SENSOR_MODULES_META_KEY]: { comment: JSON.stringify({ ...stored, byBinding: {
        ...stored.byBinding, [plan.bindingId]: modules.filter(module => !retired.has(module.id))
          .map(module => module.id === moduleId ? updated : module),
      } }) },
      [PHYSICAL_META_KEY]: { comment: JSON.stringify({ ...physical, drafts: {
        ...physical.drafts, [plan.boardKey]: { ...plan.physical, applied: confirmed },
      } }) },
    },
  };
}

/** Remove the installed module, its canvas copies and owned pin assignments. */
export function removeInstalledModule(project: ProjectV1, bindingId: string, moduleId: string): ProjectV1 {
  const stored = parseBackboneSensorModules(project.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment);
  const modules = stored.byBinding[bindingId] ?? [];
  const module = modules.find(item => item.id === moduleId);
  if (!module) return project;
  const removed = new Set(module.graphNodeIds ?? (module.graphNodeId ? [module.graphNodeId] : []));
  const index = project.coreBindings.findIndex(binding => binding.bindingId === bindingId);
  for (const node of project.deviceGraphs[index]?.nodes ?? []) {
    const data = node.data as { properties?: Record<string, unknown> };
    if (data.properties?.[SENSOR_MODULE_ID_PROP] === moduleId) removed.add(node.id);
  }
  const physical = releaseModulePins(project, bindingId, moduleId);
  let installations: Record<string, { moduleId?: string }> = {};
  try { installations = JSON.parse(project.authoringMetadata.__nfcInstallations?.comment ?? "{}"); } catch { /* Legacy project. */ }
  return { ...project,
    deviceGraphs: project.deviceGraphs.map((graph, i) => i !== index ? graph : { ...graph,
      nodes: graph.nodes.filter(node => !removed.has(node.id)),
      edges: graph.edges.filter(edge => !removed.has(edge.source) && !removed.has(edge.target)),
    }),
    authoringMetadata: { ...project.authoringMetadata,
      [BACKBONE_SENSOR_MODULES_META_KEY]: { comment: JSON.stringify({ ...stored, byBinding: {
        ...stored.byBinding, [bindingId]: modules.filter(item => item.id !== moduleId),
      } }) },
      [PHYSICAL_META_KEY]: { comment: JSON.stringify(physical) },
      __nfcInstallations: { comment: JSON.stringify(Object.fromEntries(Object.entries(installations)
        .filter(([, entry]) => entry?.moduleId !== moduleId))) },
    },
  };
}

function releaseModulePins(project: ProjectV1, bindingId: string, moduleId: string) {
  const physical = parsePhysicalProject(project.authoringMetadata[PHYSICAL_META_KEY]?.comment);
  const modules = parseBackboneSensorModules(project.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment).byBinding[bindingId] ?? [];
  const module = modules.find(item => item.id === moduleId);
  const boardKey = module?.gpioAssignments?.boardKey ?? module?.gpioAssignment?.boardKey;
  if (!module || !boardKey || !physical.drafts[boardKey]) return physical;
  const board = physical.drafts[boardKey]!;
  const owners = modulePinOwners(project, bindingId, boardKey, board);
  const pins = owners.find(owner => owner.module.id === moduleId)?.channels ?? {};
  const retained = new Set(owners.filter(owner => owner.module.id !== moduleId).flatMap(owner => Object.values(owner.channels)));
  const modes = [...board.modes];
  for (const pin of Object.values(pins)) if (!retained.has(pin)) modes[pin] = 0;
  return { ...physical, drafts: { ...physical.drafts, [boardKey]: { ...board, modes, applied: false, automatic: false } } };
}
