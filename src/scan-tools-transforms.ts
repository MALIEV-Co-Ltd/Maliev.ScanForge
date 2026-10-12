import { BufferAttribute, BufferGeometry, Vector3 } from "three";
import { MeshBVH } from "three-mesh-bvh";
import type { MeshProcessingOptions } from "./mesh-processing";
import type { Positions, Vec3 } from "./types";
import { flippedTopology } from "./scan-flip-topology";
import {
  inverseMirrorFrame,
  mirrorFramePoint,
  mirrorPlaneFrame,
} from "./scan-mirror-frame";

export interface ScanTransformResult {
  positions: Float32Array;
  summary: string;
}
const MAX_COORDINATES = 27_000_000;
const TAU = Math.PI * 2;
function checkpoint(o: MeshProcessingOptions, f: number, stage: string) {
  if (o.signal?.aborted)
    throw new DOMException("Mesh operation cancelled.", "AbortError");
  o.onProgress?.(f, stage);
}
function validate(p: Positions, o: MeshProcessingOptions) {
  checkpoint(o, 0, "Validating mesh");
  if (!p.length || p.length % 9 || p.length > MAX_COORDINATES)
    throw new Error(
      "Expected complete triangles within the 3 million triangle processing limit.",
    );
  for (let i = 0; i < p.length; i++) {
    if (i % 8192 === 0) checkpoint(o, 0, "Validating mesh");
    if (!Number.isFinite(p[i]) || !Number.isFinite(Math.fround(p[i])))
      throw new Error("Mesh coordinates exceed the finite Float32 range.");
  }
}
function vector(p: Vec3, label: string) {
  if (p.length !== 3 || p.some((v) => !Number.isFinite(v)))
    throw new Error(`${label} must contain three finite coordinates.`);
  return new Vector3(...p);
}
function unit(p: Vec3, label: string) {
  const v = vector(p, label),
    length = v.length();
  if (!Number.isFinite(length) || length < 1e-12)
    throw new Error(`${label} must be nonzero.`);
  return v.divideScalar(length);
}
function finish(p: Float32Array, summary: string, o: MeshProcessingOptions) {
  if (!p.length) throw new Error("Mesh operation produced no triangles.");
  if (p.some((v) => !Number.isFinite(v)))
    throw new Error("Result exceeds the finite Float32 range.");
  checkpoint(o, 1, "Complete");
  return { positions: p, summary };
}
function mapPoints(
  p: Positions,
  o: MeshProcessingOptions,
  fn: (v: Vector3) => Vector3,
) {
  const out = new Float32Array(p.length),
    v = new Vector3();
  for (let i = 0; i < p.length; i += 3) {
    if (i % 12288 === 0) checkpoint(o, i / p.length, "Transforming mesh");
    fn(v.fromArray(p, i)).toArray(out, i);
  }
  return out;
}
function reverseWinding(p: Float32Array) {
  for (let i = 0; i < p.length; i += 9)
    for (let j = 0; j < 3; j++) {
      const v = p[i + 3 + j];
      p[i + 3 + j] = p[i + 6 + j];
      p[i + 6 + j] = v;
    }
}
function validateTransformedTriangles(
  source: Positions,
  output: Float32Array,
  o: MeshProcessingOptions,
) {
  const a = new Vector3(),
    b = new Vector3(),
    c = new Vector3();
  const area = (p: Positions, i: number) => {
    a.fromArray(p, i);
    b.fromArray(p, i + 3).sub(a);
    c.fromArray(p, i + 6).sub(a);
    return new Vector3().crossVectors(b, c).lengthSq();
  };
  for (let i = 0; i < source.length; i += 9) {
    if (i % 9216 === 0) checkpoint(o, 0.99, "Checking transformed triangles");
    if (area(source, i) > 0 && area(output, i) === 0)
      throw new Error(
        "Transformed triangle collapses at Float32 precision; no geometry was changed.",
      );
  }
}
/** Scale dialog values narrow to Float32 before the geometry dispatch. */
export function nativeScaleFactor(value: number, percentage = false): number {
  if (!Number.isFinite(value) || value <= 0)
    throw new Error("Scale factor must be positive and finite.");
  const factor = Math.fround(percentage ? value / 100 : value);
  if (!Number.isFinite(factor) || factor <= 0)
    throw new Error(
      "Scale factor must remain positive and finite at Float32 precision.",
    );
  return factor;
}
export function scaleScanMesh(
  p: Positions,
  o: MeshProcessingOptions & { factor: number; center?: Vec3 },
): ScanTransformResult {
  validate(p, o);
  const factor = nativeScaleFactor(o.factor);
  const center = vector(o.center ?? [0, 0, 0], "Scale center");
  // Native origin scaling multiplies coordinates directly. Adding zero after
  // the multiply would erase negative-zero bits in the captured output.
  const atOrigin = center.x === 0 && center.y === 0 && center.z === 0;
  const out = mapPoints(p, o, (v) =>
    atOrigin
      ? v.multiplyScalar(factor)
      : v.sub(center).multiplyScalar(factor).add(center),
  );
  validateTransformedTriangles(p, out, o);
  return finish(out, `Scaled mesh by ${Number(factor.toPrecision(8))}.`, o);
}
export function flipScanNormals(
  p: Positions,
  o: MeshProcessingOptions = {},
): ScanTransformResult {
  validate(p, o);
  const out = new Float32Array(p);
  reverseWinding(out);
  const cache = o.topologyCache;
  const topology =
    cache?.positions === p && cache.topology
      ? flippedTopology(cache.topology, o)
      : undefined;
  const result = finish(out, "Flipped all triangle normals.", o);
  if (topology && cache) {
    cache.positions = out;
    cache.topology = topology;
  }
  return result;
}
export function mirrorScanMesh(
  p: Positions,
  o: MeshProcessingOptions & { center: Vec3; normal: Vec3 },
): ScanTransformResult {
  validate(p, o);
  const center = vector(o.center, "Mirror plane origin"),
    normal = unit(o.normal, "Mirror plane normal");
  const frame = mirrorPlaneFrame(
      center.toArray() as Vec3,
      normal.toArray() as Vec3,
    ),
    inverse = inverseMirrorFrame(frame);
  const out = mapPoints(p, o, (v) =>
    v.fromArray(mirrorFramePoint(v.x, v.y, v.z, frame, inverse)),
  );
  reverseWinding(out);
  validateTransformedTriangles(p, out, o);
  return finish(out, "Mirrored mesh across selected plane.", o);
}
/** Each matched target surface and the original source contribute equally. Unmatched targets contribute nothing. */
export function averageScanMesh(
  p: Positions,
  o: MeshProcessingOptions & { targets: Positions[]; tolerance?: number },
): ScanTransformResult {
  validate(p, o);
  const tolerance = o.tolerance ?? 10;
  if (!Number.isFinite(tolerance) || tolerance <= 0)
    throw new Error("Search tolerance must be positive and finite.");
  if (!o.targets.length || o.targets.length > 32)
    throw new Error("Choose between 1 and 32 reference meshes.");
  if (o.targets.reduce((n, t) => n + t.length, p.length) > MAX_COORDINATES)
    throw new Error("Combined meshes exceed the processing limit.");
  const geometries: BufferGeometry[] = [];
  try {
    const trees = o.targets.map((target) => {
      validate(target, o);
      const geometry = new BufferGeometry();
      geometries.push(geometry);
      geometry.setAttribute(
        "position",
        new BufferAttribute(new Float32Array(target), 3),
      );
      checkpoint(o, 0, "Indexing reference surfaces");
      return new MeshBVH(geometry);
    });
    let matched = 0;
    const out = mapPoints(p, o, (point) => {
      const sum = point.clone();
      let count = 1;
      for (const tree of trees) {
        const hit = tree.closestPointToPoint(point, undefined, 0, tolerance);
        if (hit && hit.distance <= tolerance) {
          sum.add(hit.point);
          count++;
        }
      }
      if (count > 1) matched++;
      return point.copy(sum.divideScalar(count));
    });
    validateTransformedTriangles(p, out, o);
    return finish(
      out,
      `Averaged ${matched} triangle vertices with reference surfaces within ${tolerance} mm.`,
      o,
    );
  } finally {
    geometries.forEach((g) => g.dispose());
  }
}

function clipAngle(poly: Vec3[], cut: number, above: boolean): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    const insideA = above ? a[0] >= cut : a[0] <= cut,
      insideB = above ? b[0] >= cut : b[0] <= cut;
    if (insideA) out.push(a);
    if (insideA !== insideB) {
      const t = (cut - a[0]) / (b[0] - a[0]);
      out.push([cut, a[1] + t * (b[1] - a[1]), a[2] + t * (b[2] - a[2])]);
    }
  }
  return out;
}
/** Flatten to local XY (arc length, axial distance), retaining radial residual in Z. Split the offset seam. */
export function unrollScanMesh(
  p: Positions,
  o: MeshProcessingOptions & {
    center: Vec3;
    axis: Vec3;
    radius: number;
    offsetDegrees?: number;
  },
): ScanTransformResult {
  validate(p, o);
  const center = vector(o.center, "Cylinder center"),
    axis = unit(o.axis, "Cylinder axis"),
    offset = o.offsetDegrees ?? 0;
  if (!Number.isFinite(o.radius) || o.radius <= 0 || !Number.isFinite(offset))
    throw new Error("Cylinder radius must be positive and offset finite.");
  // Project world X onto the radial plane; world Y is the stable fallback for X-aligned cylinders.
  const u = new Vector3(
    Math.abs(axis.x) < 0.9 ? 1 : 0,
    Math.abs(axis.x) < 0.9 ? 0 : 1,
    0,
  );
  u.addScaledVector(axis, -u.dot(axis)).normalize();
  const v = new Vector3().crossVectors(axis, u);
  const seam = ((offset % 360) * Math.PI) / 180,
    output: number[] = [],
    relative = new Vector3();
  for (let i = 0; i < p.length; i += 9) {
    if (i % 9216 === 0) checkpoint(o, i / p.length, "Unrolling cylinder");
    const points: Vec3[] = [];
    for (let j = 0; j < 9; j += 3) {
      relative.fromArray(p, i + j).sub(center);
      const axial = relative.dot(axis),
        x = relative.dot(u),
        y = relative.dot(v),
        radial = Math.hypot(x, y);
      if (radial < 1e-12)
        throw new Error("Cannot unroll mesh vertices on the cylinder axis.");
      let angle = (((Math.atan2(y, x) - seam) % TAU) + TAU) % TAU;
      if (angle < 1e-12 || TAU - angle < 1e-12) angle = 0;
      if (points.length)
        angle += Math.round((points[0][0] - angle) / TAU) * TAU;
      points.push([angle, axial, radial - o.radius]);
    }
    const min = Math.min(...points.map((q) => q[0])),
      max = Math.max(...points.map((q) => q[0]));
    const axialRange =
      Math.max(...points.map((q) => q[1])) -
      Math.min(...points.map((q) => q[1]));
    if (axialRange <= 1e-12 * Math.max(1, ...points.map((q) => Math.abs(q[1]))))
      throw new Error(
        "Cylinder cap or collapsed faces cannot be unrolled. Extract the cylindrical sidewall first; no geometry was changed.",
      );
    if (max - min >= Math.PI)
      throw new Error(
        "Cylinder triangles span 180 degrees or more; refine the mesh before unrolling.",
      );
    const sourceOutputStart = output.length;
    for (
      let band = Math.floor(min / TAU);
      band <= Math.floor(max / TAU);
      band++
    ) {
      const poly = clipAngle(
        clipAngle(points, band * TAU, true),
        (band + 1) * TAU,
        false,
      );
      for (let t = 1; t + 1 < poly.length; t++) {
        const triangle = [poly[0], poly[t], poly[t + 1]];
        const a = new Vector3(...triangle[0]),
          b = new Vector3(...triangle[1]),
          c = new Vector3(...triangle[2]);
        if (new Vector3().crossVectors(b.sub(a), c.sub(a)).lengthSq() < 1e-24)
          continue;
        const finalTriangle = triangle.map(
          (q) =>
            new Vector3(
              Math.fround((q[0] - band * TAU) * o.radius),
              Math.fround(q[1]),
              Math.fround(q[2]),
            ),
        );
        if (
          finalTriangle.some((q) =>
            q.toArray().some((value) => !Number.isFinite(value)),
          )
        )
          throw new Error("Unrolled result exceeds the finite Float32 range.");
        const ab = finalTriangle[1].clone().sub(finalTriangle[0]),
          ac = finalTriangle[2].clone().sub(finalTriangle[0]);
        if (
          new Vector3().crossVectors(ab, ac).lengthSq() <=
          1e-20 * ab.lengthSq() * ac.lengthSq()
        )
          throw new Error(
            "Unrolled triangle collapses at Float32 precision. Adjust cylinder radius or mesh coordinates; no geometry was changed.",
          );
        for (const q of finalTriangle) output.push(...q.toArray());
        if (output.length > MAX_COORDINATES)
          throw new Error("Unrolled output exceeds the processing limit.");
      }
    }
    if (output.length === sourceOutputStart)
      throw new Error(
        "Unroll would omit a collapsed triangle. Extract the cylindrical sidewall first; no geometry was changed.",
      );
  }
  return finish(
    new Float32Array(output),
    `Unrolled cylinder at ${offset} degrees; radial deviations retained in Z.`,
    o,
  );
}
