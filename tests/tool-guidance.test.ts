import { expect, it } from "vitest";
import {
  activeToolGuidance,
  compactToolGuidance,
} from "../src/ui/tool-guidance";
const base = { mode: "inspect" as const };
it("keeps visible hints brief while preserving active command precedence", () => {
  expect(compactToolGuidance(base)).toBe(
    "Select an object · Right-click for tools",
  );
  expect(
    compactToolGuidance({ ...base, parameterTool: "Reduce polygons" }),
  ).toBe("Reduce polygons · Preview → Accept");
  expect(
    compactToolGuidance({
      ...base,
      busy: true,
      parameterTool: "Reduce polygons",
    }),
  ).toBe("Processing · Cancel to stop");
  expect(
    compactToolGuidance({
      ...base,
      reference: "plane",
      parameterTool: "Reduce polygons",
    }),
  ).toBe("Left-click picks planar reference");
  expect(
    compactToolGuidance({
      mode: "brush",
      brushActive: true,
      selectionTool: "rectangle",
      selectThrough: true,
    }),
  ).toBe("Left-drag draws selection rectangle");
  expect(
    compactToolGuidance({
      mode: "section",
      sectionAxis: "X",
      sectionOffset: "12.5",
    }),
  ).toBe("X section · 12.5 mm");
});
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
  expect(activeToolGuidance({ ...base, landmarkAlignment: true })).toContain(
    "fixed points",
  );
  expect(
    activeToolGuidance({
      ...base,
      landmarkAlignment: true,
    }),
  ).toContain("deselect");
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
    expect(hint).not.toContain("Right-click opens tools menu");
    expect(hint).not.toContain("orbits");
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
  ["trim", "paints unwanted intervals"],
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
  ).toContain("Preview checks result · Accept completes");
  expect(
    activeToolGuidance({ ...base, parameterTool: "Flip normals" }),
  ).toContain("Apply completes");
  expect(
    activeToolGuidance({ ...base, previewAuthoring: "surface" }),
  ).toContain("Adjust surface settings in panel");
});

it("shows general navigation only without an active command", () => {
  expect(activeToolGuidance(base)).toContain("Middle-drag orbits");
  const hint = activeToolGuidance({
    ...base,
    parameterTool: "Reduce polygons",
  });
  expect(hint).toContain("Preview checks result");
  expect(hint).not.toContain("selects object");
  expect(hint).not.toContain("orbits");
});

it("shows Interactive handle and cancellation guidance instead of ordinary selection instructions", () => {
  const context = { mode: "inspect" as const, interactiveAlignment: true };
  expect(activeToolGuidance(context)).toContain("Left-drag a handle");
  expect(activeToolGuidance(context)).toContain("Escape cancels");
  expect(activeToolGuidance(context)).not.toContain("Right-click opens tools");
  expect(compactToolGuidance(context)).toBe(
    "Left-drag handles · Escape cancels",
  );
});

it("keeps both canvas roles and readable separators in the landmark hint", () => {
  const hint = activeToolGuidance({ mode: "inspect", landmarkAlignment: true });
  expect(hint).toContain("Top-right: pick fixed points");
  expect(hint).toContain("Bottom-right: pick moving points");
  expect(hint).not.toContain(String.fromCodePoint(0xfffd));
});
