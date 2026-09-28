import { describe, expect, it } from "vitest";
import {
  decodeOne,
  encodeArray,
  encodeBool,
  encodeBytes,
  encodeInt,
  encodeMap,
  encodeText,
  encodeUint,
  CborReader,
  ProtocolCodecError,
} from "../cbor.js";

function hex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}

describe("canonical uint encoding — minimal length per RFC 8949 §4.2.1", () => {
  it.each([
    [0n, "00"],
    [23n, "17"],
    [24n, "18 18"],
    [255n, "18 ff"],
    [256n, "19 01 00"],
    [65535n, "19 ff ff"],
    [65536n, "1a 00 01 00 00"],
    [4294967295n, "1a ff ff ff ff"],
    [4294967296n, "1b 00 00 00 01 00 00 00 00"],
    [18446744073709551615n, "1b ff ff ff ff ff ff ff ff"],
  ])("encodes %s as %s", (value, expected) => {
    expect(hex(encodeUint(value))).toBe(expected);
  });

  it("round-trips every boundary value", () => {
    for (const value of [0n, 23n, 24n, 255n, 256n, 65535n, 65536n, 4294967295n, 4294967296n, 18446744073709551615n]) {
      const decoded = decodeOne(encodeUint(value));
      expect(decoded).toEqual({ kind: "uint", value });
    }
  });
});

describe("signed integer encoding (major type 1 for negatives)", () => {
  it("encodes -1 as the canonical negint minimal form", () => {
    expect(hex(encodeInt(-1n))).toBe("20");
  });

  it("round-trips positive and negative values symmetrically", () => {
    for (const value of [-1n, -24n, -25n, -256n, -4294967296n, -9223372036854775808n, 0n, 1n]) {
      const decoded = decodeOne(encodeInt(value));
      if (decoded.kind !== "uint" && decoded.kind !== "int") throw new Error(`unexpected kind ${decoded.kind}`);
      expect(decoded.value).toBe(value);
    }
  });
});

describe("bytes, text, bool", () => {
  it("round-trips a byte string", () => {
    const bytes = new Uint8Array([1, 2, 3, 255]);
    expect(decodeOne(encodeBytes(bytes))).toEqual({ kind: "bytes", value: bytes });
  });

  it("round-trips UTF-8 text including non-ASCII", () => {
    expect(decodeOne(encodeText("declarative-device"))).toEqual({ kind: "text", value: "declarative-device" });
    expect(decodeOne(encodeText("caffè"))).toEqual({ kind: "text", value: "caffè" });
  });

  it("round-trips booleans", () => {
    expect(decodeOne(encodeBool(true))).toEqual({ kind: "bool", value: true });
    expect(decodeOne(encodeBool(false))).toEqual({ kind: "bool", value: false });
  });
});

describe("maps and arrays", () => {
  it("round-trips a canonical map with ascending small-integer keys", () => {
    const map = encodeMap([
      [0, encodeUint(1n)],
      [1, encodeText("x")],
    ]);
    const decoded = decodeOne(map);
    expect(decoded.kind).toBe("map");
    if (decoded.kind !== "map") return;
    expect(decoded.value.get(0)).toEqual({ kind: "uint", value: 1n });
    expect(decoded.value.get(1)).toEqual({ kind: "text", value: "x" });
  });

  it("round-trips an array of encoded items", () => {
    const array = encodeArray([encodeUint(1n), encodeUint(2n), encodeUint(3n)]);
    const decoded = decodeOne(array);
    expect(decoded).toEqual({
      kind: "array",
      value: [
        { kind: "uint", value: 1n },
        { kind: "uint", value: 2n },
        { kind: "uint", value: 3n },
      ],
    });
  });

  it("rejects a map with a duplicate key", () => {
    const bytes = new Uint8Array([0xa2, 0x00, 0x01, 0x00, 0x02]); // {0:1, 0:2}
    expect(() => decodeOne(bytes)).toThrow(ProtocolCodecError);
  });

  it("rejects a map key that isn't a non-negative integer", () => {
    const bytes = new Uint8Array([0xa1, 0x61, 0x78, 0x01]); // {"x": 1}
    expect(() => decodeOne(bytes)).toThrow(ProtocolCodecError);
  });
});

describe("firmware-observed test vector", () => {
  it('decodes {0xA1, 0x00, 0x01} — a real byte sequence quoted verbatim from firmware/backbone/tests/protocol/src/main.c\'s "malformed" envelope test — as the valid single-key CBOR map {0: 1} at the raw CBOR layer (the envelope layer separately rejects it for missing keys 1/2/3, see envelope.test.ts)', () => {
    const malformed = new Uint8Array([0xa1, 0x00, 0x01]);
    const decoded = decodeOne(malformed);
    expect(decoded.kind).toBe("map");
    if (decoded.kind !== "map") return;
    expect(decoded.value.size).toBe(1);
    expect(decoded.value.get(0)).toEqual({ kind: "uint", value: 1n });
  });
});

describe("input exhaustion", () => {
  it("throws instead of reading past the end of the buffer", () => {
    expect(() => new CborReader(new Uint8Array([0x18])).readValue()).toThrow(ProtocolCodecError);
    expect(() => new CborReader(new Uint8Array([0x62, 0x61])).readValue()).toThrow(ProtocolCodecError); // text length 2, only 1 byte follows
  });
});
