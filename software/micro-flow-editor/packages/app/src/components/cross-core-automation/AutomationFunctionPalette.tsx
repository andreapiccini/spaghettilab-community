import { systemAutomationCatalogEntries, type ProcessingCatalogEntry } from "@spaghettilab/processing-block-catalog";
import { Globe } from "lucide-react";
import { automationsCopy } from "../../lib/automations-copy.js";
import { localizeCatalogEntry } from "../../lib/processing-catalog-copy.js";
import { useLocale } from "../../state/locale-context.js";

/**
 * Host-only automations from the functional catalog (`runtime: "node-red"`).
 * They never compile into Core Config; they sit on the System Automation Graph
 * and deploy to the connected Node-RED runtime.
 */
export function AutomationFunctionPalette({ onPlace }: { readonly onPlace: (entry: ProcessingCatalogEntry) => void }) {
  const { locale } = useLocale();
  const copy = automationsCopy(locale);
  const entries = systemAutomationCatalogEntries().map((entry) => localizeCatalogEntry(entry, locale));

  return (
    <div className="flex h-full w-[220px] shrink-0 flex-col border-r border-border bg-surface">
      <p className="border-b border-border px-3 py-2 font-body text-xs text-ink-faint">{copy.hostFunctions}</p>
      <div className="min-h-0 flex-1 overflow-auto p-1">
        {entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            title={entry.notes}
            onClick={() => onPlace(entry)}
            className="flex w-full items-start gap-2 rounded-slsm px-2 py-2 text-left hover:bg-surface-raised"
          >
            <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-slsm" style={{ backgroundColor: "#1F9D551F" }}>
              <Globe size={13} style={{ color: "#1F9D55" }} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-body text-sm text-ink">{entry.label}</div>
              <div className="truncate font-body text-xs text-ink-faint">{entry.subtitle}</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
