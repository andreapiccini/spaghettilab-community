import { describe, expect, it, beforeAll } from "vitest";
import { hex } from "@spaghettilab/module-tag-protocol";
import { ensureBuiltinSignatures, RegistryClient } from "../index.js";

describe("RegistryClient", () => {
  beforeAll(async () => {
    await ensureBuiltinSignatures();
  });

  it("resolves cached builtin definition", async () => {
    const client = new RegistryClient();
    await ensureBuiltinSignatures();
    // refresh client cache after signature fill
    const fresh = new RegistryClient();
    const result = await fresh.resolve({ registryId: 1, vendorId: 1, moduleTypeId: 1001, definitionRevision: 3 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.definition.presentation.name).toContain("Backbone");
    expect(result.definitionHash.length).toBe(16);
    expect(hex(result.definitionHash).length).toBe(32);
  });

  it("rejects unknown registry", async () => {
    const client = new RegistryClient();
    const result = await client.resolve({ registryId: 99, vendorId: 1, moduleTypeId: 1, definitionRevision: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("unknown_registry");
  });

  it("reports offline when not cached", async () => {
    const client = new RegistryClient();
    const result = await client.resolve({ registryId: 1, vendorId: 1, moduleTypeId: 9999, definitionRevision: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("offline");
  });
});
