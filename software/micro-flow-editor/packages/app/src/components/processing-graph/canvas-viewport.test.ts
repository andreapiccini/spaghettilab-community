import { expect, it } from "vitest";
import { saveCanvasViewport, savedCanvasViewport } from "./canvas-viewport.js";

it("restores the exact viewport after leaving and returning to a canvas", () => {
  const project = {};
  const view = { x: -320, y: 170, zoom: 1.25 };
  expect(savedCanvasViewport(project, "master")).toBeUndefined();
  saveCanvasViewport(project, "master", view);
  expect(savedCanvasViewport(project, "master")).toEqual(view);
  view.x = 0;
  expect(savedCanvasViewport(project, "master")?.x).toBe(-320);
});

it("keeps different Backbones and newly opened projects independent", () => {
  const project = {};
  saveCanvasViewport(project, "master", { x: 100, y: 200, zoom: 0.8 });
  saveCanvasViewport(project, "peer", { x: -10, y: -30, zoom: 1.2 });
  expect(savedCanvasViewport(project, "master")).toEqual({ x: 100, y: 200, zoom: 0.8 });
  expect(savedCanvasViewport(project, "peer")).toEqual({ x: -10, y: -30, zoom: 1.2 });
  expect(savedCanvasViewport({}, "master")).toBeUndefined();
});
