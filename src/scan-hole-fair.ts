import { Vector2 } from "three";
import type { Vec3 } from "./types";
import type { MeshTopology, MeshProcessingOptions } from "./mesh-processing";
import { checkProgress, edgeId, pointAt } from "./scan-edit";
import { HoleRefinementError } from "./scan-hole-refine";

/** Minimum-bending graph fairing with the rim and retained one-ring fixed.
 * Cotangent rows at the rim include the original outside facets, constraining
 * continuation across the seam. Only newly generated heights are unknowns.
 */
export function fairHolePatch(...args: Parameters<typeof solveHolePatch>): {
  applied: boolean;
  limitedVertices: number;
} {
  const points = args[2],
    original = points.slice();
  try {
    return { applied: true, limitedVertices: solveHolePatch(...args) };
  } catch (error) {
    if (args[10].signal?.aborted)
      throw new DOMException("Mesh operation cancelled.", "AbortError");
    if (!(error instanceof HoleRefinementError)) throw error;
    // Blending is an enhancement. Keep the already refined patch available for
    // the caller's usual winding, intersection and topology validation.
    for (let i = 0; i < points.length; i++) points[i] = original[i];
    return { applied: false, limitedVertices: 0 };
  }
}

function solveHolePatch(
  topology: MeshTopology,
  loop: number[],
  points: Vec3[],
  projected: Vector2[],
  triangles: number[][],
  u: Vec3,
  v: Vec3,
  normal: Vec3,
  boundaryNormals: Vec3[],
  surface: (p: Vector2) => Vec3,
  options: MeshProcessingOptions,
  supportBounds?: readonly [number, number],
): number {
  const rimCount = loop.length,
    count = points.length - rimCount;
  if (!count) return 0;
  const fail = () => {
    throw new HoleRefinementError(
      "Hole surface blending did not converge; the hole was left unchanged.",
    );
  };
  if (count > 60000) return fail();
  const origin = points[0];
  const dot = (a: Vec3, b: Vec3) => a.reduce((s, x, k) => s + x * b[k], 0);
  const local = (p: Vec3) => p.map((x, k) => x - origin[k]) as Vec3;
  const xy = projected.map((p) => [p.x, p.y]);
  const heights = points.map((p) => dot(local(p), normal));
  const neighbors = points.map(() => new Map<number, number>());
  const areas = points.map(() => 0);
  const mapped = new Map(loop.map((id, i) => [id, i]));
  const rim = new Set(loop),
    faces = new Set<number>(),
    queue: number[] = [];
  for (let i = 0; i < loop.length; i++)
    for (const use of topology.edges.get(
      edgeId(loop[i], loop[(i + 1) % loop.length]),
    ) ?? [])
      if (!faces.has(use.face)) {
        faces.add(use.face);
        queue.push(use.face);
      }
  const vertex = (id: number) => {
    let mappedId = mapped.get(id);
    if (mappedId !== undefined) return mappedId;
    const p = local(pointAt(topology.vertices, id));
    mappedId = xy.length;
    mapped.set(id, mappedId);
    xy.push([dot(p, u), dot(p, v)]);
    heights.push(dot(p, normal));
    neighbors.push(new Map());
    areas.push(0);
    return mappedId;
  };
  const addTriangle = (ids: number[]) => {
    for (let k = 0; k < 3; k++) {
      const a = ids[k],
        b = ids[(k + 1) % 3],
        c = ids[(k + 2) % 3];
      const ax = xy[a][0] - xy[c][0],
        ay = xy[a][1] - xy[c][1],
        bx = xy[b][0] - xy[c][0],
        by = xy[b][1] - xy[c][1];
      const area = Math.abs(ax * by - ay * bx);
      if (area < 1e-16) return fail();
      areas[a] += area / 6;
      const weight = (ax * bx + ay * by) / area;
      if (!Number.isFinite(weight) || Math.abs(weight) > 1e8) return fail();
      neighbors[a].set(b, (neighbors[a].get(b) ?? 0) + weight);
      neighbors[b].set(a, (neighbors[b].get(a) ?? 0) + weight);
    }
  };
  for (const tri of triangles) addTriangle(tri);
  for (let q = 0; q < queue.length; q++) {
    if (q % 128 === 0) checkProgress(options, 0.96, "Fairing hole surface");
    const face = queue[q];
    addTriangle(
      Array.from(topology.triangles.subarray(face * 3, face * 3 + 3), vertex),
    );
    for (const next of topology.neighbors[face])
      if (!faces.has(next)) {
        const ids = topology.triangles.subarray(next * 3, next * 3 + 3);
        if (Array.from(ids).some((id) => rim.has(id))) {
          if (faces.size >= 8192) return fail();
          faces.add(next);
          queue.push(next);
        }
      }
  }
  const prior = Float64Array.from(heights.slice(rimCount, points.length));
  const reference = xy.map(([x, y], i) => {
    if (i % 128 === 0) checkProgress(options, 0.96, "Fairing hole surface");
    return dot(local(surface(new Vector2(x, y))), normal);
  });
  const rows: { ids: number[]; values: number[] }[] = [];
  const rhs = new Float64Array(count),
    diagonal = new Float64Array(count);
  // Screen the correction over several elements instead of allowing seam
  // constraints to flatten broad features supported by the interpolant.
  const tether = 1e-2;
  const rowScales = neighbors.slice(0, points.length).map((adjacent, id) => {
    let total = 0;
    for (const w of adjacent.values()) total += w;
    return total / Math.sqrt(Math.max(areas[id], 1e-20));
  });
  const orderedScales = rowScales.filter((a) => a > 0).sort((a, b) => a - b);
  const medianScale = orderedScales[Math.floor(orderedScales.length / 2)];
  for (let i = 0; i < count; i++) {
    rhs[i] = prior[i] * tether;
    diagonal[i] = tether;
  }
  for (let id = 0; id < points.length; id++) {
    const adjacent = neighbors[id];
    let total = 0;
    for (const w of adjacent.values()) total += w;
    if (total <= 1e-12) continue;
    const ids: number[] = [],
      values: number[] = [];
    let constant = 0;
    const term = (j: number, value: number) => {
      if (j >= rimCount && j < points.length) {
        ids.push(j - rimCount);
        values.push(value);
      } else constant += value * heights[j];
    };
    const scale = rowScales[id] / medianScale;
    term(id, scale);
    for (const [j, w] of adjacent) term(j, (-w / total) * scale);
    if (!ids.length) continue;
    // Preserve the supported interpolant's interior differential coordinates.
    // Fair the seam correction, rather than flattening the rib itself toward
    // a zero-curvature cap across long openings.
    let target = reference[id] * scale;
    for (const [j, w] of adjacent)
      target -= ((reference[j] * w) / total) * scale;
    for (let i = 0; i < ids.length; i++) {
      rhs[ids[i]] += values[i] * (target - constant);
      diagonal[ids[i]] += values[i] * values[i];
    }
    rows.push({ ids, values });
  }
  // Match the retained facet's transverse slope at each seam edge. Bending
  // energy alone can round off that slope even when the boundary is fixed.
  const patchEdges = new Map<string, number>();
  for (const tri of triangles)
    for (let k = 0; k < 3; k++) {
      const a = tri[k],
        b = tri[(k + 1) % 3];
      if (a < rimCount && b < rimCount)
        patchEdges.set(edgeId(a, b), tri[(k + 2) % 3]);
    }
  for (let i = 0; i < rimCount; i++) {
    const j = (i + 1) % rimCount;
    const inside = patchEdges.get(edgeId(i, j));
    const use = topology.edges.get(edgeId(loop[i], loop[j]))?.[0];
    if (inside === undefined || inside < rimCount || !use) continue;
    const ex = xy[j][0] - xy[i][0],
      ey = xy[j][1] - xy[i][1];
    const n = boundaryNormals[i].map(
      (a, k) => a + boundaryNormals[j][k],
    ) as Vec3;
    const nz = dot(n, normal),
      lengthSquared = ex * ex + ey * ey;
    if (nz <= 1e-12 || lengthSquared < 1e-16) return fail();
    const gx = -dot(n, u) / nz,
      gy = -dot(n, v) / nz;
    const px = xy[inside][0] - xy[i][0],
      py = xy[inside][1] - xy[i][1];
    const target =
      heights[i] +
      ((heights[j] - heights[i]) * (px * ex + py * ey)) / lengthSquared +
      ((-gx * ey + gy * ex) * (-px * ey + py * ex)) / lengthSquared;
    const id = inside - rimCount;
    rhs[id] += target;
    diagonal[id] += 1;
    rows.push({ ids: [id], values: [1] });
  }
  const apply = (x: Float64Array) => {
    const y = Float64Array.from(x, (a) => a * tether);
    for (const row of rows) {
      let sum = 0;
      for (let i = 0; i < row.ids.length; i++)
        sum += row.values[i] * x[row.ids[i]];
      for (let i = 0; i < row.ids.length; i++)
        y[row.ids[i]] += row.values[i] * sum;
    }
    return y;
  };
  const inner = (a: Float64Array, b: Float64Array) =>
    a.reduce((s, x, i) => s + x * b[i], 0);
  const x = prior.slice(),
    ax = apply(x),
    residual = Float64Array.from(rhs, (b, i) => b - ax[i]);
  const z = Float64Array.from(residual, (r, i) => r / diagonal[i]),
    direction = z.slice();
  let rz = inner(residual, z),
    iterations = 0;
  const tolerance = Math.max(1e-20, inner(rhs, rhs) * 1e-16);
  while (inner(residual, residual) > tolerance && iterations < 600) {
    if (iterations % 8 === 0)
      checkProgress(options, 0.97, "Fairing hole surface");
    const product = apply(direction),
      denominator = inner(direction, product);
    if (!(denominator > 0) || !Number.isFinite(rz)) return fail();
    const alpha = rz / denominator;
    for (let i = 0; i < count; i++) {
      x[i] += alpha * direction[i];
      residual[i] -= alpha * product[i];
      z[i] = residual[i] / diagonal[i];
    }
    const next = inner(residual, z),
      beta = next / rz;
    for (let i = 0; i < count; i++) direction[i] = z[i] + beta * direction[i];
    rz = next;
    iterations++;
  }
  if (inner(residual, residual) > tolerance) return fail();
  const minimum = supportBounds?.[0] ?? Math.min(...heights),
    maximum = supportBounds?.[1] ?? Math.max(...heights);
  let limitedVertices = 0;
  for (let i = 0; i < count; i++) {
    if (i % 128 === 0) checkProgress(options, 0.98, "Fairing hole surface");
    if (!Number.isFinite(x[i])) return fail();
    const bounded = Math.max(minimum, Math.min(maximum, x[i]));
    if (Math.abs(bounded - x[i]) > 1e-6) limitedVertices++;
    const id = rimCount + i,
      delta = bounded - prior[i];
    points[id] = points[id].map((h, k) => h + normal[k] * delta) as Vec3;
  }
  return limitedVertices;
}
