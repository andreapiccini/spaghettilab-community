import type { LocaleId } from "./locale.js";

type AutomationsCopy = {
  readonly title: string;
  readonly nodesLinks: (nodes: number, links: number) => string;
  readonly graph: string;
  readonly deploy: string;
  readonly diagnostics: string;
  readonly hostFunctions: string;
  readonly newNode: string;
  readonly label: string;
  readonly schemaId: string;
  readonly valueType: string;
  readonly optional: string;
  readonly unitOptional: string;
  readonly linkNotRevalidated: string;
  readonly pathBody: string;
  readonly noLinks: string;
  readonly noChanges: string;
  readonly cancel: string;
  readonly create: string;
};

const IT: AutomationsCopy = {
  title: "Automazioni",
  nodesLinks: (nodes, links) => `${nodes} nodi · ${links} link`,
  graph: "Grafo",
  deploy: "Deploy Node-RED",
  diagnostics: "Diagnostica",
  hostFunctions: "Funzioni host (Node-RED)",
  newNode: "Nuovo nodo",
  label: "Etichetta",
  schemaId: "Schema id",
  valueType: "Value type",
  optional: " (opz.)",
  unitOptional: "Unit (opz.)",
  linkNotRevalidated: "Link non rivalidato",
  pathBody: "Percorso end-to-end per ciascun link — struttura e compatibilità, non eventi live.",
  noLinks: "Nessun link nel grafo.",
  noChanges: "Nessuna modifica.",
  cancel: "Annulla",
  create: "Crea",
};

const EN: AutomationsCopy = {
  title: "Automations",
  nodesLinks: (nodes, links) => `${nodes} node${nodes === 1 ? "" : "s"} · ${links} link${links === 1 ? "" : "s"}`,
  graph: "Graph",
  deploy: "Node-RED Deploy",
  diagnostics: "Diagnostics",
  hostFunctions: "Host functions (Node-RED)",
  newNode: "New node",
  label: "Label",
  schemaId: "Schema id",
  valueType: "Value type",
  optional: " (opt.)",
  unitOptional: "Unit (opt.)",
  linkNotRevalidated: "Link not revalidated",
  pathBody: "End-to-end path for each link — structure and compatibility, not live events.",
  noLinks: "No link in the graph.",
  noChanges: "No changes.",
  cancel: "Cancel",
  create: "Create",
};

const COPY: Record<LocaleId, AutomationsCopy> = { it: IT, en: EN };

export function automationsCopy(locale: LocaleId): AutomationsCopy {
  return COPY[locale];
}
