import { rgbInputLabel } from "./rgb-module.js";
import { MOVEMENT_COMPLETED } from "./flow-sequence.js";
import {
  SENSOR_INSTANCE_PROP,
  SENSOR_INPUT_PROP,
  SENSOR_OUTPUT_PROP,
  SENSOR_ACTION_LABEL_PROP,
  sensorInstanceSelection,
} from "./sensor-instance.js";
import type {
  BlockPort,
  PortType,
  ProcessingCatalogEntry,
} from "@spaghettilab/processing-block-catalog";
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
export const SENSOR_ACTION_ID_PROP = "sensorActionId";
export const SENSOR_DRIVER_INSTANCE_PROP = "sensorDriverInstanceId";
export const SENSOR_CHIP_PROP = "sensorChip";

export function portTypesForQuantity(
  quantity: SensorOutputKind,
  direction: "read" | "write",
): readonly PortType[] {
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
      inputs.push(
        inPort(
          channel.id,
          channel.inputMode === "trigger"
            ? [T.activationTrigger, T.eventTrigger, T.digitalComando]
            : channel.dataType === "string"
              ? [{ domain: "text", role: "comando" }]
              : portTypesForQuantity(channel.quantity, "write"),
          { label, required: false },
        ),
      );
    } else {
      outputs.push(
        outPort(
          channel.id,
          channel.outputMode === "event"
            ? [T.eventTrigger, T.digitalMisura]
            : portTypesForQuantity(channel.quantity, "read"),
          label,
        ),
      );
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
  selection?: { inputId?: string; outputId?: string },
): Record<string, string | number | boolean> {
  const rgb = Boolean(recipe.deviceDraft?.rgbModule);
  const single =
    Boolean(recipe.actionId && recipe.deviceDraft) && !recipe.deviceDraft?.dht22Module;
  const selected = sensorInstanceSelection(
    recipe,
    selection?.inputId,
    selection?.outputId,
  );
  const channels = recipe.deviceDraft?.dht22Module
    ? recipe.deviceDraft.channels
    : rgb
      ? recipe.deviceDraft!.channels.map((channel) => ({
          ...channel,
          label:
            channel.direction === "write"
              ? rgbInputLabel(
                  recipe.deviceDraft!.rgbModule!.inputs.find(
                    (input) => input.id === channel.id,
                  ) ?? {
                    id: channel.id,
                    name: channel.label,
                    mode: "trigger",
                    actionId: "",
                    edge: "rising",
                  },
                )
              : channel.id === "state"
                ? "È acceso"
                : channel.id === "color"
                  ? "Colore emesso"
                  : channel.label,
        }))
      : single
        ? selected.channels
        : recipeChannels(recipe);
  return {
    [SENSOR_MODULE_ID_PROP]: module.id,
    ...(rgb
      ? {
          sensorRgbInputFamilies: JSON.stringify(
            Object.fromEntries(
              recipe
                .deviceDraft!.rgbModule!.inputs.filter(
                  (input) => input.mode !== "trigger",
                )
                .map((input) => [
                  input.id,
                  input.mode === "component" ? "rgb" : "color",
                ]),
            ),
          ),
        }
      : {}),
    ...(recipe.deviceDraft?.dht22Module ? { sensorDht22: true } : {}),
    ...(recipe.deviceDraft?.commands.some((command) =>
      command.steps.some((op) => op.type === "stepper"),
    )
      ? { sensorMotion: true }
      : {}),
    ...(single
      ? {
          [SENSOR_INSTANCE_PROP]: true,
          [SENSOR_INPUT_PROP]: rgb ? "" : selected.inputId,
          [SENSOR_OUTPUT_PROP]: rgb ? "" : selected.outputId,
          [SENSOR_ACTION_LABEL_PROP]:
            recipe.deviceDraft?.commands.find((action) => action.id === recipe.actionId)
              ?.label ?? "",
        }
      : {}),
    ...(recipe.actionId
      ? {
          [SENSOR_ACTION_ID_PROP]: recipe.actionId,
          [SENSOR_DRIVER_INSTANCE_PROP]: recipe.driverInstanceId ?? module.id,
        }
      : {}),
    [SENSOR_RECIPE_ID_PROP]: recipe.id,
    [SENSOR_CHIP_PROP]: single ? recipe.deviceDraft!.name : recipe.chip,
    [SENSOR_CHANNELS_JSON_PROP]: serializeSensorChannels(channels),
  };
}

/** Overlay dynamic ports from node properties onto the backbone_sensor catalog entry. */
export function catalogEntryWithSensorChannels(
  entry: ProcessingCatalogEntry,
  properties: Readonly<Record<string, unknown>>,
): ProcessingCatalogEntry {
  if (
    entry.id !== BACKBONE_SENSOR_BLOCK_CATALOG_ID &&
    entry.typeId !== BACKBONE_SENSOR_BLOCK_TYPE_ID
  ) {
    return entry;
  }
  const channels = channelsFromNodeProperties(properties);
  const isAction = typeof properties[SENSOR_ACTION_ID_PROP] === "string";
  if (channels.length === 0 && !isAction) return entry;
  const { inputs, outputs: channelOutputs } = blockPortsFromChannels(channels);
  const outputs = [...channelOutputs];
  // This native event is independent of the selected synchronous action output.
  if (properties.sensorMotion === true)
    outputs.push(outPort(MOVEMENT_COMPLETED, [T.eventTrigger], "Movimento terminato"));
  return {
    ...entry,
    label:
      typeof properties[SENSOR_CHIP_PROP] === "string"
        ? String(properties[SENSOR_CHIP_PROP])
        : entry.label,
    inputs:
      isAction &&
      properties.sensorDht22 !== true &&
      (properties[SENSOR_INSTANCE_PROP] !== true ||
        properties[SENSOR_INPUT_PROP] === "execute")
        ? [
            inPort("execute", [T.activationTrigger, T.eventTrigger, T.digitalComando], {
              label: "Esegui",
              required: false,
            }),
            ...inputs,
          ]
        : inputs,
    outputs,
  };
}

export function isBackboneSensorBlockProperties(
  properties: Readonly<Record<string, unknown>>,
): boolean {
  return (
    typeof properties[SENSOR_MODULE_ID_PROP] === "string" ||
    typeof properties[SENSOR_CHANNELS_JSON_PROP] === "string"
  );
}
