import { hasShrinkwrapLocalIntersection } from "./scan-shrinkwrap-embedding";
import { ShapeUtils, Vector2 } from "three";

function area(p: Float32Array, t: readonly number[]) {
  const a = t[0] * 3,
    b = t[1] * 3,
    c = t[2] * 3;
  const ux = p[b] - p[a],
    uy = p[b + 1] - p[a + 1],
    uz = p[b + 2] - p[a + 2],
    vx = p[c] - p[a],
    vy = p[c + 1] - p[a + 1],
    vz = p[c + 2] - p[a + 2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}
const dot = (a: number[], b: number[]) =>
  a.reduce((sum, v, i) => sum + v * b[i], 0);
export interface ShrinkwrapOrientation {
  normals: Float32Array;
  /** Captured front +1, inferred back -1, transition/rim 0. */
  regions: Int8Array;
}
/** Keeps shared cell-face contours. Source normals define captured-front orientation;
 * a mixed transition can rotate beyond 90 degrees without being a reflection.
 * Problematic deformations require a local 3D embedding check or a simple projected boundary and a consistent
 * local triangulation; this is not a global self-intersection certification. */
export function fitShrinkwrapContour(
  triangles: number[][],
  before: Float32Array,
  after: Float32Array,
  cellBounds?: number[][],
  orientation?: ShrinkwrapOrientation,
): number[][] {
  const valid = (t: number[]) => {
    const n = area(before, t),
      m = area(after, t);
    if (!(dot(m, m) > 0)) return false;
    if (orientation) {
      const region = orientation.regions[t[0]];
      if (region === 1 && t.every((id) => orientation.regions[id] === 1)) {
        const expected = [0, 1, 2].map((axis) =>
          t.reduce(
            (sum, id) => sum + orientation.normals[id * 3 + axis] * region,
            0,
          ),
        );
        if (!(dot(m, expected) > 0)) return false;
      }
    } else if (!(dot(n, m) > 0)) return false;
    if (
      cellBounds &&
      [0, 1, 2].some((axis) =>
        cellBounds[axis].some((bound) =>
          t.every((id) => before[id * 3 + axis] === Math.fround(bound)),
        ),
      )
    )
      return false;
    return true;
  };
  const originalIntersects = hasShrinkwrapLocalIntersection(triangles, after);
  if (
    !originalIntersects &&
    triangles.every((t) => valid(t) && dot(area(before, t), area(after, t)) > 0)
  )
    return triangles;
  if (orientation && triangles.every(valid) && !originalIntersects)
    return triangles;
  const edges = new Map<string, { from: number; to: number; count: number }>();
  for (const t of triangles)
    for (let i = 0; i < 3; i++) {
      const from = t[i],
        to = t[(i + 1) % 3],
        key = from < to ? `${from}:${to}` : `${to}:${from}`;
      const edge = edges.get(key);
      if (edge) edge.count++;
      else edges.set(key, { from, to, count: 1 });
    }
  const boundary = new Map<number, number>();
  for (const edge of edges.values())
    if (edge.count === 1) {
      if (boundary.has(edge.from))
        throw Error("ShrinkWrap has a branching transformed cell contour.");
      boundary.set(edge.from, edge.to);
    }
  const result: number[][] = [];
  while (boundary.size) {
    const start = boundary.keys().next().value!,
      loop: number[] = [];
    let current = start;
    do {
      const next = boundary.get(current);
      if (next === undefined || loop.includes(current))
        throw Error("ShrinkWrap has an open transformed cell contour.");
      loop.push(current);
      boundary.delete(current);
      current = next;
    } while (current !== start);
    const normal = [0, 0, 0];
    for (let i = 1; i < loop.length - 1; i++) {
      const n = area(after, [loop[0], loop[i], loop[i + 1]]);
      for (let axis = 0; axis < 3; axis++) normal[axis] += n[axis];
    }
    if (!(dot(normal, normal) > 0))
      throw Error("ShrinkWrap source fitting collapsed a transformed contour.");
    const axes = [0, 1, 2].sort(
      (a, b) => Math.abs(normal[b]) - Math.abs(normal[a]),
    );
    let accepted: number[][] | undefined;
    for (const axis of axes) {
      if (normal[axis] === 0) continue;
      const projected = loop.map(
        (id) =>
          new Vector2(
            after[id * 3 + ((axis + 1) % 3)],
            after[id * 3 + ((axis + 2) % 3)],
          ),
      );
      const orient = (a: Vector2, b: Vector2, c: Vector2) =>
        (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      let crossed = false;
      for (let i = 0; i < projected.length; i++)
        for (let j = i + 1; j < projected.length; j++) {
          const a = projected[i],
            b = projected[(i + 1) % loop.length],
            c = projected[j],
            d = projected[(j + 1) % loop.length];
          if (
            i === j ||
            (i + 1) % loop.length === j ||
            (j + 1) % loop.length === i
          )
            continue;
          if (
            orient(a, b, c) * orient(a, b, d) <= 0 &&
            orient(c, d, a) * orient(c, d, b) <= 0 &&
            Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <=
              Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
            Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <=
              Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
          )
            crossed = true;
        }
      if (crossed) continue;
      const candidates = ShapeUtils.triangulateShape(projected, []).map((t) =>
        t.map((i) => loop[i]),
      );
      if (candidates.length !== loop.length - 2) continue;
      const oriented = candidates.map((t) =>
        dot(area(after, t), normal) < 0 ? [t[0], t[2], t[1]] : t,
      );
      if (oriented.every(valid)) {
        accepted = oriented;
        break;
      }
    }
    if (!accepted)
      throw Error(
        "ShrinkWrap source fitting inverted, collapsed or self-crossed a local contour; decrease sample interval, extra thickness or gap fill.",
      );
    result.push(...accepted);
  }
  if (hasShrinkwrapLocalIntersection(result, after))
    throw Error(
      "ShrinkWrap local contour patches intersect after retriangulation; decrease sample interval or gap fill.",
    );
  return result;
}
