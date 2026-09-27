import { canonicalProjectHash, type CoreBindingRecord, type DeploymentRecordV1, type DomainError, type PermissionSet, type ProjectV1, type Result } from "@spaghettilab/domain";
import type { CompileConfigInput } from "@spaghettilab/config-compiler";
import { deployConfig as deployConfigWorkflow, type DeploymentContext, type DeploymentResult } from "@spaghettilab/config-deployment";
import { requestScan as requestScanWorkflow, runCommand as runCommandWorkflow, type CommandOutcome, type RunCommandRequest, type ScanOutcome } from "@spaghettilab/core-actions";
import {
  acquireLease as acquireLeaseWorkflow,
  openNetworkMaintenance as openNetworkMaintenanceWorkflow,
  releaseLease as releaseLeaseWorkflow,
  requestFactoryResetWithConfirmation as requestFactoryResetWorkflow,
  type DestructiveConfirmation,
  type LeaseOutcome,
  type MaintenanceOutcome,
  type ResetScopeOutcome,
} from "@spaghettilab/core-admin";
import type { DeviceProfileDraft } from "@spaghettilab/device-profile-authoring-model";
import { installProfile as installProfileWorkflow, removeProfile as removeProfileWorkflow, type InstallProfileResult } from "@spaghettilab/device-profile-install";
import type {
  AcceptDiscoveryRequest,
  AcceptDiscoveryResponse,
  AuditLogEntry,
  DeviceProfileSummary,
  DiscoveryCandidate,
  EventStream,
  GetCapabilitiesResponse,
  GetCatalogResponse,
  GetConfigResponse,
  GetConnectivityStatusResponse,
  GetFeaturesResponse,
  GetJobStatusResponse,
  GetResourcesResponse,
  GetStatusResponse,
  GetTopologyResponse,
  GetUpdateStatusResponse,
  RecordEventPayload,
  SpaghettiClient,
} from "@spaghettilab/protocol-sdk";
import { CatalogCache } from "./catalog-cache.js";
import { CoreSessionError, CoreSessionErrorCode } from "./errors.js";
import { bytesEqualHex, bytesToHex } from "./hex.js";
import type { SessionState, SyncRelationship } from "./session-state.js";
import { classifySyncRelationship } from "./sync-classifier.js";

export type CoreSessionSnapshot = {
  readonly status?: GetStatusResponse;
  readonly capabilities?: GetCapabilitiesResponse;
  readonly features?: GetFeaturesResponse;
  readonly catalog?: GetCatalogResponse;
  readonly topology?: GetTopologyResponse;
  readonly config?: GetConfigResponse;
  readonly resources?: GetResourcesResponse;
};

/**
 * Owns connection and synchronization for one Core (`REACT_FLOW_ARCHITECTURE.md`
 * § Device Session Manager). Drives the session state machine, reads
 * identity/status/capability/features/catalog/topology/Config/resources in
 * coherent order on sync (S030 point 3), and classifies the project/device
 * relationship — but never writes to either automatically (S030 point 6:
 * "mai auto-apply al reconnect").
 */
export class CoreSession {
  private _state: SessionState = "DISCONNECTED";
  private _stale = false;
  private deviceId: Uint8Array | null = null;
  private bootId: bigint | null = null;
  private disposed = false;
  private snapshot: CoreSessionSnapshot = {};
  private _syncRelationship: SyncRelationship | null = null;
  private readonly eventLoop: Promise<void>;
  private readonly recordListeners = new Set<(payload: RecordEventPayload) => void>();

  constructor(
    readonly binding: CoreBindingRecord,
    /**
     * The underlying wire client — `readonly` but not `private`, so a
     * caller can construct a `@spaghettilab/ota-lifecycle` `BleOtaSession`
     * directly (Aggiornamento tab, S103): `ota-lifecycle` depends on
     * `core-session` (for `CatalogCache`), so `core-session` cannot depend
     * back on it without a circular package reference. `client`
     * structurally satisfies `BleOtaWireClient`, same as every other
     * workflow this class wraps internally.
     */
    readonly client: SpaghettiClient,
    private readonly eventStream: EventStream,
    private readonly catalogCache: CatalogCache,
  ) {
    this.eventLoop = this.consumeEvents();
  }

  get state(): SessionState {
    return this._state;
  }

  /** True once this session was `READY` at least once and has since gone `DISCONNECTED` — the "Core offline resta editabile con ultimo snapshot marcato stale" case (S030 § Verifiche). */
  get stale(): boolean {
    return this._stale;
  }

  /** Last known good data, retained across disconnects — never cleared by `disconnect()`. */
  get lastKnownSnapshot(): CoreSessionSnapshot {
    return this.snapshot;
  }

  get syncRelationship(): SyncRelationship | null {
    return this._syncRelationship;
  }

  /**
   * Fans a `RECORD` event out to every subscriber (Runtime & Diagnostics'
   * Telemetria tab, S091) — the single real `consumeEvents()` loop is the
   * only consumer of `eventStream` itself (it's a bounded, pull-based
   * single-consumer queue, `@spaghettilab/protocol-sdk`'s `EventStream`), so
   * external callers subscribe here instead of iterating the stream a
   * second time, which would silently split events between two competing
   * consumers rather than each seeing all of them.
   */
  onRecordEvent(listener: (payload: RecordEventPayload) => void): () => void {
    this.recordListeners.add(listener);
    return () => {
      this.recordListeners.delete(listener);
    };
  }

  /** The most recent `boot_id` this session has observed via a `STATUS` event — `null` before the first one arrives, never a fabricated placeholder. Needed alongside a `RECORD` event's own fields to build a complete `TelemetryProvenance` (`@spaghettilab/telemetry-buffer`), since `RecordEventPayload` itself carries no boot ID (S091: boot ID is a `STATUS`-only field). */
  get lastBootId(): bigint | null {
    return this.bootId;
  }

  private async consumeEvents(): Promise<void> {
    try {
      for await (const event of this.eventStream) {
        if (this.disposed) return;
        if (event.kind === "record") {
          for (const listener of this.recordListeners) listener(event.payload);
          continue;
        }
        if (event.kind !== "status") continue;
        this.deviceId = event.payload.deviceId;
        const rebooted = this.bootId !== null && event.payload.bootId !== this.bootId;
        this.bootId = event.payload.bootId;
        if (rebooted && this._state === "READY") {
          // A changed boot ID invalidates only the ephemeral "we know this is
          // current" guarantee — the last known snapshot stays in place, and
          // catalog cache invalidation (if the fingerprint actually changed)
          // happens inside sync() on the next read, not here (S030 point 7:
          // "reconnect e reboot invalidano soltanto stato effimero necessario").
          this._state = "SYNCHRONIZING";
          // Re-read immediately — without this, a reboot detected while READY
          // left the session parked at SYNCHRONIZING forever: nothing else in
          // this class (or any caller) ever moved it forward again. sync()
          // itself sets READY on success or ERROR on failure, either of which
          // is a real terminal state a caller can act on; the rejection is
          // caught here only because this loop has no caller to propagate it
          // to — sync() has already recorded the failure in `_state`.
          void this.sync().catch(() => {});
        }
      }
    } catch {
      // Stream disposed or the transport is gone — nothing more to consume.
    }
  }

  /**
   * Connects and reads the Core's state in the order S030 point 3 specifies.
   * Never touches the project or the device's Config — this is read-only.
   */
  async connect(): Promise<void> {
    this._state = "CONNECTING";
    // No separate handshake is exposed at this layer — transport-level
    // authentication (TLS, connection profile credentials) happens below
    // SpaghettiClient (S022/S023); this state exists for UI/observability
    // continuity with the architecture's own state diagram.
    this._state = "AUTHENTICATING";
    this._state = "SYNCHRONIZING";
    await this.sync();
  }

  /**
   * The actual read sequence — shared by `connect()`'s first sync and by
   * `consumeEvents()`'s automatic re-sync after a mid-session reboot. Always
   * leaves `_state` at a real terminal value (READY or ERROR), never stuck
   * at SYNCHRONIZING, since nothing else in this class moves it off that
   * state on its own.
   */
  private async sync(): Promise<void> {
    try {
      const status = await this.client.getStatus();
      const capabilities = await this.client.getCapabilities();
      const features = await this.client.getFeatures();

      if (status.deviceId) {
        this.deviceId = status.deviceId;
      }

      if (this.deviceId !== null && this.binding.expectedDeviceId !== "" &&
          !bytesEqualHex(this.deviceId, this.binding.expectedDeviceId)) {
        this._state = "ERROR";
        throw new CoreSessionError(
          CoreSessionErrorCode.DEVICE_ID_MISMATCH,
          `expected device ${this.binding.expectedDeviceId}, connected device reports ${bytesToHex(this.deviceId)}`,
        );
      }

      const catalog = await this.readCatalog();
      const topology = await this.client.getFullTopology(16).then((flows) => ({ flows, nextCursor: 0 }));
      const config = await this.client.getConfig();
      const resources = await this.client.getResources();

      this.snapshot = { status, capabilities, features, catalog, topology, config, resources };
      this._state = "READY";
      this._stale = false;
    } catch (cause) {
      if (this._state !== "ERROR") this._state = "ERROR";
      throw cause;
    }
  }

  /**
   * Reads the catalog via a cheap first page (to learn the current
   * fingerprint), reusing the cache on a hit and only paginating the rest
   * (S022's `getFullCatalog()`, which already restarts on a fingerprint
   * change mid-read — S030's own "fingerprint a metà paginazione non
   * pubblica catalogo parziale" requirement) on a miss.
   */
  private async readCatalog(): Promise<GetCatalogResponse> {
    const firstPage = await this.client.getCatalog({ cursor: 0, limit: 1 });
    if (this.deviceId) {
      const cached = this.catalogCache.get(this.deviceId, firstPage.fingerprint);
      if (cached) return cached;
    }
    const full = await this.client.getFullCatalog();
    if (this.deviceId) {
      this.catalogCache.invalidateDevice(this.deviceId);
      this.catalogCache.set(this.deviceId, full);
    }
    return full;
  }

  /**
   * Classifies the project/device relationship against the last snapshot
   * read by `connect()`. `catalogCompatible` is supplied by the caller — see
   * `sync-classifier.ts`'s doc comment on why this package doesn't resolve
   * it itself (S042, not yet built).
   */
  syncWithProject(project: ProjectV1, catalogCompatible: boolean): SyncRelationship {
    if (!this.snapshot.config) {
      throw new Error("CoreSession.syncWithProject: call connect() first, no Config snapshot available yet");
    }
    const lastDeployment = this.latestDeploymentRecord(project);
    const relationship = classifySyncRelationship({
      lastDeployment,
      currentProjectHash: canonicalProjectHash(project),
      liveConfigHash: bytesToHex(this.snapshot.config.sha256),
      catalogCompatible,
    });
    this._syncRelationship = relationship;
    return relationship;
  }

  private latestDeploymentRecord(project: ProjectV1): DeploymentRecordV1 | null {
    const records = project.deploymentRecords.filter((r) => r.target === this.binding.bindingId);
    if (records.length === 0) return null;
    return records.reduce((latest, r) => (r.timestamp > latest.timestamp ? r : latest));
  }

  /** Marks the session offline. The last known snapshot is deliberately never cleared — it stays editable while stale (S030 § Verifiche). */
  disconnect(): void {
    if (this._state === "READY" || this._state === "SYNCHRONIZING") {
      this._stale = true;
    }
    this._state = "DISCONNECTED";
  }

  /**
   * Reads the full installed Device Profile list — not part of `connect()`'s own
   * sync sequence (S030 point 3 doesn't include it) because it is a separate,
   * potentially large paginated read that not every caller needs; screens that do
   * (Catalog & Topology Explorer, Device Profile Studio) call it explicitly.
   */
  async listDeviceProfiles(): Promise<readonly DeviceProfileSummary[]> {
    return this.client.getFullDeviceProfileList();
  }

  /** Reads the full discovery candidate list — same "explicit, not part of connect()'s sync sequence" reasoning as `listDeviceProfiles()`. Used by the Physical Composition Editor's "Candidati rilevati" tray (S050). */
  async listDiscoveryCandidates(): Promise<readonly DiscoveryCandidate[]> {
    return this.client.getFullDiscoveryList();
  }

  /** Explicit action: accepts one discovery candidate on the Core, returning the firmware-assigned Module key. Never called without a prior, human-reviewed diff — see `@spaghettilab/physical-composition-model`'s `previewDiscoveryAcceptDiff()`. */
  async acceptDiscovery(req: AcceptDiscoveryRequest): Promise<AcceptDiscoveryResponse> {
    return this.client.acceptDiscovery(req);
  }

  /**
   * Installs a Device Profile draft (Device Profile Studio, S061-S063) —
   * `SpaghettiClient` satisfies `@spaghettilab/device-profile-install`'s narrow
   * `DeviceProfileWireClient` structurally, no adapter needed. Validates
   * remotely, installs, and verifies the post-install hash; never called
   * automatically.
   */
  async installProfile(draft: DeviceProfileDraft): Promise<Result<InstallProfileResult, DomainError>> {
    return installProfileWorkflow(this.client, draft);
  }

  /** Explicit action: removes an installed Device Profile, refusing locally-referenced ones without a round trip — see `@spaghettilab/device-profile-install`'s own doc comment. */
  async removeProfile(profileId: string, version: number, options: { readonly isReferencedLocally: boolean }): Promise<Result<void, DomainError>> {
    return removeProfileWorkflow(this.client, profileId, version, options);
  }

  /**
   * Runs the full compile → local dry-run → remote validate → apply (CAS) →
   * read-back pipeline (Deploy & Diff, S080) — `SpaghettiClient` satisfies
   * `@spaghettilab/config-deployment`'s narrow `ConfigWireClient`
   * structurally, same pattern as `installProfile`. One atomic call: this
   * package has no intermediate per-stage callback, so a caller cannot show
   * real incremental pipeline progress, only the final outcome.
   */
  async deployConfig(input: CompileConfigInput, context: DeploymentContext): Promise<DeploymentResult> {
    return deployConfigWorkflow(this.client, input, context);
  }

  /** Runs one immediate Module command (Runtime & Diagnostics' Comandi tab, S092) — structurally distinct from any Config mutation, never touches `ProjectV1`/`CommandStack`. */
  async runCommand(req: RunCommandRequest, granted: PermissionSet): Promise<CommandOutcome> {
    return runCommandWorkflow(this.client, granted, req);
  }

  /** Starts a discovery scan job, gating an invasive scan on the `core.discovery.invasive-scan` permission before ever calling the wire (S092). Distinct from `listDiscoveryCandidates()`/`acceptDiscovery()`, which read/accept already-known candidates. */
  async requestScan(req: { readonly portId: number; readonly invasive: boolean }, granted: PermissionSet): Promise<ScanOutcome> {
    return requestScanWorkflow(this.client, granted, req);
  }

  /** Reads a job's current status (discovery scan, OTA transfer, ...) — generic, no interpretation. */
  async getJobStatus(jobId: number): Promise<GetJobStatusResponse> {
    return this.client.getJobStatus({ jobId });
  }

  /** Explicit, on-demand read — not part of `connect()`'s own sync sequence. */
  async getConnectivityStatus(): Promise<GetConnectivityStatusResponse> {
    return this.client.getConnectivityStatus();
  }

  /** Reads the full audit log — explicit, on-demand, paginated internally by `SpaghettiClient`. */
  async getAuditLog(): Promise<readonly AuditLogEntry[]> {
    return this.client.getFullAuditLog();
  }

  /** Acquires a bounded, self-expiring connectivity lease (Amministrazione tab) — never preempts another principal's lease; `-EBUSY` surfaces as `REMOTE_ERROR` instead. Not destructive, no confirmation required. */
  async acquireLease(services: number, durationMs: number, granted: PermissionSet): Promise<LeaseOutcome> {
    return acquireLeaseWorkflow(this.client, granted, services, durationMs);
  }

  async releaseLease(granted: PermissionSet): Promise<LeaseOutcome> {
    return releaseLeaseWorkflow(this.client, granted);
  }

  /** Opens network maintenance mode (stops MQTT workspace-wide, may disconnect BLE) — destructive-confirmation-gated (S094: caller must show the real target and get it typed back before this is called). */
  async openNetworkMaintenance(granted: PermissionSet, confirmation: DestructiveConfirmation): Promise<MaintenanceOutcome> {
    return openNetworkMaintenanceWorkflow(this.client, granted, confirmation);
  }

  /** Requests a factory reset for the given scope bitmask — destructive-confirmation-gated, same pattern as `openNetworkMaintenance`. */
  async requestFactoryReset(scope: number, granted: PermissionSet, confirmation: DestructiveConfirmation): Promise<ResetScopeOutcome> {
    return requestFactoryResetWorkflow(this.client, granted, scope, confirmation);
  }

  /** Reads the current OTA update-coordinator status (`GET_UPDATE_STATUS`) — explicit, on-demand, used to drive the Aggiornamento tab's post-reboot stages (S103 § Verifiche), since `@spaghettilab/ota-lifecycle`'s `BleOtaSession` itself only models `ARM → UPLOAD → FINALIZE → PENDING_REBOOT`. */
  async getUpdateStatus(): Promise<GetUpdateStatusResponse> {
    return this.client.getUpdateStatus();
  }


  /** Explicit action: adopt the device's live Config as-is. Never called automatically. */
  importLiveState(): GetConfigResponse {
    if (!this.snapshot.config) {
      throw new Error("CoreSession.importLiveState: no live Config snapshot available — call connect() first");
    }
    return this.snapshot.config;
  }

  /** Explicit action: keep the project's local state, ignore what the device reports this session. Deliberately a no-op — its only purpose is to be the caller's explicit choice, distinct from silence. */
  keepProject(): void {
    // No-op by design.
  }

  /** Explicit action: structured reconciliation — not implemented yet, it needs the Config decompiler (S073). */
  reconcile(): never {
    throw new CoreSessionError(
      CoreSessionErrorCode.RECONCILE_NOT_IMPLEMENTED,
      "structured reconcile requires the Config decompiler (S073), not yet implemented — use importLiveState() or keepProject() explicitly instead",
    );
  }

  dispose(): void {
    this.disposed = true;
    this.eventStream.dispose();
    void this.eventLoop;
  }
}
