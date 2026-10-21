import { topologyNeedsReconfiguration, topologyReviewAccepted } from "./backbone-topology-change.js";
import { activeModuleIds } from "./active-module-ids.js";
import type { ProjectV1 } from "@spaghettilab/domain";
import type {
  GetStatusResponse,
  ApplyPhysicalRequest,
} from "@spaghettilab/protocol-sdk";
import {
  PHYSICAL_META_KEY,
  parsePhysicalProject,
  topologyForBoard,
  adaptPhysicalModes,
} from "./backbone-physical.js";
import {
  BACKBONE_SENSOR_MODULES_META_KEY,
  modulesForBinding,
  parseBackboneSensorModules,
} from "./backbone-sensor-modules.js";

/** Project positions survive replacement of hardware. USB is position one;
 * CAN positions follow the same discovery order displayed by the application. */
export function resolveLogicalBackbones(
  project: ProjectV1,
  bindingId: string,
  status: GetStatusResponse,
  validateUsedPositions = true,
) {
  if (validateUsedPositions && topologyNeedsReconfiguration(project, bindingId, status) && !topologyReviewAccepted(project, bindingId, status))
    throw new Error("Variazione delle Backbone rilevata: riconfigura le schede prima di caricare il programma.");
  const physical = parsePhysicalProject(
    project.authoringMetadata[PHYSICAL_META_KEY]?.comment,
  );
  const binding = project.coreBindings.find((item) => item.bindingId === bindingId);
  const entries = Object.entries(physical.drafts).filter(([key]) =>
    key.startsWith(`${bindingId}:`),
  );
  const primary =
    entries.find(([key]) => key === `${bindingId}:${binding?.expectedDeviceId}`) ??
    entries.find(([, draft]) => draft.local !== false);
  // Reserve position one even when only a CAN board has authored pin settings.
  const slots = [primary, ...entries.filter((entry) => entry !== primary)];
  const slotOf = new Map(
    slots.flatMap((entry, index) =>
      entry
        ? [
            [
              entry[0],
              Number.isInteger(entry[1].logicalSlot) && entry[1].logicalSlot! > 0
                ? entry[1].logicalSlot! - 1
                : index,
            ] as const,
          ]
        : [],
    ),
  );
  const peers = (status.chainPeers ?? []).filter((peer) => (peer.flags & 0x02) === 0);
  const local =
    peers.find((peer) => peer.local) ??
    (status.deviceId && status.deviceId.length >= 6
      ? {
          nodeId:
            (status.deviceId[3]! << 16) |
            (status.deviceId[4]! << 8) |
            status.deviceId[5]!,
          local: true,
        }
      : undefined);
  const boards = [local, ...peers.filter((peer) => !peer.local)];
  const modules = modulesForBinding(
    parseBackboneSensorModules(
      project.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment,
    ),
    bindingId,
  );
  let installations: Record<string, { moduleId?: string; boardKey?: string }> = {};
  try {
    installations = JSON.parse(
      project.authoringMetadata.__nfcInstallations?.comment ?? "{}",
    );
  } catch {
    /* optional legacy metadata */
  }
  const graphIndex = project.coreBindings.findIndex(
    (item) => item.bindingId === bindingId,
  );
  const canvas = project.deviceGraphs[graphIndex];
  const active = activeModuleIds(canvas?.nodes ?? []);
  const used = new Map<string, string[]>();
  for (const module of modules.filter((item) => active.has(item.id))) {
    const key =
      module.gpioAssignments?.boardKey ??
      module.gpioAssignment?.boardKey ??
      Object.values(installations).find((item) => item.moduleId === module.id)
        ?.boardKey;
    if (key) used.set(key, [...(used.get(key) ?? []), module.label]);
  }
  for (const graph of canvas ? [canvas] : [])
    for (const node of graph.nodes) {
      const data = node.data as {
        properties?: Record<string, unknown>;
        moduleNodeId?: string;
      };
      const reference = String(
        data.properties?.physicalPinId ?? data.moduleNodeId ?? node.id,
      );
      const key =
        typeof data.properties?.boardKey === "string"
          ? data.properties.boardKey
          : entries.find(([key]) => reference.includes(`${key}:`))?.[0];
      if (key)
        used.set(key, [
          ...(used.get(key) ?? []),
          String(data.properties?.label ?? "Pin del canvas"),
        ]);
    }
  for (const [key, labels] of used) {
    const index = slotOf.get(key) ?? -1;
    if (validateUsedPositions && (index < 0 || !boards[index]))
      throw new Error(
        `Manca la Backbone ${index < 0 ? "del progetto" : index + 1}: serve per ${[...new Set(labels)].join(", ")}. Sono collegate ${peers.length || (status.deviceId ? 1 : 0)} Backbone.`,
      );
  }
  const drafts = { ...physical.drafts };
  const requests: ApplyPhysicalRequest[] = [];
  slots.forEach((entry) => {
    if (!entry) return;
    const index = slotOf.get(entry[0])!;
    if (!boards[index]) return;
    const [key, draft] = entry,
      board = boards[index]!;
    const actual = topologyForBoard(status, {
      local: index === 0,
      nodeId: board.nodeId,
    });
    const modes =
      actual && validateUsedPositions && used.has(key)
        ? adaptPhysicalModes(draft.modes, actual.modes.length)
        : draft.modes;
    drafts[key] = {
      ...draft,
      modes,
      ...(actual && validateUsedPositions && used.has(key)
        ? { variant: actual.layout === 2 ? ("v2" as const) : ("v1" as const) }
        : {}),
      logicalSlot: index + 1,
      local: index === 0,
      nodeId: board.nodeId,
    };
    if (used.has(key))
      requests.push({
        nodeId: index === 0 ? 0 : board.nodeId,
        modes: new Uint8Array(modes),
        i2cSpeed: draft.i2cSpeed,
        settings: draft.settings,
      });
  });
  const identity = status.deviceId
    ? Array.from(status.deviceId, (byte) => byte.toString(16).padStart(2, "0")).join("")
    : binding?.expectedDeviceId;
  return {
    positions: slotOf,
    project: {
      ...project,
      coreBindings: project.coreBindings.map((item) =>
        item.bindingId === bindingId && identity
          ? { ...item, expectedDeviceId: identity }
          : item,
      ),
      authoringMetadata: {
        ...project.authoringMetadata,
        [PHYSICAL_META_KEY]: {
          ...project.authoringMetadata[PHYSICAL_META_KEY],
          comment: JSON.stringify({ ...physical, drafts }),
        },
      },
    },
    requests,
  };
}

/** Resolve the authored position for UI editing without hiding other positions
 * just because one of the project boards is currently disconnected. */
export function logicalBackboneKey(
  project: ProjectV1 | undefined,
  bindingId: string,
  status: GetStatusResponse | undefined,
  nodeId: number,
): string | undefined {
  if (!project || !status) return undefined;
  const resolved = resolveLogicalBackbones(project, bindingId, status, false);
  const drafts = parsePhysicalProject(
    resolved.project.authoringMetadata[PHYSICAL_META_KEY]?.comment,
  ).drafts;
  return Object.entries(drafts).find(
    ([key, draft]) => key.startsWith(`${bindingId}:`) && draft.nodeId === nodeId,
  )?.[0];
}

export function moduleBackboneLabels(
  project: ProjectV1,
  bindingId: string,
  status?: GetStatusResponse,
): ReadonlyMap<string, string> {
  if (topologyNeedsReconfiguration(project, bindingId, status)) {
    const modules = modulesForBinding(parseBackboneSensorModules(project.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment), bindingId);
    return new Map(modules.map(module => [module.id, "Da riconfigurare"]));
  }
  const resolved = resolveLogicalBackbones(
    project,
    bindingId,
    status ?? ({} as GetStatusResponse),
    false,
  );
  const modules = modulesForBinding(
    parseBackboneSensorModules(
      project.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment,
    ),
    bindingId,
  );
  let installations: Record<string, { moduleId?: string; boardKey?: string }> = {};
  try {
    installations = JSON.parse(
      project.authoringMetadata.__nfcInstallations?.comment ?? "{}",
    );
  } catch {
    /* optional */
  }
  return new Map(
    modules.map((module) => {
      const key =
        module.gpioAssignments?.boardKey ??
        module.gpioAssignment?.boardKey ??
        Object.values(installations).find((item) => item.moduleId === module.id)
          ?.boardKey;
      const position = key ? resolved.positions.get(key) : 0;
      return [
        module.id,
        position === undefined ? "Backbone da configurare" : `Backbone ${position + 1}`,
      ];
    }),
  );
}
