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
  stabilizeNfcPresence,
  type NfcDetectQueue,
  type NfcNode,
  type NfcTagInput,
} from "../lib/nfc-presence.js";
import type { CoreBindingId } from "@spaghettilab/domain";
import { useCoreSessions } from "./core-sessions-context.js";
import { useLocale } from "./locale-context.js";

const POLL_MS = 1000;

const DISCOVERY_CONFIRM_MS = 180;

type NfcPresenceContextValue = {
  readonly observations: ReadonlyMap<
    CoreBindingId,
    readonly NfcTagInput[]
  >;
  readonly nodesByBinding: ReadonlyMap<CoreBindingId, readonly NfcNode[]>;
  readonly loadingBindings: ReadonlySet<CoreBindingId>;
  readonly queue: NfcDetectQueue;
  dismissCurrent(): void;
  dismissAll(): void;
  selectPopup(index: number): void;
  /** Stop GET_STATUS while NFC_PAGE is using the same transport. */
  pausePolling(): void;
  resumePolling(): void;
  waitUntilIdle(): Promise<void>;
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
  const { locale } = useLocale();
  const copy = useMemo(() => coreConnectionsCopy(locale), [locale]);
  const [nodesByBinding, setNodesByBinding] = useState<
    ReadonlyMap<CoreBindingId, readonly NfcNode[]>
  >(new Map());
  const [loadingBindings, setLoadingBindings] = useState<ReadonlySet<CoreBindingId>>(
    new Set(),
  );
  const [observations, setObservations] = useState<
    ReadonlyMap<CoreBindingId, readonly NfcTagInput[]>
  >(new Map());
  const [queue, setQueue] = useState<NfcDetectQueue>(emptyNfcDetectQueue);
  const lastNodesRef = useRef(new Map<CoreBindingId, readonly NfcNode[]>());
  const lastObservedRef = useRef(new Map<CoreBindingId, readonly NfcTagInput[]>());
  const emptyStreakRef = useRef(new Map<CoreBindingId, number>());
  const primedRef = useRef(new Set<CoreBindingId>());
  const nextIdRef = useRef(0);
  const inFlightRef = useRef(false);
  const pendingPollRef = useRef<"now" | "fresh" | false>(false);
  const pendingConfirmLaterRef = useRef(false);
  const pauseCountRef = useRef(0);
  const refreshRef = useRef<(options?: { fresh?: boolean; confirmLater?: boolean }) => void>(
    () => {},
  );

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
    (
      row: (typeof readyRoots)[number],
      status: Parameters<typeof observeStatus>[1],
      options?: { readonly immediateLeave?: boolean },
    ) => {
      const bindingId = row.binding.bindingId;
      const peers = attachedFromStatus(status, row.binding.expectedDeviceId);
      observeStatus(bindingId, status);
      if (peers) setAttachedBackbones(bindingId, peers);

      const peerMacByNode = new Map<number, string>();
      const peerLabelByNode = new Map<number, string>();
      let remoteOrdinal = 1;
      for (const peer of status.chainPeers ?? []) {
        peerMacByNode.set(peer.nodeId, macBytesToColon(peer.mac));
        if ((peer.flags & 2) !== 0) peerLabelByNode.set(peer.nodeId, "Lettore NFC");
        else if (peer.local) peerLabelByNode.set(peer.nodeId, copy.masterBackbone);
        else {
          remoteOrdinal += 1;
          peerLabelByNode.set(peer.nodeId, copy.chainedBackbone(remoteOrdinal));
        }
      }
      const masterMac = formatDeviceId(row.binding.expectedDeviceId);
      const incoming =
        status.nfcTags === undefined
          ? undefined
          : status.nfcTags.map((tag) => ({
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
            }));
      const previousObserved = lastObservedRef.current.get(bindingId) ?? [];
      const stabilized = stabilizeNfcPresence(
        previousObserved,
        incoming,
        emptyStreakRef.current.get(bindingId) ?? 0,
        options,
      );
      emptyStreakRef.current.set(bindingId, stabilized.emptyStreak);
      lastObservedRef.current.set(bindingId, [...stabilized.tags]);
      setObservations((prev) => new Map(prev).set(bindingId, [...stabilized.tags]));
      const nodes = collectNfcNodes(stabilized.tags);
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
    [observeStatus, setAttachedBackbones, copy],
  );

  useEffect(() => {
    for (const id of [...primedRef.current]) {
      if (keepNfcIds.has(id)) continue;
      primedRef.current.delete(id);
      lastNodesRef.current.delete(id);
      lastObservedRef.current.delete(id);
      emptyStreakRef.current.delete(id);
    }
  }, [keepNfcIds]);

  useEffect(() => {
    if (readyRoots.length === 0) return undefined;
    let cancelled = false;
    const confirmTimers = new Set<number>();

    async function poll(options?: { fresh?: boolean; confirmLater?: boolean }) {
      if (cancelled || pauseCountRef.current > 0) return;
      if (inFlightRef.current) {
        pendingPollRef.current =
          options?.fresh || pendingPollRef.current === "fresh" ? "fresh" : "now";
        if (options?.confirmLater) pendingConfirmLaterRef.current = true;
        return;
      }
      inFlightRef.current = true;
      try {
        let confirmLater = Boolean(options?.confirmLater) || pendingConfirmLaterRef.current;
        pendingConfirmLaterRef.current = false;
        let wantFresh = Boolean(options?.fresh);
        do {
          const immediateLeave = wantFresh || pendingPollRef.current === "fresh";
          pendingPollRef.current = false;
          const fresh = new Map(
            (await discoverNetwork(immediateLeave ? { fresh: true } : undefined)).map(
              ({ bindingId, status }) => [bindingId, status],
            ),
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
              if (!status) continue;
              if (cancelled) return;
              ingestStatus(row, status, { immediateLeave });
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
          wantFresh = pendingPollRef.current === "fresh";
        } while (pendingPollRef.current && !cancelled);
        confirmLater = confirmLater || pendingConfirmLaterRef.current;
        pendingConfirmLaterRef.current = false;
        if (confirmLater && !cancelled) {
          const timer = window.setTimeout(() => {
            confirmTimers.delete(timer);
            void poll({ fresh: true });
          }, DISCOVERY_CONFIRM_MS);
          confirmTimers.add(timer);
        }
      } finally {
        inFlightRef.current = false;
        if (pendingPollRef.current && !cancelled) void poll();
      }
    }

    refreshRef.current = (options) => {
      void poll(options);
    };
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      for (const confirm of confirmTimers) window.clearTimeout(confirm);
    };
  }, [
    readyKey,
    readyRoots.length,
    discoverNetwork,
    ingestStatus,
  ]);

  useEffect(() => {
    const unsubs: (() => void)[] = [];
    for (const row of readyRoots) {
      const off = onDiscoveryEvent(row.binding.bindingId, () => {
        if (pauseCountRef.current > 0) return;
        refreshRef.current({ fresh: true, confirmLater: true });
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

  const pausePolling = useCallback(() => {
    pauseCountRef.current += 1;
  }, []);

  const resumePolling = useCallback(() => {
    pauseCountRef.current = Math.max(0, pauseCountRef.current - 1);
  }, []);

  const waitUntilIdle = useCallback(async () => {
    for (let i = 0; i < 80 && inFlightRef.current; i += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 40));
    }
  }, []);

  const visibleNodesByBinding = useMemo(
    () =>
      new Map([...nodesByBinding].filter(([bindingId]) => keepNfcIds.has(bindingId))),
    [nodesByBinding, keepNfcIds],
  );
  const visibleLoadingBindings = useMemo(
    () => new Set([...loadingBindings].filter((id) => keepNfcIds.has(id))),
    [loadingBindings, keepNfcIds],
  );

  const value = useMemo<NfcPresenceContextValue>(
    () => ({
      observations: new Map([...observations].filter(([id]) => keepNfcIds.has(id))),
      nodesByBinding: visibleNodesByBinding,
      loadingBindings: visibleLoadingBindings,
      queue,
      dismissCurrent,
      dismissAll,
      selectPopup,
      pausePolling,
      resumePolling,
      waitUntilIdle,
    }),
    [
      observations,
      keepNfcIds,
      visibleNodesByBinding,
      visibleLoadingBindings,
      queue,
      dismissCurrent,
      dismissAll,
      selectPopup,
      pausePolling,
      resumePolling,
      waitUntilIdle,
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
