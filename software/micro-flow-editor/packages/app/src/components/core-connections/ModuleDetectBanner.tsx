import { Radio, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { coreConnectionsCopy } from "../../lib/core-connections-copy.js";
import { motionTokens } from "../../lib/motion-tokens.js";
import { useLocale } from "../../state/locale-context.js";
import { useNfcPresence } from "../../state/nfc-presence-context.js";

const AUTO_DISMISS_MS = 4500;

export function ModuleDetectBanner() {
  const { queue, dismissCurrent } = useNfcPresence();
  const { locale } = useLocale();
  const copy = coreConnectionsCopy(locale);
  const current = queue.items[queue.activeIndex];

  useEffect(() => {
    if (!current) return undefined;
    const timer = window.setTimeout(() => dismissCurrent(), AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [current?.id, dismissCurrent]);

  return (
    <AnimatePresence>
      {current && (
        <motion.div
          key={current.id}
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex justify-center p-4"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={motionTokens.spring.smooth}
        >
          <div
            className="pointer-events-auto flex max-w-[min(520px,calc(100vw-32px))] items-center gap-3 rounded-slmd border border-line bg-surface px-4 py-3 shadow-e3"
            style={{
              backgroundImage:
                "linear-gradient(135deg, color-mix(in srgb, var(--color-brand-blue) 8%, var(--color-surface)), var(--color-surface))",
            }}
          >
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-slsm"
              style={{
                backgroundColor: "color-mix(in srgb, var(--color-brand-blue) 14%, transparent)",
              }}
            >
              <Radio size={18} className="text-brand-blue" />
            </div>
            <p className="min-w-0 flex-1 font-body text-sm text-ink">
              {copy.detectedBanner(
                current.node.label,
                current.node.backboneLabel ?? copy.masterBackbone,
                copy.modulePositionName(current.node.portId),
              )}
            </p>
            <button
              type="button"
              onClick={dismissCurrent}
              aria-label={copy.detectedBannerDismiss}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-slpill text-ink-muted hover:bg-surface-subtle hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
