import { expect, it } from "vitest";
import { expandPlyTopology } from "../src/ply-topology";
import { meshStats } from "../src/geometry";
import { smoothDisplayNormals } from "../src/viewport-display";
import { displayMeshStats } from "../src/scan-render-data";

it("reuses display statistics across object switches but invalidates on geometry replacement", () => {
  const positions = expandPlyTopology(topology);
  const first = displayMeshStats(positions);
  expect(displayMeshStats(positions)).toBe(first);
  const replaced = positions.map((n) => n * 2);
  expect(displayMeshStats(replaced)).not.toBe(first);
  expect(displayMeshStats(replaced)).toEqual(meshStats(replaced));
  const prepared = prepareScanRenderData(positions, topology);
  cacheScanRenderData(positions, prepared);
  expect(displayMeshStats(positions)).toBe(prepared.stats);
});
import {
  prepareScanRenderData,
  cacheScanRenderData,
  scanRenderData,
} from "../src/scan-render-data";

const topology = {
  vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]),
  triangles: new Uint32Array([0, 1, 2, 0, 3, 1]),
};

it("prepares smooth normals from source connectivity without changing geometry", () => {
  const positions = expandPlyTopology(topology);
  const original = positions.slice();
  const data = prepareScanRenderData(positions, topology);
  expect(data.indexedMesh).toBe(topology);
  expect(data.normals?.length).toBe(topology.vertices.length);
  expect(data.normals!.byteLength).toBeLessThan(positions.byteLength);
  expect(data.normals?.[1]).toBeCloseTo(Math.SQRT1_2);
  expect(data.normals?.[2]).toBeCloseTo(Math.SQRT1_2);
  expect(data.normals?.[8]).toBeCloseTo(1);
  expect(data.stats).toEqual(meshStats(positions));
  expect(positions).toEqual(original);
});

it("expands indexed display normals to the exact previous Float32 soup values", () => {
  const data = prepareScanRenderData(expandPlyTopology(topology), topology);
  const s = Math.SQRT1_2;
  const previous = new Float32Array([
    0,
    s,
    s,
    0,
    s,
    s,
    0,
    0,
    1,
    0,
    s,
    s,
    0,
    1,
    0,
    0,
    s,
    s,
  ]);
  const expanded = expandPlyTopology({
    vertices: data.normals!,
    triangles: topology.triangles,
  });
  expect(new Uint8Array(expanded.buffer)).toEqual(
    new Uint8Array(previous.buffer),
  );
});

it("preserves separate vertex identities even when coordinates coincide", () => {
  const separated = {
    vertices: new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0,
    ]),
    triangles: new Uint32Array([0, 1, 2, 3, 4, 5]),
  };
  const data = prepareScanRenderData(expandPlyTopology(separated), separated);
  expect(Array.from(data.normals!.subarray(0, 3))).toEqual([0, 0, 1]);
  expect(Array.from(data.normals!.subarray(9, 12))).toEqual([0, 1, 0]);
});

it("falls back to existing weld semantics when topology is absent or stale", () => {
  const positions = expandPlyTopology(topology);
  const stale = { ...topology, triangles: new Uint32Array([1, 0, 2, 0, 3, 1]) };
  const expected = smoothDisplayNormals(positions);
  for (const mesh of [undefined, stale]) {
    const data = prepareScanRenderData(positions, mesh);
    expect(data.normals).toEqual(expected);
    expect(data.indexedMesh).toBeUndefined();
    expect(data.bounds).toEqual([0, 0, 0, 1, 1, 1]);
    expect(data.stats).toEqual(meshStats(positions));
  }
});

it("keeps authored-soup bounds and statistics when topology has unused vertices", () => {
  const mesh = {
    vertices: new Float32Array([...topology.vertices, -100, 200, 300]),
    triangles: topology.triangles,
  };
  const positions = expandPlyTopology(mesh);
  const data = prepareScanRenderData(positions, mesh);
  expect(data.indexedMesh).toBe(mesh);
  expect(data.normals?.length).toBe(mesh.vertices.length);
  expect(Array.from(data.normals!.subarray(-3))).toEqual([0, 0, 0]);
  expect(data.bounds).toEqual([0, 0, 0, 1, 1, 1]);
  expect(data.radius).toBe(Math.hypot(0.5, 0.5, 0.5));
  expect(data.stats).toEqual(meshStats(positions));
});

it("provides exact bounds and a conservative sphere without normals for point clouds", () => {
  const positions = new Float32Array([-3, 2, -5, 9, 8, 7]);
  const data = prepareScanRenderData(positions, undefined, true);
  expect(data.bounds).toEqual([-3, 2, -5, 9, 8, 7]);
  expect(data.radius).toBeCloseTo(9);
  expect(data.normals).toBeUndefined();
  expect(data.stats).toBeUndefined();
  expect(data.indexedMesh).toBeUndefined();
});

it("keeps render preparation tied to the exact geometry buffer identity", () => {
  const positions = expandPlyTopology(topology);
  const data = prepareScanRenderData(positions, topology);
  cacheScanRenderData(positions, data);
  expect(scanRenderData(positions)).toBe(data);
  expect(scanRenderData(positions.slice())).toBeUndefined();
});

it("rejects nonfinite or incomplete coordinates before producing render data", () => {
  expect(() => prepareScanRenderData(new Float32Array([0, 1]))).toThrow();
  expect(() =>
    prepareScanRenderData(new Float32Array([0, NaN, 0]), undefined, true),
  ).toThrow();
});
