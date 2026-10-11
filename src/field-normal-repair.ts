import { buildTriangleAdjacency } from "./field-triangle-adjacency";
import {
  buildTriangleNormalCache,
  type TriangleNormalCache,
} from "./field-triangle-normals";

export interface NormalRepairResult {
  normals: Float32Array;
  unresolvedFaces: Uint8Array;
  repairedFaces: number;
  passes: number;
  /** Native status differs from repairedFaces when the 20-pass limit is exhausted. */
  nativeReturn: number;
  threshold: number;
}

/** Recovered mode-2 tiny-face normal repair; geometry and face areas are unchanged. */
export function repairTriangleNormals(
  positions: Float32Array,
  triangles: Uint32Array,
  cache: TriangleNormalCache = buildTriangleNormalCache(positions, triangles),
  mode = 2,
): NormalRepairResult {
  if (
    positions.length % 3 ||
    cache.normals.length !== triangles.length ||
    cache.crossLengths.length * 3 !== triangles.length ||
    !Number.isInteger(mode)
  )
    throw new Error("Normal repair dimensions or mode are invalid.");
  for (const values of [positions, cache.normals, cache.crossLengths])
    for (const value of values)
      if (!Number.isFinite(value))
        throw new Error("Normal repair inputs must be finite.");
  if (
    cache.surfaceArea < 0 ||
    !Number.isFinite(cache.surfaceArea) ||
    cache.crossLengths.some((value) => value < 0)
  )
    throw new Error("Normal repair areas must be finite and nonnegative.");
  const adjacency = buildTriangleAdjacency(positions.length / 3, triangles);
  const f = Math.fround;
  // Assembly promotes area and multiplies by a double constant before float storage.
  if (!Number.isFinite(f(cache.surfaceArea)))
    throw new Error("Normal repair area overflows native float storage.");
  const threshold = Math.max(f(f(cache.surfaceArea) * 1e-8), f(1e-12));
  const normals = cache.normals.slice();
  const unresolvedFaces = Uint8Array.from(cache.crossLengths, (value) =>
    value <= threshold ? 1 : 0,
  );
  let remaining = unresolvedFaces.reduce((sum, value) => sum + value, 0);
  const initial = remaining;
  let passes = 0;
  const finish = (nativeReturn: number): NormalRepairResult => ({
    normals,
    unresolvedFaces,
    repairedFaces: initial - remaining,
    passes,
    nativeReturn,
    threshold,
  });
  if (mode !== 2 || remaining === 0) return finish(0);
  const dot = (a: number, b: number) => {
    a *= 3;
    b *= 3;
    return f(
      f(f(normals[a + 1] * normals[b + 1]) + f(normals[a] * normals[b])) +
        f(normals[a + 2] * normals[b + 2]),
    );
  };
  type Neighbor = { face: number; length: number };
  while (passes < 20) {
    passes++;
    const before = remaining;
    for (let face = 0; face < unresolvedFaces.length; face++) {
      if (!unresolvedFaces[face]) continue;
      const good: Neighbor[] = [],
        bad: Neighbor[] = [];
      for (let corner = face * 3; corner < face * 3 + 3; corner++) {
        const edge = adjacency.faceEdges[corner];
        // Independent safe handling of self-edge sentinels; native invalid reads are not reproduced.
        if (edge < 0) continue;
        const begin = adjacency.edgeOffsets[edge],
          end = adjacency.edgeOffsets[edge + 1];
        if (end - begin !== 2) continue;
        const first = adjacency.halfedges[begin],
          second = adjacency.halfedges[begin + 1];
        const otherCorner =
          first === corner ? second : second === corner ? first : -1;
        if (otherCorner < 0) continue;
        const other = Math.floor(otherCorner / 3);
        const a = adjacency.edgeVertices[edge * 2] * 3,
          b = adjacency.edgeVertices[edge * 2 + 1] * 3;
        const x = f(positions[a] - positions[b]),
          y = f(positions[a + 1] - positions[b + 1]),
          z = f(positions[a + 2] - positions[b + 2]);
        const length = f(Math.sqrt(f(f(f(y * y) + f(x * x)) + f(z * z))));
        if (!Number.isFinite(length))
          throw new Error("Normal repair edge length overflowed.");
        (unresolvedFaces[other] ? bad : good).push({ face: other, length });
      }
      let source = -1,
        secondSource = -1;
      if (good.length === 1 && bad.length === 2) {
        if (good[0].length < bad[0].length || good[0].length < bad[1].length)
          source = good[0].face;
      } else if (good.length === 2 && bad.length === 1) {
        if (dot(good[0].face, good[1].face) < 0.75) continue;
        const a = good[0].length,
          b = good[1].length,
          small = bad[0].length;
        const index =
          small <= a || small <= b ? (b < a ? 1 : 0) : a <= b ? 1 : 0;
        source = good[index].face;
      } else if (good.length === 3) {
        good.sort((a, b) => a.length - b.length);
        if (dot(good[0].face, good[1].face) < 0.75) continue;
        source = good[0].face;
        secondSource = good[1].face;
      } else if (good.length > 0) source = good[0].face;
      if (source < 0) continue;
      if (secondSource < 0)
        normals.set(normals.subarray(source * 3, source * 3 + 3), face * 3);
      else {
        const values = [0, 1, 2].map((axis) =>
          f(normals[source * 3 + axis] + normals[secondSource * 3 + axis]),
        );
        const length = f(
          Math.sqrt(
            f(
              f(f(values[0] * values[0]) + f(values[1] * values[1])) +
                f(values[2] * values[2]),
            ),
          ),
        );
        if (!Number.isFinite(length))
          throw new Error("Normal repair normalization overflowed.");
        for (let axis = 0; axis < 3; axis++)
          normals[face * 3 + axis] =
            length >= 1e-24 ? f(values[axis] * (1 / length)) : values[axis];
      }
      unresolvedFaces[face] = 0;
      remaining--;
    }
    if (remaining === before || remaining === 0)
      return finish(initial - remaining);
  }
  return finish(0);
}
