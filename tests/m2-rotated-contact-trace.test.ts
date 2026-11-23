import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { inspectFiniteTriangleContact } from "../src/scan-edit-general-split";
import type { Vec3 } from "../src/types";

it("traces the rotated dense control's short cutter segment across the source edge", () => {
  const root = "tests/fixtures/m2-native-rotated-dense-20261029/";
  const load = (name: string) => {
    const bytes = readFileSync(root + name);
    return parseMesh(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      "stl",
    );
  };
  const source = load("vertical-source.stl");
  const cutter = load("grid-128.stl");
  const triangle = (positions: ArrayLike<number>, face: number) =>
    [0, 1, 2].map(
      (corner) =>
        [0, 1, 2].map(
          (axis) => positions[face * 9 + corner * 3 + axis],
        ) as Vec3,
    ) as [Vec3, Vec3, Vec3];
  const contact = (sourceFace: number, cutterFace: number) =>
    inspectFiniteTriangleContact(
      triangle(source, sourceFace),
      triangle(cutter, cutterFace),
      { preciseCoordinates: true },
    );
  const adjacentSource = contact(0, 73);
  const shortSegment = contact(1, 73);
  const adjacentCutter = contact(1, 70);
  expect(shortSegment.points).toHaveLength(2);
  expect(shortSegment.points[0]).toEqual(adjacentSource.points[0]);
  expect(shortSegment.points[1]).toEqual(adjacentCutter.points[0]);
  expect(shortSegment.sourceEdges[0].map((edge) => edge.edge)).toEqual([0]);
  expect(shortSegment.sourceEdges[1]).toEqual([]);
  const separation = Math.hypot(
    ...shortSegment.points[0].map(
      (value, i) => value - shortSegment.points[1][i],
    ),
  );
  expect(separation).toBeGreaterThan(2.15e-8);
  expect(separation).toBeLessThan(2.16e-8);
});
