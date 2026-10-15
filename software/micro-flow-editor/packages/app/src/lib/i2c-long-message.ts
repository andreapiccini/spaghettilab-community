import type { Instruction } from "@spaghettilab/device-profile-authoring-model";
import { parseHexByteToken } from "./i2c-hex.js";
import { parseVarRef } from "./device-recipe-draft.js";

export const I2C_MESSAGE_MAX = 2048;
export const I2C_PROFILE_DATA_MAX = 3072;
/** Conservative allowance at the slowest supported bus (100 kHz), including margin. */
export const messageTimeoutMs = (length: number) =>
  Math.max(20, Math.ceil(((length + 1) * 9) / 100) * 4 + 50);

export function appendLongI2cMessage(
  tokens: readonly string[],
  data: number[],
  target: Instruction[],
  variable: (name: string) => { width: number; materialize: () => number },
  timeoutMs?: number,
): boolean {
  const parts = tokens.map((token) => {
    const ref = parseVarRef(token);
    if (ref) return { variable: variable(ref) };
    const byte = parseHexByteToken(token);
    if (byte === null) throw new Error(`Byte HEX non valido: ${token}`);
    return { byte };
  });
  const length = parts.reduce((sum, part) => sum + (part.variable?.width ?? 1), 0);
  if (length <= 32) return false;
  if (length > I2C_MESSAGE_MAX)
    throw new Error(`Il messaggio supera ${I2C_MESSAGE_MAX} byte.`);
  const template: number[] = [];
  const patches: {
    offset: number;
    value: { width: number; materialize: () => number };
  }[] = [];
  for (const part of parts) {
    if (part.variable) {
      patches.push({ offset: template.length, value: part.variable });
      template.push(...Array<number>(part.variable.width).fill(0));
    } else template.push(part.byte!);
  }
  let offset = -1;
  outer: for (let start = 0; start + template.length <= data.length; start++) {
    for (let i = 0; i < template.length; i++)
      if (data[start + i] !== template[i]) continue outer;
    offset = start;
    break;
  }
  if (offset < 0) {
    offset = data.length;
    if (offset + length > I2C_PROFILE_DATA_MAX)
      throw new Error(
        "Memoria dei messaggi del driver esaurita (3072 byte di dati distinti). Dividi il driver o riutilizza i messaggi.",
      );
    data.push(...template);
  }
  target.push({ op: "MESSAGE_LOAD", offset, length });
  for (const patch of patches)
    target.push({
      op: "MESSAGE_PATCH",
      src: patch.value.materialize(),
      offset: patch.offset,
      length: patch.value.width,
    });
  target.push({
    op: "I2C_MESSAGE_WRITE",
    length,
    timeoutMs: Math.max(timeoutMs ?? 0, messageTimeoutMs(length)),
  });
  return true;
}
