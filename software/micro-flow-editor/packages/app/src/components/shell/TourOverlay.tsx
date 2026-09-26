import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect } from "react";
import { chromeCopy } from "../../lib/chrome-copy.js";
import { tourSteps } from "../../lib/tour-steps.js";
import { useTargetRect } from "../../lib/use-target-rect.js";
import { useLocale } from "../../state/locale-context.js";
import { useTour } from "../../state/tour-context.js";

const PADDING = 12;

/**
 * First-launch shell tour: dims everything except the current target (an SVG
 * mask cut-out, not four positioned divs — a circle is trivial that way) and
 * shows a card explaining that zone. `pointer-events: auto` on the whole
 * overlay is deliberate — the tour is look-then-Next, not click-through, so a
 * step can't be skipped by accidentally interacting with the real UI under it.
 */
export function TourOverlay() {
  const { active, stepIndex, next, prev, close } = useTour();
  const { locale } = useLocale();
  const copy = chromeCopy(locale);
  const steps = tourSteps(locale);
  const step = active ? steps[stepIndex] : undefined;
  const rect = useTargetRect(step?.target);

  useEffect(() => {
    if (!active) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
      else if (event.key === "ArrowRight") next();
      else if (event.key === "ArrowLeft") prev();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, close, next, prev]);

  if (!active || !step) return null;

  const isLast = stepIndex === steps.length - 1;
  const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
  const radius = rect ? Math.hypot(rect.width, rect.height) / 2 + PADDING : 0;

  const cardWidth = 320;
  let cardLeft: number;
  let cardTop: number;
  if (step.side === "right" && rect) {
    cardLeft = rect.right + 20;
    cardTop = Math.max(16, Math.min(window.innerHeight - 220, rect.top));
  } else if (rect) {
    cardLeft = Math.max(16, Math.min(window.innerWidth - cardWidth - 16, rect.left));
    cardTop = rect.bottom + 20;
  } else {
    cardLeft = window.innerWidth / 2 - cardWidth / 2;
    cardTop = window.innerHeight / 2 - 80;
  }
  cardLeft = Math.max(16, Math.min(window.innerWidth - cardWidth - 16, cardLeft));

  return (
    <div className="fixed inset-0 z-[999]" role="dialog" aria-modal="true" aria-label={step.title}>
      <svg className="absolute inset-0 h-full w-full" style={{ pointerEvents: "auto" }}>
        <defs>
          <mask id="tour-spotlight-mask">
            <rect width="100%" height="100%" fill="white" />
            {rect && <circle cx={cx} cy={cy} r={radius} fill="black" />}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(15, 18, 24, 0.72)" mask="url(#tour-spotlight-mask)" onClick={close} />
        {rect && <circle cx={cx} cy={cy} r={radius} fill="none" stroke="var(--color-brand-blue)" strokeWidth={2} />}
      </svg>

      <div className="absolute rounded-slmd bg-surface p-4 shadow-e2" style={{ left: cardLeft, top: cardTop, width: cardWidth }}>
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-heading text-base font-semibold text-ink">{step.title}</h3>
          <button type="button" onClick={close} className="shrink-0 rounded-slsm p-1 text-ink-faint hover:bg-surface-raised" aria-label={copy.close}>
            <X size={16} />
          </button>
        </div>
        <p className="mt-2 font-body text-sm text-ink-muted">{step.body}</p>
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {steps.map((_, i) => (
              <span key={i} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: i === stepIndex ? "var(--color-brand-blue)" : "var(--color-border-strong)" }} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <button type="button" onClick={prev} className="flex h-8 items-center gap-1 rounded-slsm border border-border-strong px-2 font-body text-sm text-ink hover:bg-surface-raised">
                <ChevronLeft size={14} />
              </button>
            )}
            <button type="button" onClick={isLast ? close : next} className="flex h-8 items-center gap-1 rounded-slsm bg-brand-blue px-3 font-body-strong text-sm text-white hover:bg-brand-blue-dark">
              {isLast ? copy.tourDone : copy.tourNext}
              {!isLast && <ChevronRight size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
