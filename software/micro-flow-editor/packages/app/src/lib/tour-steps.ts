import type { LocaleId } from "./locale.js";

export type TourStep = {
  readonly target: string;
  readonly title: string;
  readonly body: string;
  /** Which side of the target the explanation card opens on — clamped to the viewport regardless. */
  readonly side: "right" | "bottom";
};

const IT: readonly TourStep[] = [
  { target: "rail-core-connections", title: "Discover", body: "Collega la Backbone Master via USB e controlla la topologia CAN, le versioni firmware e i moduli riconosciuti tramite NFC.", side: "right" },
  { target: "rail-processing-graph", title: "Run Deploy", body: "Configura moduli e logiche nell’editor a blocchi, quindi avvia una Discovery aggiornata e trasferisci la configurazione al firmware.", side: "right" },
  { target: "rail-settings", title: "Settings", body: "Qui trovi la lingua e la preferenza Basic o Advanced. La preferenza viene salvata senza cambiare le funzionalità dell’MVP.", side: "right" },
];

const EN: readonly TourStep[] = [
  { target: "rail-core-connections", title: "Discover", body: "Connect the Master Backbone over USB and inspect the CAN topology, firmware versions and NFC-recognized modules.", side: "right" },
  { target: "rail-processing-graph", title: "Run Deploy", body: "Configure modules and logic in the block editor, then run fresh Discovery and transfer the configuration to firmware.", side: "right" },
  { target: "rail-settings", title: "Settings", body: "Choose the language and save the Basic or Advanced preference without changing the current MVP features.", side: "right" },
];

export function tourSteps(locale: LocaleId): readonly TourStep[] {
  return locale === "en" ? EN : IT;
}
