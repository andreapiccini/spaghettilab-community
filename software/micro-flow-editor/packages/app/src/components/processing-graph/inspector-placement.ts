export type RectLike = {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
};

const GAP = 14;
const PAD = 10;

/**
 * Place the demo settings card next to a block without covering it, so color /
 * HIGH-LOW / open-closed updates stay visible while the inspector is open.
 */
export function placeInspectorAwayFromTarget(
  target: RectLike,
  size: { readonly width: number; readonly height: number },
  viewport: { readonly width: number; readonly height: number },
  options?: { readonly preferSide?: boolean },
): { readonly left: number; readonly top: number } {
  const vw = viewport.width;
  const vh = viewport.height;
  const w = size.width;
  const h = size.height;

  const clampLeft = (left: number) => Math.max(PAD, Math.min(Math.max(PAD, vw - w - PAD), left));
  const clampTop = (top: number) => Math.max(PAD, Math.min(Math.max(PAD, vh - h - PAD), top));
  const centeredLeft = clampLeft(target.left + target.width / 2 - w / 2);

  const below = { left: centeredLeft, top: target.bottom + GAP };
  const above = { left: centeredLeft, top: target.top - h - GAP };
  const right = { left: target.right + GAP, top: clampTop(target.top) };
  const left = { left: target.left - w - GAP, top: clampTop(target.top) };
  const preferSide = options?.preferSide === true || target.height > 80;
  const candidates = preferSide ? [right, left, below, above] : [below, above, right, left];

  function overlaps(box: { left: number; top: number }): boolean {
    const right = box.left + w;
    const bottom = box.top + h;
    return !(right <= target.left - 4 || box.left >= target.right + 4 || bottom <= target.top - 4 || box.top >= target.bottom + 4);
  }

  function inView(box: { left: number; top: number }): boolean {
    return box.left >= PAD - 1 && box.top >= PAD - 1 && box.left + w <= vw - PAD + 1 && box.top + h <= vh - PAD + 1;
  }

  for (const candidate of candidates) {
    const box = { left: clampLeft(candidate.left), top: clampTop(candidate.top) };
    if (inView(box) && !overlaps(box)) return box;
  }

  const bottom = { left: centeredLeft, top: clampTop(vh - h - PAD) };
  if (!overlaps(bottom)) return bottom;
  const sideLeft = target.right + GAP <= vw - w - PAD ? target.right + GAP : target.left - w - GAP;
  return { left: clampLeft(sideLeft), top: bottom.top };
}
