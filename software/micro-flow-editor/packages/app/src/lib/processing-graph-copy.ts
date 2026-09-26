import type { LocaleId } from "./locale.js";

type ProcessingGraphCopy = {
  readonly title: string;
  readonly dryRun: string;
  readonly run: string;
  readonly running: string;
  readonly stopPreview: string;
  readonly sendToDeploy: string;
  readonly noCore: string;
  readonly emptyTitle: string;
  readonly emptyHint: string;
  readonly previewInProgress: string;
  readonly dryRunNotRun: string;
  readonly valid: string;
  readonly errorsCount: (count: number) => string;
  readonly issuesCount: (errors: number, warnings: number) => string;
  readonly scheduleInsideSchedule: string;
  readonly insertedInto: (label: string) => string;
  readonly removedFrom: (label: string) => string;
  readonly movedInto: (label: string) => string;
  readonly connectedTo: (label: string) => string;
  readonly searchBlocks: string;
  readonly noResults: string;
  readonly functionality: string;
  readonly functionalityHint: string;
  readonly bay: string;
  readonly bayHint: string;
  readonly dragToInsert: string;
  readonly configurePortFirst: string;
  readonly needsPort: string;
  readonly planned: string;
  readonly editorOnly: string;
  readonly outOfScope: string;
  readonly dragReminder: string;
  readonly bayModule: string;
  readonly nameLabel: string;
  readonly noIncoming: string;
  readonly noOutgoing: string;
  readonly ruleNoOutgoing: string;
  readonly save: string;
  readonly delete: string;
  readonly sourceTitle: string;
  readonly commandTitle: string;
  readonly blockSchemaGap: string;
  readonly ruleSchemaGap: string;
  readonly propertiesTitle: string;
  readonly addProperty: string;
  readonly noReadSignal: string;
  readonly noWriteCommand: string;
  readonly sequenceTitle: string;
  readonly sequenceHelp: string;
  readonly type: string;
  readonly color: string;
  readonly intensity: string;
  readonly removeAction: string;
  readonly portPrefix: string;
  readonly enabled: string;
  readonly periodMs: string;
  readonly minVersion: string;
  readonly exactVersion: string;
  readonly notInCatalog: string;
  readonly plannedSuffix: string;
  readonly integer: string;
  readonly stringType: string;
  readonly active: string;
  readonly deleteBlock: string;
  readonly deleteContainer: string;
  readonly scheduleActivation: string;
  readonly everyMs: (periodMs: number) => string;
  readonly disabledSuffix: string;
  readonly sixChannels: string;
  readonly samples: (count: string) => string;
  readonly nodesEdges: (nodes: number, edges: number) => string;
};

const IT: ProcessingGraphCopy = {
  title: "Processing Graph",
  dryRun: "Dry-run",
  run: "Esegui",
  running: "In corso…",
  stopPreview: "Ferma anteprima",
  sendToDeploy: "Invia a Deploy",
  noCore: "Nessun Core nel progetto — vai a Core Connections per connetterne uno.",
  emptyTitle: "Nessun blocco ancora",
  emptyHint: "Trascina un blocco dalla palette per iniziare",
  previewInProgress: "Anteprima locale in corso — nessuna Config inviata al Core",
  dryRunNotRun: "Dry-run non ancora eseguito",
  valid: "Valido",
  errorsCount: (count) => `${count} errori`,
  issuesCount: (errors, warnings) => `${errors} errori, ${warnings} warning`,
  scheduleInsideSchedule: "Uno Schedule non può stare dentro un altro.",
  insertedInto: (label) => `Inserito in «${label}».`,
  removedFrom: (label) => `Rimosso da «${label}».`,
  movedInto: (label) => `Spostato in «${label}».`,
  connectedTo: (label) => `Collegato a «${label}».`,
  searchBlocks: "Cerca blocchi",
  noResults: "Nessun risultato.",
  functionality: "Funzionalità",
  functionalityHint: "Azioni e logica del flusso",
  bay: "Bay",
  bayHint: "Moduli hardware · ingresso a sinistra, uscita a destra",
  dragToInsert: "Trascina sul canvas per inserire",
  configurePortFirst: "Configura prima una Porta in Composizione fisica.",
  needsPort: "serve una Porta",
  planned: "pianificato",
  editorOnly: "solo editor",
  outOfScope: "fuori scope",
  dragReminder: "Per inserire il blocco, trascinalo sul canvas.",
  bayModule: "Modulo hardware (bay)",
  nameLabel: "Nome (etichetta)",
  noIncoming: "Nessun collegamento in ingresso.",
  noOutgoing: "Nessun collegamento in uscita.",
  ruleNoOutgoing: "Le Rule non hanno un edge di uscita: l'azione è il Comando qui sopra.",
  save: "Salva",
  delete: "Elimina",
  sourceTitle: "Sorgente (quale Module/campo legge)",
  commandTitle: "Comando (quale Module/comando aziona)",
  blockSchemaGap:
    "GET_CATALOG non espone ancora lo schema proprietà del Block, quindi qui sotto sono per field_id numerico (`struct spaghetti_block_config`), non per nome — consulta la documentazione del tipo scelto per sapere quali usare.",
  ruleSchemaGap: "Proprietà per field_id numerico, stessa limitazione del Block: nessuno schema per nome esiste ancora.",
  propertiesTitle: "Proprietà (field_id → valore)",
  addProperty: "Aggiungi proprietà",
  noReadSignal: "Nessun segnale di lettura su questa Porta — assegna GPIO, ADC o una grandezza dalla Composizione fisica.",
  noWriteCommand: "Nessun comando su questa Porta — assegna GPIO, PWM o un mapping in scrittura.",
  sequenceTitle: "Azioni della sequenza",
  sequenceHelp:
    "Ogni azione è un passo. Gli effetti pronti (Color cycle, Breathe…) restano parametrici — qui componi solo solid / fade / wait.",
  type: "Tipo",
  color: "Colore",
  intensity: "Intensità",
  removeAction: "Rimuovi azione",
  portPrefix: "Porta",
  enabled: "Abilitato",
  periodMs: "Periodo (ms)",
  minVersion: "Versione minima",
  exactVersion: "Versione esatta",
  notInCatalog: "non in catalogo",
  plannedSuffix: "pianificato",
  integer: "intero",
  stringType: "stringa",
  active: "Attivo",
  deleteBlock: "Elimina blocco",
  deleteContainer: "Elimina contenitore",
  scheduleActivation: "Attivazione Schedule — collega al primo blocco",
  everyMs: (periodMs) => `ogni ${periodMs}ms`,
  disabledSuffix: "disabilitato",
  sixChannels: "6 canali",
  samples: (count) => `${count} campioni`,
  nodesEdges: (nodes, edges) => `${nodes} nodi · ${edges} edge`,
};

const EN: ProcessingGraphCopy = {
  title: "Processing Graph",
  dryRun: "Dry-run",
  run: "Run",
  running: "Running…",
  stopPreview: "Stop preview",
  sendToDeploy: "Send to Deploy",
  noCore: "No Core in the project — go to Core Connections to connect one.",
  emptyTitle: "No blocks yet",
  emptyHint: "Drag a block from the palette to start",
  previewInProgress: "Local preview running — no Config sent to the Core",
  dryRunNotRun: "Dry-run not run yet",
  valid: "Valid",
  errorsCount: (count) => `${count} error${count === 1 ? "" : "s"}`,
  issuesCount: (errors, warnings) => `${errors} error${errors === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}`,
  scheduleInsideSchedule: "A Schedule cannot sit inside another.",
  insertedInto: (label) => `Inserted into “${label}”.`,
  removedFrom: (label) => `Removed from “${label}”.`,
  movedInto: (label) => `Moved into “${label}”.`,
  connectedTo: (label) => `Connected to “${label}”.`,
  searchBlocks: "Search blocks",
  noResults: "No results.",
  functionality: "Functionality",
  functionalityHint: "Flow actions and logic",
  bay: "Bay",
  bayHint: "Hardware modules · input on the left, output on the right",
  dragToInsert: "Drag onto the canvas to insert",
  configurePortFirst: "Configure a Port in Physical Composition first.",
  needsPort: "needs a Port",
  planned: "planned",
  editorOnly: "editor only",
  outOfScope: "out of scope",
  dragReminder: "To insert the block, drag it onto the canvas.",
  bayModule: "Hardware module (bay)",
  nameLabel: "Name (label)",
  noIncoming: "No incoming connections.",
  noOutgoing: "No outgoing connections.",
  ruleNoOutgoing: "Rules have no outgoing edge: the action is the Command above.",
  save: "Save",
  delete: "Delete",
  sourceTitle: "Source (which Module/field it reads)",
  commandTitle: "Command (which Module/command it drives)",
  blockSchemaGap:
    "GET_CATALOG does not expose the Block property schema yet, so fields below use numeric field_id (`struct spaghetti_block_config`), not names — check the chosen type's documentation.",
  ruleSchemaGap: "Properties by numeric field_id, same Block limitation: no named schema exists yet.",
  propertiesTitle: "Properties (field_id → value)",
  addProperty: "Add property",
  noReadSignal: "No read signal on this Port — assign GPIO, ADC or a quantity in Physical Composition.",
  noWriteCommand: "No command on this Port — assign GPIO, PWM or a write mapping.",
  sequenceTitle: "Sequence actions",
  sequenceHelp:
    "Each action is a step. Ready-made effects (Color cycle, Breathe…) stay parametric — compose only solid / fade / wait here.",
  type: "Type",
  color: "Color",
  intensity: "Intensity",
  removeAction: "Remove action",
  portPrefix: "Port",
  enabled: "Enabled",
  periodMs: "Period (ms)",
  minVersion: "Minimum version",
  exactVersion: "Exact version",
  notInCatalog: "not in catalog",
  plannedSuffix: "planned",
  integer: "integer",
  stringType: "string",
  active: "Active",
  deleteBlock: "Delete block",
  deleteContainer: "Delete container",
  scheduleActivation: "Schedule activation — connect to the first block",
  everyMs: (periodMs) => `every ${periodMs}ms`,
  disabledSuffix: "disabled",
  sixChannels: "6 channels",
  samples: (count) => `${count} sample${count === "1" ? "" : "s"}`,
  nodesEdges: (nodes, edges) => `${nodes} node${nodes === 1 ? "" : "s"} · ${edges} edge${edges === 1 ? "" : "s"}`,
};

const COPY: Record<LocaleId, ProcessingGraphCopy> = { it: IT, en: EN };

export function processingGraphCopy(locale: LocaleId): ProcessingGraphCopy {
  return COPY[locale];
}
