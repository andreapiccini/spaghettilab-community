import type { ProjectHistoryEntry } from "@spaghettilab/project-store";
import { History, RotateCcw, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { projectAutosaveStore } from "../../lib/repository.js";
import { settingsSecurityCopy } from "../../lib/settings-security-copy.js";
import { useLocale } from "../../state/locale-context.js";
import { useSession } from "../../state/session-context.js";

/**
 * `ux/screens/S120-settings-security/visual.md` § Backup & Versioni, cablato
 * su `@spaghettilab/project-store`'s `ProjectAutosaveStore` (S122, reale —
 * costruito ma mai istanziato in questa app prima di questo task, vedi
 * `repository.ts`). Gap dichiarato: questo tab usa un percorso di
 * salvataggio separato dal "Salva progetto" del Command Palette
 * (`projectRepository`, un layout di chiavi diverso) — la cronologia qui
 * riflette solo i salvataggi fatti da questo tab, non quelli da Cmd+S.
 */
export function BackupVersionsTab() {
  const { locale } = useLocale();
  const copy = settingsSecurityCopy(locale);
  const { session, execute } = useSession();
  const [revision, setRevision] = useState<number | null>(null);
  const [history, setHistory] = useState<readonly ProjectHistoryEntry[]>([]);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    void projectAutosaveStore.history(session.projectId).then(setHistory);
  }, [session]);

  async function handleSave() {
    if (!session) return;
    setStatus("saving");
    setError(null);
    const result = await projectAutosaveStore.save(session.projectId, session.stack.current, revision);
    if (!result.ok) {
      setStatus("error");
      setError(result.error.remediation);
      return;
    }
    setRevision(result.value.revision);
    setHistory((prev) => [result.value, ...prev]);
    setStatus("saved");
  }

  async function handleRestore(entry: ProjectHistoryEntry) {
    if (!session || !execute) return;
    const loaded = await projectAutosaveStore.load(session.projectId);
    if (!loaded.ok) {
      setError(copy.cannotReadHistory);
      return;
    }
    // `load()` restituisce sempre la revisione corrente (head) — per ripristinare una
    // revisione storica specifica servirebbe un metodo `loadRevision(id, rev)` pubblico,
    // che il pacchetto non espone (solo `load()`/`save()`/`history()`). Gap dichiarato:
    // "Ripristina" qui può solo confermare che la revisione selezionata esiste nella
    // cronologia, non recuperarne il contenuto — il pulsante è quindi disattivato.
    void entry;
    void loaded;
  }

  const statusLabel = { idle: copy.notSavedThisSession, saving: copy.saving, saved: copy.saved, error: copy.saveError }[status];
  const statusColor = status === "error" ? "var(--color-error)" : status === "saved" ? "var(--color-success)" : "var(--color-ink-faint)";

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="font-body text-sm text-ink-faint">{copy.noOpenProject}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 rounded-slpill border border-border-strong px-3 py-1.5 font-body text-xs" style={{ color: statusColor }}>
          {statusLabel}
        </span>
        <button type="button" onClick={() => void handleSave()} disabled={status === "saving"} className="flex items-center gap-1.5 rounded-slpill bg-brand-blue px-4 py-1.5 font-body-strong text-sm text-white hover:bg-brand-blue-dark disabled:opacity-40">
          <Save size={14} />
          {copy.saveNow}
        </button>
      </div>
      {error && <p className="font-body text-sm text-error">{error}</p>}

      <div>
        <h2 className="font-heading text-sm font-semibold text-ink">{copy.versionHistory}</h2>
        {history.length === 0 ? (
          <div className="mt-2 flex flex-col items-center gap-2 py-8 text-center">
            <History size={32} className="text-ink-faint" />
            <p className="font-body text-sm text-ink-muted">{copy.noVersions}</p>
          </div>
        ) : (
          <div className="mt-2 flex flex-col gap-1">
            {history.map((h) => (
              <div key={h.revision} className="flex items-center gap-3 rounded-slsm border border-border p-2 font-mono text-xs">
                <span className="text-ink">rev {h.revision}</span>
                <span className="text-ink-faint">{new Date(h.updatedAt).toLocaleString(locale === "en" ? "en-US" : "it-IT")}</span>
                <button type="button" disabled title={copy.restoreDisabledTitle} onClick={() => void handleRestore(h)} className="ml-auto flex items-center gap-1 rounded-slsm border border-border-strong px-2 py-1 font-body text-xs text-ink opacity-40">
                  <RotateCcw size={11} />
                  {copy.restore}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
