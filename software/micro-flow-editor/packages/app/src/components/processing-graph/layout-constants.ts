// Matches ProcessingNode.tsx card size (`w-44` = 176px). Shared by
// event-containers.ts and node-overlap.ts so layout math stays consistent.
export const NODE_WIDTH = 176;
export const NODE_HEIGHT = 52;
/** Bare Flow Start disc — fixed Schedule tick plug inside the dashed box. */
export const FLOW_START_SIZE = 28;
export const NODE_PADDING = 24;
/** Left gutter for the fixed tick disc before free blocks (disc size + gap). */
export const ENTRY_FEED_INSET = FLOW_START_SIZE + 16;
export const EVENT_CONTAINER_HEADER_HEIGHT = 32;
/** Minimum gap between two processing-node cards — they must never share pixels. */
export const NODE_GAP = 16;

/** Fixed relative position of the Schedule tick disc inside its dashed box. */
export function fixedTickRelativePosition(): { readonly x: number; readonly y: number } {
  return {
    x: NODE_PADDING,
    y: NODE_PADDING + EVENT_CONTAINER_HEADER_HEIGHT + Math.round((NODE_HEIGHT - FLOW_START_SIZE) / 2),
  };
}

export function fixedTickAbsolute(containerOrigin: { readonly x: number; readonly y: number }): { readonly x: number; readonly y: number } {
  const rel = fixedTickRelativePosition();
  return { x: containerOrigin.x + rel.x, y: containerOrigin.y + rel.y };
}
