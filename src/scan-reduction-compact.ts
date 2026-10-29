import type { MeshProcessingOptions } from "./mesh-processing";
import type { Vec3 } from "./types";
import { reductionCandidate } from "./scan-reduction-candidate";
import { prepareCompactReduction } from "./scan-reduction-compact-preparation";
import {
  CompactReductionState,
  COMPACT_REDUCTION_BUDGET_BYTES,
  reductionWords,
} from "./scan-reduction-storage";

const DELETED = 1,
  DIRTY = 2;
function normalize(v: Vec3): Vec3 {
  const length = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (length >= Number.EPSILON) {
    const reciprocal = 1 / length;
    return [v[0] * reciprocal, v[1] * reciprocal, v[2] * reciprocal];
  }
  return v;
}

/** Original validity arithmetic and visited-mask semantics over encoded references. */
export function rejectCompactReductionCollapse(
  state: CompactReductionState,
  point: Vec3,
  other: number,
  references: Uint32Array,
  deletionMask: Uint32Array,
  checkpoint?: () => void,
) {
  const vertices = state.points;
  for (let index = 0; index < references.length; index++) {
    if (index % 4096 === 0) checkpoint?.();
    const encoded = references[index],
      face = Math.floor(encoded / 3),
      corner = encoded % 3;
    if (state.flags[face] & DELETED) continue;
    const base = face * 3;
    const a = state.triangles[base + ((corner + 1) % 3)],
      b = state.triangles[base + ((corner + 2) % 3)];
    const word = index >>> 5,
      bit = 1 << (index & 31);
    if (a === other || b === other) {
      deletionMask[word] |= bit;
      continue;
    }
    const u = normalize([
      vertices[a * 3] - point[0],
      vertices[a * 3 + 1] - point[1],
      vertices[a * 3 + 2] - point[2],
    ]);
    const v = normalize([
      vertices[b * 3] - point[0],
      vertices[b * 3 + 1] - point[1],
      vertices[b * 3 + 2] - point[2],
    ]);
    if (Math.abs(v[1] * u[1] + u[0] * v[0] + v[2] * u[2]) > 0.999) return true;
    const normal = normalize([
      v[2] * u[1] - v[1] * u[2],
      u[2] * v[0] - v[2] * u[0],
      v[1] * u[0] - u[1] * v[0],
    ]);
    deletionMask[word] &= ~bit;
    if (
      normal[1] * state.normals[base + 1] +
        normal[0] * state.normals[base] +
        normal[2] * state.normals[base + 2] <
      0.2
    )
      return true;
  }
  return false;
}

export function updateCompactReductionFaces(
  state: CompactReductionState,
  retained: number,
  references: Uint32Array,
  deletionMask: Uint32Array,
  appended: Uint32Array,
  cursor: number,
  deleted: number,
  checkpoint?: () => void,
) {
  const count = references.length;
  for (let index = 0; index < count; index++) {
    if (index % 4096 === 0) checkpoint?.();
    const encoded = references[index],
      face = Math.floor(encoded / 3),
      corner = encoded % 3;
    if (state.flags[face] & DELETED) continue;
    if ((deletionMask[index >>> 5] >>> (index & 31)) & 1) {
      state.flags[face] |= DELETED;
      deleted = (deleted + 1) | 0;
      continue;
    }
    const base = face * 3;
    state.triangles[base + corner] = retained;
    state.flags[face] |= DIRTY;
    const a = state.triangles[base],
      b = state.triangles[base + 1],
      c = state.triangles[base + 2];
    const e0 = reductionCandidate(state.vertex(a), state.vertex(b)).cost;
    const e1 = reductionCandidate(state.vertex(b), state.vertex(c)).cost;
    const e2 = reductionCandidate(state.vertex(c), state.vertex(a)).cost;
    state.errors[base] = e0;
    state.errors[base + 1] = e1;
    state.errors[base + 2] = e2;
    state.best[face] = e1 <= e0 ? (e2 <= e1 ? 2 : 1) : e2 <= e0 ? 2 : 0;
    if (cursor >= appended.length)
      throw new Error("Reduction incidence output exceeds its admitted range.");
    appended[cursor++] = encoded;
  }
  return { deleted, cursor };
}

function rebuild(state: CompactReductionState, checkpoint: () => void) {
  let count = 0;
  for (let index = 0; index < state.faceCount; index++) {
    if (index % 4096 === 0) checkpoint();
    const face = state.order[index];
    if (!(state.flags[face] & DELETED)) state.order[count++] = face;
  }
  state.faceCount = count;
  for (let vertex = 0; vertex < state.vertexCount; vertex++) {
    if (vertex % 4096 === 0) checkpoint();
    state.counts[vertex] = state.offsets[vertex] = 0;
  }
  for (let index = 0; index < count; index++) {
    if (index % 4096 === 0) checkpoint();
    const base = state.order[index] * 3;
    for (let corner = 0; corner < 3; corner++)
      state.counts[state.triangles[base + corner]]++;
  }
  let offset = 0;
  for (let vertex = 0; vertex < state.vertexCount; vertex++) {
    if (vertex % 4096 === 0) checkpoint();
    state.offsets[vertex] = offset;
    offset += state.counts[vertex];
    state.counts[vertex] = 0;
  }
  state.references.resize(count * 3, checkpoint);
  for (let index = 0; index < count; index++) {
    if (index % 4096 === 0) checkpoint();
    const face = state.order[index],
      base = face * 3;
    for (let corner = 0; corner < 3; corner++) {
      const vertex = state.triangles[base + corner];
      state.references.set(
        state.offsets[vertex] + state.counts[vertex]++,
        base + corner,
      );
    }
  }
}

/** Original face/corner order, then surviving vertices in original index order. */
export function compactReductionResult(
  state: CompactReductionState,
  checkpoint?: () => void,
) {
  const used = new Uint8Array(state.vertexCount);
  let faceCount = 0;
  for (let index = 0; index < state.faceCount; index++) {
    if (index % 4096 === 0) checkpoint?.();
    const face = state.order[index];
    if (state.flags[face] & DELETED) continue;
    faceCount++;
    for (let corner = 0; corner < 3; corner++)
      used[state.triangles[face * 3 + corner]] = 1;
  }
  const mapping = new Uint32Array(state.vertexCount);
  let vertexCount = 0;
  for (let vertex = 0; vertex < state.vertexCount; vertex++) {
    if (vertex % 4096 === 0) checkpoint?.();
    if (used[vertex]) mapping[vertex] = vertexCount++;
  }
  const vertices = new Float64Array(vertexCount * 3);
  for (let vertex = 0; vertex < state.vertexCount; vertex++) {
    if (vertex % 4096 === 0) checkpoint?.();
    if (used[vertex])
      for (let axis = 0; axis < 3; axis++)
        vertices[mapping[vertex] * 3 + axis] = state.points[vertex * 3 + axis];
  }
  const triangles = new Uint32Array(faceCount * 3);
  let cursor = 0;
  for (let index = 0; index < state.faceCount; index++) {
    if (index % 4096 === 0) checkpoint?.();
    const face = state.order[index];
    if (state.flags[face] & DELETED) continue;
    for (let corner = 0; corner < 3; corner++)
      triangles[cursor++] = mapping[state.triangles[face * 3 + corner]];
  }
  checkpoint?.();
  return { vertices, triangles };
}

/** Recovered sequential loop with bounded typed records; no spatial partitioning. */
export function nativeCompactReductionMesh(
  coordinates: ArrayLike<number>,
  triangles: ArrayLike<number>,
  target: number,
  options: MeshProcessingOptions = {},
  limitBytes = COMPACT_REDUCTION_BUDGET_BYTES,
) {
  const check = () => {
    if (options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
  };
  const report = (fraction: number, stage: string) => {
    check();
    options.onProgress?.(fraction, stage);
    check();
  };
  check();
  if (coordinates.length % 3 || triangles.length % 3)
    throw new Error("Reduction requires complete vertex and triangle records.");
  if (
    !Number.isSafeInteger(target) ||
    target < 0 ||
    target > triangles.length / 3
  )
    throw new Error(
      "Reduction target must be an integer within the mesh face count.",
    );
  for (let index = 0; index < coordinates.length; index++) {
    if (index % 4096 === 0) check();
    if (!Number.isFinite(coordinates[index]))
      throw new Error("Reduction coordinates must be finite.");
  }
  for (let index = 0; index < triangles.length; index++) {
    if (index % 4096 === 0) check();
    const id = triangles[index];
    if (!Number.isSafeInteger(id) || id < 0 || id >= coordinates.length / 3)
      throw new Error("Reduction triangle index is outside the vertex buffer.");
  }
  report(0, "Preparing native reduction");
  const state = prepareCompactReduction(
    coordinates,
    triangles,
    check,
    Math.min(limitBytes, COMPACT_REDUCTION_BUDGET_BYTES),
  );
  try {
    const original = state.originalFaces;
    let deleted = 0,
      work = 0;
    const checkpoint = () => {
      if (work++ % 4096 === 0) check();
    };
    report(0.2, "Collapsing native mesh edges");
    for (let pass = 0; pass < 1000 && original - deleted > target; pass++) {
      report(
        0.2 + 0.7 * Math.max(pass / 1000, deleted / (original - target)),
        "Collapsing native mesh edges",
      );
      if (pass > 0 && pass % 20 === 0) rebuild(state, check);
      for (let index = 0; index < state.faceCount; index++) {
        checkpoint();
        state.flags[state.order[index]] &= ~DIRTY;
      }
      const threshold = Math.pow(pass + 3, 4) * 1e-9;
      if (state.minimum > threshold) continue;
      for (let index = 0; index < state.faceCount; index++) {
        checkpoint();
        const face = state.order[index],
          base = face * 3;
        if (
          state.flags[face] & (DELETED | DIRTY) ||
          state.errors[base + state.best[face]] > threshold
        )
          continue;
        const e0 = state.errors[base],
          e1 = state.errors[base + 1],
          e2 = state.errors[base + 2];
        const order =
          e1 <= e0
            ? e2 <= e0
              ? [1, 2, 0]
              : [1, 0, 2]
            : e2 <= e0
              ? [2, 0, 1]
              : e2 <= e1
                ? [0, 2, 1]
                : [0, 1, 2];
        for (const edge of order) {
          if (state.errors[base + edge] >= threshold) continue;
          const a = state.triangles[base + edge],
            b = state.triangles[base + ((edge + 1) % 3)];
          if (state.boundary[a] || state.boundary[b]) continue;
          const { point } = reductionCandidate(
            state.vertex(a),
            state.vertex(b),
          );
          const releases: Array<() => void> = [];
          try {
            const snapshot = (vertex: number) => {
              const lease = state.references.snapshot(
                state.offsets[vertex],
                state.offsets[vertex] + state.counts[vertex],
                check,
              );
              releases.push(lease.release);
              return lease.values;
            };
            const words = (count: number) => {
              const lease = reductionWords(state.memory, count);
              releases.push(lease.release);
              return lease.values;
            };
            const left = snapshot(a),
              right = snapshot(b);
            const leftMask = words(Math.ceil(left.length / 32)),
              rightMask = words(Math.ceil(right.length / 32));
            if (
              rejectCompactReductionCollapse(
                state,
                point,
                b,
                left,
                leftMask,
                check,
              )
            )
              continue;
            if (
              rejectCompactReductionCollapse(
                state,
                point,
                a,
                right,
                rightMask,
                check,
              )
            )
              continue;
            const appended = words(left.length + right.length);
            state.points.set(point, a * 3);
            for (let entry = 0; entry < 10; entry++)
              state.quadrics[a * 10 + entry] =
                state.quadrics[b * 10 + entry] + state.quadrics[a * 10 + entry];
            const start = state.references.length;
            let update = updateCompactReductionFaces(
              state,
              a,
              left,
              leftMask,
              appended,
              0,
              deleted,
              check,
            );
            update = updateCompactReductionFaces(
              state,
              a,
              right,
              rightMask,
              appended,
              update.cursor,
              update.deleted,
              check,
            );
            deleted = update.deleted;
            for (let entry = 0; entry < update.cursor; entry++) {
              if (entry % 4096 === 0) check();
              state.references.push(appended[entry]);
            }
            if (state.counts[a] < update.cursor) state.offsets[a] = start;
            else
              for (let entry = 0; entry < update.cursor; entry++) {
                if (entry % 4096 === 0) check();
                state.references.set(state.offsets[a] + entry, appended[entry]);
              }
            state.counts[a] = update.cursor;
            break;
          } finally {
            for (let release = releases.length - 1; release >= 0; release--)
              releases[release]();
          }
        }
        if (original - deleted <= target) break;
      }
    }
    report(0.95, "Compacting reduced mesh");
    const result = compactReductionResult(state, check);
    report(1, "Polygon reduction completed");
    return result;
  } finally {
    state.dispose();
  }
}
