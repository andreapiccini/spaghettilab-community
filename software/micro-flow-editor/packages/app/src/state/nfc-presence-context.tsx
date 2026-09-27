import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatDeviceId, macBytesToColon, macToDeviceIdHex } from "../lib/core-identity.js";
import type { AttachedBackbone } from "./core-sessions-context.js";
import {
  collectNfcNodes,
  dismissNfcPopup,
  emptyNfcPopupQueue,
  enqueueNfcPopups,
  nfcEventsFromDiff,
  type NfcNode,
  type NfcPopupQueue,
} from "../lib/nfc-presence.js";
import type { CoreBindingId } from "@spaghettilab/domain";
import { useCoreSessions } from "./core-sessions-context.js";

const POLL_MS = 4000;

type NfcPresenceContextValue = {
  readonly nodesByBinding: ReadonlyMap<CoreBindingId, readonly NfcNode[]>;
  readonly loadingBindings: ReadonlySet<CoreBindingId>;
  readonly queue: NfcPopupQueue;
  dismissCurrent(): void;
};

const NfcPresenceContext = createContext<NfcPresenceContextValue | undefined>(undefined);

export function NfcPresenceProvider({ children }: { readonly children: ReactNode }) {
  const { rows, getClient, getSnapshot, listDiscoveryCandidates, setAttachedBackbones, onDiscoveryEvent } = useCoreSessions();
  const [nodesByBinding, setNodesByBinding] = useState<ReadonlyMap<CoreBindingId, readonly NfcNode[]>>(new Map());
  const [loadingBindings, setLoadingBindings] = useState<ReadonlySet<CoreBindingId>>(new Set());
  const [queue, setQueue] = useState<NfcPopupQueue>(emptyNfcPopupQueue);
  const lastNodesRef = useRef(new Map<CoreBindingId, readonly NfcNode[]>());
  const primedRef = useRef(new Set<CoreBindingId>());
  const nextIdRef = useRef(0);
  const inFlightRef = useRef(false);
  const refreshRef = useRef(() => {});

  const readyRoots = useMemo(
    () => rows.filter((row) => row.sessionState === "READY" && row.viaCan === null),
    [rows],
  );
  const readyKey = readyRoots.map((row) => row.binding.bindingId).join("|");
  const readyRootsRef = useRef(readyRoots);
  readyRootsRef.current = readyRoots;

  useEffect(() => {
    const readyIds = new Set(readyRoots.map((row) => row.binding.bindingId));
    for (const id of [...primedRef.current]) {
      if (readyIds.has(id)) continue;
      primedRef.current.delete(id);
      lastNodesRef.current.delete(id);
    }
    setNodesByBinding((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const id of next.keys()) {
        if (readyIds.has(id)) continue;
        next.delete(id);
        changed = true;
      }
      return changed ? next : prev;
    });
    setLoadingBindings((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of next) {
        if (readyIds.has(id)) continue;
        next.delete(id);
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [readyKey, readyRoots]);

  useEffect(() => {
    if (readyRoots.length === 0) return undefined;
    let cancelled = false;

    async function poll() {
      if (cancelled || inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        for (const row of readyRootsRef.current) {
          if (cancelled) return;
          const bindingId = row.binding.bindingId;
          const firstLook = !primedRef.current.has(bindingId);
          if (firstLook) {
            setLoadingBindings((prev) => {
              if (prev.has(bindingId)) return prev;
              const next = new Set(prev);
              next.add(bindingId);
              return next;
            });
          }
          try {
            const client = getClient(bindingId);
            const status = client ? await client.getStatus() : getSnapshot(bindingId)?.status;
            let candidates: readonly { portId: number; suggestedTypeId: string }[] = [];
            try {
              candidates = (await listDiscoveryCandidates(bindingId)) ?? [];
            } catch {
              candidates = [];
            }
            if (cancelled) return;
            const peerMacByNode = new Map<number, string>();
            for (const peer of status?.chainPeers ?? []) {
              peerMacByNode.set(peer.nodeId, macBytesToColon(peer.mac));
            }
            const nodes = collectNfcNodes(
              status?.modules ?? [],
              candidates,
              (status?.nfcTags ?? []).map((tag) => ({
                portId: tag.portId,
                typeId: tag.typeId,
                nodeId: tag.nodeId,
                backboneMac: peerMacByNode.get(tag.nodeId) ?? formatDeviceId(row.binding.expectedDeviceId),
              })),
            );
            const previous = lastNodesRef.current.get(bindingId) ?? [];
            lastNodesRef.current.set(bindingId, nodes);
            if (status?.chainPeers && status.chainPeers.length > 0) {
              const attached: AttachedBackbone[] = status.chainPeers.map((peer) => {
                const mac = macBytesToColon(peer.mac);
                return {
                  deviceIdHex: peer.local ? row.binding.expectedDeviceId : macToDeviceIdHex(mac),
                  mac,
                  nodeId: peer.nodeId,
                  local: peer.local,
                  ...(peer.version ? { version: peer.version } : {}),
                };
              });
              const remotes = attached.filter((peer) => !peer.local);
              const alreadyHadRemotes = row.attachedBackbones.some((peer) => !peer.local);
              if (!firstLook || remotes.length > 0 || !alreadyHadRemotes) {
                setAttachedBackbones(bindingId, attached);
              }
            }
            setNodesByBinding((prev) => {
              const next = new Map(prev);
              next.set(bindingId, nodes);
              return next;
            });
            if (firstLook) {
              primedRef.current.add(bindingId);
            } else {
              const events = nfcEventsFromDiff(
                formatDeviceId(row.binding.expectedDeviceId),
                previous,
                nodes,
                () => `nfc-${++nextIdRef.current}`,
              );
              if (events.length > 0) setQueue((q) => enqueueNfcPopups(q, events));
            }
          } catch {
            /* A failed poll must not look like every module vanished. */
          } finally {
            if (firstLook) {
              setLoadingBindings((prev) => {
                if (!prev.has(bindingId)) return prev;
                const next = new Set(prev);
                next.delete(bindingId);
                return next;
              });
            }
          }
        }
      } finally {
        inFlightRef.current = false;
      }
    }

    refreshRef.current = () => {
      void poll();
    };
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [readyKey, getClient, getSnapshot, listDiscoveryCandidates, setAttachedBackbones]);

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    for (const row of readyRoots) {
      const off = onDiscoveryEvent(row.binding.bindingId, () => {
        refreshRef.current();
      });
      if (off) unsubs.push(off);
    }
    return () => {
      for (const off of unsubs) off();
    };
  }, [readyKey, readyRoots, onDiscoveryEvent]);

  const dismissCurrent = useCallback(() => {
    setQueue((q) => dismissNfcPopup(q));
  }, []);

  const value = useMemo<NfcPresenceContextValue>(
    () => ({ nodesByBinding, loadingBindings, queue, dismissCurrent }),
    [nodesByBinding, loadingBindings, queue, dismissCurrent],
  );

  return <NfcPresenceContext.Provider value={value}>{children}</NfcPresenceContext.Provider>;
}

export function useNfcPresence(): NfcPresenceContextValue {
  const ctx = useContext(NfcPresenceContext);
  if (!ctx) throw new Error("useNfcPresence() called outside <NfcPresenceProvider>");
  return ctx;
}
