import { expect, it } from "vitest";
import { trimNativeCurvatureMesh } from "../src/scan-hole-curvature-trim";
import { analyzeIndexedMesh } from "../src/mesh-processing";

const square = () => ({
  vertices: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]),
  triangles: new Uint32Array([0, 1, 2, 0, 2, 3]),
});

function inspect(result: ReturnType<typeof trimNativeCurvatureMesh>) {
  const topology = analyzeIndexedMesh(
    Float64Array.from(result.vertices),
    result.triangles,
  );
  let area = 0;
  for (let i = 0; i < result.triangles.length; i += 3) {
    const [a, b, c] = Array.from(result.triangles.slice(i, i + 3)).map((id) =>
      Array.from(result.vertices.slice(id * 3, id * 3 + 3)),
    );
    const signed =
      (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    expect(signed).toBeGreaterThan(0);
    area += signed * 0.5;
  }
  expect(topology.nonManifoldEdges).toBe(0);
  expect(topology.inconsistentEdges).toBe(0);
  expect(topology.boundaryChains).toHaveLength(0);
  return { topology, area };
}

it("trims across source edges while retaining a connected constrained boundary", () => {
  const mesh = square();
  const before = {
    vertices: mesh.vertices.slice(),
    triangles: mesh.triangles.slice(),
  };
  const result = trimNativeCurvatureMesh(mesh, [
    [0.2, 0.2, 0],
    [0.8, 0.2, 0],
    [0.5, 0.8, 0],
  ]);
  const { topology, area } = inspect(result);
  expect(area).toBeCloseTo(0.18, 6);
  expect(topology.boundaryLoops).toHaveLength(1);
  for (const id of topology.boundaryLoops[0])
    expect(result.boundary[id]).toBe(1);
  expect(mesh).toEqual(before);
});

it("clips a concave boundary without filling its excluded corner", () => {
  const result = trimNativeCurvatureMesh(square(), [
    [0.1, 0.1, 0],
    [0.9, 0.1, 0],
    [0.9, 0.4, 0],
    [0.4, 0.4, 0],
    [0.4, 0.9, 0],
    [0.1, 0.9, 0],
  ]);
  const { topology, area } = inspect(result);
  expect(area).toBeCloseTo(0.39, 6);
  expect(topology.boundaryLoops).toHaveLength(1);
  for (let i = 0; i < result.triangles.length; i += 3) {
    const center = [0, 0];
    for (const id of result.triangles.slice(i, i + 3))
      for (let a = 0; a < 2; a++) center[a] += result.vertices[id * 3 + a] / 3;
    expect(center[0] <= 0.400001 || center[1] <= 0.400001).toBe(true);
  }
});

it("inserts a complete boundary inside one original facet", () => {
  const result = trimNativeCurvatureMesh(square(), [
    [0.5, 0.1, 0],
    [0.8, 0.1, 0],
    [0.7, 0.3, 0],
  ]);
  const { topology, area } = inspect(result);
  expect(area).toBeCloseTo(0.03, 6);
  expect(topology.boundaryLoops).toHaveLength(1);
});

it("accepts a clockwise inner rim with the source facet winding preserved", () => {
  const result = trimNativeCurvatureMesh(square(), [
    [0.5, 0.8, 0],
    [0.8, 0.2, 0],
    [0.2, 0.2, 0],
  ]);
  expect(inspect(result).area).toBeCloseTo(0.18, 6);
});

it("retains an already constrained mesh and marks its original rim", () => {
  const mesh = square();
  const result = trimNativeCurvatureMesh(mesh, [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
  ]);
  expect(result.vertices).toEqual(mesh.vertices);
  expect(result.vertices).not.toBe(mesh.vertices);
  expect(result.triangles).toEqual(mesh.triangles);
  expect(Array.from(result.boundary)).toEqual([1, 1, 1, 1]);
  expect(inspect(result).area).toBe(1);
});

it("splits a shared diagonal consistently when the clipping segment crosses it", () => {
  const result = trimNativeCurvatureMesh(square(), [
    [0, 0, 0],
    [0.5, 0, 0],
    [0.5, 1, 0],
    [0, 1, 0],
  ]);
  const { topology, area } = inspect(result);
  expect(area).toBeCloseTo(0.5, 6);
  expect(topology.boundaryLoops).toHaveLength(1);
  const used = new Set(result.triangles);
  for (const id of used)
    expect(result.vertices[id * 3]).toBeLessThanOrEqual(0.500001);
});

it("removes outside facets with native swap-last ordering", () => {
  const mesh = {
    vertices: new Float32Array([
      2, 2, 0, 3, 2, 0, 2, 3, 0, 0.1, 0.1, 0, 0.3, 0.1, 0, 0.1, 0.3, 0, 0.6,
      0.6, 0, 0.8, 0.6, 0, 0.6, 0.8, 0,
    ]),
    triangles: new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8]),
  };
  const result = trimNativeCurvatureMesh(mesh, [
    [0, 0, 0],
    [1, 0, 0],
    [1, 1, 0],
    [0, 1, 0],
  ]);
  expect(Array.from(result.triangles)).toEqual([6, 7, 8, 3, 4, 5]);
});

it("rejects invalid, over-budget and cancelled work before mutating source arrays", () => {
  const mesh = square();
  expect(() =>
    trimNativeCurvatureMesh(mesh, [
      [0, 0, 0],
      [1, NaN, 0],
      [1, 1, 0],
    ]),
  ).toThrow(/finite/i);
  expect(() =>
    trimNativeCurvatureMesh(mesh, [
      [0, 0, 0],
      [1, 1, 0],
    ]),
  ).toThrow(/boundary|polygon/i);
  expect(() =>
    trimNativeCurvatureMesh(
      {
        vertices: { length: 300000003 } as unknown as Float32Array,
        triangles: new Uint32Array(),
      },
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
    ),
  ).toThrow(/resource|budget/i);
  const before = mesh.vertices.slice();
  expect(() =>
    trimNativeCurvatureMesh(
      mesh,
      [
        [0, 0, 0],
        [1, 0, 0],
        [0, 1, 0],
      ],
      () => {
        throw new DOMException("Cancelled", "AbortError");
      },
    ),
  ).toThrow(/Cancelled/);
  expect(mesh.vertices).toEqual(before);
});
