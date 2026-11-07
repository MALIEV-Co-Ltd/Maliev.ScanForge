import type { MeshTopology } from "./mesh-processing";
import { nativeGlobalFacetNormal } from "./scan-native-global-facet-normal";

/** Native post-fit cleanup visits repeated boundary-face records before swap-last deletion. */
export function cleanupBoundaryFacets(
  topology: MeshTopology,
  recordFaces: readonly number[],
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  const candidates = new Set<number>();
  for (let i = 0; i < recordFaces.length; i++) {
    if (i % 4096 === 0) signal?.throwIfAborted();
    const face = recordFaces[i];
    if (face >= 0 && face === recordFaces[(i + 1) % recordFaces.length])
      candidates.add(face);
  }
  const removed = new Set<number>(),
    normals = new Map<number, Float32Array>();
  const coordinates = new Float32Array(9),
    triangle = new Uint32Array([0, 1, 2]);
  const normal = (face: number) => {
    let value = normals.get(face);
    if (!value) {
      for (let c = 0; c < 3; c++)
        coordinates.set(
          topology.vertices.subarray(
            topology.triangles[face * 3 + c] * 3,
            topology.triangles[face * 3 + c] * 3 + 3,
          ),
          c * 3,
        );
      value = new Float32Array(3);
      nativeGlobalFacetNormal(coordinates, triangle, 0, value);
      normals.set(face, value);
    }
    return value;
  };
  const threshold = Math.cos(Math.PI / 2);
  for (const face of candidates) {
    signal?.throwIfAborted();
    for (let c = 0; c < 3; c++) {
      const a = topology.triangles[face * 3 + c],
        b = topology.triangles[face * 3 + ((c + 1) % 3)];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const neighbor = topology.edges
        .get(key)
        ?.find((use) => use.face !== face);
      if (!neighbor) continue;
      const first = normal(face),
        second = normal(neighbor.face);
      if (
        first[1] * second[1] + first[0] * second[0] + first[2] * second[2] <
        threshold
      )
        removed.add(face);
      break;
    }
  }
  if (!removed.size)
    return {
      removed: 0,
      triangles: topology.triangles,
      retainedFaces: undefined,
    };
  const order = Uint32Array.from(
    { length: topology.triangles.length / 3 },
    (_, i) => i,
  );
  let count = order.length;
  for (let slot = 0; slot < count; slot++) {
    if (slot % 4096 === 0) signal?.throwIfAborted();
    if (removed.has(order[slot])) order[slot--] = order[--count];
  }
  const triangles = new Uint32Array(count * 3);
  for (let f = 0; f < count; f++) {
    if (f % 4096 === 0) signal?.throwIfAborted();
    triangles.set(
      topology.triangles.subarray(order[f] * 3, order[f] * 3 + 3),
      f * 3,
    );
  }
  return {
    removed: removed.size,
    triangles,
    retainedFaces: order.subarray(0, count),
  };
}
