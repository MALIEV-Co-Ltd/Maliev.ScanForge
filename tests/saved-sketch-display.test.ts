import { expect, it } from "vitest";
import {
  createSavedSketchDisplay,
  validateSavedSketchDisplay,
} from "../src/saved-sketch-display";
import type { SavedSketch } from "../src/types";
it("renders a saved line in its exact frame without activating an edit session", () => {
  const saved: SavedSketch = {
    id: "seam",
    name: "Sketch",
    visible: true,
    sketch: {
      version: 1,
      frame: {
        origin: [100000000, 2, 3],
        u: [0, 1, 0],
        v: [-1, 0, 0],
        normal: [0, 0, 1],
      },
      points: [
        { id: "a", x: 4 * Math.PI, y: 0 },
        { id: "b", x: 4 * Math.PI, y: 1 },
      ],
      segments: [{ id: "line", a: "a", b: "b" }],
      constraints: [],
    },
  };
  const display = createSavedSketchDisplay(saved);
  expect(display.type).toBe("LineSegments");
  expect(display.position.toArray()).toEqual([100000000, 2, 3]);
  expect(Array.from(display.geometry.getAttribute("position").array)).toEqual([
    0,
    Math.fround(4 * Math.PI),
    0,
    -1,
    Math.fround(4 * Math.PI),
    0,
  ]);
  expect(display.userData.sketchId).toBe(saved.id);
  display.geometry.dispose();
  display.material.dispose();
});
it("rejects out-of-world display coordinates before a visibility change is published", () => {
  expect(() =>
    validateSavedSketchDisplay({
      id: "bad",
      name: "Bad",
      visible: true,
      sketch: {
        version: 1,
        points: [
          { id: "a", x: 2e9, y: 0 },
          { id: "b", x: 2e9, y: 1 },
        ],
        segments: [{ id: "line", a: "a", b: "b" }],
        constraints: [],
      },
    }),
  ).toThrow(/world|bound|coordinate/i);
});
