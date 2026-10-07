import { Puzzle, Search, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { chromeCopy } from "../../lib/chrome-copy.js";
import { motionTokens } from "../../lib/motion-tokens.js";
import {
  groupSettingsCategories,
  searchSettingsCategories,
} from "../../lib/settings-catalog.js";
import { useLocale } from "../../state/locale-context.js";
import { useSettingsModal } from "../../state/settings-modal-context.js";
import { useUiMode } from "../../state/ui-mode-context.js";
import { SETTINGS_CATEGORY_ICONS } from "./category-icons.js";
import { SETTINGS_PANES } from "./panes.js";
import { productionExtensions } from "../../extensions/registry.js";
import type { SettingsCategoryId } from "../../lib/settings-catalog.js";

export function SettingsModal() {
  const { open, categoryId, closeSettings, setCategoryId } = useSettingsModal();
  const { mode } = useUiMode();
  const { locale } = useLocale();
  const copy = chromeCopy(locale);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeSettings();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, closeSettings]);

  const matches = useMemo(
    () =>
      searchSettingsCategories(query, mode, (category) => {
        const texts = copy.categories[category.id];
        return `${texts.label} ${texts.title} ${texts.subtitle} ${copy.groups[category.groupId]}`;
      }).filter((category) => category.id === "general" || category.id === "language"),
    [query, mode, copy],
  );
  const groups = useMemo(() => groupSettingsCategories(matches), [matches]);
  const extensionSettings = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return productionExtensions
      .settings()
      .filter(
        (setting) =>
          normalized === "" ||
          [setting.id, setting.label, ...(setting.keywords ?? [])]
            .join(" ")
            .toLowerCase()
            .includes(normalized),
      );
  }, [query]);

  useEffect(() => {
    if (!open) return;
    if (
      matches.some((category) => category.id === categoryId) ||
      extensionSettings.some((setting) => setting.id === categoryId)
    )
      return;
    const first = matches[0];
    if (first) setCategoryId(first.id);
    else if (extensionSettings[0]) setCategoryId(extensionSettings[0].id);
  }, [open, matches, extensionSettings, categoryId, setCategoryId]);

  const extensionSetting = extensionSettings.find(({ id }) => id === categoryId);
  const active =
    matches.some((category) => category.id === categoryId) ||
    extensionSetting !== undefined;
  const Pane =
    extensionSetting?.component ?? SETTINGS_PANES[categoryId as SettingsCategoryId];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-6"
          style={{
            backgroundColor: "rgba(20, 23, 31, 0.35)",
            backdropFilter: "blur(12px)",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={motionTokens.duration.fast}
          onClick={closeSettings}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={copy.settings}
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={motionTokens.spring.smooth}
            onClick={(event) => event.stopPropagation()}
            className="flex h-[min(680px,calc(100vh-48px))] w-[min(960px,calc(100vw-48px))] overflow-hidden rounded-sllg bg-surface shadow-e3"
          >
            <nav className="flex w-60 shrink-0 flex-col border-r border-border bg-surface-sunken">
              <div className="p-3">
                <label className="flex h-9 items-center gap-2 rounded-slsm border border-border-strong bg-surface px-3">
                  <Search size={14} className="text-ink-faint" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={copy.searchSettings}
                    className="w-full bg-transparent font-body text-sm outline-none placeholder:text-ink-faint"
                  />
                </label>
              </div>
              <div className="min-h-0 flex-1 overflow-auto px-2 pb-3">
                {groups.length === 0 && extensionSettings.length === 0 ? (
                  <p className="px-2 py-6 text-center font-body text-sm text-ink-faint">
                    {copy.noResults}
                  </p>
                ) : (
                  groups.map((group) => (
                    <div key={group.groupId} className="mb-3">
                      <p className="px-2 pb-1 font-body text-[11px] uppercase tracking-wide text-ink-faint">
                        {copy.groups[group.groupId]}
                      </p>
                      {group.categories.map((category) => {
                        const Icon = SETTINGS_CATEGORY_ICONS[category.id];
                        const selected = category.id === categoryId;
                        return (
                          <button
                            key={category.id}
                            type="button"
                            onClick={() => setCategoryId(category.id)}
                            className={`mb-0.5 flex h-9 w-full items-center gap-2 rounded-slsm px-2 font-body text-sm ${selected ? "bg-surface text-ink" : "text-ink-muted hover:bg-surface"}`}
                          >
                            <Icon size={16} className="shrink-0 text-ink-faint" />
                            <span className="min-w-0 flex-1 truncate text-left">
                              {copy.categories[category.id].label}
                            </span>
                            {category.status === "planned" && (
                              <span className="text-[10px] text-ink-faint">…</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))
                )}
                {extensionSettings.length > 0 && (
                  <div className="mb-3">
                    <p className="px-2 pb-1 font-body text-[11px] uppercase tracking-wide text-ink-faint">
                      Extensions
                    </p>
                    {extensionSettings.map((setting) => (
                      <button
                        key={setting.id}
                        type="button"
                        onClick={() => setCategoryId(setting.id)}
                        className={`mb-0.5 flex h-9 w-full items-center gap-2 rounded-slsm px-2 font-body text-sm ${setting.id === categoryId ? "bg-surface text-ink" : "text-ink-muted hover:bg-surface"}`}
                      >
                        <Puzzle size={16} className="shrink-0 text-ink-faint" />
                        <span className="min-w-0 flex-1 truncate text-left">
                          {setting.label}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </nav>

            <div className="relative min-w-0 flex-1 bg-surface">
              <button
                type="button"
                onClick={closeSettings}
                aria-label={copy.close}
                className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-slsm text-ink-faint hover:bg-surface-raised"
              >
                <X size={16} />
              </button>
              <div className="h-full overflow-auto p-8 pr-12">
                {active && Pane && <Pane />}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
