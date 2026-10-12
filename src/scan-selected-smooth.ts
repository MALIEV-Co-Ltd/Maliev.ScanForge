import type { MeshProcessingOptions, MeshTopology } from "./mesh-processing";

// Selected facets mark their vertices, including shared seams and open borders.
// Each iteration reads the previous coordinates and publishes Float32 targets.
export function smoothSelectedVertices(
  topology: MeshTopology,
  selection: Uint8Array,
  iterations: number,
  strength: number,
  options: MeshProcessingOptions,
): Float64Array<ArrayBuffer> {
  const { triangles, edges } = topology;
  const count = topology.vertices.length / 3;
  let vertices = Float64Array.from(topology.vertices, Math.fround);
  const movable = new Set<number>();
  const adjacent = Array.from({ length: count }, () => new Set<number>());
  const outgoing = new Map<number, number>();
  const incoming = new Map<number, number>();
  const blocked = new Set<number>();
  const faceAt = new Int32Array(count).fill(-1);
  for (let f = 0; f < triangles.length / 3; f++)
    for (let c = 0; c < 3; c++) {
      const id = triangles[f * 3 + c];
      if (selection[f]) movable.add(id);
      if (faceAt[id] < 0) faceAt[id] = f;
    }
  for (const uses of edges.values()) {
    const { from, to } = uses[0];
    adjacent[from].add(to);
    adjacent[to].add(from);
    if (uses.length === 1) {
      if (outgoing.has(from)) blocked.add(from);
      if (incoming.has(to)) blocked.add(to);
      outgoing.set(from, to);
      incoming.set(to, from);
    } else if (uses.length !== 2 || uses[0].from === uses[1].from) {
      blocked.add(from);
      blocked.add(to);
    }
  }
  const point = (id: number) => Array.from(vertices.slice(id * 3, id * 3 + 3));
  const subtract = (a: number[], b: number[]) =>
    a.map((v, i) => Math.fround(v - b[i]));
  const cross = (a: number[], b: number[]) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
  for (let step = 0; step < iterations; step++) {
    if (options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    options.onProgress?.(step / iterations, "Smoothing selected vertices");
    const next = vertices.slice();
    for (const id of movable) {
      if (blocked.has(id) || !adjacent[id].size) continue;
      const current = point(id);
      if (outgoing.has(id) || incoming.has(id)) {
        const firstId = outgoing.get(id),
          lastId = incoming.get(id);
        if (firstId === undefined || lastId === undefined) continue;
        const first = point(firstId),
          last = point(lastId);
        const firstDirection = subtract(first, current);
        const lastDirection = subtract(last, current);
        const f = faceAt[id] * 3;
        const normal = cross(
          subtract(point(triangles[f + 1]), point(triangles[f])),
          subtract(point(triangles[f + 2]), point(triangles[f])),
        );
        const turn = cross(lastDirection, firstDirection);
        if (turn.reduce((sum, v, a) => sum + v * normal[a], 0) <= 0) continue;
        const d1 = Math.fround(Math.hypot(...firstDirection));
        const d2 = Math.fround(Math.hypot(...lastDirection));
        if (!(d1 + d2 > 0)) continue;
        for (let a = 0; a < 3; a++) {
          const weighted = Math.fround(
            Math.fround(
              Math.fround(first[a] * d1) + Math.fround(last[a] * d2),
            ) /
              (d1 + d2),
          );
          next[id * 3 + a] = Math.fround(
            current[a] +
              Math.fround(Math.fround(weighted - current[a]) * strength),
          );
        }
      } else {
        for (let a = 0; a < 3; a++) {
          let sum = 0;
          for (const neighbor of adjacent[id])
            sum = Math.fround(sum + vertices[neighbor * 3 + a]);
          // The native interior target is the full neighborhood mean.
          next[id * 3 + a] = Math.fround(sum / adjacent[id].size);
        }
      }
    }
    vertices = next;
  }
  return vertices;
}
