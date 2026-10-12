import { expect, it } from "vitest";
import { Vector3 } from "three";
import { scanClipPlanes } from "../src/scan-clip-box";
it("clips each of six faces independently while preserving interior and boundary", () => {
  const planes = scanClipPlanes({ min: [-1, -2, -3], max: [1, 2, 3] });
  expect(
    planes.every((plane) => plane.distanceToPoint(new Vector3(0, 0, 0)) >= 0),
  ).toBe(true);
  for (let axis = 0; axis < 3; axis++)
    for (const sign of [-1, 1]) {
      const point = new Vector3().setComponent(axis, sign * (axis + 1 + 0.1));
      expect(
        planes.filter((plane) => plane.distanceToPoint(point) < 0),
      ).toHaveLength(1);
    }
  expect(
    planes.every((plane) => plane.distanceToPoint(new Vector3(1, 2, 3)) >= 0),
  ).toBe(true);
  expect(() => scanClipPlanes({ min: [0, 0, 0], max: [-1, 1, 1] })).toThrow();
  expect(() => scanClipPlanes({ min: [NaN, 0, 0], max: [1, 1, 1] })).toThrow();
});
