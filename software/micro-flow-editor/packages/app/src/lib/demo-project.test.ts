import { describe, expect, it } from "vitest";
import { buildDryRunPreviewChannels } from "../components/processing-graph/dry-run-preview.js";
import { buildDemoProject, DEMO_LED_PERIOD_MS } from "./demo-project.js";

describe("buildDemoProject", () => {
  it("wires Schedule → Digital Out Toggle → LED for Dry-run preview", () => {
    const project = buildDemoProject("Demo");
    expect(project).not.toBeNull();
    const graph = project!.deviceGraphs[0]!;
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(["demo-led", "demo-schedule", "demo-toggle"]);
    expect(buildDryRunPreviewChannels(graph)).toEqual([
      {
        triggerId: "demo-schedule",
        periodMs: DEMO_LED_PERIOD_MS,
        highTicks: 1,
        lowTicks: 1,
        initialHigh: true,
        toggleIds: ["demo-toggle"],
        startIds: [],
        actuators: [
          {
            id: "demo-led",
            threshold: 50,
            negated: false,
            delayOnMs: 0,
            delayOffMs: 0,
            softOnMs: 0,
            softOffMs: 0,
          },
        ],
      },
    ]);
    const led = graph.nodes.find((n) => n.id === "demo-led");
    expect(led?.data).toMatchObject({ kind: "block", catalogEntryId: "appblocks.led" });
    expect(project!.authoringMetadata["demo-led"]?.comment).toBe("LED");
  });
});
