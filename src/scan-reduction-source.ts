import { MeshFaceIndex } from "./mesh-face-index";
import {
  ReductionBudgetError,
  COMPACT_REDUCTION_BUDGET_BYTES,
} from "./scan-reduction-storage";

function slots(entries: number) {
  let capacity = 1024;
  while (capacity < entries) {
    if (capacity >= 0x40000000) throw new ReductionBudgetError();
    capacity *= 2;
  }
  return capacity;
}
export function reductionValidationBytes(vertices: number, faces: number) {
  return (
    12 * faces + 4 * vertices + 5 * slots(6 * faces) + 4 * slots(2 * faces)
  );
}

/** Same rejection gate as full diagnostics; triangle-corner unions detect disconnected fans.
 * After duplicate/degenerate/edge/winding rejection, a connected vertex link has
 * degree at most two and is necessarily one path or cycle. No component/loop objects.
 */
export function validateReductionSource(
  vertices: Float64Array,
  triangles: Uint32Array,
  check?: () => void,
  limitBytes = COMPACT_REDUCTION_BUDGET_BYTES,
) {
  check?.();
  const count = triangles.length,
    vertexCount = vertices.length / 3;
  if (reductionValidationBytes(vertexCount, count / 3) > limitBytes)
    throw new ReductionBudgetError();
  const edges = new Uint32Array(slots(count * 2)),
    uses = new Uint8Array(edges.length),
    parent = new Uint32Array(count),
    first = new Uint32Array(vertexCount),
    seen = new MeshFaceIndex(triangles);
  const invalid = () => {
    throw new Error(
      "Repair invalid or nonmanifold mesh topology before using this tool.",
    );
  };
  const root = (corner: number): number => {
    while (parent[corner] !== corner) {
      parent[corner] = parent[parent[corner]];
      corner = parent[corner];
    }
    return corner;
  };
  const join = (a: number, b: number) => {
    parent[root(a)] = root(b);
  };
  for (let corner = 0; corner < count; corner++) {
    if (corner % 4096 === 0) check?.();
    parent[corner] = corner;
  }
  for (let base = 0; base < count; base += 3) {
    if (base % 12288 === 0) check?.();
    const a = triangles[base],
      b = triangles[base + 1],
      c = triangles[base + 2];
    if (a >= vertexCount || b >= vertexCount || c >= vertexCount) invalid();
    const abx = vertices[b * 3] - vertices[a * 3],
      aby = vertices[b * 3 + 1] - vertices[a * 3 + 1],
      abz = vertices[b * 3 + 2] - vertices[a * 3 + 2],
      acx = vertices[c * 3] - vertices[a * 3],
      acy = vertices[c * 3 + 1] - vertices[a * 3 + 1],
      acz = vertices[c * 3 + 2] - vertices[a * 3 + 2];
    if (
      a === b ||
      b === c ||
      c === a ||
      Math.hypot(
        aby * acz - abz * acy,
        abz * acx - abx * acz,
        abx * acy - aby * acx,
      ) <= 1e-12 ||
      seen.add(base / 3)
    )
      invalid();
    for (let k = 0; k < 3; k++) {
      const corner = base + k,
        next = base + ((k + 1) % 3),
        from = triangles[corner],
        to = triangles[next],
        low = Math.min(from, to),
        high = Math.max(from, to),
        hash = Math.imul(low, 73856093) ^ Math.imul(high, 19349663);
      let slot = (hash ^ (hash >>> 16)) & (edges.length - 1);
      while (edges[slot]) {
        const other = edges[slot] - 1,
          otherNext = other - (other % 3) + ((other + 1) % 3);
        const u = triangles[other],
          v = triangles[otherNext];
        if (Math.min(u, v) === low && Math.max(u, v) === high) {
          if (uses[slot] === 2 || from === u) invalid();
          uses[slot] = 2;
          join(corner, otherNext);
          join(next, other);
          break;
        }
        slot = (slot + 1) & (edges.length - 1);
      }
      if (!edges[slot]) {
        edges[slot] = corner + 1;
        uses[slot] = 1;
      }
    }
  }
  for (let corner = 0; corner < count; corner++) {
    if (corner % 4096 === 0) check?.();
    const vertex = triangles[corner],
      component = root(corner) + 1;
    if (first[vertex] && first[vertex] !== component) invalid();
    first[vertex] = component;
  }
  check?.();
}
