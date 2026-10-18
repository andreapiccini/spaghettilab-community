import { useCoreSessions } from "./core-sessions-context.js";
import type { CoreBindingId } from "@spaghettilab/domain";
import { createNfcMemoryBridge } from "../lib/nfc-memory-bridge.js";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSession } from "./session-context.js";
import { useNfcPresence } from "./nfc-presence-context.js";
import { savedDeviceDrivers } from "../lib/device-driver-library.js";
import {
  createBlankDraft,
  DEVICE_RECIPE_DRAFT_META_KEY,
  serializeDeviceRecipeDraft,
  type DeviceRecipeDraft,
} from "../lib/device-recipe-draft.js";
import { isSlm1Tag, moduleTypeLabel } from "../lib/nfc-presence.js";
import {
  addLibraryDriver,
  applyLibraryToScan,
  recognizedLibraryModule,
  scanPresenceKey,
  diffTagPresentations,
  decodeModuleTag,
  emptyNfcLibrary,
  mergeBuiltinNfcDrivers,
  NFC_CONTEXT_META,
  NFC_HISTORY_KEY,
  NFC_LIBRARY_KEY,
  nfcDeadline,
  nfcMemoryAntenna,
  readNfcLibrary,
  SimulatedNfcReader,
  tagIsPresent,
  writeAndVerifyTag,
  type ModuleTag,
  type NfcLibrary,
  type NfcMemoryBridge,
  type NfcMemory,
  type NfcTarget,
  type TagScan,
} from "../lib/nfc-workspace.js";

type ContextValue = {
  library: NfcLibrary;
  history: TagScan[];
  selected: TagScan | undefined;
  presentKeys: Set<string>;
  popup: TagScan | undefined;
  toast: TagScan | undefined;
  busy: boolean;
  error: string;
  operationNote: string;
  sound: boolean;
  simulator: SimulatedNfcReader;
  openTag(id: string): void;
  deleteTag(uid: string): void;
  markAllRead(): void;
  setSound(value: boolean): void;
  dismissToast(): void;
  setSimulationFailure(value: SimulatedNfcReader["failure"]): void;
  showModule(scan: TagScan): void;
  dismissModule(): void;
  simulate(action: "present" | "remove" | "blank"): void;
  readTag(scan: TagScan): Promise<void>;
  writeSession: { readonly uid: string } | null;
  beginWriteSession(scan: TagScan): Promise<void>;
  cancelWriteSession(): void;
  writeTag(scan: TagScan, value: ModuleTag): Promise<void>;
  updateLibrary(update: (library: NfcLibrary) => NfcLibrary): void;
  createDriver(scan: TagScan, name: string): void;
  cancelDriver(): boolean;
  finishDriver(draft: DeviceRecipeDraft, completed: boolean): boolean;
};
const Context = createContext<ContextValue | null>(null);
function storedHistory(): TagScan[] {
  try {
    const data: unknown = JSON.parse(localStorage.getItem(NFC_HISTORY_KEY) ?? "[]");
    return Array.isArray(data)
      ? data
          .filter(
            (s): s is TagScan =>
              !!s &&
              typeof s.id === "string" &&
              typeof s.uid === "string" &&
              !!s.target &&
              !!s.decoded &&
              !s.simulated,
          )
          .slice(0, 100)
      : [];
  } catch {
    return [];
  }
}
function getLibrary() {
  try {
    return mergeBuiltinNfcDrivers(
      readNfcLibrary(localStorage.getItem(NFC_LIBRARY_KEY)),
    );
  } catch {
    return mergeBuiltinNfcDrivers(emptyNfcLibrary());
  }
}

function tagUid(uid: string | Uint8Array | undefined): string {
  if (typeof uid === "string") return uid.toUpperCase();
  return Array.from(uid ?? [])
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function nfcProtocolErrorMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : "Operazione NFC fallita.";
  if (text.includes("inoltri NFC_PAGE") || text.includes("lettore CAN")) return text;
  if (text.includes("MALFORMED_REQUEST")) {
    return "Il tag è visibile, ma questo firmware rifiuta NFC_PAGE sul lettore CAN. Serve un firmware che inoltri le pagine di memoria.";
  }
  if (text.includes("INVALID_ARGUMENT")) {
    return "Il firmware ha rifiutato i parametri di NFC_PAGE (nodo, antenna o pagina). Il tag è visibile, ma questa immagine non scrive la memoria sul lettore.";
  }
  if (text.includes("INTERNAL_ERROR")) {
    return "Il firmware ha accettato NFC_PAGE ma la pagina è fallita. Tieni il tag fermo e riprova da Scrivi tag.";
  }
  if (text.includes("TIMEOUT") || text.includes("Tempo scaduto")) {
    return "Il tag è sul lettore, ma la memoria non risponde. Tieni il tag fermo e riprova, oppure aggiorna il firmware del lettore.";
  }
  if (
    (error instanceof Error && error.name === "AbortError") ||
    text.includes("interrotta") ||
    text.includes("CANCELLED")
  ) {
    return "Scrittura interrotta.";
  }
  return text;
}

export function NfcWorkspaceProvider({
  children,
  bridge: suppliedBridge,
}: {
  children: ReactNode;
  bridge?: NfcMemoryBridge;
}) {
  const { session, execute, navigate, revision, activeScreen } = useSession();
  const { observations, pausePolling, resumePolling, waitUntilIdle } = useNfcPresence();
  const { getClient, lockTransport, unlockTransport } = useCoreSessions();
  const bridge = useMemo(
    () =>
      suppliedBridge ??
      createNfcMemoryBridge((binding) => getClient(binding as CoreBindingId)),
    [suppliedBridge, getClient],
  );
  const [library, setLibrary] = useState(getLibrary);
  const [history, setHistory] = useState(storedHistory);
  const [selectedId, setSelectedId] = useState<string>();
  const [popup, setPopup] = useState<TagScan>();
  const [toast, setToast] = useState<TagScan>();
  const [busy, setBusy] = useState(false);
  const [writeSession, setWriteSession] = useState<{ readonly uid: string } | null>(
    null,
  );
  const writeLockRef = useRef(false);
  const writeAbortRef = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [operationNote, setOperationNote] = useState("");
  const [sound, setSoundState] = useState(() => {
    try {
      return localStorage.getItem("spaghettilab.nfc.sound") !== "0";
    } catch {
      return false;
    }
  });
  const [simulator] = useState(() => {
    const reader = new SimulatedNfcReader();
    try {
      const saved = JSON.parse(
        localStorage.getItem("spaghettilab.nfc.simulated-tag") ?? "null",
      );
      if (saved && Array.isArray(saved.bytes))
        reader.restoreTag(saved.uid, saved.bytes);
    } catch {
      /* Start with a blank simulated tag. */
    }
    return reader;
  });
  const [simPresent, setSimPresent] = useState(false);
  const prior = useRef(new Set<string>());
  const pendingPopups = useRef<TagScan[]>([]);
  const audio = useRef<AudioContext | null>(null);
  const [presentKeys, setPresentKeys] = useState(new Set<string>());
  useEffect(() => {
    try {
      localStorage.setItem(NFC_LIBRARY_KEY, JSON.stringify(library));
    } catch {
      // Report a failed write to external browser storage.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError(
        "Archivio locale pieno o non disponibile: la libreria non è stata salvata.",
      );
    }
  }, [library]);
  useEffect(() => {
    try {
      localStorage.setItem(NFC_HISTORY_KEY, JSON.stringify(history.slice(0, 100)));
    } catch {
      // Report a failed write to external browser storage.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setError("Cronologia non salvata: memoria locale non disponibile.");
    }
  }, [history]);
  useEffect(() => {
    if (!session) return;
    const drafts = savedDeviceDrivers(session.stack.current.authoringMetadata).filter(
      (draft) => !draft.id.startsWith("nfc-"),
    );
    // Import driver revisions from the project’s external command stack into the shared archive.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLibrary((previous) => {
      let next = mergeBuiltinNfcDrivers(previous);
      for (const draft of drafts)
        if (
          !next.drivers.some(
            (d) => d.id === draft.id && d.version === String(draft.updatedAt),
          )
        )
          next = addLibraryDriver(next, draft);
      return next;
    });
  }, [session, revision]);
  const notify = useCallback(
    (scan: TagScan) => {
      const recognized = recognizedLibraryModule(scan, library);
      const next = recognized?.scan ?? applyLibraryToScan(scan, library);
      setHistory((h) => [next, ...h].slice(0, 100));
      setToast(next);
      if (recognized) pendingPopups.current.push(next);
      if (sound && audio.current?.state === "running") {
        const ctx = audio.current;
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.frequency.value = 740;
        gain.gain.setValueAtTime(0.035, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start();
        oscillator.stop(ctx.currentTime + 0.17);
      }
    },
    [sound, library],
  );
  useEffect(() => {
    const scans: TagScan[] = [];
    for (const [bindingId, tags] of observations)
      for (const tag of tags) {
        const uid = tagUid(tag.uid);
        if (!uid) continue;
        const target = {
          bindingId,
          nodeId: tag.nodeId ?? 0,
          antenna: nfcMemoryAntenna(tag.portId),
          expectedUid: uid,
        };
        const scan: TagScan = {
          id: crypto.randomUUID(),
          at: Date.now(),
          uid,
          target,
          reader: `${tag.backboneLabel ?? "Master"} · NFC ${tag.portId}`,
          simulated: false,
          name: isSlm1Tag(tag) ? moduleTypeLabel(tag) : "Tag rilevato",
          decoded: {
            kind: isSlm1Tag(tag) ? "legacy" : "unknown",
            reason: "Avvicina il tag e scegli Leggi per visualizzarne il contenuto.",
          },
          writable: false,
          read: false,
        };
        scans.push(scan);
      }
    const changes = diffTagPresentations(prior.current, scans);
    prior.current = changes.present;
    for (const scan of changes.added) notify(scan);
    const keys = new Set(changes.present);
    if (simPresent)
      keys.add(
        scanPresenceKey({
          target: {
            bindingId: "simulator",
            nodeId: 1,
            antenna: 1,
            expectedUid: simulator.uid,
          },
          uid: simulator.uid,
          simulated: true,
        }),
      );
    // External reader snapshots update live presence, independently of history.
    setPresentKeys(keys);
  }, [observations, simPresent, simulator, notify]);
  useEffect(() => {
    // Drain reader events after the previous dialog/operation has completed.
    if (
      !popup &&
      !busy &&
      !(
        activeScreen === "device-recipe-editor" &&
        session?.stack.current.authoringMetadata[NFC_CONTEXT_META]?.comment
      ) &&
      pendingPopups.current.length
    )
      setPopup(pendingPopups.current.shift());
  }, [popup, busy, history, activeScreen, session]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(undefined), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  useEffect(() => {
    if (!sound) return;
    function enableAudio() {
      if (typeof AudioContext === "undefined") return;
      audio.current ??= new AudioContext();
      void audio.current.resume().catch(() => {
        /* Visual notifications remain available. */
      });
    }
    document.addEventListener("pointerdown", enableAudio, { once: true });
    return () => document.removeEventListener("pointerdown", enableAudio);
  }, [sound]);
  function setSound(value: boolean) {
    setSoundState(value);
    try {
      localStorage.setItem("spaghettilab.nfc.sound", value ? "1" : "0");
    } catch {
      /* visual notifications remain available */
    }
    if (value && typeof AudioContext !== "undefined") {
      audio.current ??= new AudioContext();
      void audio.current
        .resume()
        .catch(() =>
          setError(
            "Suono non disponibile nel browser. Le notifiche visive restano attive.",
          ),
        );
    }
  }
  useEffect(
    () => () => {
      void audio.current?.close();
    },
    [],
  );
  function simulate(action: "present" | "remove" | "blank") {
    if (lock.current) return;
    if (action === "remove") {
      simulator.removeTag();
      setSimPresent(false);
      return;
    }
    if (simulator.present && action === "present") return;
    simulator.presentTag(action === "blank");
    setSimPresent(true);
    const decoded = decodeModuleTag(simulator.bytes);
    const scan: TagScan = {
      id: crypto.randomUUID(),
      at: Date.now(),
      uid: simulator.uid,
      target: {
        bindingId: "simulator",
        nodeId: 1,
        antenna: 1,
        expectedUid: simulator.uid,
      },
      reader: "Lettore simulato · antenna 1",
      simulated: true,
      name: decoded.kind === "module" ? decoded.value.name : "Tag vuoto",
      decoded,
      memory: Array.from(simulator.bytes),
      family: "ST25TN01K",
      writable: !simulator.protected,
      read: false,
    };
    if (decoded.kind === "module")
      scan.imageRef = library.models.find(
        (m) => m.id === decoded.value.modelId,
      )?.imageRef;
    notify(scan);
  }
  function openTag(id: string) {
    setPopup(undefined);
    pendingPopups.current = pendingPopups.current.filter((scan) => scan.id !== id);
    setSelectedId(id);
    setHistory((h) => h.map((s) => (s.id === id ? { ...s, read: true } : s)));
    navigate("nfc-tags");
  }
  function deleteTag(uid: string) {
    const removedIds = new Set(
      history.filter((scan) => scan.uid === uid).map((scan) => scan.id),
    );
    pendingPopups.current = pendingPopups.current.filter((scan) => scan.uid !== uid);
    setPopup((current) => (current?.uid === uid ? undefined : current));
    setToast((current) => (current?.uid === uid ? undefined : current));
    setSelectedId((id) => (id && removedIds.has(id) ? undefined : id));
    setHistory((current) => current.filter((scan) => scan.uid !== uid));
  }
  function updateMemory(scan: TagScan, memory: NfcMemory, written: boolean) {
    const decoded = decodeModuleTag(memory.bytes);
    const updated = {
      ...scan,
      memory: Array.from(memory.bytes),
      decoded,
      family: memory.family,
      writable: memory.writable,
      name: decoded.kind === "module" ? decoded.value.name : scan.name,
      read: true,
    };
    // History is immutable; a fresh explicit read gets its own snapshot, without a scan notification.
    const snapshot = {
      ...updated,
      id: crypto.randomUUID(),
      at: Date.now(),
      source: written ? ("write" as const) : ("read" as const),
    };
    setHistory((h) => [snapshot, ...h].slice(0, 100));
    setSelectedId(snapshot.id);
  }
  function releaseWriteLock() {
    if (!writeLockRef.current) return;
    writeLockRef.current = false;
    unlockTransport();
    resumePolling();
    setWriteSession(null);
  }

  async function beginWriteSession(scan: TagScan) {
    if (writeLockRef.current || lock.current) return;
    setError("");
    setOperationNote("");
    writeAbortRef.current?.abort();
    writeAbortRef.current = new AbortController();
    pausePolling();
    writeLockRef.current = true;
    try {
      await waitUntilIdle();
      lockTransport();
      if (!tagIsPresent(scan, presentKeys))
        throw new Error("Tieni il tag fermo sul lettore prima di scrivere.");
      setWriteSession({ uid: scan.uid });
      setOperationNote("Modalità scrittura attiva. Poll e discovery sono in pausa.");
    } catch (error) {
      unlockTransport();
      resumePolling();
      writeLockRef.current = false;
      const message = nfcProtocolErrorMessage(error);
      setError(message);
      throw error instanceof Error ? new Error(message) : error;
    }
  }

  function cancelWriteSession() {
    writeAbortRef.current?.abort();
    writeAbortRef.current = null;
    setOperationNote("");
    if (lock.current) return;
    setError("");
    releaseWriteLock();
  }

  async function operate(scan: TagScan, value?: ModuleTag) {
    if (lock.current) return;
    const exclusive = Boolean(value);
    if (exclusive && !writeLockRef.current)
      throw new Error("Apri prima la modalità Scrivi tag.");
    lock.current = true;
    setBusy(true);
    setError("");
    if (!exclusive) {
      setOperationNote("");
      pausePolling();
    }
    try {
      if (!tagIsPresent(scan, presentKeys))
        throw new Error("Riavvicina lo stesso tag al lettore.");
      const port = scan.simulated ? simulator : bridge;
      if (!port)
        throw new Error(
          "Il firmware NFC attuale non supporta ancora lettura e scrittura della memoria tramite master.",
        );
      if (!exclusive) await waitUntilIdle();
      const target = liveMemoryTarget(scan, exclusive);
      const previous =
        scan.memory && scan.family === "ST25TN01K" && scan.memory.length === 160
          ? {
              uid: scan.uid,
              family: scan.family,
              writable: scan.writable,
              bytes: Uint8Array.from(scan.memory),
            }
          : undefined;
      if (value) setOperationNote("Invio della prima pagina NFC…");
      const memory = value
        ? await writeAndVerifyTag(port, target, value, previous, {
            deadlineMs: 30000,
            signal: writeAbortRef.current?.signal,
          })
        : await nfcDeadline((signal) => port.read(target, signal), 12000);
      if (memory.uid !== scan.uid) throw new Error("Il tag è cambiato.");
      updateMemory(scan, memory, !!value);
      if (scan.simulated) {
        try {
          localStorage.setItem(
            "spaghettilab.nfc.simulated-tag",
            JSON.stringify({ uid: simulator.uid, bytes: Array.from(simulator.bytes) }),
          );
        } catch {
          setError("Memoria del simulatore non salvata nel browser.");
        }
      }
      setOperationNote(
        value ? "Scrittura completata." : "Memoria riletta correttamente.",
      );
      if (value)
        setLibrary((previous) => ({
          ...previous,
          units: [
            ...previous.units.filter((u) => u.uid !== scan.uid),
            { uid: scan.uid, modelId: value.modelId, unitId: value.unitId },
          ],
        }));
    } catch (e) {
      const message = nfcProtocolErrorMessage(e);
      setError(message);
      throw e instanceof Error ? new Error(message) : e;
    } finally {
      if (exclusive) releaseWriteLock();
      else resumePolling();
      lock.current = false;
      setBusy(false);
    }
  }

  function liveMemoryTarget(scan: TagScan, exclusive = false): NfcTarget {
    if (scan.simulated) return scan.target;
    const matches = (
      observations.get(scan.target.bindingId as CoreBindingId) ?? []
    ).filter((tag) => tagUid(tag.uid) === scan.uid);
    const exact = matches.find(
      (tag) => tag.nodeId === scan.target.nodeId && tag.portId === scan.target.antenna,
    );
    const tag = exact ?? (matches.length === 1 ? matches[0] : undefined);
    return {
      ...scan.target,
      ...(tag
        ? {
            nodeId: tag.nodeId ?? scan.target.nodeId,
            antenna: nfcMemoryAntenna(tag.portId),
          }
        : {}),
      exclusive,
    };
  }
  function createDriver(scan: TagScan, name: string) {
    if (!execute || !session) return;
    const current = session.stack.current.authoringMetadata;
    const context = {
      uid: scan.uid,
      scanId: scan.id,
      modelId:
        scan.decoded.kind === "module"
          ? scan.decoded.value.modelId
          : `model-${crypto.randomUUID().slice(0, 8)}`,
      backup: current[DEVICE_RECIPE_DRAFT_META_KEY]?.comment ?? "",
    };
    const draft = createBlankDraft("i2c", name || scan.name);
    execute({
      kind: "CreateNfcDriver",
      apply: (project) => ({
        ok: true,
        value: {
          ...project,
          authoringMetadata: {
            ...project.authoringMetadata,
            [NFC_CONTEXT_META]: { comment: JSON.stringify(context) },
            [DEVICE_RECIPE_DRAFT_META_KEY]: {
              comment: serializeDeviceRecipeDraft(draft),
            },
          },
        },
      }),
    });
    setPopup(undefined);
    navigate("device-recipe-editor");
  }
  function cancelDriver() {
    const raw = session?.stack.current.authoringMetadata[NFC_CONTEXT_META]?.comment;
    if (!raw || !execute) return false;
    const context = JSON.parse(raw) as { backup: string; scanId: string };
    execute({
      kind: "CloseNfcDriverEditor",
      apply: (project) => ({
        ok: true,
        value: {
          ...project,
          authoringMetadata: {
            ...project.authoringMetadata,
            [NFC_CONTEXT_META]: { comment: "" },
            [DEVICE_RECIPE_DRAFT_META_KEY]: { comment: context.backup },
          },
        },
      }),
    });
    setSelectedId(context.scanId);
    navigate("nfc-tags");
    return true;
  }
  function finishDriver(draft: DeviceRecipeDraft, completed: boolean) {
    const raw = session?.stack.current.authoringMetadata[NFC_CONTEXT_META]?.comment;
    if (!raw || !execute) return false;
    const context = JSON.parse(raw) as {
      uid: string;
      scanId: string;
      modelId: string;
      backup: string;
    };
    const readyDraft = completed ? { ...draft, status: "ready" as const } : draft;
    setLibrary((previous) => {
      const next = addLibraryDriver(previous, readyDraft);
      if (!completed) return next;
      return {
        ...next,
        models: [
          ...next.models.filter((m) => m.id !== context.modelId),
          {
            id: context.modelId,
            name: draft.name,
            driverId: draft.id,
            driverVersion: String(draft.updatedAt),
            origin: "local",
          },
        ],
        units: [
          ...next.units.filter((u) => u.uid !== context.uid),
          { uid: context.uid, modelId: context.modelId, unitId: context.uid },
        ],
      };
    });
    if (!completed)
      execute({
        kind: "SaveNfcDriverDraft",
        apply: (project) => ({
          ok: true,
          value: {
            ...project,
            authoringMetadata: {
              ...project.authoringMetadata,
              [DEVICE_RECIPE_DRAFT_META_KEY]: {
                comment: serializeDeviceRecipeDraft(draft),
              },
            },
          },
        }),
      });
    if (completed) {
      execute({
        kind: "FinishNfcDriver",
        apply: (project) => ({
          ok: true,
          value: {
            ...project,
            authoringMetadata: {
              ...project.authoringMetadata,
              [NFC_CONTEXT_META]: { comment: "" },
              [DEVICE_RECIPE_DRAFT_META_KEY]: { comment: context.backup },
            },
          },
        }),
      });
      setSelectedId(context.scanId);
      navigate("nfc-tags");
      const scan = history.find((s) => s.id === context.scanId);
      if (scan) setPopup(scan);
    }
    return true;
  }
  return (
    <Context.Provider
      value={{
        library,
        history: history.map((scan) => applyLibraryToScan(scan, library)),
        selected: (() => {
          const scan = history.find((s) => s.id === selectedId) ?? history[0];
          return scan ? applyLibraryToScan(scan, library) : undefined;
        })(),
        presentKeys,
        popup: popup ? applyLibraryToScan(popup, library) : undefined,
        toast: toast ? applyLibraryToScan(toast, library) : undefined,
        busy,
        error,
        operationNote,
        sound,
        simulator,
        writeSession,
        setSimulationFailure: (value) => {
          simulator.setFailure(value);
        },
        openTag,
        deleteTag,
        markAllRead: () => setHistory((h) => h.map((s) => ({ ...s, read: true }))),
        setSound,
        dismissToast: () => setToast(undefined),
        showModule: setPopup,
        dismissModule: () => setPopup(undefined),
        simulate,
        readTag: (scan) => operate(scan),
        beginWriteSession,
        cancelWriteSession,
        writeTag: (scan, value) => operate(scan, value),
        updateLibrary: setLibrary,
        createDriver,
        finishDriver,
        cancelDriver,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useNfcWorkspace() {
  const value = useContext(Context);
  if (!value) throw new Error("NFC workspace provider missing");
  return value;
}
