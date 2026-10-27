import type { MeshTopology } from "./mesh-processing";
import type { Vec3 } from "./types";
import { edgeId, pointAt } from "./scan-edit";

const f = Math.fround;
const cross = (a: Vec3, b: Vec3): Vec3 => [
  f(a[1] * b[2] - a[2] * b[1]),
  f(a[2] * b[0] - a[0] * b[2]),
  f(a[0] * b[1] - a[1] * b[0]),
];
const unit = (v: Vec3): Vec3 => {
  const length = f(
    Math.sqrt(f(f(f(v[0] * v[0]) + f(v[1] * v[1])) + f(v[2] * v[2]))),
  );
  return length > 1e-12 ? (v.map((x) => f(x / length)) as Vec3) : v;
};

/** Complete a retained partial rim with native-style tangent chord vertices. */
export function partialTangentRim(
  topology: MeshTopology,
  arc: number[],
  normals: ArrayLike<number>,
) {
  const a = pointAt(topology.vertices, arc[arc.length - 1]);
  const b = pointAt(topology.vertices, arc[0]);
  const delta = b.map((v, i) => v - a[i]) as Vec3;
  const length = Math.hypot(...delta);
  const distance = arc
    .slice(1)
    .reduce(
      (sum, id, i) =>
        sum +
        Math.hypot(
          ...pointAt(topology.vertices, id).map((v, k) =>
            f(v - topology.vertices[arc[i] * 3 + k]),
          ),
        ),
      0,
    );
  const segments = Math.max(
    1,
    Math.trunc(length / (distance / (arc.length - 1))),
  );
  if (!Number.isFinite(segments) || segments > 10000)
    throw new Error("Partial hole chord exceeds the refinement limit.");
  const tangent = (id: number) =>
    unit(
      cross(unit(cross(pointAt(normals, id), delta)), pointAt(normals, id)),
    ).map((v) => f(v * length)) as Vec3;
  const ta = tangent(arc[arc.length - 1]),
    tb = tangent(arc[0]);
  const extra: number[] = [],
    ids: number[] = [];
  for (let i = 1; i < segments; i++) {
    const t = i / segments,
      h00 = 2 * t ** 3 - 3 * t * t + 1,
      h10 = t ** 3 - 2 * t * t + t,
      h01 = -2 * t ** 3 + 3 * t * t,
      h11 = t ** 3 - t * t;
    ids.push(topology.vertices.length / 3 + extra.length / 3);
    extra.push(
      ...a.map((v, k) => f(h00 * v + h10 * ta[k] + h01 * b[k] + h11 * tb[k])),
    );
  }
  const rim = [...arc, ...ids];
  const edges = new Map(topology.edges);
  for (let i = arc.length - 1; i < rim.length; i++) {
    const from = rim[i],
      to = rim[(i + 1) % rim.length];
    if (edges.has(edgeId(from, to)))
      throw new Error("Partial hole chord overlaps an existing mesh edge.");
    edges.set(edgeId(from, to), [{ face: -1, from, to }]);
  }
  const vertices = new Float64Array(topology.vertices.length + extra.length);
  vertices.set(topology.vertices);
  vertices.set(extra, topology.vertices.length);
  const extendedNormals = new Float32Array(normals.length + extra.length);
  extendedNormals.set(normals);
  return {
    rim,
    topology: {
      ...topology,
      vertices,
      edges,
    },
    normals: extendedNormals,
  };
}

/** Reject new vertices that a later position-based weld would merge. */
export function partialVerticesNearExisting(
  topology: MeshTopology,
  points: Vec3[],
  loop: number[],
  tolerance: number,
  signal?: AbortSignal,
  retainedVertexCount = topology.vertices.length / 3,
): boolean {
  const cells = new Map<string, Vec3[]>();
  const cell = (p: Vec3) => p.map((v) => Math.floor(v / tolerance));
  const key = (x: number, y: number, z: number) => `${x}:${y}:${z}`;
  const near = (p: Vec3) => {
    const [x, y, z] = cell(p);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const other of cells.get(key(x + dx, y + dy, z + dz)) ?? [])
            if (
              Math.hypot(p[0] - other[0], p[1] - other[1], p[2] - other[2]) <=
              tolerance
            )
              return true;
    return false;
  };
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < points.length; i++) {
    if (i < loop.length && loop[i] < retainedVertexCount) continue;
    if (signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    const p = points[i].map(f) as Vec3;
    if (near(p)) return true;
    const [x, y, z] = cell(p),
      k = key(x, y, z);
    const bucket = cells.get(k) ?? [];
    bucket.push(p);
    cells.set(k, bucket);
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], p[a] - tolerance);
      max[a] = Math.max(max[a], p[a] + tolerance);
    }
  }
  if (!cells.size) return false;
  for (let i = 0; i < topology.vertices.length; i += 3) {
    if (i % 12288 === 0 && signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    const x = f(topology.vertices[i]),
      y = f(topology.vertices[i + 1]),
      z = f(topology.vertices[i + 2]);
    if (
      x >= min[0] &&
      x <= max[0] &&
      y >= min[1] &&
      y <= max[1] &&
      z >= min[2] &&
      z <= max[2] &&
      near([x, y, z])
    )
      return true;
  }
  return false;
}
