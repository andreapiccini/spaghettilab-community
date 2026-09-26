import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { placeInspectorAwayFromTarget } from "./inspector-placement.js";

const CARD_MAX = 340;

function readTargetEl(nodeId: string | undefined): Element | null {
  if (!nodeId || typeof document === "undefined") return null;
  return (
    document.querySelector(`[data-inspector-anchor="flow-node-${nodeId}"]`) ??
    document.querySelector(`[data-tour-target="flow-node-${nodeId}"]`)
  );
}

function toOverlayRect(
  viewportRect: DOMRect,
  overlay: DOMRect,
): { left: number; top: number; right: number; bottom: number; width: number; height: number } {
  const left = viewportRect.left - overlay.left;
  const top = viewportRect.top - overlay.top;
  return {
    left,
    top,
    right: left + viewportRect.width,
    bottom: top + viewportRect.height,
    width: viewportRect.width,
    height: viewportRect.height,
  };
}

/**
 * Settings card next to the selected demo block. Position is resolved before
 * paint so the card does not flash at a fallback origin, and it never covers
 * the block — Live preview (LED, relay, IF, temperature) stays visible.
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
  const overlayRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; ready: boolean }>(() => ({
    left: 0,
    top: 0,
    width: typeof window !== "undefined" ? Math.min(CARD_MAX, window.innerWidth - 20) : CARD_MAX,
    ready: false,
  }));

  useLayoutEffect(() => {
    let raf = 0;
    let tries = 0;
    const ro = new ResizeObserver(() => place());

    function watchTarget() {
      const targetEl = readTargetEl(nodeId);
      if (targetEl) ro.observe(targetEl);
    }

    function place() {
      const card = cardRef.current;
      const overlay = overlayRef.current;
      if (!card || !overlay || typeof window === "undefined") return;
      const targetEl = readTargetEl(nodeId);
      const viewportTarget = targetEl?.getBoundingClientRect();
      if (!viewportTarget) {
        if (tries < 40) {
          tries += 1;
          raf = window.requestAnimationFrame(place);
        }
        return;
      }
      watchTarget();
      const overlayBox = overlay.getBoundingClientRect();
      const target = toOverlayRect(viewportTarget, overlayBox);
      const width = Math.min(CARD_MAX, overlay.clientWidth - 20);
      const next = placeInspectorAwayFromTarget(
        target,
        { width, height: card.offsetHeight || 160 },
        { width: overlay.clientWidth, height: overlay.clientHeight },
        { preferSide: !!document.querySelector(`[data-inspector-anchor="flow-node-${nodeId}"]`) || target.height > 80 },
      );
      setBox((prev) =>
        prev.ready && prev.left === next.left && prev.top === next.top && prev.width === width
          ? prev
          : { left: next.left, top: next.top, width, ready: true },
      );
    }

    place();
    const card = cardRef.current;
    if (card) ro.observe(card);
    watchTarget();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [nodeId]);

  return (
    <div ref={overlayRef} className="pointer-events-none absolute inset-0 z-30">
      <button
        type="button"
        aria-label="Close settings"
        className="pointer-events-auto absolute inset-0 cursor-default bg-transparent"
        onClick={onDismiss}
      />
      <div
        ref={cardRef}
        className="pointer-events-auto absolute overflow-auto rounded-slmd border border-border bg-surface shadow-e2"
        style={{
          left: box.left,
          top: box.top,
          width: box.width,
          maxHeight: "min(42dvh, 22rem)",
          visibility: box.ready ? "visible" : "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}
