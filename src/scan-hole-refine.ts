import { Vector2 } from "three";
import type { Vec3 } from "./types";
import type { MeshProcessingOptions } from "./mesh-processing";
import { checkProgress, edgeId } from "./scan-edit";

type Face = [number, number, number];
const orient = (a: Vector2, b: Vector2, c: Vector2) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Conforming interior refinement. Rim edges are constraints: neither endpoint
 * moves and no midpoint is inserted on an edge shared with the retained mesh. */
export function refineHolePatch(
  points: Vec3[],
  projected: Vector2[],
  seed: number[][],
  rimCount: number,
  surface: (p: Vector2) => Vec3,
  options: MeshProcessingOptions,
): { points: Vec3[]; triangles: Face[] } {
  const rim = new Set<string>();
  const lengths: number[] = [];
  for (let i = 0; i < rimCount; i++) {
    const j = (i + 1) % rimCount;
    rim.add(edgeId(i, j));
    lengths.push(projected[i].distanceTo(projected[j]));
  }
  lengths.sort((a, b) => a - b);
  // Median is insensitive to a few long gaps in a scanned boundary.
  const spacing = Math.max(lengths[Math.floor(lengths.length / 2)], 1e-9);
  const limit = spacing * Math.SQRT2;
  // A long fixed rim (often a bridge rail) cannot be surrounded by uniformly
  // tiny edges. Grade the target size away from those constraints instead of
  // repeatedly bisecting triangles whose unsplittable rim prevents convergence.
  const coarseRim = projected.slice(0, rimCount).flatMap((a, i) => {
    const b = projected[(i + 1) % rimCount],
      length = a.distanceTo(b);
    return length > 2 * limit ? [{ a, b, length }] : [];
  });
  const targetSize = (a: Vector2, b: Vector2) => {
    const center = a.clone().add(b).multiplyScalar(0.5);
    let target = limit;
    for (const edge of coarseRim) {
      const delta = edge.b.clone().sub(edge.a);
      const t = Math.max(
        0,
        Math.min(1, center.clone().sub(edge.a).dot(delta) / delta.lengthSq()),
      );
      const distance = center.distanceTo(
        edge.a.clone().addScaledVector(delta, t),
      );
      target = Math.max(target, edge.length * 0.75 - distance);
    }
    return target;
  };
  let triangles = seed.map((f) => [...f] as Face);
  const cap = 100000;
  for (let pass = 0; pass < 32; pass++) {
    checkProgress(
      options,
      Math.min(0.9, pass / 32),
      "Refining hole mesh density",
    );
    const splits = new Map<string, number>();
    for (const face of triangles)
      for (let k = 0; k < 3; k++) {
        const a = face[k],
          b = face[(k + 1) % 3],
          key = edgeId(a, b);
        if (rim.has(key) || splits.has(key)) continue;
        if (
          projected[a].distanceTo(projected[b]) <=
          targetSize(projected[a], projected[b])
        )
          continue;
        const p = projected[a].clone().add(projected[b]).multiplyScalar(0.5);
        splits.set(key, points.length);
        projected.push(p);
        points.push(surface(p));
      }
    if (!splits.size) {
      improvePatch(points, projected, triangles, rimCount, surface, options);
      return { points, triangles };
    }
    const next: Face[] = [];
    for (const [a, b, c] of triangles) {
      const ab = splits.get(edgeId(a, b)),
        bc = splits.get(edgeId(b, c)),
        ca = splits.get(edgeId(c, a));
      if (ab !== undefined && bc !== undefined && ca !== undefined)
        next.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
      else if (ab !== undefined && bc !== undefined)
        next.push([ab, b, bc], [a, ab, c], [ab, bc, c]);
      else if (bc !== undefined && ca !== undefined)
        next.push([bc, c, ca], [b, bc, a], [bc, ca, a]);
      else if (ca !== undefined && ab !== undefined)
        next.push([ca, a, ab], [c, ca, b], [ca, ab, b]);
      else if (ab !== undefined) next.push([a, ab, c], [ab, b, c]);
      else if (bc !== undefined) next.push([b, bc, a], [bc, c, a]);
      else if (ca !== undefined) next.push([c, ca, b], [ca, a, b]);
      else next.push([a, b, c]);
    }
    if (next.length > cap)
      throw new Error(
        "Hole refinement exceeded the safe patch size; the hole was left unchanged.",
      );
    triangles = next;
  }
  throw new Error(
    "Hole refinement did not converge; the hole was left unchanged.",
  );
}

/** Constrained Delaunay flips remove the long, skinny ear-cut fan; interior
 * relaxation improves element shape while retaining all rim coordinates. */
function improvePatch(
  points: Vec3[],
  projected: Vector2[],
  triangles: Face[],
  rimCount: number,
  surface: (p: Vector2) => Vec3,
  options: MeshProcessingOptions,
) {
  for (let pass = 0; pass < 12; pass++) {
    checkProgress(options, 0.9, "Fairing hole interior");
    const edges = new Map<
      string,
      { face: number; a: number; b: number; c: number }[]
    >();
    triangles.forEach((face, index) => {
      for (let k = 0; k < 3; k++) {
        const a = face[k],
          b = face[(k + 1) % 3],
          c = face[(k + 2) % 3];
        const key = edgeId(a, b),
          entries = edges.get(key) ?? [];
        entries.push({ face: index, a, b, c });
        edges.set(key, entries);
      }
    });
    const touched = new Set<number>();
    let flips = 0;
    for (const pair of edges.values()) {
      if (pair.length !== 2) continue;
      const [first, second] = pair;
      if (touched.has(first.face) || touched.has(second.face)) continue;
      const { a, b, c } = first,
        d = second.c;
      if (edges.has(edgeId(c, d))) continue;
      const pc = projected[c],
        pd = projected[d],
        pa = projected[a],
        pb = projected[b];
      if (orient(pc, pa, pd) <= 1e-14 || orient(pc, pd, pb) <= 1e-14) continue;
      const cot = (p: Vector2, q: Vector2, origin: Vector2) => {
        const u = p.clone().sub(origin),
          v = q.clone().sub(origin);
        return u.dot(v) / Math.max(Math.abs(u.cross(v)), 1e-20);
      };
      if (cot(pa, pb, pc) + cot(pa, pb, pd) >= -1e-8) continue;
      triangles[first.face] = [c, a, d];
      triangles[second.face] = [c, d, b];
      touched.add(first.face);
      touched.add(second.face);
      flips++;
    }
    if (!flips) break;
  }
  const neighbors = Array.from(
    { length: points.length },
    () => new Set<number>(),
  );
  const incident = Array.from({ length: points.length }, () => [] as Face[]);
  for (const face of triangles)
    for (let k = 0; k < 3; k++) {
      incident[face[k]].push(face);
      neighbors[face[k]].add(face[(k + 1) % 3]);
      neighbors[face[k]].add(face[(k + 2) % 3]);
    }
  for (let pass = 0; pass < 3; pass++) {
    checkProgress(options, 0.95, "Blending hole surface");
    for (let id = rimCount; id < projected.length; id++) {
      if (!neighbors[id].size) continue;
      const average = new Vector2();
      for (const n of neighbors[id]) average.add(projected[n]);
      average.multiplyScalar(1 / neighbors[id].size);
      const previous = projected[id];
      projected[id] = previous.clone().lerp(average, 0.35);
      if (
        incident[id].some(
          (f) =>
            orient(projected[f[0]], projected[f[1]], projected[f[2]]) <= 1e-14,
        )
      )
        projected[id] = previous;
      else points[id] = surface(projected[id]);
    }
  }
}

/** A quadratic Hermite fit constrains both rim heights and tangent slopes.
 * Coordinates are scaled before solving, so millimetre-sized and large scans
 * use the same numerical conditioning. Singular fits use local tangent planes. */
export function holeSurface(
  points: Vec3[],
  projected: Vector2[],
  normals: Vec3[],
  origin: Vec3,
  u: Vec3,
  v: Vec3,
  normal: Vec3,
  method: "flat" | "tangent" | "curvature",
): (p: Vector2) => Vec3 {
  const dot = (a: Vec3, b: Vec3) => a.reduce((s, x, i) => s + x * b[i], 0);
  const boundary = projected.map((p) => p.clone());
  const scale = boundary.reduce((s, p) => Math.max(s, p.length()), 1e-9);
  const samples = boundary.map((p, i) => {
    const denominator = dot(normals[i], normal);
    return {
      x: p.x / scale,
      y: p.y / scale,
      z: dot(points[i].map((x, k) => x - origin[k]) as Vec3, normal) / scale,
      dx:
        Math.abs(denominator) > 0.2
          ? -dot(normals[i], u) / denominator
          : undefined,
      dy:
        Math.abs(denominator) > 0.2
          ? -dot(normals[i], v) / denominator
          : undefined,
    };
  });
  const matrix = Array.from({ length: 6 }, () => new Array<number>(7).fill(0));
  const equation = (row: number[], value: number, weight: number) => {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 6; j++) matrix[i][j] += weight * row[i] * row[j];
      matrix[i][6] += weight * row[i] * value;
    }
  };
  for (const { x, y, z, dx, dy } of samples) {
    equation([1, x, y, x * x, x * y, y * y], z, 4);
    if (dx !== undefined && dy !== undefined) {
      equation([0, 1, 0, 2 * x, y, 0], dx, 1);
      equation([0, 0, 1, 0, x, 2 * y], dy, 1);
    }
  }
  let solvable = true;
  for (let k = 0; k < 6; k++) {
    let pivot = k;
    for (let i = k + 1; i < 6; i++)
      if (Math.abs(matrix[i][k]) > Math.abs(matrix[pivot][k])) pivot = i;
    [matrix[k], matrix[pivot]] = [matrix[pivot], matrix[k]];
    if (Math.abs(matrix[k][k]) < 1e-10) {
      solvable = false;
      break;
    }
    const divisor = matrix[k][k];
    for (let j = k; j <= 6; j++) matrix[k][j] /= divisor;
    for (let i = 0; i < 6; i++)
      if (i !== k) {
        const factor = matrix[i][k];
        for (let j = k; j <= 6; j++) matrix[i][j] -= factor * matrix[k][j];
      }
  }
  return (p) => {
    const x = p.x / scale,
      y = p.y / scale;
    let local = 0,
      weights = 0;
    for (const s of samples) {
      const d2 = (x - s.x) ** 2 + (y - s.y) ** 2;
      const weight = 1 / Math.max(d2 * d2, 1e-16);
      local +=
        weight * (s.z + (s.dx ?? 0) * (x - s.x) + (s.dy ?? 0) * (y - s.y));
      weights += weight;
    }
    const basis = [1, x, y, x * x, x * y, y * y];
    const fit = solvable
      ? basis.reduce((sum, b, i) => sum + b * matrix[i][6], 0)
      : local / weights;
    // Blend to the actual rim tangent in its immediate neighbourhood; this
    // preserves noisy rim geometry instead of exposing a mismatched fitted cap.
    let distance = Infinity,
      rimHeight = local / weights;
    for (let i = 0; i < boundary.length; i++) {
      const j = (i + 1) % boundary.length;
      const a = boundary[i],
        b = boundary[j];
      const edge = b.clone().sub(a);
      const t = Math.max(
        0,
        Math.min(
          1,
          p.clone().sub(a).dot(edge) / Math.max(edge.lengthSq(), 1e-20),
        ),
      );
      const q = a.clone().addScaledVector(edge, t);
      const d = p.distanceTo(q) / scale;
      if (d < distance) {
        distance = d;
        const first = samples[i],
          second = samples[j];
        const dx = (1 - t) * (first.dx ?? 0) + t * (second.dx ?? 0);
        const dy = (1 - t) * (first.dy ?? 0) + t * (second.dy ?? 0);
        rimHeight =
          (1 - t) * first.z +
          t * second.z +
          (dx * (p.x - q.x)) / scale +
          (dy * (p.y - q.y)) / scale;
      }
    }
    // Tangent mode prioritizes a wider first-derivative rim band; curvature
    // mode reaches the second-order interior fit sooner.
    const blend = Math.min(1, distance * (method === "curvature" ? 8 : 4));
    const height =
      method === "flat"
        ? 0
        : Math.max(-0.5, Math.min(0.5, (1 - blend) * rimHeight + blend * fit)) *
          scale;
    return origin.map(
      (value, i) => value + u[i] * p.x + v[i] * p.y + normal[i] * height,
    ) as Vec3;
  };
}

/** Validate the complete disk before appending it: no partial cap, flipped
 * facets, duplicate facets, open internal edges or missing rim edges. */
export function validHolePatch(
  projected: Vector2[],
  triangles: number[][],
  rimCount: number,
): boolean {
  const edges = new Map<string, { count: number; balance: number }>();
  const faces = new Set<string>();
  let area = 0;
  for (const face of triangles) {
    const signed = orient(
      projected[face[0]],
      projected[face[1]],
      projected[face[2]],
    );
    if (!(signed > 1e-14)) return false;
    area += signed;
    const key = [...face].sort((a, b) => a - b).join(":");
    if (faces.has(key)) return false;
    faces.add(key);
    for (let k = 0; k < 3; k++) {
      const a = face[k],
        b = face[(k + 1) % 3],
        key = edgeId(a, b);
      const entry = edges.get(key) ?? { count: 0, balance: 0 };
      entry.count++;
      entry.balance += a < b ? 1 : -1;
      edges.set(key, entry);
    }
  }
  let rimArea = 0;
  for (let i = 0; i < rimCount; i++) {
    const j = (i + 1) % rimCount,
      a = projected[i],
      b = projected[j];
    rimArea += a.x * b.y - a.y * b.x;
    const entry = edges.get(edgeId(i, j));
    if (entry?.count !== 1) return false;
    edges.delete(edgeId(i, j));
  }
  return (
    Math.abs(area - rimArea) <= Math.max(1e-10, Math.abs(rimArea) * 1e-7) &&
    [...edges.values()].every((e) => e.count === 2 && e.balance === 0)
  );
}
