export type RgbInputFamily = "color" | "rgb";
export function disabledRgbInputs(
  families: Readonly<Record<string, RgbInputFamily>>,
  connected: readonly string[],
): string[] {
  const used = new Set(connected.map((id) => families[id]).filter(Boolean));
  return Object.entries(families)
    .filter(([, family]) => (family === "color" ? used.has("rgb") : used.has("color")))
    .map(([id]) => id);
}
export function rgbInputFamilies(
  properties: Readonly<Record<string, unknown>>,
): Readonly<Record<string, RgbInputFamily>> {
  if (typeof properties.sensorRgbInputFamilies !== "string") return {};
  try {
    return JSON.parse(properties.sensorRgbInputFamilies);
  } catch {
    return {};
  }
}
