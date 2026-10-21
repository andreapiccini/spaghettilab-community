import { expect, it } from "vitest";
import { physicalWirePoints } from "./physical-wire-route.js";
it("routes 3.3 V above the connector instead of through the 5 V contact", () => {
 const points=physicalWirePoints({x:262,y:100},{x:574,y:152},330,0,true);
 expect(points[1]).toEqual({x:282,y:100});
 expect(points[2]!.y).toBeLessThan(35);
 expect(points.slice(1,3).every(point=>point.x!==262)).toBe(true);
 expect(points.at(-1)).toEqual({x:574,y:152});
});
it("leaves bottom-row pins through column gaps, away from their labels", () => {
 const points=physicalWirePoints({x:182,y:148},{x:574,y:96},350,2,false);
 expect(points[1]).toEqual({x:202,y:148});
 expect(points[2]!.y).toBeGreaterThan(189);
 expect(points[2]!.x).not.toBe(182);
});
it("keeps all six upper-row escape lanes separate from contact and caption columns", () => {
 const columns=[62,102,142,182,222,262];
 for(const [i,x] of columns.entries()){
  const points=physicalWirePoints({x,y:100},{x:574,y:96+i*28},330+i*16,i,true);
  expect(columns.every(column=>Math.abs(points[1]!.x-column)>=20)).toBe(true);
  expect(points[2]!.y).toBe(8-i*12);
  for(let j=1;j<points.length;j++)expect(points[j]!.x===points[j-1]!.x||points[j]!.y===points[j-1]!.y).toBe(true);
 }
});
