import { Box3, Line3, Plane, Vector2, Vector3 } from "three";
import { ExtendedTriangle } from "three-mesh-bvh";
import type { Vec3 } from "./types";
import type { MeshProcessingOptions, MeshTopology } from "./mesh-processing";
import {
  checkProgress,
  crossProduct,
  dotProduct,
  edgeId,
  pointAt,
  subtract,
} from "./scan-edit";
import { validHolePatch } from "./scan-hole-refine";
import { flatHoleTriangles } from "./scan-hole-flat";

/** Validate the final Float32 strip against retained facets, including transverse walls. */
export function bridgeIntersectsMesh(
  topology: MeshTopology,
  points: Vec3[],
  triangles: number[][],
  attachments: number[],
  options: MeshProcessingOptions,
): boolean {
  const tolerance = options.tolerance ?? 1e-6;
  const vertices = points.map(
    (p) => new Vector3(...(p.map(Math.fround) as Vec3)),
  );
  const bounds = new Box3().setFromPoints(vertices).expandByScalar(tolerance);
  const patches = triangles.map((ids) => {
    const triangle = new ExtendedTriangle();
    triangle.set(vertices[ids[0]], vertices[ids[1]], vertices[ids[2]]);
    triangle.needsUpdate = true;
    return {
      ids,
      triangle,
      bounds: new Box3()
        .setFromPoints(ids.map((id) => vertices[id]))
        .expandByScalar(tolerance),
      plane: triangle.getPlane(new Plane()),
    };
  });
  const source = new ExtendedTriangle(),
    sourceBounds = new Box3(),
    intersection = new Line3();
  const sharedEdge = new Line3(),
    closest = new Vector3();
  const sourcePoints = [source.a, source.b, source.c];
  const toleranceSq = tolerance * tolerance;
  for (let face = 0; face < topology.triangles.length / 3; face++) {
    if (face % 1024 === 0)
      checkProgress(
        options,
        face / Math.max(1, topology.triangles.length / 3),
        "Checking patch surface intersections",
      );
    const sourceIds = [
      topology.triangles[face * 3],
      topology.triangles[face * 3 + 1],
      topology.triangles[face * 3 + 2],
    ];
    sourceBounds.makeEmpty();
    for (let corner = 0; corner < 3; corner++) {
      const id = sourceIds[corner];
      sourcePoints[corner].set(
        Math.fround(topology.vertices[id * 3]),
        Math.fround(topology.vertices[id * 3 + 1]),
        Math.fround(topology.vertices[id * 3 + 2]),
      );
      sourceBounds.expandByPoint(sourcePoints[corner]);
    }
    if (!bounds.intersectsBox(sourceBounds)) continue;
    source.needsUpdate = true;
    for (const patch of patches) {
      if (!patch.bounds.intersectsBox(sourceBounds)) continue;
      const shared = patch.ids
        .filter(
          (id) =>
            id < attachments.length && sourceIds.includes(attachments[id]),
        )
        .map((id) => vertices[id]);
      const allowedContact = (p: Vector3) => {
        if (shared.length === 1)
          return p.distanceToSquared(shared[0]) <= toleranceSq;
        if (shared.length === 2) {
          sharedEdge.set(shared[0], shared[1]);
          return (
            sharedEdge
              .closestPointToPoint(p, true, closest)
              .distanceToSquared(p) <= toleranceSq
          );
        }
        return false;
      };
      if (
        sourcePoints.every(
          (p) => Math.abs(patch.plane.distanceToPoint(p)) <= tolerance,
        )
      ) {
        const normal = patch.plane.normal;
        const drop =
          Math.abs(normal.x) > Math.abs(normal.y)
            ? Math.abs(normal.x) > Math.abs(normal.z)
              ? 0
              : 2
            : Math.abs(normal.y) > Math.abs(normal.z)
              ? 1
              : 2;
        const project = (p: Vector3) =>
          drop === 0
            ? new Vector2(p.y, p.z)
            : drop === 1
              ? new Vector2(p.x, p.z)
              : new Vector2(p.x, p.y);
        if (
          bridgeOverlapsTriangle(
            patch.ids.map((id) => project(vertices[id])),
            [[0, 1, 2]],
            sourcePoints.map(project),
            toleranceSq,
          )
        )
          return true;
        // A zero-area contact can still pinch a free rail or create a T-junction.
        // For coplanar convex triangles, every such contact has an endpoint
        // among the vertices contained in (or on an edge of) the other triangle.
        if (
          sourcePoints.some(
            (p) =>
              patch.triangle
                .closestPointToPoint(p, closest)
                .distanceToSquared(p) <= toleranceSq && !allowedContact(p),
          ) ||
          patch.ids.some((id) => {
            const p = vertices[id];
            return (
              source.closestPointToPoint(p, closest).distanceToSquared(p) <=
                toleranceSq && !allowedContact(p)
            );
          })
        )
          return true;
        continue;
      }
      if (!patch.triangle.intersectsTriangle(source, intersection)) continue;
      if (
        allowedContact(intersection.start) &&
        allowedContact(intersection.end)
      )
        continue;
      return true;
    }
  }
  checkProgress(options, 1, "Bridge surface intersections checked");
  return false;
}

/** Positive-area intersection excludes the shared attachment edges themselves. */
export function bridgeOverlapsTriangle(
  projected: Vector2[],
  triangles: number[][],
  source: Vector2[],
  epsilon: number,
): boolean {
  const orient = (a: Vector2, b: Vector2, c: Vector2) =>
    b.clone().sub(a).cross(c.clone().sub(a));
  const direction = Math.sign(orient(source[0], source[1], source[2]));
  if (!direction) return false;
  return triangles.some((face) => {
    let polygon = face.map((id) => projected[id]);
    for (let i = 0; i < 3 && polygon.length; i++) {
      const a = source[i],
        b = source[(i + 1) % 3];
      const clipped: Vector2[] = [];
      for (let j = 0; j < polygon.length; j++) {
        const p = polygon[j],
          q = polygon[(j + 1) % polygon.length];
        const dp = direction * orient(a, b, p),
          dq = direction * orient(a, b, q);
        if (dp >= 0) clipped.push(p);
        if (dp < 0 !== dq < 0) clipped.push(p.clone().lerp(q, dp / (dp - dq)));
      }
      polygon = clipped;
    }
    const area = polygon.reduce(
      (sum, p, i) => sum + p.cross(polygon[(i + 1) % polygon.length]),
      0,
    );
    return Math.abs(area) > epsilon * 2;
  });
}

/** Reject rails crossing a rim; optional containment applies to hole-only callers. */
export function bridgeInsideBoundary(
  boundary: Vector2[],
  corners: number[],
  requireInside = true,
): boolean {
  const orient = (a: Vector2, b: Vector2, c: Vector2) =>
    b.clone().sub(a).cross(c.clone().sub(a));
  for (const [from, to] of [
    [corners[1], corners[2]],
    [corners[3], corners[0]],
  ]) {
    const a = boundary[from],
      b = boundary[to];
    for (let i = 0; i < boundary.length; i++) {
      const j = (i + 1) % boundary.length;
      if (i === from || i === to || j === from || j === to) continue;
      const c = boundary[i],
        d = boundary[j];
      if (
        orient(a, b, c) * orient(a, b, d) <= 0 &&
        orient(c, d, a) * orient(c, d, b) <= 0 &&
        Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) <=
          Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) &&
        Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) <=
          Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y))
      )
        return false;
    }
    // An existing boundary edge is itself a valid rail (a four-edge opening).
    if (
      (from + 1) % boundary.length === to ||
      (to + 1) % boundary.length === from
    )
      continue;
    if (!requireInside) continue;
    const midpoint = a.clone().add(b).multiplyScalar(0.5);
    let inside = false;
    for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
      const c = boundary[i],
        d = boundary[j];
      if (
        c.y > midpoint.y !== d.y > midpoint.y &&
        midpoint.x < ((d.x - c.x) * (midpoint.y - c.y)) / (d.y - c.y) + c.x
      )
        inside = !inside;
    }
    if (!inside) return false;
  }
  return true;
}

/** Validate the subdivided free rails as part of the strip boundary. */
export function validBridgePatch(
  projected: Vector2[],
  triangles: number[][],
  boundary?: number[],
): boolean {
  const ring = boundary ?? [0, 1];
  if (!boundary) {
    for (let i = 5; i < projected.length; i += 2) ring.push(i);
    ring.push(2, 3);
    for (let i = projected.length - 2; i >= 4; i -= 2) ring.push(i);
  }
  const mapping = new Map(ring.map((id, i) => [id, i]));
  return validHolePatch(
    ring.map((id) => projected[id]),
    triangles.map((face) => face.map((id) => mapping.get(id)!)),
    ring.length,
  );
}

/** Native Flat samples each free rail at the mean attachment-edge spacing,
 * then clips the complete rim. The two rails may have different counts.
 * Only local patch records are allocated; retained mesh edges stay intact. */
export function refineFlatBridgeStrip(
  points: Vec3[],
  projected: Vector2[],
  normal: Vec3,
  options: MeshProcessingOptions,
  retainedDiagonals: readonly string[] = [],
): { triangles: number[][]; boundary: number[] } {
  // Native distance mixes widened and Float32 endpoint differences.
  const distance = (a: Vec3, b: Vec3) =>
    Math.sqrt(
      a.reduce(
        (sum, value, k) => sum + (value - b[k]) * Math.fround(value - b[k]),
        0,
      ),
    );
  const spacing =
    (distance(points[0], points[1]) + distance(points[2], points[3])) / 2;
  const counts = [
    [0, 3],
    [1, 2],
  ].map(([a, b]) =>
    Math.max(1, Math.floor(distance(points[a], points[b]) / spacing)),
  );
  // Smallest-corner clipping rescans the rim. Bound its quadratic work to
  // about two million candidate visits, rather than lowering native density.
  if (!counts.every(Number.isSafeInteger) || counts[0] + counts[1] + 2 > 2048)
    throw new Error("Flat bridge exceeds the supported boundary size.");
  const rails = [
    [0, 3],
    [1, 2],
  ].map(([a, b], rail) => {
    const ids = [a],
      steps = counts[rail],
      increment = 1 / steps;
    let fraction = increment;
    for (let row = 1; row < steps; row++, fraction += increment) {
      checkProgress(options, row / steps, "Interpolating flat bridge rails");
      ids.push(points.length);
      points.push(
        points[a].map((value, k) =>
          Math.fround(value + Math.fround(points[b][k] - value) * fraction),
        ) as Vec3,
      );
      projected.push(projected[a].clone().lerp(projected[b], fraction));
    }
    ids.push(b);
    return ids;
  });
  const boundary = [0, ...rails[1], ...rails[0].slice(1).reverse()];
  const triangles = flatHoleTriangles(
    {
      vertices: Float64Array.from(points.flat()),
      edges: new Map(retainedDiagonals.map((key) => [key, []] as const)),
    },
    boundary,
    normal,
    options.signal,
  );
  if (!triangles)
    throw new Error("Flat bridge triangulation could not close the strip.");
  for (const tri of triangles) {
    const a = projected[tri[0]],
      b = projected[tri[1]],
      c = projected[tri[2]];
    if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0)
      [tri[1], tri[2]] = [tri[2], tri[1]];
  }
  return { triangles, boundary };
}

/** Use the actual attachment facets, without averaging across unrelated sharp edges. */
export function bridgeAttachmentNormals(
  topology: MeshTopology,
  loop: number[],
): Vec3[] {
  return loop.map((_, i) => {
    const edge = i < 2 ? 0 : 2;
    const use = topology.edges.get(edgeId(loop[edge], loop[edge + 1]))?.[0];
    if (!use) return [0, 0, 0];
    const [a, b, c] = [0, 1, 2].map((k) =>
      pointAt(topology.vertices, topology.triangles[use.face * 3 + k]),
    );
    const n = crossProduct(subtract(b, a), subtract(c, a));
    const length = Math.hypot(...n);
    return n.map((value) => value / Math.max(length, 1e-20)) as Vec3;
  });
}

/** A bounded Hermite or quadratic ladder joins the two intact attachment edges.
 * Only the free rails gain vertices; retained mesh edges are never split.
 * Projected rails stay straight, so the strip cannot fold over in its plane. */
export function refineBridgeStrip(
  points: Vec3[],
  projected: Vector2[],
  normals: Vec3[],
  normal: Vec3,
  options: MeshProcessingOptions,
  method: "tangent" | "curvature" = "tangent",
): number[][] {
  const distance = Math.max(
    projected[0].distanceTo(projected[3]),
    projected[1].distanceTo(projected[2]),
  );
  const width = Math.max(
    1e-9,
    Math.min(
      projected[0].distanceTo(projected[1]),
      projected[2].distanceTo(projected[3]),
    ),
  );
  const steps = Math.min(64, Math.max(8, Math.ceil(distance / width)));
  const triangles: number[][] = [];
  let previous = [0, 1];
  const interpolate = (a: number, b: number, t: number): Vec3 => {
    const chord = subtract(points[b], points[a]);
    const slope = (n: Vec3) => {
      const denominator = dotProduct(n, normal);
      if (denominator <= 0.2) return 0;
      return Math.max(
        -distance * 2,
        Math.min(distance * 2, -dotProduct(n, chord) / denominator),
      );
    };
    const startSlope = slope(normals[a]),
      endSlope = slope(normals[b]);
    // The quadratic minimizes the two endpoint slope residuals while fixing
    // both edge positions. It has constant second derivative along the rail;
    // tangent mode instead matches both slopes exactly with a cubic.
    const height =
      method === "curvature"
        ? 0.5 * (startSlope - endSlope) * t * (1 - t)
        : (t * t * t - 2 * t * t + t) * startSlope +
          (t * t * t - t * t) * endSlope;
    return points[a].map(
      (value, k) => value + t * chord[k] + normal[k] * height,
    ) as Vec3;
  };
  for (let row = 1; row <= steps; row++) {
    checkProgress(options, row / steps, "Interpolating bridge tangents");
    let next: number[];
    if (row === steps) next = [3, 2];
    else {
      next = [];
      for (const [a, b] of [
        [0, 3],
        [1, 2],
      ]) {
        next.push(points.length);
        points.push(interpolate(a, b, row / steps));
        projected.push(projected[a].clone().lerp(projected[b], row / steps));
      }
    }
    triangles.push(
      [previous[0], previous[1], next[1]],
      [previous[0], next[1], next[0]],
    );
    previous = next;
  }
  return triangles;
}
