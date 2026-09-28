/**
 * Round-trip tests for all 27 Protocol V1 operations. These vectors are
 * **self-authored, spec-conformant fixtures** derived from the S021
 * research note's field-by-field extraction of the firmware source — they
 * are NOT firmware-published golden vectors, because none exist (the
 * firmware's own protocol tests only prove internal encode determinism, not
 * fixed reference bytes; see the S021 task's "Implementazione" note for the
 * full explanation of this gap). Every test here proves this codec is
 * internally consistent with the documented wire shape, not that it matches
 * a byte sequence the firmware itself published.
 */
import { describe, expect, it } from "vitest";
import * as ops from "../operations/index.js";

describe("GET_CATALOG", () => {
  it("round-trips request and response", () => {
    expect(ops.decodeGetCatalogRequest(ops.encodeGetCatalogRequest({ cursor: 5, limit: 16 }))).toEqual({
      cursor: 5,
      limit: 16,
    });
    const response: ops.GetCatalogResponse = {
      protocolVersion: 1,
      configVersion: 5,
      fingerprint: new Uint8Array(32).fill(7),
      drivers: [{ typeId: "declarative-device", commandCount: 3 }],
      nextCursor: 0,
      driverCount: 1,
    };
    expect(ops.decodeGetCatalogResponse(ops.encodeGetCatalogResponse(response))).toEqual(response);
  });

  it("defaults cursor/limit when the request omits them", () => {
    expect(ops.decodeGetCatalogRequest(ops.encodeGetCatalogRequest({}))).toEqual({ cursor: 0, limit: 8 });
  });
});

describe("GET_STATUS", () => {
  it("round-trips an empty request and a full response", () => {
    expect(() => ops.decodeGetStatusRequest(ops.encodeGetStatusRequest())).not.toThrow();
    const response: ops.GetStatusResponse = {
      state: 1,
      mode: 2,
      imageState: 0,
      activeSlot: 0,
      imageConfirmed: true,
      version: "1.2.3",
      portCount: 2,
      lastResetCause: 0,
      healthState: 1,
      modules: [
        { key: 10, id: 1, portId: 0, state: 1, endpointKind: 2, endpointValueRaw: 64, typeId: "ina219" },
      ],
      deviceId: new Uint8Array([0x90, 0x70, 0x69, 0xad]),
      deviceName: "core-lab",
      chainPeers: [
        {
          nodeId: 0xe1c52c,
          mac: new Uint8Array([0x90, 0x70, 0x69, 0xe1, 0xc5, 0x2c]),
          flags: 0x81,
          local: true,
          version: "0.1.0+0",
        },
        {
          nodeId: 0xe18030,
          mac: new Uint8Array([0x90, 0x70, 0x69, 0xe1, 0x80, 0x30]),
          flags: 0,
          local: false,
          version: "0.1.0+1",
        },
      ],
      nfcTags: [
        {
          portId: 1,
          typeId: "sensor",
          uid: new Uint8Array([0x04, 0x12, 0x34, 0x56]),
          nodeId: 0xe1c52c,
          local: true,
          moduleTypeId: 2001,
          vendorId: 1,
          fallbackClass: 3,
          registryId: 1,
        },
      ],
    };
    expect(ops.decodeGetStatusResponse(ops.encodeGetStatusResponse(response))).toEqual(response);
  });
});

describe("GET_CONFIG / VALIDATE_CONFIG / APPLY_CONFIG", () => {
  it("round-trips GET_CONFIG", () => {
    expect(() => ops.decodeGetConfigRequest(ops.encodeGetConfigRequest())).not.toThrow();
    const response: ops.GetConfigResponse = {
      generation: 3,
      sha256: new Uint8Array(32).fill(9),
      configBytes: new Uint8Array([0xa0]),
    };
    expect(ops.decodeGetConfigResponse(ops.encodeGetConfigResponse(response))).toEqual(response);
  });

  it("round-trips VALIDATE_CONFIG for both valid and invalid outcomes", () => {
    const request: ops.ValidateConfigRequest = { configBytes: new Uint8Array([0xa0]) };
    expect(ops.decodeValidateConfigRequest(ops.encodeValidateConfigRequest(request))).toEqual(request);

    expect(ops.decodeValidateConfigResponse(ops.encodeValidateConfigResponse({ valid: true }))).toEqual({ valid: true });

    const invalid: ops.ValidateConfigResponse = { valid: false, failureField: 2, failureIndex: 0, failureReason: 5 };
    expect(ops.decodeValidateConfigResponse(ops.encodeValidateConfigResponse(invalid))).toEqual(invalid);
  });

  it("round-trips APPLY_CONFIG", () => {
    const request: ops.ApplyConfigRequest = { expectedGeneration: 2, configBytes: new Uint8Array([0xa0]) };
    expect(ops.decodeApplyConfigRequest(ops.encodeApplyConfigRequest(request))).toEqual(request);

    const response: ops.ApplyConfigResponse = { changed: true, generation: 3, sha256: new Uint8Array(32).fill(1) };
    expect(ops.decodeApplyConfigResponse(ops.encodeApplyConfigResponse(response))).toEqual(response);
  });
});

describe("GET_TOPOLOGY", () => {
  it("round-trips a nested flow/bay/rail structure", () => {
    expect(ops.decodeGetTopologyRequest(ops.encodeGetTopologyRequest({}))).toEqual({ cursor: 0, limit: 2 });
    const response: ops.GetTopologyResponse = {
      flows: [
        {
          id: 1,
          portId: 0,
          direction: 1,
          signalCount: 5,
          capabilities: 0x19,
          bays: [
            {
              id: 1,
              ordinal: 0,
              railMask: 0b11,
              moduleKey: 42,
              admission: 1,
              rails: [{ id: 1, assurance: 0, maxTotalMicroamps: 500000 }],
            },
          ],
        },
      ],
      nextCursor: 0,
    };
    expect(ops.decodeGetTopologyResponse(ops.encodeGetTopologyResponse(response))).toEqual(response);
  });

  it("decodes a flow that omits port capabilities (older Core)", () => {
    const response: ops.GetTopologyResponse = {
      flows: [
        {
          id: 1,
          portId: 0,
          direction: 1,
          signalCount: 5,
          bays: [],
        },
      ],
      nextCursor: 0,
    };
    expect(ops.decodeGetTopologyResponse(ops.encodeGetTopologyResponse(response))).toEqual(response);
    expect(ops.decodeGetTopologyResponse(ops.encodeGetTopologyResponse(response)).flows[0]?.capabilities).toBeUndefined();
  });
});

describe("GET_RESOURCES", () => {
  it("round-trips six distinct resource pools", () => {
    expect(() => ops.decodeGetResourcesRequest(ops.encodeGetResourcesRequest())).not.toThrow();
    const pool: ops.ResourcePool = { capacity: 100, used: 40, peak: 60 };
    const response: ops.GetResourcesResponse = {
      featureSetHash: new Uint8Array(32).fill(2),
      modules: pool,
      rules: pool,
      blocks: pool,
      profiles: pool,
      records: pool,
      workspace: pool,
      allocationFailures: 0,
      flashSlotBytes: 1048576,
      flashImageBudgetBytes: 786432,
      flashHeadroomBytes: 262144,
      staticRamBudgetBytes: 65536,
    };
    expect(ops.decodeGetResourcesResponse(ops.encodeGetResourcesResponse(response))).toEqual(response);
  });
});

describe("GET_CAPABILITIES", () => {
  it("round-trips", () => {
    expect(() => ops.decodeGetCapabilitiesRequest(ops.encodeGetCapabilitiesRequest())).not.toThrow();
    const response: ops.GetCapabilitiesResponse = {
      resourceProfile: 1,
      buildCapabilities: 0xff,
      coreVariant: "core-v2",
      maxProtocolPayload: 2048,
      maxInflightRequests: 8,
      replayWindowMs: 30000,
      maxModules: 16,
      maxPrincipals: 4,
    };
    expect(ops.decodeGetCapabilitiesResponse(ops.encodeGetCapabilitiesResponse(response))).toEqual(response);
  });
});

describe("LIST_DISCOVERY / SCAN_DISCOVERY / ACCEPT_DISCOVERY", () => {
  it("round-trips LIST_DISCOVERY", () => {
    expect(ops.decodeListDiscoveryRequest(ops.encodeListDiscoveryRequest({}))).toEqual({ cursor: 0, limit: 4 });
    const response: ops.ListDiscoveryResponse = {
      candidates: [{ id: 1, portId: 0, generation: 1, confidence: 2, suggestedTypeId: "ina219" }],
      nextCursor: 0,
    };
    expect(ops.decodeListDiscoveryResponse(ops.encodeListDiscoveryResponse(response))).toEqual(response);
  });

  it("round-trips SCAN_DISCOVERY (async job)", () => {
    const request: ops.ScanDiscoveryRequest = { portId: 0, allowStateChanging: true };
    expect(ops.decodeScanDiscoveryRequest(ops.encodeScanDiscoveryRequest(request))).toEqual(request);
    expect(ops.decodeScanDiscoveryResponse(ops.encodeScanDiscoveryResponse({ jobId: 9 }))).toEqual({ jobId: 9 });
  });

  it("round-trips ACCEPT_DISCOVERY", () => {
    const request: ops.AcceptDiscoveryRequest = { candidateId: 1, key: 42, generation: 3 };
    expect(ops.decodeAcceptDiscoveryRequest(ops.encodeAcceptDiscoveryRequest(request))).toEqual(request);
    const response: ops.AcceptDiscoveryResponse = { generation: 4, moduleKey: 42 };
    expect(ops.decodeAcceptDiscoveryResponse(ops.encodeAcceptDiscoveryResponse(response))).toEqual(response);
  });
});

describe("MODULE_COMMAND", () => {
  it("round-trips request and empty response", () => {
    const request: ops.ModuleCommandRequest = { key: 42, commandId: 1 };
    expect(ops.decodeModuleCommandRequest(ops.encodeModuleCommandRequest(request))).toEqual(request);
    expect(() => ops.decodeModuleCommandResponse(ops.encodeModuleCommandResponse())).not.toThrow();
  });
});

describe("connectivity operations", () => {
  it("round-trips GET_CONNECTIVITY_STATUS with signed fields", () => {
    expect(() => ops.decodeGetConnectivityStatusRequest(ops.encodeGetConnectivityStatusRequest())).not.toThrow();
    const response: ops.GetConnectivityStatusResponse = {
      policy: 1,
      activeServices: 0b101,
      leasedServices: 0b001,
      leaseExpiresAtMs: -1n, // signed field can legitimately be -1 (no lease)
      lastError: -22n, // raw -EINVAL
    };
    expect(ops.decodeGetConnectivityStatusResponse(ops.encodeGetConnectivityStatusResponse(response))).toEqual(response);
  });

  it("round-trips ACQUIRE/RELEASE_CONNECTIVITY_LEASE", () => {
    const request: ops.AcquireConnectivityLeaseRequest = { services: 0b11, durationMs: 60000 };
    expect(ops.decodeAcquireConnectivityLeaseRequest(ops.encodeAcquireConnectivityLeaseRequest(request))).toEqual(request);
    expect(() => ops.decodeReleaseConnectivityLeaseRequest(ops.encodeReleaseConnectivityLeaseRequest())).not.toThrow();
    expect(() => ops.decodeConnectivityLeaseResponse(ops.encodeConnectivityLeaseResponse())).not.toThrow();
  });

  it("round-trips OPEN_NETWORK_MAINTENANCE (a handover ack, not a job id)", () => {
    expect(() => ops.decodeOpenNetworkMaintenanceRequest(ops.encodeOpenNetworkMaintenanceRequest())).not.toThrow();
    const response: ops.OpenNetworkMaintenanceResponse = { address: "192.0.2.1", port: 4433, leaseExpiresAtMs: 12345n, reachedStateRaw: 2 };
    expect(ops.decodeOpenNetworkMaintenanceResponse(ops.encodeOpenNetworkMaintenanceResponse(response))).toEqual(response);
  });
});

describe("FACTORY_RESET", () => {
  it("round-trips request and empty response", () => {
    const request: ops.FactoryResetRequest = { scope: 1 };
    expect(ops.decodeFactoryResetRequest(ops.encodeFactoryResetRequest(request))).toEqual(request);
    expect(() => ops.decodeFactoryResetResponse(ops.encodeFactoryResetResponse())).not.toThrow();
  });
});

describe("GET_AUDIT_LOG", () => {
  it("round-trips, including signed internalResult/uptimeMs", () => {
    expect(ops.decodeGetAuditLogRequest(ops.encodeGetAuditLogRequest({}))).toEqual({ cursor: 1, limit: 8 });
    const response: ops.GetAuditLogResponse = {
      entries: [
        { sequence: 1, principalId: 0, operationId: 2, internalResult: -13n, uptimeMs: 123456789012345n },
      ],
      nextCursor: 0,
    };
    expect(ops.decodeGetAuditLogResponse(ops.encodeGetAuditLogResponse(response))).toEqual(response);
  });
});

describe("GET_JOB_STATUS", () => {
  it("round-trips, with no result payload by design (see the type's own doc comment)", () => {
    const request: ops.GetJobStatusRequest = { jobId: 5 };
    expect(ops.decodeGetJobStatusRequest(ops.encodeGetJobStatusRequest(request))).toEqual(request);
    const response: ops.GetJobStatusResponse = {
      jobId: 5,
      state: ops.JobState.COMPLETED,
      progress: 100,
      protocolStatus: 0,
      operation: 5, // SCAN_DISCOVERY
    };
    expect(ops.decodeGetJobStatusResponse(ops.encodeGetJobStatusResponse(response))).toEqual(response);
  });
});

describe("device profile operations", () => {
  it("round-trips LIST_DEVICE_PROFILES", () => {
    expect(ops.decodeListDeviceProfilesRequest(ops.encodeListDeviceProfilesRequest({}))).toEqual({ cursor: 0, limit: 8 });
    const response: ops.ListDeviceProfilesResponse = {
      profiles: [{ profileId: "bme280", version: 1, hash: new Uint8Array(32).fill(3) }],
      nextCursor: 0,
    };
    expect(ops.decodeListDeviceProfilesResponse(ops.encodeListDeviceProfilesResponse(response))).toEqual(response);
  });

  it("round-trips GET_DEVICE_PROFILE", () => {
    const request: ops.GetDeviceProfileRequest = { index: 0 };
    expect(ops.decodeGetDeviceProfileRequest(ops.encodeGetDeviceProfileRequest(request))).toEqual(request);
    const response: ops.GetDeviceProfileResponse = {
      profileId: "bme280",
      version: 1,
      hash: new Uint8Array(32).fill(3),
      transport: 0,
      requiredCapabilities: 0,
    };
    expect(ops.decodeGetDeviceProfileResponse(ops.encodeGetDeviceProfileResponse(response))).toEqual(response);
  });

  it("round-trips VALIDATE_DEVICE_PROFILE — valid field is a uint, not a bool (the stub's real wire shape)", () => {
    const request: ops.ValidateDeviceProfileRequest = { profileCbor: new Uint8Array([0xa0]) };
    expect(ops.decodeValidateDeviceProfileRequest(ops.encodeValidateDeviceProfileRequest(request))).toEqual(request);
    expect(ops.decodeValidateDeviceProfileResponse(ops.encodeValidateDeviceProfileResponse({ valid: 1 }))).toEqual({
      valid: 1,
    });
  });

  it("round-trips INSTALL_DEVICE_PROFILE", () => {
    const request: ops.InstallDeviceProfileRequest = { profileCbor: new Uint8Array([0xa0]) };
    expect(ops.decodeInstallDeviceProfileRequest(ops.encodeInstallDeviceProfileRequest(request))).toEqual(request);
    expect(() => ops.decodeInstallDeviceProfileResponse(ops.encodeInstallDeviceProfileResponse())).not.toThrow();
  });

  it("round-trips REMOVE_DEVICE_PROFILE", () => {
    const request: ops.RemoveDeviceProfileRequest = { idBytes: new Uint8Array([1, 2, 3]), version: 1 };
    expect(ops.decodeRemoveDeviceProfileRequest(ops.encodeRemoveDeviceProfileRequest(request))).toEqual(request);
    expect(() => ops.decodeRemoveDeviceProfileResponse(ops.encodeRemoveDeviceProfileResponse())).not.toThrow();
  });
});

describe("update operations", () => {
  it("round-trips GET_UPDATE_STATUS", () => {
    expect(() => ops.decodeGetUpdateStatusRequest(ops.encodeGetUpdateStatusRequest())).not.toThrow();
    const response: ops.GetUpdateStatusResponse = {
      state: 0,
      transport: 1,
      timeoutRemainingMs: 0,
      activeSlot: 0,
      imageConfirmed: true,
    };
    expect(ops.decodeGetUpdateStatusResponse(ops.encodeGetUpdateStatusResponse(response))).toEqual(response);
  });

  it("round-trips OPEN_WIFI_UPDATE (a handover ack, not a job id), defaulting timeoutMs", () => {
    expect(ops.decodeOpenWifiUpdateRequest(ops.encodeOpenWifiUpdateRequest({}))).toEqual({ timeoutMs: 60000 });
    const response: ops.OpenWifiUpdateResponse = { address: "192.0.2.2", port: 8443, leaseExpiresAtMs: 99999n, reachedStateRaw: 1 };
    expect(ops.decodeOpenWifiUpdateResponse(ops.encodeOpenWifiUpdateResponse(response))).toEqual(response);
  });
});

describe("GET_FEATURES", () => {
  it("round-trips", () => {
    expect(() => ops.decodeGetFeaturesRequest(ops.encodeGetFeaturesRequest())).not.toThrow();
    const response: ops.GetFeaturesResponse = {
      featureSetHash: new Uint8Array(32).fill(4),
      packs: [{ id: "modbus-tcp", version: "1.0.0", requiredHwCaps: 0, moduleTypeCount: 3 }],
    };
    expect(ops.decodeGetFeaturesResponse(ops.encodeGetFeaturesResponse(response))).toEqual(response);
  });
});

describe("BLE OTA (ops 28-31)", () => {
  it("round-trips OPEN_BLE_UPDATE — session id, not a job id", () => {
    const request: ops.OpenBleUpdateRequest = { imageSize: 65536, imageSha256: new Uint8Array(32).fill(7), version: "2.0.0" };
    expect(ops.decodeOpenBleUpdateRequest(ops.encodeOpenBleUpdateRequest(request))).toEqual(request);
    const response: ops.OpenBleUpdateResponse = { sessionId: 3 };
    expect(ops.decodeOpenBleUpdateResponse(ops.encodeOpenBleUpdateResponse(response))).toEqual(response);
  });

  it("round-trips WRITE_BLE_UPDATE with an explicit byte offset", () => {
    const request: ops.WriteBleUpdateRequest = { sessionId: 3, offset: 4096, bytes: new Uint8Array([1, 2, 3]) };
    expect(ops.decodeWriteBleUpdateRequest(ops.encodeWriteBleUpdateRequest(request))).toEqual(request);
    expect(() => ops.decodeBleUpdateEmptyResponse(ops.encodeBleUpdateEmptyResponse())).not.toThrow();
  });

  it("round-trips FINISH_BLE_UPDATE and CANCEL_BLE_UPDATE — both just {sessionId}", () => {
    const request: ops.BleUpdateSessionRequest = { sessionId: 3 };
    expect(ops.decodeBleUpdateSessionRequest(ops.encodeBleUpdateSessionRequest(request))).toEqual(request);
  });
});
