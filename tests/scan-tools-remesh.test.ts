import { BoxGeometry } from "three";
import { describe, expect, it } from "vitest";
import { analyzeMesh } from "../src/mesh-processing";
import { repolygonizeScanMesh } from "../src/scan-tools-remesh";

function cube(size = 2, segments = 1, offset = 0) {
  const indexed = new BoxGeometry(
      size,
      size,
      size,
      segments,
      segments,
      segments,
    ),
    geometry = indexed.toNonIndexed();
  const positions = new Float32Array(geometry.getAttribute("position").array);
  for (let i = 0; i < positions.length; i += 3) positions[i] += offset;
  geometry.dispose();
  indexed.dispose();
  return positions;
}
function watertight(positions: Float32Array) {
  const topology = analyzeMesh(positions);
  expect(topology.boundaryEdges).toBe(0);
  expect(topology.nonManifoldEdges).toBe(0);
  expect(topology.nonManifoldVertices).toBe(0);
  expect(topology.inconsistentEdges).toBe(0);
  expect(topology.degenerateTriangles).toBe(0);
  return topology;
}
describe("reconstructive mesh repolygonization", () => {
  it("reconstructs a closed watertight mesh with the default 0.5 mm resolution", () => {
    const source = cube(),
      before = source.slice(),
      result = repolygonizeScanMesh(source);
    const topology = watertight(result.positions);
    expect(topology.components.length).toBe(1);
    expect(result.positions.length).toBeGreaterThan(source.length);
    expect(result.summary).toContain("0.5 mm");
    expect(source).toEqual(before);
    const xs = Array.from(result.positions).filter((_, i) => i % 3 === 0);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThanOrEqual(3.5);
  });
  it("closes small missing-triangle holes", () => {
    const original = cube(4, 4),
      open = original.slice(9);
    expect(analyzeMesh(open).boundaryEdges).toBeGreaterThan(0);
    const result = repolygonizeScanMesh(open, { resolution: 0.5 });
    expect(watertight(result.positions).components.length).toBe(1);
    expect(result.summary).toContain("Enclosed regions");
  });
  it("fuses nearby and overlapping meshes into a single closed region", () => {
    const a = cube(2, 1, -1.1),
      b = cube(2, 1, 1.1),
      overlap = cube(2, 1, 0);
    const result = repolygonizeScanMesh(
      new Float32Array([...a, ...b, ...overlap]),
      { resolution: 0.5 },
    );
    expect(watertight(result.positions).components.length).toBe(1);
  });
  it("reconstructs open scans as closed shells and states the offset limitation", () => {
    const result = repolygonizeScanMesh([0, 0, 0, 2, 0, 0, 0, 2, 0], {
      resolution: 0.5,
    });
    watertight(result.positions);
    expect(result.summary).toContain("closed thick shells");
    expect(result.summary).toContain("offset approximately 0.375 mm");
  });
  it("rejects invalid resolution, grid budget overflow and nonfinite inputs", () => {
    for (const resolution of [0, -1, NaN, Infinity])
      expect(() => repolygonizeScanMesh(cube(), { resolution })).toThrow(
        /resolution/,
      );
    expect(() => repolygonizeScanMesh(cube(100), { resolution: 0.01 })).toThrow(
      /million/,
    );
    expect(() => repolygonizeScanMesh([NaN, 0, 0, 1, 0, 0, 0, 1, 0])).toThrow(
      /finite/,
    );
    expect(() => repolygonizeScanMesh([1, 2, 3])).toThrow(/triangles/);
  });
  it("checks cancellation during sampling and completes bounded progress", () => {
    const controller = new AbortController();
    expect(() =>
      repolygonizeScanMesh(cube(), {
        signal: controller.signal,
        onProgress: (_f, stage) => {
          if (stage === "Sampling surface distance") controller.abort();
        },
      }),
    ).toThrow(/cancelled/);
    const progress: number[] = [];
    repolygonizeScanMesh(cube(), {
      resolution: 1,
      onProgress: (f) => progress.push(f),
    });
    expect(progress.at(-1)).toBe(1);
    expect(progress.every((f) => f >= 0 && f <= 1)).toBe(true);
  });
});
