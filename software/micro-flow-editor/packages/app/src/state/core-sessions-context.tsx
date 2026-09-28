import type { CompileConfigInput } from "@spaghettilab/config-compiler";
import type { DeploymentContext, DeploymentResult } from "@spaghettilab/config-deployment";
import type { CommandOutcome, RunCommandRequest, ScanOutcome } from "@spaghettilab/core-actions";
import type { DestructiveConfirmation, LeaseOutcome, MaintenanceOutcome, ResetScopeOutcome } from "@spaghettilab/core-admin";
import { bytesToHex, CatalogCache, CoreSession, type CoreSessionSnapshot, type SessionState, type SyncRelationship } from "@spaghettilab/core-session";
import type { DeviceProfileDraft } from "@spaghettilab/device-profile-authoring-model";
import type { InstallProfileResult } from "@spaghettilab/device-profile-install";
import type { CoreBindingId, CoreBindingRecord, DomainError, PermissionSet, Result } from "@spaghettilab/domain";
import { EventStream, SpaghettiClient, WebSerialProtocolTransport, WebSocketProtocolTransport, type AcceptDiscoveryRequest, type AcceptDiscoveryResponse, type AuditLogEntry, type DeviceProfileSummary, type DiscoveryCandidate, type DiscoveryEventPayload, type GetConnectivityStatusResponse, type GetJobStatusResponse, type GetStatusResponse, type GetUpdateStatusResponse, type ProtocolTransport, type RecordEventPayload } from "@spaghettilab/protocol-sdk";
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { connectBrowserWebSocket } from "../lib/browser-websocket-connection.js";
import { openBrowserSerial, type UsbSerialPort } from "../lib/browser-serial-connection.js";
import { coreDisplayName, formatDeviceId, macBytesToColon, macToDeviceIdHex } from "../lib/core-identity.js";
import { useSession } from "./session-context.js";

export type CoreLink =
  | { readonly kind: "websocket"; readonly url: string }
  | { readonly kind: "usb"; readonly port: UsbSerialPort }
  | { readonly kind: "can"; readonly viaDeviceIdHex: string; readonly nodeId: number };

export type CanVia = {
  readonly viaDeviceIdHex: string;
  readonly nodeId: number;
};

export type HostLink = "usb" | "wifi";

export type AttachedBackbone = {
  readonly deviceIdHex: string;
  readonly mac: string;
  readonly nodeId: number;
  readonly local: boolean;
  readonly version?: string;
};

export function retainAttachedVersions(
  previous: readonly AttachedBackbone[],
  next: readonly AttachedBackbone[],
): AttachedBackbone[] {
  const prior = new Map(previous.map((peer) => [peer.deviceIdHex, peer.version]));
  return next.map((peer) => {
    const version = peer.version?.trim() || prior.get(peer.deviceIdHex)?.trim();
    return version ? { ...peer, version } : peer;
  });
}

export function attachedFromStatus(status: GetStatusResponse | undefined, expectedDeviceId: string): AttachedBackbone[] | null {
  if (!status?.chainPeers?.length) return null;
  const currentDeviceId = status.deviceId?.length ? bytesToHex(status.deviceId) : expectedDeviceId;
  return status.chainPeers.map((peer) => {
    const mac = macBytesToColon(peer.mac);
    const version = (peer.version?.trim() || (peer.local ? status.version : undefined))?.trim();
    return {
      deviceIdHex: peer.local ? currentDeviceId : macToDeviceIdHex(mac),
      mac,
      nodeId: peer.nodeId,
      local: peer.local,
      ...(version ? { version } : {}),
    };
  });
}

/** Live GET_STATUS chain is authoritative. An empty list is only the USB/Wi-Fi root. */
export function liveAttachedChain(
  attached: readonly AttachedBackbone[],
  fallback: AttachedBackbone,
): AttachedBackbone[] {
  if (attached.length === 0) return [fallback];
  return [...attached];
}

function hostLinkFromCoreLink(link: CoreLink): HostLink {
  if (link.kind === "usb") return "usb";
  if (link.kind === "websocket" && link.url.includes("/usb-bridge/")) return "usb";
  return "wifi";
}

export type { NfcNode } from "../lib/nfc-presence.js";

export type CoreRowState = {
  readonly binding: CoreBindingRecord;
  readonly displayName: string;
  readonly sessionState: SessionState;
  readonly stale: boolean;
  readonly syncRelationship: SyncRelationship | null;
  readonly error: DomainError | string | null;
  readonly viaCan: CanVia | null;
  readonly attachedBackbones: readonly AttachedBackbone[];
  readonly hostLink: HostLink;
};

type CoreSessionsContextValue = {
  rows: readonly CoreRowState[];
  connect(binding: CoreBindingRecord, link: CoreLink): Promise<void>;
  setAttachedBackbones(bindingId: CoreBindingId, peers: readonly AttachedBackbone[]): void;
  observeStatus(bindingId: CoreBindingId, status: GetStatusResponse): void;
  cancel(bindingId: CoreBindingId): void;
  fail(bindingId: CoreBindingId, message: string): void;
  getSnapshot(bindingId: CoreBindingId): CoreSessionSnapshot | undefined;
  listDeviceProfiles(bindingId: CoreBindingId): Promise<readonly DeviceProfileSummary[]> | undefined;
  listDiscoveryCandidates(bindingId: CoreBindingId): Promise<readonly DiscoveryCandidate[]> | undefined;
  acceptDiscovery(bindingId: CoreBindingId, req: AcceptDiscoveryRequest): Promise<AcceptDiscoveryResponse> | undefined;
  installProfile(bindingId: CoreBindingId, draft: DeviceProfileDraft): Promise<Result<InstallProfileResult, DomainError>> | undefined;
  removeProfile(bindingId: CoreBindingId, profileId: string, version: number, options: { readonly isReferencedLocally: boolean }): Promise<Result<void, DomainError>> | undefined;
  deployConfig(bindingId: CoreBindingId, input: CompileConfigInput, context: DeploymentContext): Promise<DeploymentResult> | undefined;
  onRecordEvent(bindingId: CoreBindingId, listener: (payload: RecordEventPayload) => void): (() => void) | undefined;
  onDiscoveryEvent(bindingId: CoreBindingId, listener: (payload: DiscoveryEventPayload) => void): (() => void) | undefined;
  getLastBootId(bindingId: CoreBindingId): bigint | null | undefined;
  runCommand(bindingId: CoreBindingId, req: RunCommandRequest, granted: PermissionSet): Promise<CommandOutcome> | undefined;
  requestScan(bindingId: CoreBindingId, req: { readonly portId: number; readonly invasive: boolean }, granted: PermissionSet): Promise<ScanOutcome> | undefined;
  getJobStatus(bindingId: CoreBindingId, jobId: number): Promise<GetJobStatusResponse> | undefined;
  getConnectivityStatus(bindingId: CoreBindingId): Promise<GetConnectivityStatusResponse> | undefined;
  getAuditLog(bindingId: CoreBindingId): Promise<readonly AuditLogEntry[]> | undefined;
  acquireLease(bindingId: CoreBindingId, services: number, durationMs: number, granted: PermissionSet): Promise<LeaseOutcome> | undefined;
  releaseLease(bindingId: CoreBindingId, granted: PermissionSet): Promise<LeaseOutcome> | undefined;
  openNetworkMaintenance(bindingId: CoreBindingId, granted: PermissionSet, confirmation: DestructiveConfirmation): Promise<MaintenanceOutcome> | undefined;
  requestFactoryReset(bindingId: CoreBindingId, scope: number, granted: PermissionSet, confirmation: DestructiveConfirmation): Promise<ResetScopeOutcome> | undefined;
  getUpdateStatus(bindingId: CoreBindingId): Promise<GetUpdateStatusResponse> | undefined;
  getClient(bindingId: CoreBindingId): SpaghettiClient | undefined;
};

const CoreSessionsContext = createContext<CoreSessionsContextValue | undefined>(undefined);

const sharedCatalogCache = new CatalogCache();

function usbBridgeClientOptions(link: CoreLink): { defaultTimeoutMs: number; attemptTimeoutMs: number; maxRetries: number } | undefined {
  if (link.kind === "usb") return { defaultTimeoutMs: 20000, attemptTimeoutMs: 8000, maxRetries: 1 };
  if (link.kind === "websocket" && link.url.includes("/usb-bridge/")) {
    return { defaultTimeoutMs: 20000, attemptTimeoutMs: 8000, maxRetries: 1 };
  }
  return undefined;
}

async function openLink(link: CoreLink): Promise<{ transport: ProtocolTransport; dispose: () => void; onDisconnected: (cb: () => void) => void }> {
  if (link.kind === "can") {
    throw new Error("CAN peers are reached through the USB master");
  }
  if (link.kind === "websocket") {
    const { connection, socket } = await connectBrowserWebSocket(link.url);
    const transport = new WebSocketProtocolTransport(connection);
    return {
      transport,
      dispose: () => {
        transport.dispose();
        socket.close();
      },
      // The socket had no close/error listener at all post-handshake — a dead
      // connection (proxy/idle timeout, physically unplugged) left every
      // in-flight and future request to fail on its own, one 5s timeout at a
      // time, instead of the session surfacing a real DISCONNECTED state.
      onDisconnected: (cb) => {
        socket.addEventListener("close", cb, { once: true });
      },
    };
  }
  const connection = await openBrowserSerial(link.port);
  const transport = new WebSerialProtocolTransport(connection);
  return {
    transport,
    dispose: () => {
      transport.dispose();
      void connection.close();
    },
    onDisconnected: () => {},
  };
}

export function CoreSessionsProvider({ children }: { readonly children: ReactNode }) {
  const { session } = useSession();
  const sessionsRef = useRef(new Map<CoreBindingId, CoreSession>());
  const disposersRef = useRef(new Map<CoreBindingId, () => void>());
  const canViaRef = useRef(new Map<CoreBindingId, CanVia>());
  const attachedRef = useRef(new Map<CoreBindingId, readonly AttachedBackbone[]>());
  const hostLinkRef = useRef(new Map<CoreBindingId, HostLink>());
  const [renderCount, forceRender] = useState(0);
  const rerender = useCallback(() => forceRender((n) => n + 1), []);
  const [errors, setErrors] = useState<Map<CoreBindingId, DomainError | string>>(new Map());

  const connect = useCallback(
    async (binding: CoreBindingRecord, link: CoreLink) => {
      setErrors((prev) => {
        const next = new Map(prev);
        next.delete(binding.bindingId);
        return next;
      });
      sessionsRef.current.get(binding.bindingId)?.disconnect();
      sessionsRef.current.get(binding.bindingId)?.dispose();
      sessionsRef.current.delete(binding.bindingId);
      disposersRef.current.get(binding.bindingId)?.();
      disposersRef.current.delete(binding.bindingId);
      attachedRef.current.delete(binding.bindingId);
      if (link.kind === "can") {
        canViaRef.current.set(binding.bindingId, { viaDeviceIdHex: link.viaDeviceIdHex, nodeId: link.nodeId });
        rerender();
        return;
      }
      canViaRef.current.delete(binding.bindingId);
      hostLinkRef.current.set(binding.bindingId, hostLinkFromCoreLink(link));
      try {
        const opened = await openLink(link);
        disposersRef.current.set(binding.bindingId, opened.dispose);
        const client = new SpaghettiClient(opened.transport, usbBridgeClientOptions(link));
        const eventStream = new EventStream(opened.transport);
        const identityPolicy = hostLinkFromCoreLink(link) === "usb" ? "accept-current" : "strict";
        const coreSession = new CoreSession(binding, client, eventStream, sharedCatalogCache, identityPolicy);
        sessionsRef.current.set(binding.bindingId, coreSession);
        opened.onDisconnected(() => {
          // Ignore a stale close from an already-superseded socket (e.g. a
          // quick reconnect already replaced this session before the old
          // one's close event fired).
          if (sessionsRef.current.get(binding.bindingId) !== coreSession) return;
          coreSession.disconnect();
          attachedRef.current.delete(binding.bindingId);
          setErrors((prev) => {
            if (!prev.has(binding.bindingId)) return prev;
            const next = new Map(prev);
            next.delete(binding.bindingId);
            return next;
          });
          rerender();
        });
        rerender();

        await coreSession.connect();
        if (session) coreSession.syncWithProject(session.stack.current, true);
        const status = coreSession.lastKnownSnapshot.status;
        const peers = attachedFromStatus(status, binding.expectedDeviceId);
        attachedRef.current.set(
          binding.bindingId,
          peers ?? [
            {
              deviceIdHex: binding.expectedDeviceId,
              mac: formatDeviceId(binding.expectedDeviceId),
              nodeId: 0,
              local: true,
              ...(status?.version ? { version: status.version } : {}),
            },
          ],
        );
        rerender();
      } catch (cause) {
        const timeout = cause instanceof Error && cause.message.includes("TIMEOUT");
        const quietUsbDisconnect = hostLinkFromCoreLink(link) === "usb";
        if (!timeout || quietUsbDisconnect) {
          sessionsRef.current.get(binding.bindingId)?.disconnect();
          sessionsRef.current.get(binding.bindingId)?.dispose();
          sessionsRef.current.delete(binding.bindingId);
          disposersRef.current.get(binding.bindingId)?.();
          disposersRef.current.delete(binding.bindingId);
        }
        if (quietUsbDisconnect) {
          attachedRef.current.delete(binding.bindingId);
          setErrors((prev) => {
            if (!prev.has(binding.bindingId)) return prev;
            const next = new Map(prev);
            next.delete(binding.bindingId);
            return next;
          });
          rerender();
          return;
        }
        setErrors((prev) => new Map(prev).set(binding.bindingId, cause instanceof Error ? cause.message : String(cause)));
        rerender();
      }
    },
    [session, rerender],
  );

  const cancel = useCallback(
    (bindingId: CoreBindingId) => {
      const coreSession = sessionsRef.current.get(bindingId);
      coreSession?.disconnect();
      coreSession?.dispose();
      sessionsRef.current.delete(bindingId);
      disposersRef.current.get(bindingId)?.();
      disposersRef.current.delete(bindingId);
      canViaRef.current.delete(bindingId);
      hostLinkRef.current.delete(bindingId);
      attachedRef.current.delete(bindingId);
      rerender();
    },
    [rerender],
  );

  const fail = useCallback((bindingId: CoreBindingId, message: string) => {
    setErrors((prev) => new Map(prev).set(bindingId, message));
    rerender();
  }, [rerender]);

  const setAttachedBackbones = useCallback((bindingId: CoreBindingId, peers: readonly AttachedBackbone[]) => {
    const next = retainAttachedVersions(attachedRef.current.get(bindingId) ?? [], peers);
    const prev = attachedRef.current.get(bindingId) ?? [];
    const same =
      next.length === prev.length &&
      next.every((peer, index) => peer.deviceIdHex === prev[index]?.deviceIdHex && peer.version === prev[index]?.version && peer.local === prev[index]?.local);
    if (same) return;
    attachedRef.current.set(bindingId, next);
    rerender();
  }, [rerender]);

  const observeStatus = useCallback((bindingId: CoreBindingId, status: GetStatusResponse) => {
    sessionsRef.current.get(bindingId)?.observeStatus(status);
  }, []);

  const rows = useMemo<readonly CoreRowState[]>(() => {
    const bindings = session?.stack.current.coreBindings ?? [];
    return bindings.map((binding) => {
      const coreSession = sessionsRef.current.get(binding.bindingId);
      const deviceName = coreSession?.lastKnownSnapshot.status?.deviceName;
      const currentDeviceId = coreSession?.lastKnownSnapshot.status?.deviceId;
      const displayDeviceId = currentDeviceId?.length ? bytesToHex(currentDeviceId) : binding.expectedDeviceId;
      return {
        binding,
        displayName: coreDisplayName(deviceName, displayDeviceId),
        sessionState: coreSession?.state ?? "DISCONNECTED",
        stale: coreSession?.stale ?? false,
        syncRelationship: coreSession?.syncRelationship ?? null,
        error: errors.get(binding.bindingId) ?? null,
        viaCan: canViaRef.current.get(binding.bindingId) ?? null,
        attachedBackbones: attachedRef.current.get(binding.bindingId) ?? [],
        hostLink: hostLinkRef.current.get(binding.bindingId) ?? "usb",
      };
    });
  }, [session, errors, renderCount]);

  const getSnapshot = useCallback((bindingId: CoreBindingId) => sessionsRef.current.get(bindingId)?.lastKnownSnapshot, []);
  const listDeviceProfiles = useCallback((bindingId: CoreBindingId) => sessionsRef.current.get(bindingId)?.listDeviceProfiles(), []);
  const listDiscoveryCandidates = useCallback((bindingId: CoreBindingId) => sessionsRef.current.get(bindingId)?.listDiscoveryCandidates(), []);
  const acceptDiscovery = useCallback((bindingId: CoreBindingId, req: AcceptDiscoveryRequest) => sessionsRef.current.get(bindingId)?.acceptDiscovery(req), []);
  const installProfile = useCallback((bindingId: CoreBindingId, draft: DeviceProfileDraft) => sessionsRef.current.get(bindingId)?.installProfile(draft), []);
  const removeProfile = useCallback(
    (bindingId: CoreBindingId, profileId: string, version: number, options: { readonly isReferencedLocally: boolean }) => sessionsRef.current.get(bindingId)?.removeProfile(profileId, version, options),
    [],
  );
  const deployConfig = useCallback((bindingId: CoreBindingId, input: CompileConfigInput, context: DeploymentContext) => sessionsRef.current.get(bindingId)?.deployConfig(input, context), []);
  const onRecordEvent = useCallback(
    (bindingId: CoreBindingId, listener: (payload: RecordEventPayload) => void) => sessionsRef.current.get(bindingId)?.onRecordEvent(listener),
    [],
  );
  const onDiscoveryEvent = useCallback(
    (bindingId: CoreBindingId, listener: (payload: DiscoveryEventPayload) => void) => sessionsRef.current.get(bindingId)?.onDiscoveryEvent(listener),
    [],
  );
  const getLastBootId = useCallback((bindingId: CoreBindingId) => sessionsRef.current.get(bindingId)?.lastBootId, []);
  const runCommand = useCallback(
    (bindingId: CoreBindingId, req: RunCommandRequest, granted: PermissionSet) => sessionsRef.current.get(bindingId)?.runCommand(req, granted),
    [],
  );
  const requestScan = useCallback(
    (bindingId: CoreBindingId, req: { readonly portId: number; readonly invasive: boolean }, granted: PermissionSet) => sessionsRef.current.get(bindingId)?.requestScan(req, granted),
    [],
  );
  const getJobStatus = useCallback((bindingId: CoreBindingId, jobId: number) => sessionsRef.current.get(bindingId)?.getJobStatus(jobId), []);
  const getConnectivityStatus = useCallback((bindingId: CoreBindingId) => sessionsRef.current.get(bindingId)?.getConnectivityStatus(), []);
  const getAuditLog = useCallback((bindingId: CoreBindingId) => sessionsRef.current.get(bindingId)?.getAuditLog(), []);
  const acquireLease = useCallback(
    (bindingId: CoreBindingId, services: number, durationMs: number, granted: PermissionSet) => sessionsRef.current.get(bindingId)?.acquireLease(services, durationMs, granted),
    [],
  );
  const releaseLease = useCallback((bindingId: CoreBindingId, granted: PermissionSet) => sessionsRef.current.get(bindingId)?.releaseLease(granted), []);
  const openNetworkMaintenance = useCallback(
    (bindingId: CoreBindingId, granted: PermissionSet, confirmation: DestructiveConfirmation) => sessionsRef.current.get(bindingId)?.openNetworkMaintenance(granted, confirmation),
    [],
  );
  const requestFactoryReset = useCallback(
    (bindingId: CoreBindingId, scope: number, granted: PermissionSet, confirmation: DestructiveConfirmation) => sessionsRef.current.get(bindingId)?.requestFactoryReset(scope, granted, confirmation),
    [],
  );
  const getUpdateStatus = useCallback((bindingId: CoreBindingId) => sessionsRef.current.get(bindingId)?.getUpdateStatus(), []);
  const getClient = useCallback((bindingId: CoreBindingId) => sessionsRef.current.get(bindingId)?.client, []);

  const value: CoreSessionsContextValue = {
    rows,
    connect,
    setAttachedBackbones,
    observeStatus,
    cancel,
    fail,
    getSnapshot,
    listDeviceProfiles,
    listDiscoveryCandidates,
    acceptDiscovery,
    installProfile,
    removeProfile,
    deployConfig,
    onRecordEvent,
    onDiscoveryEvent,
    getLastBootId,
    runCommand,
    requestScan,
    getJobStatus,
    getConnectivityStatus,
    getAuditLog,
    acquireLease,
    releaseLease,
    openNetworkMaintenance,
    requestFactoryReset,
    getUpdateStatus,
    getClient,
  };
  return <CoreSessionsContext.Provider value={value}>{children}</CoreSessionsContext.Provider>;
}

export function useCoreSessions(): CoreSessionsContextValue {
  const ctx = useContext(CoreSessionsContext);
  if (!ctx) throw new Error("useCoreSessions() called outside <CoreSessionsProvider>");
  return ctx;
}
