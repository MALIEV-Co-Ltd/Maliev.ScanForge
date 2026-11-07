import { expect, it } from "vitest";
import fixture from "./fixtures/hole-fill-observed-curvature-annulus.json";
import {
  nativeThinPlateField,
  nativeCurvatureCollar,
} from "../src/scan-hole-curvature-field";
import { analyzeIndexedMesh } from "../src/mesh-processing";

const support = fixture.source.vertices.filter(
  ([x, y]) => Math.hypot(x, y) < 3.000001,
);

it("reconstructs the native annulus central height from its two-pass collar", () => {
  expect(support).toHaveLength(192);
  const field = nativeThinPlateField(support);
  const nativeCenter = fixture.native.vertices.reduce((best, point) =>
    Math.hypot(point[0], point[1]) < Math.hypot(best[0], best[1])
      ? point
      : best,
  );
  expect(Math.hypot(nativeCenter[0], nativeCenter[1])).toBeLessThan(1e-6);
  expect(Math.abs(field.evaluate(0, 0) - nativeCenter[2])).toBeLessThan(1e-8);
  for (const [x, y, z] of support)
    expect(Math.abs(field.evaluate(x, y) - z)).toBeLessThan(1e-8);
});

it("preserves the same field after a translated and rotated graph frame", () => {
  const angle = 0.37,
    cosine = Math.cos(angle),
    sine = Math.sin(angle);
  const original = nativeThinPlateField(support);
  const transformed = nativeThinPlateField(
    support.map(([x, y, z]) => [
      cosine * x - sine * y + 7,
      sine * x + cosine * y - 11,
      z + 3,
    ]),
  );
  for (const [x, y] of [
    [0, 0],
    [0.7, -0.4],
    [-1.2, 0.3],
  ])
    expect(
      Math.abs(
        transformed.evaluate(
          cosine * x - sine * y + 7,
          sine * x + cosine * y - 11,
        ) -
          3 -
          original.evaluate(x, y),
      ),
    ).toBeLessThan(1e-7);
});

it("rejects a singular projected collar instead of returning an invented field", () => {
  expect(() =>
    nativeThinPlateField([
      [0, 0, 0],
      [0, 0, 1],
      [1, 0, 0],
      [0, 1, 0],
    ]),
  ).toThrow(/singular|coincident/i);
});

it("checks cancellation before starting the dense solve", () => {
  expect(() =>
    nativeThinPlateField(support, {
      check: () => {
        throw new DOMException("Cancelled", "AbortError");
      },
    }),
  ).toThrow(/Cancelled/);
});

it("owns its sample coordinates after fitting", () => {
  const points = support.map((point) => [...point]);
  const before = points.map((point) => [...point]);
  const field = nativeThinPlateField(points);
  const height = field.evaluate(0, 0);
  expect(points).toEqual(before);
  points[0][0] += 100;
  expect(field.evaluate(0, 0)).toBe(height);
});

it("rejects an over-budget dense field before reading its sample coordinates", () => {
  const points = new Array(10000).fill(null) as unknown as number[][];
  expect(() => nativeThinPlateField(points)).toThrow(/resource budget/);
});

it("takes the native two-pass face collar in original vertex order", () => {
  const topology = analyzeIndexedMesh(
    Float64Array.from(fixture.source.vertices.flat()),
    Uint32Array.from(fixture.source.faces.flat()),
  );
  const boundary = topology.boundaryLoops.find((loop) =>
    loop.every(
      (id) =>
        Math.hypot(topology.vertices[id * 3], topology.vertices[id * 3 + 1]) <
        2.01,
    ),
  )!;
  const before = topology.vertices.slice();
  const collar = nativeCurvatureCollar(topology, boundary);
  expect(collar.faces).toHaveLength(192);
  expect(collar.vertices).toEqual(support);
  expect(collar.indices).toEqual(
    fixture.source.vertices.flatMap(([x, y], i) =>
      Math.hypot(x, y) < 3.000001 ? [i] : [],
    ),
  );
  expect(topology.vertices).toEqual(before);
  expect(
    Math.abs(
      nativeThinPlateField(collar.vertices).evaluate(0, 0) -
        0.0034996371250599623,
    ),
  ).toBeLessThan(1e-8);
});

it("rejects a collar request that is not an exposed closed boundary", () => {
  const topology = analyzeIndexedMesh(
    Float64Array.from(fixture.source.vertices.flat()),
    Uint32Array.from(fixture.source.faces.flat()),
  );
  expect(() => nativeCurvatureCollar(topology, [0, 1, 2])).toThrow(
    /exposed closed boundary/,
  );
});
