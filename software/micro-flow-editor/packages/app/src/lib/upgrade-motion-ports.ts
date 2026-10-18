import {
  type DeviceProcessingNodeData,
  isBlockNodeData,
} from "@spaghettilab/device-processing-graph-model";
import type { ProjectV1 } from "@spaghettilab/domain";
import {
  BACKBONE_SENSOR_MODULES_META_KEY,
  parseBackboneSensorModules,
} from "./backbone-sensor-modules.js";
import { SENSOR_MODULE_ID_PROP } from "./backbone-sensor-block.js";

/** Existing projects gain the native motion event without rebuilding their devices. */
export function upgradeMotionPorts(project: ProjectV1): ProjectV1 {
  const motors = new Set(
    Object.values(
      parseBackboneSensorModules(
        project.authoringMetadata[BACKBONE_SENSOR_MODULES_META_KEY]?.comment,
      ).byBinding,
    )
      .flat()
      .filter((module) =>
        module.recipe.deviceDraft?.commands.some((command) =>
          command.steps.some((op) => op.type === "stepper"),
        ),
      )
      .map((module) => module.id),
  );
  if (!motors.size) return project;
  return {
    ...project,
    deviceGraphs: project.deviceGraphs.map((graph) => ({
      ...graph,
      nodes: graph.nodes.map((node) => {
        const data = node.data as DeviceProcessingNodeData;
        if (
          !isBlockNodeData(data) ||
          !motors.has(String(data.properties[SENSOR_MODULE_ID_PROP]))
        )
          return node;
        return {
          ...node,
          data: { ...data, properties: { ...data.properties, sensorMotion: true } },
        };
      }),
    })),
  };
}
