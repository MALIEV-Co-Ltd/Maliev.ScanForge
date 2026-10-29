import type { Vec3 } from "./types";
import { analyzeMesh, type MeshProcessingOptions } from "./mesh-processing";
import { splitGeneralCutter } from "./scan-edit-general-split";
import { appendSplitTriangle } from "./scan-split-triangle";
import {
  pointAt,
  subtract,
  crossProduct,
  dotProduct,
  checkProgress,
  finiteOutput,
  type ScanEditRequest,
  type ScanEditResult,
} from "./scan-edit";
interface Plane {
  origin: Vec3;
  normal: Vec3;
}
function normalized(p: Plane): Plane {
  const length = Math.hypot(...p.normal);
  if (![...p.normal, ...p.origin].every(Number.isFinite) || !length)
    throw new Error("A finite nonzero split plane is required.");
  return { origin: p.origin, normal: p.normal.map((v) => v / length) as Vec3 };
}
function cutPolygon(polygon: Vec3[], plane: Plane, positive: boolean): Vec3[] {
  const output: Vec3[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length];
    const da =
        dotProduct(subtract(a, plane.origin), plane.normal) *
        (positive ? 1 : -1),
      db =
        dotProduct(subtract(b, plane.origin), plane.normal) *
        (positive ? 1 : -1);
    // Classify against the same plane used to interpolate intersections.
    const aIn = da >= 0,
      bIn = db >= 0;
    if (aIn) output.push(a);
    if (aIn !== bIn) {
      const fraction = da / (da - db);
      output.push(a.map((v, axis) => v + fraction * (b[axis] - v)) as Vec3);
    }
  }
  return output.filter(
    (p, i) => i === 0 || Math.hypot(...subtract(p, output[i - 1])) > 0,
  );
}
function appendPolygon(output: number[], polygon: Vec3[]) {
  for (let i = 1; i + 1 < polygon.length; i++)
    appendSplitTriangle(output, polygon[0], polygon[i], polygon[i + 1]);
}
/** Cuts intersected triangles into fragments, preserving winding. Output is uncapped. */
export function splitByPlane(
  r: ScanEditRequest,
  o: MeshProcessingOptions,
): ScanEditResult {
  const epsilon = o.tolerance ?? 1e-6;
  let planes: Plane[] = [];
  let solid = false;
  if (r.plane) planes = [normalized(r.plane)];
  else if (r.target) {
    const topology = analyzeMesh(r.target, o);
    if (topology.degenerateTriangles || topology.nonManifoldEdges)
      throw new Error(
        "Split cutter must contain nondegenerate manifold triangles.",
      );
    const centroid: Vec3 = [0, 0, 0];
    for (let i = 0; i < topology.vertices.length / 3; i++)
      for (let axis = 0; axis < 3; axis++)
        centroid[axis] +=
          topology.vertices[i * 3 + axis] / (topology.vertices.length / 3);
    const first = normalized({
      origin: pointAt(r.target, 0),
      normal: crossProduct(
        subtract(pointAt(r.target, 1), pointAt(r.target, 0)),
        subtract(pointAt(r.target, 2), pointAt(r.target, 0)),
      ),
    });
    const planar = Array.from({ length: r.target.length / 3 }, (_, i) =>
      pointAt(r.target!, i),
    ).every(
      (p) =>
        Math.abs(dotProduct(subtract(p, first.origin), first.normal)) <=
        epsilon,
    );
    if (planar) return splitGeneralCutter(r, o);
    else {
      if (topology.boundaryEdges || topology.components.length !== 1)
        return splitGeneralCutter(r, o);
      solid = true;
      for (let f = 0; f < r.target.length / 9; f++) {
        checkProgress(o, f / (r.target.length / 9), "Checking convex cutter");
        const [a, b, c] = [0, 1, 2].map((i) => pointAt(r.target!, f * 3 + i));
        let p = normalized({
          origin: a,
          normal: crossProduct(subtract(b, a), subtract(c, a)),
        });
        if (dotProduct(subtract(centroid, a), p.normal) > 0)
          p = { origin: a, normal: p.normal.map((v) => -v) as Vec3 };
        if (
          planes.some(
            (other) =>
              dotProduct(other.normal, p.normal) > 1 - 1e-8 &&
              Math.abs(
                dotProduct(subtract(p.origin, other.origin), p.normal),
              ) <= epsilon,
          )
        )
          continue;
        for (let i = 0; i < topology.vertices.length / 3; i++)
          if (
            dotProduct(subtract(pointAt(topology.vertices, i), a), p.normal) >
            epsilon
          )
            return splitGeneralCutter(r, o);
        planes.push(p);
      }
    }
  } else throw new Error("Choose a split plane or cutter object.");
  const inside: number[] = [],
    outside: number[] = [];
  let splitTriangles = 0;
  for (let face = 0; face < r.positions.length / 9; face++) {
    if (face % 1024 === 0)
      checkProgress(
        o,
        face / (r.positions.length / 9),
        "Splitting triangle fragments",
      );
    const triangle = [0, 1, 2].map((c) => pointAt(r.positions, face * 3 + c));
    if (r.selection && !r.selection[face]) {
      outside.push(...triangle.flat());
      continue;
    }
    if (!solid) {
      const distances = triangle.map((p) =>
        dotProduct(subtract(p, planes[0].origin), planes[0].normal),
      );
      if (distances.every((d) => Math.abs(d) <= epsilon)) {
        outside.push(...triangle.flat());
        continue;
      }
      const before = inside.length + outside.length;
      appendPolygon(inside, cutPolygon(triangle, planes[0], false));
      appendPolygon(outside, cutPolygon(triangle, planes[0], true));
      if (inside.length + outside.length - before > 9) splitTriangles++;
    } else {
      let remaining = triangle;
      let fragments = 0;
      for (const plane of planes) {
        if (remaining.length < 3) break;
        const distances = remaining.map((p) =>
          dotProduct(subtract(p, plane.origin), plane.normal),
        );
        if (distances.every((d) => Math.abs(d) <= epsilon)) continue;
        const rejected = cutPolygon(remaining, plane, true);
        const before = outside.length;
        appendPolygon(outside, rejected);
        fragments += (outside.length - before) / 9;
        remaining = cutPolygon(remaining, plane, false);
      }
      const before = inside.length;
      appendPolygon(inside, remaining);
      fragments += (inside.length - before) / 9;
      if (fragments > 1) splitTriangles++;
    }
  }
  checkProgress(o, 1, "Mesh split complete");
  return {
    segments: [finiteOutput(inside), finiteOutput(outside)],
    diagnostics: {
      splitTriangles,
      insideTriangles: inside.length / 9,
      outsideTriangles: outside.length / 9,
      capped: false,
      cutter: solid ? "closed convex mesh" : "infinite planar surface",
    },
  };
}
