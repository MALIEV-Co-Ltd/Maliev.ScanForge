import { expect, it } from "vitest";
import { createFittedPlane } from "../src/primitive-fitting";
import { validatePlaneFrame } from "../src/plane-frame";
it("retains small fitted-plane extents and fit metadata at a large translated origin", () => {
  const fit = {
    kind: "plane" as const,
    center: [100000000.125, -20, 30] as [number, number, number],
    axis: [0, 0, 1] as [number, number, number],
    rms: 0,
    maxError: 0,
  };
  const plane = createFittedPlane(fit, 0.125);
  expect(Array.isArray(plane.positions)).toBe(true);
  expect(Math.min(...plane.positions.filter((_, i) => i % 3 === 0))).toBe(
    100000000.0625,
  );
  expect(Math.max(...plane.positions.filter((_, i) => i % 3 === 0))).toBe(
    100000000.1875,
  );
  expect(plane.planeFrame!.center).toEqual(fit.center);
  expect(plane.planeFrame!.normal).toEqual(fit.axis);
  expect(plane.fit).toEqual(fit);
  expect(plane.fit).not.toBe(fit);
  expect(() =>
    validatePlaneFrame(plane.planeFrame, plane.positions, plane.kind),
  ).not.toThrow();
});
