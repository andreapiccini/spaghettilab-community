import type { LocaleId } from "./locale.js";

type ProjectPickerCopy = {
  readonly searchPlaceholder: string;
  readonly tryDemo: string;
  readonly newProject: string;
  readonly emptyTitle: string;
  readonly emptyBody: string;
  readonly createFirst: string;
  readonly retry: string;
  readonly demoFailed: string;
  readonly demoFailedDetail: (detail: string) => string;
  readonly unknownError: string;
  readonly coresConnected: (count: number) => string;
  readonly dialogTitle: string;
  readonly nameLabel: string;
  readonly nameEmpty: string;
  readonly saveFailed: string;
  readonly cancel: string;
  readonly creating: string;
  readonly createProject: string;
};

const IT: ProjectPickerCopy = {
  searchPlaceholder: "cerca progetti...",
  tryDemo: "Prova la demo",
  newProject: "Nuovo progetto",
  emptyTitle: "Nessun progetto ancora",
  emptyBody: "Crea il tuo primo progetto per iniziare a comporre Core, sensori e automazioni.",
  createFirst: "Crea il tuo primo progetto",
  retry: "Riprova",
  demoFailed: "Non è stato possibile creare il progetto demo.",
  demoFailedDetail: (detail) => `Non è stato possibile creare il progetto demo: ${detail}`,
  unknownError: "errore sconosciuto",
  coresConnected: (count) => `${count} Core collegat${count === 1 ? "o" : "i"}`,
  dialogTitle: "Nuovo progetto",
  nameLabel: "Nome progetto",
  nameEmpty: "Il nome non può essere vuoto.",
  saveFailed: "Salvataggio fallito.",
  cancel: "Annulla",
  creating: "Creazione...",
  createProject: "Crea progetto",
};

const EN: ProjectPickerCopy = {
  searchPlaceholder: "search projects...",
  tryDemo: "Try the demo",
  newProject: "New project",
  emptyTitle: "No projects yet",
  emptyBody: "Create your first project to start composing Cores, sensors and automations.",
  createFirst: "Create your first project",
  retry: "Retry",
  demoFailed: "Could not create the demo project.",
  demoFailedDetail: (detail) => `Could not create the demo project: ${detail}`,
  unknownError: "unknown error",
  coresConnected: (count) => `${count} Core${count === 1 ? "" : "s"} connected`,
  dialogTitle: "New project",
  nameLabel: "Project name",
  nameEmpty: "The name cannot be empty.",
  saveFailed: "Save failed.",
  cancel: "Cancel",
  creating: "Creating...",
  createProject: "Create project",
};

const COPY: Record<LocaleId, ProjectPickerCopy> = { it: IT, en: EN };

export function projectPickerCopy(locale: LocaleId): ProjectPickerCopy {
  return COPY[locale];
}
