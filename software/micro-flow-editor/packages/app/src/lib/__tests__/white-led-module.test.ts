import { describe, expect, it } from "vitest";
import { whiteLedConfig, whiteLedProperties } from "../white-led-module.js";
describe("white LED module",()=>{
 it("compiles initialization and PWM action steps",()=>{
 const config=whiteLedConfig({});config.initialIntensity=25;
 const p=whiteLedProperties({whiteLedConfig:JSON.stringify(config)});
 expect(p["3"]).toBe(25n);expect(p["6"]).toBe("100");expect(p["7"]).toBe("0");expect(p["8"]).toBe("50");
 });
 it("rejects invalid intensity and empty actions",()=>{
 const c=whiteLedConfig({});c.initialIntensity=101;
 expect(()=>whiteLedProperties({whiteLedConfig:JSON.stringify(c)})).toThrow("0 a 100");
 c.initialIntensity=0;c.actions[0]!.steps=[];
 expect(()=>whiteLedProperties({whiteLedConfig:JSON.stringify(c)})).toThrow("1 a 8");
 });
});
