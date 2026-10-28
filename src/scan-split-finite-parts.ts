/** Experimental compact parts; allowance covers typed buffers, not JS objects. */
export function partitionFiniteIndexedParts<T extends Float32Array | number[]>(
  vertices: T,
  triangles: Uint32Array,
  groups: Uint32Array,
  options: {
    signal?: AbortSignal;
    maxTypedBytes?: number;
    maxWork?: number;
    check?: () => void;
  } = {},
): {
  group: number;
  positions: T;
  indexedMesh: { vertices: T; triangles: Uint32Array };
}[] {
  const n = groups.length,
    count = vertices.length / 3;
  if (
    vertices.length % 3 ||
    triangles.length !== n * 3 ||
    n >= 0xffffffff ||
    count >= 0xffffffff
  )
    throw new Error(
      "Finite part geometry is incomplete or exceeds index capacity.",
    );
  const allowance = options.maxTypedBytes ?? Number.MAX_SAFE_INTEGER;
  // The array estimate includes numeric payload, not JavaScript engine overhead.
  const bytes = n * (Array.isArray(vertices) ? 172 : 100) + count * 8;
  if (!Number.isSafeInteger(allowance) || allowance < 0 || bytes > allowance)
    throw new Error("Finite part typed memory budget exceeded.");
  const limit = options.maxWork ?? 2_000_000 + triangles.length * 16;
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("Finite part work budget is invalid.");
  let work = 0;
  const tick = () => {
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    options.check?.();
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    if (++work > limit) throw new Error("Finite part work budget exceeded.");
  };
  tick();
  const counts = new Uint32Array(n),
    starts = new Uint32Array(n),
    cursors = new Uint32Array(n),
    order = new Uint32Array(n);
  for (let f = 0; f < n; f++) {
    tick();
    const group = groups[f];
    if (group >= n) throw new Error("Finite part group is invalid.");
    counts[group]++;
    for (let k = 0; k < 3; k++) {
      const id = triangles[3 * f + k];
      if (id >= count) throw new Error("Finite part vertex index is invalid.");
      if (
        ![vertices[id * 3], vertices[id * 3 + 1], vertices[id * 3 + 2]].every(
          Number.isFinite,
        )
      )
        throw new Error("Finite part coordinates must be finite.");
    }
  }
  let total = 0;
  for (let g = 0; g < n; g++) {
    tick();
    starts[g] = total;
    total += counts[g];
    cursors[g] = starts[g];
  }
  for (let f = 0; f < n; f++) {
    tick();
    order[cursors[groups[f]]++] = f;
  }
  const stamps = new Uint32Array(count),
    localIds = new Uint32Array(count);
  const output: {
    group: number;
    positions: T;
    indexedMesh: { vertices: T; triangles: Uint32Array };
  }[] = [];
  for (let g = 0; g < n; g++) {
    tick();
    if (!counts[g]) continue;
    const positions = Array.isArray(vertices)
      ? new Array<number>(counts[g] * 9)
      : new Float32Array(counts[g] * 9);
    const partVertices = Array.isArray(vertices)
      ? new Array<number>(counts[g] * 9)
      : new Float32Array(counts[g] * 9);
    const partTriangles = new Uint32Array(counts[g] * 3);
    let localCount = 0,
      corner = 0;
    for (let j = starts[g]; j < starts[g] + counts[g]; j++) {
      tick();
      const f = order[j];
      for (let k = 0; k < 3; k++) {
        tick();
        const original = triangles[f * 3 + k];
        if (stamps[original] !== g + 1) {
          stamps[original] = g + 1;
          localIds[original] = localCount++;
          for (let axis = 0; axis < 3; axis++)
            partVertices[localIds[original] * 3 + axis] =
              vertices[original * 3 + axis];
        }
        partTriangles[corner] = localIds[original];
        for (let axis = 0; axis < 3; axis++)
          positions[corner * 3 + axis] = vertices[original * 3 + axis];
        corner++;
      }
    }
    if (Array.isArray(partVertices)) partVertices.length = localCount * 3;
    output.push({
      group: g,
      positions: positions as T,
      indexedMesh: {
        vertices: (Array.isArray(partVertices)
          ? partVertices
          : partVertices.subarray(0, localCount * 3)) as T,
        triangles: partTriangles,
      },
    });
  }
  tick();
  return output;
}
