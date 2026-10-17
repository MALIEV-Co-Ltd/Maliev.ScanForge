import { expect, it } from "vitest";
import { MeshFaceIndex, vertexIncidence } from "../src/mesh-face-index";

it("matches unordered triangle identity through collisions, winding, duplicates and uint32 IDs", () => {
  const ids: number[] = [];
  for (let i = 0; i < 5000; i++) {
    const a = Math.imul(i, 73856093) >>> 0,
      b = Math.imul(i, 19349663) >>> 0,
      c = Math.imul(i, 83492791) >>> 0;
    ids.push(a, b, c, c, a, b, b, c, a);
  }
  const triangles = new Uint32Array(ids),
    index = new MeshFaceIndex(triangles),
    seen = new Set<string>();
  for (let face = 0; face < ids.length / 3; face++) {
    const key = ids
      .slice(face * 3, face * 3 + 3)
      .sort((a, b) => a - b)
      .join(":");
    expect(index.add(face)).toBe(seen.has(key));
    seen.add(key);
  }
});

it("packs vertex incidence in original face/corner order including degenerates and unused vertices", () => {
  const triangles = new Uint32Array([0, 1, 2, 2, 1, 3, 0, 0, 1]);
  const { offsets, faces } = vertexIncidence(triangles, 5);
  const actual = Array.from({ length: 5 }, (_, v) =>
    Array.from(faces.subarray(offsets[v], offsets[v + 1])),
  );
  expect(actual).toEqual([[0, 2, 2], [0, 1, 2], [0, 1], [1], []]);
});
