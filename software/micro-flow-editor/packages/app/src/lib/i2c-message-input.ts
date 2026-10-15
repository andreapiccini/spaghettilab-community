import { parseHexByteToken, formatHexByte } from "./i2c-hex.js";
export function parseI2cMessage(text: string): { tokens: string[]; error?: string } {
  const tokens: string[] = [];
  for (const part of text
    .trim()
    .split(/[\s,;]+/)
    .filter(Boolean)) {
    if (/^\$[a-zA-Z_][a-zA-Z0-9_]*$/.test(part)) {
      tokens.push(part);
      continue;
    }
    const hex = part.replace(/^0x/i, "");
    if (!/^[0-9a-f]+$/i.test(hex) || (hex.length > 2 && hex.length % 2 !== 0))
      return {
        tokens: [],
        error: `«${part}» non è un byte HEX o una variabile $nome.`,
      };
    for (let i = 0; i < hex.length; i += 2) {
      const value = parseHexByteToken(hex.slice(i, i + 2));
      if (value === null) return { tokens: [], error: `Byte HEX non valido: ${part}` };
      tokens.push(formatHexByte(value));
    }
  }
  return tokens.length
    ? { tokens }
    : { tokens: [], error: "Inserisci almeno un byte o una variabile." };
}
