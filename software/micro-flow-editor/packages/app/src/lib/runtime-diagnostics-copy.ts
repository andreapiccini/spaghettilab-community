import type { LocaleId } from "./locale.js";

type RuntimeDiagnosticsCopy = {
  readonly title: string;
  readonly coresReady: (total: number, ready: number) => string;
  readonly noCore: string;
  readonly tabs: {
    readonly telemetry: string;
    readonly commands: string;
    readonly discovery: string;
    readonly status: string;
    readonly admin: string;
  };
  readonly telemetryBody: string;
  readonly noRecords: string;
  readonly noDecodedValue: string;
  readonly noSnapshot: string;
  readonly imageConfirmed: string;
  readonly yes: string;
  readonly no: string;
  readonly leaseActive: string;
  readonly notRequestedYet: string;
  readonly discoveryBody: string;
  readonly invasiveScan: string;
  readonly scanNotStarted: (kind: string) => string;
  readonly detectedCandidates: (count: number) => string;
  readonly noCandidates: string;
  readonly confidence: (value: string) => string;
  readonly commandsBody: string;
  readonly needsArgs: string;
  readonly adminBody: string;
  readonly durationMs: string;
  readonly mqttHelp: string;
  readonly auditLog: string;
  readonly noEntries: string;
  readonly confirmDestructive: string;
  readonly telemetryGap: string;
};

const IT: RuntimeDiagnosticsCopy = {
  title: "Runtime & Diagnostics",
  coresReady: (total, ready) => `${total} Core · ${ready} pronti`,
  noCore: "Nessun Core connesso e pronto — connetti un Core (Core Connections) per vedere telemetria, comandi e stato qui.",
  tabs: {
    telemetry: "Telemetria",
    commands: "Comandi",
    discovery: "Discovery",
    status: "Stato & Risorse",
    admin: "Amministrazione",
  },
  telemetryBody: "Stream di notifiche in tempo reale — nessuna scrittura su Core o progetto.",
  noRecords: "Nessun record ricevuto finora per questo Core.",
  noDecodedValue: "nessun valore decodificato disponibile",
  noSnapshot: "Nessuno snapshot disponibile per questo Core.",
  imageConfirmed: "Immagine confermata",
  yes: "sì",
  no: "no",
  leaseActive: "Lease attivo",
  notRequestedYet: "Non ancora richiesto.",
  discoveryBody: "Azione immediata sul Core — una scan invasiva può alterare lo stato dell'hardware collegato.",
  invasiveScan: 'Scan invasiva (richiede permesso "core.discovery.invasive-scan")',
  scanNotStarted: (kind) => `Scan non avviata: ${kind}`,
  detectedCandidates: (count) => `Candidati rilevati (${count})`,
  noCandidates: "Nessun candidato al momento",
  confidence: (value) => `confidenza ${value}`,
  commandsBody: "Azione immediata su un Module — non modifica Config né progetto (S092 § Verifiche).",
  needsArgs: "Richiede argomenti (rifiuta localmente — il wire non li supporta)",
  adminBody: "Operazioni immediate sul Core — mai una scrittura di Config o progetto.",
  durationMs: "durata (ms)",
  mqttHelp: "Ferma MQTT per l'intero workspace (e BLE su build minimal) — auto-reversibile ma disruttivo. Richiede conferma.",
  auditLog: "Audit log",
  noEntries: "Nessuna voce.",
  confirmDestructive: "Conferma operazione distruttiva",
  telemetryGap: "Gap onesto: nessun valore di campo è disponibile su questi transport (WebSocket/USB-seriale) — solo provenienza (source, schema, sequenza, boot epoch).",
};

const EN: RuntimeDiagnosticsCopy = {
  title: "Runtime & Diagnostics",
  coresReady: (total, ready) => `${total} Core · ${ready} ready`,
  noCore: "No Core connected and ready — connect a Core (Core Connections) to see telemetry, commands and status here.",
  tabs: {
    telemetry: "Telemetry",
    commands: "Commands",
    discovery: "Discovery",
    status: "Status & Resources",
    admin: "Administration",
  },
  telemetryBody: "Real-time notification stream — no write to the Core or the project.",
  noRecords: "No record received yet for this Core.",
  noDecodedValue: "no decoded value available",
  noSnapshot: "No snapshot available for this Core.",
  imageConfirmed: "Image confirmed",
  yes: "yes",
  no: "no",
  leaseActive: "Active lease",
  notRequestedYet: "Not requested yet.",
  discoveryBody: "Immediate action on the Core — an invasive scan can change the state of attached hardware.",
  invasiveScan: 'Invasive scan (requires the "core.discovery.invasive-scan" permission)',
  scanNotStarted: (kind) => `Scan not started: ${kind}`,
  detectedCandidates: (count) => `Detected candidates (${count})`,
  noCandidates: "No candidates right now",
  confidence: (value) => `confidence ${value}`,
  commandsBody: "Immediate action on a Module — does not change Config or the project (S092 § Checks).",
  needsArgs: "Requires arguments (rejected locally — the wire does not support them)",
  adminBody: "Immediate operations on the Core — never a Config or project write.",
  durationMs: "duration (ms)",
  mqttHelp: "Stops MQTT for the whole workspace (and BLE on minimal builds) — auto-reversible but disruptive. Requires confirmation.",
  auditLog: "Audit log",
  noEntries: "No entries.",
  confirmDestructive: "Confirm destructive operation",
  telemetryGap: "Honest gap: no field value is available on these transports (WebSocket/USB-serial) — only origin (source, schema, sequence, boot epoch).",
};

const COPY: Record<LocaleId, RuntimeDiagnosticsCopy> = { it: IT, en: EN };

export function runtimeDiagnosticsCopy(locale: LocaleId): RuntimeDiagnosticsCopy {
  return COPY[locale];
}
