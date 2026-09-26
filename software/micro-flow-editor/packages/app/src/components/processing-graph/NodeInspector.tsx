import type { DomainError, GraphEdge, GraphNode } from "@spaghettilab/domain";
import { isBlockNodeData, isRuleNodeData, validateDeviceProcessingGraph, type DeviceProcessingNodeData } from "@spaghettilab/device-processing-graph-model";
import {
  catalogEntriesForNodeKind,
  defaultPropertiesFromFields,
  findCatalogEntriesByTypeId,
  findCatalogEntryById,
  type CatalogField,
  type ProcessingCatalogEntry,
} from "@spaghettilab/processing-block-catalog";
import { Plus, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { motionTokens } from "../../lib/motion-tokens.js";
import { localizeCatalogEntry, localizeCatalogEntries } from "../../lib/processing-catalog-copy.js";
import { processingGraphCopy } from "../../lib/processing-graph-copy.js";
import { useLocale } from "../../state/locale-context.js";
import { pinCaption, pinLetter, selectableSignalsForPort, signalsForRole, type CustomProtocol, type PortPinMap } from "../../lib/port-protocol-mock.js";
import { usePortProtocol } from "../../state/port-protocol-context.js";
import { visualForCatalogEntryId } from "./block-visuals.js";
import { catalogEntryForNode, propertiesOf } from "./catalog-entry-for-node.js";
import { commentAfterCatalogChange } from "./catalog-to-node.js";
import { isLedBlock, isRgbLedBlock, ledColorFromProperties } from "./dry-run-preview.js";
import { inspectorVisibleFields } from "./inspector-visible-fields.js";
import { PROCESSING_NODE_KIND_CONFIG } from "./node-kinds.js";
import { withThresholdFirmwareFields } from "./threshold-rule-fields.js";
import { parseRgbLedConfig, rgbLedVisualAt } from "./rgb-led-model.js";
import { RgbLedSequenceEditor } from "./RgbLedSequenceEditor.js";

function TypeIdSelect({
  id,
  kind,
  value,
  catalogEntryId,
  onChange,
}: {
  readonly id: string;
  readonly kind: "block" | "rule";
  readonly value: string;
  readonly catalogEntryId?: string;
  readonly onChange: (typeId: string, entry: ProcessingCatalogEntry | undefined) => void;
}) {
  const { locale } = useLocale();
  const copy = processingGraphCopy(locale);
  const options = uniqueTypeOptions(kind, locale);
  const known = options.some((o) => o.typeId === value);
  const selected =
    catalogEntryId && options.some((o) => o.entryId === catalogEntryId)
      ? catalogEntryId
      : (options.find((o) => o.typeId === value)?.entryId ?? value);
  return (
    <select
      id={id}
      value={selected}
      onChange={(e) => {
        const chosen = options.find((o) => o.entryId === e.target.value) ?? options.find((o) => o.typeId === e.target.value);
        onChange(chosen?.typeId ?? e.target.value, chosen ? findCatalogEntryById(chosen.entryId) : findCatalogEntriesByTypeId(e.target.value)[0]);
      }}
      className="mb-2 w-full rounded-slsm border border-border-strong px-2 py-1.5 font-mono text-sm outline-none"
    >
      <option value="">—</option>
      {!known && value !== "" && <option value={value}>{value} ({copy.notInCatalog})</option>}
      {options.map((o) => (
        <option key={o.entryId} value={o.entryId}>
          {o.label} ({o.typeId}){o.planned ? ` · ${copy.plannedSuffix}` : ""}
        </option>
      ))}
    </select>
  );
}

function uniqueTypeOptions(
  kind: "block" | "rule",
  locale: "it" | "en" = "it",
): readonly { readonly entryId: string; readonly typeId: string; readonly label: string; readonly planned: boolean }[] {
  return localizeCatalogEntries(catalogEntriesForNodeKind(kind), locale)
    .filter((entry): entry is ProcessingCatalogEntry & { typeId: string } => Boolean(entry.typeId))
    .map((entry) => ({
      entryId: entry.id,
      typeId: entry.typeId,
      label: entry.label,
      planned: entry.availability === "planned",
    }));
}

export type ProcessingInspectorMode = { readonly kind: "create"; readonly nodeKind: DeviceProcessingNodeData["kind"] } | { readonly kind: "edit"; readonly nodeId: string; readonly data: DeviceProcessingNodeData; readonly comment: string };

function defaultDataFor(kind: DeviceProcessingNodeData["kind"], firstModuleId: string | undefined): DeviceProcessingNodeData {
  switch (kind) {
    case "schedule":
      return { kind: "schedule", moduleNodeId: firstModuleId ?? "", periodMs: 1000, enabled: true };
    case "event-source":
      return { kind: "event-source", moduleNodeId: firstModuleId ?? "", catalogEntryId: "native.event-source", properties: {} };
    case "block":
      return { kind: "block", blockTypeId: "", properties: {} };
    case "rule":
      return { kind: "rule", ruleTypeId: "", properties: {} };
  }
}

function withFieldDefaults(data: DeviceProcessingNodeData): DeviceProcessingNodeData {
  const entry = catalogEntryForNode(data);
  if (!entry?.fields?.length) return data;
  const defaults = defaultPropertiesFromFields(entry.fields);
  if (data.kind === "block") return { ...data, properties: { ...defaults, ...data.properties } };
  if (data.kind === "event-source") return { ...data, properties: { ...defaults, ...data.properties } };
  if (data.kind === "rule") {
    const merged = { ...defaults, ...data.properties };
    return {
      ...data,
      properties: data.ruleTypeId === "threshold" ? withThresholdFirmwareFields(merged) : merged,
    };
  }
  return data;
}

export function NodeInspector({
  mode,
  moduleOptions,
  existingNodes,
  existingEdges,
  nodeLabel,
  knownModuleNodeIds,
  onSave,
  onApply,
  onDelete,
  onClose,
}: {
  readonly mode: ProcessingInspectorMode;
  readonly moduleOptions: readonly { readonly id: string; readonly label: string; readonly portId?: number }[];
  readonly existingNodes: readonly GraphNode<"device-processing", string, DeviceProcessingNodeData>[];
  readonly existingEdges: readonly GraphEdge<"device-processing", string, string>[];
  readonly nodeLabel: (nodeId: string) => string;
  readonly knownModuleNodeIds: ReadonlySet<string>;
  readonly onSave: (data: DeviceProcessingNodeData, comment: string) => void;
  readonly onApply?: (data: DeviceProcessingNodeData, comment: string) => void;
  readonly onDelete?: () => void;
  readonly onClose: () => void;
}) {
  const { locale } = useLocale();
  const copy = processingGraphCopy(locale);
  const [comment, setComment] = useState(mode.kind === "edit" ? mode.comment : "");
  const [data, setData] = useState<DeviceProcessingNodeData>(() =>
    withFieldDefaults(mode.kind === "edit" ? mode.data : defaultDataFor(mode.nodeKind, moduleOptions[0]?.id)),
  );
  const nodeId = mode.kind === "edit" ? mode.nodeId : "__draft__";
  const config = PROCESSING_NODE_KIND_CONFIG[data.kind];
  const catalogEntry = catalogEntryForNode(data);
  const localizedEntry = catalogEntry ? localizeCatalogEntry(catalogEntry, locale) : undefined;
  const catalogFields =
    data.kind === "rule" && data.ruleTypeId === "threshold"
      ? (localizeCatalogEntry(catalogEntry ?? findCatalogEntryById("rule.threshold")!, locale).fields ?? [])
      : (localizedEntry?.fields ?? []);
  const namedFields = inspectorVisibleFields(catalogEntry, catalogFields);
  const showModulePicker = data.kind === "event-source" && catalogEntry?.needsModule !== false;
  const authoringType = Boolean(data.kind === "block" && data.blockTypeId.startsWith("ab."));
  const { protocolFor, pinMapOf } = usePortProtocol();
  const selectedPortId =
    data.kind === "schedule" || data.kind === "event-source"
      ? moduleOptions.find((m) => m.id === data.moduleNodeId)?.portId
      : data.kind === "rule"
        ? moduleOptions.find((m) => m.id === (data.commandTarget?.moduleNodeId || data.sourceReference?.moduleNodeId))?.portId
        : undefined;
  const linePortIds = selectedPortId !== undefined ? [selectedPortId] : moduleOptions.map((m) => m.portId).filter((id): id is number => id !== undefined);
  const lineOptions = linePortIds.flatMap((portId) =>
    pinMapOf(portId)
      .pins.filter((pin) => pin.peripheral === "gpio")
      .map((pin) => ({
        value: linePortIds.length === 1 ? String(pin.pinIndex) : `${portId}:${pin.pinIndex}`,
        label: pinCaption(pin) || `${copy.portPrefix} ${portId} · GPIO ${pin.signal} · ${pinLetter(pin.pinIndex)}`,
      })),
  );

  const errors = useMemo<readonly DomainError[]>(() => {
    const others = existingNodes.filter((n) => n.id !== nodeId);
    const candidate: GraphNode<"device-processing", string, DeviceProcessingNodeData> = { layer: "device-processing", id: nodeId, data };
    const graphState = { layer: "device-processing" as const, nodes: [...others, candidate], edges: [] };
    const result = validateDeviceProcessingGraph(graphState, { knownModuleNodeIds });
    return result.ok ? [] : result.error.filter((e) => e.target === nodeId || e.path.includes(nodeId));
  }, [data, existingNodes, nodeId, knownModuleNodeIds]);

  const canSave = errors.length === 0;

  function patch(partial: Partial<DeviceProcessingNodeData>) {
    const next = { ...data, ...partial } as DeviceProcessingNodeData;
    setData(next);
    // Keep the graph (and Dry-run) in sync while the inspector is open — otherwise
    // effect/delay edits only appear after Salva.
    if (mode.kind === "edit") onApply?.(next, comment);
  }

  function setCommentAndMaybeApply(nextComment: string) {
    setComment(nextComment);
    if (mode.kind === "edit") onApply?.(data, nextComment);
  }

  function applyCatalogChange(next: DeviceProcessingNodeData, entry: ProcessingCatalogEntry | undefined) {
    const nextComment = commentAfterCatalogChange(comment, catalogEntry?.label, entry?.label);
    const resolved = withFieldDefaults(next);
    setData(resolved);
    if (nextComment !== comment) setComment(nextComment);
    onApply?.(resolved, nextComment);
  }

  const incoming = existingEdges.filter((e) => e.target === nodeId);
  const outgoing = existingEdges.filter((e) => e.source === nodeId);

  const blockTypeId = data.kind === "block" ? data.blockTypeId : data.kind === "rule" ? data.ruleTypeId : undefined;
  const catalogVisual =
    visualForCatalogEntryId(catalogEntry?.id) ?? visualForCatalogEntryId(blockTypeId);
  const headerTitle =
    (comment.trim() !== "" ? comment.trim() : undefined) ?? localizedEntry?.label ?? config.label;
  const headerColor =
    data.kind === "block" && isBlockNodeData(data) && isRgbLedBlock(data)
      ? (() => {
          const cfg = parseRgbLedConfig(data.properties);
          // Identity swatch only — RGB stays off until the input trigger drives it.
          if (cfg.mode === "preset" && cfg.preset === "color_cycle") return rgbLedVisualAt(0, cfg, true).color;
          return cfg.color;
        })()
      : data.kind === "block" && isBlockNodeData(data) && isLedBlock(data)
        ? ledColorFromProperties(data.properties, catalogVisual?.colorVar ?? "#F5C518")
        : (catalogVisual?.colorVar ?? config.colorVar);
  const HeaderIcon = catalogVisual?.icon ?? config.icon;
  const headerSolid = catalogVisual?.solidSwatch === true || (data.kind === "block" && isBlockNodeData(data) && isRgbLedBlock(data));

  return (
    <motion.div initial={{ x: 320, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 320, opacity: 0 }} transition={motionTokens.spring.smooth} className="flex h-full w-80 flex-col border-l border-border bg-surface shadow-e2">
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
        <div
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-slsm"
          style={{ backgroundColor: headerSolid ? headerColor : `color-mix(in srgb, ${headerColor} 18%, transparent)` }}
          aria-hidden
        >
          {!headerSolid && <HeaderIcon size={14} style={{ color: headerColor }} />}
        </div>
        <h2 className="min-w-0 truncate font-heading text-sm font-semibold text-ink" title={headerTitle}>
          {headerTitle}
        </h2>
        <button type="button" onClick={onClose} className="ml-auto shrink-0 text-ink-faint hover:text-ink">
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <AnimatePresence>
          {errors.length > 0 && (
            <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={motionTokens.duration.base} className="mb-3 border-l-4 border-error bg-[color-mix(in_srgb,var(--color-error)_8%,transparent)] p-2 font-body text-xs text-ink">
              {errors[0]!.remediation}
            </motion.div>
          )}
        </AnimatePresence>

        <label className="mb-1 block font-body text-xs font-semibold text-ink-muted" htmlFor="ni-name">
          {copy.nameLabel}
        </label>
        <input id="ni-name" value={comment} onChange={(e) => setCommentAndMaybeApply(e.target.value)} placeholder={config.label} className="mb-4 w-full rounded-slsm border border-border-strong px-2 py-1.5 font-body text-sm outline-none" />

        {mode.kind === "edit" && (
          <EdgeList title="Input" edges={incoming.map((e) => ({ id: e.id, label: nodeLabel(e.source) }))} empty={copy.noIncoming} />
        )}

        {data.kind === "event-source" && (
          <>
            <label className="mb-1 block font-body text-xs font-semibold text-ink-muted" htmlFor="ni-event">
              Trigger
            </label>
            <select
              id="ni-event"
              value={data.catalogEntryId ?? "native.event-source"}
              onChange={(e) => {
                const entry = findCatalogEntryById(e.target.value);
                applyCatalogChange(
                  {
                    ...data,
                    catalogEntryId: entry?.id,
                    moduleNodeId: entry?.needsModule === false ? "" : data.moduleNodeId,
                    properties: defaultPropertiesFromFields(entry?.fields ?? []),
                  } as DeviceProcessingNodeData,
                  entry,
                );
              }}
              className="mb-4 w-full rounded-slsm border border-border-strong px-2 py-1.5 font-body text-sm outline-none"
            >
              {localizeCatalogEntries(catalogEntriesForNodeKind("event-source"), locale).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </select>
            <CatalogNotes entry={localizedEntry} />
          </>
        )}

        {showModulePicker && (
          <>
            <label className="mb-1 block font-body text-xs font-semibold text-ink-muted" htmlFor="ni-module">
              Module
            </label>
            <select id="ni-module" value={data.kind === "event-source" ? data.moduleNodeId : ""} onChange={(e) => patch({ moduleNodeId: e.target.value })} className="mb-4 w-full rounded-slsm border border-border-strong px-2 py-1.5 font-mono text-sm outline-none">
              <option value="">—</option>
              {moduleOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </>
        )}

        {data.kind === "event-source" && namedFields.length > 0 && (
          <CatalogFieldsEditor
            fields={namedFields}
            properties={propertiesOf(data)}
            lineOptions={lineOptions}
            onChange={(properties) => patch({ properties })}
          />
        )}

        {data.kind === "schedule" && (
          <>
            <label className="mb-1 block font-body text-xs font-semibold text-ink-muted" htmlFor="ni-period">
              {copy.periodMs}
            </label>
            <input id="ni-period" type="number" value={data.periodMs} onChange={(e) => patch({ periodMs: Number(e.target.value) })} className="mb-4 w-full rounded-slsm border border-border-strong px-2 py-1.5 font-mono text-sm outline-none" />
          </>
        )}

        {data.kind === "block" && (
          <>
            <label className="mb-1 block font-body text-xs font-semibold text-ink-muted" htmlFor="ni-blocktype">
              Block
            </label>
            <TypeIdSelect
              id="ni-blocktype"
              kind="block"
              value={data.blockTypeId}
              catalogEntryId={data.catalogEntryId}
              onChange={(blockTypeId, entry) =>
                applyCatalogChange(
                  {
                    ...data,
                    blockTypeId,
                    catalogEntryId: entry?.id,
                    properties: defaultPropertiesFromFields(entry?.fields ?? []),
                  } as DeviceProcessingNodeData,
                  entry,
                )
              }
            />
            <CatalogNotes entry={localizedEntry} />
            {!authoringType && (
              <div className="mb-4 flex gap-2">
                <div className="flex-1">
                  <label className="mb-1 block font-body text-xs font-semibold text-ink-muted" htmlFor="ni-minver">
                    {copy.minVersion}
                  </label>
                  <input id="ni-minver" type="number" value={data.minVersion ?? ""} onChange={(e) => patch({ minVersion: e.target.value === "" ? undefined : Number(e.target.value) })} className="w-full rounded-slsm border border-border-strong px-2 py-1.5 font-mono text-sm outline-none" />
                </div>
                <div className="flex-1">
                  <label className="mb-1 block font-body text-xs font-semibold text-ink-muted" htmlFor="ni-exactver">
                    {copy.exactVersion}
                  </label>
                  <input id="ni-exactver" type="number" value={data.exactVersion ?? ""} onChange={(e) => patch({ exactVersion: e.target.value === "" ? undefined : Number(e.target.value) })} className="w-full rounded-slsm border border-border-strong px-2 py-1.5 font-mono text-sm outline-none" />
                </div>
              </div>
            )}
            {namedFields.length > 0 ? (
              <CatalogFieldsEditor fields={namedFields} properties={data.properties} lineOptions={lineOptions} onChange={(properties) => patch({ properties })} />
            ) : (
              <>
                <p className="mb-2 font-body text-xs text-ink-faint">{copy.blockSchemaGap}</p>
                <PropertiesEditor properties={data.properties} onChange={(properties) => patch({ properties })} />
              </>
            )}
            {isRgbLedBlock(data) && (
              <RgbLedSequenceEditor properties={data.properties} onChange={(properties) => patch({ properties })} />
            )}
          </>
        )}

        {data.kind === "rule" && (
          <>
            <label className="mb-1 block font-body text-xs font-semibold text-ink-muted" htmlFor="ni-ruletype">
              Rule
            </label>
            <TypeIdSelect
              id="ni-ruletype"
              kind="rule"
              value={data.ruleTypeId}
              onChange={(ruleTypeId, entry) =>
                applyCatalogChange(
                  {
                    ...data,
                    ruleTypeId,
                    properties:
                      ruleTypeId === "threshold"
                        ? withThresholdFirmwareFields(defaultPropertiesFromFields(entry?.fields ?? []))
                        : defaultPropertiesFromFields(entry?.fields ?? []),
                  } as DeviceProcessingNodeData,
                  entry,
                )
              }
            />
            <CatalogNotes entry={localizedEntry} />

            <NamedOrNumericModuleRef
              title={copy.sourceTitle}
              moduleOptions={moduleOptions}
              moduleNodeId={data.sourceReference?.moduleNodeId ?? ""}
              numericId={data.sourceReference?.fieldId}
              protocolFor={protocolFor}
              pinMapOf={pinMapOf}
              mode="source"
              onChange={(moduleNodeId, numericId) => patch({ sourceReference: moduleNodeId ? { moduleNodeId, fieldId: numericId } : undefined })}
            />

            <NamedOrNumericModuleRef
              title={copy.commandTitle}
              moduleOptions={moduleOptions}
              moduleNodeId={data.commandTarget?.moduleNodeId ?? ""}
              numericId={data.commandTarget?.commandId}
              protocolFor={protocolFor}
              pinMapOf={pinMapOf}
              mode="command"
              onChange={(moduleNodeId, numericId) => patch({ commandTarget: moduleNodeId ? { moduleNodeId, commandId: numericId } : undefined })}
            />

            {namedFields.length > 0 ? (
              <CatalogFieldsEditor
                fields={namedFields}
                properties={data.properties}
                lineOptions={lineOptions}
                onChange={(properties) =>
                  patch({
                    properties: data.ruleTypeId === "threshold" ? withThresholdFirmwareFields(properties) : properties,
                  })
                }
              />
            ) : data.ruleTypeId === "threshold" ? null : (
              <>
                <p className="mb-2 font-body text-xs text-ink-faint">{copy.ruleSchemaGap}</p>
                <PropertiesEditor properties={data.properties} onChange={(properties) => patch({ properties })} />
              </>
            )}
          </>
        )}

        {mode.kind === "edit" && (
          <EdgeList title="Output" edges={outgoing.map((e) => ({ id: e.id, label: nodeLabel(e.target) }))} empty={isRuleNodeData(data) ? copy.ruleNoOutgoing : copy.noOutgoing} />
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border p-3">
        {onDelete && (
          <button type="button" onClick={onDelete} className="rounded-slsm border border-border-strong px-3 py-1.5 font-body text-sm text-error hover:bg-surface-raised">
            {copy.delete}
          </button>
        )}
        <button type="button" onClick={() => onSave(data, comment)} disabled={!canSave} className="ml-auto rounded-slsm bg-brand-blue px-4 py-1.5 font-body-strong text-sm text-white hover:bg-brand-blue-dark disabled:opacity-50">
          {copy.save}
        </button>
      </div>
    </motion.div>
  );
}

function CatalogNotes({ entry }: { readonly entry: ProcessingCatalogEntry | undefined }) {
  if (!entry) return null;
  return <p className="mb-4 font-body text-xs text-ink-faint">{entry.notes}</p>;
}

function CatalogFieldsEditor({
  fields,
  properties,
  lineOptions = [],
  onChange,
}: {
  readonly fields: readonly CatalogField[];
  readonly properties: Readonly<Record<string, unknown>>;
  readonly lineOptions?: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (next: Record<string, unknown>) => void;
}) {
  function setField(id: string, value: unknown) {
    onChange({ ...properties, [id]: value });
  }

  return (
    <div className="mb-4 flex flex-col gap-3">
      {fields
        .filter((field) => fieldVisible(field, properties))
        .map((field) => (
          <CatalogFieldInput
            key={field.id}
            field={field.id === "line" && lineOptions.length > 0 ? { ...field, type: "select", options: lineOptions } : field}
            value={properties[field.id]}
            onChange={(value) => setField(field.id, value)}
          />
        ))}
    </div>
  );
}

function fieldVisible(field: CatalogField, properties: Readonly<Record<string, unknown>>): boolean {
  if (!field.when) return true;
  // Preset-only fields (color, speed) must not appear in «Sequenza mia».
  if (field.when.field === "preset") {
    const modeRaw = properties.mode;
    const mode =
      typeof modeRaw === "string" ? modeRaw : modeRaw === undefined ? "preset" : String(modeRaw);
    if (mode !== "preset") return false;
  }
  const raw = properties[field.when.field];
  const current =
    typeof raw === "string"
      ? raw
      : raw === undefined && field.when.field === "effect"
        ? "follow"
        : raw === undefined && field.when.field === "activeOn"
          ? "rising"
          : raw === undefined && field.when.field === "mode"
            ? "preset"
            : raw === undefined && field.when.field === "preset"
              ? "solid"
              : raw === undefined && field.when.field === "toggleMode"
                ? "astable"
                : raw === undefined
                  ? undefined
                  : String(raw);
  if (current === undefined) return false;
  if (field.when.in) return field.when.in.includes(current);
  if (field.when.equals !== undefined) return current === field.when.equals;
  return true;
}

function CatalogFieldInput({
  field,
  value,
  onChange,
}: {
  readonly field: CatalogField;
  readonly value: unknown;
  readonly onChange: (value: unknown) => void;
}) {
  const { locale } = useLocale();
  const copy = processingGraphCopy(locale);
  const id = `ni-field-${field.id}`;
  return (
    <div>
      <label className="mb-1 block font-body text-xs font-semibold text-ink-muted" htmlFor={id}>
        {field.label}
      </label>
      {field.type === "select" ? (
        <select
          id={id}
          value={typeof value === "string" ? value : String(field.default ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-slsm border border-border-strong px-2 py-1.5 font-body text-sm outline-none"
        >
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : field.type === "checkbox" ? (
        <label className="flex items-center gap-2 font-body text-sm text-ink">
          <input id={id} type="checkbox" checked={value === true} onChange={(e) => onChange(e.target.checked)} />
          {field.placeholder ?? copy.active}
        </label>
      ) : field.type === "number" ? (
        <input
          id={id}
          type="number"
          placeholder={field.placeholder}
          value={value === undefined || value === null ? String(field.default ?? "") : String(value)}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "" || raw === "-") onChange(0n);
            else onChange(BigInt(Math.trunc(Number(raw))));
          }}
          className="w-full rounded-slsm border border-border-strong px-2 py-1.5 font-mono text-sm outline-none"
        />
      ) : field.type === "textarea" ? (
        <textarea
          id={id}
          rows={3}
          placeholder={field.placeholder}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className="w-full resize-y rounded-slsm border border-border-strong px-2 py-1.5 font-body text-sm outline-none"
        />
      ) : field.type === "color" ? (
        <div className="flex items-center gap-2">
          <input
            id={id}
            type="color"
            value={typeof value === "string" && /^#[0-9A-Fa-f]{6}$/.test(value) ? value : String(field.default ?? "#F5C518")}
            onChange={(e) => onChange(e.target.value)}
            className="h-9 w-12 cursor-pointer rounded-slsm border border-border-strong bg-surface p-0.5"
          />
          <input
            type="text"
            value={typeof value === "string" ? value : String(field.default ?? "#F5C518")}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
            className="min-w-0 flex-1 rounded-slsm border border-border-strong px-2 py-1.5 font-mono text-sm outline-none"
          />
        </div>
      ) : (
        <input
          id={id}
          type="text"
          placeholder={field.placeholder}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-slsm border border-border-strong px-2 py-1.5 font-body text-sm outline-none"
        />
      )}
    </div>
  );
}

/** Real edges already on the graph (Input) or reachable from this node (Output) — never invented, just read from `existingEdges` and labelled via the same resolver the canvas nodes use. */
function EdgeList({ title, edges, empty }: { readonly title: string; readonly edges: readonly { readonly id: string; readonly label: string }[]; readonly empty: string }) {
  return (
    <div className="mb-4">
      <p className="mb-1 font-body text-xs font-semibold text-ink-muted">{title}</p>
      {edges.length === 0 ? (
        <p className="rounded-slsm bg-surface-raised px-2 py-1.5 font-body text-xs text-ink-faint">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {edges.map((e) => (
            <li key={e.id} className="truncate rounded-slsm bg-surface-raised px-2 py-1.5 font-body text-xs text-ink">
              {e.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type PropertyValueKind = "bigint" | "boolean" | "string";

function valueKindOf(value: unknown): PropertyValueKind {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "bigint") return "bigint";
  return "string";
}

function defaultForKind(kind: PropertyValueKind): boolean | bigint | string {
  if (kind === "boolean") return false;
  if (kind === "bigint") return 0n;
  return "";
}

/**
 * Edits `Record<string, unknown>` directly as firmware's wire format
 * requires it (`config-compiler`'s `toPropertySet`, `properties.ts`): keys
 * are the real numeric `field_id` (1-65535) as a string, values are
 * `bigint | boolean | string` — plain JS numbers are rejected on purpose
 * (firmware's CBOR encoder has no float support). No name/meaning is shown
 * per field because no schema exists anywhere to resolve one from — this is
 * the raw mechanism, not a guess at what any given field_id means.
 */
function PropertiesEditor({ properties, onChange }: { readonly properties: Readonly<Record<string, unknown>>; readonly onChange: (next: Record<string, unknown>) => void }) {
  const { locale } = useLocale();
  const copy = processingGraphCopy(locale);
  const rows = Object.entries(properties);

  function updateRow(oldKey: string, newKey: string, value: boolean | bigint | string) {
    const next: Record<string, unknown> = {};
    for (const [k, v] of rows) next[k === oldKey ? newKey : k] = k === oldKey ? value : v;
    onChange(next);
  }

  function removeRow(key: string) {
    const next = { ...properties };
    delete next[key];
    onChange(next);
  }

  function addRow() {
    let n = 1;
    while (Object.prototype.hasOwnProperty.call(properties, String(n))) n++;
    onChange({ ...properties, [String(n)]: 0n });
  }

  return (
    <div className="mb-4">
      <p className="mb-1 font-body text-xs font-semibold text-ink-muted">{copy.propertiesTitle}</p>
      <div className="flex flex-col gap-1.5">
        {rows.map(([key, value]) => {
          const kind = valueKindOf(value);
          return (
            <div key={key} className="flex items-center gap-1.5">
              <input
                type="number"
                value={key}
                onChange={(e) => updateRow(key, e.target.value, value as boolean | bigint | string)}
                className="w-16 rounded-slsm border border-border-strong px-1.5 py-1 font-mono text-xs outline-none"
                title="field_id"
              />
              <select
                value={kind}
                onChange={(e) => updateRow(key, key, defaultForKind(e.target.value as PropertyValueKind))}
                className="rounded-slsm border border-border-strong px-1 py-1 font-mono text-xs outline-none"
              >
                <option value="bigint">{copy.integer}</option>
                <option value="boolean">bool</option>
                <option value="string">{copy.stringType}</option>
              </select>
              {kind === "boolean" ? (
                <input type="checkbox" checked={value as boolean} onChange={(e) => updateRow(key, key, e.target.checked)} className="mx-1" />
              ) : kind === "bigint" ? (
                <input
                  type="number"
                  value={String(value)}
                  onChange={(e) => updateRow(key, key, e.target.value === "" || e.target.value === "-" ? 0n : BigInt(Math.trunc(Number(e.target.value))))}
                  className="min-w-0 flex-1 rounded-slsm border border-border-strong px-1.5 py-1 font-mono text-xs outline-none"
                />
              ) : (
                <input type="text" value={value as string} onChange={(e) => updateRow(key, key, e.target.value)} className="min-w-0 flex-1 rounded-slsm border border-border-strong px-1.5 py-1 font-mono text-xs outline-none" />
              )}
              <button type="button" onClick={() => removeRow(key)} className="shrink-0 text-ink-faint hover:text-error" aria-label={copy.delete}>
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
      </div>
      <button type="button" onClick={addRow} className="mt-1.5 flex items-center gap-1 font-body text-xs font-semibold text-brand-blue hover:underline">
        <Plus size={12} /> {copy.addProperty}
      </button>
    </div>
  );
}

function NamedOrNumericModuleRef({
  title,
  moduleOptions,
  moduleNodeId,
  numericId,
  protocolFor,
  pinMapOf,
  mode,
  onChange,
}: {
  readonly title: string;
  readonly moduleOptions: readonly { readonly id: string; readonly label: string; readonly portId?: number }[];
  readonly moduleNodeId: string;
  readonly numericId?: number;
  readonly protocolFor: (opts: { readonly moduleNodeId?: string; readonly portId?: number }) => CustomProtocol | undefined;
  readonly pinMapOf: (portId: number) => PortPinMap;
  readonly mode: "source" | "command";
  readonly onChange: (moduleNodeId: string, numericId: number) => void;
}) {
  const { locale } = useLocale();
  const copy = processingGraphCopy(locale);
  const selected = moduleOptions.find((m) => m.id === moduleNodeId);
  const protocol = selected ? protocolFor({ moduleNodeId: selected.id, portId: selected.portId }) : undefined;
  const pinMap = selected?.portId !== undefined ? pinMapOf(selected.portId) : undefined;
  const named = signalsForRole(selectableSignalsForPort(pinMap, protocol), mode).map((signal) => ({
    value: signal.id,
    label: signal.label,
    numeric: signal.numericId,
  }));
  const selectedNamed = named.find((o) => o.numeric === numericId);
  const showNamed = named.length > 0 || Boolean(protocol);

  return (
    <>
      <p className="mb-1 font-body text-xs font-semibold text-ink-muted">{title}</p>
      <div className="mb-1 flex gap-2">
        <select value={moduleNodeId} onChange={(e) => onChange(e.target.value, 0)} className="flex-1 rounded-slsm border border-border-strong px-2 py-1.5 font-mono text-sm outline-none">
          <option value="">—</option>
          {moduleOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        {showNamed ? (
          <select
            value={selectedNamed?.value ?? ""}
            disabled={!moduleNodeId}
            onChange={(e) => {
              const opt = named.find((o) => o.value === e.target.value);
              onChange(moduleNodeId, opt?.numeric ?? 0);
            }}
            className="min-w-0 flex-1 rounded-slsm border border-border-strong px-2 py-1.5 font-body text-sm outline-none disabled:opacity-50"
          >
            <option value="">—</option>
            {named.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="number"
            placeholder={mode === "source" ? "fieldId" : "commandId"}
            value={numericId ?? ""}
            disabled={!moduleNodeId}
            onChange={(e) => onChange(moduleNodeId, Number(e.target.value))}
            className="w-24 rounded-slsm border border-border-strong px-2 py-1.5 font-mono text-sm outline-none disabled:opacity-50"
          />
        )}
      </div>
      {showNamed && named.length === 0 && moduleNodeId !== "" && (
        <p className="mb-4 font-body text-xs text-ink-faint">
          {mode === "source" ? copy.noReadSignal : copy.noWriteCommand}
        </p>
      )}
      {!(showNamed && named.length === 0 && moduleNodeId !== "") && <div className="mb-3" />}
    </>
  );
}
