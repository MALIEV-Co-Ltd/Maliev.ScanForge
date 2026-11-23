type SeamOptions = {
  signal?: AbortSignal;
  maxWork?: number;
  maxTypedBytes?: number;
  check?: () => void;
  retainFaceParents?: boolean;
  preciseCoordinates?: boolean;
};
type SeamResult<V> = {
  vertices: V;
  triangles: Uint32Array;
  faceParents?: Uint32Array;
};

export function materializeFiniteSeams(
  source: Float32Array | Float64Array,
  triangles: Uint32Array,
  cuts: Uint32Array,
  options: SeamOptions & { preciseCoordinates: true },
): SeamResult<number[]>;
export function materializeFiniteSeams(
  source: Float32Array,
  triangles: Uint32Array,
  cuts: Uint32Array,
  options?: SeamOptions & { preciseCoordinates?: false },
): SeamResult<Float32Array>;
/** Experimental indexed seam construction. Allocation allowance excludes JS maps. */
export function materializeFiniteSeams(
  source: Float32Array | Float64Array,
  triangles: Uint32Array,
  cuts: Uint32Array,
  options: SeamOptions = {},
): SeamResult<Float32Array | number[]> {
  if (source.length % 3 || triangles.length % 3 || cuts.length % 2)
    throw new Error("Finite seam geometry is incomplete.");
  const limit =
    options.maxWork ?? 2_000_000 + triangles.length * 100 + cuts.length * 40;
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("Finite seam work budget is invalid.");
  let work = 0;
  const tick = () => {
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    options.check?.();
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    if (++work > limit) throw new Error("Finite seam work budget exceeded.");
  };
  tick();
  const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const vertexCount = source.length / 3;
  for (let i = 0; i < source.length; i++) {
    if ((i & 4095) === 0) tick();
    if (!Number.isFinite(source[i]))
      throw new Error("Finite seam coordinates must be finite.");
  }
  const addedVertices: number[] = [];
  const midpoint = new Map<string, number>();
  const splitEdges = new Set<string>();
  const cutVertices = new Set<number>();
  for (let i = 0; i < cuts.length; i += 2) {
    tick();
    const a = cuts[i],
      b = cuts[i + 1],
      k = key(a, b);
    if (a >= vertexCount || b >= vertexCount || a === b)
      throw new Error("Finite seam edge is invalid.");
    if (midpoint.has(k)) continue;
    const m = vertexCount + addedVertices.length / 3;
    const p = [0, 1, 2].map((axis) => {
      const value = (source[3 * a + axis] + source[3 * b + axis]) / 2;
      return options.preciseCoordinates ? value : Math.fround(value);
    });
    if ([a, b].some((id) => p.every((v, axis) => v === source[id * 3 + axis])))
      throw new Error(
        "Finite seam midpoint cannot be represented at output precision.",
      );
    addedVertices.push(...p);
    cutVertices.add(a);
    cutVertices.add(b);
    cutVertices.add(m);
    midpoint.set(k, m);
    splitEdges.add(key(a, m));
    splitEdges.add(key(m, b));
  }
  const expandedVertexCount = vertexCount + addedVertices.length / 3;
  let faceSlots = triangles.length;
  const countedCuts = new Set<string>();
  for (let f = 0; f < triangles.length; f += 3) {
    tick();
    const a = triangles[f],
      b = triangles[f + 1],
      c = triangles[f + 2];
    if (
      a >= vertexCount ||
      b >= vertexCount ||
      c >= vertexCount ||
      a === b ||
      b === c ||
      c === a
    )
      throw new Error("Finite seam triangle indices are invalid.");
    for (const [start, end] of [
      [a, b],
      [b, c],
      [c, a],
    ]) {
      const k = key(start, end);
      if (midpoint.has(k)) {
        faceSlots += 3;
        countedCuts.add(k);
      }
    }
  }
  if (countedCuts.size !== midpoint.size)
    throw new Error("Finite seam edge is missing.");
  if (faceSlots >= 0xffffffff || expandedVertexCount >= 0xffffffff)
    throw new Error("Finite seam index capacity exceeded.");
  // Includes the face buffer, parent, edge-sort buffers, mapping, output
  // indices and worst-case output coordinates, plus the per-vertex table. The
  // number-array estimate covers its numeric payload, not engine overhead.
  const typedBytes =
    faceSlots * (options.preciseCoordinates ? 48 : 36) +
    expandedVertexCount * 4 +
    (options.retainFaceParents ? (faceSlots / 3) * 4 : 0);
  const allowance = options.maxTypedBytes ?? Number.MAX_SAFE_INTEGER;
  if (
    !Number.isSafeInteger(allowance) ||
    allowance < 0 ||
    typedBytes > allowance
  )
    throw new Error("Finite seam typed memory budget exceeded.");
  const faces = new Uint32Array(faceSlots);
  const faceParents = options.retainFaceParents
    ? new Uint32Array(faceSlots / 3)
    : undefined;
  let faceOffset = 0;
  const seenCuts = new Set<string>();
  for (let f = 0; f < triangles.length; f += 3) {
    tick();
    const original = [triangles[f], triangles[f + 1], triangles[f + 2]];
    if (
      original.some((id) => id >= vertexCount) ||
      new Set(original).size !== 3
    )
      throw new Error("Finite seam triangle indices are invalid.");
    let parts = [original];
    for (let edge = 0; edge < 3; edge++) {
      const a = original[edge],
        b = original[(edge + 1) % 3],
        k = key(a, b),
        m = midpoint.get(k);
      if (m === undefined) continue;
      seenCuts.add(k);
      const next: number[][] = [];
      for (const part of parts) {
        tick();
        const side = part.findIndex(
          (id, i) =>
            (id === a && part[(i + 1) % 3] === b) ||
            (id === b && part[(i + 1) % 3] === a),
        );
        if (side < 0) next.push(part);
        else {
          const start = part[side],
            end = part[(side + 1) % 3],
            third = part[(side + 2) % 3];
          next.push([start, m, third], [m, end, third]);
        }
      }
      parts = next;
    }
    if (parts.length > 1) {
      const point = (id: number) => {
        const values = id < vertexCount ? source : addedVertices;
        const offset = (id < vertexCount ? id : id - vertexCount) * 3;
        return [values[offset], values[offset + 1], values[offset + 2]];
      };
      const normal = (ids: number[]) => {
        const [a, b, c] = ids.map(point);
        const u = b.map((v, axis) => v - a[axis]);
        const v = c.map((value, axis) => value - a[axis]);
        return [
          u[1] * v[2] - u[2] * v[1],
          u[2] * v[0] - u[0] * v[2],
          u[0] * v[1] - u[1] * v[0],
        ];
      };
      const reference = normal(original);
      for (const part of parts) {
        tick();
        const result = normal(part);
        const orientation = result.reduce(
          (sum, value, axis) => sum + value * reference[axis],
          0,
        );
        if (!Number.isFinite(orientation) || orientation <= 0)
          throw new Error(
            "Finite seam face collapses or reverses at Float32 precision.",
          );
      }
    }
    for (const part of parts) {
      if (faceParents) faceParents[faceOffset / 3] = f / 3;
      faces.set(part, faceOffset);
      faceOffset += 3;
    }
  }
  if (seenCuts.size !== midpoint.size)
    throw new Error("Finite seam edge is missing.");
  if (faceOffset !== faceSlots)
    throw new Error("Finite seam face count is inconsistent.");
  const parent = Uint32Array.from({ length: faces.length }, (_, i) => i);
  const root = (i: number): number => {
    while (parent[i] !== i) {
      tick();
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  let order = Uint32Array.from({ length: faces.length }, (_, i) => i);
  let scratch = new Uint32Array(faces.length);
  const next = (slot: number) => slot - (slot % 3) + (((slot % 3) + 1) % 3);
  const min = (slot: number) => Math.min(faces[slot], faces[next(slot)]);
  const max = (slot: number) => Math.max(faces[slot], faces[next(slot)]);
  const compare = (a: number, b: number) =>
    min(a) - min(b) || max(a) - max(b) || a - b;
  for (let width = 1; width < order.length; width *= 2) {
    for (let start = 0; start < order.length; start += width * 2) {
      const middle = Math.min(start + width, order.length),
        end = Math.min(start + width * 2, order.length);
      let i = start,
        j = middle;
      for (let k = start; k < end; k++) {
        tick();
        scratch[k] =
          j >= end || (i < middle && compare(order[i], order[j]) <= 0)
            ? order[i++]
            : order[j++];
      }
    }
    [order, scratch] = [scratch, order];
  }
  for (let i = 0; i < order.length;) {
    tick();
    const lo = min(order[i]),
      hi = max(order[i]);
    let end = i + 1;
    while (
      end < order.length &&
      min(order[end]) === lo &&
      max(order[end]) === hi
    ) {
      tick();
      end++;
    }
    if (end - i > 2) throw new Error("Finite seam edge is non-manifold.");
    if (end - i === 2 && !splitEdges.has(key(lo, hi))) {
      const first = order[i],
        second = order[i + 1];
      for (const a of [first, next(first)]) {
        const b = faces[a] === faces[second] ? second : next(second);
        if (faces[a] !== faces[b])
          throw new Error("Finite seam edge indices are inconsistent.");
        const x = root(a),
          y = root(b);
        if (x !== y) parent[Math.max(x, y)] = Math.min(x, y);
      }
    }
    i = end;
  }
  // A vertex that is unrelated to any cut keeps its authored identity even
  // when its incident triangles meet only at that vertex.
  const firstCorner = new Uint32Array(expandedVertexCount);
  for (let slot = 0; slot < faces.length; slot++) {
    tick();
    const vertex = faces[slot];
    if (cutVertices.has(vertex)) continue;
    const first = firstCorner[vertex];
    if (first === 0) firstCorner[vertex] = slot + 1;
    else {
      const x = root(first - 1),
        y = root(slot);
      if (x !== y) parent[Math.max(x, y)] = Math.min(x, y);
    }
  }
  // The edge sort is complete; reuse its scratch storage for output indices.
  const outputTriangles = scratch;
  for (let slot = 0; slot < faces.length; slot++) {
    tick();
    outputTriangles[slot] = root(slot);
  }
  // All roots are now materialized, so the union-find buffer can serve as
  // the root-to-output mapping without allocating another corner-sized array.
  parent.fill(0);
  let outputVertexCount = 0;
  for (let slot = 0; slot < faces.length; slot++) {
    if ((slot & 4095) === 0) tick();
    const r = outputTriangles[slot];
    let id = parent[r];
    if (id === 0) {
      id = ++outputVertexCount;
      parent[r] = id;
    }
    outputTriangles[slot] = id - 1;
  }
  // Most corners share vertices. Allocate only the established vertex count
  // rather than reserving three coordinates for every triangle corner.
  const outputVertices = options.preciseCoordinates
    ? new Array<number>(outputVertexCount * 3)
    : new Float32Array(outputVertexCount * 3);
  for (let slot = 0; slot < faces.length; slot++) {
    if ((slot & 4095) === 0) tick();
    const vertex = faces[slot];
    const values = vertex < vertexCount ? source : addedVertices;
    const offset = (vertex < vertexCount ? vertex : vertex - vertexCount) * 3;
    const target = outputTriangles[slot] * 3;
    outputVertices[target] = values[offset];
    outputVertices[target + 1] = values[offset + 1];
    outputVertices[target + 2] = values[offset + 2];
  }
  tick();
  return {
    vertices: outputVertices,
    triangles: outputTriangles,
    ...(faceParents ? { faceParents } : {}),
  };
}
