import type { LocaleId } from "./locale.js";

type MarketplaceCopy = {
  readonly title: string;
  readonly coresReady: (total: number, ready: number) => string;
  readonly noCore: string;
  readonly tabMarketplace: string;
  readonly tabPreflight: string;
  readonly tabUpdate: string;
  readonly available: string;
  readonly installed: string;
  readonly required: string;
  readonly searchPacks: string;
  readonly importIndex: string;
  readonly availableGap: string;
  readonly noIndex: string;
  readonly none: string;
  readonly notRequested: string;
  readonly refresh: string;
  readonly noMissingTypes: string;
  readonly usedBy: (count: number) => string;
  readonly requiredGap: string;
  readonly flash: string;
  readonly staticRam: string;
  readonly rulesUsed: string;
  readonly blocksUsed: string;
  readonly dependencies: string;
  readonly packInstallGap: string;
  readonly trusted: string;
  readonly untrusted: string;
  readonly local: string;
  readonly noOtaCandidate: string;
  readonly waitingCore: string;
  readonly startOta: string;
  readonly resourceBudget: string;
  readonly noReadyCandidate: string;
  readonly arm: string;
  readonly uploadImage: string;
  readonly cancel: string;
  readonly finalize: string;
  readonly waitingReboot: string;
  readonly state: string;
  readonly transport: string;
  readonly imageConfirmed: string;
  readonly yes: string;
  readonly no: string;
  readonly postflightHelp: string;
  readonly verifyPostflight: string;
  readonly outcomes: Record<string, string>;
  readonly dimension: string;
  readonly requiredBytes: string;
  readonly capacity: string;
  readonly margin: string;
  readonly preflightBlocked: (count: number) => string;
};

const IT: MarketplaceCopy = {
  title: "Capability Marketplace & OTA",
  coresReady: (total, ready) => `${total} Core · ${ready} pronti`,
  noCore: "Nessun Core connesso e pronto — connetti un Core (Core Connections) per sfogliare pack, profili e OTA.",
  tabMarketplace: "Marketplace",
  tabPreflight: "Preflight",
  tabUpdate: "Aggiornamento",
  available: "Disponibili",
  installed: "Installati",
  required: "Richiesti",
  searchPacks: "Cerca pack…",
  importIndex: "Importa indice",
  availableGap:
    'Gap onesto: nessuna operazione wire elenca artifact scaricabili — importa un indice JSON del marketplace. Il kind "Device Profile" non ha una fonte marketplace: autora/importa in Device Profile Studio.',
  noIndex: "Nessun indice marketplace importato.",
  none: "Nessuno.",
  notRequested: "Non ancora richiesto.",
  refresh: "Aggiorna",
  noMissingTypes:
    "Nessun tipo richiesto mancante — tutto ciò che i grafi di questo Core usano risulta installato o non verificabile via wire.",
  usedBy: (count) => `usato da ${count}`,
  requiredGap:
    'Gap onesto: solo `module-driver` è verificabile contro dati wire reali (`GET_CATALOG`). `block`/`rule` non hanno un elenco tipi installati sul wire (`GET_FEATURES` riporta solo un conteggio) — qui sono trattati sempre come "non confermati installati".',
  flash: "Flash",
  staticRam: "RAM statica",
  rulesUsed: "Rule usate",
  blocksUsed: "Block usati",
  dependencies: "Dipendenze",
  packInstallGap:
    "Gap onesto: un Capability Pack non è installabile da solo — arriva solo dentro un'immagine firmware OTA. Importa nel tab Preflight il manifest di un'immagine OTA che include questo pack.",
  trusted: "Verificato",
  untrusted: "Non fidato",
  local: "Locale",
  noOtaCandidate:
    "Nessun candidato OTA importato — nessuna operazione wire elenca immagini firmware scaricabili, importa direttamente il manifest JSON di una build.",
  waitingCore: "In attesa dello stato del Core…",
  startOta: "Avvia OTA",
  resourceBudget: "Budget risorse",
  noReadyCandidate: 'Nessun candidato pronto — completa il tab Preflight con esito "Pronto" prima di avviare l\'OTA.',
  arm: "Arma",
  uploadImage: "Carica immagine firmware (.bin)",
  cancel: "Annulla",
  finalize: "Finalizza",
  waitingReboot: "In attesa del riavvio del Core.",
  state: "stato",
  transport: "trasporto",
  imageConfirmed: "immagine confermata",
  yes: "sì",
  no: "no",
  postflightHelp:
    'Nessuna operazione wire espone "prova"/"conferma"/"rollback" esplicitamente — riconnetti il Core da Core Connections dopo il riavvio, poi premi Verifica per confrontare lo snapshot prima/dopo.',
  verifyPostflight: "Verifica postflight",
  outcomes: {
    READY: "Pronto",
    REJECTED_UNTRUSTED: "Fonte non fidata",
    REJECTED_HASH_MISMATCH: "Hash non corrispondente",
    REJECTED_CORE_VARIANT: "Variante Core incompatibile",
    REJECTED_RESOURCE_PROFILE: "Resource profile incompatibile",
    REJECTED_COORDINATOR_BUSY: "Coordinator OTA occupato",
    REJECTED_POSSIBLE_DOWNGRADE: "Possibile downgrade",
    REJECTED_BOOTLOADER_TOO_OLD: "Bootloader troppo vecchio",
    REJECTED_PROTOCOL_TOO_OLD: "Protocollo troppo vecchio",
    REJECTED_CONFIG_VERSION_TOO_OLD: "Versione Config troppo vecchia",
    REJECTED_ABI_TOO_NEW: "ABI troppo nuova",
    REJECTED_CONFIG_TYPE_REMOVED: "Config referenzia un tipo rimosso",
    REJECTED_BUDGET_EXCEEDED: "Budget risorse superato",
  },
  dimension: "Dimensione",
  requiredBytes: "Richiesto",
  capacity: "Capacità",
  margin: "Margine",
  preflightBlocked: (count) => `Preflight bloccato — vedi ${count} dimensioni fuori budget sopra.`,
};

const EN: MarketplaceCopy = {
  title: "Capability Marketplace & OTA",
  coresReady: (total, ready) => `${total} Core · ${ready} ready`,
  noCore: "No Core connected and ready — connect a Core (Core Connections) to browse packs, profiles and OTA.",
  tabMarketplace: "Marketplace",
  tabPreflight: "Preflight",
  tabUpdate: "Update",
  available: "Available",
  installed: "Installed",
  required: "Required",
  searchPacks: "Search packs…",
  importIndex: "Import index",
  availableGap:
    'Honest gap: no wire operation lists downloadable artifacts — import a marketplace JSON index. The "Device Profile" kind has no marketplace source: author/import it in Device Profile Studio.',
  noIndex: "No marketplace index imported.",
  none: "None.",
  notRequested: "Not requested yet.",
  refresh: "Refresh",
  noMissingTypes:
    "No required types missing — everything this Core's graphs use is installed or not verifiable over the wire.",
  usedBy: (count) => `used by ${count}`,
  requiredGap:
    'Honest gap: only `module-driver` is verifiable against real wire data (`GET_CATALOG`). `block`/`rule` have no installed-type list on the wire (`GET_FEATURES` reports only a count) — they are always treated as "not confirmed installed" here.',
  flash: "Flash",
  staticRam: "Static RAM",
  rulesUsed: "Rules used",
  blocksUsed: "Blocks used",
  dependencies: "Dependencies",
  packInstallGap:
    "Honest gap: a Capability Pack cannot be installed alone — it only arrives inside an OTA firmware image. Import an OTA image manifest that includes this pack in the Preflight tab.",
  trusted: "Verified",
  untrusted: "Untrusted",
  local: "Local",
  noOtaCandidate:
    "No OTA candidate imported — no wire operation lists downloadable firmware images; import a build's JSON manifest directly.",
  waitingCore: "Waiting for Core status…",
  startOta: "Start OTA",
  resourceBudget: "Resource budget",
  noReadyCandidate: 'No ready candidate — finish the Preflight tab with a "Ready" result before starting OTA.',
  arm: "Arm",
  uploadImage: "Upload firmware image (.bin)",
  cancel: "Cancel",
  finalize: "Finalize",
  waitingReboot: "Waiting for the Core to reboot.",
  state: "state",
  transport: "transport",
  imageConfirmed: "image confirmed",
  yes: "yes",
  no: "no",
  postflightHelp:
    'No wire operation exposes "trial"/"confirm"/"rollback" explicitly — reconnect the Core from Core Connections after reboot, then press Verify to compare the before/after snapshot.',
  verifyPostflight: "Verify postflight",
  outcomes: {
    READY: "Ready",
    REJECTED_UNTRUSTED: "Untrusted source",
    REJECTED_HASH_MISMATCH: "Hash mismatch",
    REJECTED_CORE_VARIANT: "Incompatible Core variant",
    REJECTED_RESOURCE_PROFILE: "Incompatible resource profile",
    REJECTED_COORDINATOR_BUSY: "OTA coordinator busy",
    REJECTED_POSSIBLE_DOWNGRADE: "Possible downgrade",
    REJECTED_BOOTLOADER_TOO_OLD: "Bootloader too old",
    REJECTED_PROTOCOL_TOO_OLD: "Protocol too old",
    REJECTED_CONFIG_VERSION_TOO_OLD: "Config version too old",
    REJECTED_ABI_TOO_NEW: "ABI too new",
    REJECTED_CONFIG_TYPE_REMOVED: "Config references a removed type",
    REJECTED_BUDGET_EXCEEDED: "Resource budget exceeded",
  },
  dimension: "Dimension",
  requiredBytes: "Required",
  capacity: "Capacity",
  margin: "Margin",
  preflightBlocked: (count) => `Preflight blocked — see ${count} over-budget dimensions above.`,
};

const COPY: Record<LocaleId, MarketplaceCopy> = { it: IT, en: EN };

export function marketplaceCopy(locale: LocaleId): MarketplaceCopy {
  return COPY[locale];
}
