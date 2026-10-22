import { rgbLedPresets, RGB_PRESET_PREFIX } from "./rgb-led-presets.js";
export type RgbInputFamily = "color" | "rgb" | "preset";
export function disabledRgbInputs(
  families: Readonly<Record<string, RgbInputFamily>>,
  connected: readonly string[],
): string[] {
  const used = new Set(connected.map((id) => families[id]).filter(Boolean));
  return Object.entries(families)
    .filter(([, family]) => [...used].some(active => active !== family))
    .map(([id]) => id);
}
export function rgbInputFamilies(
  properties: Readonly<Record<string, unknown>>,
): Readonly<Record<string, RgbInputFamily>> {
  if (typeof properties.sensorRgbInputFamilies !== "string") return {};
  try {
    return { ...JSON.parse(properties.sensorRgbInputFamilies), ...Object.fromEntries(rgbLedPresets(properties).presets.map(preset => [RGB_PRESET_PREFIX + preset.id, "preset"])) };
  } catch {
    return {};
  }
}
