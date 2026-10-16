import {
  describeDeviceOp,
  type DeviceRecipeOp,
} from "../../lib/device-recipe-draft.js";
export function workbenchStepLabel(op: DeviceRecipeOp, it: boolean) {
  return op.type === "i2c_write"
    ? it
      ? "Scrivi messaggio"
      : "Write message"
    : op.type === "i2c_read" || op.type === "i2c_write_read"
      ? it
        ? "Leggi risposta"
        : "Read response"
      : describeDeviceOp(op);
}
export function workbenchStepDetail(op: DeviceRecipeOp, it: boolean) {
  return op.type === "i2c_write"
    ? `${op.bytes.length} byte`
    : op.type === "i2c_read" || op.type === "i2c_write_read"
      ? `${op.type === "i2c_read" ? op.len : op.readLen} byte · $${op.into}`
      : it
        ? "Avanzato"
        : "Advanced";
}
