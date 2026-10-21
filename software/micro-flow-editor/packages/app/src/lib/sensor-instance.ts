import type { DeviceRecipeDraft, DeviceRecipeOp } from "./device-recipe-draft.js";
import type { SensorChannel, SensorRecipe } from "./sensor-recipe.js";

export const SENSOR_INSTANCE_PROP = "sensorSingleInstance";
export const SENSOR_INPUT_PROP = "sensorInputId";
export const SENSOR_OUTPUT_PROP = "sensorOutputId";
export const SENSOR_ACTION_LABEL_PROP = "sensorActionLabel";

export function sensorInterfaces(draft: DeviceRecipeDraft) {
  const ops = [
    ...(draft.flowInterfaces ?? []),
    ...draft.commands.flatMap((action) => action.steps),
  ];
  if (draft.moduleProgram) {
    const contracts=Object.values(draft.moduleProgram.actions);
    const inputs: Extract<DeviceRecipeOp,{type:"sample_external"}>[] = [...new Set(contracts.flatMap(action => Object.keys(action.inputIds)))].map(id => ({id:`program-input:${id}`,type:"sample_external",fromChannelId:id,into:id,inputMode:"data",valueType:"number"}));
    const outputs: Extract<DeviceRecipeOp,{type:"emit"}>[] = [...new Set(contracts.flatMap(action => Object.keys(action.outputIds)))].map(id => ({id:`program-output:${id}`,type:"emit",channelId:id,from:id}));
    inputs.push(...ops.filter((op): op is Extract<DeviceRecipeOp,{type:"sample_external"}> => op.type==="sample_external" && op.inputMode==="trigger" && !op.triggerHighAction && !op.triggerLowAction));
    return {inputs,outputs};
  }
  const inputs = ops.filter(
    (op): op is Extract<DeviceRecipeOp, { type: "sample_external" }> =>
      op.type === "sample_external",
  );
  const outputs = ops.filter(
    (op): op is Extract<DeviceRecipeOp, { type: "emit" }> => op.type === "emit",
  );
  return { inputs, outputs };
}
export function sensorInstanceSelection(
  recipe: SensorRecipe,
  inputId?: string,
  outputId?: string,
) {
  const draft = recipe.deviceDraft;
  if (!draft)
    return { inputId: "execute", outputId: "", channels: [] as SensorChannel[] };
  const { inputs, outputs } = sensorInterfaces(draft);
  if (inputId === undefined) {
    const motor = draft.commands
      .find((action) => action.id === recipe.actionId)
      ?.steps.find((op) => op.type === "stepper");
    if (motor?.type === "stepper")
      inputId =
        motor.command === "position"
          ? inputs.find((input) => input.into === motor.positionVariable)?.fromChannelId
          : "execute";
  }
  const input =
    inputId === ""
      ? undefined
      : (inputs.find((op) => op.fromChannelId === inputId) ??
        (inputId === "execute" ? undefined : inputs[0]));
  const output =
    outputId === ""
      ? undefined
      : (outputs.find((op) => op.channelId === outputId) ??
        outputs.find((op) =>
          recipe.channels?.some(
            (channel) => channel.id === op.channelId && channel.direction === "read",
          ),
        ));
  const channels: SensorChannel[] = [];
  if (input) {
    const channel = draft.channels.find((ch) => ch.id === input.fromChannelId);
    if (channel) channels.push({ ...channel, inputMode: input.inputMode ?? "data" });
  }
  if (output) {
    const channel = draft.channels.find((ch) => ch.id === output.channelId);
    if (channel) channels.push(channel);
  }
  return {
    inputId: input?.fromChannelId ?? (inputId === "" ? "" : "execute"),
    outputId: output?.channelId ?? "",
    channels,
  };
}
