import { planDriverCanvasChanges } from "../driver-canvas-plan.js";
import { describe, expect, it } from "vitest";
import {
  createBlankDraft,
  addCommand,
  insertCommandStep,
  resolveI2cOpAddress,
  draftToCanvasSensorRecipes,
  parseDeviceRecipeDraft,
  serializeDeviceRecipeDraft,
  validateDraftForCreate,
} from "../device-recipe-draft.js";
import {
  addRegisterAction,
  bindEncoderFlowInput,
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
  it("uses the shared address even for older steps with an address snapshot", () => {
    const draft = createBlankDraft("i2c");
    const shared = {
      ...draft,
      binding: { ...draft.binding, i2c: { ...draft.binding.i2c!, address: "0x68" } },
    };
    expect(resolveI2cOpAddress({ address: "0x3c" }, shared)).toBe("0x68");
  });
  it("binds multiple external inputs to distinct encoded variables and exposes them on the same action", () => {
    let draft = addCommand(createBlankDraft("i2c"), { label: "Configura" });
    const actionId = draft.commands.at(-1)!.id;
    for (let i = 0; i < 2; i++) {
      draft = insertCommandStep(draft, actionId, "encode");
      const encoder = draft.commands.find((c) => c.id === actionId)!.steps.at(-1)!;
      draft = bindEncoderFlowInput(draft, encoder.id);
    }
    const action = draft.commands.find((c) => c.id === actionId)!;
    expect(action.steps.map((step) => step.type)).toEqual([
      "sample_external",
      "encode",
      "sample_external",
      "encode",
    ]);
    expect(actionPorts(draft, action).inputs).toHaveLength(2);
    const encoders = action.steps.filter((step) => step.type === "encode");
    expect(new Set(encoders.map((step) => step.into)).size).toBe(2);
    const rebound = bindEncoderFlowInput(
      draft,
      encoders[0]!.id,
      actionPorts(draft, action).inputs[0]!.id,
    );
    expect(rebound.commands.find((c) => c.id === actionId)?.steps).toHaveLength(4);
    expect(
      draftToCanvasSensorRecipes(draft)
        .find((r) => r.actionId === actionId)
        ?.channels.filter((c) => c.direction === "write"),
    ).toHaveLength(2);
  });
  it("publishes two decoded variables as two separate output ports", () => {
    let draft = addRegisterAction(createBlankDraft("i2c"), "read", true);
    const actionId = draft.commands[0]!.id;
    draft = insertCommandStep(draft, actionId, "decode");
    draft = insertCommandStep(draft, actionId, "emit");
    const action = draft.commands[0]!;
    expect(actionPorts(draft, action).outputs).toHaveLength(2);
    const decode = action.steps.findLast((op) => op.type === "decode")!;
    expect(decode.endByte).toBe(0);
    expect(action.steps.at(-1)).toMatchObject({ type: "emit", from: decode.into });
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
