import { Vector2 } from "three";
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

/** Free rails must remain inside the selected opening, including concave rims. */
export function bridgeInsideBoundary(
  boundary: Vector2[],
  corners: number[],
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
): boolean {
  const ring = [0, 1];
  for (let i = 5; i < projected.length; i += 2) ring.push(i);
  ring.push(2, 3);
  for (let i = projected.length - 2; i >= 4; i -= 2) ring.push(i);
  const mapping = new Map(ring.map((id, i) => [id, i]));
  return validHolePatch(
    ring.map((id) => projected[id]),
    triangles.map((face) => face.map((id) => mapping.get(id)!)),
    ring.length,
  );
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
