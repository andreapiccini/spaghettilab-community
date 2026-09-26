import { Handle, Position, type NodeProps } from "@xyflow/react";
import { processingGraphCopy } from "../../lib/processing-graph-copy.js";
import { useLocale } from "../../state/locale-context.js";
import { HoverDeleteButton } from "./HoverDeleteButton.js";
import { PROCESSING_NODE_KIND_CONFIG } from "./node-kinds.js";
import { SOURCE_HANDLE_STYLE, TARGET_HANDLE_STYLE } from "./node-ports.js";

export type EventContainerNodeData = {
  readonly label: string;
  readonly kind: "schedule" | "event-source";
  /** Visitor demo: e.g. "Firmware function" under the Schedule title. */
  readonly roleLabel?: string;
  /** Schedule period in ms — shown as a non-truncating badge beside the title. */
  readonly periodMs?: number;
  /** A member is being dragged past the top/left dashed edge — release outside detaches it. */
  readonly rejecting?: boolean;
  /** A free block is being dragged into this dashed box — release inside attaches it. */
  readonly accepting?: boolean;
  /** Dry-run: brief tick pulse — shown as a pallino, not a full-box highlight. */
  readonly previewActive?: boolean;
};

/**
 * A real React Flow parent node representing "everything that runs when this
 * event fires" — a dashed rectangle whose members are true React Flow
 * children (`parentId`, set in ProcessingGraphScreen). Schedule has no canvas
 * handles — activation goes via the fixed violet tick disc; event-source keeps ports.
 */
export function EventContainerNode({ id, data, selected }: NodeProps & { readonly data: EventContainerNodeData }) {
  const { locale } = useLocale();
  const copy = processingGraphCopy(locale);
  const config = PROCESSING_NODE_KIND_CONFIG[data.kind];
  const Icon = config.icon;

  const rejecting = data.rejecting === true;
  const accepting = data.accepting === true;
  const tickPulse = data.previewActive === true;
  const highlight = rejecting ? "var(--color-error)" : accepting ? "var(--color-success)" : undefined;
  const idle = highlight === undefined && !selected;
  const periodLabel = data.kind === "schedule" && data.periodMs !== undefined ? copy.everyMs(data.periodMs) : undefined;
  return (
    <div
      data-tour-target={`flow-node-${id}`}
      className={`group relative flex h-full w-full cursor-pointer flex-col overflow-visible rounded-slmd border-2 border-dashed transition-colors ${idle ? "border-border-strong hover:border-brand-blue" : ""}`}
      style={{
        borderColor: highlight ?? (selected ? "var(--color-brand-blue)" : undefined),
        backgroundColor: highlight
          ? `color-mix(in srgb, ${highlight} 8%, transparent)`
          : selected
            ? `color-mix(in srgb, var(--color-brand-blue) 8%, transparent)`
            : `color-mix(in srgb, ${config.colorVar} 4%, transparent)`,
      }}
    >
      <HoverDeleteButton id={id} label={copy.deleteContainer} forceVisible={selected} />
      {data.kind === "event-source" && (
        <>
          <Handle type="target" position={Position.Left} id="0" style={{ ...TARGET_HANDLE_STYLE, top: 16 }} />
          <Handle type="source" position={Position.Right} id="0" style={{ ...SOURCE_HANDLE_STYLE, top: 16 }} />
        </>
      )}
      <div className="flex h-8 shrink-0 items-center gap-1.5 px-2">
        <Icon size={13} className="shrink-0" style={{ color: config.colorVar }} />
        <span className="min-w-0 truncate font-body text-xs font-semibold text-ink-muted group-hover:text-brand-blue">
          {data.label}
        </span>
        {data.roleLabel && (
          <span
            className="shrink-0 rounded-slsm px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide"
            style={{
              color: config.colorVar,
              backgroundColor: `color-mix(in srgb, ${config.colorVar} 12%, transparent)`,
            }}
          >
            {data.roleLabel}
          </span>
        )}
        {periodLabel && (
          <span
            className={`shrink-0 rounded-slsm px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums${data.roleLabel ? "" : " ml-auto"}`}
            style={{
              color: config.colorVar,
              backgroundColor: `color-mix(in srgb, ${config.colorVar} 12%, transparent)`,
              marginLeft: data.roleLabel ? 4 : undefined,
            }}
          >
            {periodLabel}
          </span>
        )}
        {data.kind === "schedule" && (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full transition-[opacity,box-shadow,background-color] duration-75"
            style={{
              marginLeft: periodLabel ? 4 : "auto",
              backgroundColor: tickPulse ? config.colorVar : "color-mix(in srgb, var(--color-ink-faint) 35%, transparent)",
              opacity: tickPulse ? 1 : 0.45,
              boxShadow: tickPulse ? `0 0 0 3px color-mix(in srgb, ${config.colorVar} 35%, transparent)` : undefined,
            }}
            title="Tick Schedule"
            aria-hidden
          />
        )}
      </div>
    </div>
  );
}

export const EVENT_CONTAINER_NODE_TYPES = { "event-container": EventContainerNode };
