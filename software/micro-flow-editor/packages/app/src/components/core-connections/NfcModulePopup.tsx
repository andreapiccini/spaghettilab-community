import { Cable, ChevronLeft, ChevronRight, Radio, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { coreConnectionsCopy } from "../../lib/core-connections-copy.js";
import { motionTokens } from "../../lib/motion-tokens.js";
import { useLocale } from "../../state/locale-context.js";
import { useNfcPresence } from "../../state/nfc-presence-context.js";

export function NfcModulePopup() {
  const { queue, dismissCurrent, dismissAll, selectPopup } = useNfcPresence();
  const { locale } = useLocale();
  const copy = coreConnectionsCopy(locale);
  const current = queue.items[queue.activeIndex];
  const total = queue.items.length;

  useEffect(() => {
    if (!current) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") dismissCurrent();
      if (event.key === "ArrowLeft") selectPopup(queue.activeIndex - 1);
      if (event.key === "ArrowRight") selectPopup(queue.activeIndex + 1);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, dismissCurrent, queue.activeIndex, selectPopup]);

  return (
    <AnimatePresence>
      {current && (
        <motion.div
          className="fixed inset-0 z-[70] flex items-center justify-center overflow-hidden p-6"
          style={{
            backgroundColor: "rgba(20, 23, 31, 0.35)",
            backdropFilter: "blur(12px)",
          }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={motionTokens.duration.fast}
        >
          <div className="relative w-[min(460px,calc(100vw-48px))] pt-7">
            {queue.items.slice(0, Math.min(3, total - 1)).map((item, index) => (
              <motion.div
                key={`stack-${item.id}`}
                aria-hidden="true"
                className="absolute inset-x-0 top-7 h-full rounded-sllg border border-line bg-surface shadow-e2"
                animate={{
                  x: (index + 1) * 7,
                  y: -(index + 1) * 10,
                  rotate: (index % 2 === 0 ? 1 : -1) * (index + 1) * 0.55,
                  scale: 1 - (index + 1) * 0.018,
                }}
              />
            ))}

            <AnimatePresence mode="wait">
              <motion.div
                key={current.id}
                role="dialog"
                aria-modal="true"
                aria-labelledby="nfc-tag-popup-title"
                initial={{ opacity: 0, x: 26, scale: 0.98 }}
                animate={{ opacity: 1, x: 0, scale: 1 }}
                exit={{ opacity: 0, x: -26, scale: 0.98 }}
                transition={motionTokens.spring.smooth}
                className="relative rounded-sllg border border-line bg-surface p-6 shadow-e3"
              >
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div
                      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-slsm"
                      style={{
                        backgroundColor:
                          "color-mix(in srgb, var(--color-brand-blue) 12%, transparent)",
                      }}
                    >
                      <Radio size={22} className="text-brand-blue" />
                    </div>
                    <div>
                      <h2
                        id="nfc-tag-popup-title"
                        className="font-heading text-lg font-semibold text-ink"
                      >
                        {copy.nfcPopupTitle}
                      </h2>
                      <p className="font-body text-xs text-ink-muted">
                        {copy.nfcPopupPosition(queue.activeIndex + 1, total)}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={dismissCurrent}
                    aria-label={copy.nfcPopupClose}
                    className="flex h-9 w-9 items-center justify-center rounded-slpill text-ink-muted hover:bg-surface-subtle hover:text-ink"
                  >
                    <X size={18} />
                  </button>
                </div>

                <p className="font-body text-sm text-ink">{copy.nfcPopupBody}</p>
                <div className="mt-4 rounded-slsm bg-surface-subtle p-3 font-body text-sm text-ink">
                  <p className="font-body-strong">
                    {copy.nfcPopupAntenna(current.node.portId)}
                  </p>
                  {current.node.uid && (
                    <p className="mt-1 break-all font-mono text-xs text-ink-muted">
                      {copy.nfcPopupUid(current.node.uid)}
                    </p>
                  )}
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-faint">
                    <Cable size={12} />
                    {copy.nfcPopupBackbone} · {current.backboneMac}
                  </p>
                </div>

                {total > 1 && (
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => selectPopup(queue.activeIndex - 1)}
                      disabled={queue.activeIndex === 0}
                      aria-label={copy.nfcPopupPrevious}
                      className="flex h-9 w-9 items-center justify-center rounded-slpill border border-line text-ink disabled:opacity-30"
                    >
                      <ChevronLeft size={18} />
                    </button>
                    <div className="flex gap-1.5">
                      {queue.items.slice(0, 8).map((item, index) => (
                        <button
                          key={item.id}
                          type="button"
                          tabIndex={-1}
                          aria-label={copy.nfcPopupPosition(index + 1, total)}
                          onClick={() => selectPopup(index)}
                          className={`h-1.5 rounded-slpill transition-all ${
                            index === queue.activeIndex
                              ? "w-5 bg-brand-blue"
                              : "w-1.5 bg-line-strong"
                          }`}
                        />
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => selectPopup(queue.activeIndex + 1)}
                      disabled={queue.activeIndex === total - 1}
                      aria-label={copy.nfcPopupNext}
                      className="flex h-9 w-9 items-center justify-center rounded-slpill border border-line text-ink disabled:opacity-30"
                    >
                      <ChevronRight size={18} />
                    </button>
                  </div>
                )}

                <div className="mt-5 flex gap-3">
                  {total > 1 && (
                    <button
                      type="button"
                      onClick={dismissAll}
                      className="h-10 flex-1 rounded-slpill border border-line font-body-strong text-sm text-ink hover:bg-surface-subtle"
                    >
                      {copy.nfcPopupCloseAll}
                    </button>
                  )}
                  <button
                    type="button"
                    autoFocus
                    onClick={dismissCurrent}
                    className="h-10 flex-1 rounded-slpill bg-brand-blue font-body-strong text-sm text-white hover:bg-brand-blue-dark"
                  >
                    {copy.nfcPopupClose}
                  </button>
                </div>
              </motion.div>
            </AnimatePresence>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
