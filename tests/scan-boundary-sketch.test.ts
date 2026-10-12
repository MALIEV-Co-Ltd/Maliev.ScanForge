import { expect, it } from "vitest";
import { boundarySketches } from "../src/scan-boundary-sketch";
import { sketchWorldPoint } from "../src/sketch-frame";
it("creates an editable closed graph on an offset origin plane without duplicate end IDs", () => {
  const result = boundarySketches(
    [[0, 0, 5, 10, 0, 5, 10, 10, 5, 0, 10, 5, 0, 0, 5]],
    { origin: [0, 0, 5], normal: [0, 0, 1] },
    "Projected",
    () => "fixture",
  )[0];
  expect(result.sketch.points).toHaveLength(4);
  expect(result.sketch.segments).toHaveLength(4);
  expect(result.sketch.segments.at(-1)?.b).toBe(result.sketch.points[0].id);
  for (const point of result.sketch.points)
    expect(sketchWorldPoint(result.sketch.frame!, [point.x, point.y])[2]).toBe(
      5,
    );
});
it("preserves open chains and rejects incomplete or nonplanar curves", () => {
  expect(
    boundarySketches(
      [[0, 0, 0, 1, 0, 0, 2, 1, 0]],
      { origin: [0, 0, 0], normal: [0, 0, 1] },
      "Open",
    )[0].sketch.segments,
  ).toHaveLength(2);
  expect(() =>
    boundarySketches(
      [[0, 0, 0, 1, 0, 2]],
      { origin: [0, 0, 0], normal: [0, 0, 1] },
      "Bad",
    ),
  ).toThrow("plane");
  expect(() =>
    boundarySketches(
      [[0, 0, 0, 1, 0, 0, 2]],
      { origin: [0, 0, 0], normal: [0, 0, 1] },
      "Bad",
    ),
  ).toThrow("XYZ");
});
