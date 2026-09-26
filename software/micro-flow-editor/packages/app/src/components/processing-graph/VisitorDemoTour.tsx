import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTargetRect } from "../../lib/use-target-rect.js";
import {
  isVisitorDemoTourForced,
  readVisitorDemoTourSeen,
  VISITOR_DEMO_TOUR_STEPS,
  writeVisitorDemoTourSeen,
} from "../../lib/visitor-demo-tour.js";

const PADDING = 12;
const CARD_WIDTH = typeof window !== "undefined" ? Math.min(320, window.innerWidth - 32) : 320;

/**
 * First-visit overlay on the public demo. Separate from the IDE shell tour
 * (that one talks about Core Connections and is disabled in demo-only).
 */
export function VisitorDemoTour({ enabled }: { readonly enabled: boolean }) {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!enabled || (readVisitorDemoTourSeen() && !isVisitorDemoTourForced())) return;
    const timer = window.setTimeout(() => setActive(true), 500);
    return () => window.clearTimeout(timer);
  }, [enabled]);

  const step = active ? VISITOR_DEMO_TOUR_STEPS[stepIndex] : undefined;
  const rect = useTargetRect(step?.target);

  function finish() {
    writeVisitorDemoTourSeen(true);
    setActive(false);
  }

  function next() {
    if (stepIndex >= VISITOR_DEMO_TOUR_STEPS.length - 1) finish();
    else setStepIndex((i) => i + 1);
  }

  function prev() {
    setStepIndex((i) => Math.max(0, i - 1));
  }

  useEffect(() => {
    if (!active) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") finish();
      else if (event.key === "ArrowRight") next();
      else if (event.key === "ArrowLeft") prev();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, stepIndex]);

  if (!enabled || !active || !step) return null;

  const isLast = stepIndex === VISITOR_DEMO_TOUR_STEPS.length - 1;
  const cx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  const cy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;
  const radius = rect ? Math.hypot(rect.width, rect.height) / 2 + PADDING : 0;

  let cardLeft: number;
  let cardTop: number;
  if (step.side === "right" && rect) {
    cardLeft = rect.right + 20;
    cardTop = Math.max(16, Math.min(window.innerHeight - 220, rect.top));
  } else if (step.side === "left" && rect) {
    cardLeft = rect.left - CARD_WIDTH - 20;
    cardTop = Math.max(16, Math.min(window.innerHeight - 220, rect.top));
  } else if (rect) {
    cardLeft = Math.max(16, Math.min(window.innerWidth - CARD_WIDTH - 16, rect.left));
    cardTop = rect.bottom + 20;
  } else {
    cardLeft = window.innerWidth / 2 - CARD_WIDTH / 2;
    cardTop = window.innerHeight / 2 - 80;
  }
  cardLeft = Math.max(16, Math.min(window.innerWidth - CARD_WIDTH - 16, cardLeft));

  return (
    <div className="fixed inset-0 z-[999]" role="dialog" aria-modal="true" aria-label={step.title}>
      <svg className="absolute inset-0 h-full w-full" style={{ pointerEvents: "auto" }}>
        <defs>
          <mask id="visitor-demo-tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {rect && <circle cx={cx} cy={cy} r={radius} fill="black" />}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(15, 18, 24, 0.72)" mask="url(#visitor-demo-tour-mask)" onClick={finish} />
        {rect && <circle cx={cx} cy={cy} r={radius} fill="none" stroke="var(--color-brand-blue)" strokeWidth={2} />}
      </svg>

      <div className="absolute rounded-slmd bg-surface p-4 shadow-e2" style={{ left: cardLeft, top: cardTop, width: CARD_WIDTH }}>
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-heading text-base font-semibold text-ink">{step.title}</h3>
          <button type="button" onClick={finish} className="shrink-0 rounded-slsm p-1 text-ink-faint hover:bg-surface-raised" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <p className="mt-2 font-body text-sm text-ink-muted">{step.body}</p>
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {VISITOR_DEMO_TOUR_STEPS.map((_, i) => (
              <span key={i} className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: i === stepIndex ? "var(--color-brand-blue)" : "var(--color-border-strong)" }} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <button type="button" onClick={prev} className="flex h-8 items-center gap-1 rounded-slsm border border-border-strong px-2 font-body text-sm text-ink hover:bg-surface-raised">
                <ChevronLeft size={14} />
              </button>
            )}
            <button type="button" onClick={next} className="flex h-8 items-center gap-1 rounded-slsm bg-brand-blue px-3 font-body-strong text-sm text-white hover:bg-brand-blue-dark">
              {isLast ? "Done" : "Next"}
              {!isLast && <ChevronRight size={14} />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
