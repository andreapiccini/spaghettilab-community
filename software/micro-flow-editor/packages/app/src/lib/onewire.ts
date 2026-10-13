/**
 * 1-Wire helpers (Dallas/Maxim CRC-8, ROM format).
 * Protocol bit timing belongs in firmware — not in the browser.
 */

/** CRC-8 (polynomial 0x31, reflected) used by 1-Wire ROM and scratchpad. */
export function onewireCrc8(bytes: readonly number[]): number {
  let crc = 0;
  for (const byte of bytes) {
    let cur = byte & 0xff;
    for (let i = 0; i < 8; i++) {
      const mix = (crc ^ cur) & 0x01;
      crc >>= 1;
      if (mix) crc ^= 0x8c;
      cur >>= 1;
    }
  }
  return crc & 0xff;
}

/** Normalize ROM string to 8 uppercase hex bytes separated by spaces, or null if invalid. */
export function parseOneWireRom(raw: string): readonly number[] | null {
  const hex = raw.replace(/[^0-9a-fA-F]/g, "");
  if (hex.length !== 16) return null;
  const bytes: number[] = [];
  for (let i = 0; i < 16; i += 2) {
    bytes.push(Number.parseInt(hex.slice(i, i + 2), 16));
  }
  return bytes;
}

export function formatOneWireRom(bytes: readonly number[]): string {
  return bytes.map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

/** Family code is byte 0; CRC is byte 7 over bytes 0–6. */
export function validateOneWireRom(raw: string): { readonly ok: true; readonly rom: string; readonly family: number } | { readonly ok: false; readonly message: string } {
  const bytes = parseOneWireRom(raw);
  if (!bytes) {
    return { ok: false, message: "ROM 1-Wire: servono 8 byte (16 cifre esadecimali)" };
  }
  const crc = onewireCrc8(bytes.slice(0, 7));
  if (crc !== bytes[7]) {
    return {
      ok: false,
      message: `CRC ROM non valido (atteso 0x${crc.toString(16).padStart(2, "0")}, trovato 0x${bytes[7]!.toString(16).padStart(2, "0")})`,
    };
  }
  return { ok: true, rom: formatOneWireRom(bytes), family: bytes[0]! };
}

/** DS18B20 family code. */
export const DS18B20_FAMILY = 0x28;

/** Convert T command / Read Scratchpad — DS18B20 datasheet. */
export const DS18B20_CMD = {
  convertT: "0x44",
  readScratchpad: "0xBE",
  matchRom: "0x55",
  skipRom: "0xCC",
  /** Max conversion time at 12-bit resolution (datasheet Table 2). */
  convertMaxMs12bit: 750,
} as const;

/** Decode DS18B20 temperature from scratchpad bytes 0–1 (°C). */
export function decodeDs18b20TempC(lsb: number, msb: number): number {
  let raw = ((msb & 0xff) << 8) | (lsb & 0xff);
  if (raw & 0x8000) raw = raw - 0x10000;
  return raw * 0.0625;
}
