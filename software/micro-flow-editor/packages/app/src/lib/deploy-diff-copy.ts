import type { LocaleId } from "./locale.js";

type DeployDiffCopy = {
  readonly noPending: string;
  readonly blocked: (count: number) => string;
  readonly conflictOn: (name: string) => string;
  readonly conflictBody: string;
  readonly deployRunning: string;
  readonly changes: (count: number) => string;
  readonly changesCores: (changes: number, cores: number) => string;
  readonly startDeploy: string;
  readonly goToStudio: string;
  readonly importLive: string;
  readonly rebase: string;
  readonly cancel: string;
};

const IT: DeployDiffCopy = {
  noPending:
    "Nessun Core con modifiche pendenti — connetti un Core (Core Connections) e componi un progetto per vedere un diff qui.",
  blocked: (count) => `Deploy bloccato: ${count} ${count === 1 ? "profilo richiesto non è installato" : "profili richiesti non sono installati"}.`,
  conflictOn: (name) => `Conflitto su ${name}`,
  conflictBody: "Il dispositivo ha uno snapshot diverso da quello atteso al momento dell'apply. Nessuna scrittura è avvenuta.",
  deployRunning: "Deploy in corso — nessun progresso incrementale reale per singola tappa (chiamata atomica).",
  changes: (count) => `${count} ${count === 1 ? "modifica" : "modifiche"}`,
  changesCores: (changes, cores) => `${changes} ${changes === 1 ? "modifica" : "modifiche"} · ${cores} Core`,
  startDeploy: "Avvia deploy",
  goToStudio: "Vai a Device Profile Studio",
  importLive: "Importa stato live",
  rebase: "Rebase/merge strutturato",
  cancel: "Annulla",
};

const EN: DeployDiffCopy = {
  noPending: "No Core with pending changes — connect a Core (Core Connections) and compose a project to see a diff here.",
  blocked: (count) =>
    `Deploy blocked: ${count} required profile${count === 1 ? " is" : "s are"} not installed.`,
  conflictOn: (name) => `Conflict on ${name}`,
  conflictBody: "The device has a different snapshot from the one expected at apply time. No write happened.",
  deployRunning: "Deploy in progress — no real incremental progress per step (atomic call).",
  changes: (count) => `${count} change${count === 1 ? "" : "s"}`,
  changesCores: (changes, cores) => `${changes} change${changes === 1 ? "" : "s"} · ${cores} Core`,
  startDeploy: "Start deploy",
  goToStudio: "Go to Device Profile Studio",
  importLive: "Import live state",
  rebase: "Structured rebase/merge",
  cancel: "Cancel",
};

const COPY: Record<LocaleId, DeployDiffCopy> = { it: IT, en: EN };

export function deployDiffCopy(locale: LocaleId): DeployDiffCopy {
  return COPY[locale];
}
