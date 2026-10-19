import { decodeConfigCbor } from "@spaghettilab/config-decompiler";
import type { CoreBindingId } from "@spaghettilab/domain";
import { useEffect, useState } from "react";
import { Monitor } from "lucide-react";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { formatViewerValue, type ViewerValue } from "../../lib/data-viewer.js";
export type ViewerSource = {
  key: number;
  field: number;
  action?: number;
  schemaId?: string;
  valueKind?: "digital" | "boolean" | "number" | "text";
  label?: string;
  unit?: string;
};
export type DataViewerUi = {
  bindingId?: string;
  source?: ViewerSource;
  connected: boolean;
  caption: string;
  unit: string;
  decimals: number;
  error?: string;
};
/** Event driven: displaying never runs a sensor command or creates another polling loop. */
export function DataViewerValue({ config }: { config: DataViewerUi }) {
  const { onRecordEvent, rows, getLastBootId, getSnapshot } = useCoreSessions();
  const ready =
    rows.find((row) => row.binding.bindingId === config.bindingId)?.sessionState ===
    "READY";
  const bootId = config.bindingId
    ? getLastBootId(config.bindingId as CoreBindingId)
    : undefined;
  const [sample, setSample] = useState<{
    value: ViewerValue;
    at: number;
    missing: boolean;
  }>();
  const source = config.source;
  const live = config.bindingId ? getSnapshot(config.bindingId as CoreBindingId)?.config : undefined;
  const decoded = live ? decodeConfigCbor(live.configBytes) : undefined;
  const deployed = !!source && !!decoded?.ok && (
    decoded.value.modules.some(module => module.key === source.key && (!source.schemaId || `${module.properties[1]}.s` === source.schemaId)) ||
    decoded.value.blocks.some(block => block.typeId === "publish_field" && Number(block.properties[4]) === source.key && block.properties[1] === source.schemaId)
  );
  useEffect(() => {
    setSample(undefined);
    if (!config.bindingId || !source || !ready || !deployed) return;
    return onRecordEvent(config.bindingId as CoreBindingId, (event) => {
      if (
        event.sourceKey !== source.key ||
        (source.schemaId && source.schemaId !== event.schemaId)
      )
        return;
      if (source.action && event.actionId && source.action !== event.actionId) return;
      if (!event.fields) {
        setSample({ value: "", at: Date.now(), missing: true });
        return;
      }
      const value = event.fields[source.field];
      if (value !== undefined) setSample({ value, at: Date.now(), missing: false });
    });
  }, [
    config.bindingId,
    source?.key,
    source?.field,
    source?.action,
    source?.schemaId,
    onRecordEvent,
    ready,
    bootId,
    deployed,
    live?.generation,
  ]);
  const formatted =
    sample && !sample.missing
      ? formatViewerValue(sample.value, config.decimals, source?.valueKind)
      : undefined;
  const status = !config.connected
    ? "Collega un’uscita a Mostra valore"
    : !ready
      ? "Backbone non connessa"
      : config.error
        ? config.error
        : sample?.missing
          ? "Aggiorna il firmware per ricevere i valori"
          : !source || !deployed
            ? "Esegui Run Deploy per collegare la sorgente"
            : !sample
              ? "In attesa del primo dato"
              : `Aggiornato alle ${new Date(sample.at).toLocaleTimeString("it-IT")}`;
  return (
    <div className="pointer-events-none flex h-full flex-col gap-1.5 p-3">
      <div className="flex items-center gap-2 text-brand-blue">
        <Monitor size={16} />
        <span className="text-xs font-semibold">Visualizza dati</span>
      </div>
      {config.caption && <div className="text-sm font-semibold text-ink">{config.caption}</div>}
      <div
        className="nopan nowheel select-none pointer-events-auto min-h-7 max-h-12 overflow-auto break-words whitespace-pre-wrap font-mono text-xl font-semibold leading-tight text-ink"
        title={formatted?.text}
      >
        {formatted ? (formatted.text === "" ? '""' : formatted.text) : "—"}
        {formatted && config.unit ? (
          <span className="ml-2 text-sm font-normal text-ink-muted">{config.unit}</span>
        ) : null}
      </div>
      <div className="mt-auto flex items-center gap-2 text-[10px] text-ink-muted">
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${formatted && ready ? "bg-green-500" : "bg-slate-300"}`}
        />
        <span>{status}</span>
        {(formatted || source?.valueKind) && <span className="ml-auto" title="Tipo di dato in ingresso">{formatted?.type ?? ({ digital: "Digitale", boolean: "Booleano", number: "Numerico", text: "Testo" }[source!.valueKind!])}</span>}
      </div>
    </div>
  );
}
