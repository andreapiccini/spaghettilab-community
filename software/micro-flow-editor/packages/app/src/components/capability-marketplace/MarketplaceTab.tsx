import {
  checkPackTrust,
  parseMarketplaceIndexJson,
  resolveDependencies,
  type CoreCompatibilityContext,
  type DependencyResolutionResult,
  type MarketplaceCatalog,
  type MarketplacePackManifest,
  type PackTrustKind,
} from "@spaghettilab/capability-marketplace";
import { normalizeCapabilityPacks, normalizeCatalogPages, type CatalogIndex } from "@spaghettilab/catalog-model";
import { computeRequiredArtifacts, type RequiredArtifact, type UsedType } from "@spaghettilab/capability-marketplace";
import type { DeviceProcessingNodeData } from "@spaghettilab/device-processing-graph-model";
import type { CoreBindingId } from "@spaghettilab/domain";
import type { PhysicalCompositionNodeData } from "@spaghettilab/physical-composition-model";
import type { DeviceProfileSummary, FeaturePack } from "@spaghettilab/protocol-sdk";
import { Package, Search, ShieldCheck, ShieldQuestion, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { marketplaceCopy } from "../../lib/marketplace-copy.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { useLocale } from "../../state/locale-context.js";
import { useSession } from "../../state/session-context.js";
import { ARTIFACT_KINDS, type ArtifactKindId } from "./artifact-kind.js";

const SUB_TAB_IDS = ["disponibili", "installati", "richiesti"] as const;
type SubTabId = (typeof SUB_TAB_IDS)[number];

/**
 * `ux/screens/S100-capability-marketplace/visual.md` § Marketplace. Tre
 * liste mai fuse (S101 § Verifiche): Disponibili (indice marketplace
 * importato manualmente — nessuna operazione wire elenca pack scaricabili,
 * `parseMarketplaceIndexJson` legge solo un JSON fornito dall'utente),
 * Installati (Capability Pack via `GET_FEATURES` + Device Profile via
 * `listDeviceProfiles()`, entrambi reali), Richiesti
 * (`computeRequiredArtifacts` sui tipi usati dai grafi del progetto per
 * questo Core). Gap dichiarato: nessun kind "Device Profile" esiste in
 * Disponibili — non c'è alcuna fonte marketplace per i profili, solo
 * Device Profile Studio li autora/importa come pacchetto.
 */
export function MarketplaceTab({ bindingId }: { readonly bindingId: CoreBindingId }) {
  const { session } = useSession();
  const { getSnapshot, listDeviceProfiles } = useCoreSessions();
  const { locale } = useLocale();
  const copy = marketplaceCopy(locale);
  const trustLabel: Record<PackTrustKind, { readonly label: string; readonly icon: typeof ShieldCheck; readonly colorVar: string }> = {
    TRUSTED: { label: copy.trusted, icon: ShieldCheck, colorVar: "var(--color-success)" },
    UNTRUSTED: { label: copy.untrusted, icon: ShieldQuestion, colorVar: "var(--color-error)" },
    UNVERIFIABLE: { label: copy.local, icon: ShieldQuestion, colorVar: "var(--color-ink-faint)" },
  };
  const subTabs = [
    { id: "disponibili" as const, label: copy.available },
    { id: "installati" as const, label: copy.installed },
    { id: "richiesti" as const, label: copy.required },
  ];
  const [subTab, setSubTab] = useState<SubTabId>("disponibili");
  const [catalog, setCatalog] = useState<MarketplaceCatalog | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<ArtifactKindId | null>(null);
  const [selectedPack, setSelectedPack] = useState<MarketplacePackManifest | null>(null);
  const [installedProfiles, setInstalledProfiles] = useState<readonly DeviceProfileSummary[] | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const snapshot = getSnapshot(bindingId);
  const bindingIndex = (session?.stack.current.coreBindings ?? []).findIndex((b) => b.bindingId === bindingId);

  const installedPacks: readonly FeaturePack[] = snapshot?.features ? normalizeCapabilityPacks(snapshot.features).packs : [];
  const catalogIndex: CatalogIndex | null = snapshot?.catalog ? normalizeCatalogPages([snapshot.catalog], true) : null;

  const required: readonly RequiredArtifact[] = (() => {
    if (!session || !catalogIndex || bindingIndex < 0) return [];
    const physical = session.stack.current.physicalGraphs[bindingIndex];
    const processing = session.stack.current.deviceGraphs[bindingIndex];
    const used: UsedType[] = [];
    for (const node of physical?.nodes ?? []) {
      const data = node.data as PhysicalCompositionNodeData;
      if (data.kind === "module") used.push({ typeId: data.driverTypeId, kind: "module-driver", usedBy: node.id });
    }
    for (const node of processing?.nodes ?? []) {
      const data = node.data as DeviceProcessingNodeData;
      if (data.kind === "block") used.push({ typeId: data.blockTypeId, kind: "block", usedBy: node.id });
      if (data.kind === "rule") used.push({ typeId: data.ruleTypeId, kind: "rule", usedBy: node.id });
    }
    return computeRequiredArtifacts(used, catalogIndex);
  })();

  function handleImport(file: File) {
    setImportError(null);
    file
      .text()
      .then((text) => {
        const result = parseMarketplaceIndexJson(text);
        if (result.ok) setCatalog(result.value);
        else setImportError(result.error.map((e) => e.remediation).join("; "));
      })
      .catch((cause: unknown) => setImportError(cause instanceof Error ? cause.message : String(cause)));
  }

  function loadInstalledProfiles() {
    listDeviceProfiles(bindingId)?.then(setInstalledProfiles).catch(() => undefined);
  }

  const filteredPacks = (catalog?.packs ?? []).filter((p) => (kindFilter && kindFilter !== "capability-pack" ? false : true) && p.displayName.toLowerCase().includes(query.toLowerCase()));

  const compat: CoreCompatibilityContext | null =
    snapshot?.capabilities && snapshot.catalog
      ? { coreVariant: snapshot.capabilities.coreVariant, resourceProfile: snapshot.capabilities.resourceProfile, protocolVersion: snapshot.catalog.protocolVersion, configWireVersion: snapshot.catalog.configVersion }
      : null;

  const resolution: DependencyResolutionResult | null =
    selectedPack && catalog && compat
      ? resolveDependencies([{ typeId: selectedPack.packId, kind: "module-driver", requiredBy: [selectedPack.displayName] }], catalog, compat)
      : null;

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-6">
        <div className="flex flex-wrap items-center gap-2">
          {subTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className="rounded-slpill px-3 py-1.5 font-body text-sm"
              style={{
                border: subTab === t.id ? "2px solid var(--color-brand-blue)" : "1px solid var(--color-border-strong)",
                backgroundColor: subTab === t.id ? "color-mix(in srgb, var(--color-brand-blue) 8%, transparent)" : "transparent",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {subTab === "disponibili" && (
          <>
            <div className="flex items-center gap-2">
              <div className="flex flex-1 items-center gap-2 rounded-slsm border border-border-strong px-3 py-1.5">
                <Search size={14} className="text-ink-faint" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={copy.searchPacks} className="flex-1 font-body text-sm outline-none" />
              </div>
              {ARTIFACT_KINDS.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => setKindFilter((prev) => (prev === k.id ? null : k.id))}
                  className="rounded-slpill px-3 py-1.5 font-body text-xs"
                  style={{ border: kindFilter === k.id ? "2px solid var(--color-brand-blue)" : "1px solid var(--color-border-strong)" }}
                >
                  {k.label}
                </button>
              ))}
              <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 rounded-slpill bg-brand-blue px-3 py-1.5 font-body-strong text-xs text-white hover:bg-brand-blue-dark">
                <Upload size={12} />
                {copy.importIndex}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleImport(file);
                  e.target.value = "";
                }}
              />
            </div>
            <p className="font-body text-xs text-ink-muted">
              {copy.availableGap}
            </p>
            {importError && <p className="font-body text-xs text-error">{importError}</p>}

            {!catalog ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 py-12 text-center">
                <Package size={40} className="text-ink-faint" />
                <p className="font-body text-sm text-ink-muted">{copy.noIndex}</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {filteredPacks.map((p) => {
                  const trust = trustLabel[checkPackTrust(p)];
                  const Icon = trust.icon;
                  return (
                    <button
                      key={`${p.packId}@${p.version}`}
                      type="button"
                      onClick={() => setSelectedPack(p)}
                      className="flex items-center gap-3 rounded-slmd border border-border p-3 text-left hover:bg-surface-raised"
                      style={{ borderColor: selectedPack?.packId === p.packId ? "var(--color-brand-blue)" : "var(--color-border)" }}
                    >
                      <Package size={16} className="text-ink-faint" />
                      <div className="flex-1">
                        <p className="font-body text-sm font-semibold text-ink">{p.displayName}</p>
                        <p className="font-mono text-xs text-ink-faint">
                          {p.packId} · v{p.version}
                        </p>
                      </div>
                      <span className="flex items-center gap-1 rounded-slpill px-2 py-0.5 font-body text-xs" style={{ backgroundColor: `color-mix(in srgb, ${trust.colorVar} 12%, transparent)`, color: trust.colorVar }}>
                        <Icon size={11} />
                        {trust.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}

        {subTab === "installati" && (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="font-heading text-sm font-semibold text-ink">Capability Pack</h2>
              <div className="mt-2 flex flex-col gap-1.5">
                {installedPacks.length === 0 && <p className="font-body text-sm text-ink-faint">{copy.none}</p>}
                {installedPacks.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 rounded-slsm border border-border p-2 font-mono text-xs">
                    <span className="text-ink">{p.id}</span>
                    <span className="text-ink-muted">v{p.version}</span>
                    <span className="ml-auto text-ink-faint">{p.moduleTypeCount} tipi Module</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-heading text-sm font-semibold text-ink">Device Profile</h2>
                <button type="button" onClick={loadInstalledProfiles} className="rounded-slsm border border-border-strong px-2 py-1 font-body text-xs text-ink hover:bg-surface-raised">
                  {copy.refresh}
                </button>
              </div>
              <div className="mt-2 flex flex-col gap-1.5">
                {(installedProfiles ?? []).length === 0 && <p className="font-body text-sm text-ink-faint">{installedProfiles ? copy.none : copy.notRequested}</p>}
                {(installedProfiles ?? []).map((p) => (
                  <div key={p.profileId} className="flex items-center gap-3 rounded-slsm border border-border p-2 font-mono text-xs">
                    <span className="text-ink">{p.profileId}</span>
                    <span className="text-ink-muted">v{p.version}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {subTab === "richiesti" && (
          <div className="flex flex-col gap-1.5">
            {required.length === 0 ? (
              <p className="font-body text-sm text-ink-faint">{copy.noMissingTypes}</p>
            ) : (
              required.map((r) => (
                <div key={`${r.kind}:${r.typeId}`} className="flex items-center gap-3 rounded-slsm border border-warning p-2 font-mono text-xs" style={{ backgroundColor: "color-mix(in srgb, var(--color-warning) 6%, transparent)" }}>
                  <span className="rounded-slpill bg-surface px-2 py-0.5">{r.kind}</span>
                  <span className="text-ink">{r.typeId}</span>
                  <span className="ml-auto text-ink-faint">{copy.usedBy(r.requiredBy.length)}</span>
                </div>
              ))
            )}
            <p className="mt-2 font-body text-xs text-ink-muted">
              {copy.requiredGap}
            </p>
          </div>
        )}
      </div>

      {selectedPack && (
        <div className="flex w-[380px] shrink-0 flex-col border-l border-border bg-surface p-4">
          <h2 className="font-heading text-base font-semibold text-ink">{selectedPack.displayName}</h2>
          <p className="mt-1 font-mono text-xs text-ink-faint">
            {selectedPack.packId} · v{selectedPack.version}
          </p>
          <div className="mt-3 flex flex-col gap-1 font-body text-xs text-ink-muted">
            <p>{copy.flash}: {selectedPack.resourceManifest.flashBytes} B</p>
            <p>{copy.staticRam}: {selectedPack.resourceManifest.staticRamBytes} B</p>
            <p>{copy.rulesUsed}: {selectedPack.resourceManifest.rulesUsed}</p>
            <p>{copy.blocksUsed}: {selectedPack.resourceManifest.blocksUsed}</p>
          </div>

          {resolution && (
            <div className="mt-4">
              <h3 className="font-body text-xs font-semibold text-ink-muted">{copy.dependencies}</h3>
              {resolution.kind === "RESOLVED" ? (
                <div className="mt-1 flex flex-col gap-1">
                  {resolution.selections.map((s) => (
                    <p key={s.packId} className="font-mono text-xs text-success">
                      {s.packId}@{s.version} — {s.reason}
                    </p>
                  ))}
                </div>
              ) : (
                <div className="mt-1 flex flex-col gap-1">
                  {resolution.conflicts.map((c, i) => (
                    <p key={i} className="font-mono text-xs text-error">
                      {c.kind} {c.target} — {c.reason}
                    </p>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="mt-4 font-body text-xs text-ink-muted">
            {copy.packInstallGap}
          </p>
        </div>
      )}
    </div>
  );
}
