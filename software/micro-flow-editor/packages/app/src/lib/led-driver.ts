export type LedPreset = {
  id: string;
  name: string;
  color: string;
  level: "high" | "low";
};
export type LedDriverConfig = {
  outputMode?: "hex" | "rgb";
  presets: readonly LedPreset[];
};
export const LED_DRIVER_TYPE = "led_driver";
export function defaultLedDriver(): LedDriverConfig {
  return {
    outputMode: "hex",
    presets: [
      { id: "0", name: "Preset 1", color: "#FF3366", level: "high" },
      { id: "1", name: "Preset 2", color: "#3388FF", level: "high" },
    ],
  };
}
export function readLedDriver(
  properties: Readonly<Record<string, unknown>>,
): LedDriverConfig {
  if (typeof properties.ledDriverConfig !== "string") return defaultLedDriver();
  const config = JSON.parse(properties.ledDriverConfig) as LedDriverConfig;
  validateLedDriver(config);
  return { ...config, presets: config.presets.map(preset => ({ ...preset, level: "high" as const })) };
}
export function validateLedDriver(config: LedDriverConfig): void {
  if (
    !Array.isArray(config.presets) ||
    config.presets.length < 1 ||
    config.presets.length > 4
  )
    throw new Error("Crea da 1 a 4 preset.");
  if (config.outputMode && !["hex", "rgb"].includes(config.outputMode))
    throw new Error("Scegli RGB oppure Colore.");
  const ids = new Set<string>();
  for (const preset of config.presets) {
    if (!/^[0-3]$/.test(preset.id) || ids.has(preset.id))
      throw new Error("Ogni preset deve avere un ingresso distinto.");
    ids.add(preset.id);
    if (
      !preset.name.trim() ||
      preset.name.length > 48 ||
      !/^#[0-9a-f]{6}$/i.test(preset.color) ||
      !["high", "low"].includes(preset.level)
    )
      throw new Error("Controlla nome, colore e livello di attivazione dei preset.");
  }
}
export function ledDriverProperties(properties: Readonly<Record<string, unknown>>) {
  const config = readLedDriver(properties);
  const result: Record<string, bigint> = {
    "9": 0n,
    "11": config.outputMode === "rgb" ? 1n : 0n,
  };
  for (let i = 0; i < 4; i++) {
    result[String(i + 1)] = 0n;
    result[String(i + 5)] = 1n;
  }
  for (const preset of config.presets) {
    const id = Number(preset.id);
    result[String(id + 1)] = BigInt(Number.parseInt(preset.color.slice(1), 16));
    result[String(id + 5)] = 1n;
    result["9"]! |= 1n << BigInt(id);
  }
  return result;
}
