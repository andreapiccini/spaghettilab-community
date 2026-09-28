import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { formatDeviceId, macBytesToColon } from "../lib/core-identity.js";
import { coreConnectionsCopy } from "../lib/core-connections-copy.js";
import { attachedFromStatus } from "./core-sessions-context.js";
import {
  collectNfcNodes,
  dismissAllNfcDetects,
  dismissNfcDetect,
  emptyNfcDetectQueue,
  enqueueNfcDetects,
  nfcEventsFromDiff,
  selectNfcDetect,
  type NfcDetectQueue,
  type NfcNode,
} from "../lib/nfc-presence.js";
import type { CoreBindingId } from "@spaghettilab/domain";
import { useCoreSessions } from "./core-sessions-context.js";
import { useLocale } from "./locale-context.js";

const POLL_MS = 1500;

type NfcPresenceContextValue = {
  readonly nodesByBinding: ReadonlyMap<CoreBindingId, readonly NfcNode[]>;
  readonly loadingBindings: ReadonlySet<CoreBindingId>;
  readonly queue: NfcDetectQueue;
  dismissCurrent(): void;
  dismissAll(): void;
  selectPopup(index: number): void;
};

const NfcPresenceContext = createContext<NfcPresenceContextValue | undefined>(
  undefined,
);

export function NfcPresenceProvider({ children }: { readonly children: ReactNode }) {
  const {
    rows,
    getClient,
    getSnapshot,
    setAttachedBackbones,
    observeStatus,
    onDiscoveryEvent,
  } = useCoreSessions();
  const { locale } = useLocale();
  const copy = coreConnectionsCopy(locale);
  const [nodesByBinding, setNodesByBinding] = useState<
    ReadonlyMap<CoreBindingId, readonly NfcNode[]>
  >(new Map());
  const [loadingBindings, setLoadingBindings] = useState<ReadonlySet<CoreBindingId>>(
    new Set(),
  );
  const [queue, setQueue] = useState<NfcDetectQueue>(emptyNfcDetectQueue);
  const lastNodesRef = useRef(new Map<CoreBindingId, readonly NfcNode[]>());
  const primedRef = useRef(new Set<CoreBindingId>());
  const nextIdRef = useRef(0);
  const inFlightRef = useRef(false);
  const refreshRef = useRef(() => {});

  const readyRoots = useMemo(
    () =>
      rows.filter(
        (row) =>
          row.viaCan === null &&
          (row.sessionState === "READY" || row.sessionState === "SYNCHRONIZING"),
      ),
    [rows],
  );
  const readyKey = readyRoots.map((row) => row.binding.bindingId).join("|");
  const readyRootsRef = useRef(readyRoots);
  readyRootsRef.current = readyRoots;
  const keepNfcIds = useMemo(
    () =>
      new Set(
        rows
          .filter(
            (row) =>
              row.viaCan === null &&
              (row.sessionState === "READY" || row.sessionState === "SYNCHRONIZING"),
          )
          .map((row) => row.binding.bindingId),
      ),
    [rows],
  );

  useEffect(() => {
    for (const id of [...primedRef.current]) {
      if (keepNfcIds.has(id)) continue;
      primedRef.current.delete(id);
      lastNodesRef.current.delete(id);
    }
    setNodesByBinding((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const id of next.keys()) {
        if (keepNfcIds.has(id)) continue;
        next.delete(id);
        changed = true;
      }
      return changed ? next : prev;
    });
    setLoadingBindings((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of next) {
        if (keepNfcIds.has(id)) continue;
        next.delete(id);
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [keepNfcIds]);

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
            const status = client
              ? await client.getStatus()
              : getSnapshot(bindingId)?.status;
            if (cancelled) return;
            if (status) {
              observeStatus(bindingId, status);
              const peers = attachedFromStatus(status, row.binding.expectedDeviceId);
              if (peers) setAttachedBackbones(bindingId, peers);
            }
            if (cancelled) return;
            const peerMacByNode = new Map<number, string>();
            const peerLabelByNode = new Map<number, string>();
            const chainPeers = status?.chainPeers ?? [];
            let remoteOrdinal = 1;
            for (const peer of chainPeers) {
              peerMacByNode.set(peer.nodeId, macBytesToColon(peer.mac));
              if (peer.local) {
                peerLabelByNode.set(peer.nodeId, copy.masterBackbone);
              } else {
                remoteOrdinal += 1;
                peerLabelByNode.set(peer.nodeId, copy.chainedBackbone(remoteOrdinal));
              }
            }
            const masterMac = formatDeviceId(row.binding.expectedDeviceId);
            const nodes = collectNfcNodes(
              (status?.nfcTags ?? []).map((tag) => ({
                portId: tag.portId,
                typeId: tag.typeId,
                uid: tag.uid,
                nodeId: tag.nodeId,
                backboneMac: peerMacByNode.get(tag.nodeId) ?? masterMac,
                backboneLabel:
                  peerLabelByNode.get(tag.nodeId) ??
                  (tag.local ? copy.masterBackbone : copy.chainedBackbone(2)),
                moduleTypeId: tag.moduleTypeId,
                vendorId: tag.vendorId,
                fallbackClass: tag.fallbackClass,
                registryId: tag.registryId,
              })),
            );
            const previous = lastNodesRef.current.get(bindingId) ?? [];
            lastNodesRef.current.set(bindingId, nodes);
            setNodesByBinding((prev) => {
              const next = new Map(prev);
              next.set(bindingId, nodes);
              return next;
            });
            if (firstLook) {
              primedRef.current.add(bindingId);
            } else {
              const events = nfcEventsFromDiff(
                masterMac,
                previous,
                nodes,
                () => `nfc-${++nextIdRef.current}`,
              );
              if (events.length > 0) setQueue((q) => enqueueNfcDetects(q, events));
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
  }, [
    readyKey,
    getClient,
    getSnapshot,
    setAttachedBackbones,
    observeStatus,
    copy.masterBackbone,
    copy.chainedBackbone,
  ]);

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
    setQueue((q) => dismissNfcDetect(q));
  }, []);

  const dismissAll = useCallback(() => {
    setQueue(dismissAllNfcDetects());
  }, []);

  const selectPopup = useCallback((index: number) => {
    setQueue((q) => selectNfcDetect(q, index));
  }, []);

  const value = useMemo<NfcPresenceContextValue>(
    () => ({
      nodesByBinding,
      loadingBindings,
      queue,
      dismissCurrent,
      dismissAll,
      selectPopup,
    }),
    [nodesByBinding, loadingBindings, queue, dismissCurrent, dismissAll, selectPopup],
  );

  return (
    <NfcPresenceContext.Provider value={value}>{children}</NfcPresenceContext.Provider>
  );
}

export function useNfcPresence(): NfcPresenceContextValue {
  const ctx = useContext(NfcPresenceContext);
  if (!ctx) throw new Error("useNfcPresence() called outside <NfcPresenceProvider>");
  return ctx;
}
