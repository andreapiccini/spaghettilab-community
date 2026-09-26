import { ClipboardList, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { LocalStorageAuditLog, type StoredAuditEntry } from "../../lib/local-storage-audit-log.js";
import { settingsSecurityCopy } from "../../lib/settings-security-copy.js";
import { useLocale } from "../../state/locale-context.js";

const auditLog = new LocalStorageAuditLog();

/**
 * `ux/screens/S120-settings-security/visual.md` § Audit — legge da
 * `LocalStorageAuditLog` (adattatore reale del port `AuditLog` di
 * `@spaghettilab/domain`, S121, scritto per questo task). Gap dichiarato:
 * nessuno screen precedente chiama ancora `recordSensitiveOperation()` per
 * le proprie azioni reali (connect Core, comando, install profilo, OTA,
 * reset, deploy Node-RED) — cablare ciascun punto di chiamata è un cambio
 * cross-cutting su più screen già costruiti, fuori scopo per questo task.
 * Questo tab è quindi reale ma onestamente vuoto finché quel cablaggio non
 * viene fatto altrove.
 */
export function AuditTab() {
  const { locale } = useLocale();
  const copy = settingsSecurityCopy(locale);
  const [entries, setEntries] = useState<readonly StoredAuditEntry[]>([]);
  const [filter, setFilter] = useState<string>("");

  function refresh() {
    auditLog.readAll().then(setEntries).catch(() => undefined);
  }

  useEffect(() => {
    auditLog.readAll().then(setEntries).catch(() => undefined);
  }, []);

  const operations = [...new Set(entries.map((e) => e.operation))];
  const filtered = filter ? entries.filter((e) => e.operation === filter) : entries;

  return (
    <div className="flex flex-col gap-4 p-6">
      <p className="font-body text-sm text-ink-muted">
        {copy.auditGap}
      </p>
      <div className="flex items-center gap-2">
        <select value={filter} onChange={(e) => setFilter(e.target.value)} className="rounded-slsm border border-border-strong px-2 py-1.5 font-mono text-xs outline-none">
          <option value="">{copy.allOperations}</option>
          {operations.map((op) => (
            <option key={op} value={op}>
              {op}
            </option>
          ))}
        </select>
        <button type="button" onClick={refresh} className="flex items-center gap-1 rounded-slsm border border-border-strong px-2 py-1 font-body text-xs text-ink hover:bg-surface-raised">
          <RefreshCw size={12} />
          {copy.refresh}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <ClipboardList size={40} className="text-ink-faint" />
          <p className="font-body text-sm text-ink-muted">{copy.noEntries}</p>
        </div>
      ) : (
        <div className="overflow-auto rounded-slmd border border-border">
          <table className="w-full font-mono text-xs">
            <thead>
              <tr className="border-b border-border bg-surface-sunken">
                <th className="p-2 text-left">{copy.timestamp}</th>
                <th className="p-2 text-left">{copy.operation}</th>
                <th className="p-2 text-left">{copy.target}</th>
                <th className="p-2 text-left">{copy.outcome}</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="p-2 text-ink-muted">{new Date(e.timestamp).toLocaleString(locale === "en" ? "en-US" : "it-IT")}</td>
                  <td className="p-2 text-ink">{e.operation}</td>
                  <td className="p-2 text-ink-muted">{e.target}</td>
                  <td className="p-2" style={{ color: e.outcome === "success" ? "var(--color-success)" : "var(--color-error)" }}>
                    {e.outcome}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
