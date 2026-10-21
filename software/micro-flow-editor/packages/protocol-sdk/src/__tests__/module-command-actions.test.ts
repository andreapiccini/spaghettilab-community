import { describe, it, expect } from "vitest";
import {
  encodeModuleCommandRequest,
  decodeModuleCommandRequest,
  encodeModuleCommandResponse,
  decodeModuleCommandResponse,
} from "../operations/module-command.js";
describe("driver action commands", () => {
  it("preserves signed, boolean and byte arguments", () => {
    const request = {
      key: 5,
      commandId: 2,
      arguments: { 1: -7n, 2: true, 3: new Uint8Array([0x6b, 0]) },
    };
    expect(decodeModuleCommandRequest(encodeModuleCommandRequest(request))).toEqual(
      request,
    );
  });
  it("returns decoded fields and actual RX with legacy compatibility", () => {
    const result = {
      fields: { 1: 104n, 2: -3n },
      rxReads: [new Uint8Array([104])],
      rxTruncated: false,
    };
    expect(decodeModuleCommandResponse(encodeModuleCommandResponse(result))).toEqual(
      result,
    );
    expect(decodeModuleCommandResponse(encodeModuleCommandResponse())).toEqual({});
  });
});

it("preserves a complete color argument as text",()=>{const req={key:1,commandId:3,arguments:{1:"#204060"}};expect(decodeModuleCommandRequest(encodeModuleCommandRequest(req))).toEqual(req);});
it("rejects oversized UTF-8 command text",()=>{expect(()=>decodeModuleCommandRequest(encodeModuleCommandRequest({key:1,commandId:3,arguments:{1:"è".repeat(17)}}))).toThrow();});
