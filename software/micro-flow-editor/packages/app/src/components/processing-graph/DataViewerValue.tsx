import type { RecordEventPayload } from "@spaghettilab/protocol-sdk";
import { decodeConfigCbor } from "@spaghettilab/config-decompiler";
import type { CoreBindingId } from "@spaghettilab/domain";
import { useEffect, useState } from "react";
import { Monitor } from "lucide-react";
import { useSession } from "../../state/session-context.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import {
  formatViewerValue,
  viewerColor,
  type ViewerColorKind,
  viewerModuleMatches,
  type ViewerValue,
} from "../../lib/data-viewer.js";
export type ViewerSource = {
  colorKind?: ViewerColorKind;
  key: number;
  field: number;
  action?: number;
  schemaId?: string;
  profileId?: string;
  valueKind?: "digital" | "boolean" | "number" | "text";
  label?: string;
  unit?: string;
};
export type DataViewerUi = {
  colorKind?: ViewerColorKind;
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
  const { requestDeploy } = useSession();
  const { onRecordEvent, getRecentRecords, rows, getLastBootId, getSnapshot } =
    useCoreSessions();
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
  const live = config.bindingId
    ? getSnapshot(config.bindingId as CoreBindingId)?.config
    : undefined;
  const decoded = live ? decodeConfigCbor(live.configBytes) : undefined;
  const deployed =
    !!source &&
    !!decoded?.ok &&
    (decoded.value.modules.some((module) => viewerModuleMatches(module, source)) ||
      decoded.value.blocks.some(
        (block) =>
          block.typeId === "publish_field" &&
          Number(block.properties[4]) === source.key &&
          block.properties[1] === source.schemaId,
      ));
  useEffect(() => {
    setSample(undefined);
    if (!config.bindingId || !source || !ready || !deployed) return;
    const receive = (event: RecordEventPayload, at = Date.now()) => {
      if (
        event.sourceKey !== source.key ||
        (source.schemaId && source.schemaId !== event.schemaId)
      )
        return;
      if (source.action && event.actionId && source.action !== event.actionId) return;
      if (!event.fields) {
        setSample({ value: "", at, missing: true });
        return;
      }
      const value = event.fields[source.field];
      if (value !== undefined) setSample({ value, at, missing: false });
    };
    for (const record of getRecentRecords(config.bindingId as CoreBindingId))
      receive(record.payload, record.at);
    return onRecordEvent(config.bindingId as CoreBindingId, receive);
  }, [
    config.bindingId,
    source?.key,
    source?.field,
    source?.action,
    source?.schemaId,
    onRecordEvent,
    getRecentRecords,
    ready,
    bootId,
    deployed,
    live?.generation,
  ]);
  const displaySample = sample && !sample.missing ? sample : undefined;
  const unit = config.unit || source?.unit;
  const formatted = displaySample
    ? formatViewerValue(displaySample.value, config.decimals, source?.valueKind)
    : undefined;
  const colorKind = source?.colorKind ?? config.colorKind;
  const color = displaySample ? viewerColor(displaySample.value, colorKind) : undefined;
  const status = !config.connected
    ? "Collega un’uscita a Mostra valore"
    : !ready
      ? "Backbone non connessa"
      : config.error
        ? config.error
        : sample?.missing
          ? "Aggiorna il firmware per ricevere i valori"
          : !source || !deployed
            ? "Collegamento non ancora caricato sulla Backbone"
            : !sample
              ? "In attesa del dato: avvia il programma o premi Attiva"
              : `Aggiornato alle ${new Date(sample.at).toLocaleTimeString("it-IT")}`;
  return (
    <div className="pointer-events-none flex h-full min-h-0 min-w-0 flex-col gap-1.5 overflow-hidden rounded-[inherit] p-3">
      <div className="flex shrink-0 items-center gap-2 pr-5 text-brand-blue">
        <Monitor size={16} />
        <span className="text-xs font-semibold">Visualizza dati</span>
      </div>
      {config.caption && (
        <div
          className="min-w-0 max-h-10 shrink-0 overflow-auto break-words text-sm font-semibold leading-tight text-ink"
          title={config.caption}
        >
          {config.caption}
        </div>
      )}
      <div
        className="nopan nowheel select-none pointer-events-auto min-h-7 max-h-12 flex-1 overflow-auto break-words whitespace-pre-wrap font-mono text-xl font-semibold leading-tight text-ink"
        title={color?.text ?? formatted?.text}
      >
        {color ? (
          <span className="flex items-center gap-3">
            <span
              role="img"
              aria-label={`Anteprima ${color.type}: ${color.text}`}
              className="h-9 w-12 shrink-0 rounded-lg border border-black/15 shadow-inner"
              style={{ backgroundColor: color.color }}
            />
            <span className="text-base">{color.text}</span>
          </span>
        ) : formatted ? (
          formatted.text === "" ? (
            '""'
          ) : (
            formatted.text
          )
        ) : (
          "—"
        )}
        {formatted && unit && !colorKind ? (
          <span className="ml-2 text-sm font-normal text-ink-muted">{unit}</span>
        ) : null}
      </div>
      <div className="mt-auto flex min-w-0 shrink-0 items-center gap-2 text-[10px] text-ink-muted">
        {config.connected && ready && source && !deployed && !config.error ? (
          <button
            type="button"
            className="nodrag nopan pointer-events-auto min-w-0 rounded-md border border-brand-blue px-2 py-1 text-[10px] font-medium leading-tight text-brand-blue"
            onClick={(event) => {
              event.stopPropagation();
              requestDeploy();
            }}
            onDoubleClick={(event) => event.stopPropagation()}
            title="Collegamento non ancora caricato. Puoi scegliere anche le prove manuali."
          >
            Carica configurazione
          </button>
        ) : (
          <>
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${formatted && ready ? "bg-green-500" : "bg-slate-300"}`}
            />
            <span
              className="nopan nowheel pointer-events-auto min-w-0 max-h-9 flex-1 overflow-auto break-words leading-tight"
              title={status}
            >
              {status}
            </span>
          </>
        )}
        {(formatted || source?.valueKind || colorKind) && (
          <span className="ml-auto shrink-0" title="Tipo di dato in ingresso">
            {color?.type ??
              (colorKind
                ? {
                    hex: "Colore",
                    rgb: "Colore RGB",
                    red: "Rosso",
                    green: "Verde",
                    blue: "Blu",
                  }[colorKind]
                : undefined) ??
              formatted?.type ??
              {
                digital: "Digitale",
                boolean: "Booleano",
                number: "Numerico",
                text: "Testo",
              }[source!.valueKind!]}
          </span>
        )}
      </div>
    </div>
  );
}
