import { expect, it } from "vitest";
import { analyzeIndexedMesh } from "../src/mesh-processing";
import { nativeStlTopology } from "../src/scan-native-stl-topology";
import { runScanEdit, type ScanEditRequest } from "../src/scan-edit";
import sourceFixture from "./fixtures/boundary-smooth-observed-annulus.json";
import native from "../docs/evidence/native-boundary-3d-sketch-20261027.json";
import smoothed from "./fixtures/boundary-smooth-selected-inner-native.json";
import { fitSpatialBoundaries } from "../src/scan-boundary-spatial";
import type { MeshTopology } from "../src/mesh-processing";

function request(indices?: number[]): ScanEditRequest {
  return {
    kind: "scanEdit",
    action: "boundarySpatialSketch",
    positions: Float32Array.from(sourceFixture.source),
    indices,
    fitTolerance: 0.05,
  } as unknown as ScanEditRequest;
}

it("fits the selected original inner boundary to the native spatial sketch", () => {
  const r = request();
  const indexed = nativeStlTopology(Float32Array.from(r.positions));
  const topology = analyzeIndexedMesh(
    Float64Array.from(indexed.vertices),
    indexed.triangles,
  );
  const inner = topology.boundaryLoops.findIndex((ids) =>
    ids.every(
      (id) =>
        Math.hypot(topology.vertices[id * 3], topology.vertices[id * 3 + 1]) <
        4,
    ),
  );
  expect(inner).toBeGreaterThanOrEqual(0);
  const result = runScanEdit(
    { ...r, indices: [inner] },
    { topologyCache: { positions: r.positions, tolerance: 1e-6, topology } },
  ) as unknown as {
    spatialCurves: { poles: number[]; knots: number[]; periodic: boolean }[];
  };
  expect(result.spatialCurves).toHaveLength(1);
  const curve = result.spatialCurves[0];
  const expected = native.originalSelectedControl.curve;
  expect(curve.periodic).toBe(true);
  expect(curve.knots).toEqual(expected.knots);
  expect(curve.poles).toHaveLength(expected.controlPoints.length * 3);
  curve.poles.forEach((value, i) =>
    expect(value).toBeCloseTo(
      expected.controlPoints[Math.floor(i / 3)][i % 3],
      6,
    ),
  );
});

it("rejects an empty or invalid boundary selection before publishing", () => {
  expect(() => runScanEdit(request([]))).toThrow(/boundary/i);
  expect(() => runScanEdit(request([999]))).toThrow(/selection|boundary/i);
  expect(() => runScanEdit(request([0, 0]))).toThrow(/unique/i);
  const overLimit = {
    boundaryLoops: [Array(200001).fill(0)],
    boundaryChains: [],
  } as unknown as MeshTopology;
  expect(() => fitSpatialBoundaries(overLimit, [0], 0.05)).toThrow(
    /point limit/i,
  );
});

it("cancels during multi-boundary fitting without mutating the source", () => {
  const r = request();
  const before = Float32Array.from(r.positions);
  const controller = new AbortController();
  expect(() =>
    runScanEdit(r, {
      signal: controller.signal,
      onProgress: (_, stage) => {
        if (stage === "Fitting spatial boundaries") controller.abort();
      },
    }),
  ).toThrow(/cancel/i);
  expect(Array.from(r.positions)).toEqual(Array.from(before));
});

it("fits both smoothed boundaries to the native all-boundary sketch", () => {
  const original = Float32Array.from(sourceFixture.source);
  const source = Float32Array.from(smoothed.output);
  const indexed = nativeStlTopology(original);
  const vertices = new Float64Array(indexed.vertices.length);
  indexed.triangles.forEach((id, corner) =>
    vertices.set(source.subarray(corner * 3, corner * 3 + 3), id * 3),
  );
  const topology = analyzeIndexedMesh(vertices, indexed.triangles);
  const result = runScanEdit(
    { ...request(), positions: source },
    { topologyCache: { positions: source, tolerance: 1e-6, topology } },
  );
  expect(result.spatialCurves).toHaveLength(native.igesCurves.length);
  result.spatialCurves!.forEach((curve, index) => {
    const expected = native.igesCurves[index];
    expect(curve.knots).toEqual(expected.knots);
    expect(curve.poles).toHaveLength(expected.controlPoints.length * 3);
    curve.poles.forEach((value, i) =>
      expect(value).toBeCloseTo(
        expected.controlPoints[Math.floor(i / 3)][i % 3],
        6,
      ),
    );
  });
});

it("retains nonplanar boundary height instead of flattening it", () => {
  const source = Float32Array.from(sourceFixture.source, (value, index) =>
    index % 3 === 2
      ? value + 0.1 * Math.sin(sourceFixture.source[index - 2])
      : value,
  );
  const result = runScanEdit({ ...request(), positions: source });
  expect(result.spatialCurves).toHaveLength(2);
  for (const curve of result.spatialCurves!) {
    const heights = curve.poles.filter((_, i) => i % 3 === 2);
    expect(Math.max(...heights) - Math.min(...heights)).toBeGreaterThan(0.01);
  }
});
