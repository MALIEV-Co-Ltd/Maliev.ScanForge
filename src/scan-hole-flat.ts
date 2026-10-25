import type { MeshTopology } from "./mesh-processing";
import type { Vec3 } from "./types";

const unit = (v: Vec3): Vec3 => {
  const length = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  return length >= Number.EPSILON
    ? (v.map((x) => x * (1 / length)) as Vec3)
    : v;
};
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

/** Native Flat uses strict smallest-corner clipping, without interior refinement.
 * Keep retained rim order for score ties and round the centered projection as
 * the native boundary records do. The caller validates the complete patch.
 */
export function flatHoleTriangles(
  topology: MeshTopology,
  ids: readonly number[],
  normal: Vec3,
  signal?: AbortSignal,
): number[][] | undefined {
  if (ids.length < 3 || ids.length > 100002) return;
  const center: Vec3 = [0, 0, 0];
  for (const id of ids)
    for (let a = 0; a < 3; a++) center[a] += topology.vertices[id * 3 + a];
  for (let a = 0; a < 3; a++) center[a] /= ids.length;
  let axis = 0;
  for (let a = 1; a < 3; a++)
    if (Math.abs(normal[a]) < Math.abs(normal[axis])) axis = a;
  const hint: Vec3 = [0, 0, 0];
  hint[axis] = 1;
  const u = unit(hint.map((x, a) => x - normal[a] * normal[axis]) as Vec3);
  const v = cross(normal, u);
  const projection = ids.map((id) => {
    const d = center.map((x, a) => topology.vertices[id * 3 + a] - x);
    return [
      Math.fround(u[0] * d[0] + u[1] * d[1] + u[2] * d[2]),
      Math.fround(v[0] * d[0] + v[1] * d[1] + v[2] * d[2]),
      0,
    ] as Vec3;
  });
  // The native projection reverses its X coordinate for the opposite winding.
  let area = 0;
  for (let i = 0; i < projection.length; i++) {
    const a = projection[i],
      b = projection[(i + 1) % projection.length];
    area += a[0] * b[1] - b[0] * a[1];
  }
  if (area > 0) for (const p of projection) p[0] = -p[0];
  const loop = ids.map((_, i) => i),
    triangles: number[][] = [];
  const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const rimEdges = new Set(
    ids.map((id, i) => edgeKey(id, ids[(i + 1) % ids.length])),
  );
  while (loop.length > 3) {
    if (signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    let selected = -1,
      best = 3.4028234663852886e38;
    for (let i = 0; i < loop.length; i++) {
      const diagonal = edgeKey(
        ids[loop[(i + loop.length - 1) % loop.length]],
        ids[loop[(i + 1) % loop.length]],
      );
      if (topology.edges.has(diagonal) && !rimEdges.has(diagonal)) continue;
      const p = projection[loop[(i + loop.length - 1) % loop.length]],
        c = projection[loop[i]],
        n = projection[loop[(i + 1) % loop.length]];
      const a = unit(p.map((x, k) => x - c[k]) as Vec3),
        b = unit(n.map((x, k) => x - c[k]) as Vec3);
      if (b[1] * a[0] - b[0] * a[1] < Number.EPSILON) continue;
      const score = Math.acos(a[1] * b[1] + a[0] * b[0] + a[2] * b[2]);
      if (score < best) {
        best = score;
        selected = i;
      }
    }
    if (selected < 0) return;
    triangles.push([
      ids[loop[selected]],
      ids[loop[(selected + loop.length - 1) % loop.length]],
      ids[loop[(selected + 1) % loop.length]],
    ]);
    loop.splice(selected, 1);
  }
  triangles.push([ids[loop[0]], ids[loop[2]], ids[loop[1]]]);
  return triangles;
}
