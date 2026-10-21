import { expect, it } from "vitest";
import { viewerColor, generatorColorKind, formatViewerValue } from "../data-viewer.js";
import { rgbModuleDraft } from "../rgb-module.js";
it("uses output semantics instead of guessing from the value", () => {
  expect(viewerColor("#ff8000")).toBeUndefined();
  expect(viewerColor(50)).toBeUndefined();
  expect(formatViewerValue("#ff8000").type).toBe("Testo");
  expect(viewerColor("#ff8000", "hex")).toMatchObject({
    color: "#FF8000",
    text: "#FF8000",
  });
  expect(viewerColor(0xff8000n, "rgb")?.color).toBe("#FF8000");
  expect(viewerColor(0n, "rgb")?.color).toBe("#000000");
  expect(
    rgbModuleDraft().channels.find((channel) => channel.id === "color")?.colorKind,
  ).toBe("rgb");
});
it.each([
  ["red", 50, "#800000"],
  ["green", 100, "#00FF00"],
  ["blue", 25, "#000040"],
  ["red", 0, "#000000"],
] as const)("shows %s at %s percent", (kind, value, color) => {
  expect(viewerColor(value, kind)).toMatchObject({ color, text: value + "%" });
});
it("rejects invalid colors and channel levels without wrapping or clipping", () => {
  for (const value of ["#123", "#GG0000", "red", 123])
    expect(viewerColor(value, "hex")).toBeUndefined();
  for (const value of [-1, 101, NaN, Infinity, "50"])
    expect(viewerColor(value, "red")).toBeUndefined();
  expect(viewerColor(0x1000000n, "rgb")).toBeUndefined();
  expect(generatorColorKind("led_driver", "0")).toBe("hex");
  expect(["1", "2", "3"].map((id) => generatorColorKind("led_driver", id))).toEqual([
    "red",
    "green",
    "blue",
  ]);
  expect(generatorColorKind("logic_if", "1")).toBeUndefined();
});
