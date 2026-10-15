import {
  createBlankDraft,
  draftToCanvasSensorRecipes,
  serializeDeviceRecipeDraft,
  parseDeviceRecipeDraft,
} from "../device-recipe-draft.js";
import { addFlowInterface } from "../flow-interfaces.js";
import { sensorInstanceSelection, SENSOR_INPUT_PROP } from "../sensor-instance.js";
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
      {
        id: "temp_c",
        label: "Temperatura",
        unit: "°C",
        quantity: "temperature",
        direction: "read",
      },
      {
        id: "relay",
        label: "Relè",
        unit: "on/off",
        quantity: "digital",
        direction: "write",
      },
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
      {
        id: "level",
        label: "Livello",
        unit: "%",
        quantity: "analog",
        direction: "read",
      },
    ]);
    const module = createModuleFromRecipe(recipe);
    const props = propertiesForSensorModule(module, recipe);
    const overlay = catalogEntryWithSensorChannels(entry!, props);
    expect(overlay.outputs?.map((p) => p.id)).toEqual(["level"]);
    expect(overlay.label).toBe("Demo");
    expect(JSON.parse(serializeSensorChannels(recipeChannels(recipe)))).toHaveLength(1);
  });
});

it("keeps only one selected input and output and preserves trigger mode", () => {
  let draft = createBlankDraft("i2c");
  const first = addFlowInterface(draft, "sample_external");
  const second = addFlowInterface(first.draft, "sample_external");
  draft = {
    ...second.draft,
    flowInterfaces: second.draft.flowInterfaces!.map((op) =>
      op.id === second.op.id ? { ...op, inputMode: "trigger" as const } : op,
    ),
  };
  const out = addFlowInterface(draft, "emit");
  draft = out.draft;
  if (second.op.type !== "sample_external" || out.op.type !== "emit")
    throw new Error("interfaces");
  const recipe = draftToCanvasSensorRecipes(draft)[0]!;
  const selection = sensorInstanceSelection(
    recipe,
    second.op.fromChannelId,
    out.op.channelId,
  );
  expect(selection.channels.filter((ch) => ch.direction === "write")).toHaveLength(1);
  expect(selection.channels.filter((ch) => ch.direction === "read")).toHaveLength(1);
  const entry = findCatalogEntryById(BACKBONE_SENSOR_BLOCK_CATALOG_ID)!;
  const props = propertiesForSensorModule(
    createModuleFromRecipe(recipe),
    recipe,
    selection,
  );
  expect(props[SENSOR_INPUT_PROP]).toBe(second.op.fromChannelId);
  const overlay = catalogEntryWithSensorChannels(entry, props);
  expect(overlay.inputs.map((port) => port.id)).toEqual([second.op.fromChannelId]);
  expect(overlay.outputs.map((port) => port.id)).toEqual([out.op.channelId]);
  expect(
    parseDeviceRecipeDraft(serializeDeviceRecipeDraft(draft))!.flowInterfaces?.find(
      (op) => op.id === second.op.id,
    ),
  ).toMatchObject({ inputMode: "trigger" });
});

it("numbers new variables across inputs and existing read buffers without renaming them", () => {
  const base = createBlankDraft("i2c");
  const first = addFlowInterface(base, "sample_external");
  expect(first.op).toMatchObject({ into: "var1" });
  const second = addFlowInterface(first.draft, "sample_external");
  expect(second.op).toMatchObject({ into: "var2" });
  const withRead = {
    ...second.draft,
    phases: {
      ...second.draft.phases,
      init: [{ id: "read", type: "i2c_read" as const, len: 1, into: "var3" }],
    },
  };
  const fourth = addFlowInterface(withRead, "sample_external");
  expect(fourth.op).toMatchObject({ into: "var4" });
  expect(fourth.draft.variables.map((variable) => variable.name)).toEqual([
    "var1",
    "var2",
    "var4",
  ]);
  expect(fourth.draft.phases.init[0]).toMatchObject({ into: "var3" });
});
