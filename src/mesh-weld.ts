import type { Positions } from "./types";

/** Same first-matching representative and 27-cell order as mesh analysis.
 * Numeric cells avoid per-probe strings/arrays; full Float64 keys resolve hash collisions.
 * Storage grows with representatives, never with the coordinate range.
 */
export function weldMeshPositions(
  positions: Positions,
  tolerance: number,
  progress?: (fraction: number) => void,
): { vertices: Float64Array; triangles: Uint32Array } {
  if (!positions.length || positions.length % 9)
    throw new Error("Expected complete triangle coordinates.");
  if (!Number.isFinite(tolerance) || tolerance <= 0)
    throw new Error("Weld tolerance must be positive and finite.");
  progress?.(0);
  const corners = positions.length / 3;
  const triangles = new Uint32Array(corners);
  let capacity = Math.min(corners, 1024),
    count = 0,
    cells = 0;
  let vertices: Float64Array = new Float64Array(capacity * 3),
    next: Uint32Array = new Uint32Array(capacity);
  let head: Uint32Array = new Uint32Array(1024),
    tail: Uint32Array = new Uint32Array(1024);
  let keys: Float64Array = new Float64Array(1024 * 3);
  const ox = positions[0],
    oy = positions[1],
    oz = positions[2];
  const hash = (x: number, y: number, z: number) => {
    const h =
      Math.imul(x ^ (x / 4294967296), 73856093) ^
      Math.imul(y ^ (y / 4294967296), 19349663) ^
      Math.imul(z ^ (z / 4294967296), 83492791);
    return (h ^ (h >>> 16)) >>> 0;
  };
  const slotFor = (x: number, y: number, z: number) => {
    let slot = hash(x, y, z) & (head.length - 1);
    while (
      head[slot] &&
      (keys[slot * 3] !== x ||
        keys[slot * 3 + 1] !== y ||
        keys[slot * 3 + 2] !== z)
    )
      slot = (slot + 1) & (head.length - 1);
    return slot;
  };
  const growCells = (fraction: number) => {
    if (head.length >= 0x40000000)
      throw new Error("Mesh weld exceeds cell index capacity.");
    const oldHead = head,
      oldTail = tail,
      oldKeys = keys;
    head = new Uint32Array(oldHead.length * 2);
    tail = new Uint32Array(head.length);
    keys = new Float64Array(head.length * 3);
    for (let slot = 0; slot < oldHead.length; slot++) {
      if (slot % 16384 === 0) progress?.(fraction);
      if (oldHead[slot]) {
        const x = oldKeys[slot * 3],
          y = oldKeys[slot * 3 + 1],
          z = oldKeys[slot * 3 + 2],
          to = slotFor(x, y, z);
        keys[to * 3] = x;
        keys[to * 3 + 1] = y;
        keys[to * 3 + 2] = z;
        head[to] = oldHead[slot];
        tail[to] = oldTail[slot];
      }
    }
  };
  for (let i = 0; i < positions.length; i += 3) {
    if (i % 12288 === 0) progress?.(i / positions.length);
    const x = positions[i],
      y = positions[i + 1],
      z = positions[i + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z))
      throw new Error("Mesh coordinates must be finite.");
    const cx = Math.floor((x - ox) / tolerance),
      cy = Math.floor((y - oy) / tolerance),
      cz = Math.floor((z - oz) / tolerance);
    if (
      !Number.isSafeInteger(cx) ||
      !Number.isSafeInteger(cy) ||
      !Number.isSafeInteger(cz)
    )
      throw new Error(
        "Coordinate range exceeds weld precision; increase tolerance.",
      );
    let id = -1;
    search: for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const slot = slotFor(cx + dx, cy + dy, cz + dz);
          for (let encoded = head[slot]; encoded; encoded = next[encoded - 1]) {
            const candidate = encoded - 1;
            if (
              Math.hypot(
                vertices[candidate * 3] - x,
                vertices[candidate * 3 + 1] - y,
                vertices[candidate * 3 + 2] - z,
              ) <= tolerance
            ) {
              id = candidate;
              break search;
            }
          }
        }
    if (id < 0) {
      if (count === capacity) {
        capacity = Math.min(corners, capacity * 2);
        const grown = new Float64Array(capacity * 3);
        grown.set(vertices);
        vertices = grown;
        const links = new Uint32Array(capacity);
        links.set(next);
        next = links;
      }
      id = count++;
      vertices[id * 3] = x;
      vertices[id * 3 + 1] = y;
      vertices[id * 3 + 2] = z;
      if ((cells + 1) * 2 > head.length) growCells(i / positions.length);
      const slot = slotFor(cx, cy, cz);
      if (head[slot]) next[tail[slot] - 1] = id + 1;
      else {
        keys[slot * 3] = cx;
        keys[slot * 3 + 1] = cy;
        keys[slot * 3 + 2] = cz;
        head[slot] = id + 1;
        cells++;
      }
      tail[slot] = id + 1;
    }
    triangles[i / 3] = id;
  }
  return { vertices: vertices.slice(0, count * 3), triangles };
}
