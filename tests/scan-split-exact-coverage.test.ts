import { expect, it } from "vitest";
import { exactSplitCoverage } from "../src/scan-split-exact-coverage";
import type { Vec3 } from "../src/types";

it("accepts exact coverage and rejects missing or displaced triangles", () => {
  const vertices: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0.25, 0.25, 0],
  ];
  const triangles: [number, number, number][] = [
    [0, 1, 3],
    [1, 2, 3],
    [2, 0, 3],
  ];
  const check = () => {};
  expect(
    exactSplitCoverage(vertices, triangles, [0, 1, 2], (x) => x, check),
  ).toBe(true);
  expect(
    exactSplitCoverage(
      vertices,
      triangles.slice(1),
      [0, 1, 2],
      (x) => x,
      check,
    ),
  ).toBe(false);
  const displaced: Vec3[] = [...vertices, [0.25, 0.25, 1e-14]];
  expect(
    exactSplitCoverage(
      displaced,
      [
        [0, 1, 3],
        [1, 2, 4],
        [2, 0, 3],
      ],
      [0, 1, 2],
      (x) => x,
      check,
    ),
  ).toBe(false);
});

it("honors output rounding and interruption", () => {
  const vertices: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
    [0.25, 0.25, 0],
    [0.25, 0.25, 1e-50],
  ];
  const triangles: [number, number, number][] = [
    [0, 1, 3],
    [1, 2, 4],
    [2, 0, 3],
  ];
  expect(
    exactSplitCoverage(vertices, triangles, [0, 1, 2], Math.fround, () => {}),
  ).toBe(true);
  expect(() =>
    exactSplitCoverage(
      vertices,
      triangles,
      [0, 1, 2],
      (x) => x,
      () => {
        throw Error("cancelled");
      },
    ),
  ).toThrow("cancelled");
});
