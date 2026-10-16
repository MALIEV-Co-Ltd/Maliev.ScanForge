import {
  analyzeIndexedMesh,
  type MeshProcessingOptions,
  type MeshTopology,
} from "./mesh-processing";
import type { Positions } from "./types";

/** Resident compatibility lane. The paged source lane must not build this index. */
export function residentSourceFanQuery(
  positions: Positions,
  options: MeshProcessingOptions,
) {
  let corners: Uint32Array | undefined;
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
  };
  const coordinate = (corner: number, axis: number) =>
    Math.fround(positions[corner * 3 + axis]);
  const key = (corner: number) =>
    `${coordinate(corner, 0)},${coordinate(corner, 1)},${coordinate(corner, 2)}`;
  const compare = (corner: number, point: readonly number[]) => {
    for (let axis = 0; axis < 3; axis++) {
      const difference = coordinate(corner, axis) - point[axis];
      if (difference) return difference;
    }
    return 0;
  };
  const cache = new Map<string, boolean>();
  return (point: readonly number[]) => {
    check();
    const pointKey = point.join(","),
      known = cache.get(pointKey);
    if (known !== undefined) return known;
    if (!corners) {
      corners = Uint32Array.from(
        { length: positions.length / 3 },
        (_, id) => id,
      );
      let comparisons = 0;
      corners.sort((a, b) => {
        if ((comparisons++ & 32767) === 0) check();
        for (let axis = 0; axis < 3; axis++) {
          const difference = coordinate(a, axis) - coordinate(b, axis);
          if (difference) return difference;
        }
        return a - b;
      });
    }
    let low = 0,
      high = corners.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (compare(corners[middle], point) < 0) low = middle + 1;
      else high = middle;
    }
    const links = new Map<string, Set<string>>();
    const uses = new Map<string, { count: number; balance: number }>();
    const pairs = new Set<string>();
    let valid = true,
      count = 0;
    for (
      let cursor = low;
      cursor < corners.length && compare(corners[cursor], point) === 0;
      cursor++
    ) {
      check();
      if (++count > 8192) {
        valid = false;
        break;
      } // decline an unadmitted star, never repair it
      const corner = corners[cursor],
        face = Math.floor(corner / 3) * 3,
        offset = corner % 3;
      const a = face + ((offset + 1) % 3),
        b = face + ((offset + 2) % 3);
      const ak = key(a),
        bk = key(b);
      const pair = ak < bk ? `${ak}|${bk}` : `${bk}|${ak}`;
      const u = [0, 1, 2].map((axis) => coordinate(a, axis) - point[axis]),
        v = [0, 1, 2].map((axis) => coordinate(b, axis) - point[axis]);
      if (
        ak === bk ||
        ak === pointKey ||
        bk === pointKey ||
        pairs.has(pair) ||
        Math.hypot(
          u[1] * v[2] - u[2] * v[1],
          u[2] * v[0] - u[0] * v[2],
          u[0] * v[1] - u[1] * v[0],
        ) === 0
      ) {
        valid = false;
        break;
      }
      pairs.add(pair);
      for (const [from, to, direction] of [
        [ak, bk, 1],
        [bk, ak, -1],
      ] as const) {
        const adjacent = links.get(from) ?? new Set<string>();
        adjacent.add(to);
        links.set(from, adjacent);
        const use = uses.get(from) ?? { count: 0, balance: 0 };
        use.count++;
        use.balance += direction;
        uses.set(from, use);
      }
    }
    if (!links.size) valid = false;
    if (valid) {
      const first = links.keys().next().value!,
        seen = new Set([first]),
        queue = [first];
      for (let index = 0; index < queue.length; index++)
        for (const next of links.get(queue[index])!) {
          if (!seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      let endpoints = 0;
      for (const use of uses.values()) {
        if (use.count === 1) endpoints++;
        else if (use.count !== 2 || use.balance !== 0) valid = false;
      }
      valid =
        valid &&
        seen.size === links.size &&
        (endpoints === 0 || endpoints === 2);
    }
    if (cache.size >= 1024) cache.delete(cache.keys().next().value!);
    cache.set(pointKey, valid);
    return valid;
  };
}

/** Separate local cut fans only after proving their complete source star is valid. */
export function normalizeCutFans(
  topology: MeshTopology,
  sourceFanValid: (point: readonly number[]) => boolean,
  options: MeshProcessingOptions,
): MeshTopology | undefined {
  if (!topology.nonManifoldVertices) return topology;
  const triangles = topology.triangles.slice(),
    vertices = Array.from(topology.vertices);
  const incident = Array.from(
    { length: topology.vertices.length / 3 },
    () => [] as number[],
  );
  for (let face = 0; face < triangles.length / 3; face++)
    for (let corner = 0; corner < 3; corner++)
      incident[triangles[face * 3 + corner]].push(face);
  for (let vertex = 0; vertex < incident.length; vertex++) {
    if (options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    const faces = incident[vertex],
      parent = faces.map((_, id) => id),
      neighborFace = new Map<number, number>();
    const root = (id: number): number => {
      while (parent[id] !== id) {
        parent[id] = parent[parent[id]];
        id = parent[id];
      }
      return id;
    };
    for (let index = 0; index < faces.length; index++) {
      for (let corner = 0; corner < 3; corner++) {
        const neighbor = triangles[faces[index] * 3 + corner];
        if (neighbor === vertex) continue;
        const previous = neighborFace.get(neighbor);
        if (previous !== undefined) parent[root(index)] = root(previous);
        else neighborFace.set(neighbor, index);
      }
    }
    const groups = new Map<number, number[]>();
    faces.forEach((face, index) => {
      const id = root(index),
        group = groups.get(id) ?? [];
      group.push(face);
      groups.set(id, group);
    });
    if (groups.size <= 1) continue;
    const point = vertices.slice(vertex * 3, vertex * 3 + 3);
    if (!sourceFanValid(point)) return;
    let first = true;
    for (const group of groups.values()) {
      if (first) {
        first = false;
        continue;
      }
      const id = vertices.length / 3;
      vertices.push(...point);
      for (const face of group)
        for (let corner = 0; corner < 3; corner++)
          if (triangles[face * 3 + corner] === vertex)
            triangles[face * 3 + corner] = id;
    }
  }
  const normalized = analyzeIndexedMesh(new Float64Array(vertices), triangles, {
    signal: options.signal,
    tolerance: 1e-12,
  });
  return normalized.nonManifoldVertices ? undefined : normalized;
}
