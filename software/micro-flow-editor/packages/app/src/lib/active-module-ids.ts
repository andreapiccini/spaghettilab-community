import type { DeviceProcessingNodeData } from "@spaghettilab/device-processing-graph-model";
import type { ProjectV1 } from "@spaghettilab/domain";
import { SENSOR_MODULE_ID_PROP } from "./backbone-sensor-block.js";
import { sequenceSteps, SEQUENCE_TYPE } from "./flow-sequence.js";

/** Installed modules are catalog entries; only canvas references require hardware. */
export function activeModuleIds(
  nodes: ProjectV1["deviceGraphs"][number]["nodes"],
): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    const data = node.data as DeviceProcessingNodeData;
    if (data.kind !== "block") continue;
    const id = data.properties[SENSOR_MODULE_ID_PROP];
    if (typeof id === "string" && id) ids.add(id);
    if (data.blockTypeId === SEQUENCE_TYPE)
      for (const step of sequenceSteps(data.properties))
        if (step.kind === "action") ids.add(step.moduleId);
  }
  return ids;
}
