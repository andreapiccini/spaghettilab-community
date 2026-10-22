import { it, expect } from "vitest";
import { disabledRgbInputs, rgbInputFamilies } from "../rgb-input-mode.js";
const families = {
  "color-input": "color",
  "red-level": "rgb",
  "green-level": "rgb",
  "blue-level": "rgb",
} as const;
it("keeps both input families available before any wire and after disconnect", () => {
  expect(disabledRgbInputs(families, [])).toEqual([]);
  expect(
    rgbInputFamilies({ sensorRgbInputFamilies: JSON.stringify(families) }),
  ).toEqual({ ...families, "preset:0": "preset", "preset:1": "preset" });
});
it("disables all three RGB ports when Color is connected", () => {
  expect(disabledRgbInputs(families, ["color-input"])).toEqual([
    "red-level",
    "green-level",
    "blue-level",
  ]);
});
it.each(["red-level", "green-level", "blue-level"])(
  "disables only Color when %s is connected",
  (handle) => {
    expect(disabledRgbInputs(families, [handle])).toEqual(["color-input"]);
  },
);
it("keeps Color disabled until the last RGB connection is removed", () => {
  expect(disabledRgbInputs(families, ["red-level", "blue-level"])).toEqual([
    "color-input",
  ]);
  expect(disabledRgbInputs(families, ["blue-level"])).toEqual(["color-input"]);
  expect(disabledRgbInputs(families, [])).toEqual([]);
});
it("ignores unrelated inputs and supports user-named color inputs", () => {
  expect(disabledRgbInputs(families, ["trigger"])).toEqual([]);
  expect(
    disabledRgbInputs({ ...families, "custom-color": "color" }, ["green-level"]),
  ).toEqual(["color-input", "custom-color"]);
});

it("makes integrated presets exclusive with direct Color and RGB inputs", () => {
  const integrated = rgbInputFamilies({ sensorRgbInputFamilies: JSON.stringify(families) });
  expect(disabledRgbInputs(integrated, ["preset:0"])).toEqual(Object.keys(families));
  expect(disabledRgbInputs(integrated, ["color-input"])).toContain("preset:0");
  expect(disabledRgbInputs(integrated, [])).toEqual([]);
});
