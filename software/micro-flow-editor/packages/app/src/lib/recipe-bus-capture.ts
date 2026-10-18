import type { DeviceRecipeOp } from "./device-recipe-draft.js";
import { formatHexByte, hexStringsToBytes } from "./i2c-hex.js";

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

function pushTx(
  blocks: RecipeBusBlock[],
  txByOpId: Record<string, number[]>,
  opId: string,
  bytes: readonly string[],
): void {
  const tx = txByOpId[opId] ?? [];
  for (const v of hexStringsToBytes(bytes)) {
    tx.push(v);
    blocks.push({
      opId,
      direction: "tx",
      index: tx.length - 1,
      value: v,
      label: formatHexByte(v),
    });
  }
  txByOpId[opId] = tx;
}

function pushRxSlots(
  blocks: RecipeBusBlock[],
  rxByOpId: Record<string, (number | null)[]>,
  opId: string,
  len: number,
  measured?: readonly number[],
): void {
  const rx = rxByOpId[opId] ?? [];
  for (let i = 0; i < len; i++) {
    const v = measured?.[rx.length] ?? null;
    rx.push(v);
    blocks.push({
      opId,
      direction: "rx",
      index: rx.length - 1,
      value: v,
      label: v === null ? `RX${rx.length - 1}` : formatHexByte(v),
    });
  }
  rxByOpId[opId] = rx;
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
      pushTx(blocks, txByOpId, op.id, op.bytes);
    } else if (op.type === "gpio_read") {
      pushRxSlots(blocks, rxByOpId, op.id, 1, measuredRx?.[op.id]);
    } else if (op.type === "i2c_read") {
      pushRxSlots(blocks, rxByOpId, op.id, Math.max(1, op.len), measuredRx?.[op.id]);
    } else if (op.type === "i2c_write_read") {
      pushTx(blocks, txByOpId, op.id, op.writeBytes);
      pushRxSlots(
        blocks,
        rxByOpId,
        op.id,
        Math.max(1, op.readLen),
        measuredRx?.[op.id],
      );
    } else if (op.type === "i2c_transaction") {
      for (const phase of op.phases) {
        if (phase.kind === "write") pushTx(blocks, txByOpId, op.id, phase.bytes);
        if (phase.kind === "read")
          pushRxSlots(
            blocks,
            rxByOpId,
            op.id,
            Math.max(1, phase.len),
            measuredRx?.[op.id],
          );
      }
    } else if (op.type === "spi_transfer") {
      const tx: number[] = [];
      const txBytes = hexStringsToBytes(op.txBytes);
      for (let i = 0; i < txBytes.length; i++) {
        const v = txBytes[i]!;
        tx.push(v);
        blocks.push({
          opId: op.id,
          direction: "tx",
          index: i,
          value: v,
          label: formatHexByte(v),
        });
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
          label: v === null ? `RX${i}` : formatHexByte(v),
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
