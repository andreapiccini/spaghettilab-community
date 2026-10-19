import { compileConfig, encodeConfigCbor, sha256, type CompileConfigInput } from "@spaghettilab/config-compiler";
import { deploymentId } from "@spaghettilab/domain";
import { describe, expect, it, vi } from "vitest";
import { deployConfig, deployToCores, DeploymentOutcomeKind, type ConfigWireClient, type DeploymentContext } from "../deploy.js";

function mustOk<T>(result: { ok: boolean; value?: T }): T {
  if (!result.ok) throw new Error("expected ok result");
  return result.value as T;
}

const mqtt = { enabled: false, host: "", port: 0, baseTopic: "", security: 0, credentialId: 0 };
const energy = { bleAvailability: 0, advertisingWindowMs: 0, advertisingPeriodMs: 0 };

function fixture(): CompileConfigInput {
  return {
    physicalGraph: {
      layer: "physical-composition",
      nodes: [{ layer: "physical-composition", id: "m1", data: { kind: "module", driverTypeId: "declarative-device", portId: 1, bayId: 100, railId: 1000, electricalMode: "input-only", properties: {} } }],
      edges: [],
    },
    processingGraph: {
      layer: "device-processing",
      nodes: [{ layer: "device-processing", id: "s1", data: { kind: "schedule", moduleNodeId: "m1", periodMs: 1000, enabled: true } }],
      edges: [],
    },
    mqtt,
    connectivity: 0,
    energy,
  };
}

function context(target = "core-a"): DeploymentContext {
  return {
    expectedGeneration: 5,
    sourceProjectHash: "abc",
    target,
    deploymentId: mustOk(deploymentId("11111111-1111-4111-8111-111111111111")),
    timestamp: "2026-08-13T00:00:00.000Z",
  };
}

function fakeClient(overrides: Partial<ConfigWireClient> = {}): ConfigWireClient {
  return {
    getConfig: vi.fn().mockResolvedValue({ generation: 5, sha256: new Uint8Array(32), configBytes: new Uint8Array() }),
    validateConfig: vi.fn().mockResolvedValue({ valid: true }),
    applyConfig: vi.fn().mockResolvedValue({ changed: true, generation: 6, sha256: new Uint8Array(32) }),
    ...overrides,
  };
}

describe("deployConfig — S080 § Verifiche", () => {
  it("succeeds after a matching read-back", async () => {
    const compiled = compileConfig(fixture());
    if (!compiled.ok) throw new Error("fixture must compile");
    const candidateHash = await sha256(encodeConfigCbor(compiled.value));
    const client = fakeClient({
      applyConfig: vi.fn().mockResolvedValue({ changed: true, generation: 6, sha256: candidateHash }),
      getConfig: vi.fn().mockResolvedValue({ generation: 6, sha256: candidateHash, configBytes: new Uint8Array() }),
    });
    const result = await deployConfig(client, fixture(), context());
    expect(result.outcome).toBe(DeploymentOutcomeKind.SUCCESS);
    expect(result.record?.configGeneration).toBe(6);
    expect(result.record?.outcome).toBe("success");
  });

  it("reports READBACK_MISMATCH (and never creates a record) when the post-apply read-back doesn't match", async () => {
    const client = fakeClient({
      applyConfig: vi.fn().mockResolvedValue({ changed: true, generation: 6, sha256: new Uint8Array(32).fill(0xaa) }),
      getConfig: vi.fn().mockResolvedValue({ generation: 6, sha256: new Uint8Array(32).fill(0xbb), configBytes: new Uint8Array() }),
    });
    const result = await deployConfig(client, fixture(), context());
    expect(result.outcome).toBe(DeploymentOutcomeKind.READBACK_MISMATCH);
    expect(result.record).toBeUndefined();
  });

  it("reports NO_OP without treating it as a new generation", async () => {
    const client = fakeClient({ applyConfig: vi.fn().mockResolvedValue({ changed: false, generation: 5, sha256: new Uint8Array(32) }) });
    const result = await deployConfig(client, fixture(), context());
    expect(result.outcome).toBe(DeploymentOutcomeKind.NO_OP);
    expect(result.record?.configGeneration).toBe(5);
  });

  it("reports VALIDATION_FAILED when the Core rejects the candidate, without applying anything", async () => {
    const client = fakeClient({ validateConfig: vi.fn().mockResolvedValue({ valid: false, failureField: 4, failureIndex: 0, failureReason: 1 }) });
    const result = await deployConfig(client, fixture(), context());
    expect(result.outcome).toBe(DeploymentOutcomeKind.VALIDATION_FAILED);
    expect(client.applyConfig).not.toHaveBeenCalled();
  });

  it("preserves activation failures when CONFLICT has an unchanged generation", async () => {
    const cause = { code: "PROTOCOL_ERROR", status: 4, configFailure: { phase: "activate_module", errno: -116, rollbackErrno: 0 } };
    const client = fakeClient({ applyConfig: vi.fn().mockRejectedValue(cause) });
    const result = await deployConfig(client, fixture(), context());
    expect(result.outcome).toBe(DeploymentOutcomeKind.REMOTE_ERROR);
    expect(result.issues[0]?.cause).toBe(cause);
    expect(client.applyConfig).toHaveBeenCalledTimes(1);
  });

  it("resolves a stale-generation conflict with the live snapshot and an explicit diff, never force-applying", async () => {
    const client = fakeClient({
      applyConfig: vi.fn().mockRejectedValue({ code: "PROTOCOL_ERROR", status: 4 }),
      getConfig: vi.fn().mockResolvedValue({ generation: 9, sha256: new Uint8Array(32), configBytes: encodeConfigCbor({ version: 4, modules: [], schedules: [], rules: [], mqtt, connectivity: 0, energy, blocks: [], edges: [] }) }),
    });
    const result = await deployConfig(client, fixture(), context());
    expect(result.outcome).toBe(DeploymentOutcomeKind.STALE_GENERATION);
    expect(result.liveConfig).toBeDefined();
    expect(result.diff).toBeDefined();
    expect(result.record).toBeUndefined();
  });

  it("reconciles a lost apply response via a follow-up GET_CONFIG hash comparison (reboot/response-lost case)", async () => {
    const client = fakeClient({ applyConfig: vi.fn().mockRejectedValue(new Error("connection dropped")) });
    const result = await deployConfig(client, fixture(), context());
    // Fake getConfig's sha256 (all zero) won't match the real candidate hash, so this resolves to NOT_APPLIED — proving reconciliation actually compares hashes rather than assuming success.
    expect(result.outcome).toBe(DeploymentOutcomeKind.AMBIGUOUS_RESOLVED_NOT_APPLIED);
    expect(client.getConfig).toHaveBeenCalled();
  });

  it("reconciles a lost apply response as APPLIED when the read-back hash matches the candidate", async () => {
    const { compileConfig } = await import("@spaghettilab/config-compiler");
    const compiled = compileConfig(fixture());
    if (!compiled.ok) throw new Error("fixture must compile");
    const candidateHash = await sha256(encodeConfigCbor(compiled.value));
    const client = fakeClient({
      applyConfig: vi.fn().mockRejectedValue(new Error("timeout")),
      getConfig: vi.fn().mockResolvedValue({ generation: 6, sha256: candidateHash, configBytes: new Uint8Array() }),
    });
    const result = await deployConfig(client, fixture(), context());
    expect(result.outcome).toBe(DeploymentOutcomeKind.AMBIGUOUS_RESOLVED_APPLIED);
    expect(result.record).toBeDefined();
  });

  it("blocks deploy when a required Device Profile is not installed, leaving the candidate untouched", async () => {
    const withProfile: CompileConfigInput = {
      ...fixture(),
      physicalGraph: {
        layer: "physical-composition",
        nodes: [{ layer: "physical-composition", id: "m1", data: { kind: "module", driverTypeId: "declarative-device", profileId: "sensor.example", portId: 1, bayId: 100, railId: 1000, electricalMode: "input-only", properties: {} } }],
        edges: [],
      },
    };
    const client = fakeClient();
    const result = await deployConfig(client, withProfile, { ...context(), availableProfileIds: new Set() });
    expect(result.outcome).toBe(DeploymentOutcomeKind.PROFILE_OR_PACK_MISSING);
    expect(client.applyConfig).not.toHaveBeenCalled();
    expect(client.validateConfig).not.toHaveBeenCalled();
  });
});

describe("deployToCores — S080 point 8", () => {
  it("a failure on one Core never marks another Core's result as failed", async () => {
    const goodClient = fakeClient({ applyConfig: vi.fn().mockResolvedValue({ changed: false, generation: 5, sha256: new Uint8Array(32) }) });
    const badClient = fakeClient({ validateConfig: vi.fn().mockRejectedValue(new Error("core B unreachable")) });

    const results = await deployToCores([
      { client: goodClient, input: fixture(), context: context("core-a") },
      { client: badClient, input: fixture(), context: context("core-b") },
    ]);

    const coreA = results.find((r) => r.target === "core-a")!;
    const coreB = results.find((r) => r.target === "core-b")!;
    expect(coreA.result.outcome).toBe(DeploymentOutcomeKind.NO_OP);
    expect(coreB.result.outcome).toBe(DeploymentOutcomeKind.REMOTE_ERROR);
  });
});
