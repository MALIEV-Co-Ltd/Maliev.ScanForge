import type { MeshTopology } from "./mesh-processing";
import type { Vec3 } from "./types";
import { nativeHoleBoundaryWalks } from "./scan-hole-boundary-order";

const cache = new WeakMap<MeshTopology, readonly number[]>();
const squared = (a: Vec3, b: Vec3) => {
  const x = a[0] - b[0],
    y = a[1] - b[1],
    z = a[2] - b[2];
  return y * y + x * x + z * z;
};

/** Native Ritter sphere: Float32 extrema, strict first ties and ordered expansion. */
function diameter(
  vertices: ArrayLike<number>,
  ids: readonly number[],
  signal?: AbortSignal,
) {
  if (!ids.length) return 0;
  const point = (id: number): Vec3 =>
    [0, 1, 2].map((a) => Math.fround(vertices[id * 3 + a])) as Vec3;
  const first = point(ids[0]);
  const min = [first, first, first],
    max = [first, first, first];
  for (let i = 0; i < ids.length; i++) {
    if (i % 4096 === 0 && signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    const p = point(ids[i]);
    for (let a = 0; a < 3; a++) {
      if (p[a] < min[a][a]) min[a] = p;
      if (p[a] > max[a][a]) max[a] = p;
    }
  }
  let axis = 0,
    longest = squared(min[0], max[0]);
  for (let a = 1; a < 3; a++) {
    const d = squared(min[a], max[a]);
    if (longest < d) {
      longest = d;
      axis = a;
    }
  }
  let center = min[axis].map((v, a) => (v + max[axis][a]) * 0.5) as Vec3;
  let radiusSquared = squared(max[axis], center),
    radius = Math.sqrt(radiusSquared);
  for (let i = 0; i < ids.length; i++) {
    if (i % 4096 === 0 && signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    const p = point(ids[i]),
      d2 = squared(p, center);
    if (radiusSquared < d2) {
      const d = Math.sqrt(d2);
      radius = (d + radius) * 0.5;
      const outside = d - radius;
      radiusSquared = radius * radius;
      center = p.map((v, a) => (v * outside + radius * center[a]) / d) as Vec3;
    }
  }
  return radius * 2;
}

export function holeBoundaryDiameters(
  topology: MeshTopology,
  signal?: AbortSignal,
): readonly number[] {
  if (signal?.aborted)
    throw new DOMException("Mesh operation cancelled.", "AbortError");
  const retained = cache.get(topology);
  if (retained) return retained;
  if (!topology.boundaryLoops.length && !topology.boundaryChains.length) {
    cache.set(topology, []);
    return [];
  }
  const native = new Map<number, readonly number[]>();
  for (const walk of nativeHoleBoundaryWalks(topology, signal))
    for (const id of walk) native.set(id, walk);
  const values = [...topology.boundaryLoops, ...topology.boundaryChains].map(
    (ids) => {
      const ordered = native.get(ids[0]);
      return diameter(
        topology.vertices,
        ordered?.length === ids.length ? ordered : ids,
        signal,
      );
    },
  );
  cache.set(topology, values);
  return values;
}
