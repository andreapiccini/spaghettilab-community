import type { LocaleId } from "./locale.js";

const IT: Record<string, string> = {
  "rail-core-connections": "Inizia da qui: collega una Backbone",
  "rail-processing-graph": "Ora definisci la logica",
};

const EN: Record<string, string> = {
  "rail-core-connections": "Start here: connect a Backbone",
  "rail-processing-graph": "Now define the logic",
};

export function nextStepLabel(target: string, locale: LocaleId): string {
  const copy = locale === "en" ? EN : IT;
  return copy[target] ?? target;
}
