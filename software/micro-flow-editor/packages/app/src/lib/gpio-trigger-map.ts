import type { DeviceRecipeDraft, DeviceRecipeOp } from "./device-recipe-draft.js";
import { gpioSignalType, gpioWriteLogicalLevel } from "./gpio-operation-registry.js";

export function triggerActionNames(
  op: Extract<DeviceRecipeOp, { type: "sample_external" }>,
): { high: string; low: string } {
  return {
    high: op.triggerHighAction?.trim() || "on",
    low: op.triggerLowAction?.trim() || "off",
  };
}

export function isMappedTrigger(
  op: DeviceRecipeOp,
): op is Extract<DeviceRecipeOp, { type: "sample_external" }> {
  return (
    op.type === "sample_external" &&
    op.inputMode === "trigger" &&
    Boolean(op.triggerHighAction || op.triggerLowAction)
  );
}

export function actionFixedWriteLevel(
  draft: DeviceRecipeDraft,
  commandName: string,
): 0 | 1 | undefined {
  const write = draft.commands
    .find((command) => command.name === commandName)
    ?.steps.find((step) => step.type === "gpio_write");
  return write?.type === "gpio_write" ? gpioWriteLogicalLevel(write) : undefined;
}

/** Compile a trigger mapping onto ON/OFF writes: incoming HIGH/LOW calls those actions. */
export function mappedTriggerActionSteps(
  draft: DeviceRecipeDraft,
  op: Extract<DeviceRecipeOp, { type: "sample_external" }>,
): readonly DeviceRecipeOp[] {
  const { high, low } = triggerActionNames(op);
  const highLevel = actionFixedWriteLevel(draft, high);
  const lowLevel = actionFixedWriteLevel(draft, low);
  if (highLevel === undefined || lowLevel === undefined)
    throw new Error("Associa due azioni digitali esistenti ai livelli HIGH e LOW.");
  for (const name of [high, low]) {
    const steps = draft.commands.find((command) => command.name === name)!.steps;
    if (
      steps.filter((step) => step.type === "gpio_write").length !== 1 ||
      steps.some((step) => !["gpio_write", "gpio_read", "emit"].includes(step.type))
    )
      throw new Error(
        `L’azione «${name}» contiene altri passi: questa associazione digitale non può sostituirli.`,
      );
  }
  const signalId =
    draft.binding.gpioSignals.find(
      (signal) => gpioSignalType(signal) === "digital_output",
    )?.id ??
    draft.binding.gpioSignals[0]?.id ??
    "";
  const readInto =
    draft.commands
      .find((command) => command.name === high || command.name === low)
      ?.steps.find(
        (step): step is Extract<DeviceRecipeOp, { type: "gpio_read" }> =>
          step.type === "gpio_read",
      )?.into ??
    draft.variables.find((variable) => variable.name !== op.into)?.name ??
    op.into;
  const published = (draft.flowInterfaces ?? []).find((item) => item.type === "emit");
  const write: DeviceRecipeOp =
    highLevel === lowLevel
      ? {
          id: `${op.id}-write`,
          type: "gpio_write",
          signalId,
          level: highLevel,
        }
      : {
          id: `${op.id}-write`,
          type: "gpio_write",
          signalId,
          level: highLevel,
          value: { kind: "variable", name: op.into },
          invert: highLevel === 0 && lowLevel === 1,
        };
  return [
    { ...op, inputMode: "data" },
    write,
    { id: `${op.id}-read`, type: "gpio_read", signalId, into: readInto },
    ...(published?.type === "emit" ? [{ ...published, from: readInto }] : []),
  ];
}
