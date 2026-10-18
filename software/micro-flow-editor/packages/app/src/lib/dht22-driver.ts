import type { DeviceRecipeDraft, DeviceRecipeOp } from "./device-recipe-draft.js";

export function dht22OutputFormat(draft: DeviceRecipeDraft): "float" | "string" {
  const op = [...draft.commands.flatMap(action => action.steps), ...(draft.flowInterfaces ?? [])].find(op => op.type === "dht22_convert");
  return op?.type === "dht22_convert" ? op.format : "float";
}

export function setDht22OutputFormat(draft: DeviceRecipeDraft, format: "float" | "string"): DeviceRecipeDraft {
  const update = (op: DeviceRecipeOp): DeviceRecipeOp => op.type === "dht22_convert" ? { ...op, format } : op;
  return { ...draft, updatedAt: Date.now(),
    commands: draft.commands.map(action => ({ ...action, steps: action.steps.map(update) })),
    flowInterfaces: draft.flowInterfaces?.map(update),
    channels: draft.channels.map(channel => channel.id === "temperature" ? { ...channel, label: "Temperatura", unit: "°C", dataType: format === "string" ? "string" : "number" } : channel),
  };
}
