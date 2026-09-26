import type { LocaleId } from "./locale.js";

type PhysicalCompositionCopy = {
  readonly title: string;
  readonly noCoreShort: string;
  readonly portsRead: (count: number) => string;
  readonly onCanvas: (count: number) => string;
  readonly conflicts: (count: number) => string;
  readonly addPort: string;
  readonly candidates: (count: number) => string;
  readonly addressConflicts: (count: number) => string;
  readonly sendToDeploy: string;
  readonly noCoreTitle: string;
  readonly noCoreBody: string;
  readonly goCoreConnections: string;
  readonly noPortTitle: string;
  readonly noPortBody: string;
  readonly noTopologyBody: string;
  readonly addAPort: string;
  readonly addAPortTitle: string;
  readonly portProtocol: (portId: number) => string;
  readonly portMapping: (portId: number) => string;
  readonly portTitle: (portId: number) => string;
  readonly back: string;
  readonly alreadyOnCanvas: string;
  readonly signals: (count: number) => string;
  readonly readingPorts: string;
  readonly noPortsFromFirmware: string;
  readonly rereadFromCore: string;
  readonly portsComeFromCore: string;
  readonly port: string;
  readonly choosePort: string;
  readonly addToCanvas: string;
  readonly reading: string;
  readonly chooseProtocolFirst: string;
  readonly coreMissingPeripherals: string;
  readonly peripheralsFromFirmware: string;
  readonly clickFreePin: (signalCount: number) => string;
  readonly choosePeripheral: (signalCount: number) => string;
  readonly onThisPort: (list: string) => string;
  readonly noMcuPeripheral: string;
  readonly rereadPeripherals: string;
  readonly alreadyHave: (current: string, next: string) => string;
  readonly cancel: string;
  readonly proceed: string;
  readonly connector: string;
  readonly removeFromPin: (signal: string, pin: string) => string;
  readonly function: string;
  readonly noPeripheralAvailable: string;
  readonly closeDetail: string;
  readonly otherPins: string;
  readonly signal: string;
  readonly removeSignal: (signal: string) => string;
  readonly moveSignal: (signal: string, pin: string) => string;
  readonly optionalName: string;
  readonly settings: (label: string, pin: string) => string;
  readonly noSignalAssigned: string;
  readonly assignedOf: (assigned: number, total: number) => string;
  readonly next: string;
  readonly pinsOnlyClose: string;
  readonly unused: string;
  readonly noMapping: string;
  readonly saveAndClose: string;
  readonly noBusSettings: string;
  readonly howDeviceTalks: string;
  readonly noIntegratedModule: string;
  readonly configureManually: string;
  readonly recognizedHardware: string;
  readonly noHardware: string;
  readonly noHardwareHint: string;
  readonly pinsAssigned: (count: number) => string;
  readonly noPin: string;
  readonly notThatConfigure: string;
  readonly assignPinProtocol: string;
  readonly whatOnPort: string;
  readonly searchLibrary: string;
  readonly unit: string;
  readonly parity: string;
  readonly yes: string;
  readonly polarity: string;
  readonly mode: string;
  readonly quantity: string;
  readonly propertyRangeMin: string;
  readonly propertyRangeMax: string;
  readonly integratedModule: string;
  readonly customProtocol: string;
  readonly assignPinsFirst: string;
  readonly noResults: string;
  readonly addressI2c: string;
  readonly electricalMode: string;
  readonly unmanagedRail: string;
  readonly w1RomHelp: string;
  readonly w1RomInvalid: string;
  readonly moduleKeyFirmware: string;
  readonly passiveRailAck: string;
  readonly admissionUnverified: (bayId: number) => string;
  readonly noQuantity: string;
  readonly delete: string;
  readonly save: string;
};

const IT: PhysicalCompositionCopy = {
  title: "Physical Composition",
  noCoreShort: "Nessun Core",
  portsRead: (count) => `${count} ${count === 1 ? "porta letta" : "porte lette"} dal Core`,
  onCanvas: (count) => `${count} sul canvas`,
  conflicts: (count) => `${count} conflitti`,
  addPort: "Aggiungi Porta",
  candidates: (count) => `${count} candidati`,
  addressConflicts: (count) => `${count} indirizzi in conflitto`,
  sendToDeploy: "Invia a Deploy",
  noCoreTitle: "Nessun Core nel progetto",
  noCoreBody: "Connetti un Core per configurare le Porte di questo progetto.",
  goCoreConnections: "Vai a Core Connections",
  noPortTitle: "Nessuna porta sul canvas",
  noPortBody: "Scegli una Porta dal menu (lette dal firmware), poi clicca i pin per i segnali.",
  noTopologyBody: "Nessuna Porta da GET_TOPOLOGY. Rileggi dal Core: il menu si riempie solo da lì.",
  addAPort: "Aggiungi una Porta",
  addAPortTitle: "Aggiungi una Porta",
  portProtocol: (portId) => `Porta ${portId} · protocollo`,
  portMapping: (portId) => `Porta ${portId} · mapping`,
  portTitle: (portId) => `Porta ${portId}`,
  back: "Indietro",
  alreadyOnCanvas: "già sul canvas",
  signals: (count) => `${count} segnali`,
  readingPorts: "Lettura Porte dal Core (GET_TOPOLOGY)…",
  noPortsFromFirmware: "Nessuna Porta letta dal firmware. Il menu si riempie solo da GET_TOPOLOGY — non si digita un numero.",
  rereadFromCore: "Rileggi dal Core",
  portsComeFromCore: "Le Porte arrivano dal Core. Scegli dal menu, poi aggiungila al canvas.",
  port: "Porta",
  choosePort: "— scegli una Porta —",
  addToCanvas: "Aggiungi sul canvas",
  reading: "Lettura…",
  chooseProtocolFirst: "Scegli prima un protocollo.",
  coreMissingPeripherals:
    "Il Core ha questa Porta ma non ha inviato le periferiche del connettore. Aggiorna il firmware (GET_TOPOLOGY chiave 5) e rileggi. VCC e GND restano disponibili.",
  peripheralsFromFirmware: "Le periferiche MCU arrivano dal firmware di questa Porta. VCC e GND restano disponibili.",
  clickFreePin: (signalCount) =>
    `Clicca un pin libero per assegnarlo, o un segnale già messo per toglierlo. ${signalCount} linee dal Core.`,
  choosePeripheral: (signalCount) =>
    `Scegli una periferica che il Core espone su questa Porta, poi assegna i segnali. ${signalCount} linee dal Core.`,
  onThisPort: (list) => `Su questa Porta: ${list}`,
  noMcuPeripheral: "nessuna periferica MCU",
  rereadPeripherals: "Rileggi periferiche dal Core",
  alreadyHave: (current, next) => `Hai già ${current}. Passare a ${next} toglie quei pin. Procedere?`,
  cancel: "Annulla",
  proceed: "Procedi",
  connector: "Connettore",
  removeFromPin: (signal, pin) => `Togli ${signal} da ${pin}`,
  function: "Funzione",
  noPeripheralAvailable: "Nessuna periferica MCU disponibile su questa Porta. Rileggi le capacità dal Core o assegna VCC/GND.",
  closeDetail: "Chiudi dettaglio",
  otherPins: "Altri pin — linee del Core",
  signal: "Segnale",
  removeSignal: (signal) => `Togli ${signal} da questo pin`,
  moveSignal: (signal, pin) => `${signal} su ${pin} — clicca per spostarlo qui`,
  optionalName: "Nome (opzionale)",
  settings: (label, pin) => `Impostazioni ${label} · ${pin}`,
  noSignalAssigned: "Nessun segnale assegnato. Scegli una periferica del Core prima di andare al protocollo.",
  assignedOf: (assigned, total) => `${assigned} di ${total} assegnati.`,
  next: "Avanti",
  pinsOnlyClose: "Solo pin, chiudi",
  unused: "Non usato",
  noMapping: "Nessun mapping. Aggiungine uno per esporre campi nel Processing Graph.",
  saveAndClose: "Salva e chiudi",
  noBusSettings: "Nessuna impostazione di bus. Ogni mapping è una proprietà GPIO.",
  howDeviceTalks: "Come parla il dispositivo su questi pin?",
  noIntegratedModule: "Nessun modulo per questa periferica,",
  configureManually: "configura a mano",
  recognizedHardware: "Candidati rilevati",
  noHardware: "Nessun hardware riconosciuto",
  noHardwareHint: "Se hai collegato qualcosa, configuralo a mano: pin, protocollo, campi.",
  pinsAssigned: (count) => `${count} pin assegnati`,
  noPin: "Nessun pin",
  notThatConfigure: "Non è quello — configura a mano",
  assignPinProtocol: "Assegna pin e protocollo",
  whatOnPort: "Cosa c’è su questa Porta",
  searchLibrary: "Cerca per nome, categoria...",
  unit: "Unità",
  parity: "Parità",
  yes: "Sì",
  polarity: "Polarità",
  mode: "Modalità",
  quantity: "Quantità",
  propertyRangeMin: "Range proprietà min",
  propertyRangeMax: "Range proprietà max",
  integratedModule: "Modulo integrato",
  customProtocol: "Protocollo custom",
  assignPinsFirst: "Assegna prima i pin della Porta. Poi compariranno solo i moduli compatibili con quelle periferiche.",
  noResults: "Nessun risultato.",
  addressI2c: "Indirizzo (I2C)",
  electricalMode: "Modalità elettrica",
  unmanagedRail: "non gestita",
  w1RomHelp: "8 byte hex, spazi o due punti ammessi — binding di istanza, non del profilo.",
  w1RomInvalid: "Servono esattamente 8 byte (16 cifre hex).",
  moduleKeyFirmware: "(assegnato dal firmware)",
  passiveRailAck: "Questa rail è passiva (non verificabile dal firmware) — confermo il posizionamento di questo Module qui.",
  admissionUnverified: (bayId) => `Bay ${bayId}: admission UNVERIFIED — non normalizzata come ENFORCED.`,
  noQuantity: "Nessuna grandezza su questa periferica.",
  delete: "Elimina",
  save: "Salva",
};

const EN: PhysicalCompositionCopy = {
  title: "Physical Composition",
  noCoreShort: "No Core",
  portsRead: (count) => `${count} port${count === 1 ? "" : "s"} read from the Core`,
  onCanvas: (count) => `${count} on canvas`,
  conflicts: (count) => `${count} conflict${count === 1 ? "" : "s"}`,
  addPort: "Add Port",
  candidates: (count) => `${count} candidate${count === 1 ? "" : "s"}`,
  addressConflicts: (count) => `${count} conflicting address${count === 1 ? "" : "es"}`,
  sendToDeploy: "Send to Deploy",
  noCoreTitle: "No Core in the project",
  noCoreBody: "Connect a Core to configure the Ports of this project.",
  goCoreConnections: "Go to Core Connections",
  noPortTitle: "No port on the canvas",
  noPortBody: "Pick a Port from the menu (read from firmware), then click pins for signals.",
  noTopologyBody: "No Port from GET_TOPOLOGY. Re-read from the Core: the menu fills only from there.",
  addAPort: "Add a Port",
  addAPortTitle: "Add a Port",
  portProtocol: (portId) => `Port ${portId} · protocol`,
  portMapping: (portId) => `Port ${portId} · mapping`,
  portTitle: (portId) => `Port ${portId}`,
  back: "Back",
  alreadyOnCanvas: "already on canvas",
  signals: (count) => `${count} signal${count === 1 ? "" : "s"}`,
  readingPorts: "Reading Ports from the Core (GET_TOPOLOGY)…",
  noPortsFromFirmware: "No Port read from firmware. The menu fills only from GET_TOPOLOGY — you do not type a number.",
  rereadFromCore: "Re-read from Core",
  portsComeFromCore: "Ports come from the Core. Pick one from the menu, then add it to the canvas.",
  port: "Port",
  choosePort: "— choose a Port —",
  addToCanvas: "Add to canvas",
  reading: "Reading…",
  chooseProtocolFirst: "Choose a protocol first.",
  coreMissingPeripherals:
    "The Core has this Port but did not send connector peripherals. Update firmware (GET_TOPOLOGY key 5) and re-read. VCC and GND stay available.",
  peripheralsFromFirmware: "MCU peripherals come from this Port's firmware. VCC and GND stay available.",
  clickFreePin: (signalCount) =>
    `Click a free pin to assign it, or an already placed signal to remove it. ${signalCount} lines from the Core.`,
  choosePeripheral: (signalCount) =>
    `Choose a peripheral the Core exposes on this Port, then assign signals. ${signalCount} lines from the Core.`,
  onThisPort: (list) => `On this Port: ${list}`,
  noMcuPeripheral: "no MCU peripheral",
  rereadPeripherals: "Re-read peripherals from Core",
  alreadyHave: (current, next) => `You already have ${current}. Switching to ${next} removes those pins. Continue?`,
  cancel: "Cancel",
  proceed: "Continue",
  connector: "Connector",
  removeFromPin: (signal, pin) => `Remove ${signal} from ${pin}`,
  function: "Function",
  noPeripheralAvailable: "No MCU peripheral available on this Port. Re-read capabilities from the Core or assign VCC/GND.",
  closeDetail: "Close detail",
  otherPins: "Other pins — Core lines",
  signal: "Signal",
  removeSignal: (signal) => `Remove ${signal} from this pin`,
  moveSignal: (signal, pin) => `${signal} on ${pin} — click to move it here`,
  optionalName: "Name (optional)",
  settings: (label, pin) => `Settings ${label} · ${pin}`,
  noSignalAssigned: "No signal assigned. Choose a Core peripheral before going to the protocol.",
  assignedOf: (assigned, total) => `${assigned} of ${total} assigned.`,
  next: "Next",
  pinsOnlyClose: "Pins only, close",
  unused: "Unused",
  noMapping: "No mapping. Add one to expose fields in the Processing Graph.",
  saveAndClose: "Save and close",
  noBusSettings: "No bus settings. Each mapping is a GPIO property.",
  howDeviceTalks: "How does the device talk on these pins?",
  noIntegratedModule: "No module for this peripheral,",
  configureManually: "configure manually",
  recognizedHardware: "Detected candidates",
  noHardware: "No hardware recognized",
  noHardwareHint: "If you connected something, configure it by hand: pins, protocol, fields.",
  pinsAssigned: (count) => `${count} pin${count === 1 ? "" : "s"} assigned`,
  noPin: "No pin",
  notThatConfigure: "That's not it — configure by hand",
  assignPinProtocol: "Assign pins and protocol",
  whatOnPort: "What is on this Port",
  searchLibrary: "Search by name, category...",
  unit: "Unit",
  parity: "Parity",
  yes: "Yes",
  polarity: "Polarity",
  mode: "Mode",
  quantity: "Quantity",
  propertyRangeMin: "Property range min",
  propertyRangeMax: "Property range max",
  integratedModule: "Integrated module",
  customProtocol: "Custom protocol",
  assignPinsFirst: "Assign the Port pins first. Then only modules compatible with those peripherals will appear.",
  noResults: "No results.",
  addressI2c: "Address (I2C)",
  electricalMode: "Electrical mode",
  unmanagedRail: "unmanaged",
  w1RomHelp: "8 hex bytes, spaces or colons allowed — instance binding, not the profile.",
  w1RomInvalid: "Exactly 8 bytes are required (16 hex digits).",
  moduleKeyFirmware: "(assigned by firmware)",
  passiveRailAck: "This rail is passive (not verifiable by firmware) — I confirm placing this Module here.",
  admissionUnverified: (bayId) => `Bay ${bayId}: admission UNVERIFIED — not normalized as ENFORCED.`,
  noQuantity: "No quantity on this peripheral.",
  delete: "Delete",
  save: "Save",
};

const COPY: Record<LocaleId, PhysicalCompositionCopy> = { it: IT, en: EN };

export function physicalCompositionCopy(locale: LocaleId): PhysicalCompositionCopy {
  return COPY[locale];
}
