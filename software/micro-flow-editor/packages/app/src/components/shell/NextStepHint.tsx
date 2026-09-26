import { ChevronLeft, X } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";
import { readHintDismissedFromLocalStorage, saveHintDismissed } from "../../lib/hints.js";
import { chromeCopy } from "../../lib/chrome-copy.js";
import { nextStepLabel } from "../../lib/next-step-copy.js";
import { nextStepTarget } from "../../lib/next-step.js";
import { localStorageAdapter } from "../../lib/repository.js";
import { useTargetRect } from "../../lib/use-target-rect.js";
import { useLocale } from "../../state/locale-context.js";
import { useSession } from "../../state/session-context.js";
import { useTour } from "../../state/tour-context.js";

/**
 * Once the tour is done, a light, persistent nudge — a bouncing chevron plus
 * a short label pointing at whichever LeftRail zone the project genuinely
 * hasn't reached yet (`nextStepTarget`, derived from real project state, not
 * a scripted sequence). Disappears on its own as the user makes progress;
 * the × just lets someone who doesn't want the nudge turn it off for good.
 */
export function NextStepHint() {
  const { session } = useSession();
  const { active: tourActive } = useTour();
  const { locale } = useLocale();
  const copy = chromeCopy(locale);
  const [dismissed, setDismissed] = useState(readHintDismissedFromLocalStorage);

  const target = session ? nextStepTarget(session.stack.current) : null;
  const rect = useTargetRect(target ?? undefined);

  if (tourActive || dismissed || !target || !rect) return null;

  const top = rect.top + rect.height / 2;
  const left = rect.right + 6;

  function dismiss() {
    setDismissed(true);
    void saveHintDismissed(localStorageAdapter, true);
  }

  return (
    <div className="fixed z-[900] flex items-center gap-1.5" style={{ top, left, transform: "translateY(-50%)" }}>
      <motion.div animate={{ x: [0, -5, 0] }} transition={{ duration: 1.1, repeat: Infinity, ease: "easeInOut" }} className="text-brand-blue">
        <ChevronLeft size={22} strokeWidth={3} />
      </motion.div>
      <div className="flex items-center gap-1.5 rounded-slpill bg-ink px-2.5 py-1 text-white shadow-e2">
        <span className="whitespace-nowrap font-body text-xs">{nextStepLabel(target, locale)}</span>
        <button type="button" onClick={dismiss} className="rounded-full p-0.5 text-white/70 hover:text-white" aria-label={copy.hideHint}>
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
