import { planDriverCanvasChanges } from "../driver-canvas-plan.js";
import { describe, expect, it } from "vitest";
import {
  createBlankDraft,
  draftToCanvasSensorRecipes,
  parseDeviceRecipeDraft,
  serializeDeviceRecipeDraft,
  validateDraftForCreate,
} from "../device-recipe-draft.js";
import {
  addRegisterAction,
  duplicateDriverAction,
  actionPorts,
} from "../i2c-driver-actions.js";
import { evaluateRecipeReadResults } from "../recipe-read-results.js";
import {
  propertiesForSensorModule,
  SENSOR_MODULE_ID_PROP,
  SENSOR_ACTION_ID_PROP,
  catalogEntryWithSensorChannels,
  BACKBONE_SENSOR_BLOCK_CATALOG_ID,
} from "../backbone-sensor-block.js";
import { createModuleFromRecipe } from "../backbone-sensor-modules.js";
import { findCatalogEntryById } from "@spaghettilab/processing-block-catalog";

describe("I2C driver actions", () => {
  it("creates read and write blocks sharing one physical instance, preserving full operations", () => {
    const read = addRegisterAction(createBlankDraft("i2c", "MPU6050"), "read", true);
    const draft = addRegisterAction(read, "write", true);
    expect(draft.commands).toHaveLength(2);
    expect(validateDraftForCreate(draft)).toEqual([]);
    const recipes = draftToCanvasSensorRecipes(draft);
    const module = createModuleFromRecipe(recipes[0]!);
    const props = recipes.map((r) => propertiesForSensorModule(module, r));
    expect(new Set(props.map((p) => p[SENSOR_MODULE_ID_PROP])).size).toBe(1);
    expect(new Set(props.map((p) => p[SENSOR_ACTION_ID_PROP])).size).toBe(2);
    expect(recipes[0]?.deviceDraft).toEqual(draft);
    expect(recipes[1]?.channels).toEqual([]);
    const writeEntry = catalogEntryWithSensorChannels(
      findCatalogEntryById(BACKBONE_SENSOR_BLOCK_CATALOG_ID)!,
      props[1]!,
    );
    expect(writeEntry.inputs.map((p) => p.id)).toContain("execute");
    expect(writeEntry.outputs).toEqual([]);
    expect(parseDeviceRecipeDraft(serializeDeviceRecipeDraft(draft))?.commands).toEqual(
      draft.commands,
    );
  });
  it("duplicates an action with independent step identities and keeps its output contract", () => {
    const draft = addRegisterAction(createBlankDraft("i2c"), "read", true);
    const copy = duplicateDriverAction(draft, draft.commands[0]!);
    expect(copy.commands[0]?.id).not.toBe(copy.commands[1]?.id);
    expect(copy.commands[0]?.steps[0]?.id).not.toBe(copy.commands[1]?.steps[0]?.id);
    expect(actionPorts(copy, copy.commands[1]!).outputs).toHaveLength(1);
  });
  it("decodes real RX and leaves missing captures unavailable", () => {
    const draft = addRegisterAction(createBlankDraft("i2c"), "read", true);
    const steps = draft.commands[0]!.steps;
    expect(
      evaluateRecipeReadResults(draft, steps, { [steps[0]!.id]: [0x68] })[0]?.value,
    ).toBe(104);
    expect(evaluateRecipeReadResults(draft, steps, {})[0]?.value).toBeNull();
  });
  it("handles signed little-endian values and scaling", () => {
    const draft = addRegisterAction(createBlankDraft("i2c"), "read", true);
    const steps = draft.commands[0]!.steps.map((op) =>
      op.type === "decode"
        ? {
            ...op,
            endByte: 1,
            signed: true,
            byteOrder: "le" as const,
            divide: 10,
            offset: 2,
          }
        : op,
    );
    expect(
      evaluateRecipeReadResults(draft, steps, { [steps[0]!.id]: [0x9c, 0xff] })[0]
        ?.value,
    ).toBe(-8);
  });
});

describe("driver canvas regeneration", () => {
  it("preserves connected action block IDs, removes orphan duplicates, and adds only missing actions", () => {
    let draft = addRegisterAction(createBlankDraft("i2c"), "read", true);
    draft = addRegisterAction(draft, "write", true);
    const recipes = draftToCanvasSensorRecipes(draft);
    const module = createModuleFromRecipe(recipes[0]!);
    const oldModule = { ...module, id: "orphan" };
    const nodes = [
      {
        id: "connected-read",
        properties: propertiesForSensorModule(module, recipes[0]!),
      },
      { id: "copied-read", properties: propertiesForSensorModule(module, recipes[0]!) },
      {
        id: "orphan-read",
        properties: propertiesForSensorModule(oldModule, recipes[0]!),
      },
      { id: "unrelated", properties: { backboneSensorModuleId: "another-sensor" } },
    ];
    const changes = planDriverCanvasChanges(recipes, module.id, nodes);
    expect(changes.updates.map((u) => u.id)).toEqual(["connected-read", "copied-read"]);
    expect(changes.removals).toEqual(["orphan-read"]);
    expect(changes.additions.map((r) => r.actionId)).toEqual([recipes[1]!.actionId]);
    const hidden = {
      ...draft,
      commands: draft.commands.map((c) => ({
        ...c,
        exposeOnCanvas: c.id === recipes[1]!.actionId,
      })),
    };
    const hiddenChanges = planDriverCanvasChanges(
      draftToCanvasSensorRecipes(hidden),
      module.id,
      nodes,
    );
    expect(hiddenChanges.removals).toEqual([
      "connected-read",
      "copied-read",
      "orphan-read",
    ]);
  });
});
