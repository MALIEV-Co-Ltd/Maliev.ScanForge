import { expect, it } from "vitest";
import { ShapeUtils, Vector2 } from "three";
import { refineHolePatch, validHolePatch } from "../src/scan-hole-refine";
import { analyzeMesh } from "../src/mesh-processing";
import { runScanEdit } from "../src/scan-edit";
import type { Vec3 } from "../src/types";

it("fills a densely sampled long narrow hole without oversubdividing ear-cut fans", () => {
  const count = 730;
  const rim: Vec3[] = Array.from({ length: count }, (_, i) => {
    const angle = (i * 2 * Math.PI) / count;
    return [100 * Math.cos(angle), 3 * Math.sin(angle), 0];
  });
  const projected = rim.map(([x, y]) => new Vector2(x, y));
  const points = rim.map((p) => [...p] as Vec3);
  const result = refineHolePatch(
    points,
    projected,
    ShapeUtils.triangulateShape(projected, []),
    count,
    (p) => [p.x, p.y, 0],
    {},
  );
  expect(validHolePatch(projected, result.triangles, count)).toBe(true);
  expect(result.triangles.length).toBeLessThan(20000);
  expect(points.slice(0, count)).toEqual(rim);
  expect(points.every((p) => p[2] === 0)).toBe(true);
});

it("cancels triangulation before adding vertices or changing the rim", () => {
  const points: Vec3[] = [
    [0, 0, 0],
    [100, 0, 0],
    [100, 1, 0],
    [0, 1, 0],
  ];
  const original = points.map((p) => [...p]);
  const projected = points.map(([x, y]) => new Vector2(x, y));
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    refineHolePatch(
      points,
      projected,
      ShapeUtils.triangulateShape(projected, []),
      4,
      (p) => [p.x, p.y, 0],
      { signal: controller.signal },
    ),
  ).toThrow(/cancelled/);
  expect(points).toEqual(original);
});

it("retains the safe patch-size limit for genuinely oversized dense disks", () => {
  const count = 1400;
  const projected = Array.from(
    { length: count },
    (_, i) =>
      new Vector2(
        100 * Math.cos((i * 2 * Math.PI) / count),
        100 * Math.sin((i * 2 * Math.PI) / count),
      ),
  );
  const points: Vec3[] = projected.map((p) => [p.x, p.y, 0]);
  expect(() =>
    refineHolePatch(
      points,
      projected,
      ShapeUtils.triangulateShape(projected, []),
      count,
      (p) => [p.x, p.y, 0],
      {},
    ),
  ).toThrow("exceeded the safe patch size");
});

it("splits retained mesh diagonals instead of making nonmanifold or duplicate cap facets", () => {
  const rim: Vec3[] = [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
  ];
  const points = rim.map((p) => [...p] as Vec3),
    projected = rim.map(([x, y]) => new Vector2(x, y));
  const forbidden = new Set(["0:2", "1:3"]);
  const result = refineHolePatch(
    points,
    projected,
    [
      [0, 1, 2],
      [0, 2, 3],
    ],
    4,
    (p) => [p.x, p.y, 0],
    {},
    forbidden,
  );
  expect(validHolePatch(projected, result.triangles, 4)).toBe(true);
  for (const face of result.triangles)
    for (let k = 0; k < 3; k++) {
      const a = face[k],
        b = face[(k + 1) % 3];
      expect(forbidden.has(a < b ? `${a}:${b}` : `${b}:${a}`)).toBe(false);
    }
  expect(points.slice(0, 4)).toEqual(rim);
});

it.each([false, true])(
  "keeps a folded retained quadrilateral manifold (alternate diagonal: %s)",
  (alternate) => {
    const vertices = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0.2],
    ];
    const faces = alternate
      ? [
          [0, 3, 1],
          [1, 3, 2],
        ]
      : [
          [0, 2, 1],
          [0, 3, 2],
        ];
    const positions = new Float32Array(
      faces.flatMap((f) => f.flatMap((i) => vertices[i])),
    );
    const result = runScanEdit({
      kind: "scanEdit",
      action: "fillHoles",
      positions,
      indices: [0],
      algorithm: "automatic",
      tolerance: 0.001,
    });
    expect(result.diagnostics.filledHoles).toBe(1);
    expect(result.positions!.slice(0, positions.length)).toEqual(positions);
    const t = analyzeMesh(result.positions!, { tolerance: 0.001 });
    expect(
      t.boundaryLoops.length +
        t.boundaryChains.length +
        t.nonManifoldEdges +
        t.nonManifoldVertices +
        t.inconsistentEdges +
        t.duplicateTriangles +
        t.degenerateTriangles,
    ).toBe(0);
  },
);
