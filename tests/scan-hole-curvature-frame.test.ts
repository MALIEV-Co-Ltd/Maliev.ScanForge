import * as eigenSolver from "../src/scan-native-alignment-eigen";
import { expect, it, vi } from "vitest";
import { nativeCurvatureFrame } from "../src/scan-hole-curvature-frame";

const rectangle = [
  [-2, -1, 3],
  [2, -1, 3],
  [2, 1, 3],
  [-2, 1, 3],
];
const normals = rectangle.map(() => [0, 0, 1]);
const dot = (a: readonly number[], b: readonly number[]) =>
  a.reduce((sum, v, i) => sum + v * b[i], 0);

it("fits an orthonormal graph frame with the native ten-percent margin", () => {
  const frame = nativeCurvatureFrame(rectangle, normals);
  expect(frame.center).toEqual([0, 0, 3]);
  expect(dot(frame.z, [0, 0, 1])).toBe(1);
  expect([frame.halfU, frame.halfV].sort((a, b) => a - b)).toEqual([1.1, 2.2]);
  for (const axis of [frame.x, frame.y, frame.z])
    expect(dot(axis, axis)).toBeCloseTo(1, 14);
  expect(Math.abs(dot(frame.x, frame.y))).toBeLessThan(1e-14);
  expect(Math.abs(dot(frame.x, frame.z))).toBeLessThan(1e-14);
  expect(Math.abs(dot(frame.y, frame.z))).toBeLessThan(1e-14);
});

it("retains the plane orientation supplied by source normals", () => {
  const frame = nativeCurvatureFrame(
    rectangle,
    normals.map(() => [0, 0, -1]),
  );
  expect(dot(frame.z, [0, 0, -1])).toBe(1);
  expect(frame.center).toEqual([0, 0, 3]);
});

it("uses the same bounds for an oblique translated rectangle", () => {
  const x = [0.8, 0.6, 0];
  const y = [-0.36, 0.48, 0.8];
  const z = [0.48, -0.64, 0.6];
  const center = [7, -11, 5];
  const points = rectangle.map(([u, v]) =>
    center.map((c, i) => c + u * x[i] + v * y[i]),
  );
  const before = points.map((p) => [...p]);
  const frame = nativeCurvatureFrame(
    points,
    points.map(() => z),
  );
  for (let axis = 0; axis < 3; axis++)
    expect(frame.center[axis]).toBeCloseTo(center[axis], 12);
  expect(dot(frame.z, z)).toBeCloseTo(1, 13);
  expect(frame.halfU * frame.halfV).toBeCloseTo(2.42, 12);
  expect(points).toEqual(before);
});

it("rejects invalid, degenerate and cancelled fitting without publishing a frame", () => {
  expect(() => nativeCurvatureFrame([], [])).toThrow(/plane|collar/i);
  expect(() => nativeCurvatureFrame(rectangle, [[0, 0, 1]])).toThrow(
    /normal|matching/i,
  );
  expect(() =>
    nativeCurvatureFrame([[NaN, 0, 0], ...rectangle], [[0, 0, 1], ...normals]),
  ).toThrow(/finite/i);
  expect(() =>
    nativeCurvatureFrame(
      [
        [0, 0, 3],
        [1, 0, 3],
        [2, 0, 3],
      ],
      [
        [0, 0, 1],
        [0, 0, 1],
        [0, 0, 1],
      ],
    ),
  ).toThrow(/plane|degenerate/i);
  expect(() =>
    nativeCurvatureFrame(rectangle, normals, () => {
      throw new DOMException("Cancelled", "AbortError");
    }),
  ).toThrow(/Cancelled/);
});

it("uses the finite Jacobi fallback when the primary eigen solver rejects", () => {
  const original = eigenSolver.nativeAlignmentEigen3;
  const spy = vi
    .spyOn(eigenSolver, "nativeAlignmentEigen3")
    .mockImplementation((...args) => ({
      ...original(...args),
      accepted: false,
    }));
  try {
    const frame = nativeCurvatureFrame(rectangle, normals);
    expect(frame.center).toEqual([0, 0, 3]);
    expect([frame.halfU, frame.halfV].sort((a, b) => a - b)).toEqual([
      1.1, 2.2,
    ]);
  } finally {
    spy.mockRestore();
  }
});
