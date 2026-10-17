export class MeshFaceIndex {
  private readonly slots: Uint32Array;
  constructor(private readonly triangles: Uint32Array) {
    let capacity = 1024;
    while (capacity < (triangles.length / 3) * 2) {
      if (capacity >= 0x40000000)
        throw new RangeError("Mesh face index exceeds capacity.");
      capacity *= 2;
    }
    this.slots = new Uint32Array(capacity);
  }
  /** Returns true for a previously seen vertex triple, regardless of winding. */
  add(face: number): boolean {
    const i = face * 3,
      a = this.triangles[i],
      b = this.triangles[i + 1],
      c = this.triangles[i + 2];
    const low = Math.min(a, b, c),
      high = Math.max(a, b, c),
      middle = a + b + c - low - high;
    const hash =
      Math.imul(low, 73856093) ^
      Math.imul(middle, 19349663) ^
      Math.imul(high, 83492791);
    let slot = (hash ^ (hash >>> 16)) & (this.slots.length - 1);
    while (this.slots[slot]) {
      const j = (this.slots[slot] - 1) * 3,
        x = this.triangles[j],
        y = this.triangles[j + 1],
        z = this.triangles[j + 2];
      const lo = Math.min(x, y, z),
        hi = Math.max(x, y, z);
      if (low === lo && high === hi && middle === x + y + z - lo - hi)
        return true;
      slot = (slot + 1) & (this.slots.length - 1);
    }
    this.slots[slot] = face + 1;
    return false;
  }
}
/** CSR rows preserve face/corner insertion order, including repeated corners. */
export function vertexIncidence(triangles: Uint32Array, vertices: number) {
  const offsets = new Uint32Array(vertices + 1),
    faces = new Uint32Array(triangles.length);
  for (let i = 0; i < triangles.length; i++) {
    if (triangles[i] >= vertices)
      throw new RangeError("Invalid mesh vertex index.");
    offsets[triangles[i] + 1]++;
  }
  for (let vertex = 0; vertex < vertices; vertex++)
    offsets[vertex + 1] += offsets[vertex];
  const cursor = offsets.slice(0, vertices);
  for (let i = 0; i < triangles.length; i++)
    faces[cursor[triangles[i]]++] = Math.floor(i / 3);
  return { offsets, faces };
}
