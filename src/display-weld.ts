/** Position-only equivalent of the display weld's 1e-6 quantization. Hash slots
 * reference the first encountered source corner; no per-vertex strings or JS arrays. */
export function weldDisplayPositions(input: ArrayLike<number>) {
  const p = input instanceof Float32Array ? input : Float32Array.from(input);
  if (p.length % 9)
    throw new Error("Smooth display requires complete triangles.");
  const count = p.length / 3,
    indices = new Uint32Array(count);
  let table: Uint32Array = new Uint32Array(1024),
    first: Uint32Array = new Uint32Array(Math.min(count, 1024)),
    unique = 0;
  const quant = (v: number) => (v * 1e6 + 0.5) | 0;
  const hash = (x: number, y: number, z: number) => {
    const h =
      Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791);
    return (h ^ (h >>> 16)) >>> 0;
  };
  const rehash = () => {
    if (table.length >= 0x40000000)
      throw new Error(
        "Display weld exceeds the available index address range.",
      );
    const next = new Uint32Array(table.length * 2),
      mask = next.length - 1;
    for (let id = 0; id < unique; id++) {
      const i = first[id] * 3;
      let slot = hash(quant(p[i]), quant(p[i + 1]), quant(p[i + 2])) & mask;
      while (next[slot]) slot = (slot + 1) & mask;
      next[slot] = id + 1;
    }
    table = next;
  };
  for (let corner = 0; corner < count; corner++) {
    const offset = corner * 3,
      x = quant(p[offset]),
      y = quant(p[offset + 1]),
      z = quant(p[offset + 2]);
    let slot = hash(x, y, z) & (table.length - 1),
      id = -1;
    while (table[slot]) {
      const candidate = table[slot] - 1,
        i = first[candidate] * 3;
      if (quant(p[i]) === x && quant(p[i + 1]) === y && quant(p[i + 2]) === z) {
        id = candidate;
        break;
      }
      slot = (slot + 1) & (table.length - 1);
    }
    if (id < 0) {
      if ((unique + 1) * 2 > table.length) {
        rehash();
        slot = hash(x, y, z) & (table.length - 1);
        while (table[slot]) slot = (slot + 1) & (table.length - 1);
      }
      if (unique === first.length) {
        const grown = new Uint32Array(
          Math.min(count, Math.max(1, first.length * 2)),
        );
        grown.set(first);
        first = grown;
      }
      id = unique++;
      first[id] = corner;
      table[slot] = id + 1;
    }
    indices[corner] = id;
  }
  const positions = new Float32Array(unique * 3);
  for (let id = 0; id < unique; id++) {
    const i = first[id] * 3;
    positions[id * 3] = p[i];
    positions[id * 3 + 1] = p[i + 1];
    positions[id * 3 + 2] = p[i + 2];
  }
  return { positions, indices };
}
