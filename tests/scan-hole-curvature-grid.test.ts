import { expect, it } from "vitest";
import { nativeBasis } from "../src/native-surface-fitting";
import { interpolateNativeCurvatureGrid } from "../src/scan-hole-curvature-grid";
import type { NurbsPatch } from "../src/surfaces";
import reference from "./fixtures/curvature-grid-open-kernel.json";

it("preserves the open kernel endpoint policy and second-direction parameters", () => {
  const { patch } = interpolateNativeCurvatureGrid(reference.grid);
  for (const axis of ["U", "V"] as const) {
    const field = `knots${axis}` as const;
    expect(patch[field]).toHaveLength(reference.patch[field].length);
    expect(
      Math.max(
        ...patch[field].map((value, i) =>
          Math.abs(value - reference.patch[field][i]),
        ),
      ),
    ).toBeLessThan(1e-12);
  }
  expect(patch.points).toHaveLength(reference.patch.points.length);
  expect(
    Math.max(
      ...patch.points.flatMap((point, i) =>
        point.map((value, a) => Math.abs(value - reference.patch.points[i][a])),
      ),
    ),
  ).toBeLessThan(1e-12);
});

function evaluate(patch: NurbsPatch, u: number, v: number) {
  const point = [0, 0, 0];
  for (let i = 0; i < patch.countU; i++)
    for (let j = 0; j < patch.countV; j++) {
      const weight =
        nativeBasis(patch.knotsU, 4, i, u) * nativeBasis(patch.knotsV, 4, j, v);
      for (let axis = 0; axis < 3; axis++)
        point[axis] += weight * patch.points[j * patch.countU + i][axis];
    }
  return point;
}
const plane = () =>
  Array.from({ length: 21 }, (_, x) =>
    Array.from({ length: 21 }, (_, y) => [x, y, 3 * x + 2 * y + 5]),
  );

it("interpolates a plane through the fixed native cubic C2 grid", () => {
  const { patch } = interpolateNativeCurvatureGrid(plane());
  expect([patch.countU, patch.countV, patch.degreeU, patch.degreeV]).toEqual([
    23, 23, 3, 3,
  ]);
  // Endpoint fitting preserves the plane but does not impose exactly linear UV speed.
  for (const {
    uv: [u, v],
    point: expected,
  } of reference.planeSamples) {
    const actual = evaluate(patch, u, v);
    expect(
      Math.hypot(...actual.map((value, axis) => value - expected[axis])),
    ).toBeLessThan(1e-9);
    expect(
      Math.abs(actual[2] - 3 * actual[0] - 2 * actual[1] - 5),
    ).toBeLessThan(1e-9);
  }
});

it("interpolates every curved sample and owns its output controls", () => {
  const grid = Array.from({ length: 21 }, (_, i) =>
    Array.from({ length: 21 }, (_, j) => [
      i / 5,
      j / 5,
      Math.sin(i / 8) * Math.cos(j / 9),
    ]),
  );
  const { patch, parameters } = interpolateNativeCurvatureGrid(grid);
  for (let i = 0; i < 21; i++)
    for (let j = 0; j < 21; j++) {
      const actual = evaluate(patch, parameters.u[i], parameters.v[j]);
      expect(
        Math.hypot(...actual.map((value, axis) => value - grid[i][j][axis])),
      ).toBeLessThan(1e-9);
    }
  const first = [...patch.points[0]];
  grid[0][0][0] = 900;
  expect(patch.points[0]).toEqual(first);
});

it("rejects malformed or collapsed native grids", () => {
  expect(() => interpolateNativeCurvatureGrid([])).toThrow(/21/);
  expect(() =>
    interpolateNativeCurvatureGrid(
      Array.from({ length: 21 }, () =>
        Array.from({ length: 21 }, () => [1, 1, 1]),
      ),
    ),
  ).toThrow(/degenerate/i);
  const invalid = plane();
  invalid[3][7][2] = NaN;
  expect(() => interpolateNativeCurvatureGrid(invalid)).toThrow(/finite/i);
});

it("honors cancellation before interpolation", () => {
  expect(() =>
    interpolateNativeCurvatureGrid(plane(), () => {
      throw new DOMException("Cancelled", "AbortError");
    }),
  ).toThrow(/Cancelled/);
});
