import { NfcBell } from "../nfc/NfcBell.js";
import { isDemoOnlyEnabled } from "../../lib/demo-only.js";
import { BrandMark } from "./BrandMark.js";
import { useSession } from "../../state/session-context.js";
import { ChromeStatus } from "./ChromeStatus.js";

export function TopBar() {
  const { session } = useSession();
  if (!session) return null;

  if (isDemoOnlyEnabled()) {
    return (
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border bg-surface px-3 sm:h-14 sm:px-4">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <BrandMark />
          <span className="shrink-0 font-heading text-sm font-semibold text-ink">Flow</span>
          <span className="truncate font-body text-xs text-ink-muted">Interactive demo — no hardware required</span>
        </div>
      </header>
    );
  }

  return (
    <header className="flex h-14 items-center justify-between border-b border-border bg-surface px-4">
      <BrandMark />
      <div className="flex items-center gap-4"><NfcBell /><ChromeStatus /></div>
    </header>
  );
}
