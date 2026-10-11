import { describe, expect, it } from "vitest";
import { repairTriangleNormals } from "../src/field-normal-repair";

const positions = new Float32Array([
  0, 0, 0, 3, 0, 0, 0, 4, 0, 1, -1, 0, 4, 4, 0, -1, 1, 0,
]);
const triangles = new Uint32Array([0, 1, 2, 1, 0, 3, 2, 1, 4, 0, 2, 5]);
function fixture(
  areas = [0, 1, 1, 1],
  normals = [0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 1],
) {
  return {
    normals: new Float32Array(normals),
    crossLengths: new Float32Array(areas),
    surfaceArea: 1,
  };
}
describe("recovered tiny-face normal repair", () => {
  it("repairs a collinear face from an adjacent scan face through the full geometry path", () => {
    const result = repairTriangleNormals(
      new Float32Array([0, 0, 0, 1, 0, 0, 0.5, 0, 0, 0, -1, 0]),
      new Uint32Array([0, 1, 2, 1, 0, 3]),
    );
    expect(Array.from(result.normals)).toEqual([0, 0, 1, 0, 0, 1]);
    expect(Array.from(result.unresolvedFaces)).toEqual([0, 0]);
    expect(result.repairedFaces).toBe(1);
    expect(result.nativeReturn).toBe(1);
  });
  it("averages the two shortest-edge good neighbors and excludes the longest", () => {
    const cache = fixture();
    const result = repairTriangleNormals(positions, triangles, cache);
    expect(Array.from(result.normals.slice(0, 3))).toEqual([0, 0, 1]);
    expect(result.repairedFaces).toBe(1);
    expect(cache.normals[2]).toBe(0);
    expect(cache.crossLengths[0]).toBe(0);
  });
  it("keeps a tiny face unresolved when the two chosen normals disagree", () => {
    const result = repairTriangleNormals(
      positions,
      triangles,
      fixture([0, 1, 1, 1], [0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, -1]),
    );
    expect(result.unresolvedFaces[0]).toBe(1);
    expect(result.nativeReturn).toBe(0);
    expect(result.passes).toBe(1);
  });
  it("copies the shorter good edge when the bad edge is no longer than at least one good edge", () => {
    const result = repairTriangleNormals(
      positions,
      triangles,
      fixture([0, 1, 1, 0], [0, 0, 0, 0, 0, 1, 0.2, 0, 0.98, 0, 0, 0]),
    );
    expect(Array.from(result.normals.slice(0, 3))).toEqual([0, 0, 1]);
  });
  it("copies the longer good edge when the bad edge is longer than both good edges", () => {
    const result = repairTriangleNormals(
      positions,
      triangles,
      fixture([0, 1, 0, 1], [0, 0, 0, 0, 0, 1, 0, 0, 0, 0.2, 0, 0.98]),
    );
    expect(Array.from(result.normals.slice(0, 3))).toEqual(
      Array.from(new Float32Array([0.2, 0, 0.98])),
    );
  });
  it("uses a single good neighbor only when its edge is shorter than at least one of two bad edges", () => {
    const repaired = repairTriangleNormals(
      positions,
      triangles,
      fixture([0, 1, 0, 0]),
    );
    expect(repaired.unresolvedFaces[0]).toBe(0);
    const unresolved = repairTriangleNormals(
      positions,
      triangles,
      fixture([0, 0, 1, 0]),
    );
    expect(unresolved.unresolvedFaces[0]).toBe(1);
    expect(unresolved.repairedFaces).toBe(0);
  });
  it("propagates immediately within a pass and preserves the native exhausted-limit status", () => {
    const vertices = [0, 0, 0];
    for (let i = 1; i <= 23; i++) vertices.push(i, 1, 0);
    const corners: number[] = [];
    for (let i = 1; i <= 22; i++) corners.push(0, i, i + 1);
    const cache = {
      normals: Float32Array.from({ length: 66 }, (_, i) =>
        i % 3 === 2 ? 1 : 0,
      ),
      crossLengths: new Float32Array(22),
      surfaceArea: 0.5,
    };
    cache.crossLengths[21] = 1;
    const result = repairTriangleNormals(
      new Float32Array(vertices),
      new Uint32Array(corners),
      cache,
    );
    expect(result.passes).toBe(20);
    expect(result.repairedFaces).toBe(20);
    expect(result.unresolvedFaces[0]).toBe(1);
    expect(result.nativeReturn).toBe(0);
    cache.crossLengths.fill(0);
    cache.crossLengths[0] = 1;
    const immediate = repairTriangleNormals(
      new Float32Array(vertices),
      new Uint32Array(corners),
      cache,
    );
    expect(immediate.passes).toBe(1);
    expect(immediate.repairedFaces).toBe(21);
  });
  it("uses the float area threshold, preserves other modes, and handles self-edge sentinels safely", () => {
    const result = repairTriangleNormals(positions, triangles, fixture(), 1);
    expect(result.passes).toBe(0);
    expect(result.unresolvedFaces[0]).toBe(1);
    expect(result.threshold).toBe(Math.fround(1e-8));
    const collapsed = repairTriangleNormals(
      new Float32Array(3),
      new Uint32Array([0, 0, 0]),
    );
    expect(collapsed.threshold).toBe(Math.fround(1e-12));
    expect(collapsed.unresolvedFaces[0]).toBe(1);
  });
  it("owns empty output and rejects malformed caches and geometry", () => {
    const result = repairTriangleNormals(new Float32Array(), new Uint32Array());
    expect(result.normals.length).toBe(0);
    expect(result.passes).toBe(0);
    expect(() =>
      repairTriangleNormals(positions, triangles, {
        ...fixture(),
        surfaceArea: -1,
      }),
    ).toThrow(/areas/);
    expect(() =>
      repairTriangleNormals(positions, triangles, {
        ...fixture(),
        normals: new Float32Array(3),
      }),
    ).toThrow(/dimensions/);
    expect(() =>
      repairTriangleNormals(positions, triangles, fixture(), NaN),
    ).toThrow(/mode/);
    expect(() =>
      repairTriangleNormals(positions, triangles, {
        ...fixture(),
        surfaceArea: 1e40,
      }),
    ).toThrow(/overflows/);
  });
});
