import type { DeviceProfileDraft } from "@spaghettilab/device-profile-authoring-model";
import { PortTransport } from "@spaghettilab/device-profile-authoring-model";
import type { DeviceProfileSummary } from "@spaghettilab/protocol-sdk";
import { describe, expect, it, vi } from "vitest";
import { encodeDeviceProfileCbor } from "../profile-cbor.js";
import { sha256 } from "../hash.js";
import { installProfile, removeProfile, type DeviceProfileWireClient } from "../install-workflow.js";

function draft(): DeviceProfileDraft {
  return {
    profileId: "sensor.example",
    version: 1,
    transport: PortTransport.I2C,
    requiredCapabilities: 1,
    maxTotalTimeMs: 100,
    maxTransactions: 5,
    maxBytes: 16,
    initOps: [{ op: "I2C_WRITE", src: 0, length: 1, timeoutMs: 20 }],
    sampleOps: [
      { op: "I2C_READ", dst: 1, length: 2, timeoutMs: 20 },
      { op: "EMIT_FIELD", src: 1, fieldId: 1 },
      { op: "EMIT_RECORD" },
    ],
    safeStopOps: [],
    sampleSchemaId: "sensor.example.sample",
    sampleSchemaVersion: 1,
    sampleFields: [{ fieldId: 1, type: "int64", name: "current", unit: "mA" }],
  };
}

function fakeClient(overrides: Partial<DeviceProfileWireClient> = {}): DeviceProfileWireClient {
  return {
    validateDeviceProfile: vi.fn().mockResolvedValue({ valid: 1 }),
    installDeviceProfile: vi.fn().mockResolvedValue(undefined),
    removeDeviceProfile: vi.fn().mockResolvedValue(undefined),
    getFullDeviceProfileList: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

describe("installProfile — S063 point 1", () => {
  it("validates remotely, installs, then verifies the post-install hash", async () => {
    const d = draft();
    const expectedHash = await sha256(encodeDeviceProfileCbor(d));
    const summary: DeviceProfileSummary = { profileId: d.profileId, version: d.version, hash: expectedHash };
    const client = fakeClient({ getFullDeviceProfileList: vi.fn().mockResolvedValue([summary]) });

    const result = await installProfile(client, d);
    expect(result.ok).toBe(true);
    expect(client.validateDeviceProfile).toHaveBeenCalled();
    expect(client.installDeviceProfile).toHaveBeenCalled();
    if (result.ok) expect(result.value.summary).toEqual(summary);
  });

  it("fails when the profile does not appear in the catalog after a successful install", async () => {
    const client = fakeClient({ getFullDeviceProfileList: vi.fn().mockResolvedValue([]) });
    const result = await installProfile(client, draft());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("device-profile-install.not_found_after_install");
  });

  it("fails when the Core-reported hash does not match the bytes this package sent", async () => {
    const d = draft();
    const wrongHash = new Uint8Array(32).fill(0xaa);
    const summary: DeviceProfileSummary = { profileId: d.profileId, version: d.version, hash: wrongHash };
    const client = fakeClient({ getFullDeviceProfileList: vi.fn().mockResolvedValue([summary]) });
    const result = await installProfile(client, d);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("device-profile-install.hash_verification_failed");
  });

  it("translates a PROTOCOL_ERROR with status BUSY from installDeviceProfile into a structured error", async () => {
    const client = fakeClient({
      installDeviceProfile: vi.fn().mockRejectedValue({ code: "PROTOCOL_ERROR", status: 5 }),
    });
    const result = await installProfile(client, draft());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("device-profile-install.profile_in_use");
  });

  it("translates client TIMEOUT into a clear remediation", async () => {
    const client = fakeClient({
      installDeviceProfile: vi.fn().mockRejectedValue({ code: "TIMEOUT", message: "SpaghettiClient TIMEOUT" }),
    });
    const result = await installProfile(client, draft());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("device-profile-install.remote_validation_failed");
      expect(result.error.remediation).toMatch(/timeout/i);
    }
  });

  it("continues install when VALIDATE response decode fails (wire drift)", async () => {
    const d = draft();
    const expectedHash = await sha256(encodeDeviceProfileCbor(d));
    const summary: DeviceProfileSummary = { profileId: d.profileId, version: d.version, hash: expectedHash };
    const client = fakeClient({
      validateDeviceProfile: vi
        .fn()
        .mockRejectedValue(new Error("ValidateDeviceProfileResponse: field 0 must be a uint")),
      getFullDeviceProfileList: vi.fn().mockResolvedValue([summary]),
    });
    const result = await installProfile(client, d);
    expect(result.ok).toBe(true);
    expect(client.installDeviceProfile).toHaveBeenCalled();
  });

  it("never changes what a caller sees as installed when interrupted — no local catalog cache exists to roll back", async () => {
    const client = fakeClient({ installDeviceProfile: vi.fn().mockRejectedValue(new Error("network drop")) });
    const before = await client.getFullDeviceProfileList();
    const result = await installProfile(client, draft());
    const after = await client.getFullDeviceProfileList();
    expect(result.ok).toBe(false);
    expect(after).toEqual(before);
  });
});

describe("removeProfile — S063 § Verifiche (in-use profile cannot be removed)", () => {
  it("refuses locally, with no remote call, when the caller already knows a local Module references it", async () => {
    const client = fakeClient();
    const result = await removeProfile(client, "sensor.example", 1, { isReferencedLocally: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("device-profile-install.profile_in_use");
    expect(client.removeDeviceProfile).not.toHaveBeenCalled();
  });

  it("calls the remote removal when not locally referenced, and translates a server-side BUSY the same way", async () => {
    const client = fakeClient({ removeDeviceProfile: vi.fn().mockRejectedValue({ code: "PROTOCOL_ERROR", status: 5 }) });
    const result = await removeProfile(client, "sensor.example", 1, { isReferencedLocally: false });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("device-profile-install.profile_in_use");
    expect(client.removeDeviceProfile).toHaveBeenCalled();
  });

  it("succeeds when not referenced and the Core accepts the removal", async () => {
    const client = fakeClient();
    const result = await removeProfile(client, "sensor.example", 1, { isReferencedLocally: false });
    expect(result.ok).toBe(true);
  });
});


it("reuses a remotely confirmed identical profile without validating or uploading it again", async () => {
  const d = draft();
  const summary = { profileId: d.profileId, version: d.version, hash: await sha256(encodeDeviceProfileCbor(d)) };
  const client = fakeClient({ getFullDeviceProfileList: vi.fn().mockResolvedValue([summary]) });
  expect((await installProfile(client, d, { reuseInstalled: true })).ok).toBe(true);
  expect(client.validateDeviceProfile).not.toHaveBeenCalled();
  expect(client.installDeviceProfile).not.toHaveBeenCalled();
});
it("does not reuse the same id and version when its content hash differs", async () => {
  const client = fakeClient({ getFullDeviceProfileList: vi.fn().mockResolvedValue([{ profileId: draft().profileId, version: 1, hash: new Uint8Array(32) }]) });
  const result = await installProfile(client, draft(), { reuseInstalled: true });
  expect(client.validateDeviceProfile).toHaveBeenCalledOnce();
  expect(client.installDeviceProfile).toHaveBeenCalledOnce();
  expect(result.ok).toBe(false);
});
