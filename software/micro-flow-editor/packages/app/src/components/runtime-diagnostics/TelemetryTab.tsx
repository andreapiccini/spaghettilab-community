import type { CoreBindingId } from "@spaghettilab/domain";
import { TelemetryBufferStore, type TelemetryGap } from "@spaghettilab/telemetry-buffer";
import { AlertTriangle, Radio } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { runtimeDiagnosticsCopy } from "../../lib/runtime-diagnostics-copy.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { useLocale } from "../../state/locale-context.js";

type SeqKey = string;

/**
 * `ux/screens/S090-runtime-diagnostics/visual.md` § Telemetria, cablato su
 * `@spaghettilab/telemetry-buffer` (S091). Gap dichiarato: `RecordEventPayload`
 * (via `CoreSession.onRecordEvent`) è solo una notifica —
 * `{sourceKey, sequence, schemaId, schemaVersion}`, mai i valori dei campi.
 * Non esiste in tutto il codebase né un'operazione wire `GET_RECORD` né un
 * decoder CBOR del payload MQTT raggiungibile da WebSocket/USB-seriale — ogni
 * record ricevuto qui viene quindi trattato onestamente come
 * `pushUnknownSchema` (nessun payload decodificato disponibile), mai valori
 * inventati. Il chiamante (`RuntimeDiagnosticsScreen`) monta questo
 * componente con `key={bindingId}`, così lo stato locale riparte pulito ad
 * ogni cambio di Core selezionato senza bisogno di un effetto di reset.
 */
export function TelemetryTab({ bindingId }: { readonly bindingId: CoreBindingId }) {
  const { locale } = useLocale();
  const copy = runtimeDiagnosticsCopy(locale);
  const { onRecordEvent, getLastBootId } = useCoreSessions();
  const [store] = useState(() => new TelemetryBufferStore());
  const seqRef = useRef(new Map<SeqKey, number>());
  const [schemaIds, setSchemaIds] = useState<readonly string[]>([]);
  const [selectedSchema, setSelectedSchema] = useState<string | null>(null);
  const [, forceRender] = useState(0);

  useEffect(() => {
    const unsubscribe = onRecordEvent(bindingId, (payload) => {
      const bootId = getLastBootId(bindingId);
      if (bootId !== undefined && bootId !== null) store.observeBootId(bindingId, bootId);

      const seqKey = `${payload.sourceKey}:${payload.schemaId}`;
      const prevSeq = seqRef.current.get(seqKey);
      if (prevSeq !== undefined && payload.sequence !== prevSeq + 1) {
        store.recordSequenceGap(bindingId, `source ${payload.sourceKey} / ${payload.schemaId}: sequence jumped from ${prevSeq} to ${payload.sequence}`);
      }
      seqRef.current.set(seqKey, payload.sequence);

      store.pushUnknownSchema(bindingId, payload.schemaId, {
        sourceKey: payload.sourceKey,
        schemaVersion: payload.schemaVersion,
        bootId: bootId ?? undefined,
        bootEpoch: store.bootEpochOf(bindingId),
        sequence: payload.sequence,
      });

      setSchemaIds((prev) => (prev.includes(payload.schemaId) ? prev : [...prev, payload.schemaId]));
      setSelectedSchema((prev) => prev ?? payload.schemaId);
      forceRender((n) => n + 1);
    });

    return unsubscribe;
  }, [bindingId, onRecordEvent, getLastBootId, store]);

  const entries = selectedSchema ? store.getEntries(bindingId, selectedSchema) : [];
  const gaps = store.getGaps(bindingId);

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <div className="rounded-slmd border-l-4 border-brand-purple-glow p-3" style={{ backgroundColor: "color-mix(in srgb, var(--color-brand-purple-glow) 6%, transparent)" }}>
        <p className="font-body text-sm text-ink">{copy.telemetryBody}</p>
        <p className="mt-0.5 font-body text-xs text-ink-muted">
          {copy.telemetryGap}
        </p>
      </div>

      {schemaIds.length === 0 ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="flex flex-col items-center gap-2 text-center">
            <Radio size={40} className="text-ink-faint" />
            <p className="font-body text-sm text-ink-muted">{copy.noRecords}</p>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {schemaIds.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => setSelectedSchema(id)}
                className="rounded-slpill px-3 py-1.5 font-mono text-xs"
                style={{
                  border: selectedSchema === id ? "2px solid var(--color-brand-blue)" : "1px solid var(--color-border-strong)",
                  backgroundColor: selectedSchema === id ? "color-mix(in srgb, var(--color-brand-blue) 8%, transparent)" : "transparent",
                }}
              >
                {id}
              </button>
            ))}
          </div>

          {gaps.length > 0 && (
            <div className="flex flex-col gap-1">
              {gaps.map((gap, i) => (
                <GapRow key={i} gap={gap} />
              ))}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            {entries
              .slice()
              .reverse()
              .map((entry, i) => (
                <div key={i} className="flex items-center gap-3 rounded-slsm border border-border p-2 font-mono text-xs">
                  <span className="rounded-slpill px-2 py-0.5" style={{ backgroundColor: "color-mix(in srgb, var(--color-ink-faint) 12%, transparent)" }}>
                    source {entry.record.provenance.sourceKey}
                  </span>
                  <span className="text-ink-muted">seq {entry.record.provenance.sequence}</span>
                  <span className="text-ink-muted">v{entry.record.provenance.schemaVersion}</span>
                  <span className="text-ink-muted">boot epoch {entry.record.provenance.bootEpoch}</span>
                  <span className="ml-auto text-ink-faint">nessun valore decodificato disponibile</span>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}

function GapRow({ gap }: { readonly gap: TelemetryGap }) {
  return (
    <div className="flex items-start gap-2 border-l-4 border-warning p-2" style={{ backgroundColor: "color-mix(in srgb, var(--color-warning) 8%, transparent)" }}>
      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-warning" />
      <p className="font-body text-xs text-ink">{gap.detail}</p>
    </div>
  );
}
