import type { ReactNode } from "react";
import { isDemoOnlyEnabled } from "../../lib/demo-only.js";
import { CommandPalette } from "./CommandPalette.js";
import { LeftRail } from "./LeftRail.js";
import { TopBar } from "./TopBar.js";

/** `UX_ARCHITECTURE.md` § Shell applicativa — the fixed three-region layout every screen (once open) renders inside. No Inspector yet: it only appears once a selection exists somewhere, added by the screens that need it (`UI-S040` onward). */
export function AppShell({ children }: { readonly children: ReactNode }) {
  const demoOnly = isDemoOnlyEnabled();
  return (
    <div className="flex h-dvh flex-col bg-surface-sunken">
      <TopBar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {!demoOnly && <LeftRail />}
        <main className={`min-h-0 flex-1 ${demoOnly ? "overflow-hidden" : "overflow-auto"}`}>{children}</main>
      </div>
      {!demoOnly && <CommandPalette />}
    </div>
  );
}
