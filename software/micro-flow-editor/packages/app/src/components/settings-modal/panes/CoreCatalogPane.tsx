import type { DeviceProfileSummary, GetCatalogResponse } from "@spaghettilab/protocol-sdk";
import { useState } from "react";
import { catalogTopologyCopy } from "../../../lib/catalog-topology-copy.js";
import { chromeCopy } from "../../../lib/chrome-copy.js";
import { useCoreSessions } from "../../../state/core-sessions-context.js";
import { useLocale } from "../../../state/locale-context.js";
import { useSession } from "../../../state/session-context.js";
import { CoreSelector } from "../../catalog-topology/CoreSelector.js";
import { InstalledDriverCard } from "../InstalledDriverCard.js";

export function CoreCatalogPane() {
  const { locale } = useLocale();
  const copy = chromeCopy(locale);
  const catalogCopy = catalogTopologyCopy(locale);
  const { session } = useSession();
  const { rows, getClient, listDeviceProfiles } = useCoreSessions();
  const bindings = session?.stack.current.coreBindings ?? [];
  const [selectedId, setSelectedId] = useState(bindings[0]?.bindingId ?? null);
  const selected = bindings.find((b) => b.bindingId === selectedId) ?? bindings[0] ?? null;
  const row = rows.find((r) => r.binding.bindingId === selected?.bindingId);
  const [catalog, setCatalog] = useState<GetCatalogResponse | null>(null);
  const [profiles, setProfiles] = useState<readonly DeviceProfileSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCatalog() {
    if (!selected) {
      setError(catalogCopy.noCoreInProject);
      return;
    }
    if (row?.sessionState !== "READY") {
      setError(catalogCopy.connectThenRequest);
      return;
    }
    const client = getClient(selected.bindingId);
    if (!client) {
      setError(catalogCopy.sessionAbsent);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await client.getFullCatalog();
      setCatalog(next);
      const list = await listDeviceProfiles(selected.bindingId);
      setProfiles(list ?? []);
    } catch (cause) {
      setCatalog(null);
      setProfiles([]);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h2 className="font-heading text-xl font-semibold text-ink">{copy.categories["core-catalog"].title}</h2>
      <p className="mt-1 font-body text-sm text-ink-muted">{copy.categories["core-catalog"].subtitle}</p>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <CoreSelector
          bindings={bindings}
          selected={selected}
          onSelect={(binding) => {
            setSelectedId(binding.bindingId);
            setCatalog(null);
            setProfiles([]);
            setError(null);
          }}
        />
        <button
          type="button"
          onClick={() => void requestCatalog()}
          disabled={loading}
          className="h-9 rounded-slsm bg-brand-blue px-4 font-body-strong text-sm text-white hover:bg-brand-blue-dark disabled:opacity-50"
        >
          {loading ? catalogCopy.requesting : catalogCopy.requestFromCore}
        </button>
      </div>

      {error && <p className="mt-4 font-body text-sm text-error">{error}</p>}

      {catalog && (
        <div className="mt-6 flex flex-col gap-1.5">
          <p className="mb-1 font-body text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
            {catalog.drivers.length === 1 ? "1 driver" : `${catalog.drivers.length} driver`}
          </p>
          {catalog.drivers.length === 0 ? (
            <p className="font-body text-sm text-ink-muted">Il Core non ha restituito driver.</p>
          ) : (
            catalog.drivers.map((driver) => (
              <InstalledDriverCard
                key={driver.typeId}
                typeId={driver.typeId}
                commandCount={driver.commandCount}
                profiles={driver.typeId === "declarative-device" ? profiles : []}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
