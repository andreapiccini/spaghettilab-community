import { GitBranch, Plus, Power, Thermometer, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { DEMO_ADD_BLOCK_IDS } from "../../lib/demo-only.js";
import { processingGraphCopy } from "../../lib/processing-graph-copy.js";
import { useLocale } from "../../state/locale-context.js";

const ITEMS = [
  { id: DEMO_ADD_BLOCK_IDS[0], icon: GitBranch, color: "#4F46E5" },
  { id: DEMO_ADD_BLOCK_IDS[1], icon: Power, color: "#64748B" },
  { id: DEMO_ADD_BLOCK_IDS[2], icon: Thermometer, color: "#0EA5E9" },
] as const;

/**
 * Visitor plus control: a vertical list above the button (not a radial fan)
 * so IF / Relay / Temperature stay readable and never overlap.
 */
export function DemoRadialAdd({ onPick }: { readonly onPick: (entryId: (typeof DEMO_ADD_BLOCK_IDS)[number]) => void }) {
  const { locale } = useLocale();
  const copy = processingGraphCopy(locale);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const labels: Record<(typeof DEMO_ADD_BLOCK_IDS)[number], { title: string; hint: string }> = {
    "appblocks.compare_if": { title: copy.addIf, hint: copy.addIfHint },
    "appblocks.relay": { title: copy.addRelay, hint: copy.addRelayHint },
    "appblocks.temperature_sensor": { title: copy.addTemperature, hint: copy.addTemperatureHint },
  };

  return (
    <div
      data-tour-target="demo-tour-add"
      className="pointer-events-auto absolute z-20 flex flex-col items-end gap-2"
      style={{ right: "max(1rem, env(safe-area-inset-right))", bottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      <AnimatePresence>
        {open && (
          <motion.button
            type="button"
            aria-label="Close"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-10 cursor-default bg-transparent"
            onClick={() => setOpen(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {open && (
          <motion.div
            key="add-list"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.14 }}
            className="relative z-20 flex w-52 flex-col gap-2"
          >
            {ITEMS.map((item) => {
              const Icon = item.icon;
              const text = labels[item.id];
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    onPick(item.id);
                    setOpen(false);
                  }}
                  className="flex w-full items-center gap-2.5 rounded-slmd bg-surface py-2 pl-2 pr-3 text-left shadow-e2"
                  style={{ outline: "1px solid var(--color-border-strong)" }}
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-white"
                    style={{ backgroundColor: item.color }}
                  >
                    <Icon size={16} />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-body text-sm font-semibold text-ink">{text.title}</span>
                    <span className="block font-body text-[11px] text-ink-faint">{text.hint}</span>
                  </span>
                </button>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
      <button
        type="button"
        aria-expanded={open}
        aria-label={copy.addBlock}
        onClick={() => setOpen((value) => !value)}
        className="relative z-20 flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-blue text-white shadow-e2 hover:bg-brand-blue-dark"
      >
        {open ? <X size={22} /> : <Plus size={22} />}
      </button>
    </div>
  );
}
