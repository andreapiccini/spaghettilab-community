import {
  groupCatalogByCategory,
  isPlaceableOnDeviceGraph,
  searchCatalog,
  type ProcessingCatalogCategoryId,
  type ProcessingCatalogEntry,
} from "@spaghettilab/processing-block-catalog";
import { AnimatePresence, motion } from "motion/react";
import {
  Bell,
  Cable,
  Calculator,
  Clock,
  Cloud,
  GitBranch,
  Globe,
  Monitor,
  Radio,
  Search,
  SlidersHorizontal,
  Table,
  Type,
  Variable,
  Volume2,
  Workflow,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState, type DragEvent } from "react";
import { motionTokens } from "../../lib/motion-tokens.js";
import { usePortProtocol } from "../../state/port-protocol-context.js";
import { visualForCatalogEntryId } from "./block-visuals.js";
import { beginPaletteDrag, endPaletteDrag, PROCESSING_BLOCK_MIME } from "./catalog-to-node.js";
import { PROCESSING_NODE_KIND_CONFIG } from "./node-kinds.js";

function catalogEntryNeedsConfiguredPort(entry: ProcessingCatalogEntry): boolean {
  if (entry.needsModule === false) return false;
  if (entry.nodeKind === "schedule" || entry.nodeKind === "event-source" || entry.nodeKind === "rule") return true;
  return Boolean(entry.fields?.some((field) => field.id === "line"));
}

const CATEGORY_ICONS: Record<ProcessingCatalogCategoryId, LucideIcon> = {
  system: Bell,
  trigger: Zap,
  variables: Variable,
  logic: GitBranch,
  math: Calculator,
  filter: SlidersHorizontal,
  time: Clock,
  io: Radio,
  strings: Type,
  display: Monitor,
  sound: Volume2,
  storage: Table,
  serial: Cable,
  network: Globe,
  cloud: Cloud,
  modbus: Workflow,
};

const DEFAULT_OPEN: ReadonlySet<ProcessingCatalogCategoryId> = new Set(["trigger", "logic", "math", "filter", "time", "io"]);

export function ProcessingBlockPalette() {
  const { configuredPorts } = usePortProtocol();
  const portsConfigured = configuredPorts.length > 0;
  const [query, setQuery] = useState("");
  const [openIds, setOpenIds] = useState<ReadonlySet<ProcessingCatalogCategoryId>>(DEFAULT_OPEN);
  const [dragReminder, setDragReminder] = useState(false);

  useEffect(() => {
    if (!dragReminder) return;
    const timer = setTimeout(() => setDragReminder(false), 4000);
    return () => clearTimeout(timer);
  }, [dragReminder]);

  const filtered = useMemo(
    () => searchCatalog(query).filter((e) => e.availability !== "unavailable"),
    [query],
  );
  const groups = useMemo(() => groupCatalogByCategory(filtered), [filtered]);
  const searching = query.trim() !== "";

  function toggle(id: ProcessingCatalogCategoryId) {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="flex h-full w-[260px] shrink-0 flex-col border-r border-border bg-surface">
      <div className="p-3">
        <label className="flex items-center gap-2 rounded-full border border-border-strong bg-surface-sunken px-3 py-2">
          <Search size={14} className="text-ink-faint" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cerca blocchi"
            className="w-full bg-transparent font-body text-sm outline-none placeholder:text-ink-faint"
          />
        </label>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
        {groups.length === 0 ? (
          <p className="px-2 py-6 text-center font-body text-sm text-ink-faint">Nessun risultato.</p>
        ) : (
          groups.map(({ category, entries }, index) => {
            const Icon = CATEGORY_ICONS[category.id];
            const open = searching || openIds.has(category.id);
            return (
              <div key={category.id} className="mb-1">
                <button
                  type="button"
                  onClick={() => toggle(category.id)}
                  disabled={searching}
                  className="flex h-10 w-full items-center gap-2 rounded-slsm px-2 text-left hover:bg-surface-raised disabled:hover:bg-transparent"
                  style={{ opacity: entries.length === 0 ? 0.45 : 1 }}
                >
                  <motion.span animate={{ rotate: open ? 0 : -90 }} transition={motionTokens.duration.base} className="text-ink-faint">
                    ▾
                  </motion.span>
                  <span className="flex-1 truncate font-body text-sm font-semibold text-ink">{category.label}</span>
                  <span className="font-body text-xs text-ink-faint">{entries.length}</span>
                </button>
                <AnimatePresence initial={false}>
                  {open && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={motionTokens.duration.base}
                      className="overflow-hidden"
                    >
                      {entries.map((entry, entryIndex) => {
                        const kindConfig = entry.nodeKind ? PROCESSING_NODE_KIND_CONFIG[entry.nodeKind] : undefined;
                        const catalogVisual = visualForCatalogEntryId(entry.id);
                        const isLed = catalogVisual?.solidSwatch === true;
                        const isCircular = catalogVisual?.circular === true;
                        const ledDefault = entry.fields?.find((f) => f.id === "color")?.default;
                        return (
                        <PaletteRow
                          key={entry.id}
                          entry={entry}
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
          Per inserire il blocco, trascinalo sul canvas.
        </div>
      )}
    </div>
  );
}

function PaletteRow({
  entry,
  color,
  icon: Icon,
  solidSwatch = false,
  circular = false,
  delay,
  portsConfigured,
  onClickRemind,
  onDragBegan,
}: {
  readonly entry: ProcessingCatalogEntry;
  readonly color: string;
  readonly icon: LucideIcon;
  readonly solidSwatch?: boolean;
  readonly circular?: boolean;
  readonly delay: number;
  readonly portsConfigured: boolean;
  readonly onClickRemind: () => void;
  readonly onDragBegan: () => void;
}) {
  const needsPort = catalogEntryNeedsConfiguredPort(entry);
  const placeable = isPlaceableOnDeviceGraph(entry) && (!needsPort || portsConfigured);
  const badge = !portsConfigured && needsPort ? "serve una Porta" : availabilityBadge(entry);

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
        title={placeable ? "Trascina sul canvas per inserire" : needsPort && !portsConfigured ? "Configura prima una Porta in Composizione fisica." : entry.notes}
        onClick={() => {
          if (placeable) onClickRemind();
        }}
        onDragStart={(e: DragEvent<HTMLButtonElement>) => {
          if (!placeable) {
            e.preventDefault();
            return;
          }
          e.dataTransfer.setData(PROCESSING_BLOCK_MIME, entry.id);
          e.dataTransfer.effectAllowed = "copy";
          e.currentTarget.style.opacity = "0.6";
          beginPaletteDrag(entry.nodeKind);
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
          {solidSwatch ? null : <Icon size={14} color={placeable ? "#fff" : "#8A8F99"} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate font-body text-sm text-ink">{entry.label}</div>
          <div className="truncate font-body text-xs text-ink-faint">
            {badge ? `${badge} · ${entry.subtitle}` : entry.subtitle}
          </div>
        </div>
      </button>
    </motion.div>
  );
}

function availabilityBadge(entry: ProcessingCatalogEntry): string | undefined {
  if (entry.availability === "planned") return "pianificato";
  if (entry.availability === "pack") return "pack";
  if (!isPlaceableOnDeviceGraph(entry)) {
    if (entry.runtime === "node-red") return "Node-RED";
    if (entry.runtime === "feature") return "Features";
    if (entry.runtime === "core-admin") return "admin";
    if (entry.runtime === "authoring") return "solo editor";
    return "fuori scope";
  }
  return undefined;
}
