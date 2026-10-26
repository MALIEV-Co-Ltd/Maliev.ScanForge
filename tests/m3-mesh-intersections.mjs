import assert from "node:assert/strict";
import { Line3, Matrix4, Vector3 } from "three";
import { ExtendedTriangle } from "three-mesh-bvh";

const vertices = (t) => [t.a, t.b, t.c];
const same = (a, b) => a.equals(b);
function coplanarArea(a, b, axis) {
  const project = (p) =>
    axis === 0 ? [p.y, p.z] : axis === 1 ? [p.x, p.z] : [p.x, p.y];
  let polygon = vertices(a).map(project);
  const clip = vertices(b).map(project);
  const cross = (a, b, p) =>
    (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  const sign = Math.sign(cross(clip[0], clip[1], clip[2]));
  for (let i = 0; i < 3 && polygon.length; i++) {
    const c = clip[i],
      d = clip[(i + 1) % 3],
      next = [];
    for (let k = 0; k < polygon.length; k++) {
      const p = polygon[k],
        q = polygon[(k + 1) % polygon.length];
      const fp = sign * cross(c, d, p),
        fq = sign * cross(c, d, q),
        inside = fp >= 0,
        other = fq >= 0;
      if (inside) next.push(p);
      if (inside !== other) {
        const t = fp / (fp - fq);
        next.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
    polygon = next;
  }
  // Translate before the shoelace sum to avoid large-coordinate cancellation.
  if (polygon.length < 3) return { area: 0, polygon };
  const origin = polygon[0];
  let twice = 0;
  for (let i = 1; i + 1 < polygon.length; i++)
    twice +=
      (polygon[i][0] - origin[0]) * (polygon[i + 1][1] - origin[1]) -
      (polygon[i][1] - origin[1]) * (polygon[i + 1][0] - origin[0]);
  return { area: Math.abs(twice) / 2, polygon };
}
const line = new Line3(),
  normalA = new Vector3(),
  normalB = new Vector3(),
  crossNormal = new Vector3(),
  edge = new Line3(),
  closest = new Vector3();
export function invalidTriangleIntersection(a, b) {
  const shared = vertices(a).filter((p) => vertices(b).some((q) => same(p, q)));
  a.getNormal(normalA);
  b.getNormal(normalB);
  const coplanar =
    crossNormal.crossVectors(normalA, normalB).lengthSq() < 1e-20 &&
    Math.abs(normalA.dot(closest.subVectors(b.a, a.a))) < 1e-9;
  if (coplanar) {
    const n = [Math.abs(normalA.x), Math.abs(normalA.y), Math.abs(normalA.z)];
    const axis = n.indexOf(Math.max(...n));
    const overlap = coplanarArea(a, b, axis);
    if (overlap.area > 1e-12) return true;
    if (!overlap.polygon.length) return false;
    if (!shared.length) return true;
    const project = (p) =>
      axis === 0 ? [p.y, p.z] : axis === 1 ? [p.x, p.z] : [p.x, p.y];
    const start = project(shared[0]),
      end = project(shared[1] ?? shared[0]);
    const dx = end[0] - start[0],
      dy = end[1] - start[1],
      lengthSquared = dx * dx + dy * dy;
    return overlap.polygon.some((p) => {
      const t = lengthSquared
        ? Math.max(
            0,
            Math.min(
              1,
              ((p[0] - start[0]) * dx + (p[1] - start[1]) * dy) / lengthSquared,
            ),
          )
        : 0;
      return (
        (p[0] - start[0] - t * dx) ** 2 + (p[1] - start[1] - t * dy) ** 2 >
        1e-16
      );
    });
  }
  if (!a.intersectsTriangle(b, line)) return false;
  if (!shared.length) return true;
  if (shared.length === 1)
    return (
      line.start.distanceToSquared(shared[0]) > 1e-16 ||
      line.end.distanceToSquared(shared[0]) > 1e-16
    );
  edge.set(shared[0], shared[1]);
  return [line.start, line.end].some(
    (p) =>
      edge.closestPointToPoint(p, true, closest).distanceToSquared(p) > 1e-16,
  );
}
export function verifyIntersectionControls() {
  const tri = (p) => new ExtendedTriangle(...p.map((v) => new Vector3(...v)));
  const a = tri([
    [0, 0, 0],
    [2, 0, 0],
    [0, 2, 0],
  ]);
  assert(
    !invalidTriangleIntersection(
      a,
      tri([
        [0, 0, 0],
        [0, 2, 0],
        [-2, 0, 0],
      ]),
    ),
    "Shared edge allowed",
  );
  assert(
    !invalidTriangleIntersection(
      a,
      tri([
        [0, 0, 0],
        [-2, 0, 0],
        [0, 0, 2],
      ]),
    ),
    "Shared vertex allowed",
  );
  assert(
    invalidTriangleIntersection(
      a,
      tri([
        [0, 0, 0],
        [2, 0, 0],
        [1, 1, 0],
      ]),
    ),
    "Coplanar overlap beyond shared edge rejected",
  );
  assert(
    invalidTriangleIntersection(
      a,
      tri([
        [0.5, 0.5, -1],
        [0.5, 0.5, 1],
        [1, 0.5, 0],
      ]),
    ),
    "Transverse crossing rejected",
  );
  assert(
    !invalidTriangleIntersection(
      a,
      tri([
        [0, 0, 1],
        [2, 0, 1],
        [0, 2, 1],
      ]),
    ),
    "Separated surfaces allowed",
  );
  assert(
    !invalidTriangleIntersection(
      a,
      tri([
        [2, 0, 0],
        [3, 0, 0],
        [2, 1, 0],
      ]),
    ),
    "Shared endpoint allowed",
  );
  assert(
    !invalidTriangleIntersection(
      a,
      tri([
        [3, 0, 0],
        [4, 0, 0],
        [3, 1, 0],
      ]),
    ),
    "Coplanar disjoint surfaces allowed",
  );
  assert(
    invalidTriangleIntersection(
      a,
      tri([
        [0, 0, 0],
        [1, 0, 0],
        [1, -1, 0],
      ]),
    ),
    "Coplanar T-junction beyond shared vertex rejected",
  );
  return 8;
}
export function verifyMeshIntersections(bvh) {
  const controls = verifyIntersectionControls();
  let pairs = 0,
    hits = 0;
  const examples = [];
  bvh.bvhcast(bvh, new Matrix4(), {
    intersectsTriangles: (a, b, i, j) => {
      if (i >= j) return false;
      if (++pairs > 100000000)
        throw Error("Intersection work exceeds 100 million candidate pairs");
      if (invalidTriangleIntersection(a, b)) {
        hits++;
        if (examples.length < 16) examples.push([i, j]);
      }
      return false;
    },
  });
  return {
    method:
      "exhaustive-self-BVH-triangle-pairs-with-coplanar-area-and-shared-feature-exclusion",
    controls,
    pairs,
    invalidIntersections: hits,
    examples,
    tolerances: {
      coplanarDistance: 1e-9,
      coplanarArea: 1e-12,
      sharedFeatureSquaredDistance: 1e-16,
    },
    scope:
      "Full output triangle pairs; expected shared vertices/edges excluded. Floating-point geometric assessment, not exact arithmetic proof.",
  };
}
