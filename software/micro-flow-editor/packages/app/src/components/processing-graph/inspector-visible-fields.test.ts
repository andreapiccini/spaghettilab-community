import { defaultPropertiesFromFields, findCatalogEntryById } from "@spaghettilab/processing-block-catalog";
import { describe, expect, it } from "vitest";
import {
  DIGITAL_OUT_TOGGLE_INSPECTOR_FIELD_IDS,
  inspectorVisibleFields,
  LED_INSPECTOR_FIELD_IDS,
} from "./inspector-visible-fields.js";

describe("inspectorVisibleFields", () => {
  it("keeps only toggle type, initial state, and pulse counts on Digital Out Toggle", () => {
    const entry = findCatalogEntryById("appblocks.digital_out_toggle")!;
    const visible = inspectorVisibleFields(entry, entry.fields ?? []);
    expect(visible.map((field) => field.id)).toEqual([...DIGITAL_OUT_TOGGLE_INSPECTOR_FIELD_IDS]);
    expect(entry.fields?.map((field) => field.id)).toEqual(
      expect.arrayContaining(["line", "pulseMs", ...DIGITAL_OUT_TOGGLE_INSPECTOR_FIELD_IDS]),
    );
    const defaults = defaultPropertiesFromFields(entry.fields ?? []);
    expect(defaults.line).toBe("LED");
    expect(defaults.pulseMs).toBe(100n);
    expect(defaults.toggleMode).toBe("astable");
    expect(defaults.initial).toBe("high");
    expect(defaults.lowToHigh).toBe(1n);
    expect(defaults.highToLow).toBe(1n);
  });

  it("shows astable pulse-count fields even when toggleMode is a pulse mode", () => {
    const entry = findCatalogEntryById("appblocks.digital_out_toggle")!;
    const gated = (entry.fields ?? []).filter((field) => field.when?.field === "toggleMode" && field.id !== "pulseMs");
    expect(gated.map((field) => field.id)).toEqual(["initial", "lowToHigh", "highToLow"]);
    expect(inspectorVisibleFields(entry, entry.fields ?? []).every((field) => field.when === undefined)).toBe(true);
  });

  it("keeps only color, delays, and soft start/stop on LED", () => {
    const entry = findCatalogEntryById("appblocks.led")!;
    const visible = inspectorVisibleFields(entry, entry.fields ?? []);
    expect(visible.map((field) => field.id)).toEqual([...LED_INSPECTOR_FIELD_IDS]);
    expect(entry.fields?.map((field) => field.id)).toEqual(
      expect.arrayContaining(["threshold", "negated", ...LED_INSPECTOR_FIELD_IDS]),
    );
    const defaults = defaultPropertiesFromFields(entry.fields ?? []);
    expect(defaults.threshold).toBe(50n);
    expect(defaults.negated).toBe(false);
    expect(defaults.color).toBe("#F5C518");
  });

  it("leaves other catalog blocks unchanged", () => {
    const entry = findCatalogEntryById("appblocks.rgb_led")!;
    expect(inspectorVisibleFields(entry, entry.fields ?? [])).toBe(entry.fields);
  });
});
