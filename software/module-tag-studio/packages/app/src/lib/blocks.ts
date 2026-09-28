export type BlockCategory = "sys" | "ndef" | "factory" | "install" | "crc" | "reserve" | "danger";

export function categoryForPage(page: number): BlockCategory {
  if (page <= 1 || page === 45 || (page >= 49 && page <= 59)) return "sys";
  if (page === 2 || page === 44 || page === 46 || page === 47 || page === 48 || page >= 60) return "danger";
  if (page === 3) return "sys";
  if (page >= 4 && page <= 10) return "ndef";
  if (page >= 11 && page <= 32) return "factory";
  if (page === 33 || page === 42) return "crc";
  if (page >= 34 && page <= 40) return "install";
  if (page === 41) return "reserve";
  if (page === 43) return "ndef";
  return "sys";
}

export const CATEGORY_LABEL: Record<BlockCategory, string> = {
  sys: "System RO",
  ndef: "NDEF envelope",
  factory: "Factory identity",
  install: "Installation",
  crc: "CRC",
  reserve: "Reserved",
  danger: "Dangerous / special",
};

/** Short cell labels for the memory map grid. */
export const CATEGORY_SHORT: Record<BlockCategory, string> = {
  sys: "Sys",
  ndef: "NDEF",
  factory: "Fact",
  install: "Inst",
  crc: "CRC",
  reserve: "Res",
  danger: "Warn",
};

export function randomUuid(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
