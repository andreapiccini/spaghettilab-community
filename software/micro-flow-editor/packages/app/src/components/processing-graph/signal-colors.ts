import type { DeviceProcessingNodeData } from "@spaghettilab/device-processing-graph-model";
import { catalogEntryForNode } from "./catalog-entry-for-node.js";

export const SIGNAL_STYLES = {
 activation: { color: "#8054D9", label: "Attivazione" },
 event: { color: "#C04496", label: "Evento" },
 digital: { color: "#D87518", label: "Digitale · Alto/Basso" },
 analog: { color: "#168C90", label: "Analogico" },
 quantity: { color: "#2879C7", label: "Misura numerica" },
 text: { color: "#64912D", label: "Testo" },
 bytes: { color: "#74624C", label: "Dati binari" },
 enum: { color: "#9F59AD", label: "Stato / enumerazione" },
 reference: { color: "#5861A9", label: "Riferimento" },
 power: { color: "#AD5F46", label: "Alimentazione" },
 any: { color: "#7A8595", label: "Tipo generico" },
} as const;
export type WireSignalType = keyof typeof SIGNAL_STYLES;
/** Classify the source port, never the destination's accepted input types. */
export function wireSignalType(data: DeviceProcessingNodeData | undefined, handle?: string | null): WireSignalType {
 if (!data) return "any";
 if (data.kind === "schedule") return "activation";
 const ports = catalogEntryForNode(data)?.outputs ?? [];
 const port = ports.find(port => port.id === handle) ?? (handle == null && ports.length === 1 ? ports[0] : undefined);
 const domains = [...new Set(port?.types.map(type => type.domain) ?? [])];
 return domains.length === 1 ? domains[0]! : "any";
}
