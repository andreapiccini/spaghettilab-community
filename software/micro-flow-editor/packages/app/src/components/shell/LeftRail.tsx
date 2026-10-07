import { Cable, PanelLeftClose, PanelLeftOpen, Settings, Workflow } from "lucide-react";
import { useState } from "react";
import { chromeCopy } from "../../lib/chrome-copy.js";
import { useLocale } from "../../state/locale-context.js";
import type { ScreenId } from "../../state/session-context.js";
import { useSession } from "../../state/session-context.js";
import { useSettingsModal } from "../../state/settings-modal-context.js";
import { IconTooltip } from "./IconTooltip.js";

type RailItem = {
  readonly id: ScreenId;
  readonly label: string;
  readonly icon: typeof Cable;
};

/** The MVP exposes only Discover, Run Deploy and Settings. */
export function LeftRail() {
  const { activeScreen, navigate } = useSession();
  const { openSettings } = useSettingsModal();
  const { locale } = useLocale();
  const copy = chromeCopy(locale);
  const [expanded, setExpanded] = useState(false);
  const items: readonly RailItem[] = [
    { id: "core-connections", icon: Cable, label: "Discover" },
    { id: "processing-graph", icon: Workflow, label: "Run Deploy" },
  ];

  return (
    <nav className={`flex h-full shrink-0 flex-col border-r border-border bg-surface py-3 transition-[width] duration-200 ${expanded ? "w-60" : "w-16"}`}>
      <div className="flex flex-col gap-1 px-2">
        {items.map((item) => {
          const Icon = item.icon;
          const active = activeScreen === item.id || (item.id === "processing-graph" && (activeScreen === "deploy-diff" || activeScreen === "physical-composition"));
          return (
            <button
              key={item.id}
              type="button"
              data-tour-target={`rail-${item.id}`}
              onClick={() => navigate(item.id)}
              title={expanded ? undefined : item.label}
              className={`group relative flex h-10 w-full items-center gap-3 rounded-slsm px-3 font-body text-sm ${active ? "bg-brand-blue/10 text-brand-blue" : "text-ink-muted hover:bg-surface-raised"}`}
            >
              <Icon size={18} className="shrink-0" />
              {expanded ? <span className="truncate">{item.label}</span> : <IconTooltip label={item.label} />}
            </button>
          );
        })}
      </div>
      <div className="mt-auto px-2">
        <button
          type="button"
          data-tour-target="rail-settings"
          onClick={() => openSettings()}
          title={expanded ? undefined : copy.settings}
          className="group relative mb-1 flex h-10 w-full items-center gap-3 rounded-slsm px-3 font-body text-sm text-ink-muted hover:bg-surface-raised"
        >
          <Settings size={18} className="shrink-0" />
          {expanded ? <span className="truncate">{copy.settings}</span> : <IconTooltip label={copy.settings} />}
        </button>
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex h-10 w-full items-center gap-3 rounded-slsm px-3 text-ink-faint hover:bg-surface-raised"
          aria-label={expanded ? copy.collapseRail : copy.expandRail}
        >
          {expanded ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
      </div>
    </nav>
  );
}
