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
import { useSession } from "./session-context.js";

const POLL_MS = 1000;

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
    discoverNetwork,
    setAttachedBackbones,
    observeStatus,
    onDiscoveryEvent,
  } = useCoreSessions();
  const { activeScreen } = useSession();
  const { locale } = useLocale();
  const copy = useMemo(() => coreConnectionsCopy(locale), [locale]);
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
  useEffect(() => {
    readyRootsRef.current = readyRoots;
  }, [readyRoots]);
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

  const ingestStatus = useCallback(
    (row: (typeof readyRoots)[number], status: Parameters<typeof observeStatus>[1]) => {
      const bindingId = row.binding.bindingId;
      const peers = attachedFromStatus(status, row.binding.expectedDeviceId);
      observeStatus(bindingId, status);
      if (peers) setAttachedBackbones(bindingId, peers);

      const peerMacByNode = new Map<number, string>();
      const peerLabelByNode = new Map<number, string>();
      let remoteOrdinal = 1;
      for (const peer of status.chainPeers ?? []) {
        peerMacByNode.set(peer.nodeId, macBytesToColon(peer.mac));
        if (peer.local) peerLabelByNode.set(peer.nodeId, copy.masterBackbone);
        else {
          remoteOrdinal += 1;
          peerLabelByNode.set(peer.nodeId, copy.chainedBackbone(remoteOrdinal));
        }
      }
      const masterMac = formatDeviceId(row.binding.expectedDeviceId);
      const nodes = collectNfcNodes(
        (status.nfcTags ?? []).map((tag) => ({
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
      const firstLook = !primedRef.current.has(bindingId);
      lastNodesRef.current.set(bindingId, nodes);
      setNodesByBinding((prev) => new Map(prev).set(bindingId, nodes));
      if (firstLook) primedRef.current.add(bindingId);
      else {
        const events = nfcEventsFromDiff(
          masterMac,
          previous,
          nodes,
          () => `nfc-${++nextIdRef.current}`,
        );
        if (events.length > 0) setQueue((q) => enqueueNfcDetects(q, events));
      }
    },
    [
      observeStatus,
      setAttachedBackbones,
      copy,
    ],
  );

  useEffect(() => {
    for (const id of [...primedRef.current]) {
      if (keepNfcIds.has(id)) continue;
      primedRef.current.delete(id);
      lastNodesRef.current.delete(id);
    }
  }, [keepNfcIds]);

  useEffect(() => {
    if (
      (activeScreen !== "core-connections" && activeScreen !== "physical-composition") ||
      readyRoots.length === 0
    )
      return undefined;
    let cancelled = false;

    async function poll() {
      if (cancelled || inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const fresh = new Map(
          (await discoverNetwork()).map(({ bindingId, status }) => [bindingId, status]),
        );
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
            const status = fresh.get(bindingId);
            if (!status) throw new Error("Discovery did not return this Backbone");
            if (cancelled) return;
            if (cancelled) return;
            ingestStatus(row, status);
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
    readyRoots.length,
    activeScreen,
    discoverNetwork,
    setAttachedBackbones,
    observeStatus,
    copy.masterBackbone,
    copy.chainedBackbone,
    ingestStatus,
  ]);

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    for (const row of readyRoots) {
      const off = onDiscoveryEvent(row.binding.bindingId, () => {
        if (
          activeScreen === "core-connections" ||
          activeScreen === "physical-composition"
        ) {
          refreshRef.current();
          return;
        }
        // Events remain active on every screen. A single coalesced Discovery
        // updates the authoritative network snapshot without starting polling.
        void discoverNetwork().then((fresh) => {
          const status = fresh.find(
            (item) => item.bindingId === row.binding.bindingId,
          )?.status;
          if (status) ingestStatus(row, status);
        });
      });
      if (off) unsubs.push(off);
    }
    return () => {
      for (const off of unsubs) off();
    };
  }, [
    activeScreen,
    readyKey,
    readyRoots,
    onDiscoveryEvent,
    discoverNetwork,
    ingestStatus,
  ]);

  const dismissCurrent = useCallback(() => {
    setQueue((q) => dismissNfcDetect(q));
  }, []);

  const dismissAll = useCallback(() => {
    setQueue(dismissAllNfcDetects());
  }, []);

  const selectPopup = useCallback((index: number) => {
    setQueue((q) => selectNfcDetect(q, index));
  }, []);

  const visibleNodesByBinding = useMemo(
    () =>
      new Map(
        [...nodesByBinding].filter(([bindingId]) => keepNfcIds.has(bindingId)),
      ),
    [nodesByBinding, keepNfcIds],
  );
  const visibleLoadingBindings = useMemo(
    () => new Set([...loadingBindings].filter((id) => keepNfcIds.has(id))),
    [loadingBindings, keepNfcIds],
  );

  const value = useMemo<NfcPresenceContextValue>(
    () => ({
      nodesByBinding: visibleNodesByBinding,
      loadingBindings: visibleLoadingBindings,
      queue,
      dismissCurrent,
      dismissAll,
      selectPopup,
    }),
    [
      visibleNodesByBinding,
      visibleLoadingBindings,
      queue,
      dismissCurrent,
      dismissAll,
      selectPopup,
    ],
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
