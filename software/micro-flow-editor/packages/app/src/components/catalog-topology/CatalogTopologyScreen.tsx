import { normalizeCapabilityPacks, normalizeCatalogPages, normalizeProfilePages, normalizeTopologyPages, type CapabilityPackIndex, type ProfileIndex } from "@spaghettilab/catalog-model";
import type { CoreBindingId, CoreBindingRecord } from "@spaghettilab/domain";
import { TriangleAlert } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { catalogTopologyCopy } from "../../lib/catalog-topology-copy.js";
import { reconnectCoreBinding } from "../../lib/reconnect-binding.js";
import { useLocale } from "../../state/locale-context.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { useSession } from "../../state/session-context.js";
import { CatalogView } from "./CatalogView.js";
import { CoreSelector } from "./CoreSelector.js";
import { TopologyView } from "./TopologyView.js";

function fingerprintHex(bytes: Uint8Array): string {
  return Array.from(bytes.slice(0, 6))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** `ux/screens/S040-catalog-topology/{visual,ui-behavior,backend-behavior}.md`. Puramente diagnostica: nessuna mutazione, nessun canvas React Flow (non è questa schermata a usare `react-flow-adapter`, vedi `backend-behavior.md`). */
export function CatalogTopologyScreen() {
  const { locale } = useLocale();
  const copy = catalogTopologyCopy(locale);
  const { session } = useSession();
  const { rows, getSnapshot, listDeviceProfiles, connect, fail } = useCoreSessions();
  const bindings = session?.stack.current.coreBindings ?? [];

  const [selectedId, setSelectedId] = useState<CoreBindingId | null>(bindings[0]?.bindingId ?? null);
  const [view, setView] = useState<"catalog" | "topology">("catalog");
  const [profilesByBinding, setProfilesByBinding] = useState<Map<CoreBindingId, ProfileIndex>>(new Map());

  const selected: CoreBindingRecord | null = bindings.find((b) => b.bindingId === selectedId) ?? bindings[0] ?? null;
  const row = rows.find((r) => r.binding.bindingId === selected?.bindingId);
  const snapshot = selected ? getSnapshot(selected.bindingId) : undefined;

  useEffect(() => {
    if (!selected || row?.sessionState !== "READY") return;
    if (profilesByBinding.has(selected.bindingId)) return;
    const pending = listDeviceProfiles(selected.bindingId);
    if (!pending) return;
    let cancelled = false;
    pending
      .then((profiles) => {
        if (cancelled) return;
        setProfilesByBinding((prev) => new Map(prev).set(selected.bindingId, normalizeProfilePages([{ profiles, nextCursor: 0 }], true)));
      })
      .catch(() => {
        /* Il badge fingerprint/catalogo resta comunque utile anche senza i Profile — un fallimento qui non blocca il resto della schermata. */
      });
    return () => {
      cancelled = true;
    };
  }, [selected, row?.sessionState, listDeviceProfiles, profilesByBinding]);

  const catalogIndex = useMemo(() => (snapshot?.catalog ? normalizeCatalogPages([snapshot.catalog], true) : null), [snapshot]);
  const topologyIndex = useMemo(() => (snapshot?.topology ? normalizeTopologyPages([snapshot.topology], true) : null), [snapshot]);
  const packIndex: CapabilityPackIndex | null = useMemo(() => (snapshot?.features ? normalizeCapabilityPacks(snapshot.features) : null), [snapshot]);
  const profileIndex = selected ? (profilesByBinding.get(selected.bindingId) ?? { profiles: [], complete: true }) : { profiles: [], complete: true };

  const partial = (catalogIndex && !catalogIndex.complete) || (topologyIndex && !topologyIndex.complete) || !profileIndex.complete;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 overflow-hidden border-b border-border bg-surface px-4">
        <div className="shrink-0">
          <CoreSelector bindings={bindings} selected={selected} onSelect={(b) => setSelectedId(b.bindingId)} />
        </div>
        <h1 className="min-w-0 flex-1 truncate font-heading text-lg font-semibold text-ink">Catalog & Topology Explorer</h1>
        <div className="flex shrink-0 items-center gap-1 rounded-slpill border border-border bg-surface p-1">
          <button type="button" onClick={() => setView("catalog")} className={`rounded-slpill px-3 py-1 font-body text-sm ${view === "catalog" ? "bg-brand-blue text-white" : "text-ink-muted"}`}>
            {copy.catalog}
          </button>
          <button type="button" onClick={() => setView("topology")} className={`rounded-slpill px-3 py-1 font-body text-sm ${view === "topology" ? "bg-brand-blue text-white" : "text-ink-muted"}`}>
            {copy.topology}
          </button>
        </div>
        {catalogIndex && catalogIndex.fingerprint.byteLength > 0 && <span className="hidden shrink-0 font-mono text-xs text-ink-faint lg:inline">fp: {fingerprintHex(catalogIndex.fingerprint)}…</span>}
      </div>

      {partial && (
        <div className="flex items-center gap-2 border-l-4 border-warning px-4 py-2" style={{ backgroundColor: "color-mix(in srgb, var(--color-warning) 8%, transparent)" }}>
          <TriangleAlert size={16} className="text-warning" />
          <span className="font-body text-sm text-ink">{copy.interrupted}</span>
          {selected && (
            <button
              type="button"
              onClick={() =>
                void reconnectCoreBinding(selected, connect).catch((cause: unknown) => {
                  fail(selected.bindingId, cause instanceof Error ? cause.message : String(cause));
                })
              }
              className="ml-auto font-body text-sm font-semibold text-info underline"
            >
              {copy.retryRead}
            </button>
          )}
        </div>
      )}

      {!selected ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="font-body text-sm text-ink-faint">{copy.noCore}</p>
        </div>
      ) : !snapshot?.catalog ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="font-body text-sm text-ink-muted">{copy.noData}</p>
          <button
            type="button"
            onClick={() =>
              void reconnectCoreBinding(selected, connect).catch((cause: unknown) => {
                fail(selected.bindingId, cause instanceof Error ? cause.message : String(cause));
              })
            }
            className="rounded-slpill bg-brand-blue px-4 py-2 font-body-strong text-sm text-white hover:bg-brand-blue-dark"
          >
            {copy.connectAndRead}
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">{view === "catalog" ? <CatalogView catalog={catalogIndex!} profiles={profileIndex} packs={packIndex} /> : <TopologyView topology={topologyIndex!} />}</div>
      )}
    </div>
  );
}
