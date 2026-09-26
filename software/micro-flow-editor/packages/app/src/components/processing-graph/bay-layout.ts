import type { BaySide } from "@spaghettilab/processing-block-catalog";
import { NODE_HEIGHT, NODE_PADDING, NODE_WIDTH } from "./layout-constants.js";

const BAY_GAP = 48;

/**
 * Prefer positions outside the Schedule box: bay inputs on the canvas left,
 * bay outputs to the right of the dashed container.
 */
export function positionForBayDrop(
  side: BaySide,
  drop: { readonly x: number; readonly y: number },
  scheduleBoxes: readonly { readonly x: number; readonly y: number; readonly width: number; readonly height: number }[],
): { x: number; y: number } {
  if (scheduleBoxes.length === 0) {
    return side === "input" ? { x: Math.min(drop.x, 40), y: drop.y } : { x: Math.max(drop.x, 420), y: drop.y };
  }

  let nearest = scheduleBoxes[0]!;
  let best = Infinity;
  for (const box of scheduleBoxes) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const d = (drop.x - cx) ** 2 + (drop.y - cy) ** 2;
    if (d < best) {
      best = d;
      nearest = box;
    }
  }

  const y = Math.max(nearest.y + NODE_PADDING + 8, Math.min(drop.y, nearest.y + nearest.height - NODE_HEIGHT - NODE_PADDING));
  if (side === "input") {
    return { x: nearest.x - NODE_WIDTH - BAY_GAP, y };
  }
  return { x: nearest.x + nearest.width + BAY_GAP, y };
}
