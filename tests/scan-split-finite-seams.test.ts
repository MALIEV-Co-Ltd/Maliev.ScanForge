import { expect, it } from "vitest";
import { analyzeIndexedMesh } from "../src/mesh-processing";
import { refineFiniteCutterMesh } from "../src/scan-split-finite-pipeline";
import { materializeFiniteSeams } from "../src/scan-split-finite-seams";

it("opens a finite interior cut while retaining one connected indexed surface", () => {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const triangles = new Uint32Array([0, 1, 2]);
  const cutter = new Float32Array([0.5, 0.1, -1, 0.5, 0.3, -1, 0.5, 0.1, 1]);
  const refined = refineFiniteCutterMesh(vertices, triangles, cutter);
  const all = new Float32Array([...vertices, ...refined.addedVertices]);
  const before = [
    all.slice(),
    refined.triangles.slice(),
    refined.constraints.slice(),
  ];
  const output = materializeFiniteSeams(
    all,
    refined.triangles,
    refined.constraints,
  );
  const topology = analyzeIndexedMesh(
    Float64Array.from(output.vertices),
    output.triangles,
  );
  expect(topology.boundaryEdges).toBe(7);
  expect(topology.components).toHaveLength(1);
  expect(topology.nonManifoldEdges).toBe(0);
  expect([all, refined.triangles, refined.constraints]).toEqual(before);
  let area = 0;
  for (let i = 0; i < output.triangles.length; i += 3) {
    const p = [...output.triangles.slice(i, i + 3)].map((id) =>
      output.vertices.slice(id * 3, id * 3 + 3),
    );
    const cross =
      (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) -
      (p[1][1] - p[0][1]) * (p[2][0] - p[0][0]);
    expect(cross).toBeGreaterThan(0);
    area += cross;
  }
  expect(area).toBeCloseTo(1, 7);
});

it("opens an edge-to-edge cut into two connected parts", () => {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const refined = refineFiniteCutterMesh(
    vertices,
    new Uint32Array([0, 1, 2]),
    new Float32Array([0.5, -1, -1, 0.5, 1, -1, 0.5, 0, 1]),
  );
  const output = materializeFiniteSeams(
    new Float32Array([...vertices, ...refined.addedVertices]),
    refined.triangles,
    refined.constraints,
  );
  const topology = analyzeIndexedMesh(
    Float64Array.from(output.vertices),
    output.triangles,
  );
  expect(topology.components).toHaveLength(2);
  expect(topology.nonManifoldEdges).toBe(0);
});

it("rejects missing cut edges and honors cancellation", () => {
  const v = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 2, 0]);
  const t = new Uint32Array([0, 1, 2]);
  expect(() => materializeFiniteSeams(v, t, new Uint32Array([0, 3]))).toThrow(
    /missing/i,
  );
  const controller = new AbortController();
  controller.abort();
  expect(() =>
    materializeFiniteSeams(v, t, new Uint32Array(), {
      signal: controller.signal,
    }),
  ).toThrow(/abort/i);
});

it("rejects a rounded seam midpoint that collapses a generated face", () => {
  const vertices = new Float32Array([
    100000000, 0, 0, 100000008, 8, 0, 100000000, 8, 0,
  ]);
  const triangles = new Uint32Array([0, 1, 2]);
  const before = vertices.slice();
  expect(() =>
    materializeFiniteSeams(vertices, triangles, new Uint32Array([0, 1])),
  ).toThrow(/precision|winding|degenerate/i);
  expect(vertices).toEqual(before);
});

it.fails(
  "rejects material area distortion when a rounded midpoint leaves the source edge",
  () => {
    const vertices = new Float32Array([
      100000000, 0, 0, 100000008, 8, 0, 99999992, 16, 0,
    ]);
    expect(() =>
      materializeFiniteSeams(
        vertices,
        new Uint32Array([0, 1, 2]),
        new Uint32Array([0, 1]),
      ),
    ).toThrow(/coverage|precision/i);
  },
);

it("identifies an edge with no exactly collinear Float32 interior point", () => {
  const endpoints = new Float32Array([100000000, 100000008]);
  const bits = new Uint32Array(endpoints.buffer);
  expect(bits[1] - bits[0]).toBe(1);
  const midpoint = (endpoints[0] + endpoints[1]) / 2;
  expect(midpoint).toBe(100000004);
  expect(Math.fround(midpoint)).toBe(endpoints[0]);
  // Any interior point on this edge needs X between adjacent Float32 values.
});

it("retains seam midpoint precision and area in the experimental number-array output", () => {
  const vertices = new Float32Array([
    100000000, 0, 0, 100000008, 8, 0, 99999992, 16, 0,
  ]);
  const result = materializeFiniteSeams(
    vertices,
    new Uint32Array([0, 1, 2]),
    new Uint32Array([0, 1]),
    { preciseCoordinates: true },
  );
  expect(Array.isArray(result.vertices)).toBe(true);
  expect(result.vertices).toContain(100000004);
  let area = 0;
  for (let i = 0; i < result.triangles.length; i += 3) {
    const [a, b, c] = [...result.triangles.slice(i, i + 3)].map((id) =>
      result.vertices.slice(id * 3, id * 3 + 3),
    );
    area += (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  }
  expect(area).toBe(192);
});

it("includes the wider experimental coordinate output in the admission estimate", () => {
  const v = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const t = new Uint32Array([0, 1, 2]);
  const cuts = new Uint32Array();
  expect(() =>
    materializeFiniteSeams(v, t, cuts, {
      preciseCoordinates: true,
      maxTypedBytes: 155,
    }),
  ).toThrow(/memory/i);
  expect(() =>
    materializeFiniteSeams(v, t, cuts, {
      preciseCoordinates: true,
      maxTypedBytes: 156,
    }),
  ).not.toThrow();
});

it("admits the complete typed working set before creating the face buffer", () => {
  const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const triangles = new Uint32Array([0, 1, 2]);
  expect(() =>
    materializeFiniteSeams(vertices, triangles, new Uint32Array(), {
      maxTypedBytes: 119,
    }),
  ).toThrow(/memory/i);
  expect(() =>
    materializeFiniteSeams(vertices, triangles, new Uint32Array(), {
      maxTypedBytes: 120,
    }),
  ).not.toThrow();
});

it("preserves an unrelated point-only connection through a cut elsewhere", () => {
  const v = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, -1, 0, 0, 0, -1, 0]);
  const triangles = new Uint32Array([0, 1, 2, 0, 3, 4]);
  const cutter = new Float32Array([0.5, 0.1, -1, 0.5, 0.3, -1, 0.5, 0.1, 1]);
  const refined = refineFiniteCutterMesh(v, triangles, cutter);
  const output = materializeFiniteSeams(
    new Float32Array([...v, ...refined.addedVertices]),
    refined.triangles,
    refined.constraints,
  );
  const originIds = new Set<number>();
  for (let i = 0; i < output.vertices.length; i += 3)
    if (
      output.vertices[i] === 0 &&
      output.vertices[i + 1] === 0 &&
      output.vertices[i + 2] === 0
    )
      originIds.add(i / 3);
  expect(originIds.size).toBe(1);
});
