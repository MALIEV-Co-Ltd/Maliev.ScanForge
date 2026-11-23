import { expect, it } from "vitest";
import { normalizePoissonMesh } from "../src/poisson-mesh-cleanup";
it("removes only exact collapsed and duplicate faces and preserves input", () => {
  const vertices = Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0),
    density = Float32Array.of(5, 5, 5, 1),
    triangles = Uint32Array.of(0, 1, 2, 2, 1, 0, 0, 0, 2, 0, 1, 3);
  const result = normalizePoissonMesh(vertices, triangles, density);
  expect(Array.from(result.triangles)).toEqual([0, 1, 2]);
  expect(result.removedDegenerateTriangles).toBe(2);
  expect(result.removedDuplicateTriangles).toBe(1);
  expect(triangles.length).toBe(12);
});
it("applies explicit density trimming and rejects invalid topology", () => {
  const v = Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0),
    d = Float32Array.of(5, 5, 5, 1),
    t = Uint32Array.of(0, 1, 2, 1, 3, 2);
  const r = normalizePoissonMesh(v, t, d, 4);
  expect(r.trimmedTriangles).toBe(1);
  expect(r.vertices.length).toBe(9);
  expect(() => normalizePoissonMesh(v, t, d, 6)).toThrow(/entire/);
  expect(() => normalizePoissonMesh(v, Uint32Array.of(0, 1, 99), d)).toThrow(
    /invalid/,
  );
});
it("welds exact coordinate aliases conservatively before face validation", () => {
  const v = Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0),
    d = Float32Array.of(5, 5, 5, 2),
    t = Uint32Array.of(0, 1, 2, 3, 1, 2, 0, 3, 1);
  const r = normalizePoissonMesh(v, t, d);
  expect(r.mergedVertices).toBe(1);
  expect(r.removedDuplicateTriangles).toBe(1);
  expect(r.removedDegenerateTriangles).toBe(1);
  expect(Array.from(r.density)).toEqual([2, 5, 5]);
  expect(d[0]).toBe(5);
});
