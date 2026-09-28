/**
 * Minimal CBOR codec matching firmware zcbor Protocol V1 output:
 * indefinite-length maps (`0xBF … 0xFF`) and arrays (`0x9F … 0xFF`),
 * shortest integer heads, no floats/tags/indefinite strings.
 */

export class ProtocolCodecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProtocolCodecError";
  }
}

const MAJOR_UINT = 0;
const MAJOR_NEGINT = 1;
const MAJOR_BYTES = 2;
const MAJOR_TEXT = 3;
const MAJOR_ARRAY = 4;
const MAJOR_MAP = 5;
const MAJOR_SIMPLE = 7;

export const PAYLOAD_ABSOLUTE_MAX = 2048;
export const PROTOCOL_VERSION = 1;

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function encodeHead(majorType: number, argument: bigint): Uint8Array {
  if (argument < 0n) {
    throw new ProtocolCodecError("CBOR head argument must be non-negative");
  }
  const mt = majorType << 5;
  if (argument < 24n) {
    return Uint8Array.of(mt | Number(argument));
  }
  if (argument <= 0xffn) {
    return Uint8Array.of(mt | 24, Number(argument));
  }
  if (argument <= 0xffffn) {
    const bytes = new Uint8Array(3);
    bytes[0] = mt | 25;
    new DataView(bytes.buffer).setUint16(1, Number(argument), false);
    return bytes;
  }
  if (argument <= 0xffffffffn) {
    const bytes = new Uint8Array(5);
    bytes[0] = mt | 26;
    new DataView(bytes.buffer).setUint32(1, Number(argument), false);
    return bytes;
  }
  if (argument <= 0xffffffffffffffffn) {
    const bytes = new Uint8Array(9);
    bytes[0] = mt | 27;
    new DataView(bytes.buffer).setBigUint64(1, argument, false);
    return bytes;
  }
  throw new ProtocolCodecError("CBOR argument exceeds 64-bit range");
}

export function encodeUint(value: bigint): Uint8Array {
  return encodeHead(MAJOR_UINT, value);
}

export function encodeInt(value: bigint): Uint8Array {
  return value >= 0n
    ? encodeHead(MAJOR_UINT, value)
    : encodeHead(MAJOR_NEGINT, -1n - value);
}

export function encodeBytes(value: Uint8Array): Uint8Array {
  return concatBytes([encodeHead(MAJOR_BYTES, BigInt(value.length)), value]);
}

export function encodeText(value: string): Uint8Array {
  const utf8 = new TextEncoder().encode(value);
  return concatBytes([encodeHead(MAJOR_TEXT, BigInt(utf8.length)), utf8]);
}

export function encodeBool(value: boolean): Uint8Array {
  return Uint8Array.of(value ? 0xf5 : 0xf4);
}

export function encodeMap(
  pairs: ReadonlyArray<readonly [number, Uint8Array]>,
): Uint8Array {
  const parts: Uint8Array[] = [Uint8Array.of((MAJOR_MAP << 5) | 31)];
  for (const [key, value] of pairs) {
    if (!Number.isInteger(key) || key < 0) {
      throw new ProtocolCodecError(`invalid map key ${key}`);
    }
    parts.push(encodeUint(BigInt(key)), value);
  }
  parts.push(Uint8Array.of((MAJOR_SIMPLE << 5) | 31));
  return concatBytes(parts);
}

export function encodeArray(items: readonly Uint8Array[]): Uint8Array {
  return concatBytes([
    Uint8Array.of((MAJOR_ARRAY << 5) | 31),
    ...items,
    Uint8Array.of((MAJOR_SIMPLE << 5) | 31),
  ]);
}

export function encodeEmptyMap(): Uint8Array {
  return encodeMap([]);
}

export type CborValue =
  | { readonly kind: "uint"; readonly value: bigint }
  | { readonly kind: "int"; readonly value: bigint }
  | { readonly kind: "bytes"; readonly value: Uint8Array }
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "array"; readonly value: readonly CborValue[] }
  | { readonly kind: "map"; readonly value: ReadonlyMap<number, CborValue> }
  | { readonly kind: "bool"; readonly value: boolean };

export class CborReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  private take(n: number): Uint8Array {
    if (this.offset + n > this.bytes.length) {
      throw new ProtocolCodecError("unexpected end of CBOR input");
    }
    const slice = this.bytes.subarray(this.offset, this.offset + n);
    this.offset += n;
    return slice;
  }

  readValue(): CborValue {
    const { major, argument, indefinite } = this.readHeadFixed();
    switch (major) {
      case MAJOR_UINT:
        return { kind: "uint", value: argument };
      case MAJOR_NEGINT:
        return { kind: "int", value: -1n - argument };
      case MAJOR_BYTES: {
        if (indefinite) {
          throw new ProtocolCodecError("indefinite byte strings are not used by Protocol V1");
        }
        return { kind: "bytes", value: this.take(Number(argument)) };
      }
      case MAJOR_TEXT: {
        if (indefinite) {
          throw new ProtocolCodecError("indefinite text strings are not used by Protocol V1");
        }
        return { kind: "text", value: new TextDecoder().decode(this.take(Number(argument))) };
      }
      case MAJOR_ARRAY: {
        const items: CborValue[] = [];
        if (indefinite) {
          while (!this.atBreak()) {
            items.push(this.readValue());
          }
          this.take(1); // break
        } else {
          for (let i = 0; i < Number(argument); i++) {
            items.push(this.readValue());
          }
        }
        return { kind: "array", value: items };
      }
      case MAJOR_MAP: {
        const map = new Map<number, CborValue>();
        const readPair = (): void => {
          const key = this.readValue();
          if (key.kind !== "uint" || key.value > BigInt(Number.MAX_SAFE_INTEGER)) {
            throw new ProtocolCodecError("map keys must be small unsigned integers");
          }
          const keyNum = Number(key.value);
          if (map.has(keyNum)) {
            throw new ProtocolCodecError(`duplicate map key ${keyNum}`);
          }
          map.set(keyNum, this.readValue());
        };
        if (indefinite) {
          while (!this.atBreak()) {
            readPair();
          }
          this.take(1);
        } else {
          for (let i = 0; i < Number(argument); i++) {
            readPair();
          }
        }
        return { kind: "map", value: map };
      }
      case MAJOR_SIMPLE: {
        if (argument === 20n) return { kind: "bool", value: false };
        if (argument === 21n) return { kind: "bool", value: true };
        throw new ProtocolCodecError(`unsupported simple value ${argument}`);
      }
      default:
        throw new ProtocolCodecError(`unsupported CBOR major type ${major}`);
    }
  }

  private atBreak(): boolean {
    return this.bytes[this.offset] === 0xff;
  }

  private readHeadFixed(): { major: number; argument: bigint; indefinite: boolean } {
    const first = this.take(1)[0]!;
    const major = first >> 5;
    const additional = first & 0x1f;
    if (additional < 24) {
      return { major, argument: BigInt(additional), indefinite: false };
    }
    if (additional === 24) {
      return { major, argument: BigInt(this.take(1)[0]!), indefinite: false };
    }
    if (additional === 25) {
      const bytes = this.take(2);
      return {
        major,
        argument: BigInt(new DataView(bytes.buffer, bytes.byteOffset, 2).getUint16(0, false)),
        indefinite: false,
      };
    }
    if (additional === 26) {
      const bytes = this.take(4);
      return {
        major,
        argument: BigInt(new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, false)),
        indefinite: false,
      };
    }
    if (additional === 27) {
      const bytes = this.take(8);
      return {
        major,
        argument: new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, false),
        indefinite: false,
      };
    }
    if (additional === 31) {
      return { major, argument: 0n, indefinite: true };
    }
    throw new ProtocolCodecError(`unsupported CBOR additional info ${additional}`);
  }
}

export function decodeOne(bytes: Uint8Array): CborValue {
  const reader = new CborReader(bytes);
  const value = reader.readValue();
  if (reader.remaining !== 0) {
    throw new ProtocolCodecError("trailing bytes after CBOR value");
  }
  return value;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase().replace(/^0x/, "");
  if (clean.length % 2 !== 0 || !/^[0-9a-f]*$/.test(clean)) {
    throw new ProtocolCodecError("invalid hex string");
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function u32Field(key: number, value: number): readonly [number, Uint8Array] {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new ProtocolCodecError(`u32 out of range: ${value}`);
  }
  return [key, encodeUint(BigInt(value))];
}

export function boolField(key: number, value: boolean): readonly [number, Uint8Array] {
  return [key, encodeBool(value)];
}

export function textField(key: number, value: string): readonly [number, Uint8Array] {
  return [key, encodeText(value)];
}

export function bytesField(key: number, value: Uint8Array): readonly [number, Uint8Array] {
  return [key, encodeBytes(value)];
}

export function int64Field(key: number, value: bigint): readonly [number, Uint8Array] {
  return [key, encodeInt(value)];
}

export function requireMap(value: CborValue, label: string): ReadonlyMap<number, CborValue> {
  if (value.kind !== "map") {
    throw new ProtocolCodecError(`${label} must be a map`);
  }
  return value.value;
}

export function requireArray(map: ReadonlyMap<number, CborValue>, key: number, label: string): readonly CborValue[] {
  const value = map.get(key);
  if (!value || value.kind !== "array") {
    throw new ProtocolCodecError(`${label} missing array key ${key}`);
  }
  return value.value;
}

export function requireU32(map: ReadonlyMap<number, CborValue>, key: number, label: string): number {
  const value = map.get(key);
  if (!value || value.kind !== "uint" || value.value > 0xffffffffn) {
    throw new ProtocolCodecError(`${label} missing u32 key ${key}`);
  }
  return Number(value.value);
}

export function optionalU32(
  map: ReadonlyMap<number, CborValue>,
  key: number,
  fallback: number,
  label: string,
): number {
  if (!map.has(key)) return fallback;
  return requireU32(map, key, label);
}

export function requireBool(map: ReadonlyMap<number, CborValue>, key: number, label: string): boolean {
  const value = map.get(key);
  if (!value || value.kind !== "bool") {
    throw new ProtocolCodecError(`${label} missing bool key ${key}`);
  }
  return value.value;
}

export function requireText(map: ReadonlyMap<number, CborValue>, key: number, label: string): string {
  const value = map.get(key);
  if (!value || value.kind !== "text") {
    throw new ProtocolCodecError(`${label} missing text key ${key}`);
  }
  return value.value;
}

export function requireBytes(map: ReadonlyMap<number, CborValue>, key: number, label: string): Uint8Array {
  const value = map.get(key);
  if (!value || value.kind !== "bytes") {
    throw new ProtocolCodecError(`${label} missing bytes key ${key}`);
  }
  return value.value;
}

export function requireUint64(map: ReadonlyMap<number, CborValue>, key: number, label: string): bigint {
  const value = map.get(key);
  if (!value || value.kind !== "uint") {
    throw new ProtocolCodecError(`${label} missing uint64 key ${key}`);
  }
  return value.value;
}

export function requireInt64(map: ReadonlyMap<number, CborValue>, key: number, label: string): bigint {
  const value = map.get(key);
  if (!value) {
    throw new ProtocolCodecError(`${label} missing int64 key ${key}`);
  }
  if (value.kind === "uint") return value.value;
  if (value.kind === "int") return value.value;
  throw new ProtocolCodecError(`${label} key ${key} is not an integer`);
}

/** Reject maps with unexpected keys beyond the declared set. */
export function assertOnlyKeys(
  map: ReadonlyMap<number, CborValue>,
  allowed: readonly number[],
  label: string,
): void {
  const allowedSet = new Set(allowed);
  for (const key of map.keys()) {
    if (!allowedSet.has(key)) {
      throw new ProtocolCodecError(`${label} has unexpected key ${key}`);
    }
  }
}
