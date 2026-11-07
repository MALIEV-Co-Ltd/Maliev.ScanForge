import type { MeshTopology } from "./mesh-processing";
import { vertexRings } from "./scan-vertex-ring";
export interface SmoothingRings {
  offsets: Uint32Array;
  neighbors: Uint32Array;
  faces: Int32Array;
  boundary: Uint8Array;
}
const ringCache = new WeakMap<
  Uint32Array,
  { edges: MeshTopology["edges"]; rings: SmoothingRings }
>();
export function smoothingRings(topology: MeshTopology): SmoothingRings {
  const cached = ringCache.get(topology.triangles);
  if (cached?.edges === topology.edges) return cached.rings;
  const ordered = vertexRings(topology);
  const offsets = new Uint32Array(ordered.length + 1),
    faces = new Int32Array(ordered.length),
    boundary = new Uint8Array(ordered.length);
  for (let i = 0; i < ordered.length; i++) {
    offsets[i + 1] = offsets[i] + ordered[i].vertices.length;
    faces[i] = ordered[i].face;
    boundary[i] = Number(ordered[i].boundary);
  }
  const neighbors = new Uint32Array(offsets.at(-1)!);
  ordered.forEach((ring, i) => neighbors.set(ring.vertices, offsets[i]));
  const rings = { offsets, neighbors, faces, boundary };
  ringCache.set(topology.triangles, { edges: topology.edges, rings });
  return rings;
}
export function smoothingSelection(
  triangles: Uint32Array,
  selection: Uint8Array,
): Uint32Array {
  const movable = new Set<number>();
  for (let f = 0; f < selection.length; f++)
    if (selection[f])
      for (let c = 0; c < 3; c++) movable.add(triangles[f * 3 + c]);
  return Uint32Array.from(movable);
}
/** Independent targets preserve each native ordered sum and Float32 rounding. */
export function smoothingTargets(
  vertices: Float64Array,
  triangles: Uint32Array,
  rings: SmoothingRings,
  movable: Uint32Array,
  strength: number,
  signal?: AbortSignal,
): Float64Array<ArrayBuffer> {
  const targets = new Float64Array(movable.length * 3);
  const point = (id: number) => [
    vertices[id * 3],
    vertices[id * 3 + 1],
    vertices[id * 3 + 2],
  ];
  const subtract = (a: number[], b: number[]) =>
    a.map((v, i) => Math.fround(v - b[i]));
  const cross = (a: number[], b: number[]) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  for (let index = 0; index < movable.length; index++) {
    if (index % 4096 === 0 && signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    const id = movable[index],
      start = rings.offsets[id],
      end = rings.offsets[id + 1],
      current = point(id);
    targets.set(current, index * 3);
    if (start === end) continue;
    if (rings.boundary[id]) {
      if (end - start < 2) continue;
      const first = point(rings.neighbors[start]),
        last = point(rings.neighbors[end - 1]);
      const firstDirection = subtract(first, current),
        lastDirection = subtract(last, current),
        f = rings.faces[id] * 3;
      const normal = cross(
        subtract(point(triangles[f + 1]), point(triangles[f])),
        subtract(point(triangles[f + 2]), point(triangles[f])),
      );
      const turn = cross(lastDirection, firstDirection);
      if (turn.reduce((sum, v, a) => sum + v * normal[a], 0) <= 0) continue;
      // Native distance multiplies each Double difference by its Float32 copy.
      const distance = (p: number[]) => {
        const dx = p[0] - current[0],
          dy = p[1] - current[1],
          dz = p[2] - current[2];
        return Math.sqrt(
          dy * Math.fround(dy) + dx * Math.fround(dx) + dz * Math.fround(dz),
        );
      };
      const d1 = distance(first),
        d2 = distance(last);
      if (!(d1 + d2 > 0)) continue;
      for (let a = 0; a < 3; a++) {
        const weighted = Math.fround(
          Math.fround(Math.fround(first[a] * d1) + Math.fround(last[a] * d2)) /
            (d1 + d2),
        );
        targets[index * 3 + a] = Math.fround(
          current[a] +
            Math.fround(Math.fround(weighted - current[a]) * strength),
        );
      }
    } else
      for (let a = 0; a < 3; a++) {
        let sum = 0;
        for (let neighbor = start; neighbor < end; neighbor++)
          sum = Math.fround(sum + vertices[rings.neighbors[neighbor] * 3 + a]);
        targets[index * 3 + a] = Math.fround(sum / (end - start));
      }
  }
  return targets;
}
export function publishSmoothingTargets(
  vertices: Float64Array,
  movable: Uint32Array,
  targets: Float64Array,
): Float64Array<ArrayBuffer> {
  const next = new Float64Array(vertices);
  for (let i = 0; i < movable.length; i++)
    next.set(targets.subarray(i * 3, i * 3 + 3), movable[i] * 3);
  return next;
}
