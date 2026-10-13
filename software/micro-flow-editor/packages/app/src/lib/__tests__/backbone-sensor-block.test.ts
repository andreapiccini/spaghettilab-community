import { describe, expect, it } from "vitest";
import { findCatalogEntryById } from "@spaghettilab/processing-block-catalog";
import {
  BACKBONE_SENSOR_BLOCK_CATALOG_ID,
  blockPortsFromChannels,
  catalogEntryWithSensorChannels,
  propertiesForSensorModule,
  serializeSensorChannels,
} from "../backbone-sensor-block.js";
import { createModuleFromRecipe } from "../backbone-sensor-modules.js";
import { blankSensorRecipe, recipeChannels, withChannels } from "../sensor-recipe.js";

describe("backbone-sensor-block", () => {
  it("maps read channels to output ports and write to inputs", () => {
    const { inputs, outputs } = blockPortsFromChannels([
      { id: "temp_c", label: "Temperatura", unit: "°C", quantity: "temperature", direction: "read" },
      { id: "relay", label: "Relè", unit: "on/off", quantity: "digital", direction: "write" },
    ]);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.id).toBe("temp_c");
    expect(inputs).toHaveLength(1);
    expect(inputs[0]?.id).toBe("relay");
  });

  it("overlays catalog entry ports from node properties", () => {
    const entry = findCatalogEntryById(BACKBONE_SENSOR_BLOCK_CATALOG_ID);
    expect(entry).toBeDefined();
    const recipe = withChannels(blankSensorRecipe("Demo", "adc"), [
      { id: "level", label: "Livello", unit: "%", quantity: "analog", direction: "read" },
    ]);
    const module = createModuleFromRecipe(recipe);
    const props = propertiesForSensorModule(module, recipe);
    const overlay = catalogEntryWithSensorChannels(entry!, props);
    expect(overlay.outputs?.map((p) => p.id)).toEqual(["level"]);
    expect(overlay.label).toBe("Demo");
    expect(JSON.parse(serializeSensorChannels(recipeChannels(recipe)))).toHaveLength(1);
  });
});
