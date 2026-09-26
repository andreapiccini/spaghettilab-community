import { CircuitBoard } from "lucide-react";
import { comingSoonCopy } from "../../lib/coming-soon-copy.js";
import { useLocale } from "../../state/locale-context.js";
import { useSession } from "../../state/session-context.js";
import { ComingSoonScreen } from "./ComingSoonScreen.js";

/**
 * Future schematic + PCB export from the hardware already composed and
 * discovered in Physical Composition. Placeholder only — that canvas stays untouched.
 */
export function SchematicPcbScreen() {
  const { navigate } = useSession();
  const { locale } = useLocale();
  const copy = comingSoonCopy(locale);

  return (
    <ComingSoonScreen icon={CircuitBoard} title={copy.schematic.title} description={copy.schematic.description}>
      <div className="mt-6 max-w-xl rounded-slmd border border-border bg-surface p-4 shadow-e1">
        <h2 className="font-heading text-base font-semibold text-ink">{copy.schematic.heading}</h2>
        <p className="mt-1 font-body text-sm text-ink-muted">{copy.schematic.body}</p>
        <button
          type="button"
          onClick={() => navigate("physical-composition")}
          className="mt-4 rounded-slpill bg-brand-blue px-4 py-2 font-body-strong text-sm text-white hover:bg-brand-blue-dark"
        >
          {copy.schematic.goPhysical}
        </button>
      </div>
    </ComingSoonScreen>
  );
}
