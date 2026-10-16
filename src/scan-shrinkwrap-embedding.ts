import { Line3, Vector3 } from "three";
import { ExtendedTriangle } from "three-mesh-bvh";

/** Exact-facet local embedding check. Shared topology is permitted, while
 * coplanar overlap and intersections extending beyond shared vertices fail.
 * Neighbouring cells and the full output are deliberately outside this check. */
export function hasShrinkwrapLocalIntersection(
  triangles: number[][],
  positions: Float32Array,
) {
  if (triangles.length < 2) return false;
  const point = (id: number) => new Vector3().fromArray(positions, id * 3);
  const points = triangles.map((t) => t.map(point));
  const normals = points.map((p) =>
    new Vector3()
      .subVectors(p[1], p[0])
      .cross(new Vector3().subVectors(p[2], p[0]))
      .normalize(),
  );
  const facets: (ExtendedTriangle | undefined)[] = new Array(triangles.length);
  const facet = (index: number) =>
    facets[index] ??
    (facets[index] = new ExtendedTriangle(
      points[index][0],
      points[index][1],
      points[index][2],
    ));
  const segment = new Line3();
  for (let i = 0; i < triangles.length; i++)
    for (let j = i + 1; j < triangles.length; j++) {
      const shared = triangles[i].filter((id) => triangles[j].includes(id));
      if (shared.length === 3) return true;
      const a = points[i],
        b = points[j],
        n = normals[i];
      const scale = Math.max(
        1,
        a[0].distanceTo(a[1]),
        a[1].distanceTo(a[2]),
        b[0].distanceTo(b[1]),
        b[1].distanceTo(b[2]),
      );
      const epsilon = scale * 1e-8;
      const coplanar = b.every(
        (p) => Math.abs(n.dot(p.clone().sub(a[0]))) <= epsilon,
      );
      if (shared.length === 2) {
        // Noncoplanar adjacent facets intersect on their shared edge only. For a
        // coplanar pair, test geometric side independently of facet winding.
        if (coplanar) {
          const origin = point(shared[0]),
            edge = point(shared[1]).sub(origin);
          const first = point(
            triangles[i].find((id) => !shared.includes(id))!,
          ).sub(origin);
          const second = point(
            triangles[j].find((id) => !shared.includes(id))!,
          ).sub(origin);
          if (
            new Vector3()
              .crossVectors(edge, first)
              .dot(new Vector3().crossVectors(edge, second)) > 0
          )
            return true;
        }
        continue;
      }
      if (!coplanar) {
        if (!facet(i).intersectsTriangle(facet(j), segment)) continue;
        if (!shared.length) return true;
        const sharedPoint = point(shared[0]);
        if (
          segment.start.distanceTo(sharedPoint) > epsilon ||
          segment.end.distanceTo(sharedPoint) > epsilon
        )
          return true;
        continue;
      }
      if (!shared.length) {
        if (facet(i).intersectsTriangle(facet(j))) return true;
        continue;
      }
      const axis = [Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)].indexOf(
        Math.max(Math.abs(n.x), Math.abs(n.y), Math.abs(n.z)),
      );
      const xy = (id: number) => [
        positions[id * 3 + ((axis + 1) % 3)],
        positions[id * 3 + ((axis + 2) % 3)],
      ];
      const orient = (p: number[], q: number[], r: number[]) =>
        (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
      const inside = (id: number, t: number[]) => {
        const p = xy(id),
          q = t.map(xy),
          signs = [
            orient(q[0], q[1], p),
            orient(q[1], q[2], p),
            orient(q[2], q[0], p),
          ];
        return (
          signs.every((s) => s > epsilon * epsilon) ||
          signs.every((s) => s < -epsilon * epsilon)
        );
      };
      if (
        triangles[i].some(
          (id) => !shared.includes(id) && inside(id, triangles[j]),
        ) ||
        triangles[j].some(
          (id) => !shared.includes(id) && inside(id, triangles[i]),
        )
      )
        return true;
      for (let u = 0; u < 3; u++)
        for (let v = 0; v < 3; v++) {
          const ai = triangles[i][u],
            bi = triangles[i][(u + 1) % 3],
            ci = triangles[j][v],
            di = triangles[j][(v + 1) % 3];
          const p = xy(ai),
            q = xy(bi),
            r = xy(ci),
            s = xy(di);
          const first = orient(p, q, r) * orient(p, q, s),
            second = orient(r, s, p) * orient(r, s, q);
          if (first < 0 && second < 0) return true;
          if (
            Math.abs(orient(p, q, r)) < epsilon * epsilon &&
            Math.abs(orient(p, q, s)) < epsilon * epsilon
          ) {
            const lengthAxis =
              Math.abs(q[0] - p[0]) >= Math.abs(q[1] - p[1]) ? 0 : 1;
            const overlap =
              Math.min(
                Math.max(p[lengthAxis], q[lengthAxis]),
                Math.max(r[lengthAxis], s[lengthAxis]),
              ) -
              Math.max(
                Math.min(p[lengthAxis], q[lengthAxis]),
                Math.min(r[lengthAxis], s[lengthAxis]),
              );
            if (overlap > epsilon) return true;
          }
        }
    }
  return false;
}
