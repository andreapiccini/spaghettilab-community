export function assertLen(data: Uint8Array, len: number, label: string): void {
  if (data.length !== len) throw new Error(`${label} must be ${len} bytes, got ${data.length}`);
}

export function zeros(n: number): Uint8Array {
  return new Uint8Array(n);
}

export function isAllZero(data: Uint8Array): boolean {
  return data.every((b) => b === 0);
}

export function writeU16Be(view: DataView, offset: number, value: number): void {
  if (value < 0 || value > 0xffff || !Number.isInteger(value)) {
    throw new Error(`u16 out of range: ${value}`);
  }
  view.setUint16(offset, value, false);
}

export function writeU32Be(view: DataView, offset: number, value: number): void {
  if (value < 0 || value > 0xffffffff || !Number.isInteger(value)) {
    throw new Error(`u32 out of range: ${value}`);
  }
  view.setUint32(offset, value, false);
}

export function writeU64Be(view: DataView, offset: number, value: bigint): void {
  if (value < 0n || value > 0xffffffffffffffffn) {
    throw new Error(`u64 out of range: ${value}`);
  }
  view.setBigUint64(offset, value, false);
}

export function readU16Be(view: DataView, offset: number): number {
  return view.getUint16(offset, false);
}

export function readU32Be(view: DataView, offset: number): number {
  return view.getUint32(offset, false);
}

export function readU64Be(view: DataView, offset: number): bigint {
  return view.getBigUint64(offset, false);
}

export function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function hex(data: Uint8Array): string {
  return Array.from(data, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(text: string): Uint8Array {
  const compact = text.replace(/[^0-9a-fA-F]/g, "");
  if (compact.length % 2 !== 0) throw new Error("odd hex length");
  const out = new Uint8Array(compact.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(compact.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function uuidToBytes(uuid: string): Uint8Array {
  const compact = uuid.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(compact)) throw new Error(`invalid UUID: ${uuid}`);
  return fromHex(compact);
}

export function bytesToUuid(data: Uint8Array): string {
  assertLen(data, 16, "uuid");
  const h = hex(data);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function pageOfUserOffset(userOffset: number): number {
  return 4 + Math.floor(userOffset / 4);
}

export function splitPages(startPage: number, data: Uint8Array): Map<number, Uint8Array> {
  if (data.length % 4 !== 0) throw new Error("data length must be multiple of 4");
  const map = new Map<number, Uint8Array>();
  for (let i = 0; i < data.length; i += 4) {
    map.set(startPage + i / 4, data.slice(i, i + 4));
  }
  return map;
}

export function concatPages(pages: Map<number, Uint8Array>, from: number, toInclusive: number): Uint8Array {
  const out = new Uint8Array((toInclusive - from + 1) * 4);
  for (let page = from; page <= toInclusive; page++) {
    const block = pages.get(page);
    if (!block || block.length !== 4) throw new Error(`missing page ${page}`);
    out.set(block, (page - from) * 4);
  }
  return out;
}

export function manufacturingDateFromIso(isoDate: string): number {
  const epoch = Date.UTC(2020, 0, 1);
  const t = Date.parse(isoDate);
  if (Number.isNaN(t)) throw new Error(`invalid date: ${isoDate}`);
  const days = Math.floor((t - epoch) / 86_400_000);
  if (days < 0 || days > 0xffff) throw new Error(`date out of range: ${isoDate}`);
  return days;
}

export function manufacturingDateToIso(days: number): string | null {
  if (days === 0) return null;
  const epoch = Date.UTC(2020, 0, 1);
  return new Date(epoch + days * 86_400_000).toISOString().slice(0, 10);
}
