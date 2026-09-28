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
  readonly screenTitle: string;
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
  readonly viaCan: (via: string) => string;
  /** USB/Wi-Fi host group in the connect dialog (not a Backbone identity). */
  readonly connectionGroup: (index: number) => string;
  readonly backbone: (index: number) => string;
  readonly masterBackbone: string;
  readonly chainedBackbone: (index: number) => string;
  /** Firmware version label (was "Commit"). */
  readonly fwVersion: (value: string) => string;
  readonly viaCable: string;
  readonly viaWifi: string;
  readonly viaCanShort: string;
  readonly online: string;
  /** One-line cluster summary under the header. */
  readonly clusterSummary: (backbones: number, nfcModules: number) => string;
  /** Card title for a host-linked cluster. */
  readonly clusterTitle: (index: number) => string;
  readonly linkToSoftware: (link: "cable" | "wifi") => string;
  readonly nfcTitle: string;
  readonly nfcEmpty: string;
  readonly nfcEmptyShort: string;
  readonly nfcCountShort: (count: number) => string;
  readonly nfcReading: string;
  readonly nfcPort: (portId: number, label: string) => string;
  /** Position 1 on the Backbone (Connector Module). */
  readonly connectorModule: string;
  /** Position 2 on the Backbone (Interface Module). */
  readonly interfaceModule: string;
  readonly modulePositionShort: (portId: number) => string;
  readonly modulePositionName: (portId: number) => string;
  readonly detectedBanner: (moduleType: string, backbone: string, position: string) => string;
  readonly detectedBannerDismiss: string;
  readonly addUsbPort: string;
  readonly cancel: string;
  readonly connecting: string;
  readonly connectCount: (count: number) => string;
  readonly connect: string;
  readonly usbSerialUnavailable: string;
  readonly usbNotACore: string;
};

const IT: CoreConnectionsCopy = {
  screenTitle: "Clusters",
  emptyTitle: "Nessun cluster connesso",
  emptyBody:
    "Connetti il primo cluster di Backbone per sincronizzare questo progetto.",
  connectFirst: "Connetti il primo cluster",
  connectACore: "Connetti un cluster",
  noCoreShort: "Nessun cluster",
  coresOutOfSync: (total, outOfSync) => `${total} Backbone · ${outOfSync} non in sync`,
  coresCount: (total) => (total === 1 ? "1 Backbone in totale" : `${total} Backbone in totale`),
  disconnect: "Disconnetti",
  error: "ERRORE",
  actions: {
    "review-error": "Rivedi errore",
    reconnect: "Riconnetti",
    connect: "Connetti",
    cancel: "Annulla",
    "send-to-core": "Invia alla Backbone",
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
    "Questo progetto non è mai stato inviato a questa Backbone (nessun deploy registrato) — DIVERGED qui è il default prudente, non necessariamente un conflitto reale. Il confronto qui sotto mostra comunque cosa cambierebbe un deploy adesso.",
  relationIdentical: (relation) =>
    `Relazione: ${relation} — il Config live e quello ricompilato dal progetto sono in realtà identici in questo momento (la classificazione di sync risale al connect, il progetto potrebbe essere cambiato da allora).`,
  relationDecodeFailed: (relation, reason) =>
    `Relazione: ${relation} — il Config letto dalla Backbone non si è decodificato: ${reason}`,
  relationCompileFailed: (relation, reason) =>
    `Relazione: ${relation} — il progetto non compila in questo momento: ${reason}`,
  relationNoLive: (relation) =>
    `Relazione: ${relation} — nessuna sessione live per questa Backbone in questo momento.`,
  na: "n/d",
  compileFailedFallback: "il dry-run del progetto ha errori",
  dialogTitle: "Connetti una Backbone",
  nicknameLabel: "Nome (opzionale)",
  nicknamePlaceholder: "Se vuoto, si usa il nome o l'identificatore della Backbone",
  methodNetwork: "Backbone in rete",
  methodUsb: "Backbone via cavo",
  websocketAddress: "Indirizzo WebSocket",
  noCoreFound: "Nessuna Backbone trovata",
  noUsbCore: "Nessuna Backbone via cavo",
  safariUsbHelp:
    "Safari non apre la USB da solo. Avvia Flow con make up-d (parte il ponte USB). Chiudi make monitor, poi riprova.",
  autoHelp:
    "Auto interroga le porte USB già autorizzate e il ponte locale avviato con make up-d. Per una Backbone nuova usa «Backbone via cavo».",
  usbHelp:
    "Autorizza la porta USB della Backbone. In Safari il ponte parte con make up-d. Chiudi make monitor prima.",
  retry: "Riprova",
  localBridge: "ponte locale",
  viaCan: (via) => `CAN · via ${via}`,
  connectionGroup: (index) => `Cluster ${index}`,
  backbone: (index) => `Backbone ${index}`,
  masterBackbone: "Master Backbone",
  chainedBackbone: (index) => `Backbone ${index}`,
  fwVersion: (value) => `FW ${value}`,
  viaCable: "Cavo",
  viaWifi: "Wi-Fi",
  viaCanShort: "Catena CAN",
  online: "Online",
  clusterSummary: (backbones, nfcModules) =>
    `${backbones === 1 ? "1 Backbone" : `${backbones} Backbone`} · ${nfcModules === 0 ? "0 moduli" : nfcModules === 1 ? "1 modulo" : `${nfcModules} moduli`}`,
  clusterTitle: (index) => `Cluster ${index}`,
  linkToSoftware: (link) => (link === "wifi" ? "Collegamento a Flow: Wi-Fi" : "Collegamento a Flow: Cavo"),
  nfcTitle: "Moduli",
  nfcEmpty: "Nessun modulo connesso",
  nfcEmptyShort: "0 moduli",
  nfcCountShort: (count) => (count === 0 ? "0 moduli" : count === 1 ? "1 modulo" : `${count} moduli`),
  nfcReading: "Lettura moduli…",
  nfcPort: (portId, label) => `Posizione ${portId} · ${label}`,
  connectorModule: "Connector Module",
  interfaceModule: "Interface Module",
  modulePositionShort: (portId) => `${portId}`,
  modulePositionName: (portId) =>
    portId === 1 ? "Connector Module" : portId === 2 ? "Interface Module" : `Posizione ${portId}`,
  detectedBanner: (moduleType, backbone, position) =>
    `Detected ${moduleType} · ${backbone} · ${position}`,
  detectedBannerDismiss: "Nascondi",
  addUsbPort: "Aggiungi porta USB…",
  cancel: "Annulla",
  connecting: "Connessione…",
  connectCount: (count) => `Connetti ${count} Backbone`,
  connect: "Connetti",
  usbSerialUnavailable:
    "Web Serial non è disponibile in questo browser. Usa Chrome o Edge su HTTPS o localhost.",
  usbNotACore: "La porta risponde, ma non è una Backbone Spaghetti (Protocol V1).",
};

const EN: CoreConnectionsCopy = {
  noCoreShort: "No clusters",
  coresOutOfSync: (total, outOfSync) => `${total} Backbone · ${outOfSync} out of sync`,
  coresCount: (total) => (total === 1 ? "1 Backbone total" : `${total} Backbones total`),
  connectACore: "Connect a cluster",
  screenTitle: "Clusters",
  emptyTitle: "No cluster connected",
  emptyBody: "Connect your first Backbone cluster to start synchronizing this project.",
  connectFirst: "Connect your first cluster",
  disconnect: "Disconnect",
  error: "ERROR",
  actions: {
    "review-error": "Review error",
    reconnect: "Reconnect",
    connect: "Connect",
    cancel: "Cancel",
    "send-to-core": "Send to Backbone",
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
    "This project has never been sent to this Backbone (no deploy recorded) — DIVERGED here is the cautious default, not necessarily a real conflict. The comparison below still shows what a deploy would change now.",
  relationIdentical: (relation) =>
    `Relationship: ${relation} — the live Config and the one recompiled from the project are actually identical right now (sync classification dates from connect; the project may have changed since).`,
  relationDecodeFailed: (relation, reason) =>
    `Relationship: ${relation} — the Config read from the Backbone did not decode: ${reason}`,
  relationCompileFailed: (relation, reason) =>
    `Relationship: ${relation} — the project does not compile right now: ${reason}`,
  relationNoLive: (relation) =>
    `Relationship: ${relation} — no live session for this Backbone right now.`,
  na: "n/a",
  compileFailedFallback: "the project dry-run has errors",
  dialogTitle: "Connect a Backbone",
  nicknameLabel: "Name (optional)",
  nicknamePlaceholder: "If empty, the Backbone name or identifier is used",
  methodNetwork: "Network Backbone",
  methodUsb: "Wired Backbone",
  websocketAddress: "WebSocket address",
  noCoreFound: "No Backbone found",
  noUsbCore: "No wired Backbone",
  safariUsbHelp:
    "Safari does not open USB by itself. Start Flow with make up-d (the USB bridge starts). Close make monitor, then retry.",
  autoHelp:
    "Auto queries already-authorized USB ports and the local bridge started with make up-d. For a new Backbone use “Wired Backbone”.",
  usbHelp:
    "Authorize the Backbone's USB port. In Safari the bridge starts with make up-d. Close make monitor first.",
  retry: "Retry",
  localBridge: "local bridge",
  viaCan: (via) => `CAN · via ${via}`,
  connectionGroup: (index) => `Cluster ${index}`,
  backbone: (index) => `Backbone ${index}`,
  masterBackbone: "Master Backbone",
  chainedBackbone: (index) => `Backbone ${index}`,
  fwVersion: (value) => `FW ${value}`,
  viaCable: "Cable",
  viaWifi: "Wi-Fi",
  viaCanShort: "CAN chain",
  online: "Online",
  clusterSummary: (backbones, nfcModules) =>
    `${backbones === 1 ? "1 Backbone" : `${backbones} Backbones`} · ${nfcModules === 0 ? "0 modules" : nfcModules === 1 ? "1 module" : `${nfcModules} modules`}`,
  clusterTitle: (index) => `Cluster ${index}`,
  linkToSoftware: (link) => (link === "wifi" ? "Link to Flow: Wi-Fi" : "Link to Flow: Cable"),
  nfcTitle: "Modules",
  nfcEmpty: "No modules connected",
  nfcEmptyShort: "0 modules",
  nfcCountShort: (count) => (count === 0 ? "0 modules" : count === 1 ? "1 module" : `${count} modules`),
  nfcReading: "Reading modules…",
  nfcPort: (portId, label) => `Position ${portId} · ${label}`,
  connectorModule: "Connector Module",
  interfaceModule: "Interface Module",
  modulePositionShort: (portId) => `${portId}`,
  modulePositionName: (portId) =>
    portId === 1 ? "Connector Module" : portId === 2 ? "Interface Module" : `Position ${portId}`,
  detectedBanner: (moduleType, backbone, position) =>
    `Detected ${moduleType} · ${backbone} · ${position}`,
  detectedBannerDismiss: "Dismiss",
  addUsbPort: "Add USB port…",
  cancel: "Cancel",
  connecting: "Connecting…",
  connectCount: (count) => `Connect ${count} Backbones`,
  connect: "Connect",
  usbSerialUnavailable:
    "Web Serial is not available in this browser. Use Chrome or Edge on HTTPS or localhost.",
  usbNotACore: "The port answers, but it is not a Spaghetti Backbone (Protocol V1).",
};

const COPY: Record<LocaleId, CoreConnectionsCopy> = { it: IT, en: EN };

export function coreConnectionsCopy(locale: LocaleId): CoreConnectionsCopy {
  return COPY[locale];
}
