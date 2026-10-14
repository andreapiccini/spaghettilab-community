import type { SensorBus, SensorRecipe } from "./sensor-recipe.js";
import { SENSOR_RECIPE_CATALOG, findSensorRecipeById } from "./sensor-recipe.js";

/** Project authoringMetadata key — modules attached to Backbone buses on the Flow canvas. */
export const BACKBONE_SENSOR_MODULES_META_KEY = "__backboneSensorModules";

export type BackboneSensorModule = {
  readonly id: string;
  readonly recipeId: string;
  /** Snapshot so community/manual recipes survive without catalog lookup. */
  readonly recipe: SensorRecipe;
  readonly bus: SensorBus;
  readonly label: string;
  readonly createdAt: number;
  /** Flow canvas node created for this module's channels (if any). */
  readonly graphNodeId?: string;
  readonly graphNodeIds?: readonly string[];
  readonly actions?: readonly SensorRecipe[];
};

export type BackboneSensorModulesProject = {
  readonly version: 1;
  /** Modules keyed by core binding id. */
  readonly byBinding: Readonly<Record<string, readonly BackboneSensorModule[]>>;
};

const EMPTY: BackboneSensorModulesProject = { version: 1, byBinding: {} };

export function parseBackboneSensorModules(raw: string | undefined | null): BackboneSensorModulesProject {
  if (!raw || raw.trim() === "") return EMPTY;
  try {
    const parsed = JSON.parse(raw) as Partial<BackboneSensorModulesProject>;
    if (parsed?.version !== 1 || !parsed.byBinding || typeof parsed.byBinding !== "object") return EMPTY;
    return { version: 1, byBinding: parsed.byBinding };
  } catch {
    return EMPTY;
  }
}

export function modulesForBinding(
  project: BackboneSensorModulesProject,
  bindingId: string | undefined | null,
): readonly BackboneSensorModule[] {
  if (!bindingId) return [];
  return project.byBinding[bindingId] ?? [];
}

export function upsertModule(
  project: BackboneSensorModulesProject,
  bindingId: string,
  module: BackboneSensorModule,
): BackboneSensorModulesProject {
  const list = [...(project.byBinding[bindingId] ?? [])];
  const index = list.findIndex((item) => item.id === module.id);
  if (index >= 0) list[index] = module;
  else list.push(module);
  return { version: 1, byBinding: { ...project.byBinding, [bindingId]: list } };
}

export function removeModule(
  project: BackboneSensorModulesProject,
  bindingId: string,
  moduleId: string,
): BackboneSensorModulesProject {
  const list = (project.byBinding[bindingId] ?? []).filter((item) => item.id !== moduleId);
  return { version: 1, byBinding: { ...project.byBinding, [bindingId]: list } };
}

export function resolveRecipe(module: BackboneSensorModule): SensorRecipe {
  return findSensorRecipeById(module.recipeId) ?? module.recipe;
}

export function createModuleFromRecipe(recipe: SensorRecipe, bus?: SensorBus): BackboneSensorModule {
  return {
    id: `bsm-${Date.now().toString(36)}-${Math.round(Math.random() * 1e6).toString(36)}`,
    recipeId: recipe.id,
    recipe,
    bus: bus ?? recipe.bus,
    label: recipe.chip,
    createdAt: Date.now(),
  };
}

export function catalogRecipeCount(): number {
  return SENSOR_RECIPE_CATALOG.length;
}
