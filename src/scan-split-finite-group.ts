type Triangle = readonly [number, number, number];
type Edge = readonly [number, number];
const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

/** Compact indexed grouping. maxTypedBytes limits typed-array storage, not total process memory. */
export function groupFiniteTrianglesCompact(
  triangles: Uint32Array,
  cuts: Uint32Array,
  options: {
    signal?: AbortSignal;
    maxWork?: number;
    maxTypedBytes?: number;
    check?: () => void;
    partition?: Uint8Array;
  } = {},
): Uint32Array {
  if (triangles.length % 3 || cuts.length % 2 || triangles.length > 0xffffffff)
    throw new Error("Finite grouping indices are invalid.");
  const n = triangles.length / 3;
  const estimatedBytes = n * 28;
  const maxBytes = options.maxTypedBytes ?? Number.MAX_SAFE_INTEGER;
  if (
    !Number.isSafeInteger(maxBytes) ||
    maxBytes < 0 ||
    estimatedBytes > maxBytes
  )
    throw new Error("Finite grouping memory budget exceeded.");
  const limit =
    options.maxWork ??
    2_000_000 +
      triangles.length *
        (4 + 2 * Math.ceil(Math.log2(Math.max(2, triangles.length)))) +
      cuts.length;
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("Finite grouping work budget is invalid.");
  let work = 0;
  const tick = () => {
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    options.check?.();
    if (++work > limit)
      throw new Error("Finite grouping work budget exceeded.");
  };
  tick();
  if (options.partition) {
    if (options.partition.length !== n)
      throw new Error("Finite grouping partition is invalid.");
    for (const value of options.partition) {
      tick();
      if (value !== 0 && value !== 1)
        throw new Error("Finite grouping partition is invalid.");
    }
  }
  const cutKeys = new Set<string>();
  for (let i = 0; i < cuts.length; i += 2) {
    tick();
    if (cuts[i] === cuts[i + 1])
      throw new Error("Finite cut edge is invalid or missing.");
    cutKeys.add(edgeKey(cuts[i], cuts[i + 1]));
  }
  let order = new Uint32Array(triangles.length),
    scratch = new Uint32Array(triangles.length);
  const parent = new Uint32Array(n);
  for (let f = 0; f < n; f++) {
    tick();
    const a = triangles[3 * f],
      b = triangles[3 * f + 1],
      c = triangles[3 * f + 2];
    if (a === b || b === c || c === a)
      throw new Error("Finite grouping triangle indices are invalid.");
    parent[f] = f;
    order[3 * f] = 3 * f;
    order[3 * f + 1] = 3 * f + 1;
    order[3 * f + 2] = 3 * f + 2;
  }
  const endpointMin = (edge: number) => {
    const base = edge - (edge % 3),
      j = edge % 3;
    const a = triangles[edge],
      b = triangles[base + ((j + 1) % 3)];
    return Math.min(a, b);
  };
  const endpointMax = (edge: number) => {
    const base = edge - (edge % 3),
      j = edge % 3;
    const a = triangles[edge],
      b = triangles[base + ((j + 1) % 3)];
    return Math.max(a, b);
  };
  const compare = (x: number, y: number) => {
    return (
      endpointMin(x) - endpointMin(y) ||
      endpointMax(x) - endpointMax(y) ||
      x - y
    );
  };
  for (let width = 1; width < order.length; width *= 2) {
    for (let start = 0; start < order.length; start += 2 * width) {
      const mid = Math.min(start + width, order.length),
        end = Math.min(start + 2 * width, order.length);
      let i = start,
        j = mid;
      for (let k = start; k < end; k++) {
        tick();
        scratch[k] =
          j >= end || (i < mid && compare(order[i], order[j]) <= 0)
            ? order[i++]
            : order[j++];
      }
    }
    [order, scratch] = [scratch, order];
  }
  const root = (f: number) => {
    while (parent[f] !== f) {
      tick();
      parent[f] = parent[parent[f]];
      f = parent[f];
    }
    return f;
  };
  for (let i = 0; i < order.length;) {
    tick();
    const a = endpointMin(order[i]),
      b = endpointMax(order[i]);
    let end = i + 1;
    while (end < order.length) {
      tick();
      const c = endpointMin(order[end]),
        d = endpointMax(order[end]);
      if (a !== c || b !== d) break;
      end++;
    }
    if (end - i > 2)
      throw new Error(
        `Finite grouping encountered a non-manifold edge ${a}:${b} with ${end - i} incident faces.`,
      );
    const cut = cutKeys.size > 0 && cutKeys.delete(edgeKey(a, b));
    if (end - i === 2) {
      const first = order[i],
        second = order[i + 1];
      const third = (e: number) => triangles[e - (e % 3) + (((e % 3) + 2) % 3)];
      if (third(first) === third(second))
        throw new Error("Finite grouping encountered a duplicate facet.");
      if (
        !cut &&
        (!options.partition ||
          options.partition[Math.floor(first / 3)] ===
            options.partition[Math.floor(second / 3)])
      ) {
        const x = root(Math.floor(first / 3)),
          y = root(Math.floor(second / 3));
        if (x !== y) parent[Math.max(x, y)] = Math.min(x, y);
      }
    }
    i = end;
  }
  if (cutKeys.size) throw new Error("Finite cut edge is invalid or missing.");
  for (let i = 0; i < n; i++) {
    tick();
    parent[i] = root(i);
  }
  return parent;
}

/** Partition indexed triangles across every shared edge except explicit finite cuts.
 * Point-only contacts remain separate; callers must validate vertex-manifold policy.
 */
export function groupFiniteTriangles(
  triangles: readonly Triangle[],
  cuts: readonly Edge[],
  options: { signal?: AbortSignal; maxWork?: number } = {},
): number[][] {
  const limit = options.maxWork ?? 2_000_000;
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("Finite grouping work budget is invalid.");
  let work = 0;
  const tick = () => {
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    if (++work > limit)
      throw new Error("Finite grouping work budget exceeded.");
  };
  tick();
  const valid = (n: number) => Number.isSafeInteger(n) && n >= 0;
  const edges = new Map<string, number[]>();
  const faces = new Set<string>();
  for (let i = 0; i < triangles.length; i++) {
    tick();
    const t = triangles[i];
    if (t.length !== 3 || !t.every(valid) || new Set(t).size !== 3)
      throw new Error("Finite grouping triangle indices are invalid.");
    const faceKey = [...t].sort((a, b) => a - b).join(":");
    if (faces.has(faceKey))
      throw new Error("Finite grouping encountered a duplicate facet.");
    faces.add(faceKey);
    for (let j = 0; j < 3; j++) {
      tick();
      const key = edgeKey(t[j], t[(j + 1) % 3]),
        uses = edges.get(key) ?? [];
      uses.push(i);
      if (uses.length > 2)
        throw new Error("Finite grouping encountered a non-manifold edge.");
      edges.set(key, uses);
    }
  }
  const cutKeys = new Set<string>();
  for (const [a, b] of cuts) {
    tick();
    if (!valid(a) || !valid(b) || a === b || !edges.has(edgeKey(a, b)))
      throw new Error("Finite cut edge is invalid or missing.");
    cutKeys.add(edgeKey(a, b));
  }
  const adjacent = Array.from(
    { length: triangles.length },
    () => [] as number[],
  );
  for (const [key, uses] of edges) {
    tick();
    if (uses.length === 2 && !cutKeys.has(key)) {
      adjacent[uses[0]].push(uses[1]);
      adjacent[uses[1]].push(uses[0]);
    }
  }
  const seen = new Uint8Array(triangles.length),
    groups: number[][] = [];
  for (let i = 0; i < triangles.length; i++) {
    tick();
    if (seen[i]) continue;
    const group = [i];
    seen[i] = 1;
    for (let n = 0; n < group.length; n++)
      for (const neighbor of adjacent[group[n]]) {
        tick();
        if (!seen[neighbor]) {
          seen[neighbor] = 1;
          group.push(neighbor);
        }
      }
    group.sort((a, b) => a - b);
    groups.push(group);
  }
  return groups;
}
