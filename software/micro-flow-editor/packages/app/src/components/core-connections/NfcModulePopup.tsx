import { Cable, PlugZap, Unplug } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { coreConnectionsCopy } from "../../lib/core-connections-copy.js";
import { motionTokens } from "../../lib/motion-tokens.js";
import { useLocale } from "../../state/locale-context.js";
import { useNfcPresence } from "../../state/nfc-presence-context.js";

export function NfcModulePopup() {
  const { queue, dismissCurrent } = useNfcPresence();
  const { locale } = useLocale();
  const copy = coreConnectionsCopy(locale);
  const current = queue.current;

  useEffect(() => {
    if (!current) return undefined;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") dismissCurrent();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [current, dismissCurrent]);

  return (
    <AnimatePresence mode="wait">
      {current && (
        <motion.div
          key={current.id}
          className="fixed inset-0 z-[70] flex items-center justify-center p-6"
          style={{ backgroundColor: "rgba(20, 23, 31, 0.35)", backdropFilter: "blur(12px)" }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={motionTokens.duration.fast}
          onClick={dismissCurrent}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="nfc-module-popup-title"
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 8 }}
            transition={motionTokens.spring.smooth}
            onClick={(event) => event.stopPropagation()}
            className="w-[min(440px,calc(100vw-48px))] rounded-sllg bg-surface p-6 shadow-e3"
          >
            <div className="mb-3 flex items-center gap-3">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-slsm"
                style={{
                  backgroundColor:
                    current.kind === "connected"
                      ? "color-mix(in srgb, var(--color-success) 12%, transparent)"
                      : "color-mix(in srgb, var(--color-warning) 12%, transparent)",
                }}
              >
                {current.kind === "connected" ? (
                  <PlugZap size={20} style={{ color: "var(--color-success)" }} />
                ) : (
                  <Unplug size={20} style={{ color: "var(--color-warning)" }} />
                )}
              </div>
              <h2 id="nfc-module-popup-title" className="font-heading text-lg font-semibold text-ink">
                {current.kind === "connected" ? copy.nfcPopupConnectedTitle : copy.nfcPopupRemovedTitle}
              </h2>
            </div>
            <p className="font-body text-sm text-ink">
              {current.kind === "connected"
                ? copy.nfcPopupConnected(current.node.label)
                : copy.nfcPopupRemoved(current.node.label)}
            </p>
            <p className="mt-2 flex items-center gap-1.5 font-body text-xs text-ink-faint">
              <Cable size={12} />
              {copy.nfcPopupBackbone}
            </p>
            {queue.pending.length > 0 && (
              <p className="mt-3 font-body text-xs text-ink-muted">{copy.nfcPopupQueued(queue.pending.length)}</p>
            )}
            <button
              type="button"
              autoFocus
              onClick={dismissCurrent}
              className="mt-5 h-10 w-full rounded-slpill bg-brand-blue font-body-strong text-sm text-white hover:bg-brand-blue-dark"
            >
              {copy.nfcPopupClose}
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
