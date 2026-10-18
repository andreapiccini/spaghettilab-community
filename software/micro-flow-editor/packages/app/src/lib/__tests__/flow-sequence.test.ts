import { describe, expect, it } from "vitest";
import {
  encodeSequenceProgram,
  sequenceSteps,
  validateSequenceSteps,
} from "../flow-sequence.js";
import {
  catalogEntryWithSensorChannels,
  propertiesForSensorModule,
} from "../backbone-sensor-block.js";
import { catalogUln2003Driver } from "../gpio-driver-presets.js";
import { draftToCanvasSensorRecipes } from "../device-recipe-draft.js";
import { createModuleFromRecipe } from "../backbone-sensor-modules.js";
import { findCatalogEntryById } from "@spaghettilab/processing-block-catalog";

describe("sequence authoring", () => {
  it("does not silently remove corrupt steps", () => {
    expect(
      sequenceSteps({
        stepsJson: JSON.stringify([
          { id: "ok", kind: "wait", durationMs: 10 },
          { id: "bad", kind: "unknown" },
        ]),
      }),
    ).toEqual([]);
    expect(() => validateSequenceSteps([])).toThrow();
  });
  it("bounds programs and validates delays and duplicates", () => {
    expect(() =>
      validateSequenceSteps([{ id: "w", kind: "wait", durationMs: 0 }]),
    ).toThrow();
    expect(() =>
      validateSequenceSteps(
        Array.from({ length: 9 }, (_, i) => ({
          id: String(i),
          kind: "wait",
          durationMs: 1,
        })),
      ),
    ).toThrow();
    expect(() =>
      validateSequenceSteps([
        { id: "x", kind: "wait", durationMs: 10 },
        { id: "x", kind: "wait", durationMs: 10 },
      ]),
    ).toThrow();
    const encoded = encodeSequenceProgram(
      Array.from({ length: 8 }, (_, i) => ({
        id: String(i),
        kind: "wait",
        durationMs: 60000,
      })),
      () => {
        throw new Error("No actions");
      },
    );
    expect(encoded).toHaveLength(64);
    expect(new DataView(encoded.buffer).getUint32(4, true)).toBe(60000);
  });
  it("exposes motion completion independently of the selected action", () => {
    const driver = catalogUln2003Driver();
    const recipe = draftToCanvasSensorRecipes(driver)[0]!;
    const module = createModuleFromRecipe(recipe);
    const properties = propertiesForSensorModule(module, recipe);
    const entry = catalogEntryWithSensorChannels(
      findCatalogEntryById("appblocks.backbone_sensor")!,
      properties,
    );
    expect(entry.outputs?.find((port) => port.id === "movement-completed")?.label).toBe(
      "Movimento terminato",
    );
    expect(
      entry.outputs?.find((port) => port.id === "movement-completed")?.types[0]?.domain,
    ).toBe("event");
  });
});
