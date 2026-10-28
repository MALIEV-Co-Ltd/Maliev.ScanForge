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
  const parent = new Uint32Array(faces);
  const root = (face: number): number => {
    while (parent[face] !== face) {
      parent[face] = parent[parent[face]];
      face = parent[face];
    }
    return face;
  };
  // Components only need the first face using an edge. Join subsequent faces
  // immediately instead of retaining every incidence and packing it afterward.
  let slots = new Uint32Array(2048),
    edgeCount = 0;
  const hash = (a: number, b: number) => {
    const value = Math.imul(a, 73856093) ^ Math.imul(b, 19349663);
    return (value ^ (value >>> 16)) >>> 0;
  };
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
    for (let local = 0; local < 3; local++) {
      const corner = face * 3 + local;
      const from = triangles[corner],
        to = triangles[face * 3 + ((local + 1) % 3)];
      const u = Math.min(from, to),
        v = Math.max(from, to);
      let slot = hash(u, v) & (slots.length - 1);
      while (slots[slot]) {
        const first = slots[slot] - 1,
          base = first - (first % 3);
        const x = triangles[first],
          y = triangles[base + ((first + 1) % 3)];
        if (u === Math.min(x, y) && v === Math.max(x, y)) break;
        slot = (slot + 1) & (slots.length - 1);
      }
      if (slots[slot]) {
        const left = root(Math.floor((slots[slot] - 1) / 3));
        const right = root(face);
        if (left !== right)
          parent[Math.max(left, right)] = Math.min(left, right);
      } else {
        if ((edgeCount + 1) * 2 > slots.length) {
          const grown = new Uint32Array(slots.length * 2);
          for (let i = 0; i < slots.length; i++) {
            if ((i & 4095) === 0) check();
            const encoded = slots[i];
            if (!encoded) continue;
            const first = encoded - 1,
              base = first - (first % 3);
            const x = triangles[first],
              y = triangles[base + ((first + 1) % 3)];
            let next =
              hash(Math.min(x, y), Math.max(x, y)) & (grown.length - 1);
            while (grown[next]) next = (next + 1) & (grown.length - 1);
            grown[next] = encoded;
          }
          slots = grown;
          slot = hash(u, v) & (slots.length - 1);
          while (slots[slot]) slot = (slot + 1) & (slots.length - 1);
        }
        slots[slot] = corner + 1;
        edgeCount++;
      }
    }
  }
  // The edge table is no longer needed when assigning group IDs.
  slots = new Uint32Array(0);
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
