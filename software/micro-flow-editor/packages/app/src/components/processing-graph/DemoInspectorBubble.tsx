import type { ReactNode } from "react";
import { useTargetRect } from "../../lib/use-target-rect.js";

const CARD_MAX = 360;
const GAP = 12;

/**
 * Speech-bubble settings on the public demo: sits near the selected block
 * instead of a desktop side drawer that steals the phone canvas.
 */
export function DemoInspectorBubble({
  nodeId,
  onDismiss,
  children,
}: {
  readonly nodeId: string | undefined;
  readonly onDismiss: () => void;
  readonly children: ReactNode;
}) {
  const rect = useTargetRect(nodeId ? `flow-node-${nodeId}` : undefined);
  const width = typeof window !== "undefined" ? Math.min(CARD_MAX, window.innerWidth - 24) : CARD_MAX;
  const heightGuess = typeof window !== "undefined" ? Math.min(window.innerHeight * 0.58, 420) : 320;

  let left = 12;
  let top = 80;
  if (rect && typeof window !== "undefined") {
    left = rect.left + rect.width / 2 - width / 2;
    top = rect.bottom + GAP;
    if (top + heightGuess > window.innerHeight - 12) {
      top = Math.max(12, rect.top - heightGuess - GAP);
    }
    left = Math.max(12, Math.min(window.innerWidth - width - 12, left));
    top = Math.max(12, Math.min(window.innerHeight - 80, top));
  }

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <button
        type="button"
        aria-label="Close settings"
        className="pointer-events-auto absolute inset-0 cursor-default bg-transparent"
        onClick={onDismiss}
      />
      <div
        className="pointer-events-auto absolute overflow-hidden rounded-slmd border border-border bg-surface shadow-e2"
        style={{ left, top, width, maxHeight: "min(70dvh, 28rem)" }}
      >
        {children}
      </div>
    </div>
  );
}
