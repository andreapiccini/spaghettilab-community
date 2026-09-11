import {
  Activity,
  Blocks,
  BookOpen,
  Boxes,
  Cable,
  CircuitBoard,
  Cpu,
  GitCompareArrows,
  GraduationCap,
  PanelLeftClose,
  PanelLeftOpen,
  Puzzle,
  Share2,
  Shield,
  ShoppingBag,
  Store,
  Workflow,
} from "lucide-react";
import { useState } from "react";
import { isScreenVisibleInMode } from "../../lib/ui-mode.js";
import type { ScreenId } from "../../state/session-context.js";
import { useSession } from "../../state/session-context.js";
import { useUiMode } from "../../state/ui-mode-context.js";
import { IconTooltip } from "./IconTooltip.js";
import { productionExtensions } from "../../extensions/registry.js";

type RailItem = {
  readonly id: ScreenId;
  readonly label: string;
  readonly icon: typeof Cable;
};

const GROUPS: readonly { readonly items: readonly RailItem[] }[] = [
  {
    items: [
      { id: "core-connections", label: "Core Connections", icon: Cable },
      { id: "catalog-topology", label: "Catalog & Topology", icon: Boxes },
      { id: "physical-composition", label: "Physical Composition", icon: Blocks },
      { id: "device-profile-studio", label: "Device Profiles", icon: Cpu },
    ],
  },
  {
    items: [
      { id: "processing-graph", label: "Processing Graph", icon: Workflow },
      { id: "deploy-diff", label: "Deploy & Diff", icon: GitCompareArrows },
      { id: "runtime-diagnostics", label: "Runtime & Diagnostics", icon: Activity },
    ],
  },
  {
    items: [
      { id: "capability-marketplace", label: "Capability Marketplace", icon: Store },
      { id: "cross-core-automation", label: "Automazioni", icon: Share2 },
      { id: "settings-security", label: "Sicurezza", icon: Shield },
    ],
  },
  {
    items: [
      { id: "market", label: "Market", icon: ShoppingBag },
      {
        id: "generate-schematic-pcb",
        label: "Genera schematico e PCB",
        icon: CircuitBoard,
      },
      { id: "education", label: "Formazione", icon: GraduationCap },
      { id: "datasheets", label: "Datasheet e istruzioni", icon: BookOpen },
    ],
  },
];

/** `UX_ARCHITECTURE.md` § Shell applicativa — 64px collapsed / 240px expanded, groups separated by a thin divider. */
export function LeftRail() {
  const { activeScreen, navigate } = useSession();
  const { mode } = useUiMode();
  const [expanded, setExpanded] = useState(false);
  const visibleGroups = GROUPS.map((group) => ({
    items: group.items.filter((item) => isScreenVisibleInMode(item.id, mode)),
  })).filter((group) => group.items.length > 0);
  const extensionItems: RailItem[] = productionExtensions
    .screens()
    .filter((screen) => screen.availability !== "advanced" || mode === "advanced")
    .map((screen) => ({ id: screen.id, label: screen.label, icon: Puzzle }));
  if (extensionItems.length > 0) visibleGroups.push({ items: extensionItems });

  return (
    <nav
      className={`flex h-full shrink-0 flex-col border-r border-border bg-surface py-3 transition-[width] duration-200 ${expanded ? "w-60" : "w-16"}`}
    >
      <div className="flex flex-col gap-1 px-2">
        {visibleGroups.map((group, i) => (
          <div
            key={i}
            className={i > 0 ? "mt-3 border-t border-border pt-3" : undefined}
          >
            {group.items.map((item) => {
              const Icon = item.icon;
              const active = activeScreen === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-tour-target={`rail-${item.id}`}
                  onClick={() => navigate(item.id)}
                  title={expanded ? undefined : item.label}
                  className={`group relative mb-1 flex h-10 w-full items-center gap-3 rounded-slsm px-3 font-body text-sm ${active ? "bg-brand-blue/10 text-brand-blue" : "text-ink-muted hover:bg-surface-raised"}`}
                >
                  <Icon size={18} className="shrink-0" />
                  {expanded ? (
                    <span className="truncate">{item.label}</span>
                  ) : (
                    <IconTooltip label={item.label} />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="mt-auto px-2">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          className="flex h-10 w-full items-center gap-3 rounded-slsm px-3 text-ink-faint hover:bg-surface-raised"
          aria-label={expanded ? "Comprimi" : "Espandi"}
        >
          {expanded ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
      </div>
    </nav>
  );
}
