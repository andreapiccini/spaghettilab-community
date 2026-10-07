import { describe, expect, it } from "vitest";
import { Operation, decodeRequest, encodeRequest } from "../envelope.js";
import { decodeOne } from "../cbor.js";
import { requireBytes, requireMap } from "../fields.js";
import { decodePhysicalBackbone, encodeApplyPhysicalRequest, decodeApplyPhysicalResponse, encodePhysicalSettings, decodePhysicalSettings, DEFAULT_PHYSICAL_SETTINGS } from "../operations/physical.js";
import { encodeGetStatusResponse, decodeGetStatusResponse, type GetStatusResponse } from "../operations/status.js";

const descriptor = new Uint8Array([1, 1, 2, 1, 0, 25, 0, 4, 5, 0, 1, 1, 2]);

describe("physical Backbone protocol", () => {
  it("round-trips extended settings and independent signal assignments", () => {
    const settings = {...DEFAULT_PHYSICAL_SETTINGS,baud:57600,spiMode:3 as const,bitOrder:"lsb" as const,pwmHz:1500,pwmInverted:true};
    const bytes = encodePhysicalSettings(settings);
    expect(decodePhysicalSettings(bytes)).toEqual(settings);
    const extended = new Uint8Array([...descriptor, ...bytes]); extended[0]=2;
    expect(decodePhysicalBackbone(extended)?.settings).toEqual(settings);
    const payload = encodeApplyPhysicalRequest({nodeId:0,modes:new Uint8Array([7,12,6,1]),i2cSpeed:0,settings});
    expect(requireBytes(requireMap(decodeOne(payload),"apply"),4,"apply")).toEqual(bytes);
    expect(() => encodePhysicalSettings({...settings,pwmHz:0})).toThrow();
    bytes[19]=1;
    expect(() => decodePhysicalSettings(bytes)).toThrow();
  });
  it("reads actual board metadata and declines unsupported descriptors", () => {
    expect(decodePhysicalBackbone(descriptor)).toMatchObject({ mcu: "ESP32-S3", antennas: 2, layout: 1, backendPortId: 0, capabilities: 25, modes: [4, 5, 0, 1], i2cSpeed: 1, source: 2 });
    expect(decodePhysicalBackbone(descriptor.slice(0, 12))).toBeUndefined();
    expect(decodePhysicalBackbone(new Uint8Array([2, ...descriptor.slice(1)]))).toBeUndefined();
  });

  it("retains independent local and remote descriptions in status", () => {
    const remote = descriptor.slice(); remote[7] = 1; remote[8] = 2;
    const status: GetStatusResponse = { state: 0, mode: 0, imageState: 0, activeSlot: 0, imageConfirmed: true, version: "v1", portCount: 2, lastResetCause: 0, healthState: 0, modules: [], physical: descriptor, chainPeers: [{ nodeId: 123, mac: new Uint8Array(6), local: false, flags: 0, physical: remote }] };
    expect(decodeGetStatusResponse(encodeGetStatusResponse(status))).toEqual(status);
    const old = { ...status, physical: undefined, chainPeers: undefined };
    expect(decodeGetStatusResponse(encodeGetStatusResponse(old)).physical).toBeUndefined();
  });

  it("encodes an addressed apply and a complete NFC snapshot", () => {
    const expected = new Uint8Array(20); expected[8] = 4; expected[19] = 1;
    const request = { nodeId: 0xabc123, modes: new Uint8Array([4, 5, 17, 3]), i2cSpeed: 1, expectedTag: expected };
    const payload = encodeApplyPhysicalRequest(request);
    const envelope = decodeRequest(encodeRequest({ correlationId: 1, operation: Operation.APPLY_PHYSICAL, payload }));
    expect(envelope.operation).toBe(32);
    expect(decodeApplyPhysicalResponse(payload)).toMatchObject({ nodeId: request.nodeId, modes: request.modes, i2cSpeed: 1 });
    expect(requireBytes(requireMap(decodeOne(payload), "apply"), 3, "apply")).toEqual(expected);
  });

  it("rejects broadcast writes, incomplete maps and invalid input pulls", () => {
    const request = { nodeId: 1, modes: new Uint8Array([1, 2, 3, 0]), i2cSpeed: 0 };
    expect(() => encodeApplyPhysicalRequest({ ...request, nodeId: 0xffffffff })).toThrow();
    expect(() => encodeApplyPhysicalRequest({ ...request, modes: new Uint8Array(6) })).toThrow();
    expect(() => encodeApplyPhysicalRequest({ ...request, modes: new Uint8Array([49, 0, 0, 0]) })).toThrow();
    expect(() => encodeApplyPhysicalRequest({ ...request, expectedTag: new Uint8Array(21) })).toThrow();
  });
});
