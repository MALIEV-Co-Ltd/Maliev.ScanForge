import { expect, it } from "vitest";
import { ShapeUtils, Vector2 } from "three";
import { refineHolePatch, validHolePatch } from "../src/scan-hole-refine";
import { analyzeMesh } from "../src/mesh-processing";
import { runScanEdit } from "../src/scan-edit";
import type { Vec3 } from "../src/types";

// One unsplit 2.5 mm rim edge, with 0.5-1 mm sampling on the other sides.
const rim = [
  [0, 0],
  [2.5, 0],
  [2.5, 1],
  [1.5, 1],
  [0.5, 1],
  [0, 1],
];

it("converges on a fillable hole whose fixed edge falls below the old coarse-rim threshold", () => {
  const projected = rim.map(([x, y]) => new Vector2(x, y));
  const points: Vec3[] = rim.map(([x, y]) => [x, y, 0]);
  const result = refineHolePatch(
    points,
    projected,
    ShapeUtils.triangulateShape(projected, []),
    rim.length,
    (p) => [p.x, p.y, 0],
    {},
  );
  expect(validHolePatch(projected, result.triangles, rim.length)).toBe(true);
  expect(points.slice(0, rim.length)).toEqual(rim.map(([x, y]) => [x, y, 0]));
  expect(result.triangles.length).toBeLessThan(500);
});

const cases = [
  ...[1.9, 2.1, 2.2, 2.5, 2.7, 2.9, 3.5].flatMap((width) =>
    (["automatic", "flat", "tangent", "curvature"] as const).map(
      (algorithm) => ({
        width,
        algorithm,
        curved: false,
      }),
    ),
  ),
  ...(["automatic", "tangent", "curvature"] as const).map((algorithm) => ({
    width: 2.5,
    algorithm,
    curved: true,
  })),
];
it.each(cases)(
  "closes an uneven $width mm rim with $algorithm (curved: $curved) without altering the source surface",
  ({ width, algorithm, curved }) => {
    const boundary = rim.map(([x, y]) => [x === 2.5 ? width : x, y]);
    const point = (x: number, y: number) => [
      x,
      y,
      curved ? 0.025 * (x * x + y * y) : 0,
    ];
    const inner = boundary.map(([x, y]) => point(x, y));
    const outer = boundary.map(([x, y]) =>
      point(width / 2 + (x - width / 2) * 2, 0.5 + (y - 0.5) * 2),
    );
    const values: number[] = [];
    for (let i = 0; i < rim.length; i++) {
      const j = (i + 1) % rim.length;
      values.push(
        ...outer[i],
        ...outer[j],
        ...inner[j],
        ...outer[i],
        ...inner[j],
        ...inner[i],
      );
    }
    const positions = Float32Array.from(values);
    const topology = analyzeMesh(positions);
    const hole = topology.boundaryLoops.findIndex((loop) =>
      loop.every(
        (id) =>
          topology.vertices[id * 3] >= 0 &&
          topology.vertices[id * 3] <= width + 1e-6,
      ),
    );
    expect(hole).toBeGreaterThanOrEqual(0);
    const result = runScanEdit({
      kind: "scanEdit",
      action: "fillHoles",
      positions,
      indices: [hole],
      algorithm,
    });
    expect(result.diagnostics.filledHoles).toBe(1);
    expect(result.positions!.slice(0, positions.length)).toEqual(positions);
    const after = analyzeMesh(result.positions!);
    expect(after.boundaryLoops).toHaveLength(1);
    expect(
      after.nonManifoldEdges +
        after.inconsistentEdges +
        after.degenerateTriangles +
        after.duplicateTriangles,
    ).toBe(0);
  },
);
