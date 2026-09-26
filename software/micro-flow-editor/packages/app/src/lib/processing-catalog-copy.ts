import type { BlockPort, CatalogField, ProcessingCatalogEntry } from "@spaghettilab/processing-block-catalog";
import type { BaySide } from "@spaghettilab/processing-block-catalog";
import type { LocaleId } from "./locale.js";

const AUTHORING_IT = "Authoring visibile sul blocco; il Config/firmware si aggancia in un passo successivo.";
const AUTHORING_EN = "Authoring visible on the block; Config/firmware attaches in a later step.";

const PHRASES: Record<string, string> = {
  [AUTHORING_IT]: AUTHORING_EN,
  Attivazione: "Activation",
  "Campionamento periodico": "Periodic sampling",
  "Record asincroni": "Asynchronous records",
  "Pallino Schedule → primo blocco": "Schedule tick → first block",
  "All'avvio del Core": "On Core boot",
  "Log di debug": "Debug log",
  "Nota di authoring": "Authoring note",
  "Riavvio Core": "Core reboot",
  "Cambio variabile": "Variable change",
  "Scrivi variabile": "Write variable",
  "Evento comando": "Command event",
  "Soglia booleana": "Boolean threshold",
  "Più confronti": "Multiple comparisons",
  "Seleziona un ingresso": "Select an input",
  "Ripeti N volte": "Repeat N times",
  "Esegui un comando": "Run a command",
  "Addizione (cambia type_id per − × ÷)": "Addition (change type_id for − × ÷)",
  "Mask e shift": "Mask and shift",
  "Polinomio bounded": "Bounded polynomial",
  "Valore casuale": "Random value",
  "Satura in [min, max]": "Clamp to [min, max]",
  "Rimappa un intervallo": "Remap a range",
  "Conversione unità": "Unit conversion",
  "Unisci campi": "Join fields",
  "Media mobile": "Moving average",
  "Passa-basso": "Low-pass",
  "Filtro mediano": "Median filter",
  "Soglia con isteresi": "Threshold with hysteresis",
  Antirimbalzo: "Debounce",
  "Filtro 1D": "1D filter",
  "Timer scaduto": "Timer elapsed",
  "Intervallo periodico": "Periodic interval",
  "Avvia timer": "Start timer",
  "Ferma timer": "Stop timer",
  Ritardo: "Delay",
  Orologio: "Clock",
  "Formatta data/ora": "Format date/time",
  "Fronte pulsante": "Button edge",
  "Rilascio pulsante": "Button release",
  "Scrivi GPIO HIGH/LOW": "Write GPIO HIGH/LOW",
  "Inverti uscita digitale": "Invert digital output",
  "Confronto → comando": "Compare → command",
  "Sensore temperatura": "Temperature sensor",
  "Misura in °C": "Reading in °C",
  "Indicatore luminoso": "Light indicator",
  "Sequenze colore · trigger in ingresso": "Color sequences · input trigger",
  "Uscita relè": "Relay output",
  "6 canali digital / analog / alimentazione": "6 digital / analog / power channels",
  Arrotonda: "Round",
  "Schermo LCD": "LCD screen",
  "Testo LCD": "LCD text",
  "Immagine LCD": "LCD image",
  "Grafico LCD": "LCD chart",
  "Pulisci grafico LCD": "Clear LCD chart",
  "Comando LED": "LED command",
  "Comando buzzer": "Buzzer command",
  "Tabella bounded": "Bounded table",
  "Inserisci riga": "Insert row",
  "Aggiorna riga": "Update row",
  "Elimina riga": "Delete row",
  "Svuota tabella": "Clear table",
  "Conteggio righe": "Row count",
  "Log eventi": "Event log",
  "Estrai campo JSON": "Extract JSON field",
  "UART in ingresso": "UART input",
  "SMS in ingresso": "Incoming SMS",
  "UART in uscita": "UART output",
  "Invia SMS": "Send SMS",
  "Cambio rete": "Network change",
  "Apri socket": "Open socket",
  "Invia su socket": "Send on socket",
  "Risposta HTTP": "HTTP response",
  "MQTT in ingresso": "MQTT input",
  "Stato MQTT": "MQTT status",
  "Pubblica su topic": "Publish to topic",
  "Registro slave": "Slave register",
  "Risposta master": "Master response",
  "Richiesta Modbus": "Modbus request",
  "Rule soglia": "Threshold rule",
  "Soglia → comando": "Threshold → command",

  Variabile: "Variable",
  Comando: "Command",
  Valore: "Value",
  Operazione: "Operation",
  Operatore: "Operator",
  Combinatore: "Combinator",
  Confronti: "Comparisons",
  Argomento: "Argument",
  "Secondo operando": "Second operand",
  Operando: "Operand",
  Formula: "Formula",
  Messaggio: "Message",
  Commento: "Comment",
  "Ritardo (ms)": "Delay (ms)",
  "URL file TCU": "TCU file URL",
  Da: "From",
  A: "To",
  Passo: "Step",
  "Periodo (s)": "Period (s)",
  "Periodo (ms)": "Period (ms)",
  Pianificazione: "Schedule",
  "Durata (s)": "Duration (s)",
  Secondi: "Seconds",
  "Salva in variabile": "Save to variable",
  Sorgente: "Source",
  Formato: "Format",
  "Linea / pin": "Line / pin",
  Linea: "Line",
  Stato: "State",
  "Tipo di toggle": "Toggle type",
  "Stato iniziale": "Initial state",
  "Contatore impulsi ON": "ON pulse count",
  "Contatore impulsi OFF": "OFF pulse count",
  "Contatore impulsi ON → rising edge": "ON pulse count",
  "Contatore impulsi OFF → falling edge": "OFF pulse count",
  "Durata impulso (ms)": "Pulse duration (ms)",
  Colore: "Color",
  "Soglia (0–100)": "Threshold (0–100)",
  Negato: "Negated",
  "Ritardo ON (ms)": "On delay (ms)",
  "Ritardo OFF (ms)": "Off delay (ms)",
  "Soft start ON (ms)": "Soft start (ms)",
  "Soft stop OFF (ms)": "Soft stop (ms)",
  Modalità: "Mode",
  Trigger: "Trigger",
  "Azione sul trigger": "Trigger action",
  Effetto: "Effect",
  "Intensità (0–100)": "Intensity (0–100)",
  "Velocità / periodo (ms)": "Speed / period (ms)",
  "N LED (stub bay)": "LED count (bay stub)",
  Schermata: "Screen",
  Testo: "Text",
  Visibilità: "Visibility",
  Immagine: "Image",
  Tabella: "Table",
  Chiave: "Key",
  Valori: "Values",
  "Voce di log": "Log entry",
  Porta: "Port",
  "Filtro mittente": "Sender filter",
  Dati: "Data",
  Numero: "Number",
  Quando: "When",
  Evento: "Event",
  Metodo: "Method",
  Percorso: "Path",
  "Quando la misura è": "When the reading is",
  Soglia: "Threshold",
  "allora il GPIO": "then the GPIO",
  "Trigger / comando": "Trigger / command",
  "Comando digitale": "Digital command",
  "testo da stampare": "text to print",
  "es. temp > 20 AND umidità < 80": "e.g. temp > 20 AND humidity < 80",
  "valore o variabile": "value or variable",
  "es. 2x^2 + 3x + 1": "e.g. 2x^2 + 3x + 1",
  "es. 0 8 * * *": "e.g. 0 8 * * *",
  "Quanti trigger Schedule (impulsi) restare OFF prima del rising edge / ON":
    "How many Schedule triggers (pulses) to stay OFF before the rising edge / ON",
  "Quanti trigger Schedule (impulsi) restare ON prima del falling edge / OFF":
    "How many Schedule triggers (pulses) to stay ON before the falling edge / OFF",
  "Larghezza dell’impulso dopo ogni trigger Schedule": "Pulse width after each Schedule trigger",
  "Accende se il comando ≥ soglia": "Turns on if the command ≥ threshold",
  "Attesa dopo il segnale ON (comando ≥ soglia) prima di soft start":
    "Wait after the ON signal (command ≥ threshold) before soft start",
  "Attesa dopo il segnale OFF (comando < soglia) prima di soft stop":
    "Wait after the OFF signal (command < threshold) before soft stop",
  "Velocità di salita 0→100% (0 = istantaneo)": "Rise speed 0→100% (0 = instant)",
  "Velocità di decadimento 100%→0 (0 = istantaneo)": "Decay speed 100%→0 (0 = instant)",
  "Breathe, blink, color cycle": "Breathe, blink, color cycle",
  "Dal bay/NFC quando disponibile": "From bay/NFC when available",
  "Es. Sensore A": "e.g. Sensor A",
  "Valore di alimentazione": "Supply value",
  "colonne o JSON": "columns or JSON",

  "Astable (toggle a ogni impulso)": "Astable (toggle on every pulse)",
  "Impulso HIGH (riposo LOW)": "HIGH pulse (rest LOW)",
  "Impulso LOW (riposo HIGH)": "LOW pulse (rest HIGH)",
  "ON (dopo rising edge)": "ON (after rising edge)",
  "OFF (dopo falling edge)": "OFF (after falling edge)",
  "Effetto pronto": "Ready-made effect",
  "Sequenza mia": "My sequence",
  "Segue il trigger (stop sul bordo opposto)": "Follows the trigger (stop on the opposite edge)",
  "Avvia e non ferma sul bordo opposto": "Start and do not stop on the opposite edge",
  "Aperto (OFF)": "Open (OFF)",
  "Chiuso (ON)": "Closed (ON)",
  Digitale: "Digital",
  Analogico: "Analog",
  Alimentazione: "Power",
  "Ingresso — alimentato dall'esterno": "Input — powered from outside",
  "Uscita — alimento il device": "Output — I power the device",
  Visibile: "Visible",
  Nascosto: "Hidden",
  "Valori di default": "Default values",
  "Qualsiasi cambio": "Any change",
  Connesso: "Connected",
  Disconnesso: "Disconnected",
  Errore: "Error",
  "≥  maggiore o uguale": "≥  greater or equal",
  ">  maggiore": ">  greater",
  "≤  minore o uguale": "≤  less or equal",
  "<  minore": "<  less",
  "=  uguale": "=  equal",
  "Va alto": "Goes high",
  "Va basso": "Goes low",
  "è uguale": "equals",
  "è diverso": "is not equal to",
  "è maggiore": "is greater than",
  "è maggiore o uguale": "is greater than or equal to",
  "è minore": "is less than",
  "è minore o uguale": "is less than or equal to",
  Livello: "Level",
  "Temperatura (°C)": "Temperature (°C)",
  "Soglia in °C": "Threshold in °C",
  "allora uscita": "then output",
  altrimenti: "else",
  "Tipo di uscita": "Output type",
  "Tipo di ingresso": "Input type",
  Booleano: "Boolean",
  "Chiuso quando l'ingresso è": "Closed if input is",
  "Temperatura di prova (°C)": "Test temperature (°C)",
  "Valore per il dry-run": "Dry-run value",
  Ingresso: "Input",
  Uscita: "Output",
  Temperatura: "Temperature",

  "Entry point firmware (`spaghetti_runtime_schedule_config`): a ogni periodo emette attivazione (jolly). Equivalente AppBlocks: On Time Period. Se disabilitato non viene eseguito.":
    "Firmware entry point (`spaghetti_runtime_schedule_config`): each period emits activation (wildcard). AppBlocks equivalent: On Time Period. If disabled it is not run.",
  "Entry point firmware: Module che pubblica eventi (`spaghetti_module_manager_start_events`). Output = attivazione (jolly).":
    "Firmware entry point: Module that publishes events (`spaghetti_module_manager_start_events`). Output = activation (wildcard).",
  "Pallino violetto fisso dentro ogni Schedule (non dalla palette). Solo uscita a destra: collega al Digital Toggle o a un altro blocco per scegliere l’entry.":
    "Fixed violet tick inside every Schedule (not from the palette). Output only on the right: connect to Digital Toggle or another block to choose the entry.",
  "Il grafo Core è un DAG: `threshold` emette un bool. L'operatore è authoring; il firmware oggi applica ≥ sul field 1.":
    "The Core graph is a DAG: `threshold` emits a bool. The operator is authoring; firmware currently applies ≥ on field 1.",
  "Firmware: Block `add` (e subtract/multiply/divide in palette). L'operatore è visibile in authoring.":
    "Firmware: Block `add` (and subtract/multiply/divide in the palette). The operator is visible in authoring.",
  "Block firmware `divide`. Overflow/divisione per zero = errore bounded, non NaN silenzioso.":
    "Firmware block `divide`. Overflow/division by zero = bounded error, not a silent NaN.",
  "Block firmware `mask_shift`. Operazione visibile in authoring.": "Firmware block `mask_shift`. Operation visible in authoring.",
  "Firmware: Block `polynomial`. La formula è authoring visibile sul blocco.":
    "Firmware: Block `polynomial`. The formula is authoring visible on the block.",
  "Driver `random` ancora da scrivere; il grafo si può già autorare con questo type_id.":
    "Driver `random` still to be written; the graph can already be authored with this type_id.",
  "Block firmware nativo, senza gemello AppBlocks.": "Native firmware block, no AppBlocks twin.",
  "Block firmware nativo.": "Native firmware block.",
  "Block firmware nativo. Le conversioni restano nodi espliciti, mai implicite sull'edge.":
    "Native firmware block. Conversions stay explicit nodes, never implicit on the edge.",
  "Block firmware nativo (pack processing-basic).": "Native firmware block (processing-basic pack).",
  "Capability Pack `processing-kalman`, non nell'immagine minima.": "Capability Pack `processing-kalman`, not in the minimal image.",
  "Escluso da questa passata di authoring.": "Left out of this authoring pass.",
  "Event source su Module GPIO. La linea è authoring visibile sul blocco.":
    "Event source on a GPIO Module. The line is authoring visible on the block.",
  "Input: attivazione dallo Start (o jolly da Schedule). Output: comando digitale (0/1). Astabile = cambia stato a ogni impulso; impulso HIGH/LOW = monostabile (riposo + impulso sulla durata impostata).":
    "Input: activation from Start (or wildcard from Schedule). Output: digital command (0/1). Astable = changes state on every pulse; HIGH/LOW pulse = monostable (rest + pulse of the set duration).",
  "Sink su comando digitale (0/100) o analogico (0–100). Acceso se livello ≥ soglia. Ritardi ON/OFF rispetto al segnale, poi soft start/stop.":
    "Sink on a digital (0/100) or analog (0–100) command. On if level ≥ threshold. ON/OFF delays relative to the signal, then soft start/stop.",
  [`${AUTHORING_IT} Player di sequenze: rising/falling sceglie il bordo che avvia. «Segue il trigger» spegne sul bordo opposto; «Avvia e non ferma» lascia correre la sequenza. Effetti pronti = sequenze parametriche; in «Sequenza mia» componi solid/fade/wait. Strip (N LED) = un unico player.`]:
    `${AUTHORING_EN} Sequence player: rising/falling picks the starting edge. “Follows the trigger” turns off on the opposite edge; “Start and do not stop” lets the sequence run. Ready-made effects = parametric sequences; in “My sequence” compose solid/fade/wait. Strip (N LEDs) = one player.`,
  [`${AUTHORING_IT} Relè hardware: chiuso se l’ingresso è HIGH, oppure chiuso se l’ingresso è LOW.`]:
    `${AUTHORING_EN} Hardware relay: closed if the input is HIGH, or closed if the input is LOW.`,
  "Un solo ingresso alla volta: Digital Toggle (uguale / diverso da HIGH/LOW) oppure Sensore temperatura (uguale / diverso / maggiore / minore). Tipo di uscita: Digitale (HIGH/LOW, può comandare LED o Relè) oppure Booleano (true/false, non è un ingresso digitale/analogico).":
    "One input at a time: Digital Toggle (equals / is not equal to HIGH/LOW) or Temperature sensor (equals / is not equal / greater / less). Output type: Digital (HIGH/LOW, can drive a LED or Relay) or Boolean (true/false, not a digital/analog input).",
  [`${AUTHORING_IT} Sensore hardware: si collega solo a un blocco IF. L’indicatore sotto il blocco serve a provare la temperatura.`]:
    `${AUTHORING_EN} Hardware sensor: connects only to an IF block. The indicator under the block is for testing the temperature.`,
  [`${AUTHORING_IT} Morsettiera bay: fino a 6 canali digital, analog o alimentazione (tensione + direzione ingresso/uscita). Nomi editabili; sul canvas ogni nome sta accanto al pallino.`]:
    `${AUTHORING_EN} Bay terminal block: up to 6 digital, analog or power channels (voltage + input/output direction). Names are editable; on the canvas each name sits next to the handle.`,
  "Driver `round` pianificato (valore numerico bounded, non formattazione stringa libera).":
    "Planned `round` driver (bounded numeric value, not free string formatting).",
  "Nessun LCD sul Core. Un display è un altro Core/Module, collegato via Node-RED.":
    "No LCD on the Core. A display is another Core/Module, linked via Node-RED.",
  "Block firmware `lookup_table`. Tabella/chiave visibili in authoring.":
    "Firmware block `lookup_table`. Table/key visible in authoring.",
  "Niente tabelle mutabili unbounded sul Core.": "No unbounded mutable tables on the Core.",
  "La lookup firmware ha dimensione fissa nel Config, non un count dinamico.":
    "The firmware lookup has a fixed size in Config, not a dynamic count.",
  "Solo path bounded e payload cap; JSON libero resta Node-RED.":
    "Bounded path and payload cap only; free JSON stays in Node-RED.",
  "Block firmware `publish_field`. Topic/payload visibili in authoring.":
    "Firmware block `publish_field`. Topic/payload visible in authoring.",
  "Stesso driver di MQTT Publish; voce nativa per chi cerca il type_id firmware.":
    "Same driver as MQTT Publish; native entry for anyone looking up the firmware type_id.",
  "Soglia firmware (campi 3/4/8). Il GPIO può solo andare alto o basso — non diventa input.":
    "Firmware threshold (fields 3/4/8). The GPIO can only go high or low — it does not become an input.",
  "Block firmware `select`.": "Firmware block `select`.",
  "Block firmware `subtract`.": "Firmware block `subtract`.",
  "Block firmware `multiply`.": "Firmware block `multiply`.",

  Sistema: "System",
  Variabili: "Variables",
  "Logica e flusso": "Logic and flow",
  Matematica: "Mathematics",
  Filtri: "Filters",
  Tempo: "Time",
  "Ingressi e I/O": "Inputs and I/O",
  Stringhe: "Strings",
  "Suono e LED": "Sound and LED",
  "Dati e storage": "Data and storage",
  "Seriale e SMS": "Serial and SMS",
  Rete: "Network",

  ingresso: "input",
  uscita: "output",
  "scegli ingresso o uscita": "choose input or output",
  "ingresso e uscita": "input and output",
  "6 canali": "6 channels",
  disabilitato: "disabled",
  campioni: "samples",
  sequenza: "sequence",
  avvia: "start",
  segue: "follow",
  pianificato: "planned",
  "non in catalogo": "not in catalog",
  intero: "integer",
  stringa: "string",
  Attivo: "Active",
};

const PATTERNS: readonly { readonly re: RegExp; readonly to: (...m: string[]) => string }[] = [
  { re: /^Nome canale (\d+)$/, to: (_all, n) => `Channel ${n} name` },
  { re: /^Tipo CH(\d+)$/, to: (_all, n) => `CH${n} type` },
  { re: /^Canale (\d+) attivo$/, to: (_all, n) => `Channel ${n} enabled` },
  { re: /^Tensione CH(\d+) \(V\)$/, to: (_all, n) => `CH${n} voltage (V)` },
  { re: /^Direzione CH(\d+)$/, to: (_all, n) => `CH${n} direction` },
];

export function localizeCatalogText(text: string | undefined, locale: LocaleId): string {
  if (!text) return "";
  if (locale !== "en") return text;
  const exact = PHRASES[text];
  if (exact) return exact;
  for (const { re, to } of PATTERNS) {
    const match = text.match(re);
    if (match) return to(...match);
  }
  return text;
}

export function localizedBaySideLabel(side: BaySide, locale: LocaleId): string {
  return locale === "en" ? (side === "input" ? "input" : "output") : side === "input" ? "ingresso" : "uscita";
}

export function localizedBayChoiceHint(bayIo: ProcessingCatalogEntry["bayIo"], locale: LocaleId): string | undefined {
  if (bayIo === "either") return localizeCatalogText("scegli ingresso o uscita", locale);
  if (bayIo === "both") return localizeCatalogText("ingresso e uscita", locale);
  return undefined;
}

function localizeField(field: CatalogField, locale: LocaleId): CatalogField {
  return {
    ...field,
    label: localizeCatalogText(field.label, locale),
    placeholder: field.placeholder ? localizeCatalogText(field.placeholder, locale) : field.placeholder,
    options: field.options?.map((option) => ({ ...option, label: localizeCatalogText(option.label, locale) })),
  };
}

function localizePort(port: BlockPort, locale: LocaleId): BlockPort {
  return port.label ? { ...port, label: localizeCatalogText(port.label, locale) } : port;
}

export function localizeCatalogEntry(entry: ProcessingCatalogEntry, locale: LocaleId): ProcessingCatalogEntry {
  if (locale !== "en") return entry;
  return {
    ...entry,
    label: localizeCatalogText(entry.label, locale),
    subtitle: localizeCatalogText(entry.subtitle, locale),
    notes: localizeCatalogText(entry.notes, locale),
    fields: entry.fields?.map((field) => localizeField(field, locale)),
    inputs: entry.inputs?.map((port) => localizePort(port, locale)),
    outputs: entry.outputs?.map((port) => localizePort(port, locale)),
  };
}

export function localizeCatalogEntries(
  entries: readonly ProcessingCatalogEntry[],
  locale: LocaleId,
): readonly ProcessingCatalogEntry[] {
  return entries.map((entry) => localizeCatalogEntry(entry, locale));
}
