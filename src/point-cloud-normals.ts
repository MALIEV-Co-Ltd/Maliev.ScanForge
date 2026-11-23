import { nativeAlignmentEigen3 } from "./scan-native-alignment-eigen";

export type PointCloudNormalMode =
  "provided" | "estimate-outward" | "estimate-viewpoint" | "estimate-provided";
export interface PointCloudNormalOptions {
  mode: PointCloudNormalMode;
  neighbors?: number;
  viewpoint?: readonly [number, number, number];
  onProgress?: (progress: number) => void;
  isCancelled?: () => boolean;
}

/** PCA plus a maximum-consistency spanning forest; supplied orientations are an explicit caller assertion. */
export function preparePointCloudNormals(
  positions: Float32Array | Float64Array,
  suppliedNormals: Float32Array | Float64Array | undefined,
  options: PointCloudNormalOptions,
) {
  const count = positions.length / 3;
  if (
    !Number.isInteger(count) ||
    count < 3 ||
    count > 500_000 ||
    !positions.every(Number.isFinite)
  )
    throw new Error("Poisson normals require 3..500000 finite XYZ points.");
  if (
    ![
      "provided",
      "estimate-outward",
      "estimate-viewpoint",
      "estimate-provided",
    ].includes(options.mode)
  )
    throw new Error("Unknown Poisson normal orientation mode.");
  const normals = new Float32Array(positions.length);
  const checkpoint = (progress: number) => {
    if (options.isCancelled?.())
      throw new Error("Poisson normal preparation cancelled.");
    options.onProgress?.(progress);
  };
  checkpoint(0);
  if (options.mode === "provided") {
    if (!suppliedNormals || suppliedNormals.length !== positions.length)
      throw new Error(
        "Provided Poisson normals must match the XYZ point count.",
      );
    for (let i = 0; i < count; i++) {
      const x = suppliedNormals[i * 3],
        y = suppliedNormals[i * 3 + 1],
        z = suppliedNormals[i * 3 + 2];
      const length = Math.hypot(x, y, z);
      if (!Number.isFinite(length) || length === 0)
        throw new Error(`Poisson normal ${i} is nonfinite or zero.`);
      normals.set([x / length, y / length, z / length], i * 3);
      if ((i & 1023) === 0) checkpoint(i / count);
    }
    checkpoint(1);
    return {
      normals,
      diagnostics: {
        mode: options.mode,
        pointCount: count,
        neighbors: 0,
        components: 0,
        orientationAssumption:
          "Caller asserts supplied normals are consistently oriented; validation checks finite nonzero vectors only.",
      },
    };
  }
  const requested = options.neighbors ?? 24;
  if (
    options.mode === "estimate-provided" &&
    (!suppliedNormals || suppliedNormals.length !== positions.length)
  )
    throw new Error(
      "Estimated provided orientation requires matching source normal anchors.",
    );
  if (!Number.isInteger(requested) || requested < 8 || requested > 48)
    throw new Error(
      "Poisson normal neighbors must be an integer from 8 to 48.",
    );
  const viewpoint = options.viewpoint;
  if (
    options.mode === "estimate-viewpoint" &&
    (!viewpoint || viewpoint.length !== 3 || !viewpoint.every(Number.isFinite))
  )
    throw new Error(
      "Viewpoint normal orientation requires a finite XYZ scanner viewpoint.",
    );
  const k = Math.min(requested, count - 1);
  // At 500k points / 48 neighbors these typed buffers consume under 128 MiB.
  const adjacency = new Uint32Array(count * k),
    ids = Uint32Array.from({ length: count }, (_, i) => i),
    axes = new Uint8Array(count);
  const build = (start: number, end: number) => {
    if (start >= end) return;
    const low = [Infinity, Infinity, Infinity],
      high = [-Infinity, -Infinity, -Infinity];
    for (let j = start; j < end; j++)
      for (let a = 0; a < 3; a++) {
        const value = positions[ids[j] * 3 + a];
        low[a] = Math.min(low[a], value);
        high[a] = Math.max(high[a], value);
      }
    let axis = 0;
    for (let a = 1; a < 3; a++)
      if (high[a] - low[a] > high[axis] - low[axis]) axis = a;
    ids
      .subarray(start, end)
      .sort(
        (a, b) => positions[a * 3 + axis] - positions[b * 3 + axis] || a - b,
      );
    const mid = (start + end) >>> 1;
    axes[mid] = axis;
    build(start, mid);
    build(mid + 1, end);
  };
  build(0, count);
  checkpoint(0.08);
  const nearIds = new Uint32Array(k),
    distances = new Float64Array(k);
  const nearest = (query: number) => {
    let size = 0,
      visits = 0;
    const worse = (a: number, b: number) =>
      distances[a] > distances[b] ||
      (distances[a] === distances[b] && nearIds[a] > nearIds[b]);
    const swap = (a: number, b: number) => {
      [distances[a], distances[b]] = [distances[b], distances[a]];
      [nearIds[a], nearIds[b]] = [nearIds[b], nearIds[a]];
    };
    const visit = (start: number, end: number) => {
      if (start >= end) return;
      if (++visits > 16384)
        throw new Error(
          "Poisson normal spatial query exceeded its 16384-node work limit; simplify duplicate/dense input or reduce neighbors.",
        );
      const mid = (start + end) >>> 1,
        id = ids[mid],
        axis = axes[mid];
      if (id !== query) {
        let d = 0;
        for (let a = 0; a < 3; a++)
          d += (positions[id * 3 + a] - positions[query * 3 + a]) ** 2;
        if (size < k) {
          let at = size++;
          distances[at] = d;
          nearIds[at] = id;
          while (at > 0) {
            const parent = (at - 1) >>> 1;
            if (!worse(at, parent)) break;
            swap(at, parent);
            at = parent;
          }
        } else if (
          d < distances[0] ||
          (d === distances[0] && id < nearIds[0])
        ) {
          distances[0] = d;
          nearIds[0] = id;
          let at = 0;
          while (at * 2 + 1 < size) {
            let child = at * 2 + 1;
            if (child + 1 < size && worse(child + 1, child)) child++;
            if (!worse(child, at)) break;
            swap(at, child);
            at = child;
          }
        }
      }
      const delta = positions[query * 3 + axis] - positions[id * 3 + axis];
      if (delta <= 0) visit(start, mid);
      else visit(mid + 1, end);
      if (size < k || delta * delta <= distances[0]) {
        if (delta <= 0) visit(mid + 1, end);
        else visit(start, mid);
      }
    };
    visit(0, count);
  };
  for (let i = 0; i < count; i++) {
    nearest(i);
    adjacency.set(nearIds, i * k);
    const center = [0, 0, 0];
    for (const id of nearIds)
      for (let a = 0; a < 3; a++)
        center[a] += (positions[id * 3 + a] - positions[i * 3 + a]) / k;
    const matrix = new Array<number>(9).fill(0);
    for (const id of nearIds) {
      const d = [0, 1, 2].map(
        (a) => positions[id * 3 + a] - positions[i * 3 + a] - center[a],
      );
      for (let a = 0; a < 3; a++)
        for (let b = 0; b < 3; b++) matrix[a * 3 + b] += d[a] * d[b];
    }
    const scale = Math.max(...matrix.map(Math.abs));
    if (!(scale > 0) || !Number.isFinite(scale))
      throw new Error(`Degenerate Poisson normal neighborhood at point ${i}.`);
    const eigen = nativeAlignmentEigen3(matrix.map((value) => value / scale));
    if (!eigen.accepted || eigen.values[1] <= eigen.values[0] * 1e-10)
      throw new Error(`Degenerate Poisson normal neighborhood at point ${i}.`);
    const n = [eigen.vectors[2], eigen.vectors[5], eigen.vectors[8]],
      length = Math.hypot(...n);
    normals.set(
      n.map((value) => value / length),
      i * 3,
    );
    if ((i & 1023) === 0) checkpoint(0.08 + (0.72 * i) / count);
  }
  const dot = (a: number, b: number) =>
    normals[a * 3] * normals[b * 3] +
    normals[a * 3 + 1] * normals[b * 3 + 1] +
    normals[a * 3 + 2] * normals[b * 3 + 2];
  const heap = new Uint32Array(count),
    heapAt = new Int32Array(count).fill(-1),
    keys = new Float64Array(count).fill(-1),
    parents = new Int32Array(count).fill(-1),
    visited = new Uint8Array(count),
    component = new Uint32Array(count);
  let heapSize = 0,
    components = 0,
    completed = 0,
    orientationAnchors = 0,
    invalidOrientationAnchors = 0;
  const better = (a: number, b: number) =>
    keys[a] > keys[b] || (keys[a] === keys[b] && a < b);
  const heapSwap = (a: number, b: number) => {
    [heap[a], heap[b]] = [heap[b], heap[a]];
    heapAt[heap[a]] = a;
    heapAt[heap[b]] = b;
  };
  const pushOrRaise = (id: number) => {
    let at = heapAt[id];
    if (at < 0) {
      at = heapSize++;
      heap[at] = id;
      heapAt[id] = at;
    }
    while (at > 0) {
      const p = (at - 1) >>> 1;
      if (!better(heap[at], heap[p])) break;
      heapSwap(at, p);
      at = p;
    }
  };
  for (let root = 0; root < count; root++) {
    if (visited[root]) continue;
    components++;
    let componentSize = 0;
    keys[root] = 1;
    pushOrRaise(root);
    while (heapSize) {
      const id = heap[0];
      heapAt[id] = -1;
      heapSize--;
      if (heapSize) {
        heap[0] = heap[heapSize];
        heapAt[heap[0]] = 0;
        let at = 0;
        while (at * 2 + 1 < heapSize) {
          let child = at * 2 + 1;
          if (child + 1 < heapSize && better(heap[child + 1], heap[child]))
            child++;
          if (!better(heap[child], heap[at])) break;
          heapSwap(at, child);
          at = child;
        }
      }
      visited[id] = 1;
      component[componentSize++] = id;
      if (parents[id] >= 0 && dot(id, parents[id]) < 0)
        for (let a = 0; a < 3; a++) normals[id * 3 + a] *= -1;
      for (let j = 0; j < k; j++) {
        const next = adjacency[id * k + j],
          weight = Math.abs(dot(id, next));
        if (!visited[next] && weight > keys[next]) {
          keys[next] = weight;
          parents[next] = id;
          pushOrRaise(next);
        }
      }
      if ((++completed & 1023) === 0)
        checkpoint(0.8 + (0.19 * completed) / count);
    }
    const center = [0, 0, 0];
    for (let j = 0; j < componentSize; j++)
      for (let a = 0; a < 3; a++)
        center[a] += positions[component[j] * 3 + a] / componentSize;
    let score = 0,
      magnitude = 0;
    for (let j = 0; j < componentSize; j++) {
      const id = component[j];
      if (options.mode === "estimate-provided") {
        const length = Math.hypot(
          suppliedNormals![id * 3],
          suppliedNormals![id * 3 + 1],
          suppliedNormals![id * 3 + 2],
        );
        if (!Number.isFinite(length) || length === 0) {
          invalidOrientationAnchors++;
          continue;
        }
        orientationAnchors++;
        for (let a = 0; a < 3; a++)
          score +=
            (normals[id * 3 + a] * suppliedNormals![id * 3 + a]) / length;
        magnitude++;
        continue;
      }
      for (let a = 0; a < 3; a++) {
        const direction =
          options.mode === "estimate-viewpoint"
            ? viewpoint![a] - positions[id * 3 + a]
            : positions[id * 3 + a] - center[a];
        score += normals[id * 3 + a] * direction;
        magnitude += Math.abs(direction);
      }
    }
    if (magnitude === 0 || Math.abs(score) <= magnitude * 1e-8)
      throw new Error(
        "Poisson normal orientation is ambiguous for a component; supply oriented normals or a scanner viewpoint.",
      );
    if (score < 0)
      for (let j = 0; j < componentSize; j++)
        for (let a = 0; a < 3; a++) normals[component[j] * 3 + a] *= -1;
  }
  checkpoint(1);
  return {
    normals,
    diagnostics: {
      mode: options.mode,
      pointCount: count,
      neighbors: k,
      components,
      orientationAnchors,
      invalidOrientationAnchors,
      orientationAssumption:
        options.mode === "estimate-provided"
          ? "PCA estimates every point; graph-consistent component signs follow aggregate agreement with valid supplied normal anchors. Invalid anchors are counted and do not remove points."
          : options.mode === "estimate-outward"
            ? "Graph-consistent orientation assumes each component is a closed surface; aggregate radial flux selects its outward sign."
            : "Graph-consistent orientation assumes a single scanner viewpoint; aggregate facing score selects each component sign.",
    },
  };
}
