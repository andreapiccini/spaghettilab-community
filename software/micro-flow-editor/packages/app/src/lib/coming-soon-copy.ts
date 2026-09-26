import type { LocaleId } from "./locale.js";

type ComingSoonCopy = {
  readonly badge: string;
  readonly reservedCatalog: string;
  readonly market: {
    readonly title: string;
    readonly description: string;
    readonly softwareTitle: string;
    readonly softwareBody: string;
    readonly hardwareTitle: string;
    readonly hardwareBody: string;
    readonly footnote: string;
  };
  readonly education: {
    readonly title: string;
    readonly description: string;
    readonly heading: string;
    readonly items: readonly string[];
    readonly empty: string;
  };
  readonly schematic: {
    readonly title: string;
    readonly description: string;
    readonly heading: string;
    readonly body: string;
    readonly goPhysical: string;
  };
  readonly datasheets: {
    readonly title: string;
    readonly description: string;
    readonly heading: string;
    readonly items: readonly string[];
    readonly empty: string;
  };
};

const IT: ComingSoonCopy = {
  badge: "Coming soon",
  reservedCatalog: "Catalogo riservato — Coming soon",
  market: {
    title: "Market",
    description:
      "Qui potrai acquistare e aggiungere moduli al progetto. Due cataloghi restano distinti: software (flow e pack) e hardware (schede e sensori). Nessun checkout per ora.",
    softwareTitle: "Moduli software",
    softwareBody: "Flow, blocchi di elaborazione, pack e estensioni da aggiungere al progetto.",
    hardwareTitle: "Moduli hardware",
    hardwareBody: "Schede, sensori e moduli fisici compatibili con i Core già collegati.",
    footnote: "I Capability Pack e l'OTA restano in Capability Marketplace, in modalità avanzata.",
  },
  education: {
    title: "Formazione",
    description:
      "Spiegazioni e lezioni su Core, moduli e flow. I contenuti didattici arriveranno qui, distinti da datasheet e istruzioni tecniche.",
    heading: "Cosa troverai",
    items: [
      "Percorsi guidati per i primi progetti",
      "Lezioni sui moduli software e hardware",
      "Esempi collegati al canvas del progetto aperto",
    ],
    empty: "Nessuna lezione pubblicata — Coming soon",
  },
  schematic: {
    title: "Genera schematico e PCB",
    description:
      "Da qui si genereranno schematico e PCB a partire dai moduli hardware già collegati e riconosciuti in Physical Composition. Lo strumento non è ancora disponibile.",
    heading: "Sorgente prevista",
    body: "Composizione fisica, porte configurate e hardware scoperto sul Core — la stessa sezione che già mostra i moduli rilevati.",
    goPhysical: "Vai a Physical Composition",
  },
  datasheets: {
    title: "Datasheet e istruzioni",
    description:
      "Consultazione di datasheet, pinout e istruzioni d'uso per ogni modulo software e hardware del catalogo. L'archivio non è ancora collegato.",
    heading: "Cosa troverai",
    items: [
      "Datasheet e specifiche dei moduli",
      "Istruzioni di cablaggio e primo avvio",
      "Riferimenti collegati all'hardware già riconosciuto",
    ],
    empty: "Archivio riservato — Coming soon",
  },
};

const EN: ComingSoonCopy = {
  badge: "Coming soon",
  reservedCatalog: "Reserved catalog — Coming soon",
  market: {
    title: "Market",
    description:
      "Here you will be able to buy and add modules to the project. Two catalogs stay separate: software (flows and packs) and hardware (boards and sensors). No checkout yet.",
    softwareTitle: "Software modules",
    softwareBody: "Flows, processing blocks, packs and extensions to add to the project.",
    hardwareTitle: "Hardware modules",
    hardwareBody: "Boards, sensors and physical modules compatible with already connected Cores.",
    footnote: "Capability Packs and OTA stay in Capability Marketplace, in advanced mode.",
  },
  education: {
    title: "Education",
    description:
      "Explanations and lessons on Cores, modules and flows. Teaching content will land here, separate from datasheets and technical instructions.",
    heading: "What you will find",
    items: [
      "Guided paths for first projects",
      "Lessons on software and hardware modules",
      "Examples linked to the open project's canvas",
    ],
    empty: "No lessons published — Coming soon",
  },
  schematic: {
    title: "Generate schematic and PCB",
    description:
      "Schematic and PCB will be generated here from the hardware modules already connected and recognized in Physical Composition. The tool is not available yet.",
    heading: "Expected source",
    body: "Physical composition, configured ports and hardware discovered on the Core — the same section that already shows detected modules.",
    goPhysical: "Go to Physical Composition",
  },
  datasheets: {
    title: "Datasheets and instructions",
    description:
      "Datasheets, pinouts and usage instructions for every software and hardware module in the catalog. The archive is not linked yet.",
    heading: "What you will find",
    items: [
      "Datasheets and module specifications",
      "Wiring and first-start instructions",
      "References linked to already recognized hardware",
    ],
    empty: "Reserved archive — Coming soon",
  },
};

const COPY: Record<LocaleId, ComingSoonCopy> = { it: IT, en: EN };

export function comingSoonCopy(locale: LocaleId): ComingSoonCopy {
  return COPY[locale];
}
