import { describe, it, expect } from "vitest";
import { encodeNfcPageRequest, decodeNfcPageResponse } from "../operations/nfc.js";
import {
  encodeMap,
  u32Field,
  bytesField,
  requireMap,
  requireBytes,
} from "../fields.js";
import { decodeOne } from "../cbor.js";

describe("UID-bound NFC memory pages", () => {
  const target = {
    nodeId: 0xe18030,
    antenna: 2,
    uid: new Uint8Array([2, 1, 2, 3, 4, 5, 6]),
    page: 4,
  };
  it("sends the exact target and four bytes, and verifies the acknowledged page", () => {
    const bytes = new Uint8Array([83, 76, 70, 49]);
    const request = requireMap(
      decodeOne(encodeNfcPageRequest({ ...target, data: bytes })),
      "test",
    );
    expect(requireBytes(request, 2, "test")).toEqual(target.uid);
    expect(requireBytes(request, 5, "test")).toEqual(bytes);
    expect(
      decodeNfcPageResponse(encodeMap([u32Field(0, 4), bytesField(1, bytes)]), 4),
    ).toEqual(bytes);
    expect(() =>
      decodeNfcPageResponse(encodeMap([u32Field(0, 5), bytesField(1, bytes)]), 4),
    ).toThrow();
  });
  it("never writes capability, product, lock or out-of-range pages", () => {
    for (const page of [0, 3, 44, 45, 255])
      expect(() =>
        encodeNfcPageRequest({ ...target, page, data: new Uint8Array(4) }),
      ).toThrow();
    expect(() => encodeNfcPageRequest({ ...target, uid: new Uint8Array(4) })).toThrow();
    expect(() =>
      encodeNfcPageRequest({ ...target, data: new Uint8Array(5) }),
    ).toThrow();
  });

  it("accepts antenna 0 for a dedicated single-antenna reader", () => {
    expect(() => encodeNfcPageRequest({ ...target, antenna: 0, page: 3 })).not.toThrow();
  });
});
