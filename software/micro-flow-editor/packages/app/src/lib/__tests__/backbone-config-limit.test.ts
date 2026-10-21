import { expect, it } from "vitest";
import { backboneConfigLimit } from "../backbone-config-limit.js";
it("distinguishes config storage from the larger USB envelope",()=>{
 expect(backboneConfigLimit("backbone-v2-esp32s3","0.5.34+0")).toBe(512);
 expect(backboneConfigLimit("backbone-v2-esp32s3","0.5.35+0")).toBe(576);
 expect(backboneConfigLimit("backbone-v2-esp32s3","0.5.46+0")).toBe(576);
 expect(backboneConfigLimit("backbone-v2-esp32s3","0.5.47+0")).toBe(1024);
 expect(backboneConfigLimit("backbone-v1-esp32s3","0.5.35+0")).toBe(512);
 expect(backboneConfigLimit("unknown","0.5.35")).toBeUndefined();
});
