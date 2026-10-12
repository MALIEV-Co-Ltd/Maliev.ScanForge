import { describe, expect, it } from "vitest";
import { analyzeMesh } from "../src/mesh-processing";
import {
  computeAngleWeightedNormals,
  repatchSpatialBoundary,
} from "../src/scan-defeature-repatch";

function annulus(count = 24, noisy = true) {
  const vertices: number[][] = [];
  for (const radius of [1, 2])
    for (let i = 0; i < count; i++) {
      const a = (2 * Math.PI * i) / count;
      vertices.push([
        radius * Math.cos(a),
        radius * Math.sin(a),
        noisy ? 0.12 * Math.sin(3 * a) + 0.035 * Math.cos(7 * a) : 0,
      ]);
    }
  const positions: number[] = [];
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    for (const id of [count + i, count + j, j, count + i, j, i])
      positions.push(...vertices[id]);
  }
  const topology = analyzeMesh(positions);
  const loop = topology.boundaryLoops.find((ids) =>
    ids.every(
      (id) =>
        Math.hypot(topology.vertices[id * 3], topology.vertices[id * 3 + 1]) <
        1.1,
    ),
  )!;
  return { positions, topology, loop };
}

describe("spatial defeature repatching", () => {
  it("preserves supplied pre-edit rim normals for inserted vertex placement", () => {
    const { topology, loop } = annulus();
    const normals = computeAngleWeightedNormals(topology);
    const flat = new Float64Array(normals.length);
    for (let i = 2; i < flat.length; i += 3) flat[i] = 1;
    const curved = repatchSpatialBoundary(topology, loop, {
      vertexNormals: normals,
    });
    const planar = repatchSpatialBoundary(topology, loop, {
      vertexNormals: flat,
    });
    expect(curved.completed).toBe(true);
    expect(planar.completed).toBe(true);
    expect(curved.insertedVertices).not.toEqual(planar.insertedVertices);
    expect(curved.insertedNormals.length).toBe(curved.insertedVertices.length);
    for (let i = 0; i < curved.insertedNormals.length; i += 3)
      expect(
        Math.hypot(...curved.insertedNormals.subarray(i, i + 3)),
      ).toBeCloseTo(1, 10);
    expect(() =>
      repatchSpatialBoundary(topology, loop, { vertexNormals: [] }),
    ).toThrow("match indexed vertices");
  });
  it("closes a noisy rim without flattening its existing vertices", () => {
    const { topology, loop, positions } = annulus();
    const original = Array.from(topology.vertices);
    const patch = repatchSpatialBoundary(topology, loop);
    expect(patch.completed).toBe(true);
    expect(patch.remainingLoop).toEqual([]);
    expect(Array.from(topology.vertices)).toEqual(original);
    const vertices = [...topology.vertices, ...patch.insertedVertices];
    const filled = [
      ...positions,
      ...Array.from(patch.triangles).flatMap((id) =>
        vertices.slice(id * 3, id * 3 + 3),
      ),
    ];
    const result = analyzeMesh(filled);
    expect(result.boundaryLoops).toHaveLength(1);
    expect(result.nonManifoldEdges).toBe(0);
    expect(result.inconsistentEdges).toBe(0);
    expect(result.degenerateTriangles).toBe(0);
  });
  it("reverses every retained rim edge and keeps patch normals consistent", () => {
    const { topology, loop } = annulus(4, false);
    const patch = repatchSpatialBoundary(topology, loop);
    expect(patch.completed).toBe(true);
    expect(patch.triangles.length).toBe(6);
    for (let i = 0; i < loop.length; i++) {
      const from = loop[i],
        to = loop[(i + 1) % loop.length];
      let reversed = false;
      for (let t = 0; t < patch.triangles.length; t += 3)
        for (let k = 0; k < 3; k++)
          if (
            patch.triangles[t + k] === to &&
            patch.triangles[t + ((k + 1) % 3)] === from
          )
            reversed = true;
      expect(reversed).toBe(true);
    }
  });
  it("reports an incomplete patch at the iteration bound instead of false success", () => {
    const { topology, loop } = annulus();
    const patch = repatchSpatialBoundary(topology, loop, { maxIterations: 1 });
    expect(patch.completed).toBe(false);
    expect(patch.reason).toBe("iteration-limit");
    expect(patch.remainingLoop.length).toBeGreaterThan(3);
    expect(patch.iterations).toBe(1);
  });
  it("rejects a repeated or non-boundary rim before mutation", () => {
    const { topology, loop } = annulus();
    expect(
      repatchSpatialBoundary(topology, [loop[0], loop[1], loop[0], loop[2]])
        .reason,
    ).toBe("invalid-loop");
    expect(
      repatchSpatialBoundary(
        topology,
        loop.filter((_, i) => i !== 1),
      ).reason,
    ).toBe("invalid-loop");
  });
  it("cancels while advancing the boundary", () => {
    const { topology, loop } = annulus();
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      repatchSpatialBoundary(topology, loop, { signal: controller.signal }),
    ).toThrow("cancelled");
  });
});
