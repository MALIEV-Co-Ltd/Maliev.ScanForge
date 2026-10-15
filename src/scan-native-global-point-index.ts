export interface GlobalPointTreeData {
  parent: Int32Array;
  high: Int32Array;
  low: Int32Array;
  axis: Int8Array;
  split: Float64Array;
  bounds: Float64Array;
  start: Uint32Array;
  count: Uint32Array;
  order: Uint32Array;
}
export interface GlobalPointNeighbour {
  id: number;
  distanceSquared: number;
}

/** Original bulk-built midpoint tree. Prepared XYZ carriers and node buffers
 * are immutable; each query owns its traversal state instead of mutating the
 * native node visit bytes. Geometry/eligibility edits require a new carrier.
 */
export class NativeGlobalPointIndex {
  readonly data: GlobalPointTreeData;
  readonly depth: number;
  constructor(
    readonly points: Float32Array,
    readonly leafCapacity = 48,
  ) {
    if (
      !(points instanceof Float32Array) ||
      points.length % 3 ||
      !Number.isInteger(leafCapacity) ||
      leafCapacity < 2 ||
      leafCapacity > 8192
    )
      throw new Error(
        "A global point index requires complete Float32 XYZ and a leaf capacity from 2 to 8192.",
      );
    const n = points.length / 3;
    const order = Uint32Array.from({ length: n }, (_, i) => i),
      scratch = new Uint32Array(n);
    const parent: number[] = [],
      high: number[] = [],
      low: number[] = [],
      axis: number[] = [],
      split: number[] = [],
      bounds: number[] = [],
      start: number[] = [],
      count: number[] = [];
    const node = (ancestor: number, begin: number, length: number) => {
      const id = parent.length;
      parent.push(ancestor);
      high.push(-1);
      low.push(-1);
      axis.push(-1);
      split.push(0);
      start.push(begin);
      count.push(length);
      const b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      for (let i = begin; i < begin + length; i++) {
        const p = order[i] * 3;
        for (let a = 0; a < 3; a++) {
          const v = points[p + a];
          if (!Number.isFinite(v))
            throw new Error("Global point coordinates must be finite.");
          // Retain first-equal min/max values, including signed zeros.
          if (v < b[a]) b[a] = v;
          if (v > b[a + 3]) b[a + 3] = v;
        }
      }
      bounds.push(...b);
      return id;
    };
    let depth = 0;
    const pending: number[] = [],
      levels: number[] = [];
    if (n) {
      pending.push(node(-1, 0, n));
      levels.push(1);
    }
    while (pending.length) {
      const id = pending.pop()!,
        level = levels.pop()!;
      depth = Math.max(depth, level);
      const length = count[id],
        begin = start[id];
      if (length <= leafCapacity) continue;
      const b = id * 6,
        dx = bounds[b + 3] - bounds[b],
        dy = bounds[b + 4] - bounds[b + 1],
        dz = bounds[b + 5] - bounds[b + 2];
      // Later-axis ties are native behavior, not a median partition heuristic.
      const a = dx <= dy ? (dy <= dz ? 2 : 1) : dz < dx ? 0 : 2;
      axis[id] = a;
      const middle = (bounds[b + a + 3] + bounds[b + a]) * 0.5;
      split[id] = middle;
      const extent = bounds[b + a + 3] - bounds[b + a];
      const goesLow = (i: number) =>
        extent >= 2 ** -23
          ? points[order[begin + i] * 3 + a] <= middle
          : i % 2 === 0;
      let lowCount = 0;
      for (let i = 0; i < length; i++) if (goesLow(i)) lowCount++;
      const highCount = length - lowCount;
      let h = begin,
        l = begin + highCount;
      for (let i = 0; i < length; i++)
        scratch[goesLow(i) ? l++ : h++] = order[begin + i];
      order.set(scratch.subarray(begin, begin + length), begin);
      // Allocation and processing order are both HIGH before LOW.
      high[id] = node(id, begin, highCount);
      low[id] = node(id, begin + highCount, lowCount);
      count[id] = 0;
      pending.push(low[id], high[id]);
      levels.push(level + 1, level + 1);
    }
    this.depth = depth;
    this.data = {
      parent: Int32Array.from(parent),
      high: Int32Array.from(high),
      low: Int32Array.from(low),
      axis: Int8Array.from(axis),
      split: Float64Array.from(split),
      bounds: Float64Array.from(bounds),
      start: Uint32Array.from(start),
      count: Uint32Array.from(count),
      order,
    };
  }

  private query(point: readonly number[], radius: number) {
    if (
      point.length !== 3 ||
      !point.every(Number.isFinite) ||
      !Number.isFinite(radius) ||
      radius < 0
    )
      throw new Error(
        "Global point queries require finite XYZ and a nonnegative finite radius.",
      );
  }

  private visit(
    point: readonly number[],
    radius: () => number,
    leaf: (id: number) => void,
  ) {
    const d = this.data;
    const pending = d.parent.length ? [0] : [];
    while (pending.length) {
      let id = pending.pop()!;
      if (id < 0) {
        id = -id - 1;
        const p = d.parent[id],
          a = d.axis[p];
        const boundary = d.bounds[id * 6 + a + (d.low[p] === id ? 3 : 0)];
        if (radius() <= Math.abs(point[a] - boundary)) continue;
      }
      if (d.low[id] < 0) {
        leaf(id);
        continue;
      }
      const below = point[d.axis[id]] <= d.split[id];
      const near = below ? d.low[id] : d.high[id],
        far = below ? d.high[id] : d.low[id];
      // Negative IDs defer the far-bound check until the near subtree has
      // had an opportunity to shrink the current query radius.
      pending.push(-far - 1, near);
    }
  }

  closest(point: readonly number[], radius: number) {
    this.query(point, radius);
    let id = -1,
      distance = radius,
      bestSquared = radius * radius;
    const d = this.data;
    this.visit(
      point,
      () => distance,
      (node) => {
        const end = d.start[node] + d.count[node];
        for (let i = d.start[node]; i < end; i++) {
          const p = d.order[i] * 3,
            x = this.points[p] - point[0],
            y = this.points[p + 1] - point[1],
            z = this.points[p + 2] - point[2];
          const squared = x * x + y * y + z * z;
          if (squared < bestSquared) {
            bestSquared = squared;
            distance = Math.sqrt(squared);
            id = d.order[i];
          }
        }
      },
    );
    return { id, distance };
  }

  neighbours(point: readonly number[], radius: number): GlobalPointNeighbour[] {
    this.query(point, radius);
    const q = point.map(Math.fround),
      f = Math.fround,
      matches: GlobalPointNeighbour[] = [];
    radius = f(radius);
    if (!q.every(Number.isFinite) || !Number.isFinite(radius))
      throw new Error("Radius queries require finite Float32 inputs.");
    let squaredRadius = f(radius * radius);
    const d = this.data;
    this.visit(
      q,
      () => radius,
      (node) => {
        const end = d.start[node] + d.count[node];
        for (let i = d.start[node]; i < end; i++) {
          const id = d.order[i],
            p = id * 3,
            x = f(this.points[p] - q[0]),
            y = f(this.points[p + 1] - q[1]),
            z = f(this.points[p + 2] - q[2]);
          // Assembly widens X before squaring, but squares Y/Z in Float32.
          // Both sums and list comparisons are Double; only stored list distances
          // round back to Float32. Comparing rounded candidates changes tie order.
          const candidate = f(y * y) + x * x + f(z * z);
          const distanceSquared = f(candidate);
          if (!(candidate < squaredRadius)) continue;
          const before = matches.findIndex(
            (m) => candidate < m.distanceSquared,
          );
          if (before < 0) matches.push({ id, distanceSquared });
          else {
            matches.splice(before, 0, { id, distanceSquared });
            // The native append path never trims. Even this branch removes only
            // one item when an earlier append has already taken the count past 25.
            if (matches.length > 25) {
              matches.pop();
              radius = f(
                Math.sqrt(matches[matches.length - 1].distanceSquared),
              );
              squaredRadius = f(radius * radius);
            }
          }
        }
      },
    );
    return matches;
  }

  /** Structural diagnostics only; queries never write these buffers. */
  snapshot() {
    const d = this.data;
    return Array.from(d.parent, (parent, id) => ({
      parent,
      high: d.high[id],
      low: d.low[id],
      axis: d.axis[id],
      split: d.split[id],
      bounds: Array.from(d.bounds.subarray(id * 6, id * 6 + 6)),
      points: Array.from(
        d.order.subarray(d.start[id], d.start[id] + d.count[id]),
      ),
    }));
  }
}

const cache = new WeakMap<Float32Array, Map<number, NativeGlobalPointIndex>>();
export function nativeGlobalPointIndex(
  points: Float32Array,
  leafCapacity = 48,
) {
  let capacities = cache.get(points);
  if (!capacities) {
    capacities = new Map();
    cache.set(points, capacities);
  }
  let tree = capacities.get(leafCapacity);
  if (!tree) {
    tree = new NativeGlobalPointIndex(points, leafCapacity);
    capacities.set(leafCapacity, tree);
  }
  return tree;
}
