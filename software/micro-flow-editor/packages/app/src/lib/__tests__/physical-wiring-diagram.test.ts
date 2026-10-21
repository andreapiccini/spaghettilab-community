import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PhysicalWiringDiagram } from "../../components/physical-composition/PhysicalWiringDiagram.js";
import { catalogUln2003Driver } from "../gpio-driver-presets.js";
import { draftToCanvasSensorRecipes } from "../device-recipe-draft.js";
const state = vi.hoisted(() => ({ modules: [] as unknown[] }));
vi.mock("../../state/session-context.js", () => ({
  useSession: () => ({
    session: {
      stack: {
        current: {
          authoringMetadata: {
            __backboneSensorModules: {
              comment: JSON.stringify({
                version: 1,
                byBinding: { core: state.modules },
              }),
            },
          },
        },
      },
    },
  }),
}));
const render = (variant: "v1" | "v2", modes: number[]) =>
  renderToStaticMarkup(
    createElement(PhysicalWiringDiagram, {
      variant,
      modes,
      bindingId: "core",
      boardKey: "core:board",
      disabled: false,
      pendingSignal: null,
      signals: [],
      it: true,
      onAssign: () => {},
      onClear: () => {},
    }),
  );

describe("physical wiring", () => {
  it("shows only the empty connector, with the correct rails for each revision", () => {
    state.modules = [];
    const v1 = render("v1", [0, 0, 0, 0]);
    const v2 = render("v2", Array(8).fill(0));
    expect(v1).not.toContain("<table");
    expect(v2).not.toContain("<table");
    expect(v1).not.toContain("3.3V");
    expect(v2).toContain("3.3V");
    expect(v2).toContain("A7");
  });
  it("draws assigned GPIO modules and power, excluding modules on other boards", () => {
    const recipe = draftToCanvasSensorRecipes(catalogUln2003Driver())[0];
    state.modules = [
      {
        id: "motor",
        label: "Stepper ULN2003",
        bus: "gpio",
        recipe,
        gpioAssignments: {
          boardKey: "core:board",
          channels: { in1: 0, in2: 1, in3: 2, in4: 3 },
        },
      },
    ];
    const svg = render("v2", [2, 2, 2, 2, 0, 0, 0, 0]);
    expect(svg).toContain("Stepper ULN2003");
    expect(svg).toContain("VCC");
    expect(svg).toContain("<table");
    state.modules = [
      {
        ...(state.modules[0] as object),
        gpioAssignments: { boardKey: "core:other", channels: { in1: 0 } },
      },
    ];
    expect(render("v2", [2, 0, 0, 0, 0, 0, 0, 0])).not.toContain("Stepper ULN2003");
  });
  it("shows configured bus signals before a named module is associated", () => {
    state.modules = [];
    const svg = render("v1", [4, 5, 0, 0]);
    expect(svg).toContain("SDA");
    expect(svg).toContain("SCL");
    expect(svg).toContain("Pin 2 · SDA");
    expect(svg).toContain("Pin 3 · SCL");
  });
});
