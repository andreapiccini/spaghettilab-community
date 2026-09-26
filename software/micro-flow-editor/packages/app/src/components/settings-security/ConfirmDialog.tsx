import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { settingsSecurityCopy } from "../../lib/settings-security-copy.js";
import { useLocale } from "../../state/locale-context.js";

/** Same "type the exact target to confirm" pattern as Runtime & Diagnostics' Amministrazione tab — backed here by `security-recovery`'s confirmation wrappers, which all delegate to `core-admin`'s `checkDestructiveConfirmation` (exact string match). */
export function ConfirmDialog({ target, onCancel, onConfirm }: { readonly target: string; readonly onCancel: () => void; readonly onConfirm: (typed: string) => void }) {
  const { locale } = useLocale();
  const copy = settingsSecurityCopy(locale);
  const [typed, setTyped] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: "rgba(20, 23, 31, 0.4)" }}>
      <div className="w-[420px] rounded-slmd bg-surface p-5 shadow-e3">
        <div className="flex items-center gap-2">
          <AlertTriangle size={18} className="text-error" />
          <h3 className="font-heading text-base font-semibold text-ink">{copy.confirmDestructive}</h3>
        </div>
        <p className="mt-2 font-body text-sm text-ink-muted">
          {copy.retypeExact} <span className="font-mono font-semibold text-ink">{target}</span>.
        </p>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} className="mt-3 w-full rounded-slsm border border-border-strong px-3 py-2 font-mono text-sm outline-none" placeholder={target} />
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={onCancel} className="flex-1 rounded-slsm border border-border-strong px-3 py-2 font-body text-sm text-ink hover:bg-surface-raised">
            {copy.cancel}
          </button>
          <button type="button" disabled={typed !== target} onClick={() => onConfirm(typed)} className="flex-1 rounded-slsm bg-error px-3 py-2 font-body-strong text-sm text-white hover:opacity-90 disabled:opacity-40">
            {copy.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
