import { MoreVertical, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { chromeCopy } from "../../lib/chrome-copy.js";
import { isDemoOnlyEnabled } from "../../lib/demo-only.js";
import { publicAsset } from "../../lib/public-asset.js";
import { useLocale } from "../../state/locale-context.js";
import { useSession } from "../../state/session-context.js";
import { useSettingsModal } from "../../state/settings-modal-context.js";
import { useUiMode } from "../../state/ui-mode-context.js";
import { ChromeStatus } from "./ChromeStatus.js";
import { SettingsSwitch } from "../settings-modal/SettingsRow.js";

/** `ux/screens/S010-workspace-shell/visual.md` § 2 — the standard top bar, inside an open project. */
export function TopBar() {
  const { session } = useSession();
  const { mode, setMode } = useUiMode();
  const { locale } = useLocale();
  const { openSettings } = useSettingsModal();
  const copy = chromeCopy(locale);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [menuOpen]);

  if (!session) return null;

  if (isDemoOnlyEnabled()) {
    return (
      <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-4">
        <div className="flex items-center gap-3">
          <img src={publicAsset("ux-assets/icon-transparent-28@2x.png")} alt="" className="h-7 w-7" />
          <span className="font-heading text-sm font-semibold text-ink">Flow</span>
          <span className="font-body text-xs text-ink-muted">Interactive demo — no hardware required</span>
        </div>
      </header>
    );
  }

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-4">
      <div className="flex items-center gap-3">
        <img src={publicAsset("ux-assets/icon-transparent-28@2x.png")} alt="" className="h-7 w-7" />
        {/* Undo/redo buttons hidden for now — no keyboard shortcut backs them, they were
            the only entry point, and it's unclear yet whether surfacing undo/redo here is
            right for every flow. undo()/redo() themselves are untouched in session-context. */}
        <span className="font-body text-sm text-ink-muted">{copy.noActiveCore}</span>
      </div>
      <div className="flex items-center gap-2">
        <ChromeStatus />
        <button type="button" data-tour-target="topbar-deploy" className="rounded-slpill bg-brand-blue px-4 py-1.5 font-body-strong text-sm text-white hover:bg-brand-blue-dark">
          Deploy
        </button>
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            data-tour-target="topbar-menu"
            className="flex h-9 w-9 items-center justify-center rounded-slsm text-ink-muted hover:bg-surface-raised"
            aria-label="Menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <MoreVertical size={18} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-11 z-20 w-[280px] rounded-slmd bg-surface p-2 shadow-e2">
              <div className="flex items-start justify-between gap-3 px-2 py-2">
                <div>
                  <div className="font-body text-sm text-ink">{copy.modeCurrent}: {mode === "advanced" ? copy.modeAdvanced : copy.modeBase}</div>
                  <p className="font-body text-xs text-ink-faint">{copy.modeAdvancedHelp}</p>
                </div>
                <SettingsSwitch
                  checked={mode === "advanced"}
                  onChange={(on) => setMode(on ? "advanced" : "base")}
                  label={copy.modeAdvanced}
                />
              </div>
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  openSettings();
                }}
                className="flex w-full items-center gap-2 rounded-slsm px-2 py-2 font-body text-sm text-ink hover:bg-surface-raised"
              >
                <Settings size={16} className="text-ink-faint" />
                {copy.settings}
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
