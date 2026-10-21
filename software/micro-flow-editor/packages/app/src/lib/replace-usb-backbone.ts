import type { CoreBindingId, CoreBindingRecord, ProjectV1 } from "@spaghettilab/domain";
import { BACKBONE_SENSOR_MODULES_META_KEY, parseBackboneSensorModules } from "./backbone-sensor-modules.js";

function hasWork(project: ProjectV1, id: CoreBindingId): boolean {
  const index = project.coreBindings.findIndex(binding => binding.bindingId === id);
  return Boolean(project.deviceGraphs[index]?.nodes.length || project.deviceGraphs[index]?.edges.length ||
    project.physicalGraphs[index]?.nodes.length || project.physicalGraphs[index]?.edges.length ||
    parseBackboneSensorModules(project.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment).byBinding[id]?.length);
}

/** A single discovered USB device can replace one disconnected project board.
 * Never combine two authored boards or silently replace a live board. */
export function replacementUsbBinding(project: ProjectV1, deviceId: string, offline: ReadonlySet<CoreBindingId>): CoreBindingRecord | undefined {
  const existing = project.coreBindings.find(binding => binding.expectedDeviceId === deviceId);
  const stale = project.coreBindings.filter(binding => binding !== existing && offline.has(binding.bindingId));
  if (stale.length !== 1 || project.coreBindings.length !== (existing ? 2 : 1)) return undefined;
  if (existing && hasWork(project, existing.bindingId)) return undefined;
  return stale[0];
}

/** Preserve the logical binding and graph identities, replace only its hardware. */
export function replaceUsbBackbone(project: ProjectV1, id: CoreBindingId, replacement: CoreBindingRecord, preserveBoardAssignments = false): ProjectV1 {
  const old = project.coreBindings.find(binding => binding.bindingId === id);
  if (!old) throw new Error("Backbone del progetto non trovata.");
  const duplicate = project.coreBindings.find(binding => binding.bindingId !== id && binding.expectedDeviceId === replacement.expectedDeviceId);
  if (duplicate && hasWork(project, duplicate.bindingId)) throw new Error("La Backbone collegata contiene già un altro programma nel progetto.");
  const oldKey = `${id}:${old.expectedDeviceId}`, newKey = `${id}:${replacement.expectedDeviceId}`;
  const rewrite = (value: unknown): unknown => {
    if (typeof value === "string") return value === oldKey ? newKey : value;
    if (Array.isArray(value)) return value.map(rewrite);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key === oldKey ? newKey : key, rewrite(entry)]));
    return value;
  };
  const authoringMetadata = preserveBoardAssignments ? project.authoringMetadata : Object.fromEntries(Object.entries(project.authoringMetadata).map(([key, meta]) => {
    if (!meta.comment?.includes(oldKey)) return [key, meta];
    try { return [key, { ...meta, comment: JSON.stringify(rewrite(JSON.parse(meta.comment))) }]; }
    catch { return [key, meta]; }
  }));
  const duplicateIndex = duplicate ? project.coreBindings.indexOf(duplicate) : -1;
  return { ...project, authoringMetadata,
    coreBindings: project.coreBindings.filter(binding => binding !== duplicate).map(binding => binding.bindingId === id ? { ...replacement, bindingId: id } : binding),
    physicalGraphs: project.physicalGraphs.filter((_, index) => index !== duplicateIndex),
    deviceGraphs: project.deviceGraphs.filter((_, index) => index !== duplicateIndex),
  };
}
