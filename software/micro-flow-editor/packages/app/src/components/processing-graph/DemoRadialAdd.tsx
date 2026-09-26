import { GitBranch, Plus, Power, Thermometer, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { DEMO_ADD_BLOCK_IDS } from "../../lib/demo-only.js";
import { processingGraphCopy } from "../../lib/processing-graph-copy.js";
import { useLocale } from "../../state/locale-context.js";

const ITEMS = [
  { id: DEMO_ADD_BLOCK_IDS[0], icon: GitBranch, angle: -80, color: "#4F46E5" },
  { id: DEMO_ADD_BLOCK_IDS[1], icon: Power, angle: -125, color: "#64748B" },
  { id: DEMO_ADD_BLOCK_IDS[2], icon: Thermometer, angle: -170, color: "#0EA5E9" },
] as const;

/**
 * Visitor-only plus control: opens a radial menu to place IF, Relay,
 * or Temperature sensor on the public demo canvas.
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
      className="pointer-events-auto absolute z-20"
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
      <div className="relative z-20 h-14 w-14">
        <AnimatePresence>
          {open &&
            ITEMS.map((item, index) => {
              const radius = 88;
              const rad = (item.angle * Math.PI) / 180;
              const x = Math.cos(rad) * radius;
              const y = Math.sin(rad) * radius;
              const Icon = item.icon;
              const text = labels[item.id];
              return (
                <motion.button
                  key={item.id}
                  type="button"
                  initial={{ opacity: 0, x: 0, y: 0, scale: 0.6 }}
                  animate={{ opacity: 1, x, y, scale: 1 }}
                  exit={{ opacity: 0, x: 0, y: 0, scale: 0.6 }}
                  transition={{ delay: index * 0.04, type: "spring", stiffness: 420, damping: 28 }}
                  onClick={() => {
                    onPick(item.id);
                    setOpen(false);
                  }}
                  className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-full bg-surface py-1.5 pl-1.5 pr-3 shadow-e2"
                  style={{ outline: "1px solid var(--color-border-strong)" }}
                >
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-full text-white"
                    style={{ backgroundColor: item.color }}
                  >
                    <Icon size={15} />
                  </span>
                  <span className="text-left">
                    <span className="block font-body text-xs font-semibold text-ink">{text.title}</span>
                    <span className="block font-body text-[10px] text-ink-faint">{text.hint}</span>
                  </span>
                </motion.button>
              );
            })}
        </AnimatePresence>
        <button
          type="button"
          aria-expanded={open}
          aria-label={copy.addBlock}
          onClick={() => setOpen((value) => !value)}
          className="absolute inset-0 flex items-center justify-center rounded-full bg-brand-blue text-white shadow-e2 hover:bg-brand-blue-dark"
        >
          {open ? <X size={22} /> : <Plus size={22} />}
        </button>
      </div>
    </div>
  );
}
