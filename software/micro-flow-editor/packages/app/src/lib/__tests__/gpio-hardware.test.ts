import { workbenchStepDetail } from "../../components/device-recipe-editor/sensor-workbench-labels.js";
import { describe, expect, it } from "vitest";
import {
  parseDeviceRecipeDraft,
  serializeDeviceRecipeDraft,
  draftToCanvasSensorRecipes,
} from "../device-recipe-draft.js";
import {
  createGpioButtonPreset,
  createGpioRgbLedPreset,
} from "../gpio-driver-presets.js";

describe("GPIO hardware appearance", () => {
  it("keeps declared power and passive contacts across saved driver reloads", () => {
    const original = createGpioButtonPreset();
    const draft = {
      ...original,
      gpioHardware: {
        kind: "relay" as const,
        power: "5" as const,
        ground: true,
        extraTerminals: ["COM", "NO", "NC"],
      },
    };
    const restored = parseDeviceRecipeDraft(serializeDeviceRecipeDraft(draft))!;
    expect(restored.gpioHardware).toEqual(draft.gpioHardware);
    expect(restored.binding.gpioSignals).toEqual(original.binding.gpioSignals);
    expect(restored.commands).toEqual(original.commands);
    expect(
      draftToCanvasSensorRecipes(restored).every(
        (r) => r.deviceDraft?.gpioHardware?.power === "5",
      ),
    ).toBe(true);
  });
  it("renames terminals without changing operation and event references", () => {
    const draft = createGpioButtonPreset();
    const id = draft.binding.gpioSignals[0]!.id;
    const renamed = {
      ...draft,
      binding: {
        ...draft.binding,
        gpioSignals: draft.binding.gpioSignals.map((signal) => ({
          ...signal,
          name: "DATA",
        })),
      },
    };
    const restored = parseDeviceRecipeDraft(serializeDeviceRecipeDraft(renamed))!;
    expect(restored.binding.gpioSignals[0]?.id).toBe(id);
    expect(restored.binding.gpioSignals[0]?.name).toBe("DATA");
    expect(restored.commands).toEqual(draft.commands);
    expect(
      workbenchStepDetail(
        restored.commands[0]!.steps[0]!,
        true,
        restored.binding.gpioSignals,
      ),
    ).toContain("DATA");
    expect(restored.gpioEvents?.every((event) => event.sourceSignalId === id)).toBe(
      true,
    );
  });
  it("assigns matching artwork to presets without inventing supply pins", () => {
    expect(createGpioButtonPreset().gpioHardware?.kind).toBe("button");
    const rgb = createGpioRgbLedPreset();
    expect(rgb.gpioHardware).toMatchObject({
      kind: "rgb",
      power: "none",
      ground: false,
    });
    expect(rgb.binding.gpioSignals.map((signal) => signal.id)).toEqual([
      "RED",
      "GREEN",
      "BLUE",
    ]);
  });
});
