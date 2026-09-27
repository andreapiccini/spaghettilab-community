import { describe, expect, it } from "vitest";
import {
  canonicalProjectHash,
  coreBindingId,
  createEmptyProject,
  deploymentId,
  projectId,
  type CoreBindingRecord,
  type ProjectV1,
} from "@spaghettilab/domain";
import { encodeConfigCbor, sha256 as sha256Config } from "@spaghettilab/config-compiler";
import { PortTransport, type DeviceProfileDraft } from "@spaghettilab/device-profile-authoring-model";
import { encodeDeviceProfileCbor, sha256 } from "@spaghettilab/device-profile-install";
import {
  decodeRequest,
  encodeAcceptDiscoveryResponse,
  encodeApplyConfigResponse,
  encodeGetCapabilitiesResponse,
  encodeGetCatalogResponse,
  encodeGetConfigResponse,
  encodeGetFeaturesResponse,
  encodeGetResourcesResponse,
  encodeGetStatusResponse,
  encodeGetTopologyResponse,
  encodeInstallDeviceProfileResponse,
  encodeListDeviceProfilesResponse,
  encodeListDiscoveryResponse,
  encodeRemoveDeviceProfileResponse,
  encodeResponse,
  encodeValidateConfigResponse,
  encodeValidateDeviceProfileResponse,
  EventStream,
  FakeTransport,
  Operation,
  ProtocolStatus,
  SpaghettiClient,
  fakeDiscoveryEvent,
  fakeRecordEvent,
  fakeStatusEvent,
  type DeviceProfileSummary,
  type DiscoveryCandidate,
  type GetCapabilitiesResponse,
  type GetCatalogResponse,
  type GetConfigResponse,
  type GetFeaturesResponse,
  type GetResourcesResponse,
  type GetStatusResponse,
  type GetTopologyResponse,
} from "@spaghettilab/protocol-sdk";
import { CatalogCache } from "../catalog-cache.js";
import { CoreSession } from "../core-session.js";
import { bytesToHex } from "../hex.js";

const DEVICE_ID = new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]);
const BINDING_ID = coreBindingId("cccccccc-0000-4000-8000-000000000001");
if (!BINDING_ID.ok) throw new Error("bad fixture id");

const STATUS: GetStatusResponse = {
  state: 1,
  mode: 1,
  imageState: 0,
  activeSlot: 0,
  imageConfirmed: true,
  version: "1.0.0",
  portCount: 1,
  lastResetCause: 0,
  healthState: 1,
  modules: [],
};
const CAPABILITIES: GetCapabilitiesResponse = {
  resourceProfile: 1,
  buildCapabilities: 0,
  coreVariant: "core-v2",
  maxProtocolPayload: 2048,
  maxInflightRequests: 8,
  replayWindowMs: 30000,
  maxModules: 16,
  maxPrincipals: 4,
};
const FEATURES: GetFeaturesResponse = { featureSetHash: new Uint8Array(4).fill(9), packs: [] };
const TOPOLOGY: GetTopologyResponse = { flows: [], nextCursor: 0 };
const RESOURCES: GetResourcesResponse = {
  featureSetHash: new Uint8Array(4).fill(9),
  modules: { capacity: 10, used: 1, peak: 1 },
  rules: { capacity: 10, used: 0, peak: 0 },
  blocks: { capacity: 10, used: 0, peak: 0 },
  profiles: { capacity: 10, used: 0, peak: 0 },
  records: { capacity: 10, used: 0, peak: 0 },
  workspace: { capacity: 10, used: 0, peak: 0 },
  allocationFailures: 0,
  flashSlotBytes: 1048576,
  flashImageBudgetBytes: 786432,
  flashHeadroomBytes: 262144,
  staticRamBudgetBytes: 65536,
};

function fakeCatalog(fingerprintByte: number): GetCatalogResponse {
  return {
    protocolVersion: 1,
    configVersion: 5,
    fingerprint: new Uint8Array(32).fill(fingerprintByte),
    drivers: [{ typeId: "driver-a", commandCount: 1 }],
    nextCursor: 0,
    driverCount: 1,
  };
}

function fakeConfig(hashByte: number): GetConfigResponse {
  return { generation: 1, sha256: new Uint8Array(32).fill(hashByte), configBytes: new Uint8Array([0xa0]) };
}

/** Drains `transport.sent`, answering every not-yet-answered request via the given per-operation responder. */
class FakeCoreResponder {
  private readonly answered = new Set<number>();

  constructor(
    private readonly transport: FakeTransport,
    private readonly handlers: Partial<Record<Operation, () => Uint8Array>>,
  ) {}

  drain(): void {
    for (const bytes of this.transport.sent) {
      const request = decodeRequest(bytes);
      if (this.answered.has(request.correlationId)) continue;
      const handler = this.handlers[request.operation];
      if (!handler) continue;
      this.answered.add(request.correlationId);
      this.transport.deliverResponse(
        encodeResponse({ correlationId: request.correlationId, status: ProtocolStatus.OK, payload: handler() }),
      );
    }
  }
}

/** Runs `work()`, repeatedly flushing microtasks and re-draining the responder until it settles. */
async function runToCompletion(work: () => Promise<void>, responder: FakeCoreResponder): Promise<void> {
  const done = work().catch((e: unknown) => {
    throw e;
  });
  let settled = false;
  void done.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let i = 0; i < 2000 && !settled; i++) {
    await Promise.resolve();
    responder.drain();
  }
  await done;
}

const FULL_HANDLERS = (catalogFingerprintByte: number, configHashByte: number): Partial<Record<Operation, () => Uint8Array>> => ({
  [Operation.GET_STATUS]: () => encodeGetStatusResponse(STATUS),
  [Operation.GET_CAPABILITIES]: () => encodeGetCapabilitiesResponse(CAPABILITIES),
  [Operation.GET_FEATURES]: () => encodeGetFeaturesResponse(FEATURES),
  [Operation.GET_CATALOG]: () => encodeGetCatalogResponse(fakeCatalog(catalogFingerprintByte)),
  [Operation.GET_TOPOLOGY]: () => encodeGetTopologyResponse(TOPOLOGY),
  [Operation.GET_CONFIG]: () => encodeGetConfigResponse(fakeConfig(configHashByte)),
  [Operation.GET_RESOURCES]: () => encodeGetResourcesResponse(RESOURCES),
});

function makeSession(catalogFingerprintByte = 1, configHashByte = 1, cache = new CatalogCache()) {
  const transport = new FakeTransport();
  const client = new SpaghettiClient(transport, { defaultTimeoutMs: 5000, attemptTimeoutMs: 5000 });
  const eventStream = new EventStream(transport);
  const bindingRecord: CoreBindingRecord = {
    bindingId: BINDING_ID.value,
    expectedDeviceId: bytesToHex(DEVICE_ID),
    connectionProfileId: "profile-1",
  };
  const session = new CoreSession(bindingRecord, client, eventStream, cache);
  const responder = new FakeCoreResponder(transport, FULL_HANDLERS(catalogFingerprintByte, configHashByte));
  // Establish identity via a STATUS event before connect() checks it.
  transport.deliverEvent(fakeStatusEvent(1, 1n, 0, 0, DEVICE_ID));
  return { transport, client, eventStream, binding: bindingRecord, session, responder, cache };
}

describe("CoreSession — connect()", () => {
  it("drives DISCONNECTED -> ... -> READY and populates the snapshot", async () => {
    const { session, responder } = makeSession();
    expect(session.state).toBe("DISCONNECTED");

    await runToCompletion(() => session.connect(), responder);

    expect(session.state).toBe("READY");
    expect(session.lastKnownSnapshot.status).toEqual(STATUS);
    expect(session.lastKnownSnapshot.config?.generation).toBe(1);
    expect(session.stale).toBe(false);
  });

  it("caches the catalog per device ID + fingerprint and reuses it on a second connect with the same fingerprint", async () => {
    const cache = new CatalogCache();
    const first = makeSession(1, 1, cache);
    await runToCompletion(() => first.session.connect(), first.responder);
    expect(cache.size).toBe(1);

    const second = makeSession(1, 1, cache); // same fingerprint byte -> cache hit expected
    await runToCompletion(() => second.session.connect(), second.responder);

    expect(second.session.state).toBe("READY");
    // Cache hit means only the cheap first-page peek is sent, never a second full pagination round.
    const catalogRequests = second.transport.sent.filter((b) => decodeRequest(b).operation === Operation.GET_CATALOG);
    expect(catalogRequests).toHaveLength(1);
  });
});

describe("CoreSession — identity", () => {
  it("transitions to ERROR when the connected device reports an unexpected device ID", async () => {
    const transport = new FakeTransport();
    const client = new SpaghettiClient(transport, { defaultTimeoutMs: 5000, attemptTimeoutMs: 5000 });
    const eventStream = new EventStream(transport);
    const mismatchedBinding: CoreBindingRecord = {
      bindingId: BINDING_ID.value,
      expectedDeviceId: "00112233",
      connectionProfileId: "profile-1",
    };
    const session = new CoreSession(mismatchedBinding, client, eventStream, new CatalogCache());
    const responder = new FakeCoreResponder(transport, {
      [Operation.GET_STATUS]: () => encodeGetStatusResponse(STATUS),
      [Operation.GET_CAPABILITIES]: () => encodeGetCapabilitiesResponse(CAPABILITIES),
      [Operation.GET_FEATURES]: () => encodeGetFeaturesResponse(FEATURES),
    });
    transport.deliverEvent(fakeStatusEvent(1, 1n)); // reports DEVICE_ID, which != mismatchedBinding.expectedDeviceId

    await expect(runToCompletion(() => session.connect(), responder)).rejects.toThrow();
    expect(session.state).toBe("ERROR");
  });
});

describe("CoreSession — disconnect / stale", () => {
  it("marks the session stale after being READY once, but keeps the last known snapshot", async () => {
    const { session, responder } = makeSession();
    await runToCompletion(() => session.connect(), responder);

    session.disconnect();

    expect(session.state).toBe("DISCONNECTED");
    expect(session.stale).toBe(true);
    expect(session.lastKnownSnapshot.status).toEqual(STATUS);
  });

  it("does not mark a never-connected session stale", () => {
    const { session } = makeSession();
    session.disconnect();
    expect(session.stale).toBe(false);
  });
});

describe("CoreSession — reboot mid-READY", () => {
  it("returns to SYNCHRONIZING (never silently stays READY) when the boot ID changes", async () => {
    const { session, responder, transport } = makeSession();
    await runToCompletion(() => session.connect(), responder);
    expect(session.state).toBe("READY");

    transport.deliverEvent(fakeStatusEvent(2, 2n, 0, 0, DEVICE_ID)); // boot id changed from 1 to 2
    // The event travels through EventStream's async iterator and CoreSession's
    // background consumer loop — a couple of microtask hops, not just one.
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(session.state).toBe("SYNCHRONIZING");
  });

  it("re-syncs on its own back to READY instead of staying parked at SYNCHRONIZING forever", async () => {
    const { session, responder, transport } = makeSession();
    await runToCompletion(() => session.connect(), responder);
    expect(session.state).toBe("READY");

    transport.deliverEvent(fakeStatusEvent(2, 2n, 0, 0, DEVICE_ID));
    // No caller awaits the background re-sync this triggers — poll it home the
    // same way runToCompletion() does for an awaited one, just without a promise handle.
    for (let i = 0; i < 2000 && session.state !== "READY"; i++) {
      await Promise.resolve();
      responder.drain();
    }

    expect(session.state).toBe("READY");
  });
});

describe("CoreSession — onDiscoveryEvent()", () => {
  it("fans a DISCOVERY event out to every subscriber without disturbing STATUS-driven state tracking", async () => {
    const { session, responder, transport } = makeSession();
    await runToCompletion(() => session.connect(), responder);
    expect(session.state).toBe("READY");

    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];
    const unsubscribeA = session.onDiscoveryEvent((payload) => receivedA.push(payload));
    session.onDiscoveryEvent((payload) => receivedB.push(payload));

    transport.deliverEvent(fakeDiscoveryEvent(42, 7, 2, 3));
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(receivedA).toEqual([{ candidateId: 7, portId: 2, generation: 3 }]);
    expect(receivedB).toEqual(receivedA);
    expect(session.state).toBe("READY");
    expect(session.lastBootId).toBe(1n);

    unsubscribeA();
    transport.deliverEvent(fakeDiscoveryEvent(43, 8, 1, 4));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(receivedA).toHaveLength(1);
    expect(receivedB).toHaveLength(2);
  });
});

describe("CoreSession — onRecordEvent()", () => {
  it("fans a RECORD event out to every subscriber without disturbing STATUS-driven state tracking", async () => {
    const { session, responder, transport } = makeSession();
    await runToCompletion(() => session.connect(), responder);
    expect(session.state).toBe("READY");

    const receivedA: unknown[] = [];
    const receivedB: unknown[] = [];
    const unsubscribeA = session.onRecordEvent((payload) => receivedA.push(payload));
    session.onRecordEvent((payload) => receivedB.push(payload));

    transport.deliverEvent(fakeRecordEvent(42, 7, "sensor.example", 1));
    for (let i = 0; i < 10; i++) await Promise.resolve();

    expect(receivedA).toEqual([{ sourceKey: 7, sequence: 42, schemaId: "sensor.example", schemaVersion: 1 }]);
    expect(receivedB).toEqual(receivedA);
    // STATUS-driven tracking is untouched by a RECORD event passing through the same loop.
    expect(session.state).toBe("READY");
    expect(session.lastBootId).toBe(1n);

    unsubscribeA();
    transport.deliverEvent(fakeRecordEvent(43, 7, "sensor.example", 1));
    for (let i = 0; i < 10; i++) await Promise.resolve();
    expect(receivedA).toHaveLength(1); // unsubscribed, no second entry
    expect(receivedB).toHaveLength(2);
  });
});

describe("CoreSession — explicit reconciliation actions", () => {
  it("importLiveState() returns the live Config only after connect()", async () => {
    const { session, responder } = makeSession();
    expect(() => session.importLiveState()).toThrow();
    await runToCompletion(() => session.connect(), responder);
    expect(session.importLiveState().generation).toBe(1);
  });

  it("keepProject() is a safe no-op", async () => {
    const { session, responder } = makeSession();
    await runToCompletion(() => session.connect(), responder);
    expect(() => session.keepProject()).not.toThrow();
  });

  it("reconcile() throws, honestly, instead of pretending to merge", () => {
    const { session } = makeSession();
    expect(() => session.reconcile()).toThrow(/S073/);
  });
});

describe("CoreSession — sync classification integration", () => {
  it("wires the live Config hash and the project's own canonical hash into the classifier correctly (PROJECT_DIRTY case)", async () => {
    const { session, responder } = makeSession(1, 42);
    await runToCompletion(() => session.connect(), responder);

    const pid = projectId("dddddddd-0000-4000-8000-000000000001");
    if (!pid.ok) throw new Error("bad fixture id");
    const depId = deploymentId("dddddddd-0000-4000-8000-000000000002");
    if (!depId.ok) throw new Error("bad fixture id");

    const base: ProjectV1 = createEmptyProject(pid.value, "Test project");
    // The live Config hash the fixture Core reports (fakeConfig(42) via makeSession).
    const liveHash = bytesToHex(session.lastKnownSnapshot.config!.sha256);
    // The deployment's sourceProjectHash is deliberately a value distinct
    // from this project's own canonical hash (computing an exact
    // self-referential match is not meaningful — canonicalProjectHash
    // includes deploymentRecords, so a record can never literally record its
    // own post-append hash). What matters here is proving CoreSession reads
    // the *live* Config hash correctly (configHash matches -> not
    // DEVICE_CHANGED) while the project hash mismatch correctly drives
    // PROJECT_DIRTY, not IN_SYNC.
    const project: ProjectV1 = {
      ...base,
      deploymentRecords: [
        {
          deploymentId: depId.value,
          target: session.binding.bindingId,
          timestamp: "2026-01-01T00:00:00.000Z",
          sourceProjectHash: "some-earlier-project-hash",
          configHash: liveHash,
          outcome: "success",
        },
      ],
    };
    expect(canonicalProjectHash(project)).not.toBe("some-earlier-project-hash");

    const relationship = session.syncWithProject(project, true);
    expect(relationship).toBe("PROJECT_DIRTY");
    expect(session.syncRelationship).toBe("PROJECT_DIRTY");
  });
});

describe("CoreSession — listDeviceProfiles()", () => {
  it("reads the full paginated Device Profile list on demand, not as part of connect()", async () => {
    const { session, responder, transport } = makeSession();
    await runToCompletion(() => session.connect(), responder);
    expect(transport.sent.some((b) => decodeRequest(b).operation === Operation.LIST_DEVICE_PROFILES)).toBe(false);

    const profiles: DeviceProfileSummary[] = [{ profileId: "greenhouse-sensor", version: 1, hash: new Uint8Array(4).fill(7) }];
    const profileResponder = new FakeCoreResponder(transport, {
      [Operation.LIST_DEVICE_PROFILES]: () => encodeListDeviceProfilesResponse({ profiles, nextCursor: 0 }),
    });

    let result: readonly DeviceProfileSummary[] | undefined;
    await runToCompletion(async () => {
      result = await session.listDeviceProfiles();
    }, profileResponder);

    expect(result).toEqual(profiles);
  });
});

describe("CoreSession — discovery", () => {
  it("listDiscoveryCandidates() reads the full candidate list on demand", async () => {
    const { session, responder, transport } = makeSession();
    await runToCompletion(() => session.connect(), responder);

    const candidates: DiscoveryCandidate[] = [{ id: 1, portId: 2, generation: 3, confidence: 80, suggestedTypeId: "driver-a" }];
    const discoveryResponder = new FakeCoreResponder(transport, {
      [Operation.LIST_DISCOVERY]: () => encodeListDiscoveryResponse({ candidates, nextCursor: 0 }),
    });
    let result: readonly DiscoveryCandidate[] | undefined;
    await runToCompletion(async () => {
      result = await session.listDiscoveryCandidates();
    }, discoveryResponder);

    expect(result).toEqual(candidates);
  });

  it("acceptDiscovery() sends the request and returns the firmware-assigned key", async () => {
    const { session, responder, transport } = makeSession();
    await runToCompletion(() => session.connect(), responder);

    const acceptResponder = new FakeCoreResponder(transport, {
      [Operation.ACCEPT_DISCOVERY]: () => encodeAcceptDiscoveryResponse({ generation: 4, moduleKey: 7 }),
    });
    let result: { generation: number; moduleKey: number } | undefined;
    await runToCompletion(async () => {
      result = await session.acceptDiscovery({ candidateId: 1, key: 7, generation: 3 });
    }, acceptResponder);

    expect(result).toEqual({ generation: 4, moduleKey: 7 });
  });
});

function fixtureDraft(): DeviceProfileDraft {
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

/**
 * `installProfile()` interleaves real wire round trips with a real
 * `crypto.subtle.digest()` call (S063's post-install hash verification,
 * deliberately not mocked here) — `runToCompletion`'s pure-microtask drain
 * loop can exhaust its iteration budget before that digest's callback ever
 * gets a turn (macrotask starvation), leaving the final `LIST_DEVICE_PROFILES`
 * request sent-but-undrained. Real `setTimeout` ticks avoid that.
 */
async function runToCompletionWithRealTimers(work: () => Promise<void>, responder: FakeCoreResponder): Promise<void> {
  const done = work().catch((e: unknown) => {
    throw e;
  });
  let settled = false;
  void done.then(
    () => (settled = true),
    () => (settled = true),
  );
  for (let i = 0; i < 200 && !settled; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    responder.drain();
  }
  await done;
}

describe("CoreSession — device profile install/remove", () => {
  it("installProfile() validates, installs, and verifies the post-install hash", async () => {
    const { session, responder, transport } = makeSession();
    await runToCompletion(() => session.connect(), responder);

    const draft = fixtureDraft();
    const expectedHash = await sha256(encodeDeviceProfileCbor(draft));
    const summary: DeviceProfileSummary = { profileId: draft.profileId, version: draft.version, hash: expectedHash };
    const installResponder = new FakeCoreResponder(transport, {
      [Operation.VALIDATE_DEVICE_PROFILE]: () => encodeValidateDeviceProfileResponse({ valid: 1 }),
      [Operation.INSTALL_DEVICE_PROFILE]: () => encodeInstallDeviceProfileResponse(),
      [Operation.LIST_DEVICE_PROFILES]: () => encodeListDeviceProfilesResponse({ profiles: [summary], nextCursor: 0 }),
    });

    let result: Awaited<ReturnType<CoreSession["installProfile"]>> | undefined;
    await runToCompletionWithRealTimers(async () => {
      result = await session.installProfile(draft);
    }, installResponder);

    expect(result?.ok).toBe(true);
    if (result?.ok) expect(result.value.summary).toEqual(summary);
  });

  it("removeProfile() refuses locally-referenced profiles without a round trip", async () => {
    const { session, responder } = makeSession();
    await runToCompletion(() => session.connect(), responder);

    const result = await session.removeProfile("sensor.example", 1, { isReferencedLocally: true });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("device-profile-install.profile_in_use");
  });

  it("removeProfile() sends REMOVE_DEVICE_PROFILE when not locally referenced", async () => {
    const { session, responder, transport } = makeSession();
    await runToCompletion(() => session.connect(), responder);

    const removeResponder = new FakeCoreResponder(transport, {
      [Operation.REMOVE_DEVICE_PROFILE]: () => encodeRemoveDeviceProfileResponse(),
    });
    let result: Awaited<ReturnType<CoreSession["removeProfile"]>> | undefined;
    await runToCompletion(async () => {
      result = await session.removeProfile("sensor.example", 1, { isReferencedLocally: false });
    }, removeResponder);

    expect(result?.ok).toBe(true);
  });
});

describe("CoreSession — deployConfig()", () => {
  it("compiles, validates, applies with CAS, and verifies read-back for an empty (no-op) graph pair", async () => {
    const { session, responder, transport } = makeSession();
    await runToCompletion(() => session.connect(), responder);

    const input = {
      physicalGraph: { layer: "physical-composition" as const, nodes: [], edges: [] },
      processingGraph: { layer: "device-processing" as const, nodes: [], edges: [] },
      mqtt: { enabled: false, host: "", port: 0, baseTopic: "", security: 0, credentialId: 0 },
      connectivity: 0,
      energy: { bleAvailability: 0, advertisingWindowMs: 0, advertisingPeriodMs: 0 },
    };
    const candidate = { version: 4 as const, modules: [], schedules: [], rules: [], mqtt: input.mqtt, connectivity: 0, energy: input.energy, blocks: [], edges: [] };
    const expectedHash = await sha256Config(encodeConfigCbor(candidate));
    const depId = deploymentId("dddddddd-0000-4000-8000-000000000009");
    if (!depId.ok) throw new Error("bad fixture id");

    const deployResponder = new FakeCoreResponder(transport, {
      [Operation.VALIDATE_CONFIG]: () => encodeValidateConfigResponse({ valid: true }),
      [Operation.APPLY_CONFIG]: () => encodeApplyConfigResponse({ changed: true, generation: 6, sha256: expectedHash }),
      [Operation.GET_CONFIG]: () => encodeGetConfigResponse({ generation: 6, sha256: expectedHash, configBytes: new Uint8Array([0]) }),
    });

    let result: Awaited<ReturnType<CoreSession["deployConfig"]>> | undefined;
    await runToCompletionWithRealTimers(async () => {
      result = await session.deployConfig(input, {
        expectedGeneration: 5,
        sourceProjectHash: "some-project-hash",
        target: session.binding.bindingId,
        deploymentId: depId.value,
        timestamp: "2026-01-01T00:00:00.000Z",
      });
    }, deployResponder);

    expect(result?.outcome).toBe("SUCCESS");
    expect(result?.record?.configGeneration).toBe(6);
  });
});
