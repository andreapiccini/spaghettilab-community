import type { CoreBindingId } from "@spaghettilab/domain";
import { compareResourceBudget, preflightOtaCandidate, type CoreOtaContext, type OtaCandidateManifest, type PreflightResult, type UpdateState } from "@spaghettilab/ota-preflight";
import { AlertTriangle, CheckCircle2, Upload, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { marketplaceCopy } from "../../lib/marketplace-copy.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { useLocale } from "../../state/locale-context.js";
import { parseOtaCandidateManifestJson } from "./ota-candidate-json.js";

function outcomeLabel(kind: string, copy: ReturnType<typeof marketplaceCopy>): string {
  return copy.outcomes[kind] ?? kind;
}

/**
 * `ux/screens/S100-capability-marketplace/visual.md` § Preflight, cablato su
 * `@spaghettilab/ota-preflight` (S102, reale, puro calcolo locale — nessuna
 * operazione wire `VALIDATE_OTA_CANDIDATE` esiste). Gap dichiarato: nessun
 * parser dedicato per il manifest JSON del candidato OTA esiste nel
 * pacchetto (a differenza dell'indice marketplace) — vedi
 * `ota-candidate-json.ts`.
 */
export function PreflightTab({
  bindingId,
  candidate,
  onCandidateChange,
  onPreflightComputed,
  onStartUpdate,
}: {
  readonly bindingId: CoreBindingId;
  readonly candidate: OtaCandidateManifest | null;
  readonly onCandidateChange: (candidate: OtaCandidateManifest) => void;
  readonly onPreflightComputed: (result: PreflightResult | null) => void;
  readonly onStartUpdate: () => void;
}) {
  const { locale } = useLocale();
  const copy = marketplaceCopy(locale);
  const { getSnapshot, getUpdateStatus } = useCoreSessions();
  const [importError, setImportError] = useState<string | null>(null);
  const [updateState, setUpdateState] = useState<UpdateState | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const snapshot = getSnapshot(bindingId);

  useEffect(() => {
    let cancelled = false;
    getUpdateStatus(bindingId)
      ?.then((status) => {
        if (!cancelled) setUpdateState(status.state as UpdateState);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [bindingId, getUpdateStatus]);

  const context: CoreOtaContext | null =
    snapshot?.status && snapshot.capabilities && snapshot.catalog && snapshot.resources && updateState !== null
      ? {
          coreVariant: snapshot.capabilities.coreVariant,
          resourceProfile: snapshot.capabilities.resourceProfile,
          protocolVersion: snapshot.catalog.protocolVersion,
          configVersion: snapshot.catalog.configVersion,
          currentFwVersion: snapshot.status.version,
          updateState,
          resources: snapshot.resources,
        }
      : null;

  const preflight = candidate && context ? preflightOtaCandidate(candidate, context) : null;
  useEffect(() => {
    onPreflightComputed(preflight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preflight?.kind, preflight?.reason]);

  const budget = candidate && snapshot?.resources ? compareResourceBudget(candidate, snapshot.resources) : null;

  function handleImport(file: File) {
    setImportError(null);
    file
      .text()
      .then((text) => {
        const result = parseOtaCandidateManifestJson(text);
        if (result.ok) onCandidateChange(result.value);
        else setImportError(result.error);
      })
      .catch((cause: unknown) => setImportError(cause instanceof Error ? cause.message : String(cause)));
  }

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => fileInputRef.current?.click()} className="flex items-center gap-1.5 rounded-slpill bg-brand-blue px-3 py-1.5 font-body-strong text-xs text-white hover:bg-brand-blue-dark">
          <Upload size={12} />
          Importa manifest candidato OTA
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
        {candidate && (
          <span className="font-mono text-xs text-ink-muted">
            {candidate.coreVariant} · fw {candidate.fwVersion}
          </span>
        )}
      </div>
      {importError && <p className="font-body text-xs text-error">{importError}</p>}

      {!candidate ? (
        <div className="flex flex-1 items-center justify-center">
          <p className="font-body text-sm text-ink-faint">{copy.noOtaCandidate}</p>
        </div>
      ) : !preflight ? (
        <p className="font-body text-sm text-ink-faint">{copy.waitingCore}</p>
      ) : (
        <>
          <div className="flex items-center gap-2 rounded-slmd border-2 p-3" style={{ borderColor: preflight.kind === "READY" ? "var(--color-success)" : "var(--color-error)" }}>
            {preflight.kind === "READY" ? <CheckCircle2 size={18} className="text-success" /> : <XCircle size={18} className="text-error" />}
            <div>
              <p className="font-body-strong text-sm text-ink">{outcomeLabel(preflight.kind, copy)}</p>
              <p className="font-body text-xs text-ink-muted">{preflight.reason}</p>
            </div>
            <button
              type="button"
              disabled={preflight.kind !== "READY"}
              onClick={onStartUpdate}
              className="ml-auto rounded-slpill bg-brand-purple-glow px-4 py-1.5 font-body-strong text-xs text-white hover:opacity-90 disabled:opacity-40"
            >
              {copy.startOta}
            </button>
          </div>

          {budget && (
            <div>
              <h2 className="font-heading text-sm font-semibold text-ink">{copy.resourceBudget}</h2>
              <div className="mt-2 overflow-auto rounded-slmd border border-border">
                <table className="w-full font-mono text-xs">
                  <thead>
                    <tr className="border-b border-border bg-surface-sunken">
                      <th className="p-2 text-left">{copy.dimension}</th>
                      <th className="p-2 text-right">{copy.requiredBytes}</th>
                      <th className="p-2 text-right">{copy.capacity}</th>
                      <th className="p-2 text-right">{copy.margin}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {budget.deltas.map((d) => (
                      <tr key={d.dimension} className="border-b border-border last:border-0">
                        <td className="p-2 text-ink">{d.dimension}</td>
                        <td className="p-2 text-right text-ink-muted">{d.requiredBytes}</td>
                        <td className="p-2 text-right text-ink-muted">{d.availableBytes}</td>
                        <td className="p-2 text-right" style={{ color: d.marginBytes < 0 ? "var(--color-error)" : "var(--color-success)" }}>
                          {d.marginBytes}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {preflight.budgetDeltas && preflight.budgetDeltas.length > 0 && preflight.kind !== "READY" && (
            <div className="flex items-start gap-2 border-l-4 border-error p-3" style={{ backgroundColor: "color-mix(in srgb, var(--color-error) 6%, transparent)" }}>
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-error" />
              <p className="font-body text-sm text-ink">{copy.preflightBlocked(preflight.budgetDeltas.length)}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
