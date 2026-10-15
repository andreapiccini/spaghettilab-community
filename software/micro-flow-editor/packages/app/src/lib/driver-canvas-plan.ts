import type { SensorRecipe } from "./sensor-recipe.js";
import {
  SENSOR_ACTION_ID_PROP,
  SENSOR_DRIVER_INSTANCE_PROP,
  SENSOR_MODULE_ID_PROP,
} from "./backbone-sensor-block.js";

/** Match action blocks by identity so regenerating a driver preserves positions and wires. */
export function planDriverCanvasChanges(
  recipes: readonly SensorRecipe[],
  moduleId: string,
  nodes: readonly {
    readonly id: string;
    readonly properties: Readonly<Record<string, unknown>>;
  }[],
) {
  const instanceId = recipes[0]?.driverInstanceId;
  const updates: { id: string; recipe: SensorRecipe }[] = [];
  const removals: string[] = [];

  for (const node of nodes) {
    const belongs =
      node.properties[SENSOR_MODULE_ID_PROP] === moduleId ||
      (instanceId && node.properties[SENSOR_DRIVER_INSTANCE_PROP] === instanceId);
    if (!belongs) continue;
    const recipe = recipes.find(
      (r) => r.actionId === node.properties[SENSOR_ACTION_ID_PROP],
    );
    if (!recipe || node.properties[SENSOR_MODULE_ID_PROP] !== moduleId) {
      removals.push(node.id);
      continue;
    }
    updates.push({ id: node.id, recipe });
  }
  return { updates, removals, additions: updates.length ? [] : recipes.slice(0, 1) };
}
