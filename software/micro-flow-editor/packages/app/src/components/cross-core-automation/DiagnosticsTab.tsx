import type { CoreBindingRecord } from "@spaghettilab/domain";
import { checkFieldCompatibility, LinkCompatibility } from "@spaghettilab/system-automation-graph";
import { ArrowRight } from "lucide-react";
import { automationsCopy } from "../../lib/automations-copy.js";
import { useLocale } from "../../state/locale-context.js";
import type { AppLink } from "./link-meta.js";
import type { CrossCoreNodeData } from "./node-data.js";

/**
 * `ux/screens/S110-cross-core-automation/visual.md` § Tab Diagnostica.
 * Gap dichiarato, sostanziale: `@spaghettilab/node-red-deploy`'s
 * `LinkDiagnosticsTracker` aggrega eventi che vengono generati **dentro**
 * un'istanza Node-RED in esecuzione (dai nodi runtime di
 * `@spaghettilab/node-red-nodes` — `record-source`/`coordinator`/
 * `command-target`), non da questa app browser. Non esiste alcun canale
 * (WebSocket, polling HTTP, ecc.) che porti quegli eventi da Node-RED a
 * qui — questa app non è un client del runtime dei nodi. Il breadcrumb
 * mostra quindi solo informazioni strutturali (endpoint, compatibilità,
 * stato) sempre disponibili localmente, mai conteggi di eventi live/log,
 * che resterebbero altrimenti sempre a zero in modo fuorviante.
 */
export function DiagnosticsTab({ links, bindings }: { readonly links: readonly AppLink[]; readonly bindings: readonly CoreBindingRecord[] }) {
  const { locale } = useLocale();
  const copy = automationsCopy(locale);
  return (
    <div className="flex h-full flex-col gap-4 overflow-auto p-6">
      <div className="rounded-slmd border-l-4 border-brand-purple-glow p-3" style={{ backgroundColor: "color-mix(in srgb, var(--color-brand-purple-glow) 6%, transparent)" }}>
        <p className="font-body text-sm text-ink">{copy.pathBody}</p>
        <p className="mt-0.5 font-body text-xs text-ink-muted">
          Gap onesto: gli eventi di runtime (record ricevuti, comandi instradati) vengono generati dentro Node-RED, non in questa app — nessun canale li porta qui, quindi non c'è un log/conteggio live da mostrare.
        </p>
      </div>

      {links.length === 0 ? (
        <p className="font-body text-sm text-ink-faint">{copy.noLinks}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {links.map((link) => {
            const compat = checkFieldCompatibility(descriptorOf(link.source), descriptorOf(link.target), link.transformation);
            return (
              <div key={link.id} className="flex items-center gap-2 rounded-slmd border border-border p-3">
                <Chip endpoint={link.source} bindings={bindings} />
                <ArrowRight size={14} className="text-ink-faint" />
                <Chip endpoint={link.target} bindings={bindings} />
                <span
                  className="ml-auto rounded-slpill px-2 py-0.5 font-body text-xs"
                  style={{
                    backgroundColor: `color-mix(in srgb, ${compat.kind === LinkCompatibility.INCOMPATIBLE ? "var(--color-error)" : "var(--color-success)"} 12%, transparent)`,
                    color: compat.kind === LinkCompatibility.INCOMPATIBLE ? "var(--color-error)" : "var(--color-success)",
                  }}
                >
                  {compat.kind}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function descriptorOf(endpoint: CrossCoreNodeData): { readonly valueType?: string; readonly unit?: string } {
  return endpoint.kind === "nodered" ? {} : { valueType: endpoint.valueType, unit: endpoint.unit };
}

function Chip({ endpoint, bindings }: { readonly endpoint: CrossCoreNodeData; readonly bindings: readonly CoreBindingRecord[] }) {
  const coreName = endpoint.kind !== "nodered" ? bindings.find((b) => b.bindingId === endpoint.coreBinding)?.expectedDeviceId : "Node-RED";
  return (
    <div className="w-[200px] rounded-slmd border border-border-strong p-2">
      <p className="truncate font-body text-xs font-semibold text-ink">{endpoint.label}</p>
      <p className="truncate font-mono text-[11px] text-ink-faint">{coreName}</p>
    </div>
  );
}
