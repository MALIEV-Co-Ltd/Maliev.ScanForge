import { expect, it } from "vitest";
import { activeToolGuidance } from "../src/ui/tool-guidance";
const base = { mode: "inspect" as const };
it("uses active picking and processing state ahead of the underlying edit mode", () => {
  expect(
    activeToolGuidance({ ...base, busy: true, planePicking: true }),
  ).toContain("input paused");
  expect(activeToolGuidance({ ...base, planePicking: true })).toContain(
    "Left-click creates sketch",
  );
  expect(activeToolGuidance({ ...base, reference: "cylinder" })).toContain(
    "Left-click picks cylinder",
  );
  expect(activeToolGuidance({ ...base, landmarkSide: "fixed" })).toContain(
    "adds fixed landmark",
  );
  expect(
    activeToolGuidance({
      ...base,
      landmarkSide: "moving",
      landmarkPreview: true,
    }),
  ).toContain("Choose moving/fixed picking");
});
for (const [tool, action] of [
  ["brush", "filled selection"],
  ["freehand", "along stroke"],
  ["line", "straight selection stroke"],
  ["rectangle", "selection rectangle"],
  ["circle", "selection circle"],
  ["wand", "curvature region"],
] as const)
  it(`describes ${tool} selection controls and modifiers`, () => {
    const hint = activeToolGuidance({
      mode: "brush",
      brushActive: true,
      selectionTool: tool,
      selectThrough: true,
    });
    expect(hint).toContain(action);
    expect(hint).toContain("Alt subtracts");
    expect(hint).toContain("Select through enabled");
    expect(hint).toContain("Right-click opens tools menu");
    expect(hint.includes("Ctrl+wheel")).toBe(
      ["brush", "freehand", "line"].includes(tool),
    );
  });
it("does not advertise painting when mesh editing is disabled", () => {
  expect(
    activeToolGuidance({ mode: "brush", brushActive: false }),
  ).not.toContain("Alt subtracts");
  expect(
    activeToolGuidance({ mode: "brush", brushActive: true, subtract: true }),
  ).toContain("Subtract mode");
  expect(
    activeToolGuidance({
      mode: "brush",
      brushActive: false,
      panel: "boundaries",
    }),
  ).toContain("boundary loop in panel");
});
for (const [tool, action] of [
  ["line", "draws line"],
  ["move", "moves an endpoint"],
  ["circle", "sets radius"],
  ["circle3", "three points"],
  ["arc3", "through point"],
] as const)
  it(`describes ${tool} sketch authoring and cancellation`, () => {
    const hint = activeToolGuidance({ ...base, sketchTool: tool });
    expect(hint).toContain(action);
    expect(hint).toContain("Right-click or Escape");
    expect(hint).not.toContain("Left/middle-drag orbits");
  });
it("describes measurement, section position, and parameters without claiming nonexistent canvas actions", () => {
  expect(activeToolGuidance({ mode: "measure" })).toContain(
    "Next click starts new measurement",
  );
  expect(
    activeToolGuidance({
      mode: "section",
      sectionAxis: "X",
      sectionOffset: "12.5",
    }),
  ).toContain("X section · 12.5 mm");
  expect(
    activeToolGuidance({ ...base, parameterTool: "Reduce noise" }),
  ).toContain("Reduce noise:");
  expect(
    activeToolGuidance({ ...base, previewAuthoring: "surface" }),
  ).toContain("Adjust surface settings in panel");
});
