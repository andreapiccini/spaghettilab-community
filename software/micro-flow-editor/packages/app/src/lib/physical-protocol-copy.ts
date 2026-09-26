import type { DialectKind } from "./port-protocol-mock.js";
import type { LocaleId } from "./locale.js";

type PhysicalProtocolCopy = {
  readonly unnamed: string;
  readonly edit: string;
  readonly duplicate: string;
  readonly remove: string;
  readonly identifier: string;
  readonly access: string;
  readonly dataType: string;
  readonly scale: string;
  readonly offset: string;
  readonly updateHz: string;
  readonly direction: string;
  readonly none: string;
  readonly initialValue: string;
  readonly frequencyHz: string;
  readonly busFrequencyHz: string;
  readonly resolutionBits: string;
  readonly rangeMin: string;
  readonly rangeMax: string;
  readonly deviceAddress: string;
  readonly registerWidth: string;
  readonly timeoutMs: string;
  readonly frameFormat: string;
  readonly terminator: string;
  readonly fixedLength: string;
  readonly frameLength: string;
  readonly requestGapMs: string;
  readonly addressing: string;
  readonly addressingDoc: string;
  readonly filters: string;
  readonly commandRegister: string;
  readonly length: string;
  readonly valueSource: string;
  readonly jsonField: string;
  readonly csvIndex: string;
  readonly regexGroup: string;
  readonly commandToSend: string;
  readonly readCommand: string;
  readonly writeCommand: string;
  readonly responsePattern: string;
  readonly extractField: string;
  readonly params: string;
  readonly table: string;
  readonly address: string;
  readonly modbusFunction: string;
  readonly command: string;
  readonly rawMin: string;
  readonly rawMax: string;
  readonly filter: string;
  readonly sampleHz: string;
  readonly debounceMs: string;
  readonly rangeMinMv: string;
  readonly rangeMaxMv: string;
  readonly automatic: string;
  readonly manual: string;
  readonly on: string;
  readonly off: string;
  readonly handled: string;
  readonly ignored: string;
  readonly unused: string;
  readonly fromCore: string;
  readonly configured: string;
  readonly byHand: string;
  readonly signals: (count: number) => string;
  readonly mappingsReady: (count: number) => string;
  readonly protocolsOnPins: (count: number) => string;
  readonly availableIfAssign: (peripheral: string) => string;
  readonly passive: string;
  readonly managed: string;
  readonly externalDevice: string;
  readonly dialectBlurbs: Record<DialectKind, string>;
  readonly integratedNames: Record<string, string>;
  readonly compositionLabels: Record<string, string>;
  readonly binary: string;
  readonly registerAddress: string;
  readonly asyncUrc: string;
  readonly interfacePrefix: string;
  readonly prefilled: string;
  readonly addMapping: string;
};

const IT: PhysicalProtocolCopy = {
  unnamed: "Senza nome",
  edit: "Modifica",
  duplicate: "Duplica",
  remove: "Elimina",
  identifier: "Identificatore",
  access: "Accesso",
  dataType: "Tipo dato",
  scale: "Scala",
  offset: "Offset",
  updateHz: "Aggiornamento (Hz)",
  direction: "Direzione",
  none: "Nessuno",
  initialValue: "Valore iniziale",
  frequencyHz: "Frequenza (Hz)",
  busFrequencyHz: "Frequenza bus (Hz)",
  resolutionBits: "Risoluzione (bit)",
  rangeMin: "Range min",
  rangeMax: "Range max",
  deviceAddress: "Indirizzo dispositivo",
  registerWidth: "Larghezza registro",
  timeoutMs: "Timeout (ms)",
  frameFormat: "Formato frame",
  terminator: "Terminatore",
  fixedLength: "Lunghezza fissa",
  frameLength: "Lunghezza frame",
  requestGapMs: "Intervallo richieste (ms)",
  addressing: "Indirizzamento",
  addressingDoc: "Documentale",
  filters: "Filtri",
  commandRegister: "Comando / registro",
  length: "Lunghezza",
  valueSource: "Origine valore",
  jsonField: "Campo JSON",
  csvIndex: "Indice CSV",
  regexGroup: "Gruppo regex",
  commandToSend: "Comando da inviare",
  readCommand: "Comando lettura",
  writeCommand: "Comando scrittura",
  responsePattern: "Pattern risposta",
  extractField: "Campo da estrarre",
  params: "Parametri",
  table: "Tabella",
  address: "Indirizzo",
  modbusFunction: "Funzione Modbus",
  command: "Comando",
  rawMin: "Grezzo min",
  rawMax: "Grezzo max",
  filter: "Filtro",
  sampleHz: "Campionamento (Hz)",
  debounceMs: "Debounce (ms)",
  rangeMinMv: "Range min (mV)",
  rangeMaxMv: "Range max (mV)",
  automatic: "Automatico",
  manual: "Manuale",
  on: "Acceso",
  off: "Spento",
  handled: "Gestiti",
  ignored: "Ignorati",
  unused: "Non usato",
  fromCore: "Dal Core",
  configured: "Configurata",
  byHand: "A mano",
  signals: (count) => `${count} segnali`,
  mappingsReady: (count) => `${count} mapping già pronti`,
  protocolsOnPins: (count) => (count === 1 ? "1 protocollo su questi pin" : `${count} protocolli su questi pin`),
  availableIfAssign: (peripheral) => `Disponibile se assegni pin ${peripheral}`,
  passive: "passivo",
  managed: "gestito",
  externalDevice: "Dispositivo esterno",
  dialectBlurbs: {
    gpio: "Linea digitale, senza protocollo",
    adc: "Conversione analogica, senza protocollo",
    pwm: "Uscita PWM, senza protocollo",
    dac: "Conversione digitale-analogica, senza protocollo",
    i2c: "Mappa registri su bus I²C",
    spi: "Comandi e registri su SPI",
    uart: "Frame seriale (testo o binario)",
    "raw-serial": "Byte grezzi su UART",
    at: "Comandi AT e risposte URC",
    "modbus-rtu": "Slave, tabelle e function code",
    can: "Frame CAN, raw o DBC",
    w1: "ROM e comandi 1-Wire",
  },
  binary: "Binario",
  registerAddress: "Indirizzo registro",
  asyncUrc: "URC asincroni",
  interfacePrefix: "Interfaccia",
  prefilled: "valori precompilati, modificabili.",
  addMapping: "Aggiungi",
  integratedNames: {
    "preset.ina219": "Sensore INA219",
    "mod.sht30": "Sensore SHT30",
    "mod.ds18b20": "DS18B20",
    "mod.pzem004t": "PZEM-004T",
    "mod.sim7600": "SIM7600",
  },
  compositionLabels: {
    Identificatore: "Identificatore",
    Accesso: "Accesso",
    Tipo: "Tipo",
    Scala: "Scala",
    Offset: "Offset",
    Unità: "Unità",
    Registro: "Registro",
    Lunghezza: "Lunghezza",
    Comando: "Comando",
    Tabella: "Tabella",
    Indirizzo: "Indirizzo",
    Quantità: "Quantità",
    Funzione: "Funzione",
    Lettura: "Lettura",
    Scrittura: "Scrittura",
    Campo: "Campo",
    Origine: "Origine",
    Percorso: "Percorso",
    Direzione: "Direzione",
    Polarità: "Polarità",
    Grezzo: "Grezzo",
    Filtro: "Filtro",
    Risoluzione: "Risoluzione",
    Frequenza: "Frequenza",
    Iniziale: "Iniziale",
  },
};

const EN: PhysicalProtocolCopy = {
  unnamed: "Unnamed",
  edit: "Edit",
  duplicate: "Duplicate",
  remove: "Delete",
  identifier: "Identifier",
  access: "Access",
  dataType: "Data type",
  scale: "Scale",
  offset: "Offset",
  updateHz: "Update (Hz)",
  direction: "Direction",
  none: "None",
  initialValue: "Initial value",
  frequencyHz: "Frequency (Hz)",
  busFrequencyHz: "Bus frequency (Hz)",
  resolutionBits: "Resolution (bits)",
  rangeMin: "Range min",
  rangeMax: "Range max",
  deviceAddress: "Device address",
  registerWidth: "Register width",
  timeoutMs: "Timeout (ms)",
  frameFormat: "Frame format",
  terminator: "Terminator",
  fixedLength: "Fixed length",
  frameLength: "Frame length",
  requestGapMs: "Request interval (ms)",
  addressing: "Addressing",
  addressingDoc: "Documented",
  filters: "Filters",
  commandRegister: "Command / register",
  length: "Length",
  valueSource: "Value source",
  jsonField: "JSON field",
  csvIndex: "CSV index",
  regexGroup: "Regex group",
  commandToSend: "Command to send",
  readCommand: "Read command",
  writeCommand: "Write command",
  responsePattern: "Response pattern",
  extractField: "Field to extract",
  params: "Parameters",
  table: "Table",
  address: "Address",
  modbusFunction: "Modbus function",
  command: "Command",
  rawMin: "Raw min",
  rawMax: "Raw max",
  filter: "Filter",
  sampleHz: "Sampling (Hz)",
  debounceMs: "Debounce (ms)",
  rangeMinMv: "Range min (mV)",
  rangeMaxMv: "Range max (mV)",
  automatic: "Automatic",
  manual: "Manual",
  on: "On",
  off: "Off",
  handled: "Handled",
  ignored: "Ignored",
  unused: "Unused",
  fromCore: "From Core",
  configured: "Configured",
  byHand: "By hand",
  signals: (count) => `${count} signal${count === 1 ? "" : "s"}`,
  mappingsReady: (count) => `${count} mapping${count === 1 ? "" : "s"} already ready`,
  protocolsOnPins: (count) => (count === 1 ? "1 protocol on these pins" : `${count} protocols on these pins`),
  availableIfAssign: (peripheral) => `Available if you assign ${peripheral} pins`,
  passive: "passive",
  managed: "managed",
  externalDevice: "External device",
  dialectBlurbs: {
    gpio: "Digital line, no protocol",
    adc: "Analog conversion, no protocol",
    pwm: "PWM output, no protocol",
    dac: "Digital-to-analog conversion, no protocol",
    i2c: "Register map on I²C bus",
    spi: "Commands and registers on SPI",
    uart: "Serial frame (text or binary)",
    "raw-serial": "Raw bytes on UART",
    at: "AT commands and URC replies",
    "modbus-rtu": "Slave, tables and function code",
    can: "CAN frame, raw or DBC",
    w1: "ROM and 1-Wire commands",
  },
  binary: "Binary",
  registerAddress: "Register address",
  asyncUrc: "Async URC",
  interfacePrefix: "Interface",
  prefilled: "pre-filled values, editable.",
  addMapping: "Add",
  integratedNames: {
    "preset.ina219": "INA219 sensor",
    "mod.sht30": "SHT30 sensor",
    "mod.ds18b20": "DS18B20",
    "mod.pzem004t": "PZEM-004T",
    "mod.sim7600": "SIM7600",
  },
  compositionLabels: {
    Identificatore: "Identifier",
    Accesso: "Access",
    Tipo: "Type",
    Scala: "Scale",
    Offset: "Offset",
    Unità: "Unit",
    Registro: "Register",
    Lunghezza: "Length",
    Comando: "Command",
    Tabella: "Table",
    Indirizzo: "Address",
    Quantità: "Quantity",
    Funzione: "Function",
    Lettura: "Read",
    Scrittura: "Write",
    Campo: "Field",
    Origine: "Source",
    Percorso: "Path",
    Direzione: "Direction",
    Polarità: "Polarity",
    Grezzo: "Raw",
    Filtro: "Filter",
    Risoluzione: "Resolution",
    Frequenza: "Frequency",
    Iniziale: "Initial",
  },
};

const COPY: Record<LocaleId, PhysicalProtocolCopy> = { it: IT, en: EN };

export function physicalProtocolCopy(locale: LocaleId): PhysicalProtocolCopy {
  return COPY[locale];
}

export function localizedDialectBlurb(kind: DialectKind, locale: LocaleId): string {
  return COPY[locale].dialectBlurbs[kind];
}

export function localizedIntegratedName(id: string, fallback: string, locale: LocaleId): string {
  if (locale !== "en") return fallback;
  return COPY.en.integratedNames[id] ?? fallback;
}

export function localizeCompositionLabel(label: string, locale: LocaleId): string {
  if (locale !== "en") return label;
  return COPY.en.compositionLabels[label] ?? label;
}
