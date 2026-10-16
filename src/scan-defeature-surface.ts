import type { MeshTopology } from "./mesh-processing";
import type { Vec3 } from "./types";
import {
  type SpatialRepatchOptions,
  type SpatialRepatchResult,
} from "./scan-defeature-repatch";

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const unit = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a);
  return a.map((v) => v / (l || 1)) as Vec3;
};
const edge = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
const basis = (x: number, y: number) => [1, x, y, x * x, x * y, y * y];

/** Pivoted six-variable least squares in a normalized local frame. */
function fit(points: Vec3[]): number[] | undefined {
  const matrix = Array.from({ length: 6 }, () => new Array<number>(7).fill(0));
  for (const [x, y, z] of points) {
    const b = basis(x, y);
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) matrix[i][j] += b[i] * b[j];
      matrix[i][6] += b[i] * z;
    }
  }
  for (let i = 0; i < 6; i++) {
    let pivot = i;
    for (let j = i + 1; j < 6; j++)
      if (Math.abs(matrix[j][i]) > Math.abs(matrix[pivot][i])) pivot = j;
    if (Math.abs(matrix[pivot][i]) < points.length * 1e-9) return;
    [matrix[i], matrix[pivot]] = [matrix[pivot], matrix[i]];
    const divisor = matrix[i][i];
    for (let k = i; k < 7; k++) matrix[i][k] /= divisor;
    for (let j = 0; j < 6; j++)
      if (j !== i) {
        const s = matrix[j][i];
        for (let k = i; k < 7; k++) matrix[j][k] -= s * matrix[i][k];
      }
  }
  return matrix.map((row) => row[6]);
}

export interface CurvatureRepatchResult {
  patch?: SpatialRepatchResult;
  reason?: string;
  /** Physical units, measured against retained support vertices. */
  fitRms?: number;
}

export interface FittedScanSurface {
  project(point: Vec3): Vec3;
  evaluate(point: Vec3): Vec3;
  rim: Vec3[];
  fitRms: number;
}

/** Fit only retained, connected collar geometry; reject creases and underdetermined support. */
export function fitCurvatureSurface(
  topology: MeshTopology,
  ids: readonly number[],
  options: SpatialRepatchOptions = {},
): { surface?: FittedScanSurface; reason?: string } {
  const cancel = () => {
    if (options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
  };
  cancel();
  const reject = (reason: string) => ({ reason });
  if (ids.length < 4 || ids.length > 2048)
    return reject("unsupported rim size");
  const point = (id: number): Vec3 => [
    topology.vertices[id * 3],
    topology.vertices[id * 3 + 1],
    topology.vertices[id * 3 + 2],
  ];
  const origin = ids.reduce(
    (p, id) => p.map((v, k) => v + point(id)[k] / ids.length) as Vec3,
    [0, 0, 0] as Vec3,
  );
  let normal: Vec3 = [0, 0, 0];
  for (let i = 0; i < ids.length; i++) {
    const c = cross(
      sub(point(ids[(i + 1) % ids.length]), origin),
      sub(point(ids[i]), origin),
    );
    normal = normal.map((v, k) => v + c[k]) as Vec3;
  }
  if (Math.hypot(...normal) < 1e-12) return reject("degenerate rim frame");
  normal = unit(normal);
  const axis = unit(
      cross(Math.abs(normal[0]) < 0.8 ? [1, 0, 0] : [0, 1, 0], normal),
    ),
    second = cross(normal, axis);
  const radius = Math.max(
    ...ids.map((id) => Math.hypot(...sub(point(id), origin))),
  );
  if (radius < 1e-9) return reject("degenerate rim scale");
  const local = (p: Vec3): Vec3 => {
    const d = sub(p, origin);
    return [
      dot(d, axis) / radius,
      dot(d, second) / radius,
      dot(d, normal) / radius,
    ];
  };
  // Visit only the connected collar; nearby disconnected scans are never samples.
  const faces = new Set<number>();
  for (let i = 0; i < ids.length; i++)
    for (const use of topology.edges.get(
      edge(ids[i], ids[(i + 1) % ids.length]),
    ) ?? [])
      faces.add(use.face);
  const queue = [...faces],
    samples = new Set<number>();
  for (let q = 0; q < queue.length; q++) {
    if (q % 128 === 0) cancel();
    const f = queue[q],
      tri = Array.from(topology.triangles.subarray(f * 3, f * 3 + 3));
    const p = tri.map((id) => local(point(id)));
    const n = unit(cross(sub(p[1], p[0]), sub(p[2], p[0])));
    if (n[2] < 0.5) return reject("collar crosses a sharp edge or overhang");
    for (const id of tri) samples.add(id);
    for (const next of topology.neighbors[f])
      if (!faces.has(next) && faces.size < 8192) {
        const t = topology.triangles.subarray(next * 3, next * 3 + 3);
        if (
          Array.from(t).every((id) => Math.hypot(...local(point(id))) <= 1.8)
        ) {
          faces.add(next);
          queue.push(next);
        }
      }
  }
  if (samples.size < 12) return reject("insufficient retained surface support");
  const points = Array.from(samples, (id) => local(point(id))),
    coefficients = fit(points);
  if (!coefficients) return reject("underdetermined surface fit");
  const height = (x: number, y: number) => dot6(basis(x, y), coefficients);
  const rms = Math.sqrt(
    points.reduce((sum, [x, y, z]) => sum + (z - height(x, y)) ** 2, 0) /
      points.length,
  );
  const rim = ids.map((id) => local(point(id)));
  if (rms > 0.01 || rim.some(([x, y, z]) => Math.abs(z - height(x, y)) > 0.02))
    return reject("surrounding surface is not a smooth local quadratic");
  const residuals = rim.map(([x, y, z]) => z - height(x, y));
  const evaluate = ([x, y]: Vec3): Vec3 => {
    let weighted = 0,
      weights = 0;
    for (let i = 0; i < rim.length; i++) {
      const d = (x - rim[i][0]) ** 2 + (y - rim[i][1]) ** 2,
        w = 1 / Math.max(d * d, 1e-16);
      weighted += w * residuals[i];
      weights += w;
    }
    const z = height(x, y) + weighted / weights;
    return origin.map(
      (v, k) => v + radius * (axis[k] * x + second[k] * y + normal[k] * z),
    ) as Vec3;
  };
  return { surface: { project: local, evaluate, rim, fitRms: rms * radius } };
}

/** Recover a local panel from retained facets only. No surviving vertex moves.
 * Unsupported collars retain the caller's existing spatial-fill behavior.
 * Work is bounded to 8192 support faces, 2048 rim vertices and 4096 new vertices.
 */
export function repatchCurvatureSurface(
  topology: MeshTopology,
  ids: readonly number[],
  options: SpatialRepatchOptions = {},
): CurvatureRepatchResult {
  const cancel = () => {
    if (options.signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
  };
  const reject = (reason: string): CurvatureRepatchResult => ({ reason });
  const fitted = fitCurvatureSurface(topology, ids, options);
  if (!fitted.surface) return { reason: fitted.reason };
  const surface = fitted.surface,
    rim = surface.rim;
  const point = (id: number): Vec3 => [
    topology.vertices[id * 3],
    topology.vertices[id * 3 + 1],
    topology.vertices[id * 3 + 2],
  ];
  const count = topology.vertices.length / 3;
  const coords = new Map<number, Vec3>(ids.map((id, i) => [id, rim[i]]));
  let triangles: number[][] = [];
  const boundary = new Set(
    ids.map((id, i) => edge(id, ids[(i + 1) % ids.length])),
  );
  const signedArea = ([a, b, c]: number[]) => {
    const p = coords.get(a)!,
      q = coords.get(b)!,
      r = coords.get(c)!;
    return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  };
  // Ear clipping in the fitted frame avoids propagating scan normals or the
  // advancing fill's accumulated error into a dense selected region.
  const loop = [...ids].reverse();
  while (loop.length > 3) {
    cancel();
    let found = false;
    for (let i = 0; i < loop.length; i++) {
      const a = loop[(i + loop.length - 1) % loop.length],
        b = loop[i],
        c = loop[(i + 1) % loop.length];
      if (signedArea([a, b, c]) <= 1e-12) continue;
      if (
        loop.some(
          (id) =>
            id !== a &&
            id !== b &&
            id !== c &&
            signedArea([a, b, id]) >= -1e-12 &&
            signedArea([b, c, id]) >= -1e-12 &&
            signedArea([c, a, id]) >= -1e-12,
        )
      )
        continue;
      triangles.push([a, b, c]);
      loop.splice(i, 1);
      found = true;
      break;
    }
    if (!found) return reject("rim is not a simple surface boundary");
  }
  if (signedArea(loop) <= 1e-12)
    return reject("rim folds in the surface frame");
  triangles.push(loop);
  // Legalize interior diagonals before/after subdivision. Otherwise an ear fan
  // on a dense rim creates thousands of long slivers when refined.
  const legalize = () => {
    for (let pass = 0; pass < 24; pass++) {
      cancel();
      const edges = new Map<
        string,
        { face: number; a: number; b: number; c: number }[]
      >();
      triangles.forEach(([a, b, c], face) => {
        for (const [u, v, w] of [
          [a, b, c],
          [b, c, a],
          [c, a, b],
        ]) {
          const key = edge(u, v),
            uses = edges.get(key) ?? [];
          uses.push({ face, a: u, b: v, c: w });
          edges.set(key, uses);
        }
      });
      const changed = new Set<number>();
      for (const uses of edges.values()) {
        if (uses.length !== 2) continue;
        const [u, v] = uses;
        if (
          changed.has(u.face) ||
          changed.has(v.face) ||
          boundary.has(edge(u.a, u.b))
        )
          continue;
        const a = coords.get(u.a)!,
          b = coords.get(u.b)!,
          c = coords.get(u.c)!,
          d = coords.get(v.c)!;
        const ax = a[0] - d[0],
          ay = a[1] - d[1],
          bx = b[0] - d[0],
          by = b[1] - d[1],
          cx = c[0] - d[0],
          cy = c[1] - d[1];
        const determinant =
          (ax * ax + ay * ay) * (bx * cy - by * cx) -
          (bx * bx + by * by) * (ax * cy - ay * cx) +
          (cx * cx + cy * cy) * (ax * by - ay * bx);
        const first = [u.c, v.c, u.b],
          second = [v.c, u.c, u.a];
        if (
          determinant <= 1e-12 ||
          signedArea(first) <= 1e-12 ||
          signedArea(second) <= 1e-12
        )
          continue;
        triangles[u.face] = first;
        triangles[v.face] = second;
        changed.add(u.face);
        changed.add(v.face);
      }
      if (!changed.size) break;
    }
  };
  legalize();
  const perimeter = rim.reduce(
    (s, p, i) => s + Math.hypot(...sub(p, rim[(i + 1) % rim.length])),
    0,
  );
  const spacing = Math.max(perimeter / ids.length, 1 / 16) * 1.35;
  let nextId = count;
  for (let pass = 0; pass < 12; pass++) {
    cancel();
    const splits = new Map<string, number>();
    for (const t of triangles)
      for (let k = 0; k < 3; k++) {
        const a = t[k],
          b = t[(k + 1) % 3],
          key = edge(a, b),
          p = coords.get(a)!,
          q = coords.get(b)!;
        if (
          boundary.has(key) ||
          splits.has(key) ||
          Math.hypot(p[0] - q[0], p[1] - q[1]) <= spacing
        )
          continue;
        if (nextId - count >= 4096)
          return reject("patch refinement budget exceeded");
        splits.set(key, nextId);
        coords.set(nextId++, p.map((v, i) => (v + q[i]) / 2) as Vec3);
      }
    if (!splits.size) break;
    const refined: number[][] = [];
    for (const t of triangles) {
      const mids = t.map((a, k) => splits.get(edge(a, t[(k + 1) % 3]))),
        n = mids.filter((v) => v !== undefined).length;
      if (!n) {
        refined.push(t);
        continue;
      }
      if (n === 3) {
        const [a, b, c] = t,
          [ab, bc, ca] = mids as number[];
        refined.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
        continue;
      }
      const k =
        n === 1
          ? mids.findIndex((v) => v !== undefined)
          : mids.findIndex(
              (v, i) => v !== undefined && mids[(i + 1) % 3] !== undefined,
            );
      const a = t[k],
        b = t[(k + 1) % 3],
        c = t[(k + 2) % 3],
        ab = mids[k]!;
      if (n === 1) refined.push([a, ab, c], [ab, b, c]);
      else {
        const bc = mids[(k + 1) % 3]!;
        refined.push([b, bc, ab], [a, ab, c], [ab, bc, c]);
      }
    }
    triangles = refined;
    legalize();
    if (pass === 11) return reject("patch refinement iteration limit");
  }
  const inserted: number[] = [];
  for (let id = count; id < nextId; id++) {
    if ((id - count) % 128 === 0) cancel();
    inserted.push(...surface.evaluate(coords.get(id)!));
  }
  const insertedNormals = new Float64Array(inserted.length);
  const finalPoint = (id: number): Vec3 =>
    id < count
      ? point(id)
      : (inserted.slice((id - count) * 3, (id - count) * 3 + 3) as Vec3);
  for (const [a, b, c] of triangles) {
    const n = cross(
      sub(finalPoint(b), finalPoint(a)),
      sub(finalPoint(c), finalPoint(a)),
    );
    for (const id of [a, b, c])
      if (id >= count)
        for (let k = 0; k < 3; k++)
          insertedNormals[(id - count) * 3 + k] += n[k];
  }
  for (let i = 0; i < insertedNormals.length; i += 3)
    insertedNormals.set(
      unit(Array.from(insertedNormals.subarray(i, i + 3)) as Vec3),
      i,
    );
  return {
    fitRms: surface.fitRms,
    patch: {
      completed: true,
      remainingLoop: [],
      iterations: 0,
      insertedVertices: new Float64Array(inserted),
      insertedNormals,
      triangles: new Uint32Array(triangles.flat()),
    },
  };
}

const dot6 = (a: number[], b: number[]) =>
  a.reduce((sum, v, i) => sum + v * b[i], 0);
