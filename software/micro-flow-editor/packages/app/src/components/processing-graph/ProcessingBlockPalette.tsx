import {
  isPlaceableOnDeviceGraph,
  searchCatalog,
  type ProcessingCatalogEntry,
} from "@spaghettilab/processing-block-catalog";
import { AnimatePresence, motion } from "motion/react";
import { Boxes, Cpu, Search, Zap, type LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState, type DragEvent } from "react";
import { motionTokens } from "../../lib/motion-tokens.js";
import { DEMO_PALETTE_IDS, isDemoOnlyEnabled } from "../../lib/demo-only.js";
import { processingGraphCopy } from "../../lib/processing-graph-copy.js";
import { useLocale } from "../../state/locale-context.js";
import { usePortProtocol } from "../../state/port-protocol-context.js";
import { FLOW_START_IDS } from "./dry-run-preview.js";
import { visualForCatalogEntryId } from "./block-visuals.js";
import { beginPaletteDrag, endPaletteDrag, encodePaletteDrag, PROCESSING_BLOCK_MIME } from "./catalog-to-node.js";
import { PROCESSING_NODE_KIND_CONFIG } from "./node-kinds.js";
import { expandPalettePlaceables, groupPlaceablesByFamily, type PalettePlaceable } from "./palette-placeables.js";

/** Authoring surface: only these blocks (plus Schedule trigger). Flow Start is auto-spawned. */
const PALETTE_ALLOWED_IDS = new Set([
  "native.schedule",
  "appblocks.digital_out_toggle",
  "appblocks.led",
  "appblocks.rgb_led",
  "appblocks.relay",
  "appblocks.terminal_block",
]);

function catalogEntryNeedsConfiguredPort(entry: ProcessingCatalogEntry): boolean {
  if (entry.needsModule === false) return false;
  if (entry.nodeKind === "schedule" || entry.nodeKind === "event-source" || entry.nodeKind === "rule") return true;
  return Boolean(entry.fields?.some((field) => field.id === "line"));
}

type FamilySectionId = "functionality" | "bay";

const FAMILY_ICONS: Record<FamilySectionId, LucideIcon> = {
  functionality: Zap,
  bay: Boxes,
};

const DEFAULT_OPEN: ReadonlySet<FamilySectionId> = new Set(["functionality", "bay"]);

export function ProcessingBlockPalette() {
  const { locale } = useLocale();
  const copy = processingGraphCopy(locale);
  const demoOnly = isDemoOnlyEnabled();
  const { configuredPorts } = usePortProtocol();
  const portsConfigured = configuredPorts.length > 0;
  const [query, setQuery] = useState("");
  const [openIds, setOpenIds] = useState<ReadonlySet<FamilySectionId>>(DEFAULT_OPEN);
  const [dragReminder, setDragReminder] = useState(false);

  useEffect(() => {
    if (!dragReminder) return;
    const timer = setTimeout(() => setDragReminder(false), 4000);
    return () => clearTimeout(timer);
  }, [dragReminder]);

  const filtered = useMemo(
    () =>
      searchCatalog(query).filter(
        (e) =>
          (demoOnly ? (DEMO_PALETTE_IDS as readonly string[]).includes(e.id) : PALETTE_ALLOWED_IDS.has(e.id)) &&
          e.availability !== "unavailable" &&
          !FLOW_START_IDS.has(e.id) &&
          !FLOW_START_IDS.has(e.typeId ?? ""),
      ),
    [query, demoOnly],
  );
  const placeables = useMemo(() => expandPalettePlaceables(filtered, locale), [filtered, locale]);
  const groups = useMemo(() => groupPlaceablesByFamily(placeables), [placeables]);
  const searching = query.trim() !== "";

  function toggle(id: FamilySectionId) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const sections: { id: FamilySectionId; rows: readonly PalettePlaceable[] }[] = [
    { id: "functionality", rows: groups.functionality },
    { id: "bay", rows: groups.bay },
  ];

  return (
    <div className="flex h-full w-[260px] shrink-0 flex-col border-r border-border bg-surface">
      <div className="p-3">
        <label className="flex items-center gap-2 rounded-full border border-border-strong bg-surface-sunken px-3 py-2">
          <Search size={14} className="text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={copy.searchBlocks}
            className="w-full bg-transparent font-body text-sm outline-none placeholder:text-ink-faint"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
        {placeables.length === 0 ? (
          <p className="px-2 py-6 text-center font-body text-sm text-ink-faint">{copy.noResults}</p>
        ) : (
          sections.map(({ id, rows }, index) => {
            if (rows.length === 0 && searching) return null;
            const Icon = FAMILY_ICONS[id];
            const label = id === "functionality" ? copy.functionality : copy.bay;
            const hint = id === "functionality" ? copy.functionalityHint : copy.bayHint;
            const open = searching || openIds.has(id);
            return (
              <div key={id} className="mb-1">
                <button
                  type="button"
                  onClick={() => toggle(id)}
                  disabled={searching}
                  className="flex h-10 w-full items-center gap-2 rounded-slsm px-2 text-left hover:bg-surface-raised disabled:hover:bg-transparent"
                  style={{ opacity: rows.length === 0 ? 0.45 : 1 }}
                >
                  <motion.span animate={{ rotate: open ? 0 : -90 }} transition={motionTokens.duration.base} className="text-ink-faint">
                    ▾
                  </motion.span>
                  <Icon size={14} className="shrink-0 text-ink-muted" />
                  <span className="min-w-0 flex-1 truncate font-body text-sm font-semibold text-ink">{label}</span>
                  <span className="font-body text-xs text-ink-faint">{rows.length}</span>
                </button>
                {!searching && open && (
                  <p className="mb-1 px-2 pl-8 font-body text-[10px] leading-snug text-ink-faint">{hint}</p>
                )}
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={motionTokens.duration.base}
                      className="overflow-hidden"
                    >
                      {rows.map((row, entryIndex) => {
                        const kindConfig = row.entry.nodeKind ? PROCESSING_NODE_KIND_CONFIG[row.entry.nodeKind] : undefined;
                        const catalogVisual = visualForCatalogEntryId(row.entry.id);
                        const isLed = catalogVisual?.solidSwatch === true;
                        const isCircular = catalogVisual?.circular === true;
                        const ledDefault = row.entry.fields?.find((f) => f.id === "color")?.default;
                        return (
                          <PaletteRow
                            key={row.rowKey}
                            row={row}
                            color={
                              isLed && typeof ledDefault === "string"
                                ? ledDefault
                                : (catalogVisual?.colorVar ?? kindConfig?.colorVar ?? "#8A8F99")
                            }
                            icon={catalogVisual?.icon ?? kindConfig?.icon ?? Icon}
                            solidSwatch={isLed}
                            circular={isCircular}
                            delay={index * 0 + entryIndex * motionTokens.stagger.list}
                            portsConfigured={portsConfigured}
                            onClickRemind={() => setDragReminder(true)}
                            onDragBegan={() => setDragReminder(false)}
                          />
                        );
                      })}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })
        )}
      </div>
      {dragReminder && (
        <div className="mx-2 mb-3 rounded-slsm bg-surface-raised px-3 py-2 font-body text-xs text-ink" style={{ outline: "1px solid var(--color-brand-blue)" }}>
          {copy.dragReminder}
        </div>
      )}
    </div>
  );
}

function PaletteRow({
  row,
  color,
  icon: Icon,
  solidSwatch = false,
  circular = false,
  delay,
  portsConfigured,
  onClickRemind,
  onDragBegan,
}: {
  readonly row: PalettePlaceable;
  readonly color: string;
  readonly icon: LucideIcon;
  readonly solidSwatch?: boolean;
  readonly circular?: boolean;
  readonly delay: number;
  readonly portsConfigured: boolean;
  readonly onClickRemind: () => void;
  readonly onDragBegan: () => void;
}) {
  const { locale } = useLocale();
  const copy = processingGraphCopy(locale);
  const entry = row.entry;
  const needsPort = catalogEntryNeedsConfiguredPort(entry);
  const placeable = isPlaceableOnDeviceGraph(entry) && (!needsPort || portsConfigured);
  const badge = !portsConfigured && needsPort ? copy.needsPort : availabilityBadge(entry, copy);

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: placeable ? 1 : 0.45 }}
      transition={{ ...motionTokens.duration.base, delay }}
      className="ml-4 w-[calc(100%-1rem)]"
    >
      <button
        type="button"
        draggable={placeable}
        title={placeable ? copy.dragToInsert : needsPort && !portsConfigured ? copy.configurePortFirst : entry.notes}
        onClick={() => {
          if (placeable) onClickRemind();
        }}
        onDragStart={(e: DragEvent<HTMLButtonElement>) => {
          if (!placeable) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.setData(PROCESSING_BLOCK_MIME, encodePaletteDrag({ entryId: entry.id, baySide: row.baySide }));
          e.dataTransfer.effectAllowed = "copy";
          e.currentTarget.style.opacity = "0.6";
          beginPaletteDrag(entry.nodeKind, row.baySide);
          onDragBegan();
        }}
        onDragEnd={(e: DragEvent<HTMLButtonElement>) => {
          e.currentTarget.style.opacity = "";
          endPaletteDrag();
        }}
        className={`flex h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left ${placeable ? "cursor-grab hover:bg-surface-raised active:cursor-grabbing" : "cursor-not-allowed"}`}
      >
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center ${circular ? "rounded-full" : "rounded-md"}`}
          style={{ backgroundColor: placeable ? color : "#E1E4EB" }}
        >
          {solidSwatch || circular ? null : <Icon size={14} color={placeable ? "#fff" : "#8A8F99"} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <div className="truncate font-body text-sm text-ink">{row.label}</div>
            {row.baySide && (
              <span
                className="inline-flex shrink-0 items-center gap-0.5 rounded-[3px] px-1 py-px font-mono text-[9px] font-semibold uppercase tracking-wide text-ink-muted"
                style={{ outline: "1px solid color-mix(in srgb, #64748B 40%, transparent)" }}
                title={copy.bayModule}
              >
                <Cpu size={9} strokeWidth={2.5} aria-hidden />
                Bay
              </span>
            )}
          </div>
          <div className="truncate font-body text-xs text-ink-faint">
            {badge ? `${badge} · ${row.subtitle}` : row.subtitle}
          </div>
        </div>
      </button>
    </motion.div>
  );
}

function availabilityBadge(entry: ProcessingCatalogEntry, copy: ReturnType<typeof processingGraphCopy>): string | undefined {
  if (entry.availability === "planned") return copy.planned;
  if (entry.availability === "pack") return "pack";
  if (!isPlaceableOnDeviceGraph(entry)) {
    if (entry.runtime === "node-red") return "Node-RED";
    if (entry.runtime === "feature") return "Features";
    if (entry.runtime === "core-admin") return "admin";
    if (entry.runtime === "authoring") return copy.editorOnly;
    return copy.outOfScope;
  }
  return undefined;
}
