import type { LocaleId } from "./locale.js";

export type RowActionId =
  | "review-error"
  | "reconnect"
  | "connect"
  | "cancel"
  | "send-to-core"
  | "review-changes"
  | "compare-reconcile"
  | "incompatibility-details"
  | "see-what-changed";

type CoreConnectionsCopy = {
  readonly noCoreShort: string;
  readonly coresOutOfSync: (total: number, outOfSync: number) => string;
  readonly coresCount: (total: number) => string;
  readonly connectACore: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly connectFirst: string;
  readonly disconnect: string;
  readonly error: string;
  readonly actions: Record<RowActionId, string>;
  readonly sync: {
    readonly projectDirty: string;
    readonly deviceChanged: string;
    readonly diverged: string;
    readonly incompatible: string;
  };
  readonly neverDeployed: string;
  readonly relationIdentical: (relation: string) => string;
  readonly relationDecodeFailed: (relation: string, reason: string) => string;
  readonly relationCompileFailed: (relation: string, reason: string) => string;
  readonly relationNoLive: (relation: string) => string;
  readonly na: string;
  readonly compileFailedFallback: string;
  readonly dialogTitle: string;
  readonly nicknameLabel: string;
  readonly nicknamePlaceholder: string;
  readonly methodNetwork: string;
  readonly methodUsb: string;
  readonly websocketAddress: string;
  readonly noCoreFound: string;
  readonly noUsbCore: string;
  readonly safariUsbHelp: string;
  readonly autoHelp: string;
  readonly usbHelp: string;
  readonly retry: string;
  readonly localBridge: string;
  readonly addUsbPort: string;
  readonly cancel: string;
  readonly connecting: string;
  readonly connectCount: (count: number) => string;
  readonly connect: string;
  readonly usbSerialUnavailable: string;
  readonly usbNotACore: string;
};

const IT: CoreConnectionsCopy = {
  noCoreShort: "Nessun Core",
  coresOutOfSync: (total, outOfSync) => `${total} Core · ${outOfSync} non in sync`,
  coresCount: (total) => `${total} Core`,
  connectACore: "Connetti un Core",
  emptyTitle: "Nessun Core connesso",
  emptyBody: "Connetti il tuo primo Core per iniziare a sincronizzare questo progetto.",
  connectFirst: "Connetti il tuo primo Core",
  disconnect: "Disconnetti",
  error: "ERRORE",
  actions: {
    "review-error": "Rivedi errore",
    reconnect: "Riconnetti",
    connect: "Connetti",
    cancel: "Annulla",
    "send-to-core": "Invia al Core",
    "review-changes": "Rivedi modifiche",
    "compare-reconcile": "Confronta e riconcilia",
    "incompatibility-details": "Dettagli incompatibilità",
    "see-what-changed": "Vedi cosa è cambiato",
  },
  sync: {
    projectDirty: "modifiche locali non ancora inviate",
    deviceChanged: "il dispositivo ha uno stato diverso dall'ultimo deploy",
    diverged: "progetto e dispositivo sono cambiati entrambi",
    incompatible: "catalogo/profilo non compatibile con questo progetto",
  },
  neverDeployed:
    "Questo progetto non è mai stato inviato a questo Core (nessun deploy registrato) — DIVERGED qui è il default prudente, non necessariamente un conflitto reale. Il confronto qui sotto mostra comunque cosa cambierebbe un deploy adesso.",
  relationIdentical: (relation) =>
    `Relazione: ${relation} — il Config live e quello ricompilato dal progetto sono in realtà identici in questo momento (la classificazione di sync risale al connect, il progetto potrebbe essere cambiato da allora).`,
  relationDecodeFailed: (relation, reason) =>
    `Relazione: ${relation} — il Config letto dal Core non si è decodificato: ${reason}`,
  relationCompileFailed: (relation, reason) =>
    `Relazione: ${relation} — il progetto non compila in questo momento: ${reason}`,
  relationNoLive: (relation) => `Relazione: ${relation} — nessuna sessione live per questo Core in questo momento.`,
  na: "n/d",
  compileFailedFallback: "il dry-run del progetto ha errori",
  dialogTitle: "Connetti un Core",
  nicknameLabel: "Nome (opzionale)",
  nicknamePlaceholder: "Se vuoto, si usa il nome o l'identificatore del Core",
  methodNetwork: "Core in rete",
  methodUsb: "Core via cavo",
  websocketAddress: "Indirizzo WebSocket",
  noCoreFound: "Nessun Core trovato",
  noUsbCore: "Nessun Core via cavo",
  safariUsbHelp:
    "Safari non apre la USB da solo. Avvia React Flow con make up-d (parte il ponte USB). Chiudi make monitor, poi riprova.",
  autoHelp:
    "Auto interroga le porte USB già autorizzate e il ponte locale avviato con make up-d. Per un Core nuovo usa «Core via cavo».",
  usbHelp: "Autorizza la porta USB del Core. In Safari il ponte parte con make up-d. Chiudi make monitor prima.",
  retry: "Riprova",
  localBridge: "ponte locale",
  addUsbPort: "Aggiungi porta USB…",
  cancel: "Annulla",
  connecting: "Connessione…",
  connectCount: (count) => `Connetti ${count} Core`,
  connect: "Connetti",
  usbSerialUnavailable: "Web Serial non è disponibile in questo browser. Usa Chrome o Edge su HTTPS o localhost.",
  usbNotACore: "La porta risponde, ma non è un Core Spaghetti (Protocol V1).",
};

const EN: CoreConnectionsCopy = {
  noCoreShort: "No Core",
  coresOutOfSync: (total, outOfSync) => `${total} Core · ${outOfSync} out of sync`,
  coresCount: (total) => `${total} Core`,
  connectACore: "Connect a Core",
  emptyTitle: "No Core connected",
  emptyBody: "Connect your first Core to start synchronizing this project.",
  connectFirst: "Connect your first Core",
  disconnect: "Disconnect",
  error: "ERROR",
  actions: {
    "review-error": "Review error",
    reconnect: "Reconnect",
    connect: "Connect",
    cancel: "Cancel",
    "send-to-core": "Send to Core",
    "review-changes": "Review changes",
    "compare-reconcile": "Compare and reconcile",
    "incompatibility-details": "Incompatibility details",
    "see-what-changed": "See what changed",
  },
  sync: {
    projectDirty: "local changes not sent yet",
    deviceChanged: "the device has a different state from the last deploy",
    diverged: "project and device both changed",
    incompatible: "catalog/profile is not compatible with this project",
  },
  neverDeployed:
    "This project has never been sent to this Core (no deploy recorded) — DIVERGED here is the cautious default, not necessarily a real conflict. The comparison below still shows what a deploy would change now.",
  relationIdentical: (relation) =>
    `Relationship: ${relation} — the live Config and the one recompiled from the project are actually identical right now (sync classification dates from connect; the project may have changed since).`,
  relationDecodeFailed: (relation, reason) =>
    `Relationship: ${relation} — the Config read from the Core did not decode: ${reason}`,
  relationCompileFailed: (relation, reason) =>
    `Relationship: ${relation} — the project does not compile right now: ${reason}`,
  relationNoLive: (relation) => `Relationship: ${relation} — no live session for this Core right now.`,
  na: "n/a",
  compileFailedFallback: "the project dry-run has errors",
  dialogTitle: "Connect a Core",
  nicknameLabel: "Name (optional)",
  nicknamePlaceholder: "If empty, the Core name or identifier is used",
  methodNetwork: "Network Core",
  methodUsb: "Wired Core",
  websocketAddress: "WebSocket address",
  noCoreFound: "No Core found",
  noUsbCore: "No wired Core",
  safariUsbHelp:
    "Safari does not open USB by itself. Start React Flow with make up-d (the USB bridge starts). Close make monitor, then retry.",
  autoHelp:
    "Auto queries already-authorized USB ports and the local bridge started with make up-d. For a new Core use “Wired Core”.",
  usbHelp: "Authorize the Core's USB port. In Safari the bridge starts with make up-d. Close make monitor first.",
  retry: "Retry",
  localBridge: "local bridge",
  addUsbPort: "Add USB port…",
  cancel: "Cancel",
  connecting: "Connecting…",
  connectCount: (count) => `Connect ${count} Cores`,
  connect: "Connect",
  usbSerialUnavailable: "Web Serial is not available in this browser. Use Chrome or Edge on HTTPS or localhost.",
  usbNotACore: "The port answers, but it is not a Spaghetti Core (Protocol V1).",
};

const COPY: Record<LocaleId, CoreConnectionsCopy> = { it: IT, en: EN };

export function coreConnectionsCopy(locale: LocaleId): CoreConnectionsCopy {
  return COPY[locale];
}
