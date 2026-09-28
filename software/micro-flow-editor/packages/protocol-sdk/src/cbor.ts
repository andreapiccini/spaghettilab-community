/**
 * Minimal canonical CBOR primitives — encode/decode only the subset the
 * firmware's zcbor-based Protocol V1 actually uses: unsigned/negative
 * integers (major type 0/1, up to 64 bits), byte strings, UTF-8 text
 * strings, definite-length arrays/maps, and the two boolean simple values.
 * No floats, no tags, no indefinite-length items, no bignums — the firmware
 * never emits them (see software/reference or the S021 implementation note
 * for the research this is based on), so a general-purpose CBOR library
 * would accept/produce a strictly larger surface than this protocol allows.
 * Encoding is always canonical (RFC 8949 §4.2.1: shortest-possible integer
 * head, definite lengths, ascending small-integer map keys) to match
 * zcbor's canonical output byte-for-byte.
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

/** Canonical minimal-length head (major type + argument) per RFC 8949 §3.1/§4.2.1. */
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
  throw new ProtocolCodecError("CBOR argument exceeds the 64-bit range this protocol supports");
}

export function encodeUint(value: bigint): Uint8Array {
  return encodeHead(MAJOR_UINT, value);
}

/** Encodes a signed integer of either sign as canonical CBOR major type 0/1. */
export function encodeInt(value: bigint): Uint8Array {
  return value >= 0n ? encodeHead(MAJOR_UINT, value) : encodeHead(MAJOR_NEGINT, -1n - value);
}

export function encodeBytes(value: Uint8Array): Uint8Array {
  return concatBytes([encodeHead(MAJOR_BYTES, BigInt(value.length)), value]);
}

export function encodeText(value: string): Uint8Array {
  const utf8 = new TextEncoder().encode(value);
  return concatBytes([encodeHead(MAJOR_TEXT, BigInt(utf8.length)), utf8]);
}

/**
 * Indefinite-length array start (major type 4, additional info 31) —
 * verified against the actual firmware build (not just its source): zcbor
 * in this build does **not** use canonical definite-length collections, it
 * emits `0x9F <items...> 0xFF` for arrays and `0xBF <pairs...> 0xFF` for
 * maps. This was confirmed by building and running
 * `firmware/backbone/tests/protocol` in `native_sim` and inspecting the actual
 * encoded bytes — the initial source-reading-only research had assumed
 * canonical/definite-length, which turned out to be wrong.
 */
export function encodeArrayHeader(): Uint8Array {
  return Uint8Array.of((MAJOR_ARRAY << 5) | 31);
}

export function encodeMapHeader(): Uint8Array {
  return Uint8Array.of((MAJOR_MAP << 5) | 31);
}

export function encodeBreak(): Uint8Array {
  return Uint8Array.of((MAJOR_SIMPLE << 5) | 31);
}

export function encodeBool(value: boolean): Uint8Array {
  return Uint8Array.of(value ? 0xf5 : 0xf4);
}

/** CBOR simple value 22 (`0xF6`) — the wire `null`. Used by `config_cbor.c`'s `encode_optional_u8` for an unspecified `bay_id`/`power_rail_id`. */
export function encodeNull(): Uint8Array {
  return Uint8Array.of(0xf6);
}

/** Concatenates an ordered sequence of already-encoded CBOR items into one buffer. */
export function encodeSequence(...items: readonly Uint8Array[]): Uint8Array {
  return concatBytes(items);
}

/**
 * Builds an indefinite-length map from `[key, valueBytes]` pairs, in the
 * order given (ascending field ID, matching the firmware's own field
 * ordering) — see `encodeMapHeader`'s doc comment for why this is
 * indefinite-length rather than canonical.
 */
export function encodeMap(pairs: ReadonlyArray<readonly [number, Uint8Array]>): Uint8Array {
  const parts: Uint8Array[] = [encodeMapHeader()];
  for (const [key, value] of pairs) {
    parts.push(encodeUint(BigInt(key)), value);
  }
  parts.push(encodeBreak());
  return concatBytes(parts);
}

export function encodeArray(items: readonly Uint8Array[]): Uint8Array {
  return concatBytes([encodeArrayHeader(), ...items, encodeBreak()]);
}

export type CborValue =
  | { readonly kind: "uint"; readonly value: bigint }
  | { readonly kind: "int"; readonly value: bigint }
  | { readonly kind: "bytes"; readonly value: Uint8Array }
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "array"; readonly value: readonly CborValue[] }
  | { readonly kind: "map"; readonly value: ReadonlyMap<number, CborValue> }
  | { readonly kind: "bool"; readonly value: boolean }
  | { readonly kind: "null" };

/** Cursor-based decoder for one CBOR value at a time, tracking consumed bytes. */
export class CborReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  private readByte(): number {
    if (this.offset >= this.bytes.length) {
      throw new ProtocolCodecError("unexpected end of CBOR input");
    }
    return this.bytes[this.offset++]!;
  }

  private readBytes(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) {
      throw new ProtocolCodecError("unexpected end of CBOR input");
    }
    const out = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return out;
  }

  private readArgument(additionalInfo: number): bigint {
    if (additionalInfo < 24) return BigInt(additionalInfo);
    if (additionalInfo === 24) return BigInt(this.readByte());
    if (additionalInfo === 25) {
      const b = this.readBytes(2);
      return BigInt(new DataView(b.buffer, b.byteOffset, 2).getUint16(0, false));
    }
    if (additionalInfo === 26) {
      const b = this.readBytes(4);
      return BigInt(new DataView(b.buffer, b.byteOffset, 4).getUint32(0, false));
    }
    if (additionalInfo === 27) {
      const b = this.readBytes(8);
      return new DataView(b.buffer, b.byteOffset, 8).getBigUint64(0, false);
    }
    throw new ProtocolCodecError(`unsupported CBOR additional info ${additionalInfo}`);
  }

  /** True if the next byte is the indefinite-length "break" marker (0xFF) — does not consume it. */
  private atBreak(): boolean {
    return this.remaining > 0 && this.bytes[this.offset] === 0xff;
  }

  readValue(): CborValue {
    const head = this.readByte();
    const majorType = head >> 5;
    const additionalInfo = head & 0x1f;
    switch (majorType) {
      case MAJOR_UINT:
        return { kind: "uint", value: this.readArgument(additionalInfo) };
      case MAJOR_NEGINT:
        return { kind: "int", value: -1n - this.readArgument(additionalInfo) };
      case MAJOR_BYTES:
        return { kind: "bytes", value: this.readBytes(Number(this.readArgument(additionalInfo))) };
      case MAJOR_TEXT: {
        const raw = this.readBytes(Number(this.readArgument(additionalInfo)));
        return { kind: "text", value: new TextDecoder("utf-8", { fatal: true }).decode(raw) };
      }
      case MAJOR_ARRAY: {
        const items: CborValue[] = [];
        if (additionalInfo === 31) {
          // Indefinite-length — the shape the actual firmware build emits
          // (see `encodeArrayHeader`'s doc comment); read until the break.
          while (!this.atBreak()) items.push(this.readValue());
          this.readByte(); // consume 0xFF
        } else {
          const length = Number(this.readArgument(additionalInfo));
          for (let i = 0; i < length; i++) items.push(this.readValue());
        }
        return { kind: "array", value: items };
      }
      case MAJOR_MAP: {
        const map = new Map<number, CborValue>();
        const readPair = () => {
          const key = this.readValue();
          if (key.kind !== "uint") {
            throw new ProtocolCodecError("CBOR map key must be a non-negative integer");
          }
          const numericKey = Number(key.value);
          if (map.has(numericKey)) {
            throw new ProtocolCodecError(`duplicate CBOR map key ${numericKey}`);
          }
          map.set(numericKey, this.readValue());
        };
        if (additionalInfo === 31) {
          while (!this.atBreak()) readPair();
          this.readByte(); // consume 0xFF
        } else {
          const length = Number(this.readArgument(additionalInfo));
          for (let i = 0; i < length; i++) readPair();
        }
        return { kind: "map", value: map };
      }
      case MAJOR_SIMPLE:
        if (additionalInfo === 20) return { kind: "bool", value: false };
        if (additionalInfo === 21) return { kind: "bool", value: true };
        if (additionalInfo === 22) return { kind: "null" };
        throw new ProtocolCodecError(`unsupported CBOR simple value ${additionalInfo}`);
      default:
        throw new ProtocolCodecError(`unsupported CBOR major type ${majorType}`);
    }
  }
}

export function decodeOne(bytes: Uint8Array): CborValue {
  return new CborReader(bytes).readValue();
}
