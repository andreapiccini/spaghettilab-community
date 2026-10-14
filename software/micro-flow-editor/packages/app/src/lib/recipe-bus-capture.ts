import type { DeviceRecipeOp } from "./device-recipe-draft.js";

/** One bus byte block in a test capture (TX toward sensor or RX from sensor). */
export type RecipeBusBlock = {
  readonly opId: string;
  readonly direction: "tx" | "rx";
  readonly index: number;
  /** Hex label e.g. `0x3a`; `null` value → unknown / not returned on wire. */
  readonly value: number | null;
  readonly label: string;
};

export type RecipeBusCapture = {
  readonly blocks: readonly RecipeBusBlock[];
  /** opId → RX byte values (null = slot known, value unknown). */
  readonly rxByOpId: Readonly<Record<string, readonly (number | null)[]>>;
  readonly txByOpId: Readonly<Record<string, readonly number[]>>;
};

function parseHexByte(raw: string): number {
  const n = Number.parseInt(raw.trim().replace(/^0x/i, ""), 16);
  return Number.isFinite(n) ? n & 0xff : 0;
}

function hexByte(n: number): string {
  return `0x${(n & 0xff).toString(16).padStart(2, "0")}`;
}

/**
 * Build a bus capture from recipe ops: TX from write bytes, RX slots from read lengths.
 * Optional `measuredRx` overlays real values when the runtime returns them.
 */
export function buildRecipeBusCapture(
  ops: readonly DeviceRecipeOp[],
  measuredRx?: Readonly<Record<string, readonly number[]>>,
): RecipeBusCapture {
  const blocks: RecipeBusBlock[] = [];
  const rxByOpId: Record<string, (number | null)[]> = {};
  const txByOpId: Record<string, number[]> = {};

  for (const op of ops) {
    if (op.type === "i2c_write") {
      const tx: number[] = [];
      if (op.reg) {
        const r = parseHexByte(op.reg);
        tx.push(r);
        blocks.push({ opId: op.id, direction: "tx", index: tx.length - 1, value: r, label: hexByte(r) });
      }
      for (const b of op.bytes) {
        const v = parseHexByte(b);
        tx.push(v);
        blocks.push({ opId: op.id, direction: "tx", index: tx.length - 1, value: v, label: hexByte(v) });
      }
      txByOpId[op.id] = tx;
    } else if (op.type === "i2c_read") {
      const measured = measuredRx?.[op.id];
      const rx: (number | null)[] = [];
      for (let i = 0; i < op.len; i++) {
        const v = measured?.[i] ?? null;
        rx.push(v);
        blocks.push({
          opId: op.id,
          direction: "rx",
          index: i,
          value: v,
          label: v === null ? `RX${i}` : hexByte(v),
        });
      }
      rxByOpId[op.id] = rx;
    } else if (op.type === "i2c_write_read") {
      const tx: number[] = [];
      if (op.reg) {
        const r = parseHexByte(op.reg);
        tx.push(r);
        blocks.push({ opId: op.id, direction: "tx", index: tx.length - 1, value: r, label: hexByte(r) });
      }
      for (const b of op.writeBytes) {
        const v = parseHexByte(b);
        tx.push(v);
        blocks.push({ opId: op.id, direction: "tx", index: tx.length - 1, value: v, label: hexByte(v) });
      }
      txByOpId[op.id] = tx;
      const measured = measuredRx?.[op.id];
      const rx: (number | null)[] = [];
      for (let i = 0; i < op.readLen; i++) {
        const v = measured?.[i] ?? null;
        rx.push(v);
        blocks.push({
          opId: op.id,
          direction: "rx",
          index: i,
          value: v,
          label: v === null ? `RX${i}` : hexByte(v),
        });
      }
      rxByOpId[op.id] = rx;
    } else if (op.type === "spi_transfer") {
      const tx: number[] = [];
      for (let i = 0; i < op.txBytes.length; i++) {
        const v = parseHexByte(op.txBytes[i]!);
        tx.push(v);
        blocks.push({ opId: op.id, direction: "tx", index: i, value: v, label: hexByte(v) });
      }
      txByOpId[op.id] = tx;
      const measured = measuredRx?.[op.id];
      const rx: (number | null)[] = [];
      for (let i = 0; i < op.rxLen; i++) {
        const v = measured?.[i] ?? null;
        rx.push(v);
        blocks.push({
          opId: op.id,
          direction: "rx",
          index: i,
          value: v,
          label: v === null ? `RX${i}` : hexByte(v),
        });
      }
      if (rx.length) rxByOpId[op.id] = rx;
    } else if (op.type === "w1_read") {
      const measured = measuredRx?.[op.id];
      const rx: (number | null)[] = [];
      for (let i = 0; i < op.len; i++) {
        const v = measured?.[i] ?? null;
        rx.push(v);
        blocks.push({
          opId: op.id,
          direction: "rx",
          index: i,
          value: v,
          label: v === null ? `RX${i}` : hexByte(v),
        });
      }
      rxByOpId[op.id] = rx;
    }
  }

  return { blocks, rxByOpId, txByOpId };
}

export function rxBlocksOf(capture: RecipeBusCapture): readonly RecipeBusBlock[] {
  return capture.blocks.filter((b) => b.direction === "rx");
}
