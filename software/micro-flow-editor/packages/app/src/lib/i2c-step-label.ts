import {
  describeDeviceOp,
  resolveI2cOpAddress,
  type DeviceRecipeDraft,
  type DeviceRecipeOp,
} from "./device-recipe-draft.js";
export function readableI2cStep(
  draft: DeviceRecipeDraft,
  op: DeviceRecipeOp,
  rx?: readonly (number | null)[],
  it = true,
): string {
  const details = readableI2cStepDetails(draft, op, rx, it);
  return op.label?.trim() ? `${op.label.trim()} · ${details}` : details;
}
function readableI2cStepDetails(
  draft: DeviceRecipeDraft,
  op: DeviceRecipeOp,
  rx: readonly (number | null)[] | undefined,
  it: boolean,
): string {
  if (op.type === "i2c_write")
    return `${resolveI2cOpAddress(op, draft)} · write · ${op.bytes.length} ${it || op.bytes.length === 1 ? "byte" : "bytes"}`;
  if (op.type === "i2c_read" || op.type === "i2c_write_read") {
    const length = op.type === "i2c_read" ? op.len : op.readLen;
    const result =
      rx?.length && rx.every((byte) => byte !== null)
        ? rx
            .map((byte) => `0x${byte!.toString(16).padStart(2, "0").toUpperCase()}`)
            .join(" ")
        : it
          ? "da provare"
          : "not tested";
    return `${resolveI2cOpAddress(op, draft)} · read · ${length} ${it || length === 1 ? "byte" : "bytes"} · ${it ? "risposta" : "response"}: ${result}`;
  }
  return describeDeviceOp(op);
}
