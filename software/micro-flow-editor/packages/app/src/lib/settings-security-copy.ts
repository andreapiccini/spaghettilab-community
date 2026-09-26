import type { LocaleId } from "./locale.js";

type SettingsSecurityCopy = {
  readonly title: string;
  readonly tabs: {
    readonly interface: string;
    readonly credentials: string;
    readonly backup: string;
    readonly importExport: string;
    readonly permissions: string;
    readonly audit: string;
    readonly recovery: string;
  };
  readonly interfaceTitle: string;
  readonly interfaceBody: string;
  readonly credentialsBody: string;
  readonly noCredentials: string;
  readonly remove: string;
  readonly confirmDestructive: string;
  readonly retypeExact: string;
  readonly confirm: string;
  readonly modeBase: string;
  readonly modeAdvanced: string;
  readonly importTitle: string;
  readonly chooseFile: string;
  readonly duplicateId: string;
  readonly importNewId: string;
  readonly overwriteExisting: string;
  readonly importAction: string;
  readonly cancel: string;
  readonly exportTitle: string;
  readonly noOpenProject: string;
  readonly excludedAuto: string;
  readonly excludedHint: string;
  readonly includeImages: string;
  readonly includeImagesHint: string;
  readonly includeLive: string;
  readonly includeLiveHint: string;
  readonly downloadExport: string;
  readonly suspiciousKeys: (count: number) => string;
  readonly notSavedThisSession: string;
  readonly saving: string;
  readonly saved: string;
  readonly saveError: string;
  readonly saveNow: string;
  readonly versionHistory: string;
  readonly noVersions: string;
  readonly restoreDisabledTitle: string;
  readonly cannotReadHistory: string;
  readonly restore: string;
  readonly allOperations: string;
  readonly noEntries: string;
  readonly timestamp: string;
  readonly operation: string;
  readonly target: string;
  readonly outcome: string;
  readonly auditGap: string;
  readonly projectGroup: string;
  readonly granted: string;
  readonly missingPermission: string;
  readonly permissionsGap: string;
  readonly refresh: string;
  readonly destructive: string;
  readonly recovery: {
    readonly coreReplaced: string;
    readonly deviceIdMismatch: string;
    readonly configCorrupt: string;
    readonly catalogIncompatible: string;
    readonly otaRollback: string;
    readonly nodeRedUnreachable: string;
  };
};

const IT: SettingsSecurityCopy = {
  title: "Sicurezza e recupero",
  tabs: {
    interface: "Interfaccia",
    credentials: "Credenziali",
    backup: "Backup & Versioni",
    importExport: "Import/Export",
    permissions: "Permessi",
    audit: "Audit",
    recovery: "Recovery",
  },
  interfaceTitle: "Modalità interfaccia",
  interfaceBody:
    "Modalità avanzata mostra Catalog & Topology, Device Profile Studio, Capability Marketplace, Cross-Core Automation e questa scheda Permessi/Audit/Recovery.",
  credentialsBody: "Solo riferimenti opachi alle credenziali — mai il valore del segreto, in nessuno stato di questa schermata.",
  noCredentials: "Nessuna credenziale registrata.",
  remove: "Rimuovi",
  confirmDestructive: "Conferma operazione distruttiva",
  retypeExact: "Ridigita esattamente",
  confirm: "Conferma",
  modeBase: "Base",
  modeAdvanced: "Avanzata",
  importTitle: "Importa progetto",
  chooseFile: "Scegli file",
  duplicateId: "ID progetto già esistente — scegli come procedere.",
  importNewId: "Importa con nuovo ID",
  overwriteExisting: "Sovrascrivi esistente",
  importAction: "Importa",
  cancel: "Annulla",
  exportTitle: "Esporta progetto",
  noOpenProject: "Nessun progetto aperto.",
  excludedAuto: "Escluso automaticamente",
  excludedHint: "Credenziali, valori record live — mai inclusi, nessuna opzione per abilitarli.",
  includeImages: "Includi immagini",
  includeImagesHint: "(inerte oggi — ProjectV1 non ha ancora campi immagine)",
  includeLive: "Includi record live più recenti",
  includeLiveHint: "(inerte oggi — ProjectV1 non ha ancora campi record live)",
  downloadExport: "Scarica export",
  suspiciousKeys: (count) =>
    `${count} ${count === 1 ? "chiave" : "chiavi"} dall'aspetto sospetto (segreto?) trovate — verificale prima di condividere l'export.`,
  notSavedThisSession: "Non salvato in questa sessione",
  saving: "Salvataggio…",
  saved: "Salvato",
  saveError: "Errore salvataggio",
  saveNow: "Salva ora",
  versionHistory: "Cronologia versioni",
  noVersions: "Nessuna versione salvata da questo tab.",
  restoreDisabledTitle:
    "Il pacchetto non espone un modo per leggere il contenuto di una revisione storica specifica, solo la più recente",
  cannotReadHistory: "Impossibile leggere la cronologia.",
  restore: "Ripristina",
  allOperations: "Tutte le operazioni",
  noEntries: "Nessuna voce.",
  timestamp: "Timestamp",
  operation: "Operazione",
  target: "Target",
  outcome: "Esito",
  auditGap:
    "Gap onesto: nessuno screen di questa app chiama ancora `recordSensitiveOperation()` — questo registro è reale (append-only, `localStorage`), ma resta vuoto finché quel cablaggio non viene fatto in ciascuno screen.",
  projectGroup: "Progetto",
  granted: "Consentita",
  missingPermission: "Permesso mancante",
  permissionsGap:
    "Gap onesto: nessun sistema di login/permessi reale esiste ancora — ogni scope è concesso da un placeholder temporaneo (`permission-placeholder.ts`), in attesa di `ecosystem-access-v1`.",
  refresh: "Aggiorna",
  destructive: "distruttivo",
  recovery: {
    coreReplaced: "Core sostituito",
    deviceIdMismatch: "Device ID mismatch",
    configCorrupt: "Config corrotto/assente",
    catalogIncompatible: "Catalogo incompatibile",
    otaRollback: "OTA rollback",
    nodeRedUnreachable: "Node-RED irraggiungibile",
  },
};

const EN: SettingsSecurityCopy = {
  title: "Security and recovery",
  tabs: {
    interface: "Interface",
    credentials: "Credentials",
    backup: "Backup & Versions",
    importExport: "Import/Export",
    permissions: "Permissions",
    audit: "Audit",
    recovery: "Recovery",
  },
  interfaceTitle: "Interface mode",
  interfaceBody:
    "Advanced mode shows Catalog & Topology, Device Profile Studio, Capability Marketplace, Cross-Core Automation and this Permissions/Audit/Recovery tab.",
  credentialsBody: "Opaque credential references only — never the secret value, in any state of this screen.",
  noCredentials: "No credential registered.",
  remove: "Remove",
  confirmDestructive: "Confirm destructive operation",
  retypeExact: "Retype exactly",
  confirm: "Confirm",
  modeBase: "Base",
  modeAdvanced: "Advanced",
  importTitle: "Import project",
  chooseFile: "Choose file",
  duplicateId: "Project ID already exists — choose how to proceed.",
  importNewId: "Import with a new ID",
  overwriteExisting: "Overwrite existing",
  importAction: "Import",
  cancel: "Cancel",
  exportTitle: "Export project",
  noOpenProject: "No project open.",
  excludedAuto: "Excluded automatically",
  excludedHint: "Credentials, live record values — never included, no option to enable them.",
  includeImages: "Include images",
  includeImagesHint: "(inert today — ProjectV1 has no image fields yet)",
  includeLive: "Include most recent live records",
  includeLiveHint: "(inert today — ProjectV1 has no live-record fields yet)",
  downloadExport: "Download export",
  suspiciousKeys: (count) =>
    `${count} suspicious-looking key${count === 1 ? "" : "s"} (secret?) found — check them before sharing the export.`,
  notSavedThisSession: "Not saved in this session",
  saving: "Saving…",
  saved: "Saved",
  saveError: "Save error",
  saveNow: "Save now",
  versionHistory: "Version history",
  noVersions: "No version saved from this tab.",
  restoreDisabledTitle: "The package does not expose a way to read a specific historical revision, only the latest",
  cannotReadHistory: "Unable to read the history.",
  restore: "Restore",
  allOperations: "All operations",
  noEntries: "No entries.",
  timestamp: "Timestamp",
  operation: "Operation",
  target: "Target",
  outcome: "Outcome",
  auditGap:
    "Honest gap: no screen in this app calls `recordSensitiveOperation()` yet — this log is real (append-only, `localStorage`), but stays empty until that wiring is done on each screen.",
  projectGroup: "Project",
  granted: "Granted",
  missingPermission: "Permission missing",
  permissionsGap:
    "Honest gap: no real login/permission system exists yet — every scope is granted by a temporary placeholder (`permission-placeholder.ts`), pending `ecosystem-access-v1`.",
  refresh: "Refresh",
  destructive: "destructive",
  recovery: {
    coreReplaced: "Core replaced",
    deviceIdMismatch: "Device ID mismatch",
    configCorrupt: "Config corrupt/missing",
    catalogIncompatible: "Incompatible catalog",
    otaRollback: "OTA rollback",
    nodeRedUnreachable: "Node-RED unreachable",
  },
};

const COPY: Record<LocaleId, SettingsSecurityCopy> = { it: IT, en: EN };

export function settingsSecurityCopy(locale: LocaleId): SettingsSecurityCopy {
  return COPY[locale];
}
