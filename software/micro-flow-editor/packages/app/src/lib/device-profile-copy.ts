import type { LocaleId } from "./locale.js";

type DeviceProfileCopy = {
  readonly tabs: {
    readonly metadata: string;
    readonly transport: string;
    readonly instructions: string;
    readonly output: string;
  };
  readonly instantiate: string;
  readonly electricalMode: string;
  readonly i2cAddress: string;
  readonly cancel: string;
  readonly instantiateAction: string;
  readonly w1Help: string;
  readonly noBayConstraint: string;
  readonly bayConstraintBody: string;
  readonly requiredCapabilities: string;
  readonly compatibilityWith: (id: string) => string;
  readonly missingOpcodes: (list: string) => string;
  readonly selectCore: string;
  readonly moveDown: string;
  readonly delete: string;
  readonly noFields: string;
  readonly unitPlaceholder: string;
  readonly version: string;
  readonly author: string;
  readonly opcodeDeps: string;
  readonly none: string;
  readonly outputFields: (count: number) => string;
  readonly temperaturePlaceholder: string;
  readonly profileName: string;
  readonly importAction: string;
  readonly exportAction: string;
  readonly saveProfile: string;
  readonly name: string;
  readonly description: string;
  readonly readOnlyAfterSave: string;
};

const IT: DeviceProfileCopy = {
  tabs: {
    metadata: "Metadata",
    transport: "Transport & Elettrico",
    instructions: "Istruzioni",
    output: "Output",
  },
  instantiate: "Instanzia come Module",
  electricalMode: "Modalità elettrica",
  i2cAddress: "Indirizzo I2C (i2c_address)",
  cancel: "Annulla",
  instantiateAction: "Instanzia",
  w1Help: "8 byte hex — binding di questa istanza, non del profilo condiviso.",
  noBayConstraint: "Nessun vincolo elettrico da Bay disponibile",
  bayConstraintBody:
    'Un profilo non è associato a una Bay specifica mentre lo si autora — i vincoli elettrici reali si vedono al momento di "Instanzia come Module" in Physical Composition. Anche allora, il modello di topologia attuale non riporta ancora tensione/modalità/frequenza massima per rail — solo assurance/admission grezzi.',
  requiredCapabilities: "Capability richieste (Port)",
  compatibilityWith: (id) => `Compatibilità con ${id}`,
  missingOpcodes: (list) => `opcode mancanti: ${list}`,
  selectCore: "Seleziona un Core connesso per calcolare la compatibilità.",
  moveDown: "Sposta giù",
  delete: "Elimina",
  noFields: "Nessun campo per questo step.",
  unitPlaceholder: "unità",
  version: "Versione",
  author: "Autore",
  opcodeDeps: "Dipendenze opcode",
  none: "nessuna",
  outputFields: (count) => `Campi output: ${count}`,
  temperaturePlaceholder: "Sensore di temperatura esterno",
  profileName: "Nome profilo",
  importAction: "Importa",
  exportAction: "Esporta",
  saveProfile: "Salva profilo",
  name: "Nome",
  description: "Descrizione",
  readOnlyAfterSave: "(sola lettura dopo il primo salvataggio)",
};

const EN: DeviceProfileCopy = {
  tabs: {
    metadata: "Metadata",
    transport: "Transport & Electrical",
    instructions: "Instructions",
    output: "Output",
  },
  instantiate: "Instantiate as Module",
  electricalMode: "Electrical mode",
  i2cAddress: "I2C address (i2c_address)",
  cancel: "Cancel",
  instantiateAction: "Instantiate",
  w1Help: "8 hex bytes — binding of this instance, not of the shared profile.",
  noBayConstraint: "No electrical Bay constraint available",
  bayConstraintBody:
    'A profile is not tied to a specific Bay while you author it — real electrical constraints appear when you "Instantiate as Module" in Physical Composition. Even then, the current topology model does not yet report voltage/mode/max frequency per rail — only raw assurance/admission.',
  requiredCapabilities: "Required capabilities (Port)",
  compatibilityWith: (id) => `Compatibility with ${id}`,
  missingOpcodes: (list) => `missing opcodes: ${list}`,
  selectCore: "Select a connected Core to compute compatibility.",
  moveDown: "Move down",
  delete: "Delete",
  noFields: "No field for this step.",
  unitPlaceholder: "unit",
  version: "Version",
  author: "Author",
  opcodeDeps: "Opcode dependencies",
  none: "none",
  outputFields: (count) => `Output fields: ${count}`,
  temperaturePlaceholder: "External temperature sensor",
  profileName: "Profile name",
  importAction: "Import",
  exportAction: "Export",
  saveProfile: "Save profile",
  name: "Name",
  description: "Description",
  readOnlyAfterSave: "(read-only after the first save)",
};

const COPY: Record<LocaleId, DeviceProfileCopy> = { it: IT, en: EN };

export function deviceProfileCopy(locale: LocaleId): DeviceProfileCopy {
  return COPY[locale];
}
