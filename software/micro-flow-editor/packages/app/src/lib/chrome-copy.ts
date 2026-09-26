import type { LocaleId } from "./locale.js";
import type { SettingsCategoryId, SettingsGroupId } from "./settings-catalog.js";

type ChromeCopy = {
  readonly settings: string;
  readonly searchSettings: string;
  readonly noResults: string;
  readonly close: string;
  readonly modeBase: string;
  readonly modeAdvanced: string;
  readonly modeCurrent: string;
  readonly modeAdvancedHelp: string;
  readonly tourReplay: string;
  readonly tourReplayAction: string;
  readonly tourReplayHelp: string;
  readonly comingSoon: string;
  readonly comingSoonBody: string;
  readonly languageHelp: string;
  readonly noActiveCore: string;
  readonly collapseRail: string;
  readonly expandRail: string;
  readonly hideHint: string;
  readonly tourNext: string;
  readonly tourDone: string;
  readonly goToPrefix: string;
  readonly screens: {
    readonly coreConnections: string;
    readonly catalogTopology: string;
    readonly physicalComposition: string;
    readonly deviceProfiles: string;
    readonly processingGraph: string;
    readonly deployDiff: string;
    readonly runtimeDiagnostics: string;
    readonly capabilityMarketplace: string;
    readonly automations: string;
    readonly security: string;
    readonly market: string;
    readonly generateSchematic: string;
    readonly education: string;
    readonly datasheets: string;
  };
  readonly palette: {
    readonly catalogTopology: string;
    readonly physicalComposition: string;
    readonly deviceProfileStudio: string;
    readonly processingGraph: string;
    readonly capabilityMarketplace: string;
    readonly security: string;
    readonly saveProject: string;
    readonly undo: string;
    readonly redo: string;
    readonly enableAdvanced: string;
    readonly disableAdvanced: string;
    readonly searchPlaceholder: string;
    readonly saving: string;
    readonly saved: string;
    readonly saveFailed: string;
  };
  readonly groups: Record<SettingsGroupId, string>;
  readonly categories: Record<SettingsCategoryId, { readonly label: string; readonly title: string; readonly subtitle: string }>;
};

const IT: ChromeCopy = {
  settings: "Impostazioni",
  searchSettings: "Cerca",
  noResults: "Nessun risultato.",
  close: "Chiudi",
  modeBase: "base",
  modeAdvanced: "avanzata",
  modeCurrent: "Modalità",
  modeAdvancedHelp: "Authoring profili, marketplace OTA, automazione multi-Core",
  tourReplay: "Tutorial introduttivo",
  tourReplayAction: "Rivedi il tutorial",
  tourReplayHelp: "La guida mostrata alla prima apertura, con le zone principali della shell.",
  comingSoon: "Non ancora disponibile",
  comingSoonBody: "La categoria è riservata. Quando servirà, si aggiunge qui senza cambiare la shell.",
  languageHelp: "Nome e bandiera della lingua dell'interfaccia. Tutte le schermate seguono questa lingua.",
  noActiveCore: "Nessun Core attivo",
  collapseRail: "Comprimi",
  expandRail: "Espandi",
  hideHint: "Nascondi",
  tourNext: "Avanti",
  tourDone: "Fine",
  goToPrefix: "Vai a:",
  screens: {
    coreConnections: "Core Connections",
    catalogTopology: "Catalog & Topology",
    physicalComposition: "Physical Composition",
    deviceProfiles: "Device Profiles",
    processingGraph: "Processing Graph",
    deployDiff: "Deploy & Diff",
    runtimeDiagnostics: "Runtime & Diagnostics",
    capabilityMarketplace: "Capability Marketplace",
    automations: "Automazioni",
    security: "Sicurezza",
    market: "Market",
    generateSchematic: "Genera schematico e PCB",
    education: "Formazione",
    datasheets: "Datasheet e istruzioni",
  },
  palette: {
    catalogTopology: "Catalog & Topology Explorer",
    physicalComposition: "Physical Composition Editor",
    deviceProfileStudio: "Device Profile Studio",
    processingGraph: "Processing Graph Editor",
    capabilityMarketplace: "Capability Marketplace & OTA",
    security: "Sicurezza e recupero",
    saveProject: "Salva progetto",
    undo: "Annulla ultima modifica",
    redo: "Ripeti ultima modifica",
    enableAdvanced: "Attiva modalità avanzata",
    disableAdvanced: "Disattiva modalità avanzata",
    searchPlaceholder: "Cerca un comando o una schermata...",
    saving: "Salvataggio...",
    saved: "Progetto salvato",
    saveFailed: "Salvataggio non riuscito",
  },
  groups: {
    application: "Applicazione",
    security: "Sicurezza",
    project: "Progetto",
    runtime: "Runtime",
    editor: "Editor",
  },
  categories: {
    general: { label: "Generale", title: "Generale", subtitle: "Modalità dell'interfaccia e preferenze di chrome." },
    language: { label: "Lingua", title: "Lingua", subtitle: "Lingua della chrome, con nome e bandiera." },
    appearance: { label: "Aspetto", title: "Aspetto", subtitle: "Tema e densità dell'interfaccia." },
    credentials: { label: "Credenziali", title: "Credenziali", subtitle: "Riferimenti opachi, mai il valore del segreto." },
    permissions: { label: "Permessi", title: "Permessi", subtitle: "Matrice locale degli scope." },
    audit: { label: "Audit", title: "Audit", subtitle: "Registro delle azioni locali." },
    recovery: { label: "Recovery", title: "Recovery", subtitle: "Piani di recupero guidati." },
    privacy: { label: "Privacy", title: "Privacy", subtitle: "Dati locali e telemetria host." },
    backup: { label: "Backup", title: "Backup & versioni", subtitle: "Salvataggi e cronologia del progetto aperto." },
    "import-export": { label: "Import/Export", title: "Import/Export", subtitle: "Progetti e profili, mai un'importazione silenziosa." },
    nodered: { label: "Node-RED", title: "Node-RED", subtitle: "Server host per le automazioni, locale o in rete." },
    "core-catalog": { label: "Catalogo Core", title: "Catalogo Core", subtitle: "Driver già presenti sul Core, richiesti con GET_CATALOG." },
    updates: { label: "Aggiornamenti", title: "Aggiornamenti", subtitle: "App host e canale di rilascio." },
    editor: { label: "Editor", title: "Editor", subtitle: "Griglia, snap e preferenze dei grafi." },
    keyboard: { label: "Tastiera", title: "Tastiera", subtitle: "Scorciatoie della chrome." },
    notifications: { label: "Notifiche", title: "Notifiche", subtitle: "Avvisi di deploy, OTA e sessione." },
  },
};

const EN: ChromeCopy = {
  settings: "Settings",
  searchSettings: "Search",
  noResults: "No results.",
  close: "Close",
  modeBase: "base",
  modeAdvanced: "advanced",
  modeCurrent: "Mode",
  modeAdvancedHelp: "Profile authoring, OTA marketplace, multi-Core automation",
  tourReplay: "Introductory tour",
  tourReplayAction: "Replay the tour",
  tourReplayHelp: "The guide shown on first launch, covering the shell's main zones.",
  comingSoon: "Not available yet",
  comingSoonBody: "This category is reserved. When it is needed it can be added here without changing the shell.",
  languageHelp: "Interface language, shown with name and flag. Every screen follows this language.",
  noActiveCore: "No active Core",
  collapseRail: "Collapse",
  expandRail: "Expand",
  hideHint: "Hide",
  tourNext: "Next",
  tourDone: "Done",
  goToPrefix: "Go to:",
  screens: {
    coreConnections: "Core Connections",
    catalogTopology: "Catalog & Topology",
    physicalComposition: "Physical Composition",
    deviceProfiles: "Device Profiles",
    processingGraph: "Processing Graph",
    deployDiff: "Deploy & Diff",
    runtimeDiagnostics: "Runtime & Diagnostics",
    capabilityMarketplace: "Capability Marketplace",
    automations: "Automations",
    security: "Security",
    market: "Market",
    generateSchematic: "Generate schematic and PCB",
    education: "Education",
    datasheets: "Datasheets and instructions",
  },
  palette: {
    catalogTopology: "Catalog & Topology Explorer",
    physicalComposition: "Physical Composition Editor",
    deviceProfileStudio: "Device Profile Studio",
    processingGraph: "Processing Graph Editor",
    capabilityMarketplace: "Capability Marketplace & OTA",
    security: "Security and recovery",
    saveProject: "Save project",
    undo: "Undo last change",
    redo: "Redo last change",
    enableAdvanced: "Enable advanced mode",
    disableAdvanced: "Disable advanced mode",
    searchPlaceholder: "Search a command or screen...",
    saving: "Saving...",
    saved: "Project saved",
    saveFailed: "Save failed",
  },
  groups: {
    application: "Application",
    security: "Security",
    project: "Project",
    runtime: "Runtime",
    editor: "Editor",
  },
  categories: {
    general: { label: "General", title: "General", subtitle: "Interface mode and chrome preferences." },
    language: { label: "Language", title: "Language", subtitle: "Chrome language, with name and flag." },
    appearance: { label: "Appearance", title: "Appearance", subtitle: "Theme and interface density." },
    credentials: { label: "Credentials", title: "Credentials", subtitle: "Opaque references, never the secret value." },
    permissions: { label: "Permissions", title: "Permissions", subtitle: "Local scope matrix." },
    audit: { label: "Audit", title: "Audit", subtitle: "Local action log." },
    recovery: { label: "Recovery", title: "Recovery", subtitle: "Guided recovery plans." },
    privacy: { label: "Privacy", title: "Privacy", subtitle: "Local data and host telemetry." },
    backup: { label: "Backup", title: "Backup & versions", subtitle: "Saves and history of the open project." },
    "import-export": { label: "Import/Export", title: "Import/Export", subtitle: "Projects and profiles, never a silent import." },
    nodered: { label: "Node-RED", title: "Node-RED", subtitle: "Host server for automations, local or on the network." },
    "core-catalog": { label: "Core catalog", title: "Core catalog", subtitle: "Drivers already on the Core, fetched with GET_CATALOG." },
    updates: { label: "Updates", title: "Updates", subtitle: "Host app and release channel." },
    editor: { label: "Editor", title: "Editor", subtitle: "Grid, snap and graph preferences." },
    keyboard: { label: "Keyboard", title: "Keyboard", subtitle: "Chrome shortcuts." },
    notifications: { label: "Notifications", title: "Notifications", subtitle: "Deploy, OTA and session alerts." },
  },
};

const COPY: Record<LocaleId, ChromeCopy> = { it: IT, en: EN };

export function chromeCopy(locale: LocaleId): ChromeCopy {
  return COPY[locale];
}
