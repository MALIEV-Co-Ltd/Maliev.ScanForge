import { expect, it } from "vitest";
import circleAngle from "./fixtures/m6-native-circle-angle-observed.json";
import sparse from "./fixtures/m6-native-sparse-observed.json";
import { inspectDeviation, inspectSection } from "../src/inspection";
import distance from "./fixtures/m6-native-measurement-observed.json";
import offset from "./fixtures/m6-native-offset-observed.json";
import { measureGeometry } from "../src/inspection";
import { inspectReferenceDeviation } from "../src/inspection-reference";
import type { Entity, Vec3 } from "../src/types";
it("matches native rounded open-plane point/distance annotations within their display precision", () => {
  const result = measureGeometry({
    first: distance.first as Vec3,
    second: distance.second as Vec3,
  });
  expect(Math.abs(result.distance! - distance.distance)).toBeLessThanOrEqual(
    distance.absoluteToleranceMm,
  );
});
it("replays native exported offset-plane source slots and signed palette coordinates", async () => {
  const make = (id: string, positions: number[]): Entity => ({
    id,
    name: id,
    kind: "mesh",
    positions: new Float32Array(positions),
    visible: true,
    color: "#fff",
    opacity: 1,
  });
  const report = await inspectReferenceDeviation(
    make("offset", offset.sourcePositions),
    make("reference", offset.referencePositions),
    {
      maxDistance: offset.displayRangeMm[1],
      tolerance: offset.toleranceMm,
      signed: true,
    },
  );
  expect(report.distances).toEqual([2, 2, 2]);
  expect(report.referenceTriangles).toEqual([0, 0, 0]);
  report.distances.forEach((value, i) =>
    expect(
      Math.abs(
        value! / (offset.displayRangeMm[1] - offset.displayRangeMm[0]) +
          0.5 -
          offset.paletteUV[i][0],
      ),
    ).toBeLessThanOrEqual(offset.absoluteToleranceMm),
  );
  expect(report).toMatchObject({
    rms: 2,
    mean: 2,
    minimum: 2,
    maximum: 2,
    coverage: 1,
    withinTolerance: 0,
  });
});

it("matches native sparse-cloud extrema against the identical typed-in plane", () => {
  const source: Entity = {
    id: "sparse",
    name: "sparse",
    kind: "pointcloud",
    positions: new Float32Array(sparse.points.flat()),
    visible: true,
    color: "#fff",
    opacity: 1,
  };
  const report = inspectDeviation(
    source,
    { kind: "plane", center: [0, 0, 0], axis: [0, 0, 1], rms: 0, maxError: 0 },
    sparse.toleranceMm,
  );
  expect(Math.abs(report.minimum - sparse.minimumMm)).toBeLessThanOrEqual(
    sparse.absoluteToleranceMm,
  );
  expect(Math.abs(report.maximum - sparse.maximumMm)).toBeLessThanOrEqual(
    sparse.absoluteToleranceMm,
  );
  expect(report.distances).toEqual([-1, 0, 1, 3, -2]);
  expect(report.samples).toBe(5);
});

it("matches native exported circle radius and displayed diameter on identical geometry", () => {
  const {
    center: [x, y, z],
    radiusMm: r,
    diameterMm: d,
    absoluteToleranceMm: t,
  } = circleAngle.circle;
  const input = {
    first: [x + r, y, z] as Vec3,
    second: [x, y + r, z] as Vec3,
    third: [x - r, y, z] as Vec3,
  };
  expect(
    Math.abs(measureGeometry({ kind: "radius", ...input }).value - r),
  ).toBeLessThanOrEqual(t);
  expect(
    Math.abs(measureGeometry({ kind: "diameter", ...input }).value - d),
  ).toBeLessThanOrEqual(t);
});
it("matches the native perpendicular-line angle proposal on exported endpoints", () => {
  const a = circleAngle.angle;
  expect(
    Math.abs(
      measureGeometry({
        kind: "angle",
        first: a.first as Vec3,
        second: a.vertex as Vec3,
        third: a.third as Vec3,
      }).value - a.degrees,
    ),
  ).toBeLessThanOrEqual(a.absoluteToleranceDegrees);
});

it("prepares an analytic tetrahedron section for the pending native comparison", () => {
  const v = [
      [0, 0, 0],
      [10, 0, 0],
      [0, 10, 0],
      [0, 0, 10],
    ],
    f = [
      [0, 2, 1],
      [0, 1, 3],
      [0, 3, 2],
      [1, 2, 3],
    ];
  const source: Entity = {
    id: "tetra",
    name: "tetra",
    kind: "mesh",
    positions: new Float32Array(f.flatMap((face) => face.flatMap((i) => v[i]))),
    visible: true,
    color: "#fff",
    opacity: 1,
  };
  const report = inspectSection(source, "x", 2);
  expect(report.segments.length / 6).toBe(3);
  expect(report.length).toBeCloseTo(16 + Math.sqrt(128), 12);
});
