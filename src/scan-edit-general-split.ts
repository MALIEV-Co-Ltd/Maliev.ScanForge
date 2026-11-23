import { Box3, Ray, Triangle, Vector3 } from "three";
import {
  buildExperimentalNativeTree,
  visitExperimentalNativeTree,
} from "./scan-split-native-order-tree";
import type { Vec3 } from "./types";
import {
  appendSplitTriangle,
  convexSplitBoundaryNormal,
  SplitPrecisionError,
} from "./scan-split-triangle";
import { analyzeMesh, type MeshProcessingOptions } from "./mesh-processing";
import { orient2dSign, orient3dSign } from "./scan-split-orientation";
import {
  exactSegmentTriangleCrossing,
  exactVertexPointIdentity,
  exactEdgeWitnessCrossing,
  type ExactEdgeWitness,
} from "./scan-split-exact-crossing";
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
  index: number;
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
const roundingBound = (...points: Vec3[]) =>
  Number.EPSILON * 32 * Math.max(1, ...points.flatMap((p) => p.map(Math.abs)));
const sameOutputPoint = (a: Vec3, b: Vec3) =>
  a.every((n, i) => Math.fround(n) === Math.fround(b[i]));
const sameExactPoint = (a: Vec3, b: Vec3) => a.every((n, i) => n === b[i]);
const sameContact = (a: Vec3, b: Vec3) =>
  sameOutputPoint(a, b) && Math.hypot(...subtract(a, b)) <= roundingBound(a, b);
function insideProjectedTriangle(p: Vec3, triangle: Triangle): boolean {
  const points = [triangle.a, triangle.b, triangle.c].map(
    (v) => v.toArray() as Vec3,
  );
  const normal = crossProduct(
    subtract(points[1], points[0]),
    subtract(points[2], points[0]),
  );
  const drop = normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs)));
  const axes = [0, 1, 2].filter((axis) => axis !== drop);
  const orient = (a: Vec3, b: Vec3, c: Vec3) =>
    orient2dSign(
      a[axes[0]],
      a[axes[1]],
      b[axes[0]],
      b[axes[1]],
      c[axes[0]],
      c[axes[1]],
    );
  const sign = orient(points[0], points[1], points[2]);
  if (!sign) throw new Error("Finite triangle is degenerate.");
  return points.every((a, i) => orient(a, points[(i + 1) % 3], p) * sign >= 0);
}
function treeOf(faces: CutterFace[], tick?: () => void): Tree {
  tick?.();
  const box = new Box3();
  for (const face of faces) {
    tick?.();
    box.union(face.box);
  }
  if (faces.length <= 16) return { box, faces };
  const size = box.getSize(new Vector3());
  const axis =
    size.x > size.y ? (size.x > size.z ? 0 : 2) : size.y > size.z ? 1 : 2;
  faces.sort((a, b) => {
    tick?.();
    return (
      a.box.getCenter(new Vector3()).getComponent(axis) -
      b.box.getCenter(new Vector3()).getComponent(axis)
    );
  });
  const middle = Math.floor(faces.length / 2);
  return {
    box,
    left: treeOf(faces.slice(0, middle), tick),
    right: treeOf(faces.slice(middle), tick),
  };
}
function candidates(
  tree: Tree,
  box: Box3,
  out: CutterFace[],
  tick?: () => void,
) {
  tick?.();
  if (!tree.box.intersectsBox(box)) return;
  if (tree.faces) {
    for (const f of tree.faces) {
      tick?.();
      if (f.box.intersectsBox(box)) out.push(f);
    }
  } else {
    candidates(tree.left!, box, out, tick);
    candidates(tree.right!, box, out, tick);
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
  provenance?: { point: Vec3; edge: number; t: number; fromEnd?: number }[],
  otherProvenance?: {
    point: Vec3;
    edge: number;
    t: number;
    fromEnd?: number;
  }[],
  exactClassification = false,
  preciseCoordinates = false,
  exactSources?: Map<Vec3, () => readonly string[] | undefined>,
): Vec3[] {
  const result: Vec3[] = [];
  const otherPoints = [other.a, other.b, other.c].map(
    (point) => point.toArray() as Vec3,
  ) as [Vec3, Vec3, Vec3];
  const useExact = exactClassification || !!(provenance || otherProvenance);
  for (let i = 0; i < 3; i++) {
    const a = points[i],
      b = points[(i + 1) % 3],
      da = dotProduct(subtract(a, origin), normal),
      db = dotProduct(subtract(b, origin), normal);
    const exactA = useExact ? orient3dSign(...otherPoints, a) : undefined;
    const exactB = useExact ? orient3dSign(...otherPoints, b) : undefined;
    const exact = useExact
      ? exactSegmentTriangleCrossing(a, b, otherPoints, {
          exactPoint: preciseCoordinates,
        })
      : undefined;
    const samples: { point: Vec3; t: number; fromEnd?: number }[] = [];
    if (useExact ? exactA === 0 : da === 0) samples.push({ point: a, t: 0 });
    const crossing = useExact
      ? exactA !== 0 && exactB !== 0 && exactA !== exactB
      : (da < 0 && db > 0) || (da > 0 && db < 0);
    if (crossing) {
      if (useExact && !exact) throw new SplitPrecisionError();
      if (!useExact && !((da < 0 && db > 0) || (da > 0 && db < 0)))
        throw new SplitPrecisionError();
      const fraction = useExact ? exact!.fraction : da / (da - db);
      const opposite = useExact ? exact!.opposite : db / (db - da);
      if (!(fraction > 0 && fraction < 1)) {
        const estimate =
          fraction >= 1 && opposite > 0 && opposite < 1
            ? (b.map((v, axis) => v + opposite * (a[axis] - v)) as Vec3)
            : ([...a] as Vec3);
        if (exact ? !exact.inside : !insideProjectedTriangle(estimate, other))
          continue;
        if (fraction === 1 && opposite > 0 && opposite < 1) {
          samples.push({ point: estimate, t: 1, fromEnd: opposite });
        } else throw new SplitPrecisionError();
      } else {
        samples.push({
          point:
            useExact && opposite < fraction
              ? (b.map((v, axis) => v + opposite * (a[axis] - v)) as Vec3)
              : (a.map((v, axis) => v + fraction * (b[axis] - v)) as Vec3),
          t: fraction,
        });
      }
    }
    for (const { point, t, fromEnd } of samples) {
      const p = preciseCoordinates
        ? ([
            ...(t !== 0 && exact?.roundedPoint ? exact.roundedPoint : point),
          ] as Vec3)
        : point;
      if (preciseCoordinates)
        for (let axis = 0; axis < 3; axis++)
          if (
            otherPoints.every((vertex) => vertex[axis] === otherPoints[0][axis])
          )
            p[axis] = otherPoints[0][axis];
      if (exact ? !exact.inside : !insideProjectedTriangle(p, other)) continue;
      const v = vec(p),
        closest = other.closestPointToPoint(v, new Vector3());
      if (
        closest.distanceTo(v) <=
        roundingBound(
          p,
          other.a.toArray() as Vec3,
          other.b.toArray() as Vec3,
          other.c.toArray() as Vec3,
        )
      ) {
        for (const edge of otherProvenance ? (exact?.edges ?? []) : []) {
          const start = otherPoints[edge],
            end = otherPoints[(edge + 1) % 3];
          const axis = [0, 1, 2].reduce(
            (best, i) =>
              Math.abs(end[i] - start[i]) > Math.abs(end[best] - start[best])
                ? i
                : best,
            0,
          );
          const span = end[axis] - start[axis];
          const parameter = (p[axis] - start[axis]) / span;
          const opposite = (end[axis] - p[axis]) / span;
          if (parameter < 0 || parameter > 1 || !Number.isFinite(parameter))
            throw new SplitPrecisionError();
          otherProvenance!.push({
            point: p,
            edge,
            t: parameter,
            ...(parameter === 1 && opposite > 0 && 1 - opposite === 1
              ? { fromEnd: opposite }
              : {}),
          });
        }
        provenance?.push({
          point: p,
          edge: i,
          t,
          ...(fromEnd === undefined ? {} : { fromEnd }),
        });
        if (t === 0) provenance?.push({ point: p, edge: (i + 2) % 3, t: 1 });
        const duplicate = result.find((q) =>
          preciseCoordinates ? sameExactPoint(p, q) : sameContact(p, q),
        );
        const identity = () =>
          t === 0 ? exactVertexPointIdentity(p) : exact?.exactPoint;
        if (duplicate && preciseCoordinates) {
          const previous = exactSources?.get(duplicate)?.();
          const current = identity();
          if (
            !previous ||
            !current ||
            !previous.every((value, i) => value === current[i])
          )
            throw new SplitPrecisionError();
        }
        if (!duplicate) {
          result.push(p);
          if (preciseCoordinates && exactSources) exactSources.set(p, identity);
        }
      }
    }
  }
  return result;
}

/** Find contacts on the source boundary without cutting the coplanar face interior. */
function coplanarBoundaryContacts(
  source: Vec3[],
  face: CutterFace,
  provenance?: { point: Vec3; edge: number; t: number; fromEnd?: number }[],
): Vec3[] {
  const axis = face.normal
    .map(Math.abs)
    .indexOf(Math.max(...face.normal.map(Math.abs)));
  const axes = [0, 1, 2].filter((i) => i !== axis);
  const orient = (a: Vec3, b: Vec3, p: Vec3) =>
    (b[axes[0]] - a[axes[0]]) * (p[axes[1]] - a[axes[1]]) -
    (b[axes[1]] - a[axes[1]]) * (p[axes[0]] - a[axes[0]]);
  const sign = Math.sign(
    orient(face.points[0], face.points[1], face.points[2]),
  );
  if (!sign) return [];
  const contacts: Vec3[] = [];
  for (let i = 0; i < 3; i++) {
    const a = source[i],
      b = source[(i + 1) % 3];
    let lo = 0,
      hi = 1;
    for (let j = 0; j < 3 && lo <= hi; j++) {
      const c = face.points[j],
        d = face.points[(j + 1) % 3];
      const da = orient(c, d, a) * sign,
        db = orient(c, d, b) * sign;
      if (da < 0 && db < 0) {
        lo = 1;
        hi = 0;
        break;
      }
      if (da < 0 || db < 0) {
        const t = da / (da - db);
        if (da < 0) lo = Math.max(lo, t);
        else hi = Math.min(hi, t);
      }
    }
    if (lo > hi) continue;
    for (const t of [lo, hi]) {
      const p =
        t === 0
          ? ([...a] as Vec3)
          : t === 1
            ? ([...b] as Vec3)
            : (a.map((v, k) => v + t * (b[k] - v)) as Vec3);
      provenance?.push({ point: p, edge: i, t });
      if (!contacts.some((q) => sameContact(p, q))) contacts.push(p);
    }
  }
  return contacts;
}
function intersection(
  source: Vec3[],
  face: CutterFace,
  withProvenance = false,
  preciseCoordinates = false,
): {
  points: Vec3[];
  coplanar: boolean;
  sourceEdges?: { edge: number; t: number; fromEnd?: number }[][];
} {
  const provenance:
    { point: Vec3; edge: number; t: number; fromEnd?: number }[] | undefined =
    withProvenance ? [] : undefined;
  const finish = (points: Vec3[], coplanar: boolean) => ({
    points,
    coplanar,
    ...(provenance
      ? {
          sourceEdges: points.map((p) =>
            provenance
              .filter((q) => q.point.every((n, i) => n === p[i]))
              .map(({ edge, t, fromEnd }) => ({
                edge,
                t,
                ...(fromEnd === undefined ? {} : { fromEnd }),
              }))
              .filter(
                (entry, i, all) =>
                  all.findIndex(
                    (x) =>
                      x.edge === entry.edge &&
                      x.t === entry.t &&
                      x.fromEnd === entry.fromEnd,
                  ) === i,
              )
              .sort((a, b) => a.edge - b.edge),
          ),
        }
      : {}),
  });
  for (let axis = 0; axis < 3; axis++) {
    const sourceMin = Math.min(...source.map((p) => p[axis])),
      sourceMax = Math.max(...source.map((p) => p[axis]));
    const cutterMin = Math.min(...face.points.map((p) => p[axis])),
      cutterMax = Math.max(...face.points.map((p) => p[axis]));
    if (sourceMax < cutterMin || cutterMax < sourceMin)
      return finish([], false);
  }
  const normal = crossProduct(
      subtract(source[1], source[0]),
      subtract(source[2], source[0]),
    ),
    length = Math.hypot(...normal);
  if (!length) return finish([], false);
  const n = normal.map((v) => v / length) as Vec3;
  const coplanar = source.every(
    (point) =>
      orient3dSign(face.points[0], face.points[1], face.points[2], point) === 0,
  );
  if (coplanar) {
    const contacts = coplanarBoundaryContacts(source, face, provenance);
    // The experimental collector also needs cutter vertices contained in the
    // source face. Keep the production boundary-only behavior unchanged until
    // coplanar area classification has been verified against the native app.
    if (withProvenance) {
      const sourceTriangle = new Triangle(
        ...(source.map(vec) as [Vector3, Vector3, Vector3]),
      );
      for (const point of face.points)
        if (
          insideProjectedTriangle(point, sourceTriangle) &&
          !contacts.some((other) => sameContact(point, other))
        )
          contacts.push([...point] as Vec3);
    }
    return finish(contacts, true);
  }
  const sourceTriangle = new Triangle(
    ...(source.map(vec) as [Vector3, Vector3, Vector3]),
  );
  const exactSources = preciseCoordinates
    ? new Map<Vec3, () => readonly string[] | undefined>()
    : undefined;
  const sourceCrossings = planeCrossings(
    source,
    face.normal,
    face.points[0],
    face.triangle,
    provenance,
    undefined,
    true,
    preciseCoordinates,
    exactSources,
  );
  const cutterCrossings = planeCrossings(
    face.points,
    n,
    source[0],
    sourceTriangle,
    undefined,
    provenance,
    true,
    preciseCoordinates,
    exactSources,
  );
  if (preciseCoordinates) {
    for (const point of [...sourceCrossings, ...cutterCrossings])
      for (const vertex of source)
        if (sameExactPoint(point, vertex)) {
          const identity = exactSources?.get(point)?.();
          const vertexIdentity = exactVertexPointIdentity(vertex);
          if (
            !identity ||
            !identity.every((value, i) => value === vertexIdentity[i])
          )
            throw new SplitPrecisionError(
              "Split contact collapses onto a source vertex at binary64 precision; move the model closer to the origin or use a different cutter.",
            );
        }
    for (const a of sourceCrossings)
      for (const b of cutterCrossings)
        if (sameContact(a, b)) {
          const aIdentity = exactSources?.get(a)?.();
          const bIdentity = exactSources?.get(b)?.();
          if (aIdentity && bIdentity) {
            if (aIdentity.every((value, i) => value === bIdentity[i])) {
              if (provenance)
                for (const entry of provenance)
                  if (entry.point === b) entry.point = a;
              const index = cutterCrossings.indexOf(b);
              if (index >= 0) cutterCrossings[index] = a;
            } else if (sameExactPoint(a, b)) throw new SplitPrecisionError();
          } else if (!sameExactPoint(a, b)) throw new SplitPrecisionError();
        }
  }
  const points = [...sourceCrossings, ...cutterCrossings];
  const unique = points.filter(
    (p, i) =>
      !points
        .slice(0, i)
        .some((q) =>
          preciseCoordinates ? sameExactPoint(p, q) : sameContact(p, q),
        ),
  );
  if (unique.length < 2) return finish(unique, false);
  let pair: Vec3[] = [];
  let longest = 0;
  for (let i = 0; i < unique.length; i++)
    for (let j = i + 1; j < unique.length; j++) {
      const distance = Math.hypot(...subtract(unique[i], unique[j]));
      if (
        distance > longest &&
        (preciseCoordinates || !sameOutputPoint(unique[i], unique[j]))
      ) {
        longest = distance;
        pair = [unique[i], unique[j]];
      }
    }
  // A cutter edge can meet a source edge that lies entirely in the cutter
  // plane. Those endpoints come from the cutter crossings, so recover exact
  // source-edge provenance before propagating them to neighboring faces.
  if (provenance)
    for (const point of pair)
      for (let edge = 0; edge < 3; edge++) {
        const a = source[edge],
          b = source[(edge + 1) % 3];
        if (
          [
            [0, 1],
            [1, 2],
            [2, 0],
          ].some(
            ([x, y]) =>
              orient2dSign(a[x], a[y], b[x], b[y], point[x], point[y]) !== 0,
          )
        )
          continue;
        const axis = [0, 1, 2].reduce(
          (best, i) =>
            Math.abs(b[i] - a[i]) > Math.abs(b[best] - a[best]) ? i : best,
          0,
        );
        const span = b[axis] - a[axis];
        if (!span) continue;
        const t = (point[axis] - a[axis]) / span;
        if (t < 0 || t > 1) continue;
        const opposite = (b[axis] - point[axis]) / span;
        provenance.push({
          point,
          edge,
          t,
          ...(t === 1 && opposite > 0 && 1 - opposite === 1
            ? { fromEnd: opposite }
            : {}),
        });
      }
  return finish(pair, false);
}

/** Inspect one finite triangle pair using the same intersection routine as Split. */
export function inspectFiniteTriangleContact(
  source: [Vec3, Vec3, Vec3],
  cutter: [Vec3, Vec3, Vec3],
  options: { preciseCoordinates?: boolean } = {},
) {
  if (![...source, ...cutter].every((p) => p.every(Number.isFinite)))
    throw new Error("Finite triangle coordinates must be finite.");
  const n = crossProduct(
    subtract(cutter[1], cutter[0]),
    subtract(cutter[2], cutter[0]),
  );
  const length = Math.hypot(...n);
  if (!length) throw new Error("Finite cutter triangle is degenerate.");
  const result = intersection(
    source,
    {
      index: 0,
      points: cutter,
      normal: n.map((x) => x / length) as Vec3,
      triangle: new Triangle(
        ...(cutter.map(vec) as [Vector3, Vector3, Vector3]),
      ),
      box: new Box3().setFromPoints(cutter.map(vec)),
    },
    true,
    options.preciseCoordinates,
  );
  return {
    ...result,
    points: result.points.map((p) => [...p] as Vec3),
    sourceEdges: result.sourceEdges!,
  };
}

/** Collect finite triangle contacts for indexed source faces without welding source identities. */
export function collectFiniteCutterHits(
  vertices: Float32Array | Float64Array,
  triangles: Uint32Array,
  cutter: Float32Array | Float64Array | number[],
  options: {
    selection?: Uint8Array;
    tolerance?: number;
    signal?: AbortSignal;
    maxWork?: number;
    maxNativeTreeReferences?: number;
    maxCollectedHits?: number;
    check?: () => void;
    onProgress?: (fraction: number, stage: string) => void;
    preciseCoordinates?: boolean;
  } = {},
) {
  if (
    vertices.length % 3 ||
    triangles.length % 3 ||
    !cutter.length ||
    cutter.length % 9
  )
    throw new Error(
      "Finite cutter input indices or coordinates are incomplete.",
    );
  const faceCount = triangles.length / 3,
    cutterCount = cutter.length / 9,
    tolerance = options.tolerance ?? 1e-6;
  if (!Number.isFinite(tolerance) || tolerance <= 0)
    throw new Error("Finite cutter tolerance is invalid.");
  if (
    options.selection &&
    (options.selection.length !== faceCount ||
      options.selection.some((x) => x !== 0 && x !== 1))
  )
    throw new Error("Finite cutter selection is invalid.");
  const limit = options.maxWork ?? 2_000_000 + 40 * (faceCount + cutterCount);
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("Finite cutter work budget is invalid.");
  let work = 0;
  const maxCollectedHits = options.maxCollectedHits ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(maxCollectedHits) || maxCollectedHits < 0)
    throw new Error("Finite cutter hit budget is invalid.");
  let collectedHits = 0;
  const tick = () => {
    if (options.signal?.aborted)
      throw new DOMException("Aborted", "AbortError");
    options.check?.();
    if (++work > limit) throw new Error("Finite cutter work budget exceeded.");
  };
  tick();
  const cutterFaces: CutterFace[] = [];
  for (let i = 0; i < cutterCount; i++) {
    tick();
    const points = [0, 1, 2].map((c) => pointAt(cutter, i * 3 + c));
    if (!points.every((p) => p.every(Number.isFinite)))
      throw new Error("Finite cutter coordinates are invalid.");
    const n = crossProduct(
        subtract(points[1], points[0]),
        subtract(points[2], points[0]),
      ),
      length = Math.hypot(...n);
    if (!(length > 0) || !Number.isFinite(length))
      throw new Error("Finite cutter triangle is degenerate.");
    cutterFaces.push({
      index: i,
      points,
      normal: n.map((v) => v / length) as Vec3,
      triangle: new Triangle(
        ...(points.map(vec) as [Vector3, Vector3, Vector3]),
      ),
      box: new Box3().setFromPoints(points.map(vec)).expandByScalar(tolerance),
    });
  }
  const tree = treeOf(cutterFaces, tick);
  // Experimental native-order index; defer it until a source face has candidates.
  let nativeTree:
    ReturnType<typeof buildExperimentalNativeTree<CutterFace>> | undefined;
  const getNativeTree = () => {
    if (nativeTree) return nativeTree;
    const exactBounds = new Box3();
    for (const f of cutterFaces)
      for (const p of f.points) {
        tick();
        exactBounds.expandByPoint(vec(p));
      }
    const nativeLow = exactBounds.min
      .toArray()
      .map((v) => Math.fround(v - 0.009999999776482582));
    const nativeHigh = exactBounds.max
      .toArray()
      .map((v) => Math.fround(v + 0.009999999776482582));
    const nativeCenter = nativeLow.map((v, i) =>
      Math.fround(Math.fround(v + nativeHigh[i]) * 0.5),
    );
    const nativeHalf =
      Math.max(...nativeLow.map((v, i) => Math.fround(nativeHigh[i] - v))) *
      0.5;
    const nativeLower = nativeCenter.map((v) => Math.fround(v - nativeHalf));
    const nativeUpper = nativeCenter.map((v) => Math.fround(v + nativeHalf));
    nativeTree = buildExperimentalNativeTree(
      new Box3(
        new Vector3(...(nativeLower as [number, number, number])),
        new Vector3(...(nativeUpper as [number, number, number])),
      ),
      cutterFaces,
      tick,
      { maxReferences: options.maxNativeTreeReferences },
    );
    return nativeTree;
  };
  const faces = new Map<
    number,
    {
      cutterFace: number;
      points: Vec3[];
      coplanar: boolean;
      sourceEdges: { edge: number; t: number; fromEnd?: number }[][];
    }[]
  >();
  const contacts: {
    edge: [number, number];
    t: number;
    fromEnd?: number;
    source: string;
    exactCutter?: [Vec3, Vec3, Vec3];
    exactWitness?: ExactEdgeWitness;
  }[] = [];
  for (let f = 0; f < faceCount; f++) {
    tick();
    if (f % 4096 === 0)
      options.onProgress?.(
        f / faceCount,
        "Collecting finite cutter intersections",
      );
    const ids = [triangles[f * 3], triangles[f * 3 + 1], triangles[f * 3 + 2]];
    if (ids.some((id) => id >= vertices.length / 3) || new Set(ids).size !== 3)
      throw new Error("Finite cutter source indices are invalid.");
    if (options.selection && !options.selection[f]) continue;
    const source = ids.map((id) => pointAt(vertices, id));
    if (!source.every((p) => p.every(Number.isFinite)))
      throw new Error("Finite cutter source coordinates are invalid.");
    const nearby: CutterFace[] = [];
    candidates(
      tree,
      new Box3().setFromPoints(source.map(vec)).expandByScalar(tolerance),
      nearby,
      tick,
    );
    if (nearby.length) {
      const query = new Box3()
        .setFromPoints(source.map(vec))
        .expandByScalar(tolerance);
      const nativeOrder = new Map<number, number>();
      visitExperimentalNativeTree(
        getNativeTree(),
        query,
        (face) => {
          if (!nativeOrder.has(face.index))
            nativeOrder.set(face.index, nativeOrder.size);
        },
        tick,
      );
      nearby.sort((a, b) => {
        tick();
        return (
          (nativeOrder.get(a.index) ?? Number.MAX_SAFE_INTEGER) -
            (nativeOrder.get(b.index) ?? Number.MAX_SAFE_INTEGER) ||
          a.index - b.index
        );
      });
    }
    for (const face of nearby) {
      tick();
      const hit = intersection(source, face, true, options.preciseCoordinates);
      if (!hit.points.length) continue;
      if (++collectedHits > maxCollectedHits)
        throw new Error("Finite cutter hit budget exceeded.");
      const record = {
        cutterFace: face.index,
        points: hit.points,
        coplanar: hit.coplanar,
        sourceEdges: hit.sourceEdges!,
      };
      const perFace = faces.get(f) ?? [];
      perFace.push(record);
      faces.set(f, perFace);
      for (const [endpoint, edges] of record.sourceEdges.entries())
        for (const edgeProvenance of edges) {
          const { edge } = edgeProvenance;
          let { t, fromEnd } = edgeProvenance;
          tick();
          if ((t > 0 && t < 1) || fromEnd !== undefined) {
            const coplanarEdge =
              options.preciseCoordinates &&
              orient3dSign(
                face.points[0],
                face.points[1],
                face.points[2],
                source[edge],
              ) === 0 &&
              orient3dSign(
                face.points[0],
                face.points[1],
                face.points[2],
                source[(edge + 1) % 3],
              ) === 0;
            let exactWitness: ExactEdgeWitness | undefined;
            if (coplanarEdge && record.coplanar) {
              // Give the source edge a plane transverse to the cutter face.
              // Exact cutter-edge crossings then provide the same witness as
              // an adjacent noncoplanar source face, without trusting rounded t.
              const start = source[edge];
              const end = source[(edge + 1) % 3];
              const axis = face.normal
                .map(Math.abs)
                .indexOf(Math.max(...face.normal.map(Math.abs)));
              const third = [...start] as Vec3;
              third[axis] = third[axis] === 0 ? 1 : 0;
              const triangle: [Vec3, Vec3, Vec3] = [start, end, third];
              let identity: readonly string[] | undefined;
              for (let cutterEdge = 0; cutterEdge < 3; cutterEdge++) {
                tick();
                const segment: [Vec3, Vec3] = [
                  face.points[cutterEdge],
                  face.points[(cutterEdge + 1) % 3],
                ];
                const crossing = exactSegmentTriangleCrossing(
                  segment[0],
                  segment[1],
                  triangle,
                  { exactPoint: true },
                );
                if (
                  !crossing?.inside ||
                  !crossing.edges.includes(0) ||
                  !crossing.exactPoint ||
                  !crossing.roundedPoint ||
                  !sameExactPoint(
                    crossing.roundedPoint,
                    record.points[endpoint],
                  )
                )
                  continue;
                if (
                  identity &&
                  !identity.every(
                    (value, i) => value === crossing.exactPoint![i],
                  )
                )
                  throw new SplitPrecisionError();
                identity = crossing.exactPoint;
                exactWitness = { segment, triangle, edge: 0 };
              }
              if (exactWitness) {
                const exactEdge = exactEdgeWitnessCrossing(
                  start,
                  end,
                  exactWitness,
                );
                t = exactEdge.edgeFraction;
                fromEnd =
                  t === 1 &&
                  exactEdge.edgeOpposite > 0 &&
                  1 - exactEdge.edgeOpposite === 1
                    ? exactEdge.edgeOpposite
                    : undefined;
                edgeProvenance.t = t;
                if (fromEnd === undefined) delete edgeProvenance.fromEnd;
                else edgeProvenance.fromEnd = fromEnd;
              }
            }
            if (coplanarEdge && !record.coplanar) {
              const triangle = source as [Vec3, Vec3, Vec3];
              for (let cutterEdge = 0; cutterEdge < 3; cutterEdge++) {
                tick();
                const segment: [Vec3, Vec3] = [
                  face.points[cutterEdge],
                  face.points[(cutterEdge + 1) % 3],
                ];
                const crossing = exactSegmentTriangleCrossing(
                  segment[0],
                  segment[1],
                  triangle,
                  { exactPoint: true },
                );
                if (
                  crossing?.inside &&
                  crossing.edges.includes(edge) &&
                  crossing.roundedPoint &&
                  sameExactPoint(crossing.roundedPoint, record.points[endpoint])
                ) {
                  exactWitness = { segment, triangle, edge: edge as 0 | 1 | 2 };
                  break;
                }
              }
              if (!exactWitness) throw new SplitPrecisionError();
              const exactEdge = exactEdgeWitnessCrossing(
                source[edge],
                source[(edge + 1) % 3],
                exactWitness,
              );
              t = exactEdge.edgeFraction;
              fromEnd =
                t === 1 &&
                exactEdge.edgeOpposite > 0 &&
                1 - exactEdge.edgeOpposite === 1
                  ? exactEdge.edgeOpposite
                  : undefined;
              edgeProvenance.t = t;
              if (fromEnd === undefined) delete edgeProvenance.fromEnd;
              else edgeProvenance.fromEnd = fromEnd;
            }
            contacts.push({
              edge: [ids[edge], ids[(edge + 1) % 3]],
              t,
              ...(fromEnd === undefined ? {} : { fromEnd }),
              source: `cutter:${face.index}`,
              ...(options.preciseCoordinates && !coplanarEdge
                ? { exactCutter: face.points as [Vec3, Vec3, Vec3] }
                : {}),
              ...(exactWitness ? { exactWitness } : {}),
            });
          }
        }
    }
  }
  options.onProgress?.(1, "Collected finite cutter intersections");
  tick();
  return { faces, contacts };
}
function clip(poly: Vec3[], face: CutterFace, sign: number): Vec3[] {
  const output: Vec3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length],
      da = dotProduct(subtract(a, face.points[0]), face.normal) * sign,
      db = dotProduct(subtract(b, face.points[0]), face.normal) * sign;
    // A tolerance-shifted classification would extrapolate past the edge.
    if (da >= 0) output.push(a);
    if (da >= 0 !== db >= 0) {
      const fraction = da / (da - db);
      output.push(a.map((v, axis) => v + fraction * (b[axis] - v)) as Vec3);
    }
  }
  return output.filter(
    (p, i) => i === 0 || Math.hypot(...subtract(p, output[i - 1])) > 0,
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
      length = dotProduct(d, d),
      rounding =
        Number.EPSILON *
        32 *
        Math.max(1, ...a.map(Math.abs), ...b.map(Math.abs));
    output.push(a);
    const inserted = points
      .map((p) => ({ p, f: dotProduct(subtract(p, a), d) / length }))
      .filter(
        ({ p, f }) =>
          f > 0 &&
          f < 1 &&
          Math.hypot(
            ...subtract(p, a.map((v, axis) => v + f * d[axis]) as Vec3),
          ) <= rounding,
      )
      .sort((a, b) => a.f - b.f);
    for (const { f } of inserted) {
      // Keep the source edge fixed when an intersection is only tolerance-close.
      const projected = a.map((v, axis) => v + f * d[axis]) as Vec3;
      if (
        Math.hypot(...subtract(projected, b)) > roundingBound(projected, b) &&
        Math.hypot(...subtract(projected, output[output.length - 1])) >
          roundingBound(projected, output[output.length - 1])
      )
        output.push(projected);
    }
  }
  return output;
}
/** Remove consecutive numerical copies of one observed cutter contact. */
function collapseContactCopies(
  poly: Vec3[],
  contacts: Vec3[],
  source: Vec3[],
): Vec3[] {
  const result = [...poly];
  const original = (point: Vec3) =>
    source.some((vertex) =>
      vertex.every((value, axis) => Object.is(value, point[axis])),
    );
  let changed = true;
  while (changed && result.length > 3) {
    changed = false;
    for (let i = 0; i < result.length; i++) {
      const next = (i + 1) % result.length,
        a = result[i],
        b = result[next];
      if (!sameContact(a, b) || (original(a) && original(b))) continue;
      if (
        !contacts.some(
          (contact) => sameContact(a, contact) && sameContact(b, contact),
        )
      )
        continue;
      result.splice(original(b) ? i : next, 1);
      changed = true;
      break;
    }
  }
  return result;
}
function append(output: number[], poly: Vec3[]) {
  if (poly.length < 3) return;
  if (poly.length === 3) {
    appendSplitTriangle(output, poly[0], poly[1], poly[2]);
    return;
  }
  // A center fan retains every intersection endpoint on the fragment boundary.
  const center = poly.reduce(
    (sum, p) => sum.map((v, a) => v + p[a] / poly.length) as Vec3,
    [0, 0, 0] as Vec3,
  );
  const triangles: number[] = [];
  try {
    for (let i = 0; i < poly.length; i++)
      appendSplitTriangle(
        triangles,
        center,
        poly[i],
        poly[(i + 1) % poly.length],
      );
  } catch (error) {
    if (!(error instanceof SplitPrecisionError)) throw error;
    // A representable boundary vertex can be a better fan origin than a rounded centroid.
    // Only accept a fallback that retains every boundary edge at output precision.
    if (poly.length > 128) throw error;
    const normal = convexSplitBoundaryNormal(poly);
    if (!normal) throw error;
    const key = (p: number[]) => JSON.stringify(p.map(Math.fround));
    const edge = (a: number[], b: number[]) => {
      const ka = key(a),
        kb = key(b);
      return ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
    };
    const boundary = poly.map((p, i) => edge(p, poly[(i + 1) % poly.length]));
    let found = false;
    for (let pivot = 0; pivot < poly.length && !found; pivot++) {
      const candidate: number[] = [];
      try {
        for (let i = 1; i + 1 < poly.length; i++)
          appendSplitTriangle(
            candidate,
            poly[pivot],
            poly[(pivot + i) % poly.length],
            poly[(pivot + i + 1) % poly.length],
          );
      } catch (failure) {
        if (!(failure instanceof SplitPrecisionError)) throw failure;
        continue;
      }
      const edges = new Set<string>();
      for (let i = 0; i < candidate.length; i += 9) {
        const points = [
          candidate.slice(i, i + 3),
          candidate.slice(i + 3, i + 6),
          candidate.slice(i + 6, i + 9),
        ];
        if (
          dotProduct(
            crossProduct(
              subtract(points[1] as Vec3, points[0] as Vec3),
              subtract(points[2] as Vec3, points[0] as Vec3),
            ),
            normal,
          ) <= 0
        ) {
          edges.clear();
          break;
        }
        for (let j = 0; j < 3; j++)
          edges.add(edge(points[j], points[(j + 1) % 3]));
      }
      if (boundary.every((e) => edges.has(e))) {
        triangles.length = 0;
        for (const value of candidate) triangles.push(value);
        found = true;
      }
    }
    if (!found) throw error;
  }
  for (const value of triangles) output.push(value);
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
      index: i,
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
      .map((face) => ({ face, ...intersection(triangle, face) }))
      .filter((hit) => hit.points.length > 0);
    const hitPoints = hits.flatMap((hit) => hit.points);
    const crossing = hits.filter(
      (hit) => !hit.coplanar && hit.points.length === 2,
    );
    let fragments = [addIntersectionPoints(triangle, hitPoints, epsilon)];
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
        if (distances.some((d) => d > 0) && distances.some((d) => d < 0)) {
          for (const sign of [-1, 1]) {
            const part = clip(polygon, face, sign);
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
      else append(output, collapseContactCopies(polygon, hitPoints, triangle));
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
