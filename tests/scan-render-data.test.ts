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
  expect(data.normals?.length).toBe(positions.length);
  expect(data.normals?.[1]).toBeCloseTo(Math.SQRT1_2);
  expect(data.normals?.[2]).toBeCloseTo(Math.SQRT1_2);
  expect(data.normals?.[8]).toBeCloseTo(1);
  expect(data.stats).toEqual(meshStats(positions));
  expect(positions).toEqual(original);
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
  expect(prepareScanRenderData(positions).normals).toEqual(expected);
  expect(prepareScanRenderData(positions, stale).normals).toEqual(expected);
});

it("provides exact bounds and a conservative sphere without normals for point clouds", () => {
  const positions = new Float32Array([-3, 2, -5, 9, 8, 7]);
  const data = prepareScanRenderData(positions, undefined, true);
  expect(data.bounds).toEqual([-3, 2, -5, 9, 8, 7]);
  expect(data.radius).toBeCloseTo(9);
  expect(data.normals).toBeUndefined();
  expect(data.stats).toBeUndefined();
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
