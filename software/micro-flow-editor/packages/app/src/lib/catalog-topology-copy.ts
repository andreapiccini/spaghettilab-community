import type { LocaleId } from "./locale.js";

type CatalogTopologyCopy = {
  readonly catalog: string;
  readonly topology: string;
  readonly interrupted: string;
  readonly retryRead: string;
  readonly noCore: string;
  readonly noData: string;
  readonly connectAndRead: string;
  readonly noFlow: string;
  readonly direction: string;
  readonly signals: (count: number) => string;
  readonly noFunctionBay: string;
  readonly noRail: string;
  readonly noCoreInProject: string;
  readonly noFieldSchema: string;
  readonly noEntries: string;
  readonly fieldSchema: string;
  readonly commands: (count: number) => string;
  readonly notExposed: string;
  readonly requestFromCore: string;
  readonly requesting: string;
  readonly connectThenRequest: string;
  readonly sessionAbsent: string;
  readonly presentOnCore: (count: number) => string;
  readonly read: string;
  readonly close: string;
  readonly transport: string;
  readonly wireCommands: string;
  readonly quantities: string;
  readonly profilesOnCore: string;
  readonly moduleNone: string;
  readonly directionPrefix: string;
  readonly noneModule: string;
};

const IT: CatalogTopologyCopy = {
  catalog: "Catalogo",
  topology: "Topologia",
  interrupted: "Lettura del catalogo interrotta — i dati mostrati potrebbero essere incompleti.",
  retryRead: "Riprova lettura",
  noCore: "Nessun Core nel progetto — vai a Core Connections per connetterne uno.",
  noData: "Nessun dato disponibile per questo Core.",
  connectAndRead: "Connetti e leggi",
  noFlow: "Nessun Flow riportato da questo Core.",
  direction: "direzione",
  signals: (count) => `${count} segnali`,
  noFunctionBay: "Nessuna Function Bay.",
  noRail: "Nessuna rail.",
  noCoreInProject: "Nessun Core nel progetto.",
  noFieldSchema: "Nessuno schema esposto dal protocollo per questo tipo (S042 gap)",
  noEntries: "Nessuna voce.",
  fieldSchema: "schema di campo",
  commands: (count) => `${count} comandi`,
  notExposed: "Non ancora esposto dal protocollo (S041)",
  requestFromCore: "Richiedi dal Core",
  requesting: "Richiesta…",
  connectThenRequest: "Collega il Core da Core Connections, poi richiedi il catalogo.",
  sessionAbsent: "Sessione Core assente.",
  presentOnCore: (count) => `Presente sul Core · ${count === 1 ? "1 comando" : `${count} comandi`}`,
  read: "Leggi",
  close: "Chiudi",
  transport: "Trasporto",
  wireCommands: "Comandi wire",
  quantities: "Grandezze",
  profilesOnCore: "Profili sul Core",
  moduleNone: "nessuno",
  directionPrefix: "direzione",
  noneModule: "nessuno",
};

const EN: CatalogTopologyCopy = {
  catalog: "Catalog",
  topology: "Topology",
  interrupted: "Catalog read interrupted — the data shown may be incomplete.",
  retryRead: "Retry read",
  noCore: "No Core in the project — go to Core Connections to connect one.",
  noData: "No data available for this Core.",
  connectAndRead: "Connect and read",
  noFlow: "No Flow reported by this Core.",
  direction: "direction",
  signals: (count) => `${count} signal${count === 1 ? "" : "s"}`,
  noFunctionBay: "No Function Bay.",
  noRail: "No rail.",
  noCoreInProject: "No Core in the project.",
  noFieldSchema: "No schema exposed by the protocol for this type (S042 gap)",
  noEntries: "No entries.",
  fieldSchema: "field schema",
  commands: (count) => `${count} command${count === 1 ? "" : "s"}`,
  notExposed: "Not yet exposed by the protocol (S041)",
  requestFromCore: "Request from Core",
  requesting: "Requesting…",
  connectThenRequest: "Connect the Core from Core Connections, then request the catalog.",
  sessionAbsent: "Core session missing.",
  presentOnCore: (count) => `Present on the Core · ${count === 1 ? "1 command" : `${count} commands`}`,
  read: "Read",
  close: "Close",
  transport: "Transport",
  wireCommands: "Wire commands",
  quantities: "Quantities",
  profilesOnCore: "Profiles on the Core",
  moduleNone: "none",
  directionPrefix: "direction",
  noneModule: "none",
};

const COPY: Record<LocaleId, CatalogTopologyCopy> = { it: IT, en: EN };

export function catalogTopologyCopy(locale: LocaleId): CatalogTopologyCopy {
  return COPY[locale];
}
