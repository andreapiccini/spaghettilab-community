import { describe, expect, it } from "vitest";
import {
  isVisitorDemoTourForced,
  parseVisitorDemoTourSeen,
  VISITOR_DEMO_TOUR_STEPS,
} from "../visitor-demo-tour.js";

describe("visitor demo tour", () => {
  it("has first-visit steps with live targets", () => {
    expect(VISITOR_DEMO_TOUR_STEPS.map((step) => step.target)).toEqual([
      "flow-node-demo-schedule",
      "flow-node-demo-backbone",
      "demo-tour-inspector",
      "demo-tour-run",
      "demo-tour-add",
    ]);
    expect(VISITOR_DEMO_TOUR_STEPS[0]?.title).toBe("Firmware functions");
  });

  it("treats only 1 as seen", () => {
    expect(parseVisitorDemoTourSeen("1")).toBe(true);
    expect(parseVisitorDemoTourSeen("0")).toBe(false);
    expect(parseVisitorDemoTourSeen(null)).toBe(false);
  });

  it("replays when ?demo-tour=1", () => {
    expect(isVisitorDemoTourForced("?demo-tour=1")).toBe(true);
    expect(isVisitorDemoTourForced("?demo=1")).toBe(false);
  });
});
