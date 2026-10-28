import { MeshEdgeIndex } from "./mesh-edge-index";

export const COMPACT_COMPONENT_FACE_THRESHOLD = 65536;

/** Find edge-connected face groups without building per-face neighbor arrays. */
export function compactComponentGroups(
  vertices: ArrayLike<number>,
  triangles: Uint32Array,
  options: {
    tolerance?: number;
    signal?: AbortSignal;
    check?: () => void;
  } = {},
): { groups: Uint32Array; count: number } {
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    options.check?.();
  };
  check();
  const tolerance = options.tolerance ?? 1e-6;
  if (
    vertices.length % 3 ||
    triangles.length % 3 ||
    !Number.isFinite(tolerance) ||
    tolerance <= 0
  )
    throw new Error("Invalid indexed component geometry.");
  const faces = triangles.length / 3;
  const edges = new MeshEdgeIndex(triangles);
  const parent = new Uint32Array(faces);
  for (let face = 0; face < faces; face++) {
    if ((face & 4095) === 0) check();
    parent[face] = face;
    const a = triangles[face * 3],
      b = triangles[face * 3 + 1],
      c = triangles[face * 3 + 2];
    if (
      a * 3 + 2 >= vertices.length ||
      b * 3 + 2 >= vertices.length ||
      c * 3 + 2 >= vertices.length
    )
      throw new Error("Indexed component vertex is out of range.");
    const ax = vertices[a * 3],
      ay = vertices[a * 3 + 1],
      az = vertices[a * 3 + 2];
    const ux = vertices[b * 3] - ax,
      uy = vertices[b * 3 + 1] - ay,
      uz = vertices[b * 3 + 2] - az;
    const vx = vertices[c * 3] - ax,
      vy = vertices[c * 3 + 1] - ay,
      vz = vertices[c * 3 + 2] - az;
    if (
      a === b ||
      b === c ||
      c === a ||
      Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) <=
        tolerance * tolerance
    )
      continue;
    for (let corner = 0; corner < 3; corner++)
      edges.addCorner(face * 3 + corner);
  }
  const root = (face: number): number => {
    while (parent[face] !== face) {
      parent[face] = parent[parent[face]];
      face = parent[face];
    }
    return face;
  };
  const { offsets, corners } = edges.packCorners();
  for (let edge = 0; edge + 1 < offsets.length; edge++) {
    if ((edge & 4095) === 0) check();
    const first = root(Math.floor(corners[offsets[edge]] / 3));
    for (let i = offsets[edge] + 1; i < offsets[edge + 1]; i++) {
      const other = root(Math.floor(corners[i] / 3));
      const left = root(first);
      if (left !== other) parent[Math.max(left, other)] = Math.min(left, other);
    }
  }
  const ids = new Uint32Array(faces),
    groups = new Uint32Array(faces);
  let count = 0;
  for (let face = 0; face < faces; face++) {
    if ((face & 4095) === 0) check();
    const representative = root(face);
    if (!ids[representative]) ids[representative] = ++count;
    groups[face] = ids[representative] - 1;
  }
  check();
  return { groups, count };
}
