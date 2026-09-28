import { describe, expect, it } from "vitest";
import { encodeUserMemory, emptyFields, FactoryFlags, executeWritePlan, planFactoryProgram, uuidToBytes } from "@spaghettilab/module-tag-protocol";
import { SimulatedReader } from "../adapters/simulated.js";

describe("SimulatedReader", () => {
  it("blocks concurrent operations", async () => {
    const reader = new SimulatedReader();
    await reader.connect();
    const a = reader.readPage(0);
    await expect(reader.readPage(1)).rejects.toThrow(/busy/);
    await a;
  });

  it("programs via protocol executor", async () => {
    const reader = new SimulatedReader();
    await reader.connect();
    const fields = emptyFields();
    fields.factoryFlags = FactoryFlags.PRODUCTION_UNIT | FactoryFlags.HAS_DEFINITION_HASH;
    fields.registryId = 1;
    fields.vendorId = 1;
    fields.moduleTypeId = 1001;
    fields.definitionRevision = 1;
    fields.hardwareRevision = 1;
    fields.moduleInstanceId = uuidToBytes("11111111-2222-4333-8444-555555555555");
    fields.definitionHash = new Uint8Array(16).fill(1);
    fields.serialNumber = 1n;
    const pages = await reader.readAllPages();
    const plan = planFactoryProgram(fields, pages);
    const mem = {
      readPage: (p: number) => reader.readPage(p),
      writePage: (p: number, d: Uint8Array) => reader.writePage(p, d),
    };
    const result = await executeWritePlan(mem, plan);
    expect(result.ok).toBe(true);
    expect(encodeUserMemory(fields).length).toBe(160);
  });
});
