import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, X } from "lucide-react";
import { motionTokens } from "../../lib/motion-tokens.js";
import { useLocale } from "../../state/locale-context.js";

/**
 * Shown when a sensor recipe needs I2C/SPI/… that is not configured on
 * Module Function yet — CTA jumps to Physical Composition pin setup.
 */
export function PhysicalBusMissingModal({
  open,
  bus,
  onClose,
  onGoConfigure,
}: {
  readonly open: boolean;
  readonly bus: string;
  readonly onClose: () => void;
  readonly onGoConfigure: () => void;
}) {
  const { locale } = useLocale();
  const it = locale === "it";
  const busLabel = bus.toUpperCase();

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="absolute inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={motionTokens.duration.fast}
        >
          <button type="button" aria-label={it ? "Chiudi" : "Close"} className="absolute inset-0 cursor-default" onClick={onClose} />
          <motion.div
            role="dialog"
            aria-modal
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={motionTokens.spring.smooth}
            className="relative z-10 w-full max-w-sm rounded-slmd border border-border-strong bg-surface p-4 shadow-e2"
          >
            <div className="mb-3 flex items-start gap-2">
              <AlertTriangle size={18} className="mt-0.5 shrink-0 text-warning" />
              <div className="min-w-0 flex-1">
                <h2 className="font-heading text-sm font-semibold text-ink">
                  {it ? `${busLabel} non configurato` : `${busLabel} not configured`}
                </h2>
                <p className="mt-1 font-body text-sm text-ink-muted">
                  {it
                    ? `Questo sensore usa ${busLabel}, ma sul Module Function non risulta impostato (o non è stato inviato al micro). Configura i pin e riprova.`
                    : `This sensor needs ${busLabel}, but Module Function does not have it set (or it was not applied to the board). Configure the pins and try again.`}
                </p>
              </div>
              <button type="button" className="rounded-slsm p-1 text-ink-faint hover:text-ink" onClick={onClose} aria-label={it ? "Chiudi" : "Close"}>
                <X size={16} />
              </button>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-slpill px-3 py-1.5 font-body text-sm text-ink-muted hover:bg-surface-raised">
                {it ? "Annulla" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={onGoConfigure}
                className="rounded-slpill bg-brand-blue px-4 py-1.5 font-body-strong text-sm text-white hover:bg-brand-blue-dark"
              >
                {it ? "Vai alla configurazione pin" : "Go to pin configuration"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
