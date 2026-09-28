import { describe, expect, it } from "vitest";
import { ProtocolCodecError } from "../cbor.js";
import {
  decodeEvent,
  decodeRequest,
  decodeResponse,
  encodeEvent,
  encodeRequest,
  encodeResponse,
  EventType,
  Operation,
  PAYLOAD_ABSOLUTE_MAX,
  ProtocolStatus,
} from "../envelope.js";

describe("envelope — request/response/event round trip", () => {
  it("round-trips a request", () => {
    const payload = new Uint8Array([0xa0]);
    const bytes = encodeRequest({
      correlationId: 42,
      operation: Operation.GET_STATUS,
      payload,
    });
    expect(decodeRequest(bytes)).toEqual({
      correlationId: 42,
      operation: Operation.GET_STATUS,
      payload,
    });
  });

  it("round-trips a response", () => {
    const payload = new Uint8Array([0xa0]);
    const bytes = encodeResponse({
      correlationId: 42,
      status: ProtocolStatus.OK,
      payload,
    });
    expect(decodeResponse(bytes)).toEqual({
      correlationId: 42,
      status: ProtocolStatus.OK,
      payload,
    });
  });

  it("round-trips an event", () => {
    const payload = new Uint8Array([0xa0]);
    const bytes = encodeEvent({ sequence: 7, type: EventType.RECORD, payload });
    expect(decodeEvent(bytes)).toEqual({
      sequence: 7,
      type: EventType.RECORD,
      payload,
    });
  });

  it("produces the exact indefinite-length 4-key map layout the real firmware build emits, verified via firmware/backbone/tests/protocol's test_envelope_golden_vectors", () => {
    // {0:1, 1:1, 2:2, 3: bstr(0x A0)} — version=1, correlation=1, operation=2 (GET_STATUS), payload={0xA0}.
    // zcbor in this firmware build does NOT use canonical/definite-length
    // collections — it emits 0xBF <pairs...> 0xFF, confirmed by building and
    // running the firmware's own protocol test suite in native_sim.
    const bytes = encodeRequest({
      correlationId: 1,
      operation: Operation.GET_STATUS,
      payload: new Uint8Array([0xa0]),
    });
    expect(Array.from(bytes)).toEqual([
      0xbf, 0x00, 0x01, 0x01, 0x01, 0x02, 0x02, 0x03, 0x41, 0xa0, 0xff,
    ]);
  });
});

describe("envelope — encode-side validation", () => {
  it("rejects a zero correlationId/sequence", () => {
    expect(() =>
      encodeRequest({
        correlationId: 0,
        operation: Operation.GET_STATUS,
        payload: new Uint8Array(),
      }),
    ).toThrow(ProtocolCodecError);
    expect(() =>
      encodeResponse({
        correlationId: 0,
        status: ProtocolStatus.OK,
        payload: new Uint8Array(),
      }),
    ).toThrow(ProtocolCodecError);
    expect(() =>
      encodeEvent({ sequence: 0, type: EventType.RECORD, payload: new Uint8Array() }),
    ).toThrow(ProtocolCodecError);
  });

  it("rejects an operation/status/event type outside its valid range", () => {
    expect(() =>
      encodeRequest({
        correlationId: 1,
        operation: 32 as Operation,
        payload: new Uint8Array(),
      }),
    ).toThrow(ProtocolCodecError);
    expect(() =>
      encodeResponse({
        correlationId: 1,
        status: 11 as ProtocolStatus,
        payload: new Uint8Array(),
      }),
    ).toThrow(ProtocolCodecError);
    expect(() =>
      encodeEvent({ sequence: 1, type: 5 as EventType, payload: new Uint8Array() }),
    ).toThrow(ProtocolCodecError);
  });

  it("rejects a payload over the 2048-byte absolute limit", () => {
    const payload = new Uint8Array(PAYLOAD_ABSOLUTE_MAX + 1);
    expect(() =>
      encodeRequest({ correlationId: 1, operation: Operation.GET_STATUS, payload }),
    ).toThrow(ProtocolCodecError);
  });
});

describe("envelope — decode-side validation", () => {
  it("rejects firmware/backbone/tests/protocol/src/main.c's literal \"malformed\" vector {0xA1, 0x00, 0x01} — a valid CBOR map {0:1} that is missing keys 1/2/3, exactly reproducing the firmware's own test_envelope_roundtrip_and_rejects assertion", () => {
    const malformed = new Uint8Array([0xa1, 0x00, 0x01]);
    expect(() => decodeRequest(malformed)).toThrow(ProtocolCodecError);
  });

  it("rejects an unexpected envelope key (>3)", () => {
    // {0:1,1:1,2:2,3:h'',4:0} — five pairs, key 4 is not allowed
    const bytes = new Uint8Array([
      0xa5, 0x00, 0x01, 0x01, 0x01, 0x02, 0x02, 0x03, 0x40, 0x04, 0x00,
    ]);
    expect(() => decodeRequest(bytes)).toThrow(ProtocolCodecError);
  });

  it("rejects trailing bytes after a complete envelope", () => {
    const bytes = encodeRequest({
      correlationId: 1,
      operation: Operation.GET_STATUS,
      payload: new Uint8Array(),
    });
    const withTrailing = new Uint8Array([...bytes, 0x00]);
    expect(() => decodeRequest(withTrailing)).toThrow(ProtocolCodecError);
  });

  it("rejects an unsupported protocol version", () => {
    // {0:2, 1:1, 2:2, 3:h''} — version=2, not the supported version 1
    const bytes = new Uint8Array([
      0xa4, 0x00, 0x02, 0x01, 0x01, 0x02, 0x02, 0x03, 0x40,
    ]);
    expect(() => decodeRequest(bytes)).toThrow(ProtocolCodecError);
  });

  it("rejects an out-of-range operation on request decode", () => {
    // {0:1, 1:1, 2:99, 3:h''} — operation 99 doesn't exist
    const bytes = new Uint8Array([
      0xa4, 0x00, 0x01, 0x01, 0x01, 0x02, 0x18, 0x63, 0x03, 0x40,
    ]);
    expect(() => decodeRequest(bytes)).toThrow(ProtocolCodecError);
  });

  it("rejects an out-of-range status on response decode", () => {
    // {0:1, 1:1, 2:11, 3:h''} — status 11 doesn't exist (max is 10)
    const bytes = new Uint8Array([
      0xa4, 0x00, 0x01, 0x01, 0x01, 0x02, 0x0b, 0x03, 0x40,
    ]);
    expect(() => decodeResponse(bytes)).toThrow(ProtocolCodecError);
  });

  it("accepts the complete operation range through 31", () => {
    const bytes = encodeRequest({
      correlationId: 1,
      operation: Operation.CANCEL_BLE_UPDATE,
      payload: new Uint8Array(),
    });
    expect(decodeRequest(bytes).operation).toBe(Operation.CANCEL_BLE_UPDATE);
  });

  it("does not confuse request and response field meanings", () => {
    // sanity: decoding a request-shaped envelope via decodeResponse must not
    // throw purely because field2 (here operation=2) also happens to be a
    // valid status value — the two decoders don't know what the bytes were
    // "meant" to be, only what they structurally validate.
    const bytes = encodeRequest({
      correlationId: 1,
      operation: Operation.GET_STATUS,
      payload: new Uint8Array(),
    });
    expect(() => decodeResponse(bytes)).not.toThrow();
  });
});
