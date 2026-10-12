import type { MeshTopology } from "./mesh-processing";
import type { Vec3 } from "./types";

export interface SpatialRepatchResult {
  /** Appended vertices; triangle indices address original vertices followed by these. */
  insertedVertices: Float64Array;
  insertedNormals: Float64Array;
  triangles: Uint32Array;
  completed: boolean;
  remainingLoop: number[];
  iterations: number;
  reason?: "invalid-loop" | "no-valid-corner" | "iteration-limit";
}
export interface SpatialRepatchOptions {
  /** Preserve pre-edit vertex normals across facet deletion and compaction. */
  vertexNormals?: ArrayLike<number>;
  maxIterations?: number;
  signal?: AbortSignal;
  onProgress?: (iteration: number, remaining: number) => void;
}
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (v: Vec3): Vec3 => {
  const l = Math.hypot(...v);
  return l > 1e-15 ? scale(v, 1 / l) : [0, 0, 0];
};
const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
const angle = (a: Vec3, b: Vec3) =>
  Math.acos(Math.max(-1, Math.min(1, dot(a, b))));

/** Angle-weighted vertex normals, computed before deleting a selected patch. */
export function computeAngleWeightedNormals(
  topology: MeshTopology,
): Float64Array {
  const output = new Float64Array(topology.vertices.length);
  const point = (id: number): Vec3 => [
    topology.vertices[id * 3],
    topology.vertices[id * 3 + 1],
    topology.vertices[id * 3 + 2],
  ];
  for (let f = 0; f < topology.triangles.length; f += 3) {
    const tri = [
      topology.triangles[f],
      topology.triangles[f + 1],
      topology.triangles[f + 2],
    ];
    const p = tri.map(point);
    const n = unit(cross(sub(p[1], p[0]), sub(p[2], p[0])));
    for (let k = 0; k < 3; k++) {
      const w = angle(
        unit(sub(p[(k + 1) % 3], p[k])),
        unit(sub(p[(k + 2) % 3], p[k])),
      );
      for (let axis = 0; axis < 3; axis++)
        output[tri[k] * 3 + axis] += n[axis] * w;
    }
  }
  for (let i = 0; i < output.length; i += 3)
    output.set(unit([output[i], output[i + 1], output[i + 2]]), i);
  return output;
}

/** Spatial advancing-corner filling reconstructed from the native mode-2 path.
 * It preserves the retained directed rim, uses the 75-degree / sqrt(2) chord
 * branches, and never treats the native core's truthy partial exit as closure.
 */
export function repatchSpatialBoundary(
  topology: MeshTopology,
  ids: readonly number[],
  options: SpatialRepatchOptions = {},
): SpatialRepatchResult {
  const count = topology.vertices.length / 3;
  const inserted: number[] = [];
  const faces: number[] = [];
  const normals = new Map<number, Vec3>();
  const loop = [...ids];
  const point = (id: number): Vec3 =>
    id < count
      ? [
          topology.vertices[id * 3],
          topology.vertices[id * 3 + 1],
          topology.vertices[id * 3 + 2],
        ]
      : [
          inserted[(id - count) * 3],
          inserted[(id - count) * 3 + 1],
          inserted[(id - count) * 3 + 2],
        ];
  if (loop.length > 1 && loop[0] === loop[loop.length - 1]) loop.pop();
  const result = (
    completed: boolean,
    iterations: number,
    reason?: SpatialRepatchResult["reason"],
  ): SpatialRepatchResult => ({
    insertedVertices: new Float64Array(inserted),
    insertedNormals: new Float64Array(
      Array.from(
        { length: inserted.length / 3 },
        (_, i) => normals.get(count + i) ?? [0, 0, 0],
      ).flat(),
    ),
    triangles: new Uint32Array(faces),
    completed,
    remainingLoop: completed ? [] : [...loop],
    iterations,
    reason,
  });
  if (
    loop.length < 3 ||
    new Set(loop).size !== loop.length ||
    loop.some((id) => !Number.isInteger(id) || id < 0 || id >= count)
  )
    return result(false, 0, "invalid-loop");
  // Boundary lists follow the retained facet direction. Patch triangles reverse
  // each exposed edge, avoiding a global plane fit that flattens a noisy rim.
  const rimFaces = new Map<string, number>();
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i],
      b = loop[(i + 1) % loop.length];
    const uses = topology.edges.get(key(a, b));
    if (uses?.length !== 1) return result(false, 0, "invalid-loop");
    rimFaces.set(key(a, b), uses[0].face);
  }
  if (!options.vertexNormals) {
    const wanted = new Set(loop);
    for (let f = 0; f < topology.triangles.length; f += 3) {
      const tri = Array.from(topology.triangles.subarray(f, f + 3));
      if (!tri.some((id) => wanted.has(id))) continue;
      const p = tri.map(point);
      const n = unit(cross(sub(p[1], p[0]), sub(p[2], p[0])));
      for (let k = 0; k < 3; k++)
        if (wanted.has(tri[k])) {
          const w = angle(
            unit(sub(p[(k + 1) % 3], p[k])),
            unit(sub(p[(k + 2) % 3], p[k])),
          );
          normals.set(
            tri[k],
            add(normals.get(tri[k]) ?? [0, 0, 0], scale(n, w)),
          );
        }
    }
    for (const [id, n] of normals) normals.set(id, unit(n));
  }
  if (options.vertexNormals) {
    if (options.vertexNormals.length !== topology.vertices.length)
      throw new Error("Pre-edit vertex normals must match indexed vertices.");
    for (const id of loop) {
      const n: Vec3 = [
        options.vertexNormals[id * 3],
        options.vertexNormals[id * 3 + 1],
        options.vertexNormals[id * 3 + 2],
      ];
      if (!n.every(Number.isFinite))
        throw new Error("Pre-edit vertex normals must be finite.");
      normals.set(id, unit(n));
    }
  }
  const chordLimit =
    (loop.reduce(
      (sum, id, i) =>
        sum + Math.hypot(...sub(point(id), point(loop[(i + 1) % loop.length]))),
      0,
    ) /
      loop.length) *
    Math.SQRT2;
  const validTriangle = (a: number, b: number, c: number) =>
    a !== b &&
    b !== c &&
    a !== c &&
    Math.hypot(...cross(sub(point(b), point(a)), sub(point(c), point(a)))) >
      1e-12;
  let nextFace = topology.triangles.length / 3;
  const emit = (a: number, b: number, c: number): number => {
    faces.push(a, b, c);
    return nextFace++;
  };
  const score = (i: number): number => {
    const m = loop.length,
      previous = loop[(i + m - 1) % m],
      current = loop[i],
      next = loop[(i + 1) % m];
    if (
      rimFaces.get(key(previous, current)) === rimFaces.get(key(current, next))
    )
      return Infinity;
    const p = point(previous),
      c = point(current),
      n = point(next);
    const a = unit(sub(p, c)),
      b = unit(sub(n, c)),
      orientation = unit(cross(a, b));
    if (Math.hypot(...orientation) < 1e-7) return Infinity;
    let value = angle(a, b);
    if (dot(orientation, normals.get(current) ?? [0, 0, 0]) < 0)
      value = 2 * Math.PI - value;
    // The native two adjacent-corner exclusion tests reject diagonals which
    // cross the neighboring boundary wedges without projecting the loop.
    const after = unit(sub(point(loop[(i + 2) % m]), n)),
      diagonal = unit(sub(p, n)),
      back = unit(sub(c, n));
    if (
      dot(diagonal, after) > dot(back, diagonal) &&
      dot(cross(back, diagonal), cross(diagonal, after)) < 0
    )
      return Infinity;
    const before = unit(sub(point(loop[(i + m - 2) % m]), p)),
      forward = unit(sub(n, p)),
      toCurrent = unit(sub(c, p));
    if (
      dot(forward, before) > dot(toCurrent, forward) &&
      dot(cross(toCurrent, forward), cross(forward, before)) < 0
    )
      return Infinity;
    return value;
  };
  const limit = Math.min(
    10000,
    Math.max(0, Math.floor(options.maxIterations ?? 10000)),
  );
  let iteration = 0;
  while (loop.length > 3 && iteration < limit) {
    if (options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    let selected = -1,
      best = Infinity;
    for (let i = 0; i < loop.length; i++) {
      const s = score(i);
      if (s < best) {
        best = s;
        selected = i;
      }
    }
    if (selected < 0) return result(false, iteration, "no-valid-corner");
    const m = loop.length,
      previous = loop[(selected + m - 1) % m],
      current = loop[selected],
      next = loop[(selected + 1) % m];
    const p = point(previous),
      c = point(current),
      n = point(next);
    const a = unit(sub(p, c)),
      b = unit(sub(n, c));
    if (
      dot(a, b) >= Math.cos((75 * Math.PI) / 180) ||
      Math.hypot(...sub(p, n)) <= chordLimit
    ) {
      if (!validTriangle(current, previous, next))
        return result(false, iteration, "no-valid-corner");
      const f = emit(current, previous, next);
      rimFaces.set(key(previous, next), f);
      loop.splice(selected, 1);
    } else {
      const chord = sub(n, p),
        length = Math.hypot(...chord);
      const tangent = (normal: Vec3) =>
        scale(unit(cross(cross(normal, chord), normal)), length);
      // At t=1/2 the extracted cubic Hermite basis gives midpoint +
      // (start tangent - end tangent)/8. The native step blends this curve
      // point equally with the linear midpoint before normalizing direction.
      const midpoint = scale(add(p, n), 0.5);
      const curve = add(
        midpoint,
        scale(
          sub(
            tangent(normals.get(previous) ?? [0, 0, 0]),
            tangent(normals.get(next) ?? [0, 0, 0]),
          ),
          0.125,
        ),
      );
      const direction = unit(sub(scale(add(midpoint, curve), 0.5), c));
      const step = (Math.hypot(...sub(p, c)) + Math.hypot(...sub(n, c))) * 0.5;
      const q = add(c, scale(direction, step));
      if (!q.every(Number.isFinite) || Math.hypot(...direction) < 1e-7)
        return result(false, iteration, "no-valid-corner");
      const id = count + inserted.length / 3;
      inserted.push(...q);
      if (
        !validTriangle(current, previous, id) ||
        !validTriangle(current, id, next)
      )
        return result(false, iteration, "no-valid-corner");
      const f1 = emit(current, previous, id),
        f2 = emit(current, id, next);
      normals.set(
        id,
        unit(
          add(
            unit(cross(sub(p, c), sub(q, c))),
            unit(cross(sub(q, c), sub(n, c))),
          ),
        ),
      );
      rimFaces.set(key(previous, id), f1);
      rimFaces.set(key(id, next), f2);
      loop[selected] = id;
    }
    iteration++;
    if (iteration % 32 === 0) options.onProgress?.(iteration, loop.length);
  }
  if (loop.length !== 3) return result(false, iteration, "iteration-limit");
  if (!validTriangle(loop[0], loop[2], loop[1]))
    return result(false, iteration, "no-valid-corner");
  emit(loop[0], loop[2], loop[1]);
  return result(true, iteration);
}
