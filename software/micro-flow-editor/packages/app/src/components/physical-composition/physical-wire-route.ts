import type { Point } from "../processing-graph/orthogonal-route.js";

/** Leave each contact sideways into the gap between columns before going
 * above/below its row. This avoids both the opposite row and pin captions. */
export function physicalWirePoints(start: Point, end: Point, laneX: number, lane: number, upperRow: boolean): Point[] {
  const escapeX = start.x + 20;
  const laneY = upperRow ? 8 - lane * 12 : 220 + lane * 12;
  return [start, { x: escapeX, y: start.y }, { x: escapeX, y: laneY },
    { x: laneX, y: laneY }, { x: laneX, y: end.y }, end];
}
