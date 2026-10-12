import { Box3, Ray, Triangle, Vector3 } from "three";
import type { Vec3 } from "./types";
import { analyzeMesh, type MeshProcessingOptions } from "./mesh-processing";
import {
  checkProgress,
  crossProduct,
  dotProduct,
  finiteOutput,
  pointAt,
  subtract,
  type ScanEditRequest,
  type ScanEditResult,
} from "./scan-edit";

interface CutterFace {
  points: Vec3[];
  box: Box3;
  triangle: Triangle;
  normal: Vec3;
}
interface Tree {
  box: Box3;
  faces?: CutterFace[];
  left?: Tree;
  right?: Tree;
}
const vec = (p: Vec3) => new Vector3(...p);
function treeOf(faces: CutterFace[]): Tree {
  const box = new Box3();
  for (const face of faces) box.union(face.box);
  if (faces.length <= 16) return { box, faces };
  const size = box.getSize(new Vector3());
  const axis =
    size.x > size.y ? (size.x > size.z ? 0 : 2) : size.y > size.z ? 1 : 2;
  faces.sort(
    (a, b) =>
      a.box.getCenter(new Vector3()).getComponent(axis) -
      b.box.getCenter(new Vector3()).getComponent(axis),
  );
  const middle = Math.floor(faces.length / 2);
  return {
    box,
    left: treeOf(faces.slice(0, middle)),
    right: treeOf(faces.slice(middle)),
  };
}
function candidates(tree: Tree, box: Box3, out: CutterFace[]) {
  if (!tree.box.intersectsBox(box)) return;
  if (tree.faces) {
    for (const f of tree.faces) if (f.box.intersectsBox(box)) out.push(f);
  } else {
    candidates(tree.left!, box, out);
    candidates(tree.right!, box, out);
  }
}
function rayHits(
  tree: Tree,
  ray: Ray,
  origin: Vector3,
  out: number[],
  epsilon: number,
) {
  if (!ray.intersectsBox(tree.box)) return;
  if (tree.faces) {
    for (const f of tree.faces) {
      const hit = ray.intersectTriangle(
        f.triangle.a,
        f.triangle.b,
        f.triangle.c,
        false,
        new Vector3(),
      );
      if (hit) {
        const d = hit.distanceTo(origin);
        if (d > epsilon) out.push(d);
      }
    }
  } else {
    rayHits(tree.left!, ray, origin, out, epsilon);
    rayHits(tree.right!, ray, origin, out, epsilon);
  }
}
function planeCrossings(
  points: Vec3[],
  normal: Vec3,
  origin: Vec3,
  other: Triangle,
  epsilon: number,
): Vec3[] {
  const result: Vec3[] = [];
  for (let i = 0; i < 3; i++) {
    const a = points[i],
      b = points[(i + 1) % 3],
      da = dotProduct(subtract(a, origin), normal),
      db = dotProduct(subtract(b, origin), normal);
    const samples: Vec3[] = [];
    if (Math.abs(da) <= epsilon) samples.push(a);
    if (da * db < 0) {
      const fraction = da / (da - db);
      samples.push(a.map((v, axis) => v + fraction * (b[axis] - v)) as Vec3);
    }
    for (const p of samples) {
      const v = vec(p),
        closest = other.closestPointToPoint(v, new Vector3());
      if (
        closest.distanceTo(v) <= epsilon &&
        !result.some((q) => Math.hypot(...subtract(p, q)) <= epsilon)
      )
        result.push(p);
    }
  }
  return result;
}
function intersection(
  source: Vec3[],
  face: CutterFace,
  epsilon: number,
): Vec3[] {
  const normal = crossProduct(
      subtract(source[1], source[0]),
      subtract(source[2], source[0]),
    ),
    length = Math.hypot(...normal);
  if (!length) return [];
  const n = normal.map((v) => v / length) as Vec3;
  if (
    source.every(
      (p) =>
        Math.abs(dotProduct(subtract(p, face.points[0]), face.normal)) <=
        epsilon,
    )
  )
    return [];
  const sourceTriangle = new Triangle(
    ...(source.map(vec) as [Vector3, Vector3, Vector3]),
  );
  const points = [
    ...planeCrossings(
      source,
      face.normal,
      face.points[0],
      face.triangle,
      epsilon,
    ),
    ...planeCrossings(face.points, n, source[0], sourceTriangle, epsilon),
  ];
  const unique = points.filter(
    (p, i) =>
      !points.slice(0, i).some((q) => Math.hypot(...subtract(p, q)) <= epsilon),
  );
  if (unique.length < 2) return unique;
  let pair: Vec3[] = [];
  let longest = epsilon;
  for (let i = 0; i < unique.length; i++)
    for (let j = i + 1; j < unique.length; j++) {
      const distance = Math.hypot(...subtract(unique[i], unique[j]));
      if (distance > longest) {
        longest = distance;
        pair = [unique[i], unique[j]];
      }
    }
  return pair;
}
function clip(
  poly: Vec3[],
  face: CutterFace,
  sign: number,
  epsilon: number,
): Vec3[] {
  const output: Vec3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      da = dotProduct(subtract(a, face.points[0]), face.normal) * sign,
      db = dotProduct(subtract(b, face.points[0]), face.normal) * sign;
    if (da >= -epsilon) output.push(a);
    if (da >= -epsilon !== db >= -epsilon) {
      const fraction = da / (da - db);
      output.push(a.map((v, axis) => v + fraction * (b[axis] - v)) as Vec3);
    }
  }
  return output.filter(
    (p, i) => i === 0 || Math.hypot(...subtract(p, output[i - 1])) > epsilon,
  );
}
function addIntersectionPoints(
  poly: Vec3[],
  points: Vec3[],
  epsilon: number,
): Vec3[] {
  const output: Vec3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      d = subtract(b, a),
      length = dotProduct(d, d);
    output.push(a);
    const inserted = points
      .map((p) => ({ p, f: dotProduct(subtract(p, a), d) / length }))
      .filter(
        ({ p, f }) =>
          f > epsilon &&
          f < 1 - epsilon &&
          Math.hypot(
            ...subtract(p, a.map((v, axis) => v + f * d[axis]) as Vec3),
          ) <= epsilon,
      )
      .sort((a, b) => a.f - b.f);
    for (const { p } of inserted)
      if (Math.hypot(...subtract(p, output[output.length - 1])) > epsilon)
        output.push(p);
  }
  return output;
}
function append(output: number[], poly: Vec3[], epsilon: number) {
  if (poly.length < 3) return;
  // A center fan retains every intersection endpoint on the fragment boundary.
  const center = poly.reduce(
    (sum, p) => sum.map((v, a) => v + p[a] / poly.length) as Vec3,
    [0, 0, 0] as Vec3,
  );
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    if (
      Math.hypot(...crossProduct(subtract(a, center), subtract(b, center))) >
      epsilon * epsilon
    )
      output.push(...center, ...a, ...b);
  }
}
function nearestSigned(tree: Tree, p: Vec3): number {
  const sample = vec(p);
  let best = Infinity,
    signed = 0;
  function visit(node: Tree) {
    if (node.box.distanceToPoint(sample) > best) return;
    if (node.faces) {
      for (const face of node.faces) {
        const closest = face.triangle.closestPointToPoint(
            sample,
            new Vector3(),
          ),
          distance = closest.distanceTo(sample);
        if (distance < best) {
          best = distance;
          signed = dotProduct(
            subtract(p, closest.toArray() as Vec3),
            face.normal,
          );
        }
      }
    } else {
      const [first, second] =
        node.left!.box.distanceToPoint(sample) <
        node.right!.box.distanceToPoint(sample)
          ? [node.left!, node.right!]
          : [node.right!, node.left!];
      visit(first);
      visit(second);
    }
  }
  visit(tree);
  return signed;
}
/** Triangle-local refinement followed by volume parity or signed nearest surface grouping. */
export function splitGeneralCutter(
  r: ScanEditRequest,
  o: MeshProcessingOptions,
): ScanEditResult {
  const epsilon = o.tolerance ?? 1e-6,
    target = r.target!;
  const topology = analyzeMesh(target, o);
  if (
    topology.degenerateTriangles ||
    topology.nonManifoldEdges ||
    topology.inconsistentEdges
  )
    throw new Error(
      "Mesh cutter requires nondegenerate manifold triangles with consistent winding.",
    );
  const closed = topology.boundaryEdges === 0;
  const faces: CutterFace[] = [];
  for (let i = 0; i < target.length / 9; i++) {
    if (i % 4096 === 0) checkProgress(o, 0, "Indexing cutter triangles");
    const points = [0, 1, 2].map((c) => pointAt(target, i * 3 + c));
    const n = crossProduct(
        subtract(points[1], points[0]),
        subtract(points[2], points[0]),
      ),
      length = Math.hypot(...n);
    faces.push({
      points,
      normal: n.map((v) => v / length) as Vec3,
      triangle: new Triangle(
        ...(points.map(vec) as [Vector3, Vector3, Vector3]),
      ),
      box: new Box3().setFromPoints(points.map(vec)).expandByScalar(epsilon),
    });
  }
  const tree = treeOf(faces),
    inside: number[] = [],
    outside: number[] = [];
  let splitTriangles = 0;
  const rayDirection = new Vector3(1, Math.SQRT2, Math.sqrt(3)).normalize();
  for (let f = 0; f < r.positions.length / 9; f++) {
    checkProgress(
      o,
      f / (r.positions.length / 9),
      "Refining mesh intersections",
    );
    const triangle = [0, 1, 2].map((c) => pointAt(r.positions, f * 3 + c));
    if (r.selection && !r.selection[f]) {
      outside.push(...triangle.flat());
      continue;
    }
    const nearby: CutterFace[] = [];
    candidates(
      tree,
      new Box3().setFromPoints(triangle.map(vec)).expandByScalar(epsilon),
      nearby,
    );
    const hits = nearby
      .map((face) => ({ face, points: intersection(triangle, face, epsilon) }))
      .filter((hit) => hit.points.length > 0);
    const crossing = hits.filter((hit) => hit.points.length === 2);
    let fragments = [
      addIntersectionPoints(
        triangle,
        hits.flatMap((hit) => hit.points),
        epsilon,
      ),
    ];
    for (const { face, points } of crossing) {
      checkProgress(
        o,
        f / (r.positions.length / 9),
        "Partitioning intersecting triangles",
      );
      const refined: Vec3[][] = [];
      for (const polygon of fragments) {
        const distances = polygon.map((p) =>
          dotProduct(subtract(p, face.points[0]), face.normal),
        );
        if (
          distances.some((d) => d > epsilon) &&
          distances.some((d) => d < -epsilon)
        ) {
          for (const sign of [-1, 1]) {
            const part = clip(polygon, face, sign, epsilon);
            if (part.length >= 3)
              refined.push(addIntersectionPoints(part, points, epsilon));
          }
        } else refined.push(addIntersectionPoints(polygon, points, epsilon));
      }
      fragments = refined;
    }
    if (fragments.length > 1) splitTriangles++;
    for (const polygon of fragments) {
      const center = polygon.reduce(
        (sum, p) => sum.map((v, a) => v + p[a] / polygon.length) as Vec3,
        [0, 0, 0] as Vec3,
      );
      let isInside = false;
      if (closed) {
        const origin = vec(center),
          hits: number[] = [];
        rayHits(tree, new Ray(origin, rayDirection), origin, hits, epsilon);
        hits.sort((a, b) => a - b);
        const unique = hits.filter(
          (d, i) => i === 0 || d - hits[i - 1] > epsilon,
        );
        isInside = unique.length % 2 === 1;
      } else isInside = nearestSigned(tree, center) < -epsilon;
      const output = isInside ? inside : outside;
      if (!hits.length) output.push(...triangle.flat());
      else append(output, polygon, epsilon);
    }
  }
  checkProgress(o, 1, "General cutter split complete");
  return {
    segments: [finiteOutput(inside), finiteOutput(outside)],
    diagnostics: {
      splitTriangles,
      insideTriangles: inside.length / 9,
      outsideTriangles: outside.length / 9,
      capped: false,
      cutter: closed
        ? "closed mesh ray parity"
        : "open surface signed nearest grouping",
      refinement: "Triangle-local support-plane arrangement",
    },
  };
}
