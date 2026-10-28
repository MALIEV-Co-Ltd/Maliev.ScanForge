import { expect, it } from "vitest";
import { analyzeIndexedMesh } from "../src/mesh-processing";
import { indexedMeshMatches } from "../src/indexed-mesh";
import { runFiniteSplitCandidate } from "../src/scan-split-finite-candidate";
import { runScanEdit } from "../src/scan-edit";
import { scanSplitCutter } from "../src/scan-split-cutter";

it("keeps sampled CAD cutters on the existing solid-cutter route", () => {
  const source = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]);
  const target = new Float32Array([1, -2, -1, 1, 4, -1, 1, -2, 3]);
  const binding = scanSplitCutter({
    id: "cad",
    name: "CAD",
    kind: "cad",
    positions: target,
    visible: true,
    color: "#fff",
    opacity: 1,
    kernelId: "cad-1",
  });
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source,
    ...binding,
  });
  expect(result.segments).toHaveLength(2);
  expect(result.positions).toBeUndefined();
});

it("publishes the folded open cutter as one connected mesh with an open seam", () => {
  const source = new Float32Array([
    -0.5, -0.5, 0, 1.5, -0.5, 0, 1.5, 1.5, 0, -0.5, -0.5, 0, 1.5, 1.5, 0, -0.5,
    1.5, 0,
  ]);
  const cutter = new Float32Array([
    0, -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0, 1, -1, 1, 1,
    -1, 1, 1, 1, 0, 1, -1, 1, 1, 1, 0, 1, 1,
  ]);
  const sourceBefore = source.slice(),
    cutterBefore = cutter.slice();
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source,
    target: cutter,
  });
  expect(result.segments).toBeUndefined();
  expect(result.positions).toBeDefined();
  const mesh = result.indexedMesh!;
  expect(indexedMeshMatches(mesh, result.positions!)).toBe(true);
  const topology = analyzeIndexedMesh(
    Float64Array.from(mesh.vertices),
    Uint32Array.from(mesh.triangles),
  );
  expect(topology.components).toHaveLength(1);
  expect(topology.nonManifoldEdges).toBe(0);
  const edges = new Map<string, { a: number; b: number; count: number }>();
  for (let i = 0; i < mesh.triangles.length; i += 3)
    for (let side = 0; side < 3; side++) {
      const a = mesh.triangles[i + side],
        b = mesh.triangles[i + ((side + 1) % 3)];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const edge = edges.get(key) ?? { a, b, count: 0 };
      edge.count++;
      edges.set(key, edge);
    }
  let boundaryLength = 0,
    seamLength = 0;
  for (const { a, b, count } of edges.values())
    if (count === 1) {
      const length = Math.hypot(
        ...[0, 1, 2].map(
          (axis) => mesh.vertices[3 * a + axis] - mesh.vertices[3 * b + axis],
        ),
      );
      boundaryLength += length;
      const x1 = mesh.vertices[3 * a],
        y1 = mesh.vertices[3 * a + 1],
        x2 = mesh.vertices[3 * b],
        y2 = mesh.vertices[3 * b + 1];
      const perimeter =
        (x1 === x2 && (x1 === -0.5 || x1 === 1.5)) ||
        (y1 === y2 && (y1 === -0.5 || y1 === 1.5));
      const seam =
        (x1 === 0 &&
          x2 === 0 &&
          Math.min(y1, y2) >= -0.5 &&
          Math.max(y1, y2) <= 1) ||
        (y1 === 1 &&
          y2 === 1 &&
          Math.min(x1, x2) >= 0 &&
          Math.max(x1, x2) <= 1);
      expect(perimeter || seam).toBe(true);
      if (seam) seamLength += length;
    }
  expect(boundaryLength).toBeCloseTo(13, 10);
  expect(seamLength).toBeCloseTo(5, 10);
  const positions = result.positions!;
  let area = 0;
  for (let i = 0; i < positions.length; i += 9)
    area +=
      ((positions[i + 3] - positions[i]) *
        (positions[i + 7] - positions[i + 1]) -
        (positions[i + 4] - positions[i + 1]) *
          (positions[i + 6] - positions[i])) /
      2;
  expect(area).toBeCloseTo(4, 10);
  expect(source).toEqual(sourceBefore);
  expect(cutter).toEqual(cutterBefore);
});

it.each([false, true])(
  "retains an exact shared edge for either cutter winding (%s)",
  (reverse) => {
    const source = [0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0];
    const cutter = reverse
      ? [0, 0.1, -1, 0, 0.5, 1, 0, 0.9, -1]
      : [0, 0.1, -1, 0, 0.9, -1, 0, 0.5, 1];
    const original = source.slice(),
      originalCutter = cutter.slice();
    const result = runFiniteSplitCandidate(source, cutter, undefined, {
      preciseCoordinates: true,
      outputMode: "single-mesh",
      tolerance: 0.001,
    });
    expect(
      indexedMeshMatches(result.mesh.indexedMesh, result.mesh.positions),
    ).toBe(true);
    const p = result.mesh.positions;
    let area = 0;
    for (let i = 0; i < p.length; i += 9) {
      const a = [p[i + 3] - p[i], p[i + 4] - p[i + 1], p[i + 5] - p[i + 2]];
      const b = [p[i + 6] - p[i], p[i + 7] - p[i + 1], p[i + 8] - p[i + 2]];
      area +=
        Math.hypot(
          a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0],
        ) / 2;
    }
    expect(area).toBeCloseTo(1, 12);
    expect(source).toEqual(original);
    expect(cutter).toEqual(originalCutter);
  },
);

it("preserves large-coordinate area through the shared finite Split", () => {
  const source = new Float32Array([
    100000000, 0, 0, 100000008, 8, 0, 99999992, 16, 0,
  ]);
  const cutter = [100000004, -100, -10, 100000004, 100, -10, 100000004, 0, 100];
  const before = source.slice(),
    cutterBefore = cutter.slice();
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source,
    target: cutter,
  });
  expect(result.positions).toBeDefined();
  expect(indexedMeshMatches(result.indexedMesh, result.positions!)).toBe(true);
  expect(result.positions).toContain(100000004);
  const p = result.positions!;
  let doubledArea = 0;
  for (let i = 0; i < p.length; i += 9)
    doubledArea +=
      (p[i + 3] - p[i]) * (p[i + 7] - p[i + 1]) -
      (p[i + 4] - p[i + 1]) * (p[i + 6] - p[i]);
  expect(doubledArea).toBeCloseTo(192, 10);
  expect(source).toEqual(before);
  expect(cutter).toEqual(cutterBefore);
});

it("routes finite mesh cutters through the shared single-mesh edit", () => {
  const source = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]);
  const cutter = new Float32Array([1, -2, -1, 1, 4, -1, 1, -2, 3]);
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source,
    target: cutter,
  });
  expect(result.segments).toBeUndefined();
  expect(result.positions).toBeDefined();
  expect(indexedMeshMatches(result.indexedMesh, result.positions!)).toBe(true);
  const topology = analyzeIndexedMesh(
    Float64Array.from(result.indexedMesh!.vertices),
    Uint32Array.from(result.indexedMesh!.triangles),
  );
  expect(topology.components).toHaveLength(2);
});
it("keeps disconnected source components in one indexed mesh for single-mesh publication", () => {
  const source = new Float32Array([
    0, 0, 0, 1, 0, 0, 0, 1, 0, 3, 0, 0, 4, 0, 0, 3, 1, 0,
  ]);
  const cutter = new Float32Array([10, 0, 1, 11, 0, 1, 10, 1, 1]);
  const original = source.slice();
  const result = runFiniteSplitCandidate(source, cutter, undefined, {
    preciseCoordinates: true,
    outputMode: "single-mesh",
  });
  expect(result.mesh.positions).toEqual(Array.from(source));
  expect(
    indexedMeshMatches(result.mesh.indexedMesh, result.mesh.positions),
  ).toBe(true);
  const topology = analyzeIndexedMesh(
    Float64Array.from(result.mesh.indexedMesh.vertices),
    result.mesh.indexedMesh.triangles,
  );
  expect(topology.components).toHaveLength(2);
  expect(source).toEqual(original);
});

it("keeps a separating finite cut as two indexed components of one mesh", () => {
  const source = new Float32Array([0, 0, 0, 2, 0, 0, 0, 2, 0]);
  const cutter = new Float32Array([1, -2, -1, 1, 4, -1, 1, -2, 3]);
  const result = runFiniteSplitCandidate(source, cutter, undefined, {
    preciseCoordinates: true,
    outputMode: "single-mesh",
  });
  const { positions, indexedMesh } = result.mesh;
  expect(indexedMeshMatches(indexedMesh, positions)).toBe(true);
  const topology = analyzeIndexedMesh(
    Float64Array.from(indexedMesh.vertices),
    indexedMesh.triangles,
  );
  expect(topology.components).toHaveLength(2);
  expect(result.diagnostics.parts).toBe(2);
  let doubledArea = 0;
  for (let i = 0; i < positions.length; i += 9) {
    doubledArea +=
      (positions[i + 3] - positions[i]) *
        (positions[i + 7] - positions[i + 1]) -
      (positions[i + 4] - positions[i + 1]) * (positions[i + 6] - positions[i]);
  }
  expect(doubledArea).toBeCloseTo(4, 10);
});

it("preserves precise coordinates when an edited scan is used as the cutter", () => {
  const x = 100000000;
  const source = new Float32Array([x, 0, 0, x + 8, 0, 0, x, 8, 0]);
  const cutter = [x + 4, -4, -1, x + 4, 12, -1, x + 4, -4, 2];
  const original = cutter.slice();
  const result = runFiniteSplitCandidate(source, cutter, undefined, {
    preciseCoordinates: true,
  });
  expect(result.segments).toHaveLength(2);
  expect(result.segments.flat()).toContain(x + 4);
  expect(cutter).toEqual(original);
});
import { exactSegmentTriangleCrossing } from "../src/scan-split-exact-crossing";
import type { Vec3 } from "../src/types";

it.each([true, false])(
  "splits an already precise source without losing binary64 coordinates (indexed=%s)",
  (useIndex) => {
    const x = 100000000;
    const positions = [x, 0, 0, x + 4, 0, 0, x + 4, 4, 0];
    const indexed = {
      vertices: positions.slice(),
      triangles: new Uint32Array([0, 1, 2]),
    };
    const cutter = new Float32Array([
      x - 16,
      2,
      -10,
      x + 48,
      2,
      -10,
      x - 16,
      2,
      10,
    ]);
    const before = positions.slice();
    const result = runFiniteSplitCandidate(
      positions,
      cutter,
      useIndex ? indexed : undefined,
      { preciseCoordinates: true },
    );
    expect(result.diagnostics.sourceIdentity).toBe(
      useIndex ? "retained-indexed" : "exact-corner-index",
    );
    expect(result.segments.flat()).toContain(x + 4);
    expect(result.segments.flat()).toContain(x + 2);
    expect(
      result.segmentIndexedMeshes.every((mesh, i) =>
        indexedMeshMatches(mesh, result.segments[i]),
      ),
    ).toBe(true);
    expect(positions).toEqual(before);
  },
);

it("rejects vertex-collapsed interior contacts without changing source or cutter", () => {
  const positions = new Float32Array([
    100000000, 0, 0, 100000008, 0, 0, 100000000, 8, 0,
  ]);
  const cutter = new Float32Array([
    100000000, 0, -1, 100000008, 0, 10000000000, 100000008, 0, -1,
  ]);
  const before = [positions.slice(), cutter.slice()];
  expect(() =>
    runFiniteSplitCandidate(positions, cutter, undefined, {
      preciseCoordinates: true,
    }),
  ).toThrow(/precision/i);
  expect([positions, cutter]).toEqual(before);
});

it("retains varied exact contacts on a source edge lying in the cutter plane", () => {
  const source: [Vec3, Vec3, Vec3] = [
    [0, 0, 0],
    [1, 3, 0],
    [0, 4, 0],
  ];
  const positions = new Float32Array(source.flat());
  for (let below = 1; below <= 8; below++)
    for (let above = 1; above <= 8; above++) {
      const cutterPoints: [Vec3, Vec3, Vec3] = [
        [0, 0, -below],
        [1, 3, -below],
        [0, 0, above],
      ];
      const exact = exactSegmentTriangleCrossing(
        cutterPoints[1],
        cutterPoints[2],
        source,
        { exactPoint: true },
      )!;
      const result = runFiniteSplitCandidate(
        positions,
        new Float32Array(cutterPoints.flat()),
        undefined,
        { preciseCoordinates: true },
      );
      const coords = result.segments.flat();
      expect(
        coords.some(
          (value, i) =>
            i % 3 === 0 &&
            value === exact.roundedPoint![0] &&
            coords[i + 1] === exact.roundedPoint![1] &&
            coords[i + 2] === exact.roundedPoint![2],
        ),
        `${below}/${above}`,
      ).toBe(true);
      let doubledArea = 0;
      for (const part of result.segments)
        for (let i = 0; i < part.length; i += 9) {
          const signed =
            (part[i + 3] - part[i]) * (part[i + 7] - part[i + 1]) -
            (part[i + 4] - part[i + 1]) * (part[i + 6] - part[i]);
          expect(signed, `${below}/${above}`).toBeGreaterThan(0);
          doubledArea += signed;
        }
      expect(doubledArea, `${below}/${above}`).toBeCloseTo(4, 14);
      expect(
        result.segmentIndexedMeshes.every((mesh, i) =>
          indexedMeshMatches(mesh, result.segments[i]),
        ),
      ).toBe(true);
    }
});

it("retains an exact cutter-boundary contact on a sloped edge in the cutter plane", () => {
  const positions = new Float32Array([0, 0, 0, 1, 3, 0, 0, 4, 0]);
  const cutter = new Float32Array([0, 0, -1, 1, 3, -1, 0, 0, 2]);
  const result = runFiniteSplitCandidate(positions, cutter, undefined, {
    preciseCoordinates: true,
  });
  expect(
    result.segmentIndexedMeshes.every((mesh, i) =>
      indexedMeshMatches(mesh, result.segments[i]),
    ),
  ).toBe(true);
  const coords = result.segments.flat();
  expect(
    coords.some(
      (value, i) =>
        i % 3 === 0 &&
        value === 2 / 3 &&
        coords[i + 1] === 2 &&
        coords[i + 2] === 0,
    ),
  ).toBe(true);
});

it("rejects an unrepresentable short slit without modifying source or cutter", () => {
  const positions = new Float32Array([
    100000000, 0, 0, 100000008, 0, 0, 100000000, 8, 0,
  ]);
  const cutter = new Float32Array([
    100000000, 2, -1, 100000008, 2, 100000000, 100000008, 2, 100000008,
  ]);
  const original = [positions.slice(), cutter.slice()];
  expect(() =>
    runFiniteSplitCandidate(positions, cutter, undefined, {
      preciseCoordinates: true,
    }),
  ).toThrow(/precision/i);
  expect([positions, cutter]).toEqual(original);
});

it("preserves a shared rational crossing through the precise candidate", () => {
  const positions = new Float32Array([0, 1, 0, 1, -2, 0, 0, -1, 0]);
  const cutter = new Float32Array([-1, 0, -1, 3, 0, 2, -1, 0, 1]);
  const result = runFiniteSplitCandidate(positions, cutter, undefined, {
    preciseCoordinates: true,
  });
  expect(result.segments).toHaveLength(2);
  expect(
    result.segmentIndexedMeshes.every((mesh, i) =>
      indexedMeshMatches(mesh, result.segments[i]),
    ),
  ).toBe(true);
  let area = 0;
  for (const part of result.segments)
    for (let i = 0; i < part.length; i += 9) {
      const signed =
        (part[i + 3] - part[i]) * (part[i + 7] - part[i + 1]) -
        (part[i + 4] - part[i + 1]) * (part[i + 6] - part[i]);
      expect(signed).toBeLessThan(0);
      area -= signed / 2;
    }
  expect(area).toBeCloseTo(1, 14);
});

it("retains a short finite interior slit through the precise candidate", () => {
  const positions = new Float32Array([
    100000000, 0, 0, 100000008, 0, 0, 100000000, 8, 0,
  ]);
  const cutter = new Float32Array([
    100000000,
    2,
    -1,
    100000008,
    2,
    1,
    100000008,
    2,
    1 + 2 ** -23,
  ]);
  const result = runFiniteSplitCandidate(positions, cutter, undefined, {
    preciseCoordinates: true,
  });
  const vertices = result.segmentIndexedMeshes.flatMap((mesh) =>
    Array.from(mesh.vertices),
  );
  expect(vertices).toContain(100000004);
  expect(vertices.some((x) => x > 100000003.999 && x < 100000004)).toBe(true);
  expect(
    result.segmentIndexedMeshes.every((mesh, i) =>
      indexedMeshMatches(mesh, result.segments[i]),
    ),
  ).toBe(true);
  const used = result.segmentIndexedMeshes.flatMap((mesh) =>
    Array.from(mesh.triangles, (index) => mesh.vertices[index * 3]),
  );
  expect(used).toContain(100000004);
  expect(used.some((x) => x > 100000003.999 && x < 100000004)).toBe(true);
  let doubledArea = 0;
  for (const part of result.segments) {
    for (let i = 0; i < part.length; i += 9) {
      const signed =
        (part[i + 3] - part[i]) * (part[i + 7] - part[i + 1]) -
        (part[i + 4] - part[i + 1]) * (part[i + 6] - part[i]);
      expect(signed).toBeGreaterThan(0);
      doubledArea += signed;
    }
  }
  expect(doubledArea).toBe(64);
});

it("returns a single indexed part with an interior slit and unchanged inputs", () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const cutter = new Float32Array([0.5, 0.1, -1, 0.5, 0.3, -1, 0.5, 0.1, 1]);
  const indexed = {
    vertices: positions.slice(),
    triangles: new Uint32Array([0, 1, 2]),
  };
  const before = [
    positions.slice(),
    cutter.slice(),
    indexed.vertices.slice(),
    indexed.triangles.slice(),
  ];
  const result = runFiniteSplitCandidate(positions, cutter, indexed);
  expect(result.segments).toHaveLength(1);
  expect(
    indexedMeshMatches(result.segmentIndexedMeshes[0], result.segments[0]),
  ).toBe(true);
  const mesh = result.segmentIndexedMeshes[0];
  expect(
    analyzeIndexedMesh(Float64Array.from(mesh.vertices), mesh.triangles)
      .boundaryEdges,
  ).toBe(7);
  expect([positions, cutter, indexed.vertices, indexed.triangles]).toEqual(
    before,
  );
});

it("limits the interior slit boundary to the finite cutter interval", () => {
  const source = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const cutter = new Float32Array([0.5, 0.1, -1, 0.5, 0.3, -1, 0.5, 0.1, 1]);
  const result = runFiniteSplitCandidate(source, cutter, undefined, {
    preciseCoordinates: true,
  });
  expect(result.segmentIndexedMeshes).toHaveLength(1);
  const mesh = result.segmentIndexedMeshes[0];
  const edges = new Map<string, { a: number; b: number; count: number }>();
  for (let i = 0; i < mesh.triangles.length; i += 3)
    for (let k = 0; k < 3; k++) {
      const a = mesh.triangles[i + k],
        b = mesh.triangles[i + ((k + 1) % 3)];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const prior = edges.get(key);
      if (prior) prior.count++;
      else edges.set(key, { a, b, count: 1 });
    }
  let seamLength = 0,
    perimeterLength = 0;
  for (const { a, b, count } of edges.values())
    if (count === 1) {
      const x1 = mesh.vertices[3 * a],
        y1 = mesh.vertices[3 * a + 1],
        x2 = mesh.vertices[3 * b],
        y2 = mesh.vertices[3 * b + 1];
      const length = Math.hypot(x2 - x1, y2 - y1);
      const onPerimeter =
        (x1 === 0 && x2 === 0) ||
        (y1 === 0 && y2 === 0) ||
        (Math.abs(x1 + y1 - 1) < 1e-12 && Math.abs(x2 + y2 - 1) < 1e-12);
      const onSeam =
        Math.abs(x1 - 0.5) < 1e-12 &&
        Math.abs(x2 - 0.5) < 1e-12 &&
        Math.min(y1, y2) >= 0.1 - 1e-7 &&
        Math.max(y1, y2) <= 0.2 + 1e-7;
      expect(onPerimeter || onSeam).toBe(true);
      if (onSeam) seamLength += length;
      else perimeterLength += length;
    }
  expect(perimeterLength).toBeCloseTo(2 + Math.SQRT2, 12);
  expect(seamLength).toBeCloseTo(0.2, 6);
});

it("carries precise coordinates through the complete experimental candidate", () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const cutter = new Float32Array([0.5, 0.1, -1, 0.5, 0.3, -1, 0.5, 0.1, 1]);
  const result = runFiniteSplitCandidate(positions, cutter, undefined, {
    preciseCoordinates: true,
  });
  expect(result.segments).toHaveLength(1);
  expect(Array.isArray(result.segments[0])).toBe(true);
  expect(Array.isArray(result.segmentIndexedMeshes[0].vertices)).toBe(true);
  expect(
    indexedMeshMatches(result.segmentIndexedMeshes[0], result.segments[0]),
  ).toBe(true);
});

it("retains a cutter intersection between adjacent Float32 X coordinates", () => {
  const positions = new Float32Array([
    100000000, 0, 0, 100000008, 8, 0, 99999968, 16, 0,
  ]);
  const cutter = new Float32Array([
    99999900, 4, -100, 100000300, 4, -100, 99999900, 4, 100,
  ]);
  const result = runFiniteSplitCandidate(positions, cutter, undefined, {
    preciseCoordinates: true,
  });
  expect(result.segments.flat()).toContain(100000004);
  expect(result.segments).toHaveLength(2);
  let doubledArea = 0;
  for (const part of result.segments) {
    for (let i = 0; i < part.length; i += 9) {
      const signed =
        (part[i + 3] - part[i]) * (part[i + 7] - part[i + 1]) -
        (part[i + 4] - part[i + 1]) * (part[i + 6] - part[i]);
      expect(signed).toBeGreaterThan(0);
      doubledArea += signed;
    }
  }
  expect(doubledArea).toBe(384);
});

it.each([
  "Preparing indexed seam",
  "Grouping indexed parts",
  "Preparing indexed parts",
])(
  "cancels the precise candidate at %s without changing source geometry",
  (stageToCancel) => {
    const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const cutter = new Float32Array([0.5, 0.1, -1, 0.5, 0.3, -1, 0.5, 0.1, 1]);
    const indexed = {
      vertices: positions.slice(),
      triangles: new Uint32Array([0, 1, 2]),
    };
    const before = [
      positions.slice(),
      cutter.slice(),
      indexed.vertices.slice(),
      indexed.triangles.slice(),
    ];
    const controller = new AbortController();
    const progress: number[] = [];
    expect(() =>
      runFiniteSplitCandidate(positions, cutter, indexed, {
        preciseCoordinates: true,
        signal: controller.signal,
        onProgress: (fraction, stage) => {
          progress.push(fraction);
          if (stage === stageToCancel) controller.abort();
        },
      }),
    ).toThrow(/abort/i);
    expect(progress.at(-1)).toBeLessThan(1);
    expect([positions, cutter, indexed.vertices, indexed.triangles]).toEqual(
      before,
    );
  },
);

it("separates a complete cut and reports final progress only after building parts", () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const cutter = new Float32Array([0.5, -1, -1, 0.5, 1, -1, 0.5, 0, 1]);
  const progress: number[] = [];
  const result = runFiniteSplitCandidate(positions, cutter, undefined, {
    onProgress: (fraction) => progress.push(fraction),
  });
  expect(result.segments).toHaveLength(2);
  for (let i = 0; i < 2; i++)
    expect(
      indexedMeshMatches(result.segmentIndexedMeshes[i], result.segments[i]),
    ).toBe(true);
  expect(progress.at(-1)).toBe(1);
  expect(progress.slice(0, -1).every((value) => value < 1)).toBe(true);
});

it("rejects cancellation and invalid source identities without mutation", () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const cutter = new Float32Array([0.5, 0.1, -1, 0.5, 0.3, -1, 0.5, 0.1, 1]);
  const abort = new AbortController();
  abort.abort();
  expect(() =>
    runFiniteSplitCandidate(positions, cutter, undefined, {
      signal: abort.signal,
    }),
  ).toThrow(/abort/i);
  expect(() =>
    runFiniteSplitCandidate(positions, cutter, {
      vertices: positions.slice(),
      triangles: new Uint32Array([0, 2, 1]),
    }),
  ).toThrow(/match/i);
});

it("admits the source vertex copy before allocating it", () => {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const vertices = new Float32Array(3_000);
  vertices.set(positions);
  const triangles = new Uint32Array([0, 1, 2]);
  const cutter = new Float32Array([2, 0, -1, 2, 1, -1, 2, 0, 1]);
  expect(() =>
    runFiniteSplitCandidate(
      positions,
      cutter,
      { vertices, triangles },
      {
        maxTypedBytesPerStage: 4_000,
      },
    ),
  ).toThrow("Finite split source vertex copy typed memory budget exceeded.");
  expect(vertices.slice(0, 9)).toEqual(positions);
});

it("keeps selected and unselected faces in separate result partitions", () => {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0]);
  const triangles = new Uint32Array([0, 1, 2, 1, 0, 3]);
  const positions = Float32Array.from(
    [...triangles].flatMap((id) => [...vertices.slice(id * 3, id * 3 + 3)]),
  );
  const cutter = new Float32Array([0.5, 0.1, -1, 0.5, 0.3, -1, 0.5, 0.1, 1]);
  const result = runFiniteSplitCandidate(
    positions,
    cutter,
    { vertices, triangles },
    { selection: new Uint8Array([1, 0]) },
  );
  expect(result.segments).toHaveLength(2);
  expect([...result.segments[1]]).toEqual([...positions.slice(9)]);
});

it("splits a selected face to its shared edge without modifying its unselected neighbor", () => {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0]);
  const triangles = new Uint32Array([0, 1, 2, 1, 0, 3]);
  const positions = Float32Array.from(
    [...triangles].flatMap((id) => [...vertices.slice(id * 3, id * 3 + 3)]),
  );
  const cutter = new Float32Array([0.25, -2, -1, 0.25, 2, -1, 0.25, 0, 1]);
  const before = positions.slice();
  const result = runFiniteSplitCandidate(
    positions,
    cutter,
    { vertices, triangles },
    { selection: new Uint8Array([1, 0]) },
  );
  expect(result.segments).toHaveLength(3);
  expect(
    result.segments.some(
      (part) =>
        part.length === 9 && [...part].every((v, i) => v === positions[9 + i]),
    ),
  ).toBe(true);
  expect(positions).toEqual(before);
  for (let i = 0; i < result.segments.length; i++)
    expect(
      indexedMeshMatches(result.segmentIndexedMeshes[i], result.segments[i]),
    ).toBe(true);
});

it("splits a thin shared-edge face without rejecting roundoff in coverage", () => {
  const source = [
    -0.00000075, 0, 0, 0.00000075, 0, 0, 1, 1, 0, 0.00000075, 0, 0, -0.00000075,
    0, 0, 0, -1, 0,
  ];
  const target = [0, -2, -1, 0, 2, -1, 0, 2, 1, 0, -2, -1, 0, 2, 1, 0, -2, 1];
  const before = source.slice(),
    cutterBefore = target.slice();
  const result = runScanEdit({
    kind: "scanEdit",
    action: "split",
    positions: source,
    target,
  });
  expect(result.positions).toBeDefined();
  expect(indexedMeshMatches(result.indexedMesh, result.positions!)).toBe(true);
  expect(source).toEqual(before);
  expect(target).toEqual(cutterBefore);
  const incidence = new Map<string, number>();
  const p = result.positions!;
  for (let i = 0; i < p.length; i += 9)
    for (let j = 0; j < 3; j++) {
      const a = i + 3 * j,
        b = i + 3 * ((j + 1) % 3);
      if (p[a + 1] !== 0 || p[b + 1] !== 0) continue;
      const key = [p[a], p[b]].sort((x, y) => x - y).join(",");
      incidence.set(key, (incidence.get(key) ?? 0) + 1);
    }
  expect(incidence.size).toBeGreaterThan(0);
  expect([...incidence.values()].every((count) => count === 2)).toBe(true);
});
