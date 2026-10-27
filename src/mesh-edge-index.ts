import type { EdgeUse } from "./mesh-processing";

/** Insertion-ordered immutable edge directory. Rows are value snapshots, not
 * stable object identities. Resident caches use the directory identity, never
 * transient row references; appended edits can use an immutable overlay. */
export class MeshEdgeIndex implements ReadonlyMap<string, EdgeUse[]> {
  private slots: Uint32Array = new Uint32Array(2048);
  private first: Uint32Array = new Uint32Array(1024);
  private last: Uint32Array = new Uint32Array(1024);
  private readonly next: Uint32Array;
  private count = 0;
  private corners = 0;
  readonly [Symbol.toStringTag] = "MeshEdgeIndex";

  constructor(private readonly triangles: Uint32Array) {
    this.next = new Uint32Array(triangles.length);
  }
  get size(): number {
    return this.count;
  }
  get useCount(): number {
    return this.corners;
  }
  /** Ordered CSR snapshot without transient keys, arrays or EdgeUse objects. */
  packCorners(): {
    offsets: Uint32Array<ArrayBuffer>;
    corners: Uint32Array<ArrayBuffer>;
  } {
    const offsets = new Uint32Array(this.count + 1);
    const corners = new Uint32Array(this.corners);
    let cursor = 0;
    for (let edge = 0; edge < this.count; edge++) {
      offsets[edge] = cursor;
      for (
        let encoded = this.first[edge] + 1;
        encoded;
        encoded = this.next[encoded - 1]
      )
        corners[cursor++] = encoded - 1;
    }
    offsets[this.count] = cursor;
    return { offsets, corners };
  }
  private endpoints(corner: number): [number, number] {
    const base = corner - (corner % 3);
    return [this.triangles[corner], this.triangles[base + ((corner + 1) % 3)]];
  }
  private slot(a: number, b: number): number {
    const hash = Math.imul(a, 73856093) ^ Math.imul(b, 19349663);
    let slot = (hash ^ (hash >>> 16)) & (this.slots.length - 1);
    while (this.slots[slot]) {
      const corner = this.first[this.slots[slot] - 1],
        base = corner - (corner % 3);
      const from = this.triangles[corner],
        to = this.triangles[base + ((corner + 1) % 3)];
      if (Math.min(from, to) === a && Math.max(from, to) === b) break;
      slot = (slot + 1) & (this.slots.length - 1);
    }
    return slot;
  }
  /** Builder only. Each directed triangle corner must be added once. */
  addCorner(corner: number): void {
    this.corners++;
    const base = corner - (corner % 3),
      from = this.triangles[corner],
      to = this.triangles[base + ((corner + 1) % 3)];
    const a = Math.min(from, to),
      b = Math.max(from, to);
    let slot = this.slot(a, b),
      encoded = this.slots[slot];
    if (encoded) {
      const edge = encoded - 1;
      this.next[this.last[edge]] = corner + 1;
      this.last[edge] = corner;
      return;
    }
    if (this.count === this.first.length) {
      const capacity = this.first.length * 2;
      const first = new Uint32Array(capacity),
        last = new Uint32Array(capacity);
      first.set(this.first);
      last.set(this.last);
      this.first = first;
      this.last = last;
      this.slots = new Uint32Array(capacity * 2);
      for (let edge = 0; edge < this.count; edge++) {
        const [u, v] = this.endpoints(this.first[edge]);
        this.slots[this.slot(Math.min(u, v), Math.max(u, v))] = edge + 1;
      }
      slot = this.slot(a, b);
    }
    this.first[this.count] = corner;
    this.last[this.count] = corner;
    this.slots[slot] = ++this.count;
  }
  private edgeFor(key: string): number {
    const separator = key.indexOf(":"),
      a = Number(key.slice(0, separator)),
      b = Number(key.slice(separator + 1));
    if (
      separator < 1 ||
      !Number.isInteger(a) ||
      !Number.isInteger(b) ||
      a < 0 ||
      b > 0xffffffff ||
      a >= b ||
      `${a}:${b}` !== key
    )
      return -1;
    return this.slots[this.slot(a, b)] - 1;
  }
  private uses(edge: number): EdgeUse[] {
    const uses: EdgeUse[] = [];
    for (
      let encoded = this.first[edge] + 1;
      encoded;
      encoded = this.next[encoded - 1]
    ) {
      const corner = encoded - 1,
        [from, to] = this.endpoints(corner);
      uses.push({ face: Math.floor(corner / 3), from, to });
    }
    return uses;
  }
  get(key: string): EdgeUse[] | undefined {
    const edge = this.edgeFor(key);
    return edge < 0 ? undefined : this.uses(edge);
  }
  has(key: string): boolean {
    return this.edgeFor(key) >= 0;
  }
  *values(): MapIterator<EdgeUse[]> {
    for (let edge = 0; edge < this.count; edge++) yield this.uses(edge);
  }
  *keys(): MapIterator<string> {
    for (let edge = 0; edge < this.count; edge++) {
      const [a, b] = this.endpoints(this.first[edge]);
      yield a < b ? `${a}:${b}` : `${b}:${a}`;
    }
  }
  *entries(): MapIterator<[string, EdgeUse[]]> {
    let edge = 0;
    for (const key of this.keys()) yield [key, this.uses(edge++)];
  }
  [Symbol.iterator](): MapIterator<[string, EdgeUse[]]> {
    return this.entries();
  }
  forEach(
    callback: (
      value: EdgeUse[],
      key: string,
      map: ReadonlyMap<string, EdgeUse[]>,
    ) => void,
    thisArg?: unknown,
  ): void {
    for (const [key, uses] of this) callback.call(thisArg, uses, key, this);
  }
}

/** An immutable insertion-ordered edge overlay for appended triangles. */
class AppendedMeshEdges implements ReadonlyMap<string, EdgeUse[]> {
  readonly [Symbol.toStringTag] = "AppendedMeshEdges";
  readonly size: number;
  constructor(
    readonly base: ReadonlyMap<string, EdgeUse[]>,
    readonly overrides: Map<string, EdgeUse[]>,
  ) {
    let added = 0;
    for (const key of overrides.keys()) if (!base.has(key)) added++;
    this.size = base.size + added;
  }
  get(key: string): EdgeUse[] | undefined {
    return this.overrides.get(key) ?? this.base.get(key);
  }
  has(key: string): boolean {
    return this.overrides.has(key) || this.base.has(key);
  }
  *entries(): MapIterator<[string, EdgeUse[]]> {
    for (const [key, uses] of this.base.entries())
      yield [key, this.overrides.get(key) ?? uses];
    for (const [key, uses] of this.overrides)
      if (!this.base.has(key)) yield [key, uses];
  }
  *keys(): MapIterator<string> {
    for (const [key] of this.entries()) yield key;
  }
  *values(): MapIterator<EdgeUse[]> {
    for (const [, uses] of this.entries()) yield uses;
  }
  [Symbol.iterator](): MapIterator<[string, EdgeUse[]]> {
    return this.entries();
  }
  forEach(
    callback: (
      value: EdgeUse[],
      key: string,
      map: ReadonlyMap<string, EdgeUse[]>,
    ) => void,
    thisArg?: unknown,
  ): void {
    for (const [key, uses] of this) callback.call(thisArg, uses, key, this);
  }
}

/** Append directed corners without copying the entire existing edge index. */
export function appendMeshEdges(
  previous: ReadonlyMap<string, EdgeUse[]>,
  triangles: ArrayLike<number>,
  start: number,
  end = triangles.length,
  signal?: AbortSignal,
): ReadonlyMap<string, EdgeUse[]> {
  const base = previous instanceof AppendedMeshEdges ? previous.base : previous;
  const overrides = new Map(
    previous instanceof AppendedMeshEdges ? previous.overrides : [],
  );
  for (let corner = start; corner < end; corner++) {
    if ((corner - start) % 4096 === 0 && signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    const from = triangles[corner],
      to = triangles[corner - (corner % 3) + ((corner + 1) % 3)];
    const key = from < to ? `${from}:${to}` : `${to}:${from}`;
    const uses = overrides.get(key) ?? base.get(key) ?? [];
    overrides.set(key, [...uses, { face: Math.floor(corner / 3), from, to }]);
  }
  return new AppendedMeshEdges(base, overrides);
}
