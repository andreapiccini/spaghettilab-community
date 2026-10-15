import {
  Activity,
  BookOpen,
  Boxes,
  Cable,
  CircuitBoard,
  FileCode,
  GitCompareArrows,
  GraduationCap,
  Network,
  Redo2,
  Save,
  Search,
  Settings,
  Share2,
  Shield,
  ShoppingBag,
  SlidersHorizontal,
  Store,
  Undo2,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { isScreenVisibleInMode } from "../../lib/ui-mode.js";
import { chromeCopy } from "../../lib/chrome-copy.js";
import { motionTokens } from "../../lib/motion-tokens.js";
import {
  saveOpenProject,
  useSession,
  type ScreenId,
} from "../../state/session-context.js";
import { useLocale } from "../../state/locale-context.js";
import { useSettingsModal } from "../../state/settings-modal-context.js";
import { useUiMode } from "../../state/ui-mode-context.js";
import { productionExtensions } from "../../extensions/registry.js";

type PaletteEntry = {
  readonly id: string;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly shortcut?: string;
  readonly run: () => void;
};

/**
 * `ux/screens/S010-workspace-shell/visual.md` § 3 + `ui-behavior.md` § Command palette — `⌘K` overlay, keyboard-only navigable.
 * "Salva progetto" (`⌘S`) is not in that spec, but `backend-behavior.md` explicitly says
 * `ProjectRepository` persistence "resta un'azione esplicita separata" from every edit —
 * without a UI trigger for it, nothing ever reaches storage and every edit is lost on
 * reload. This surfaced live while wiring `UI-S030`: a `CoreBinding` added via
 * `addCoreBinding` survived in the in-memory `CommandStack` but vanished on refresh.
 * The command palette is the natural home (same place "Annulla ultima modifica" lives),
 * so it is fixed here rather than deferred.
 */
export function CommandPalette() {
  const { session, navigate, undo, redo, markSaved } = useSession();
  const { mode, setMode } = useUiMode();
  const { locale } = useLocale();
  const { openSettings } = useSettingsModal();
  const copy = chromeCopy(locale);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
        setQuery("");
        setHighlighted(0);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function save() {
    if (!session) return;
    setSaveState("saving");
    try {
      await saveOpenProject(session);
      markSaved();
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
    setTimeout(() => setSaveState("idle"), 2000);
  }

  const entries = useMemo<PaletteEntry[]>(() => {
    const navEntries: PaletteEntry[] = (
      [
        ["core-connections", copy.screens.coreConnections, Cable],
        ["catalog-topology", copy.palette.catalogTopology, Network],
        ["physical-composition", copy.palette.physicalComposition, Boxes],
        ["device-profile-studio", copy.palette.deviceProfileStudio, FileCode],
        ["processing-graph", copy.palette.processingGraph, Workflow],
        ["deploy-diff", copy.screens.deployDiff, GitCompareArrows],
        ["runtime-diagnostics", copy.screens.runtimeDiagnostics, Activity],
        ["capability-marketplace", copy.palette.capabilityMarketplace, Store],
        ["cross-core-automation", copy.screens.automations, Share2],
        ["settings-security", copy.palette.security, Shield],
        ["market", copy.screens.market, ShoppingBag],
        ["generate-schematic-pcb", copy.screens.generateSchematic, CircuitBoard],
        ["education", copy.screens.education, GraduationCap],
        ["datasheets", copy.screens.datasheets, BookOpen],
      ] as const
    )
      .filter(([id]) => isScreenVisibleInMode(id, mode))
      .map(([id, label, icon]: readonly [ScreenId, string, LucideIcon]) => ({
        id: `nav-${id}`,
        label: `${copy.goToPrefix} ${label}`,
        icon,
        run: () => navigate(id),
      }));

    const actionEntries: PaletteEntry[] = [];
    actionEntries.push({
      id: "open-settings",
      label: copy.settings,
      icon: Settings,
      run: () => openSettings(),
    });
    if (session) {
      actionEntries.push({
        id: "save",
        label: copy.palette.saveProject,
        icon: Save,
        shortcut: "⌘S",
        run: () => void save(),
      });
    }
    if (session?.stack.canUndo()) {
      actionEntries.push({
        id: "undo",
        label: copy.palette.undo,
        icon: Undo2,
        shortcut: "⌘Z",
        run: undo,
      });
    }
    if (session?.stack.canRedo()) {
      actionEntries.push({
        id: "redo",
        label: copy.palette.redo,
        icon: Redo2,
        shortcut: "⌘⇧Z",
        run: redo,
      });
    }
    actionEntries.push({
      id: "ui-mode",
      label:
        mode === "advanced"
          ? copy.palette.disableAdvanced
          : copy.palette.enableAdvanced,
      icon: SlidersHorizontal,
      run: () => setMode(mode === "advanced" ? "base" : "advanced"),
    });

    const extensionEntries: PaletteEntry[] = productionExtensions
      .commands()
      .map((command) => ({
        id: `extension-${command.id}`,
        label: command.label,
        icon: SlidersHorizontal,
        run: () => void command.run(),
      }));

    return [...actionEntries, ...navEntries, ...extensionEntries];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, navigate, undo, redo, mode, setMode, copy, openSettings]);

  const filtered = entries.filter((e) =>
    e.label.toLowerCase().includes(query.toLowerCase()),
  );

  function runHighlighted() {
    const entry = filtered[highlighted];
    if (entry) {
      entry.run();
      setOpen(false);
    }
  }

  return (
    <>
      <AnimatePresence>
        {saveState !== "idle" && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={motionTokens.duration.base}
            className="fixed bottom-4 right-4 z-50 rounded-slsm px-3 py-2 font-body text-sm shadow-e2"
            style={{
              backgroundColor:
                saveState === "error" ? "var(--color-error)" : "var(--color-ink)",
              color: "white",
            }}
          >
            {saveState === "saving"
              ? copy.palette.saving
              : saveState === "saved"
                ? copy.palette.saved
                : copy.palette.saveFailed}
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {open && (
          <motion.div
            className="fixed inset-0 z-50 flex justify-center bg-[rgba(20,23,31,.35)] pt-24"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionTokens.duration.fast}
            onClick={() => setOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: -8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: -8 }}
              transition={motionTokens.spring.smooth}
              onClick={(e) => e.stopPropagation()}
              className="h-fit w-[560px] overflow-hidden rounded-sllg bg-surface shadow-e3"
            >
              <div className="flex h-12 items-center gap-2 border-b border-border px-4">
                <Search size={16} className="text-ink-faint" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    setHighlighted(0);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
                    } else if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setHighlighted((h) => Math.max(h - 1, 0));
                    } else if (e.key === "Enter") {
                      runHighlighted();
                    }
                  }}
                  placeholder={copy.palette.searchPlaceholder}
                  className="w-full bg-transparent font-body text-sm outline-none placeholder:text-ink-faint"
                />
              </div>
              <div className="max-h-80 overflow-auto py-1">
                {filtered.map((entry, i) => {
                  const Icon = entry.icon;
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      onMouseEnter={() => setHighlighted(i)}
                      onClick={() => {
                        entry.run();
                        setOpen(false);
                      }}
                      className={`flex h-11 w-full items-center gap-3 px-4 text-left font-body text-sm ${i === highlighted ? "bg-surface-raised" : ""}`}
                    >
                      <Icon size={16} className="text-ink-faint" />
                      <span className="flex-1 truncate">{entry.label}</span>
                      {entry.shortcut && (
                        <span className="font-body text-xs text-ink-faint">
                          {entry.shortcut}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
