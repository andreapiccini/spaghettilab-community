import { describe, expect, it } from "vitest";
import {
  assignModuleGpioPin,
  createModuleFromRecipe,
  gpioAssignmentValue,
  isGpioModule,
  parseGpioAssignment,
  upsertModule,
} from "../backbone-sensor-modules.js";
import type { SensorRecipe } from "../sensor-recipe.js";

const recipe = {
  id: "relay",
  chip: "Relè",
  bus: "gpio",
  oneLiner: "ON/OFF",
  voltage: "5V",
  pins: [],
  outputs: [],
  recipe: { sample: [] },
  tryNow: { outputId: "stato" },
  confidence: "high",
} as unknown as SensorRecipe;

describe("GPIO assignment on a Backbone module", () => {
  it("parses and formats boardKey:channel", () => {
    expect(parseGpioAssignment("master:board:2")).toEqual({ boardKey: "master:board", channel: 2 });
    expect(gpioAssignmentValue({ boardKey: "master:board", channel: 2 })).toBe("master:board:2");
    expect(parseGpioAssignment("")).toBeUndefined();
  });

  it("stores the chosen pin on the module", () => {
    const module = { ...createModuleFromRecipe(recipe), id: "nfc-module-1" };
    expect(isGpioModule(module)).toBe(true);
    const stored = assignModuleGpioPin(
      upsertModule({ version: 1, byBinding: {} }, "master", module),
      "master",
      module.id,
      { boardKey: "master:board", channel: 3 },
    );
    expect(stored.byBinding.master?.[0]?.gpioAssignment).toEqual({
      boardKey: "master:board",
      channel: 3,
    });
  });
});
