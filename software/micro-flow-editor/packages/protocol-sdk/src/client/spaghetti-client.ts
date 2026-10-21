import { decodeOne } from "../cbor.js";
import {
  encodeMap,
  bytesField,
  u32Field,
  requireMap,
  requireBytes,
} from "../fields.js";
import { encodeConfigChunk } from "../operations/config.js";
import {
  encodeNfcPageRequest,
  decodeNfcPageResponse,
  type NfcPageRequest,
} from "../operations/nfc.js";
import {
  decodeEvent,
  decodeResponse,
  encodeRequest,
  EventType,
  Operation,
  ProtocolStatus,
} from "../envelope.js";
import { decodeStatusEventPayload } from "../events.js";
import { decodeConfigApplyFailure, SpaghettiClientError } from "./errors.js";
import type { ProtocolTransport } from "./transport.js";
import {
  encodeApplyPhysicalRequest,
  encodeIdentifyBackboneRequest,
  decodeApplyPhysicalResponse,
  type ApplyPhysicalRequest,
} from "../operations/physical.js";

import {
  encodeGetCatalogRequest,
  decodeGetCatalogResponse,
  type GetCatalogRequest,
  type GetCatalogResponse,
  type CatalogDriverEntry,
  encodeGetStatusRequest,
  decodeGetStatusResponse,
  type GetStatusResponse,
  encodeApplyConfigRequest,
  decodeApplyConfigResponse,
  type ApplyConfigRequest,
  type ApplyConfigResponse,
  encodeGetConfigRequest,
  decodeGetConfigResponse,
  type GetConfigResponse,
  encodeValidateConfigRequest,
  decodeValidateConfigResponse,
  type ValidateConfigRequest,
  type ValidateConfigResponse,
  encodeListDiscoveryRequest,
  decodeListDiscoveryResponse,
  type ListDiscoveryRequest,
  type ListDiscoveryResponse,
  type DiscoveryCandidate,
  encodeScanDiscoveryRequest,
  decodeScanDiscoveryResponse,
  type ScanDiscoveryRequest,
  type ScanDiscoveryResponse,
  encodeAcceptDiscoveryRequest,
  decodeAcceptDiscoveryResponse,
  type AcceptDiscoveryRequest,
  type AcceptDiscoveryResponse,
  encodeModuleCommandRequest,
  decodeModuleCommandResponse,
  type ModuleCommandRequest,
  encodeGetUpdateStatusRequest,
  decodeGetUpdateStatusResponse,
  type GetUpdateStatusResponse,
  encodeOpenWifiUpdateRequest,
  decodeOpenWifiUpdateResponse,
  type OpenWifiUpdateRequest,
  type OpenWifiUpdateResponse,
  encodeGetCapabilitiesRequest,
  decodeGetCapabilitiesResponse,
  type GetCapabilitiesResponse,
  encodeGetConnectivityStatusRequest,
  decodeGetConnectivityStatusResponse,
  type GetConnectivityStatusResponse,
  encodeAcquireConnectivityLeaseRequest,
  decodeConnectivityLeaseResponse,
  type AcquireConnectivityLeaseRequest,
  encodeReleaseConnectivityLeaseRequest,
  encodeOpenNetworkMaintenanceRequest,
  decodeOpenNetworkMaintenanceResponse,
  type OpenNetworkMaintenanceResponse,
  encodeFactoryResetRequest,
  decodeFactoryResetResponse,
  type FactoryResetRequest,
  encodeGetAuditLogRequest,
  decodeGetAuditLogResponse,
  type GetAuditLogRequest,
  type GetAuditLogResponse,
  type AuditLogEntry,
  encodeGetJobStatusRequest,
  decodeGetJobStatusResponse,
  type GetJobStatusRequest,
  type GetJobStatusResponse,
  encodeGetTopologyRequest,
  decodeGetTopologyResponse,
  type GetTopologyRequest,
  type GetTopologyResponse,
  type TopologyFlow,
  encodeGetResourcesRequest,
  decodeGetResourcesResponse,
  type GetResourcesResponse,
  encodeListDeviceProfilesRequest,
  decodeListDeviceProfilesResponse,
  type ListDeviceProfilesRequest,
  type ListDeviceProfilesResponse,
  type DeviceProfileSummary,
  encodeGetDeviceProfileRequest,
  decodeGetDeviceProfileResponse,
  type GetDeviceProfileRequest,
  type GetDeviceProfileResponse,
  encodeValidateDeviceProfileRequest,
  decodeValidateDeviceProfileResponse,
  type ValidateDeviceProfileRequest,
  type ValidateDeviceProfileResponse,
  encodeInstallDeviceProfileRequest,
  decodeInstallDeviceProfileResponse,
  type InstallDeviceProfileRequest,
  encodeRemoveDeviceProfileRequest,
  decodeRemoveDeviceProfileResponse,
  type RemoveDeviceProfileRequest,
  encodeGetFeaturesRequest,
  decodeGetFeaturesResponse,
  type GetFeaturesResponse,
  encodeOpenBleUpdateRequest,
  decodeOpenBleUpdateResponse,
  type OpenBleUpdateRequest,
  type OpenBleUpdateResponse,
  encodeWriteBleUpdateRequest,
  decodeBleUpdateEmptyResponse,
  type WriteBleUpdateRequest,
  encodeBleUpdateSessionRequest,
  type BleUpdateSessionRequest,
} from "../operations/index.js";

export type SpaghettiClientOptions = {
  /** Overall deadline for one logical call, covering all its retries — not per-attempt. Default 5000ms. */
  readonly defaultTimeoutMs?: number;
  /** How many times to retry (reusing the same correlation ID) after an attempt times out. Default 2. */
  readonly maxRetries?: number;
  readonly retryDelayMs?: number;
  /** Max wait per individual attempt, capped by whatever's left of `defaultTimeoutMs` — so multiple attempts actually fit inside the overall deadline instead of the first one consuming all of it. Default 2000ms. */
  readonly attemptTimeoutMs?: number;
};

type PendingEntry = {
  readonly operation: Operation;
  resolve: (payload: Uint8Array) => void;
  reject: (error: SpaghettiClientError) => void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Transport-independent client covering every Protocol V1 operation (S021).
 * Retries reuse the same correlation ID on every attempt of one logical call
 * — never a fresh one — so a retried mutation lands inside the firmware's
 * replay window and is recognized as the same request instead of being
 * re-executed (S022 "retry non duplica mutazioni"). A response carrying a
 * non-OK status is never retried automatically; it surfaces immediately as a
 * `PROTOCOL_ERROR` (S022 "un correlation conflict è visibile al
 * chiamante" — e.g. `APPLY_CONFIG`'s `CONFLICT` on a stale generation).
 */
export class SpaghettiClient {
  private readonly pending = new Map<number, PendingEntry>();
  private nextCorrelationId = 0x10000 + Math.floor(Math.random() * 0x0fff0000);
  private lastKnownBootId: bigint | null = null;
  private readonly unsubscribeResponse: () => void;
  private readonly unsubscribeEvent: () => void;

  constructor(
    private readonly transport: ProtocolTransport,
    private readonly options: SpaghettiClientOptions = {},
  ) {
    this.unsubscribeResponse = transport.onResponse((bytes) =>
      this.handleResponse(bytes),
    );
    this.unsubscribeEvent = transport.onEvent((bytes) => this.handleEvent(bytes));
  }

  /** Stops listening and rejects every still-pending call as cancelled. Call when done with this client instance. */
  dispose(): void {
    this.unsubscribeResponse();
    this.unsubscribeEvent();
    for (const [correlationId, entry] of this.pending) {
      entry.reject(
        new SpaghettiClientError({
          code: "CANCELLED",
          operation: entry.operation,
          correlationId,
        }),
      );
    }
    this.pending.clear();
  }

  private allocateCorrelationId(): number {
    for (let i = 0; i < 0xffffffff; i++) {
      this.nextCorrelationId =
        this.nextCorrelationId === 0xffffffff ? 1 : this.nextCorrelationId + 1;
      if (!this.pending.has(this.nextCorrelationId)) return this.nextCorrelationId;
    }
    throw new SpaghettiClientError({ code: "CORRELATION_CONFLICT" });
  }

  private handleResponse(bytes: Uint8Array): void {
    let response;
    try {
      response = decodeResponse(bytes);
    } catch {
      // Malformed/oversized/extra-key envelope we can't even correlate —
      // safely dropped. The caller's request eventually times out rather
      // than the transport crashing on unrecoverable garbage.
      return;
    }
    const entry = this.pending.get(response.correlationId);
    if (!entry) return; // stale (already timed out/cancelled) or not ours
    this.pending.delete(response.correlationId);
    if (response.status === ProtocolStatus.OK) {
      entry.resolve(response.payload);
    } else {
      entry.reject(
        new SpaghettiClientError({
          code: "PROTOCOL_ERROR",
          operation: entry.operation,
          correlationId: response.correlationId,
          status: response.status,
          configFailure:
            entry.operation === Operation.APPLY_CONFIG
              ? decodeConfigApplyFailure(response.payload)
              : undefined,
        }),
      );
    }
  }

  private handleEvent(bytes: Uint8Array): void {
    let event;
    try {
      event = decodeEvent(bytes);
    } catch {
      return;
    }
    if (event.type !== EventType.STATUS) return;
    let statusPayload;
    try {
      statusPayload = decodeStatusEventPayload(event.payload);
    } catch {
      return;
    }
    const rebooted =
      this.lastKnownBootId !== null && statusPayload.bootId !== this.lastKnownBootId;
    this.lastKnownBootId = statusPayload.bootId;
    if (!rebooted) return;
    // A changed boot ID invalidates the firmware's replay cache for every
    // in-flight request (REACT_FLOW_ARCHITECTURE.md: "Un boot ID cambiato
    // annulla request/job effimeri") — never let a pending retry blindly
    // resend across this boundary (S022 "reboot durante request/job
    // impedisce replay automatico pericoloso").
    for (const [correlationId, entry] of this.pending) {
      entry.reject(
        new SpaghettiClientError({
          code: "REBOOT_DURING_REQUEST",
          operation: entry.operation,
          correlationId,
        }),
      );
    }
    this.pending.clear();
  }

  private async request(
    operation: Operation,
    payload: Uint8Array,
    signal?: AbortSignal,
    overrides?: Pick<
      SpaghettiClientOptions,
      "defaultTimeoutMs" | "maxRetries" | "retryDelayMs" | "attemptTimeoutMs"
    >,
  ): Promise<Uint8Array> {
    if (signal?.aborted) {
      throw new SpaghettiClientError({ code: "CANCELLED", operation });
    }
    const correlationId = this.allocateCorrelationId();
    const timeoutMs =
      overrides?.defaultTimeoutMs ?? this.options.defaultTimeoutMs ?? 5000;
    const maxRetries = overrides?.maxRetries ?? this.options.maxRetries ?? 2;
    const retryDelayMs = overrides?.retryDelayMs ?? this.options.retryDelayMs ?? 200;
    const attemptTimeoutMs =
      overrides?.attemptTimeoutMs ?? this.options.attemptTimeoutMs ?? 2000;
    const deadline = Date.now() + timeoutMs;

    for (let attempt = 0; ; attempt++) {
      const responsePromise = new Promise<Uint8Array>((resolve, reject) => {
        this.pending.set(correlationId, { operation, resolve, reject });
      });
      // A disconnect may reject the reply while send is still pending.
      void responsePromise.catch(() => {});
      // A stalled transport write must obey the same deadline as the reply.
      // Do not retry an ambiguous write: it may still reach the device later.
      let sendTimer: ReturnType<typeof setTimeout> | undefined;
      let abortSend: (() => void) | undefined;
      try {
        await Promise.race([
          this.transport.send(encodeRequest({ correlationId, operation, payload })),
          new Promise<never>((_, reject) => {
            sendTimer = setTimeout(
              () =>
                reject(
                  new SpaghettiClientError({
                    code: "TIMEOUT",
                    operation,
                    correlationId,
                  }),
                ),
              Math.max(0, deadline - Date.now()),
            );
            if (signal) {
              abortSend = () =>
                reject(
                  new SpaghettiClientError({
                    code: "CANCELLED",
                    operation,
                    correlationId,
                  }),
                );
              signal.addEventListener("abort", abortSend, { once: true });
              if (signal.aborted) abortSend();
            }
          }),
        ]);
      } catch (error) {
        this.pending.delete(correlationId);
        throw error;
      } finally {
        clearTimeout(sendTimer);
        if (abortSend) signal?.removeEventListener("abort", abortSend);
      }

      if (signal?.aborted) {
        // Aborted during the `send` await, too late for the listener below
        // (registered after this point) to have caught it.
        this.pending.delete(correlationId);
        throw new SpaghettiClientError({ code: "CANCELLED", operation, correlationId });
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        this.pending.delete(correlationId);
        throw new SpaghettiClientError({ code: "TIMEOUT", operation, correlationId });
      }
      const waitMs = Math.min(attemptTimeoutMs, remaining);

      let onAbort: (() => void) | undefined;
      const timeoutMarker = Symbol("timeout");
      const racers: Array<Promise<Uint8Array | typeof timeoutMarker>> = [
        responsePromise,
        sleep(waitMs).then(() => timeoutMarker),
      ];
      if (signal) {
        racers.push(
          new Promise<never>((_resolve, reject) => {
            onAbort = () =>
              reject(
                new SpaghettiClientError({
                  code: "CANCELLED",
                  operation,
                  correlationId,
                }),
              );
            signal.addEventListener("abort", onAbort);
          }),
        );
      }

      let raced: Uint8Array | typeof timeoutMarker;
      try {
        raced = await Promise.race(racers);
      } finally {
        if (onAbort) signal!.removeEventListener("abort", onAbort);
        this.pending.delete(correlationId);
      }

      if (raced !== timeoutMarker) {
        return raced;
      }
      this.pending.delete(correlationId);
      if (attempt >= maxRetries || Date.now() >= deadline) {
        throw new SpaghettiClientError({ code: "TIMEOUT", operation, correlationId });
      }
      await sleep(retryDelayMs);
      // Loop again, reusing `correlationId` — the replay-safe retry.
    }
  }

  // --- catalog / status / topology / config -------------------------------

  async getCatalog(
    req: GetCatalogRequest = {},
    signal?: AbortSignal,
  ): Promise<GetCatalogResponse> {
    const bytes = await this.request(
      Operation.GET_CATALOG,
      encodeGetCatalogRequest(req),
      signal,
    );
    return decodeGetCatalogResponse(bytes);
  }

  /**
   * Reads every catalog page. If the fingerprint changes between pages (the
   * catalog was mutated mid-read, e.g. by a Capability Pack install), the
   * whole read restarts from cursor 0 instead of returning an inconsistent
   * mix of pages (S022 "catalog pagination che cambia fingerprint a metà
   * lettura riparte da zero").
   */
  async getFullCatalog(
    limit?: number,
    signal?: AbortSignal,
  ): Promise<GetCatalogResponse> {
    for (;;) {
      let cursor = 0;
      let fingerprint: Uint8Array | null = null;
      let drivers: CatalogDriverEntry[] = [];
      let lastPage: GetCatalogResponse | undefined;
      let restart = false;
      for (;;) {
        const page = await this.getCatalog({ cursor, limit }, signal);
        if (fingerprint === null) {
          fingerprint = page.fingerprint;
        } else if (!bytesEqual(fingerprint, page.fingerprint)) {
          restart = true;
          break;
        }
        drivers = drivers.concat(page.drivers);
        lastPage = page;
        if (page.nextCursor === 0) break;
        cursor = page.nextCursor;
      }
      if (restart) continue;
      return { ...lastPage!, drivers, nextCursor: 0 };
    }
  }

  async getStatus(signal?: AbortSignal): Promise<GetStatusResponse> {
    const bytes = await this.request(
      Operation.GET_STATUS,
      encodeGetStatusRequest(),
      signal,
    );
    return decodeGetStatusResponse(bytes);
  }

  async getTopology(
    req: GetTopologyRequest = {},
    signal?: AbortSignal,
  ): Promise<GetTopologyResponse> {
    const bytes = await this.request(
      Operation.GET_TOPOLOGY,
      encodeGetTopologyRequest(req),
      signal,
    );
    return decodeGetTopologyResponse(bytes);
  }

  async nfcPage(request: NfcPageRequest, signal?: AbortSignal): Promise<Uint8Array> {
    const bytes = await this.request(
      Operation.NFC_PAGE,
      encodeNfcPageRequest(request),
      signal,
      {
        defaultTimeoutMs: Math.max(this.options.defaultTimeoutMs ?? 5000, 8000),
        attemptTimeoutMs: Math.max(this.options.attemptTimeoutMs ?? 2000, 4000),
        maxRetries: 1,
      },
    );
    return decodeNfcPageResponse(bytes, request.page);
  }

  /** Starts a firmware-timed 10-second LED override, without changing Config. */
  async identifyBackbone(nodeId: number, signal?: AbortSignal): Promise<void> {
    await this.request(
      Operation.IDENTIFY_BACKBONE,
      encodeIdentifyBackboneRequest(nodeId),
      signal,
      { maxRetries: 0 },
    );
  }

  async applyPhysical(
    request: ApplyPhysicalRequest,
    signal?: AbortSignal,
  ): Promise<ApplyPhysicalRequest> {
    const bytes = await this.request(
      Operation.APPLY_PHYSICAL,
      encodeApplyPhysicalRequest(request),
      signal,
      {
        defaultTimeoutMs: Math.max(this.options.defaultTimeoutMs ?? 5000, 8000),
        attemptTimeoutMs: Math.max(this.options.attemptTimeoutMs ?? 2000, 4000),
        maxRetries: 1,
      },
    );
    const confirmed = decodeApplyPhysicalResponse(bytes);
    if (
      confirmed.nodeId !== request.nodeId ||
      confirmed.i2cSpeed !== request.i2cSpeed ||
      confirmed.modes.some((mode, i) => mode !== request.modes[i])
    ) {
      throw new Error(
        "Physical configuration acknowledgment does not match the selected Backbone",
      );
    }
    return confirmed;
  }

  async getFullTopology(limit?: number, signal?: AbortSignal): Promise<TopologyFlow[]> {
    return this.paginate<TopologyFlow>(async (cursor) => {
      const page = await this.getTopology({ cursor, limit }, signal);
      return { items: page.flows, nextCursor: page.nextCursor };
    });
  }

  /** A temporary client for a specific physical Backbone, through this USB gateway.
   * Deployment uses request/response only; runtime signals travel directly on CAN. */
  forCanNode(nodeId: number): SpaghettiClient {
    if (!Number.isInteger(nodeId) || nodeId <= 0 || nodeId > 0xffffff)
      throw new Error("Invalid CAN node identity");
    const handlers = new Set<(bytes: Uint8Array) => void>();
    const transport: ProtocolTransport = {
      send: async (bytes) => {
        const reply = await this.request(
          Operation.CAN_REQUEST,
          encodeMap([u32Field(0, nodeId), bytesField(1, bytes)]),
          undefined,
          { defaultTimeoutMs: 10000, attemptTimeoutMs: 4500, maxRetries: 1 },
        );
        const inner = requireBytes(
          requireMap(decodeOne(reply), "CAN response"),
          0,
          "CAN response",
        );
        for (const handler of handlers) handler(inner);
      },
      onResponse: (handler) => {
        handlers.add(handler);
        return () => {
          handlers.delete(handler);
        };
      },
      onEvent: () => () => {},
    };
    return new SpaghettiClient(transport, {
      defaultTimeoutMs: 15000,
      attemptTimeoutMs: 12000,
      maxRetries: 0,
    });
  }

  async getConfig(signal?: AbortSignal): Promise<GetConfigResponse> {
    const first = decodeGetConfigResponse(
      await this.request(Operation.GET_CONFIG, encodeGetConfigRequest(), signal),
    );
    if (first.totalSize === undefined) return first;
    if (
      first.offset !== 0 ||
      first.totalSize > 65536 ||
      first.totalSize < first.configBytes.length
    )
      throw new Error("Invalid configuration chunk size");
    const configBytes = new Uint8Array(first.totalSize);
    configBytes.set(first.configBytes);
    let offset = first.configBytes.length;
    while (offset < configBytes.length) {
      const next = decodeGetConfigResponse(
        await this.request(
          Operation.GET_CONFIG,
          encodeGetConfigRequest(offset),
          signal,
        ),
      );
      if (
        next.generation !== first.generation ||
        next.totalSize !== configBytes.length ||
        next.offset !== offset ||
        next.sha256.length !== first.sha256.length ||
        !next.sha256.every((v, i) => v === first.sha256[i]) ||
        next.configBytes.length === 0 ||
        next.configBytes.length > configBytes.length - offset
      )
        throw new Error("Configuration changed during download");
      configBytes.set(next.configBytes, offset);
      offset += next.configBytes.length;
    }
    return { generation: first.generation, sha256: first.sha256, configBytes };
  }

  private configUploadToken = Math.floor(Math.random() * 0xfffffffe) + 1;
  private async transferConfig(
    operation: "validate" | "apply",
    configBytes: Uint8Array,
    generation: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const op =
      operation === "apply" ? Operation.APPLY_CONFIG : Operation.VALIDATE_CONFIG;
    if (configBytes.length <= 576)
      return this.request(
        op,
        operation === "apply"
          ? encodeApplyConfigRequest({ configBytes, expectedGeneration: generation })
          : encodeValidateConfigRequest({ configBytes }),
        signal,
      );
    const token = (this.configUploadToken = (this.configUploadToken + 1) >>> 0 || 1);
    let result: Uint8Array = new Uint8Array();
    for (let offset = 0; offset < configBytes.length; offset += 400) {
      result = await this.request(
        op,
        encodeConfigChunk(
          operation,
          configBytes.subarray(offset, offset + 400),
          token,
          offset,
          configBytes.length,
          generation,
        ),
        signal,
      );
    }
    return result;
  }

  async validateConfig(
    req: ValidateConfigRequest,
    signal?: AbortSignal,
  ): Promise<ValidateConfigResponse> {
    return decodeValidateConfigResponse(
      await this.transferConfig("validate", req.configBytes, 0, signal),
    );
  }

  async applyConfig(
    req: ApplyConfigRequest,
    signal?: AbortSignal,
  ): Promise<ApplyConfigResponse> {
    return decodeApplyConfigResponse(
      await this.transferConfig(
        "apply",
        req.configBytes,
        req.expectedGeneration,
        signal,
      ),
    );
  }

  // --- discovery ------------------------------------------------------------

  async listDiscovery(
    req: ListDiscoveryRequest = {},
    signal?: AbortSignal,
  ): Promise<ListDiscoveryResponse> {
    const bytes = await this.request(
      Operation.LIST_DISCOVERY,
      encodeListDiscoveryRequest(req),
      signal,
    );
    return decodeListDiscoveryResponse(bytes);
  }

  async getFullDiscoveryList(
    limit?: number,
    signal?: AbortSignal,
  ): Promise<DiscoveryCandidate[]> {
    return this.paginate<DiscoveryCandidate>(async (cursor) => {
      const page = await this.listDiscovery({ cursor, limit }, signal);
      return { items: page.candidates, nextCursor: page.nextCursor };
    });
  }

  async scanDiscovery(
    req: ScanDiscoveryRequest,
    signal?: AbortSignal,
  ): Promise<ScanDiscoveryResponse> {
    const bytes = await this.request(
      Operation.SCAN_DISCOVERY,
      encodeScanDiscoveryRequest(req),
      signal,
    );
    return decodeScanDiscoveryResponse(bytes);
  }

  async acceptDiscovery(
    req: AcceptDiscoveryRequest,
    signal?: AbortSignal,
  ): Promise<AcceptDiscoveryResponse> {
    const bytes = await this.request(
      Operation.ACCEPT_DISCOVERY,
      encodeAcceptDiscoveryRequest(req),
      signal,
    );
    return decodeAcceptDiscoveryResponse(bytes);
  }

  // --- command / connectivity / maintenance ----------------------------------

  async moduleCommand(
    req: ModuleCommandRequest,
    signal?: AbortSignal,
  ): Promise<ReturnType<typeof decodeModuleCommandResponse>> {
    const bytes = await this.request(
      Operation.MODULE_COMMAND,
      encodeModuleCommandRequest(req),
      signal,
    );
    return decodeModuleCommandResponse(bytes);
  }

  async getConnectivityStatus(
    signal?: AbortSignal,
  ): Promise<GetConnectivityStatusResponse> {
    const bytes = await this.request(
      Operation.GET_CONNECTIVITY_STATUS,
      encodeGetConnectivityStatusRequest(),
      signal,
    );
    return decodeGetConnectivityStatusResponse(bytes);
  }

  async acquireConnectivityLease(
    req: AcquireConnectivityLeaseRequest,
    signal?: AbortSignal,
  ): Promise<void> {
    const bytes = await this.request(
      Operation.ACQUIRE_CONNECTIVITY_LEASE,
      encodeAcquireConnectivityLeaseRequest(req),
      signal,
    );
    decodeConnectivityLeaseResponse(bytes);
  }

  async releaseConnectivityLease(signal?: AbortSignal): Promise<void> {
    const bytes = await this.request(
      Operation.RELEASE_CONNECTIVITY_LEASE,
      encodeReleaseConnectivityLeaseRequest(),
      signal,
    );
    decodeConnectivityLeaseResponse(bytes);
  }

  async openNetworkMaintenance(
    signal?: AbortSignal,
  ): Promise<OpenNetworkMaintenanceResponse> {
    const bytes = await this.request(
      Operation.OPEN_NETWORK_MAINTENANCE,
      encodeOpenNetworkMaintenanceRequest(),
      signal,
    );
    return decodeOpenNetworkMaintenanceResponse(bytes);
  }

  async factoryReset(req: FactoryResetRequest, signal?: AbortSignal): Promise<void> {
    const bytes = await this.request(
      Operation.FACTORY_RESET,
      encodeFactoryResetRequest(req),
      signal,
    );
    decodeFactoryResetResponse(bytes);
  }

  // --- audit / job ------------------------------------------------------------

  async getAuditLog(
    req: GetAuditLogRequest = {},
    signal?: AbortSignal,
  ): Promise<GetAuditLogResponse> {
    const bytes = await this.request(
      Operation.GET_AUDIT_LOG,
      encodeGetAuditLogRequest(req),
      signal,
    );
    return decodeGetAuditLogResponse(bytes);
  }

  async getFullAuditLog(
    limit?: number,
    signal?: AbortSignal,
  ): Promise<AuditLogEntry[]> {
    return this.paginate<AuditLogEntry>(async (cursor) => {
      const page = await this.getAuditLog(
        { cursor: cursor === 0 ? undefined : cursor, limit },
        signal,
      );
      return { items: page.entries, nextCursor: page.nextCursor };
    });
  }

  async getJobStatus(
    req: GetJobStatusRequest,
    signal?: AbortSignal,
  ): Promise<GetJobStatusResponse> {
    const bytes = await this.request(
      Operation.GET_JOB_STATUS,
      encodeGetJobStatusRequest(req),
      signal,
    );
    return decodeGetJobStatusResponse(bytes);
  }

  // --- profiles / features / resources / update --------------------------------

  async listDeviceProfiles(
    req: ListDeviceProfilesRequest = {},
    signal?: AbortSignal,
  ): Promise<ListDeviceProfilesResponse> {
    const bytes = await this.request(
      Operation.LIST_DEVICE_PROFILES,
      encodeListDeviceProfilesRequest(req),
      signal,
    );
    return decodeListDeviceProfilesResponse(bytes);
  }

  async getFullDeviceProfileList(
    limit?: number,
    signal?: AbortSignal,
  ): Promise<DeviceProfileSummary[]> {
    return this.paginate<DeviceProfileSummary>(async (cursor) => {
      const page = await this.listDeviceProfiles({ cursor, limit }, signal);
      return { items: page.profiles, nextCursor: page.nextCursor };
    });
  }

  async getDeviceProfile(
    req: GetDeviceProfileRequest,
    signal?: AbortSignal,
  ): Promise<GetDeviceProfileResponse> {
    const bytes = await this.request(
      Operation.GET_DEVICE_PROFILE,
      encodeGetDeviceProfileRequest(req),
      signal,
    );
    return decodeGetDeviceProfileResponse(bytes);
  }

  async validateDeviceProfile(
    req: ValidateDeviceProfileRequest,
    signal?: AbortSignal,
  ): Promise<ValidateDeviceProfileResponse> {
    if (req.profileCbor.length > 480 && !req.upload) {
      const token = Math.floor(Math.random() * 0xfffffffe) + 1;
      let response: ValidateDeviceProfileResponse | undefined;
      for (let offset = 0; offset < req.profileCbor.length; offset += 400) {
        response = await this.validateDeviceProfile(
          {
            profileCbor: req.profileCbor.slice(offset, offset + 400),
            upload: { offset, total: req.profileCbor.length, token },
          },
          signal,
        );
        if (!response.valid) return response;
      }
      return response!;
    }
    const bytes = await this.request(
      Operation.VALIDATE_DEVICE_PROFILE,
      encodeValidateDeviceProfileRequest(req),
      signal,
    );
    return decodeValidateDeviceProfileResponse(bytes);
  }

  async installDeviceProfile(
    req: InstallDeviceProfileRequest,
    signal?: AbortSignal,
  ): Promise<void> {
    if (req.profileCbor.length > 480 && !req.upload) {
      const token = Math.floor(Math.random() * 0xfffffffe) + 1;
      for (let offset = 0; offset < req.profileCbor.length; offset += 400) {
        await this.installDeviceProfile(
          {
            profileCbor: req.profileCbor.slice(offset, offset + 400),
            upload: { offset, total: req.profileCbor.length, token },
          },
          signal,
        );
      }
      return;
    }
    const bytes = await this.request(
      Operation.INSTALL_DEVICE_PROFILE,
      encodeInstallDeviceProfileRequest(req),
      signal,
    );
    decodeInstallDeviceProfileResponse(bytes);
  }

  async removeDeviceProfile(
    req: RemoveDeviceProfileRequest,
    signal?: AbortSignal,
  ): Promise<void> {
    const bytes = await this.request(
      Operation.REMOVE_DEVICE_PROFILE,
      encodeRemoveDeviceProfileRequest(req),
      signal,
    );
    decodeRemoveDeviceProfileResponse(bytes);
  }

  async getFeatures(signal?: AbortSignal): Promise<GetFeaturesResponse> {
    const bytes = await this.request(
      Operation.GET_FEATURES,
      encodeGetFeaturesRequest(),
      signal,
    );
    return decodeGetFeaturesResponse(bytes);
  }

  async getResources(signal?: AbortSignal): Promise<GetResourcesResponse> {
    const bytes = await this.request(
      Operation.GET_RESOURCES,
      encodeGetResourcesRequest(),
      signal,
    );
    return decodeGetResourcesResponse(bytes);
  }

  async getCapabilities(signal?: AbortSignal): Promise<GetCapabilitiesResponse> {
    const bytes = await this.request(
      Operation.GET_CAPABILITIES,
      encodeGetCapabilitiesRequest(),
      signal,
    );
    return decodeGetCapabilitiesResponse(bytes);
  }

  async getUpdateStatus(signal?: AbortSignal): Promise<GetUpdateStatusResponse> {
    const bytes = await this.request(
      Operation.GET_UPDATE_STATUS,
      encodeGetUpdateStatusRequest(),
      signal,
    );
    return decodeGetUpdateStatusResponse(bytes);
  }

  async openWifiUpdate(
    req: OpenWifiUpdateRequest = {},
    signal?: AbortSignal,
  ): Promise<OpenWifiUpdateResponse> {
    const bytes = await this.request(
      Operation.OPEN_WIFI_UPDATE,
      encodeOpenWifiUpdateRequest(req),
      signal,
    );
    return decodeOpenWifiUpdateResponse(bytes);
  }

  async openBleUpdate(
    req: OpenBleUpdateRequest,
    signal?: AbortSignal,
  ): Promise<OpenBleUpdateResponse> {
    const bytes = await this.request(
      Operation.OPEN_BLE_UPDATE,
      encodeOpenBleUpdateRequest(req),
      signal,
    );
    return decodeOpenBleUpdateResponse(bytes);
  }

  async writeBleUpdate(
    req: WriteBleUpdateRequest,
    signal?: AbortSignal,
  ): Promise<void> {
    const bytes = await this.request(
      Operation.WRITE_BLE_UPDATE,
      encodeWriteBleUpdateRequest(req),
      signal,
    );
    decodeBleUpdateEmptyResponse(bytes);
  }

  async finishBleUpdate(
    req: BleUpdateSessionRequest,
    signal?: AbortSignal,
  ): Promise<void> {
    const bytes = await this.request(
      Operation.FINISH_BLE_UPDATE,
      encodeBleUpdateSessionRequest(req),
      signal,
    );
    decodeBleUpdateEmptyResponse(bytes);
  }

  async cancelBleUpdate(
    req: BleUpdateSessionRequest,
    signal?: AbortSignal,
  ): Promise<void> {
    const bytes = await this.request(
      Operation.CANCEL_BLE_UPDATE,
      encodeBleUpdateSessionRequest(req),
      signal,
    );
    decodeBleUpdateEmptyResponse(bytes);
  }

  private async paginate<T>(
    fetchPage: (cursor: number) => Promise<{ items: readonly T[]; nextCursor: number }>,
  ): Promise<T[]> {
    const all: T[] = [];
    let cursor = 0;
    for (;;) {
      const page = await fetchPage(cursor);
      all.push(...page.items);
      if (page.nextCursor === 0) return all;
      cursor = page.nextCursor;
    }
  }
}
