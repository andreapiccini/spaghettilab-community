import type { CoreBindingId } from "@spaghettilab/domain";
import type { OtaCandidateManifest, PreflightResult } from "@spaghettilab/ota-preflight";
import { useMemo, useState } from "react";
import { marketplaceCopy } from "../../lib/marketplace-copy.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { useLocale } from "../../state/locale-context.js";
import { useSession } from "../../state/session-context.js";
import { MarketplaceTab } from "./MarketplaceTab.js";
import { PreflightTab } from "./PreflightTab.js";
import { UpdateTab } from "./UpdateTab.js";

const TAB_IDS = ["marketplace", "preflight", "aggiornamento"] as const;
type TabId = (typeof TAB_IDS)[number];

/**
 * `ux/screens/S100-capability-marketplace/{visual,ui-behavior,backend-behavior}.md`,
 * cablato su `@spaghettilab/capability-marketplace` (S101, reale — S104's
 * `ArtifactKind` registry non esiste ancora, vedi `artifact-kind.ts`),
 * `@spaghettilab/ota-preflight` (S102, reale) e `@spaghettilab/ota-lifecycle`
 * (S103, reale, solo trasporto BLE). Tre tab con un selettore Core condiviso
 * (stesso pattern di Runtime & Diagnostics/Deploy & Diff); un candidato
 * scelto nel tab Marketplace viene passato al tab Preflight, che a sua volta
 * passa il risultato preflight al tab Aggiornamento.
 */
export function CapabilityMarketplaceScreen() {
  const { session } = useSession();
  const { rows } = useCoreSessions();
  const { locale } = useLocale();
  const copy = marketplaceCopy(locale);
  const tabs = [
    { id: "marketplace" as const, label: copy.tabMarketplace },
    { id: "preflight" as const, label: copy.tabPreflight },
    { id: "aggiornamento" as const, label: copy.tabUpdate },
  ];
  const bindings = session?.stack.current.coreBindings ?? [];

  const readyRows = useMemo(() => rows.filter((r) => r.sessionState === "READY"), [rows]);
  const [selected, setSelected] = useState<CoreBindingId | null>(null);
  const [tab, setTab] = useState<TabId>("marketplace");
  const [candidate, setCandidate] = useState<OtaCandidateManifest | null>(null);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);

  const activeRow = readyRows.find((r) => r.binding.bindingId === selected) ?? readyRows[0] ?? null;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <h1 className="font-heading text-lg font-semibold text-ink">{copy.title}</h1>
        <span className="ml-auto flex items-center gap-1.5 rounded-slpill border border-border-strong px-3 py-1.5 font-body text-sm text-ink-muted">
          {copy.coresReady(bindings.length, readyRows.length)}
        </span>
      </div>

      {readyRows.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="font-body text-sm text-ink-faint">{copy.noCore}</p>
        </div>
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap gap-2 border-b border-border bg-surface px-4 py-2">
            {readyRows.map((r) => (
              <button
                key={r.binding.bindingId}
                type="button"
                onClick={() => setSelected(r.binding.bindingId)}
                className="flex items-center gap-2 rounded-slpill px-3 py-1.5 font-body text-sm"
                style={{
                  border: activeRow?.binding.bindingId === r.binding.bindingId ? "2px solid var(--color-brand-blue)" : "1px solid var(--color-border-strong)",
                  backgroundColor: activeRow?.binding.bindingId === r.binding.bindingId ? "color-mix(in srgb, var(--color-brand-blue) 8%, transparent)" : "transparent",
                }}
              >
                {r.displayName}
              </button>
            ))}
          </div>

          <div className="flex shrink-0 gap-1 border-b border-border bg-surface px-4">
            {tabs.map((t) => {
              const activeTab = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className="flex items-center gap-1.5 border-b-2 px-3 py-2.5 font-body text-sm"
                  style={{ borderColor: activeTab ? "var(--color-brand-blue)" : "transparent", color: activeTab ? "var(--color-brand-blue)" : "var(--color-ink-muted)" }}
                >
                  {t.label}
                  {t.id === "preflight" && candidate && (
                    <span className="rounded-slpill bg-brand-purple-glow px-1.5 py-0.5 text-[10px] text-white">1</span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex-1 overflow-auto">
            {activeRow && tab === "marketplace" && <MarketplaceTab key={activeRow.binding.bindingId} bindingId={activeRow.binding.bindingId} />}
            {activeRow && tab === "preflight" && (
              <PreflightTab
                key={activeRow.binding.bindingId}
                bindingId={activeRow.binding.bindingId}
                candidate={candidate}
                onCandidateChange={(c) => {
                  setCandidate(c);
                  setPreflight(null);
                }}
                onPreflightComputed={setPreflight}
                onStartUpdate={() => setTab("aggiornamento")}
              />
            )}
            {activeRow && tab === "aggiornamento" && <UpdateTab key={activeRow.binding.bindingId} bindingId={activeRow.binding.bindingId} candidate={candidate} preflight={preflight} />}
          </div>
        </>
      )}
    </div>
  );
}
