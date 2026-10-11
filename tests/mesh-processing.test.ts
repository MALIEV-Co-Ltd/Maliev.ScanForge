import { describe, expect, it } from "vitest";
import {
  analyzeMesh,
  decimateMesh,
  fillPlanarHoles,
  repairMesh,
  repairOrientation,
  segmentMesh,
  smoothMesh,
} from "../src/mesh-processing";

const square = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0];
const v = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
];
// Outward oriented cube missing the top face.
const openCube = [
  [0, 2, 1],
  [0, 3, 2],
  [0, 1, 5],
  [0, 5, 4],
  [1, 2, 6],
  [1, 6, 5],
  [2, 3, 7],
  [2, 7, 6],
  [3, 0, 4],
  [3, 4, 7],
].flatMap((face) => face.flatMap((id) => v[id]));

describe("indexed mesh topology and repair", () => {
  it("welds neighboring cells and reports manifold boundaries/components", () => {
    const topology = analyzeMesh(square);
    expect(topology.vertices.length / 3).toBe(4);
    expect(topology.boundaryEdges).toBe(4);
    expect(topology.boundaryLoops).toHaveLength(1);
    expect(topology.boundaryLoops[0]).toHaveLength(4);
    expect(topology.components).toHaveLength(1);
    expect(topology.inconsistentEdges).toBe(0);
    const perturbed = [...square];
    perturbed[9] = -0.0000004;
    expect(analyzeMesh(perturbed).vertices.length / 3).toBe(4);
  });
  it("counts nonmanifold and duplicate triangles without pretending repair", () => {
    const mesh = [...square, ...square.slice(0, 9)];
    const report = analyzeMesh(mesh);
    expect(report.nonManifoldEdges).toBe(1);
    expect(report.duplicateTriangles).toBe(1);
    expect(report.components).toHaveLength(1);
  });
  it("repairs inconsistent adjacent winding and preserves input", () => {
    const inconsistent = [...square.slice(0, 9), 0, 0, 0, 0, 1, 0, 1, 1, 0];
    expect(analyzeMesh(inconsistent).inconsistentEdges).toBe(1);
    const result = repairOrientation(inconsistent);
    expect(result.flippedTriangles).toBe(1);
    expect(result.conflicts).toBe(0);
    expect(analyzeMesh(result.positions).inconsistentEdges).toBe(0);
    expect(inconsistent.slice(9)).toEqual([0, 0, 0, 0, 1, 0, 1, 1, 0]);
  });
  it("repairs topology by removing duplicate and collapsed faces before optional capping", () => {
    const dirty = [
      ...openCube,
      ...openCube.slice(0, 9),
      0,
      0,
      0,
      0,
      0,
      0,
      1,
      1,
      1,
    ];
    const result = repairMesh(dirty, { fillHoles: true });
    expect(result.removedDuplicates).toBe(1);
    expect(result.removedDegenerate).toBe(1);
    expect(result.filledLoops).toBe(1);
    expect(result.topology.boundaryEdges).toBe(0);
    expect(result.positions.length / 9).toBe(12);
    expect(() => repairMesh([0, 0, 0, 0, 0, 0, 0, 0, 0])).toThrow(
      /all triangles/,
    );
  });
  it("fills a planar missing cube face, closes the shell, and keeps coherent winding", () => {
    const result = fillPlanarHoles(openCube);
    expect(result.filledLoops).toBe(1);
    expect(result.addedTriangles).toBe(2);
    expect(result.skipped).toEqual([]);
    const topology = analyzeMesh(result.positions);
    expect(topology.boundaryEdges).toBe(0);
    expect(topology.nonManifoldEdges).toBe(0);
    expect(topology.inconsistentEdges).toBe(0);
  });
  it("refuses nonplanar holes and honors requested perimeter limits", () => {
    const bent = [...openCube];
    for (let i = 0; i < bent.length; i += 3)
      if (bent[i] === 1 && bent[i + 1] === 1 && bent[i + 2] === 1)
        bent[i + 2] = 1.5;
    const result = fillPlanarHoles(bent);
    expect(result.filledLoops).toBe(0);
    expect(
      result.skipped.some((item) => item.reason.includes("not planar")),
    ).toBe(true);
    expect(fillPlanarHoles(openCube, { maxPerimeter: 3 }).filledLoops).toBe(0);
  });
  it("segments flat regions across manifold edges and separates sharp corners", () => {
    const flat = segmentMesh(square, { angleDegrees: 10 });
    expect(flat.segments).toHaveLength(1);
    expect(flat.segments[0].area).toBeCloseTo(1);
    const cube = fillPlanarHoles(openCube).positions;
    const result = segmentMesh(cube, { angleDegrees: 30 });
    expect(result.segments).toHaveLength(6);
    expect(result.segments.map((s) => s.triangles)).toEqual([2, 2, 2, 2, 2, 2]);
    expect(segmentMesh(cube, { angleDegrees: 100 }).segments).toHaveLength(1);
  });
  it("smooths an interior spike while pinning boundary vertices", () => {
    const center = [0.5, 0.5, 0.5];
    const corners = [
      [0, 0, 0],
      [1, 0, 0],
      [1, 1, 0],
      [0, 1, 0],
    ];
    const fan = corners.flatMap((corner, i) => [
      ...corner,
      ...corners[(i + 1) % 4],
      ...center,
    ]);
    const result = smoothMesh(fan, { iterations: 1, strength: 1 });
    expect(Array.from(result.slice(0, 6))).toEqual(fan.slice(0, 6));
    expect(result[8]).toBeCloseTo(0);
    expect(fan[8]).toBe(0.5);
  });
  it("clusters vertices and reports reduction/error instead of promising target counts", () => {
    const mesh = [...square, 0.01, 0, 0, 1.01, 0, 0, 1.01, 1, 0];
    const result = decimateMesh(mesh, { cellSize: 0.1 });
    expect(result.originalTriangles).toBe(3);
    expect(result.triangles).toBe(2);
    expect(result.removedTriangles).toBe(1);
    expect(result.maxVertexDisplacement).toBeGreaterThan(0);
    expect(result.maxVertexDisplacement).toBeLessThan(0.1);
  });
  it("rejects invalid meshes, tolerances and options and supports cancellation", () => {
    expect(() => analyzeMesh([0, 0, 0])).toThrow(/triangle/);
    expect(() => analyzeMesh([...square.slice(0, -1), NaN])).toThrow(/finite/);
    expect(() => analyzeMesh(square, { tolerance: 0 })).toThrow(/tolerance/);
    expect(() => segmentMesh(square, { angleDegrees: 181 })).toThrow(/angle/);
    expect(() => smoothMesh(square, { iterations: 0 })).toThrow(/iterations/);
    expect(() => decimateMesh(square, { cellSize: NaN })).toThrow(/tolerance/);
    const controller = new AbortController();
    controller.abort();
    expect(() =>
      fillPlanarHoles(openCube, { signal: controller.signal }),
    ).toThrow(/cancelled/);
  });
});
