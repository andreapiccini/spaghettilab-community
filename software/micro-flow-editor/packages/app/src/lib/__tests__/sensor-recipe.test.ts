import { describe, expect, it } from "vitest";
import {
  blankSensorRecipe,
  describeStep,
  findSensorRecipeById,
  insertRecipeStep,
  moveRecipeStep,
  recipeChannels,
  removeRecipeStep,
  searchSensorRecipes,
  stepBadge,
  SENSOR_RECIPE_CATALOG,
  SENSOR_RECIPE_SEED_CATALOG,
  updateRecipeStep,
} from "../sensor-recipe.js";
import {
  createModuleFromRecipe,
  modulesForBinding,
  parseBackboneSensorModules,
  removeModule,
  upsertModule,
} from "../backbone-sensor-modules.js";

describe("sensor-recipe", () => {
  it("keeps live catalog empty (seeds unused until curated)", () => {
    expect(SENSOR_RECIPE_CATALOG).toHaveLength(0);
    expect(SENSOR_RECIPE_SEED_CATALOG.length).toBeGreaterThanOrEqual(4);
    expect(findSensorRecipeById("bme280")).toBeUndefined();
  });

  it("search stays empty while catalog is empty", () => {
    expect(searchSensorRecipes("")).toHaveLength(0);
    expect(searchSensorRecipes("bmp280")).toHaveLength(0);
  });

  it("describes typed steps in plain language", () => {
    expect(describeStep({ type: "wait", ms: 10 })).toContain("10");
    expect(describeStep({ type: "i2c_read", addr: "0x76", reg: "0xFA", len: 3, into: "t" })).toContain("0x76");
  });

  it("builds a low-confidence manual draft with sample steps and channels", () => {
    const draft = blankSensorRecipe("MyChip", "adc");
    expect(draft.source.kind).toBe("manual");
    expect(draft.confidence).toBe("low");
    expect(draft.bus).toBe("adc");
    expect(draft.recipe.sample.some((s) => s.type === "adc_read")).toBe(true);
    expect(recipeChannels(draft).some((c) => c.direction === "read")).toBe(true);
  });

  it("mutates sequence steps for the graphic editor", () => {
    let recipe = blankSensorRecipe("Chip", "i2c");
    recipe = insertRecipeStep(recipe, "sample", "wait", 0);
    expect(recipe.recipe.sample[0]?.type).toBe("wait");
    expect(stepBadge({ type: "wait", ms: 10 })).toBe("10ms");
    recipe = updateRecipeStep(recipe, "sample", 0, { type: "wait", ms: 40 });
    expect(recipe.recipe.sample[0]).toEqual({ type: "wait", ms: 40 });
    recipe = moveRecipeStep(recipe, "sample", 0, 1);
    expect(recipe.recipe.sample[1]).toEqual({ type: "wait", ms: 40 });
    const len = recipe.recipe.sample.length;
    recipe = removeRecipeStep(recipe, "sample", 1);
    expect(recipe.recipe.sample).toHaveLength(len - 1);
  });
});

describe("backbone-sensor-modules", () => {
  it("round-trips modules per binding", () => {
    const recipe = blankSensorRecipe("AHT20", "i2c");
    const module = createModuleFromRecipe(recipe);
    const next = upsertModule(parseBackboneSensorModules(null), "bind-1", module);
    expect(modulesForBinding(next, "bind-1")).toHaveLength(1);
    expect(modulesForBinding(removeModule(next, "bind-1", module.id), "bind-1")).toHaveLength(0);
  });
});
