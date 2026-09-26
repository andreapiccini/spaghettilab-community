import type { CoreBindingRecord } from "@spaghettilab/domain";
import { ChevronDown, Cpu } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { catalogTopologyCopy } from "../../lib/catalog-topology-copy.js";
import { motionTokens } from "../../lib/motion-tokens.js";
import { useCoreSessions } from "../../state/core-sessions-context.js";
import { useLocale } from "../../state/locale-context.js";

/** `ux/screens/S040-catalog-topology/visual.md` § Header — "stesso pattern di S070" (S070 non è ancora costruito: pattern minimo coerente col resto della shell, non copiato da nulla di esistente). */
export function CoreSelector({ bindings, selected, onSelect }: { readonly bindings: readonly CoreBindingRecord[]; readonly selected: CoreBindingRecord | null; readonly onSelect: (binding: CoreBindingRecord) => void }) {
  const { locale } = useLocale();
  const copy = catalogTopologyCopy(locale);
  const { rows } = useCoreSessions();
  const [open, setOpen] = useState(false);
  const labelOf = (binding: CoreBindingRecord) =>
    rows.find((row) => row.binding.bindingId === binding.bindingId)?.displayName ?? binding.expectedDeviceId;

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex h-9 items-center gap-2 rounded-slsm border border-border-strong px-3 font-body text-sm text-ink hover:bg-surface-raised">
        <Cpu size={14} className="text-ink-faint" />
        <span className="text-ink-faint">Core</span>
        <span className="font-semibold">{selected ? labelOf(selected) : "—"}</span>
        <ChevronDown size={14} className="text-ink-faint" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={motionTokens.duration.fast} className="absolute left-0 top-11 z-40 w-64 overflow-hidden rounded-slmd border border-border bg-surface shadow-e2">
            {bindings.length === 0 ? (
              <p className="p-3 font-body text-sm text-ink-faint">{copy.noCoreInProject}</p>
            ) : (
              bindings.map((b) => (
                <button
                  key={b.bindingId}
                  type="button"
                  onClick={() => {
                    onSelect(b);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left font-body text-sm hover:bg-surface-raised ${selected?.bindingId === b.bindingId ? "bg-surface-raised font-semibold" : ""}`}
                >
                  {labelOf(b)}
                </button>
              ))
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
