import { analyzeMesh, type MeshProcessingOptions } from "./mesh-processing";
import type { Positions, Vec3 } from "./types";
import {
  REDUCTION_PATCH_TRIANGLES,
  reduceSpatialMesh,
} from "./scan-reduction-partitions";
export { repolygonizeScanMesh } from "./scan-tools-remesh";

export interface ScanToolResult {
  positions: Float32Array;
  summary: string;
}
type Options = Pick<MeshProcessingOptions, "signal" | "onProgress">;
const point = (v: ArrayLike<number>, i: number): Vec3 => [
  v[i * 3],
  v[i * 3 + 1],
  v[i * 3 + 2],
];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const distance = (a: Vec3, b: Vec3) => Math.hypot(...sub(a, b));
const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
function positive(value: number, label: string) {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error(`${label} must be positive and finite.`);
}
function progress(o: Options, f: number, s: string) {
  if (o.signal?.aborted)
    throw new DOMException("Mesh operation cancelled.", "AbortError");
  o.onProgress?.(f, s);
}
function topology(p: Positions, o: Options, tolerance = 1e-6) {
  if (p.length / 9 > 500_000)
    throw new Error(
      "This operation supports at most 500,000 input triangles; split the mesh first.",
    );
  const t = analyzeMesh(p, { signal: o.signal, tolerance });
  if (
    t.degenerateTriangles ||
    t.duplicateTriangles ||
    t.nonManifoldEdges ||
    t.nonManifoldVertices ||
    t.inconsistentEdges
  )
    throw new Error(
      "Repair invalid or nonmanifold mesh topology before using this tool.",
    );
  return t;
}
function unpack(v: ArrayLike<number>, faces: number[][]) {
  const out = new Float32Array(faces.length * 9);
  faces.forEach((f, i) =>
    f.forEach((id, j) => out.set(point(v, id), i * 9 + j * 3)),
  );
  if (out.some((x) => !Number.isFinite(x)))
    throw new Error("Mesh result exceeds coordinate precision.");
  for (let i = 0; i < out.length; i += 9) {
    const a: Vec3 = [out[i], out[i + 1], out[i + 2]],
      b: Vec3 = [out[i + 3], out[i + 4], out[i + 5]],
      c: Vec3 = [out[i + 6], out[i + 7], out[i + 8]];
    if (Math.hypot(...cross(sub(b, a), sub(c, a))) === 0)
      throw new Error(
        "Mesh triangles collapse at Float32 precision; original geometry retained.",
      );
  }
  return out;
}
function faceNormal(
  v: ArrayLike<number>,
  f: number[],
  replace?: [number, number, Vec3],
) {
  const p = f.map((id) =>
    replace && (id === replace[0] || id === replace[1])
      ? replace[2]
      : point(v, id),
  );
  return cross(sub(p[1], p[0]), sub(p[2], p[0]));
}

/** Interior edge collapse with the manifold link condition. Boundaries and creases are fixed. */
export function reduceScanMesh(
  positions: Positions,
  options: Options & {
    mode: "triangles" | "percentage" | "deviation";
    targetTriangles?: number;
    percentage?: number;
    deviation?: number;
    /** Internal exact-indexed spatial patch; never supplied by the UI. */
    patchTopology?: import("./mesh-processing").MeshTopology;
  },
): ScanToolResult {
  const original = positions.length / 9;
  let target: number;
  if (options.mode === "triangles") {
    target = options.targetTriangles ?? Math.ceil(original / 2);
    if (!Number.isSafeInteger(target) || target < 1 || target > original)
      throw new Error(
        "Target triangle count must be between 1 and the current count.",
      );
  } else if (options.mode === "percentage") {
    const percentage = options.percentage ?? 50;
    positive(percentage, "Retained percentage");
    if (percentage > 100)
      throw new Error("Retained percentage must not exceed 100.");
    target = Math.max(1, Math.ceil((original * percentage) / 100));
  } else if (options.mode === "deviation") target = 1;
  else throw new Error("Unknown reduction mode.");
  const bound =
    options.mode === "deviation" ? (options.deviation ?? 0.05) : Infinity;
  if (options.mode === "deviation") positive(bound, "Deviation");
  if (!options.patchTopology && original > REDUCTION_PATCH_TRIANGLES) {
    try {
      const result = reduceSpatialMesh(
        positions,
        target,
        options,
        (patch, localTarget, patchTopology, onProgress) =>
          reduceScanMesh(patch, {
            ...options,
            patchTopology,
            targetTriangles: localTarget,
            percentage: options.percentage,
            onProgress: (fraction) => onProgress(fraction),
          }).positions,
      );
      const count = result.positions.length / 9;
      return {
        positions: result.positions,
        summary: `${original} → ${count} triangles. Spatial patch borders and sharp creases preserved.${bound !== Infinity ? ` Deviation constrained to ${bound} mm within each patch.` : ""}${count > target ? " Reduction stopped at protected topology or patch borders." : ""}${result.protectedPatches ? ` ${result.protectedPatches} unsafe patches retained unchanged.` : ""}`,
      };
    } catch (error) {
      if (error instanceof RangeError)
        throw new Error(
          "Insufficient memory for polygon reduction; original mesh retained. Close unused projects or use a device with more available memory.",
        );
      throw error;
    }
  }
  const t =
      options.patchTopology ??
      topology(positions, options, Math.min(1e-6, bound / 100)),
    v = t.vertices.slice(),
    faces = Array.from({ length: original }, (_, i) =>
      Array.from(t.triangles.slice(i * 3, i * 3 + 3)),
    );
  const live = new Uint8Array(original).fill(1),
    incident = Array.from({ length: v.length / 3 }, () => new Set<number>()),
    locked = new Uint8Array(v.length / 3);
  const provenance = Array.from({ length: v.length / 3 }, (_, i) => [i]);
  faces.forEach((f, i) => f.forEach((id) => incident[id].add(i)));
  for (const uses of t.edges.values()) {
    let fixed = uses.length !== 2;
    if (!fixed) {
      const n = uses.map((u) => faceNormal(v, faces[u.face]));
      fixed =
        dot(n[0], n[1]) / (Math.hypot(...n[0]) * Math.hypot(...n[1])) <
        Math.cos(Math.PI / 4);
    }
    if (fixed) locked[uses[0].from] = locked[uses[0].to] = 1;
  }
  let count = original,
    checks = 0,
    exhausted = false;
  const neighbors = (id: number) => {
    const set = new Set<number>();
    for (const f of incident[id])
      for (const j of faces[f]) if (j !== id) set.add(j);
    return set;
  };
  for (let pass = 0; pass < 64 && count > target; pass++) {
    progress(options, 1 - count / original, "Collapsing interior mesh edges");
    const edges = new Map<string, [number, number]>();
    faces.forEach((f, i) => {
      if (live[i])
        for (let c = 0; c < 3; c++) {
          const a = f[c],
            b = f[(c + 1) % 3];
          if (!locked[a] && !locked[b]) edges.set(key(a, b), [a, b]);
        }
    });
    const candidates = [...edges.values()].sort(
      (a, b) =>
        distance(point(v, a[0]), point(v, a[1])) -
        distance(point(v, b[0]), point(v, b[1])),
    );
    let changed = false;
    for (const [a, b] of candidates) {
      if (++checks > 5_000_000) {
        exhausted = true;
        break;
      }
      if (checks % 2048 === 0)
        progress(
          options,
          1 - count / original,
          "Checking manifold edge collapses",
        );
      if (!incident[a].size || !incident[b].size) continue;
      const shared = [...incident[a]].filter((f) => incident[b].has(f));
      if (shared.length !== 2 || count - 2 < target) continue;
      const na = neighbors(a),
        nb = neighbors(b),
        common = [...na].filter((id) => nb.has(id));
      const opposite = new Set(
        shared.flatMap((f) => faces[f].filter((id) => id !== a && id !== b)),
      );
      if (
        common.length !== 2 ||
        opposite.size !== 2 ||
        common.some((id) => !opposite.has(id))
      )
        continue;
      const pa = point(v, a),
        pb = point(v, b),
        // Check the actual stored coordinates, including Float32 rounding.
        mid: Vec3 = pa.map((x, i) => Math.fround((x + pb[i]) / 2)) as Vec3;
      const affected = new Set([...incident[a], ...incident[b]]);
      const planeNormal = faceNormal(v, faces[shared[0]]);
      const planeLength = Math.hypot(...planeNormal);
      // A manifold planar patch with its perimeter fixed covers the same surface
      // after a non-inverting collapse, even when a vertex moves along that plane.
      const planar = [...affected].every((f) =>
        faces[f].every((id) =>
          provenance[id].every(
            (originalId) =>
              Math.abs(
                dot(planeNormal, sub(point(t.vertices, originalId), mid)),
              ) /
                planeLength <=
              1e-10,
          ),
        ),
      );
      if (
        bound !== Infinity &&
        !planar &&
        [...provenance[a], ...provenance[b]].some(
          (id) => distance(point(t.vertices, id), mid) > bound,
        )
      )
        continue;
      let valid = true;
      for (const f of affected)
        if (!shared.includes(f)) {
          const before = faceNormal(v, faces[f]),
            after = faceNormal(v, faces[f], [a, b, mid]);
          if (
            Math.hypot(...after) < 1e-12 ||
            dot(before, after) <
              0.1 * Math.hypot(...before) * Math.hypot(...after)
          ) {
            valid = false;
            break;
          }
        }
      if (!valid) continue;
      for (const f of affected)
        for (const id of faces[f]) incident[id].delete(f);
      for (const f of affected) {
        if (shared.includes(f)) {
          live[f] = 0;
          count--;
        } else {
          faces[f] = faces[f].map((id) => (id === b ? a : id));
          for (const id of faces[f]) incident[id].add(f);
        }
      }
      v.set(mid, a * 3);
      provenance[a] = provenance[a].concat(provenance[b]);
      provenance[b] = [];
      changed = true;
      if (count <= target) break;
    }
    if (!changed || exhausted) break;
  }
  const out = unpack(
    v,
    faces.filter((_, i) => live[i]),
  );
  progress(options, 1, "Polygon reduction complete");
  return {
    positions: out,
    summary: `${original} → ${count} triangles. Boundaries and sharp creases preserved.${bound !== Infinity ? ` Nonplanar vertex displacement limited to ${bound} mm; planar patches preserve their surface.` : ""}${count > target ? ` Reduction stopped at protected topology${exhausted ? " or the work budget" : ""}.` : ""}`,
  };
}

/** Conservative Laplacian noise reduction. A vertex shared with an unselected face is pinned. */
export function reduceScanNoise(
  positions: Positions,
  options: Options & {
    iterations?: number;
    deviation?: number;
    selection?: Uint8Array;
    selectionOnly?: boolean;
  } = {},
): ScanToolResult {
  const iterations = options.iterations ?? 3,
    deviation = options.deviation ?? 0.05;
  if (!Number.isSafeInteger(iterations) || iterations < 1 || iterations > 100)
    throw new Error("Smooth iterations must be an integer between 1 and 100.");
  positive(deviation, "Deviation");
  const t = topology(positions, options, Math.min(1e-6, deviation / 100)),
    n = t.vertices.length / 3;
  if (options.selection && options.selection.length !== positions.length / 9)
    throw new Error("Selection mask does not match the mesh triangle count.");
  if (
    options.selectionOnly &&
    (!options.selection ||
      options.selection.length !== positions.length / 9 ||
      !options.selection.some(Boolean))
  )
    throw new Error("Select triangles before smoothing the selection.");
  const adjacent = Array.from({ length: n }, () => new Set<number>()),
    pinned = new Uint8Array(n);
  for (const uses of t.edges.values()) {
    const { from, to } = uses[0];
    adjacent[from].add(to);
    adjacent[to].add(from);
    if (uses.length !== 2) pinned[from] = pinned[to] = 1;
  }
  if (options.selectionOnly)
    for (let f = 0; f < t.triangles.length / 3; f++)
      if (!options.selection![f])
        for (let c = 0; c < 3; c++) pinned[t.triangles[f * 3 + c]] = 1;
  const faces = Array.from({ length: t.triangles.length / 3 }, (_, f) =>
    Array.from(t.triangles.slice(f * 3, f * 3 + 3)),
  );
  let vertices = t.vertices.slice();
  for (let iteration = 0; iteration < iterations; iteration++) {
    progress(options, iteration / iterations, "Reducing mesh noise");
    const next = vertices.slice();
    for (let id = 0; id < n; id++)
      if (!pinned[id] && adjacent[id].size) {
        if (id % 4096 === 0)
          progress(options, iteration / iterations, "Reducing mesh noise");
        const average: Vec3 = [0, 0, 0];
        for (const j of adjacent[id])
          for (let c = 0; c < 3; c++)
            average[c] += vertices[j * 3 + c] / adjacent[id].size;
        const origin = point(t.vertices, id),
          candidate = point(vertices, id).map(
            (x, c) => x + 0.3 * (average[c] - x),
          ) as Vec3;
        const delta = sub(candidate, origin),
          length = Math.hypot(...delta),
          scale = Math.min(1, deviation / length);
        next.set(
          origin.map((x, c) => x + delta[c] * scale),
          id * 3,
        );
      }
    // Reject a simultaneous step if it folds any original triangle. Preserve all previous valid coordinates.
    if (
      faces.some((f) => {
        const a = faceNormal(vertices, f),
          b = faceNormal(next, f);
        return Math.hypot(...b) < 1e-12 || dot(a, b) <= 0;
      })
    )
      break;
    vertices = next;
  }
  progress(options, 1, "Noise reduction complete");
  const output = unpack(vertices, faces);
  if (options.selectionOnly)
    for (let face = 0; face < faces.length; face++)
      if (!options.selection![face])
        for (let axis = 0; axis < 9; axis++)
          output[face * 9 + axis] = positions[face * 9 + axis];
  return {
    positions: output,
    summary: `Noise reduced with up to ${iterations} iterations; maximum displacement ${deviation} mm. ${options.selectionOnly ? "Unselected faces and selection borders" : "Mesh boundaries"} preserved.`,
  };
}
