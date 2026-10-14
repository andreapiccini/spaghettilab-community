/**
 * Shared I²C hex payload helpers — UI, timing chart, and Testa profile
 * must parse the same token rules (space-separated, optional 0x, 0–0xFF).
 */

export function formatHexByte(n: number): string {
  return `0x${(n & 0xff).toString(16).padStart(2, "0").toUpperCase()}`;
}

/** Parse one token (`00`, `0xAF`, `af`) → byte or null if invalid. */
export function parseHexByteToken(raw: string): number | null {
  const t = raw.trim().replace(/^0x/i, "");
  if (!t || !/^[0-9a-fA-F]{1,2}$/.test(t)) return null;
  const n = Number.parseInt(t, 16);
  if (!Number.isFinite(n) || n < 0 || n > 0xff) return null;
  return n & 0xff;
}

export type HexBytesParseResult = {
  /** Valid bytes in order (invalid tokens skipped from `bytes`, listed in `errors`). */
  readonly bytes: readonly number[];
  /** Normalized `0xXX` strings for every valid byte (draft storage). */
  readonly tokens: readonly string[];
  readonly errors: readonly string[];
};

/**
 * Split a free-form hex field (`00 AF A5` / `0x00 0xAF 0xA5`) into bytes.
 * Separators: whitespace, comma, semicolon.
 */
export function parseHexBytesInput(raw: string): HexBytesParseResult {
  const parts = raw
    .trim()
    .split(/[\s,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const bytes: number[] = [];
  const tokens: string[] = [];
  const errors: string[] = [];
  for (const part of parts) {
    const n = parseHexByteToken(part);
    if (n === null) {
      errors.push(`«${part}» non è un byte HEX valido (0x00–0xFF)`);
      continue;
    }
    bytes.push(n);
    tokens.push(formatHexByte(n));
  }
  return { bytes, tokens, errors };
}

/** Draft `bytes: string[]` → numeric payload (invalid entries become 0). */
export function hexStringsToBytes(raw: readonly string[]): readonly number[] {
  return raw.map((t) => parseHexByteToken(t) ?? 0);
}
