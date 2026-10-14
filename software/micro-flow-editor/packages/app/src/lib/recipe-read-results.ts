import type { DeviceRecipeDraft, DeviceRecipeOp } from "./device-recipe-draft.js";
export type RecipeReadResult = {
  readonly id: string;
  readonly label: string;
  readonly unit: string;
  readonly value: number | null;
};

/** Evaluate post-read values exclusively from real captured bytes. Missing bytes stay unknown. */
export function evaluateRecipeReadResults(
  draft: DeviceRecipeDraft,
  ops: readonly DeviceRecipeOp[],
  rx: Readonly<Record<string, readonly (number | null)[]>>,
): RecipeReadResult[] {
  const buffers = new Map<string, readonly (number | null)[]>();
  const values = new Map<string, number>();
  const results: RecipeReadResult[] = [];
  for (const op of ops) {
    if (
      op.type === "i2c_read" ||
      op.type === "i2c_write_read" ||
      op.type === "i2c_transaction"
    ) {
      if (op.into) {
        buffers.set(op.into, rx[op.id] ?? []);
        values.delete(op.into);
      }
    } else if (op.type === "decode") {
      values.delete(op.into);
      const input = buffers.get(op.input)?.slice(op.startByte, op.endByte + 1);
      if (
        !input ||
        input.length !== op.endByte - op.startByte + 1 ||
        !input.length ||
        input.length > 8 ||
        input.some((b) => b === null)
      )
        continue;
      const bytes = op.byteOrder === "le" ? [...input].reverse() : input;
      let integer = 0n;
      for (const b of bytes) integer = (integer << 8n) | BigInt(b!);
      if (op.signed && bytes[0]! & 0x80) integer -= 1n << BigInt(bytes.length * 8);
      const raw = Number(integer);
      if (!Number.isSafeInteger(raw)) continue;
      const value = (raw * (op.multiply ?? 1)) / (op.divide ?? 1) + (op.offset ?? 0);
      if (Number.isFinite(value)) values.set(op.into, value);
    } else if (op.type === "emit") {
      const channel = draft.channels.find((c) => c.id === op.channelId);
      results.push({
        id: op.channelId,
        label: channel?.label ?? op.channelId,
        unit: channel?.unit ?? "",
        value: values.get(op.from) ?? null,
      });
    }
  }
  return results;
}
