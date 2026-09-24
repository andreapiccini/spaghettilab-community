import { NODE_GAP, NODE_HEIGHT, NODE_WIDTH } from "./layout-constants.js";

type Point = { readonly x: number; readonly y: number };
type Rect = { readonly x: number; readonly y: number; readonly w: number; readonly h: number };
export type SizedRect = { readonly id: string; readonly position: Point; readonly w: number; readonly h: number };

function paddedRect(position: Point, w: number, h: number, gap = NODE_GAP): Rect {
  const pad = gap / 2;
  return { x: position.x - pad, y: position.y - pad, w: w + gap, h: h + gap };
}

function intersection(a: Rect, b: Rect): { readonly overlapX: number; readonly overlapY: number } | null {
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (overlapX <= 0 || overlapY <= 0) return null;
  return { overlapX, overlapY };
}

export function nodesOverlap(a: Point, b: Point, gap = NODE_GAP): boolean {
  return intersection(paddedRect(a, NODE_WIDTH, NODE_HEIGHT, gap), paddedRect(b, NODE_WIDTH, NODE_HEIGHT, gap)) !== null;
}

export function rectsOverlap(
  a: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  b: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Pushes `position` (top-left of `size`) off every sibling rect so the two
 * never share pixels (plus `NODE_GAP`). Same local-push-then-scan strategy as
 * cards; used for dashed event-containers whose size is not NODE_WIDTH×HEIGHT.
 */
export function resolveRectOverlap(id: string, position: Point, size: { readonly w: number; readonly h: number }, siblings: readonly SizedRect[], lowerBound?: Point): Point {
  const clamp = (p: Point): Point => (lowerBound ? { x: Math.max(p.x, lowerBound.x), y: Math.max(p.y, lowerBound.y) } : p);
  let current = clamp(position);
  for (let pass = 0; pass < 32; pass++) {
    let moved = false;
    for (const sibling of siblings) {
      if (sibling.id === id) continue;
      const hit = intersection(paddedRect(current, size.w, size.h), paddedRect(sibling.position, sibling.w, sibling.h));
      if (!hit) continue;
      moved = true;
      if (hit.overlapX < hit.overlapY) {
        current = { x: current.x + (current.x < sibling.position.x ? -hit.overlapX : hit.overlapX), y: current.y };
      } else {
        current = { x: current.x, y: current.y + (current.y < sibling.position.y ? -hit.overlapY : hit.overlapY) };
      }
      current = clamp(current);
    }
    if (!moved) return current;
  }
  return clamp(scanClearSlot(id, current, size, siblings, clamp));
}

/**
 * Pushes `position` off every sibling so two cards never share pixels (plus
 * `NODE_GAP`). If the local push still collides — a packed cluster — scans
 * right then down from the drop point for the first free slot.
 *
 * Sibling entries may carry `w`/`h` (e.g. the 28px Schedule tick disc);
 * missing sizes default to a full card. `selfSize` does the same for the
 * node being resolved.
 *
 * `lowerBound`, when given, re-clamps after every push so a block just
 * attached to a container cannot be shoved above/left of the trigger.
 */
export function resolveSiblingOverlap(
  id: string,
  position: Point,
  siblings: readonly { readonly id: string; readonly position: Point; readonly w?: number; readonly h?: number }[],
  lowerBound?: Point,
  selfSize?: { readonly w: number; readonly h: number },
): Point {
  return resolveRectOverlap(
    id,
    position,
    selfSize ?? { w: NODE_WIDTH, h: NODE_HEIGHT },
    siblings.map((sibling) => ({
      id: sibling.id,
      position: sibling.position,
      w: sibling.w ?? NODE_WIDTH,
      h: sibling.h ?? NODE_HEIGHT,
    })),
    lowerBound,
  );
}

function scanClearSlot(
  id: string,
  origin: Point,
  size: { readonly w: number; readonly h: number },
  siblings: readonly SizedRect[],
  clamp: (p: Point) => Point,
): Point {
  const stepX = size.w + NODE_GAP;
  const stepY = size.h + NODE_GAP;
  for (let row = 0; row < 48; row++) {
    for (let col = 0; col < 16; col++) {
      const candidate = clamp({ x: origin.x + col * stepX, y: origin.y + row * stepY });
      const blocked = siblings.some(
        (sibling) => sibling.id !== id && intersection(paddedRect(candidate, size.w, size.h), paddedRect(sibling.position, sibling.w, sibling.h)) !== null,
      );
      if (!blocked) return candidate;
    }
  }
  return origin;
}

/**
 * Finds the container whose rectangle contains `position`'s center — used to
 * detect "this block was just dropped into that dashed box", the gesture
 * `ProcessingGraphScreen` turns into a real edge (trigger/chain-tail -> this
 * block) rather than treating the drop itself as membership.
 */
export function containerAtPosition<C extends { readonly triggerId?: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number }>(
  position: Point,
  containers: readonly C[],
  excludeIds?: ReadonlySet<string>,
): C | undefined {
  const centerX = position.x + NODE_WIDTH / 2;
  const centerY = position.y + NODE_HEIGHT / 2;
  const hits = containers.filter((c) => {
    if (excludeIds && c.triggerId && excludeIds.has(c.triggerId)) return false;
    return centerX >= c.x && centerX <= c.x + c.width && centerY >= c.y && centerY <= c.y + c.height;
  });
  if (hits.length === 0) return undefined;
  return [...hits].sort((a, b) => a.width * a.height - b.width * b.height)[0];
}
