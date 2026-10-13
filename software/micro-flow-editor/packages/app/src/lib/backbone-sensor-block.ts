import type { BlockPort, PortType, ProcessingCatalogEntry } from "@spaghettilab/processing-block-catalog";
import { inPort, outPort, T } from "@spaghettilab/processing-block-catalog";
import type { BackboneSensorModule } from "./backbone-sensor-modules.js";
import {
  recipeChannels,
  type SensorChannel,
  type SensorOutputKind,
  type SensorRecipe,
} from "./sensor-recipe.js";

/** Catalog block placed on the Flow canvas when a Backbone sensor module is added. */
export const BACKBONE_SENSOR_BLOCK_CATALOG_ID = "appblocks.backbone_sensor";
export const BACKBONE_SENSOR_BLOCK_TYPE_ID = "ab.backbone_sensor";

export const SENSOR_CHANNELS_JSON_PROP = "sensorChannelsJson";
export const SENSOR_MODULE_ID_PROP = "backboneSensorModuleId";
export const SENSOR_RECIPE_ID_PROP = "sensorRecipeId";
export const SENSOR_CHIP_PROP = "sensorChip";

export function portTypesForQuantity(quantity: SensorOutputKind, direction: "read" | "write"): readonly PortType[] {
  if (direction === "write") {
    switch (quantity) {
      case "digital":
        return [T.digitalComando];
      case "analog":
        return [T.analogComando];
      default:
        return [T.digitalComando, T.analogComando];
    }
  }
  switch (quantity) {
    case "digital":
      return [T.digitalMisura];
    case "temperature":
    case "humidity":
    case "pressure":
    case "distance":
    case "light":
    case "analog":
      return [T.analogMisura];
    default:
      return [T.analogMisura, T.digitalMisura];
  }
}

export function blockPortsFromChannels(channels: readonly SensorChannel[]): {
  readonly inputs: readonly BlockPort[];
  readonly outputs: readonly BlockPort[];
} {
  const inputs: BlockPort[] = [];
  const outputs: BlockPort[] = [];
  for (const channel of channels) {
    const label = `${channel.label}${channel.unit ? ` (${channel.unit})` : ""}`;
    if (channel.direction === "write") {
      inputs.push(inPort(channel.id, portTypesForQuantity(channel.quantity, "write"), { label, required: false }));
    } else {
      outputs.push(outPort(channel.id, portTypesForQuantity(channel.quantity, "read"), label));
    }
  }
  return { inputs, outputs };
}

export function serializeSensorChannels(channels: readonly SensorChannel[]): string {
  return JSON.stringify(channels);
}

export function parseSensorChannels(raw: unknown): readonly SensorChannel[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isSensorChannel);
  } catch {
    return [];
  }
}

function isSensorChannel(value: unknown): value is SensorChannel {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SensorChannel>;
  return (
    typeof item.id === "string" &&
    typeof item.label === "string" &&
    typeof item.unit === "string" &&
    typeof item.quantity === "string" &&
    (item.direction === "read" || item.direction === "write")
  );
}

export function channelsFromNodeProperties(
  properties: Readonly<Record<string, unknown>>,
): readonly SensorChannel[] {
  return parseSensorChannels(properties[SENSOR_CHANNELS_JSON_PROP]);
}

export function propertiesForSensorModule(
  module: BackboneSensorModule,
  recipe: SensorRecipe = module.recipe,
): Record<string, string | number | boolean> {
  const channels = recipeChannels(recipe);
  return {
    [SENSOR_MODULE_ID_PROP]: module.id,
    [SENSOR_RECIPE_ID_PROP]: recipe.id,
    [SENSOR_CHIP_PROP]: recipe.chip,
    [SENSOR_CHANNELS_JSON_PROP]: serializeSensorChannels(channels),
  };
}

/** Overlay dynamic ports from node properties onto the backbone_sensor catalog entry. */
export function catalogEntryWithSensorChannels(
  entry: ProcessingCatalogEntry,
  properties: Readonly<Record<string, unknown>>,
): ProcessingCatalogEntry {
  if (entry.id !== BACKBONE_SENSOR_BLOCK_CATALOG_ID && entry.typeId !== BACKBONE_SENSOR_BLOCK_TYPE_ID) {
    return entry;
  }
  const channels = channelsFromNodeProperties(properties);
  if (channels.length === 0) return entry;
  const { inputs, outputs } = blockPortsFromChannels(channels);
  return {
    ...entry,
    label: typeof properties[SENSOR_CHIP_PROP] === "string" ? String(properties[SENSOR_CHIP_PROP]) : entry.label,
    inputs,
    outputs,
  };
}

export function isBackboneSensorBlockProperties(properties: Readonly<Record<string, unknown>>): boolean {
  return typeof properties[SENSOR_MODULE_ID_PROP] === "string" || typeof properties[SENSOR_CHANNELS_JSON_PROP] === "string";
}
