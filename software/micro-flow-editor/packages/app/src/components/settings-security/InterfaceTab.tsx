import { settingsSecurityCopy } from "../../lib/settings-security-copy.js";
import { useLocale } from "../../state/locale-context.js";
import { useUiMode } from "../../state/ui-mode-context.js";

/** `ux/screens/S125-simple-advanced-mode/backend-behavior.md` — stesso `UiModeProvider` già cablato al command palette (S125), esposto qui come impostazione persistente invece che solo come comando rapido. */
export function InterfaceTab() {
  const { mode, setMode } = useUiMode();
  const { locale } = useLocale();
  const copy = settingsSecurityCopy(locale);

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="font-heading text-sm font-semibold text-ink">{copy.interfaceTitle}</h2>
        <p className="mt-1 font-body text-sm text-ink-muted">{copy.interfaceBody}</p>
        <div className="mt-3 flex gap-2">
          {(["base", "advanced"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className="rounded-slpill px-4 py-1.5 font-body-strong text-sm"
              style={{
                border: mode === m ? "2px solid var(--color-brand-blue)" : "1px solid var(--color-border-strong)",
                backgroundColor: mode === m ? "color-mix(in srgb, var(--color-brand-blue) 8%, transparent)" : "transparent",
                color: mode === m ? "var(--color-brand-blue)" : "var(--color-ink)",
              }}
            >
              {m === "base" ? copy.modeBase : copy.modeAdvanced}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
