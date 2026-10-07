import { describe, expect, it } from "vitest";
import { PHYSICAL_CATALOG, catalogEntry, expectedFunctionTag, parsePhysicalCatalog, pinsForModes, tagForSlot, topologyForBoard, validatePhysicalModes } from "../backbone-physical.js";
import type { GetStatusResponse, NfcTagStatus } from "@spaghettilab/protocol-sdk";

const tag: NfcTagStatus = { portId: 2, typeId: "sensor", uid: new Uint8Array([1, 2, 3, 4]), nodeId: 42, local: false, registryId: 1, vendorId: 1, moduleTypeId: 2001 };
const status: GetStatusResponse = { state: 0, mode: 0, imageState: 0, activeSlot: 0, imageConfirmed: true, version: "v1", portCount: 2, lastResetCause: 0, healthState: 0, modules: [], physical: new Uint8Array([1, 1, 2, 1, 0, 25, 0, 0, 0, 0, 0, 0, 0]), nfcTags: [tag], chainPeers: [{ nodeId: 42, mac: new Uint8Array(6), flags: 0, local: false, physical: new Uint8Array([1, 1, 2, 1, 0, 25, 0, 4, 5, 0, 0, 1, 2]) }] };

describe("physical composition", () => {
  it("matches the complete NFC authority identity, never fallback labels", () => {
    expect(PHYSICAL_CATALOG).toHaveLength(2);
    expect(catalogEntry(tag, PHYSICAL_CATALOG)?.name).toBe("Sensor Demo Module");
    expect(catalogEntry({ ...tag, vendorId: 2 }, PHYSICAL_CATALOG)).toBeUndefined();
    expect(catalogEntry({ ...tag, registryId: undefined }, PHYSICAL_CATALOG)).toBeUndefined();
    expect(catalogEntry(tag, PHYSICAL_CATALOG)?.pins).toBeUndefined();
  });
  it("separates peers that use the same port numbers", () => {
    expect(topologyForBoard(status, { nodeId: 42, local: false })?.modes).toEqual([4, 5, 0, 0]);
    expect(topologyForBoard(status, { nodeId: 0, local: true })?.modes).toEqual([0, 0, 0, 0]);
    expect(topologyForBoard(status, { nodeId: 43, local: false })).toBeUndefined();
    expect(tagForSlot(status, { nodeId: 0, local: true }, 2)).toBeUndefined();
    expect(tagForSlot(status, { nodeId: 42, local: false }, 2)).toEqual(tag);
  });
  it("keeps power pins fixed and validates the real I2C pair", () => {
    expect(pinsForModes([4, 5, 0, 1])).toEqual(["5V", "SDA", "SCL", "NC", "GPIO IN", "GND"]);
    expect(validatePhysicalModes([4, 0, 0, 0], 0)).toBeDefined();
    expect(validatePhysicalModes([0, 0, 4, 5], 0)).toBeUndefined();
    expect(validatePhysicalModes([7, 0, 6, 12], 0)).toBeUndefined();
    expect(validatePhysicalModes([8, 10, 11, 9], 0)).toBeUndefined();
    expect(validatePhysicalModes([6, 6, 7, 0], 0)).toBeDefined();
    expect(validatePhysicalModes([4, 5, 17, 33], 1)).toBeUndefined();
  });
  it("encodes the NFC snapshot with exact byte order and UID", () => {
    expect([...expectedFunctionTag(tag, true)]).toEqual([0, 1, 0, 1, 0, 0, 7, 209, 4, 1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 1]);
    expect([...expectedFunctionTag(undefined)]).toEqual(Array(20).fill(0));
  });
  it("imports complete definitions and rejects inconsistent electrical metadata", () => {
    const entry = { registryId: 1, vendorId: 1, moduleTypeId: 2001, name: "Custom", pins: pinsForModes([4, 5, 0, 0]), modes: [4, 5, 0, 0], i2cSpeed: 0 };
    expect(parsePhysicalCatalog(JSON.stringify([entry]))).toEqual([entry]);
    expect(() => parsePhysicalCatalog(JSON.stringify([{ ...entry, pins: ["3V3", "SDA", "SCL", "NC", "NC", "GND"] }]))).toThrow();
    expect(() => parsePhysicalCatalog(JSON.stringify([entry, entry]))).toThrow();
    expect(() => parsePhysicalCatalog(JSON.stringify([{ ...entry, modes: [4, 0, 0, 0] }]))).toThrow();
  });
});
