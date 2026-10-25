import { expect, it } from "vitest";
import {
  scanDisplayBuffers,
  indexedDisplayValues,
} from "../src/scan-display-buffers";
import type { ScanRenderData } from "../src/scan-render-data";
import type { IndexedMesh } from "../src/types";

function fixture() {
  const mesh: IndexedMesh = {
    vertices: new Float32Array([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1000, 1000, 1000,
    ]),
    triangles: new Uint32Array([2, 0, 1, 0, 3, 1]),
  };
  const positions = new Float32Array(18);
  for (let slot = 0; slot < mesh.triangles.length; slot++)
    for (let axis = 0; axis < 3; axis++)
      positions[slot * 3 + axis] =
        mesh.vertices[mesh.triangles[slot] * 3 + axis];
  const normals = new Float32Array([
    -0, 0.25, 1, 0.5, 0.75, -1, 1, 0, 0, 0, 1, 0, 9, 8, 7,
  ]);
  const prepared: ScanRenderData = {
    indexedMesh: mesh,
    normals,
    bounds: [0, 0, 0, 1, 1, 1],
    radius: Math.sqrt(3) / 2,
  };
  return { mesh, positions, normals, prepared };
}

it("reuses all indexed buffers without removing unused source vertices", () => {
  const f = fixture();
  const result = scanDisplayBuffers(f.positions, f.mesh, f.prepared);
  expect(result.indexed).toBe(true);
  expect(result.positions).toBe(f.mesh.vertices);
  expect(result.normals).toBe(f.normals);
  expect(result.index).toBe(f.mesh.triangles);
  expect(result.triangleSlots).toBeUndefined();
  expect(result.positions.length).toBe(15);
  expect(f.prepared.bounds).toEqual([0, 0, 0, 1, 1, 1]);
});

it("filters indexed face triplets in original order and maps visible face IDs", () => {
  const f = fixture();
  const result = scanDisplayBuffers(f.positions, f.mesh, f.prepared, [0, 0]);
  expect(result.indexed).toBe(true);
  expect(result.positions).toBe(f.mesh.vertices);
  expect(result.normals).toBe(f.normals);
  expect(result.index).toEqual(new Uint32Array([0, 3, 1]));
  expect(result.triangleSlots).toEqual([1]);
  expect(f.mesh.triangles).toEqual(new Uint32Array([2, 0, 1, 0, 3, 1]));
  const none = scanDisplayBuffers(f.positions, f.mesh, f.prepared, [1, 0]);
  expect(none.index).toEqual(new Uint32Array());
  expect(none.triangleSlots).toEqual([]);
});

it("expands compact normal bits exactly and uses authored soup face indices", () => {
  const f = fixture();
  const sourceBits = new Uint32Array(f.normals.buffer);
  sourceBits[1] = 1;
  const originalBits = sourceBits.slice();
  const result = scanDisplayBuffers(f.positions, f.mesh, f.prepared, [0], true);
  expect(result.indexed).toBe(false);
  expect(result.positions).toBe(f.positions);
  expect(result.normals).not.toBe(f.normals);
  const expected = new Uint32Array(18);
  for (let slot = 0; slot < f.mesh.triangles.length; slot++)
    expected.set(
      originalBits.subarray(
        f.mesh.triangles[slot] * 3,
        f.mesh.triangles[slot] * 3 + 3,
      ),
      slot * 3,
    );
  expect(new Uint32Array(result.normals!.buffer)).toEqual(expected);
  expect(sourceBits).toEqual(originalBits);
  expect(result.index).toEqual(new Uint32Array([3, 4, 5]));
  expect(result.triangleSlots).toEqual([1]);
  expect(
    scanDisplayBuffers(f.positions, f.mesh, f.prepared, [], true).index,
  ).toBeUndefined();
});

it("rejects stale compact normals even when their length resembles expanded data", () => {
  const f = fixture();
  const stale = { ...f.mesh };
  const prepared = {
    ...f.prepared,
    normals: new Float32Array(f.positions.length),
  };
  const result = scanDisplayBuffers(f.positions, stale, prepared);
  expect(result.indexed).toBe(false);
  expect(result.positions).toBe(f.positions);
  expect(result.normals).toBeUndefined();
  expect(result.index).toBeUndefined();
});

it("keeps only matching legacy expanded normals on unsupported topology", () => {
  const f = fixture();
  const expanded = new Float32Array(f.positions.length);
  const prepared = { ...f.prepared, indexedMesh: undefined, normals: expanded };
  const result = scanDisplayBuffers(f.positions, f.mesh, prepared, [1]);
  expect(result.indexed).toBe(false);
  expect(result.positions).toBe(f.positions);
  expect(result.normals).toBe(expanded);
  expect(result.index).toEqual(new Uint32Array([0, 1, 2]));
  expect(result.triangleSlots).toEqual([0]);
  expect(
    scanDisplayBuffers(f.positions, f.mesh, {
      ...prepared,
      normals: new Float32Array(3),
    }).normals,
  ).toBeUndefined();
  expect(scanDisplayBuffers(f.positions, undefined, undefined)).toMatchObject({
    positions: f.positions,
    indexed: false,
  });
});

it("checks compact buffer shapes and validates ordinary indices before conversion", () => {
  for (const change of [
    { triangles: [4294967296, 0, 1, 0, 3, 1] },
    { triangles: new Uint32Array([2, 0, 1]) },
    { vertices: new Float32Array(14) },
  ]) {
    const f = fixture();
    Object.assign(f.mesh, change);
    const result = scanDisplayBuffers(f.positions, f.mesh, f.prepared);
    expect(result.indexed).toBe(false);
    expect(result.positions).toBe(f.positions);
    expect(result.normals).toBeUndefined();
  }
  const f = fixture();
  expect(
    scanDisplayBuffers(f.positions, f.mesh, {
      ...f.prepared,
      normals: new Float32Array(3),
    }).indexed,
  ).toBe(false);
});

it("rejects hidden indices outside complete authored face IDs", () => {
  const f = fixture();
  for (const face of [-1, 2, 0.5, NaN, Infinity])
    expect(() =>
      scanDisplayBuffers(f.positions, f.mesh, f.prepared, [face]),
    ).toThrow(RangeError);
});

it("preserves unmatched indexed deviation state and expands conflicting corner states", () => {
  const mesh = {
    vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    triangles: new Uint32Array([0, 1, 2, 0, 2, 1]),
  };
  const unmatched = indexedDisplayValues(
    new Float32Array([NaN, NaN, NaN, NaN, NaN, NaN]),
    mesh,
  );
  expect(unmatched).toBeDefined();
  expect(Array.from(unmatched!).every(Number.isNaN)).toBe(true);
  expect(
    indexedDisplayValues(new Float32Array([0, 0, 0, NaN, 0, 0]), mesh),
  ).toBeUndefined();
});
