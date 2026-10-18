import { expect, it } from "vitest";
import { decodeOne, encodeFloat } from "../cbor.js";
import { encodeModuleCommandResponse, decodeModuleCommandResponse } from "../operations/module-command.js";
it("round-trips finite decimal and unit-bearing text samples without converting them to integers", () => {
  for (const value of [23.4, -12.3, -0.1, 0]) expect(decodeOne(encodeFloat(value))).toEqual({ kind: "float", value });
  const response = { fields: { 1: 23.4, 2: "-0.1 °C", 3: 42n }, rxReads: [], rxTruncated: false };
  expect(decodeModuleCommandResponse(encodeModuleCommandResponse(response))).toEqual(response);
  expect(() => encodeFloat(Number.NaN)).toThrow();
  expect(() => encodeFloat(Infinity)).toThrow();
});
