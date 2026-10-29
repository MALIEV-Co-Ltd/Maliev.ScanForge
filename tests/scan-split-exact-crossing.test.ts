import { expect, it } from "vitest";
import {
  exactSegmentTriangleCrossing,
  exactVertexPointIdentity,
  roundExactRational,
  exactEdgeWitnessCrossing,
} from "../src/scan-split-exact-crossing";
import type { Vec3 } from "../src/types";

it("verifies an exact crossing witness for a source edge in the cutter plane", () => {
  const face: [Vec3, Vec3, Vec3] = [
    [0, 0, 0],
    [1, 3, 0],
    [0, 4, 0],
  ];
  const witness = {
    segment: [
      [1, 3, -1],
      [0, 0, 2],
    ] as [Vec3, Vec3],
    triangle: face,
    edge: 0 as const,
  };
  const result = exactEdgeWitnessCrossing(face[0], face[1], witness);
  expect(result.roundedPoint).toEqual([2 / 3, 2, 0]);
  expect(
    exactEdgeWitnessCrossing(face[1], face[0], witness).exactPoint,
  ).toEqual(result.exactPoint);
  expect(() => exactEdgeWitnessCrossing(face[0], face[2], witness)).toThrow(
    /edge/i,
  );
});

it("derives witness edge parameters before large-coordinate rounding", () => {
  const triangle: [Vec3, Vec3, Vec3] = [
    [100000000, 0, 0],
    [100000008, 0, 0],
    [100000000, 8, 0],
  ];
  const witness = {
    segment: [
      [100000000, 0, -1],
      [100000008, 0, 1000000000],
    ] as [Vec3, Vec3],
    triangle,
    edge: 0 as const,
  };
  const crossing = exactEdgeWitnessCrossing(triangle[0], triangle[1], witness);
  expect(crossing.edgeFraction).toBe(1 / 1000000001);
  expect(crossing.edgeOpposite).toBe(1000000000 / 1000000001);
  expect((crossing.roundedPoint[0] - triangle[0][0]) / 8).not.toBe(
    crossing.edgeFraction,
  );
  const reverse = exactEdgeWitnessCrossing(triangle[1], triangle[0], witness);
  expect(reverse.edgeFraction).toBe(crossing.edgeOpposite);
  expect(reverse.edgeOpposite).toBe(crossing.edgeFraction);
});

it("preserves a witness parameter near an edge endpoint using its complement", () => {
  const triangle: [Vec3, Vec3, Vec3] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ];
  const witness = {
    segment: [
      [1, 0, -1e-300],
      [0, 0, 1],
    ] as [Vec3, Vec3],
    triangle,
    edge: 0 as const,
  };
  const crossing = exactEdgeWitnessCrossing(triangle[0], triangle[1], witness);
  expect(crossing.edgeFraction).toBe(1);
  expect(crossing.edgeOpposite / 1e-300).toBeCloseTo(1, 12);
});

it("rounds exact rational coordinates to nearest binary64 with ties to even", () => {
  const denominator = 1n << 53n;
  expect(roundExactRational(denominator + 1n, denominator)).toBe(1);
  expect(roundExactRational(denominator + 3n, denominator)).toBe(1 + 2 ** -51);
  expect(roundExactRational(-(denominator + 3n), denominator)).toBe(
    -(1 + 2 ** -51),
  );
  expect(roundExactRational(1n, 1n << 1075n)).toBe(0);
  expect(roundExactRational(3n, 1n << 1075n)).toBe(2 * Number.MIN_VALUE);
  expect(roundExactRational(1n, 3n)).toBe(1 / 3);
  expect(roundExactRational((1n << 53n) - 1n, 1n << 1075n)).toBe(2 ** -1022);
});

it("identifies exact crossing points independently of segment direction and scale", () => {
  const plane: [Vec3, Vec3, Vec3] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ];
  const first = exactSegmentTriangleCrossing([0, 0, -1], [1, 0, 2], plane, {
    exactPoint: true,
  })!;
  const reverse = exactSegmentTriangleCrossing([1, 0, 2], [0, 0, -1], plane, {
    exactPoint: true,
  })!;
  const other = exactSegmentTriangleCrossing([0, 0, -2], [1, 0, 4], plane, {
    exactPoint: true,
  })!;
  const crossingPlane: [Vec3, Vec3, Vec3] = [
    [0, 1, 0],
    [1, -2, 0],
    [0, 1, 1],
  ];
  const acrossOtherTriangle = exactSegmentTriangleCrossing(
    [0, 0, 0],
    [1, 0, 0],
    crossingPlane,
    { exactPoint: true },
  )!;
  expect(first.exactPoint).toEqual(["1/3", "0/1", "0/1"]);
  expect(first.roundedPoint).toEqual([1 / 3, 0, 0]);
  expect(reverse.exactPoint).toEqual(first.exactPoint);
  expect(other.exactPoint).toEqual(first.exactPoint);
  expect(acrossOtherTriangle.exactPoint).toEqual(first.exactPoint);
});

it("distinguishes exact intersections that share a Float32 coordinate", () => {
  const plane: [Vec3, Vec3, Vec3] = [
    [100000000, 0, 0],
    [100000008, 0, 0],
    [100000000, 8, 0],
  ];
  const a: Vec3 = [100000000, 2, -1];
  const first = exactSegmentTriangleCrossing(a, [100000008, 2, 1], plane, {
    exactPoint: true,
  })!;
  const second = exactSegmentTriangleCrossing(
    a,
    [100000008, 2, 1 + 2 ** -23],
    plane,
    { exactPoint: true },
  )!;
  expect(first.exactPoint).not.toEqual(second.exactPoint);
  expect(first.exactPoint![1]).toEqual(second.exactPoint![1]);
});

it("canonicalizes negative subnormal and signed-zero coordinates", () => {
  const plane: [Vec3, Vec3, Vec3] = [
    [-1, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ];
  const tiny = -Number.MIN_VALUE;
  const forward = exactSegmentTriangleCrossing(
    [tiny, -0, -1],
    [tiny, 0, 1],
    plane,
    { exactPoint: true },
  )!;
  const reverse = exactSegmentTriangleCrossing(
    [tiny, 0, 1],
    [tiny, -0, -1],
    plane,
    { exactPoint: true },
  )!;
  expect(forward.exactPoint).toEqual([`-1/${1n << 1074n}`, "0/1", "0/1"]);
  expect(reverse.exactPoint).toEqual(forward.exactPoint);
  expect(exactVertexPointIdentity([tiny, -0, 0])).toEqual(forward.exactPoint);
});

it("retains exact-distance crossing fractions, including tiny endpoint offsets", () => {
  const triangle: [Vec3, Vec3, Vec3] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ];
  const result = exactSegmentTriangleCrossing(
    [0.25, 0.25, -1e-300],
    [0.25, 0.25, 1],
    triangle,
  )!;
  expect(result.inside).toBe(true);
  expect(result.fraction / 1e-300).toBeCloseTo(1, 12);
  const reverse = exactSegmentTriangleCrossing(
    [0.25, 0.25, 1],
    [0.25, 0.25, -1e-300],
    triangle,
  )!;
  expect(reverse.opposite / 1e-300).toBeCloseTo(1, 12);
});

it("classifies an exact boundary crossing independently of segment direction and triangle winding", () => {
  const triangle: [Vec3, Vec3, Vec3] = [
    [0, 0, 0],
    [1, 3, 0],
    [0, 4, 0],
  ];
  const a: Vec3 = [1, 3, -1],
    b: Vec3 = [0, 0, 2];
  expect(exactSegmentTriangleCrossing(a, b, triangle)).toMatchObject({
    inside: true,
    edges: [0],
  });
  expect(exactSegmentTriangleCrossing(b, a, triangle)).toMatchObject({
    inside: true,
    edges: [0],
  });
  expect(
    exactSegmentTriangleCrossing(a, b, [triangle[1], triangle[0], triangle[2]]),
  ).toMatchObject({ inside: true, edges: [0] });
});

it("distinguishes interior, exterior, vertex and noncrossing cases", () => {
  const triangle: [Vec3, Vec3, Vec3] = [
    [0, 0, 0],
    [1, 0, 0],
    [0, 1, 0],
  ];
  expect(
    exactSegmentTriangleCrossing([0.25, 0.25, -1], [0.25, 0.25, 1], triangle),
  ).toMatchObject({ inside: true, edges: [] });
  expect(
    exactSegmentTriangleCrossing([0.75, 0.75, -1], [0.75, 0.75, 1], triangle),
  ).toMatchObject({ inside: false, edges: [] });
  expect(
    exactSegmentTriangleCrossing([0, 0, -1], [0, 0, 1], triangle),
  ).toMatchObject({ inside: true, edges: [0, 2] });
  expect(
    exactSegmentTriangleCrossing([0.25, 0.25, 1], [0.25, 0.25, 2], triangle),
  ).toBeUndefined();
});
