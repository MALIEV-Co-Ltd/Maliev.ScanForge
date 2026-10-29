import { Vector3 } from "three";
import type { MeshProcessingOptions } from "./mesh-processing";
import type { IndexedMesh, Positions, Vec3 } from "./types";
import { nativeAverageCoordinates } from "./scan-native-average";
import { indexedMeshMatches } from "./indexed-mesh";
import { meshFacetNormals, meshGeometryNormals } from "./mesh-geometry-normals";
import { noiseNormals } from "./scan-native-noise";
import { admitAverageInputs } from "./scan-average-request";
import { flippedTopology } from "./scan-flip-topology";
import { unrollRadialAxis } from "./scan-unroll-frame";
import {
  inverseMirrorFrame,
  mirrorFramePoint,
  mirrorPlaneFrame,
} from "./scan-mirror-frame";

export interface ScanTransformResult {
  positions: Float32Array;
  summary: string;
  indexedMesh?: IndexedMesh;
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
function triangleAreaSquared(p: Positions, i: number) {
  const ax = p[i + 3] - p[i],
    ay = p[i + 4] - p[i + 1],
    az = p[i + 5] - p[i + 2],
    bx = p[i + 6] - p[i],
    by = p[i + 7] - p[i + 1],
    bz = p[i + 8] - p[i + 2];
  return (
    (ay * bz - az * by) ** 2 +
    (az * bx - ax * bz) ** 2 +
    (ax * by - ay * bx) ** 2
  );
}
function validateTransformedTriangles(
  source: Positions,
  output: Float32Array,
  o: MeshProcessingOptions,
) {
  for (let i = 0; i < source.length; i += 9) {
    if (i % 9216 === 0) checkpoint(o, 0.99, "Checking transformed triangles");
    if (
      triangleAreaSquared(source, i) > 0 &&
      triangleAreaSquared(output, i) === 0
    )
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
  o: MeshProcessingOptions & { sourceTopology?: IndexedMesh } = {},
): ScanTransformResult {
  validate(p, o);
  const source = o.sourceTopology;
  if (source && source.vertices.length > MAX_COORDINATES)
    throw new Error(
      "Indexed vertices exceed the Flip Normals processing limit.",
    );
  if (source && !indexedMeshMatches(source, p))
    throw new Error("Indexed source does not match the scan geometry.");
  const out = new Float32Array(p);
  reverseWinding(out);
  const cache = o.topologyCache;
  const topology =
    cache?.positions === p && cache.topology
      ? flippedTopology(cache.topology, {
          ...o,
          onProgress: (fraction, stage) =>
            o.onProgress?.(0.05 * fraction, stage),
        })
      : undefined;
  let indexedMesh: IndexedMesh | undefined;
  if (source) {
    const triangles = Uint32Array.from(source.triangles);
    for (let i = 0; i < triangles.length; i += 3) {
      if (i % 12288 === 0 && o.signal?.aborted)
        throw new DOMException("Mesh operation cancelled.", "AbortError");
      [triangles[i + 1], triangles[i + 2]] = [
        triangles[i + 2],
        triangles[i + 1],
      ];
    }
    indexedMesh = {
      vertices:
        source.vertices instanceof Float32Array
          ? source.vertices
          : Float32Array.from(source.vertices),
      triangles,
    };
    const originalFacets = meshFacetNormals(source, o.signal, (fraction) =>
      checkpoint(o, 0.05 + 0.25 * fraction, "Preparing facet normals"),
    );
    const facetNormals = Float32Array.from(originalFacets);
    const bits = new Uint32Array(facetNormals.buffer);
    for (let i = 0; i < bits.length; i++) {
      if (i % 12288 === 0) checkpoint(o, 0.3, "Flipping facet normals");
      bits[i] ^= 0x80000000;
    }
    indexedMesh.facetNormals = facetNormals;
    indexedMesh.geometryNormals = noiseNormals(indexedMesh, {
      facetNormals: indexedMesh.facetNormals,
      signal: o.signal,
      sharedReadonlyBuffers: true,
      normalProgress: (fraction) =>
        checkpoint(o, 0.3 + 0.65 * fraction, "Refreshing vertex normals"),
    });
    if (!indexedMesh.geometryNormals.every(Number.isFinite))
      throw new Error("Flip Normals could not compute finite vertex normals.");
  }
  const result = finish(out, "Flipped all triangle normals.", o);
  if (topology && cache) {
    cache.positions = out;
    cache.topology = topology;
  }
  return { ...result, ...(indexedMesh ? { indexedMesh } : {}) };
}
export function mirrorScanMesh(
  p: Positions,
  o: MeshProcessingOptions & { center: Vec3; normal: Vec3; tangent?: Vec3 },
): ScanTransformResult {
  validate(p, o);
  const center = vector(o.center, "Mirror plane origin"),
    normal = unit(o.normal, "Mirror plane normal");
  const frame = mirrorPlaneFrame(
      center.toArray() as Vec3,
      normal.toArray() as Vec3,
      o.tangent
        ? (vector(o.tangent, "Mirror plane tangent").toArray() as Vec3)
        : undefined,
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
  o: MeshProcessingOptions & {
    targets: Positions[];
    targetTopology?: (IndexedMesh | undefined)[];
    sourceTopology?: IndexedMesh;
    tolerance?: number;
  },
): ScanTransformResult {
  validate(p, o);
  const tolerance = Math.fround(o.tolerance ?? 10);
  if (!Number.isFinite(tolerance) || tolerance <= 0)
    throw new Error(
      "Search tolerance must be a positive finite Float32 value.",
    );
  if (!o.targets.length || o.targets.length > 32)
    throw new Error("Choose between 1 and 32 reference meshes.");
  admitAverageInputs(p, o.targets, o.sourceTopology, o.targetTopology);
  o.targets.forEach((target) => validate(target, o));
  if (o.sourceTopology && !indexedMeshMatches(o.sourceTopology, p))
    throw new Error("Average base topology does not match its coordinates.");
  const result = nativeAverageCoordinates(
    o.sourceTopology?.vertices ?? p,
    o.targets,
    o.targetTopology,
    tolerance,
    {
      ...o,
      onProgress: (fraction, stage) => o.onProgress?.(fraction * 0.98, stage),
    },
  );
  let positions = result.positions;
  let indexedMesh: IndexedMesh | undefined;
  if (o.sourceTopology) {
    const triangles = Uint32Array.from(o.sourceTopology.triangles);
    indexedMesh = { vertices: result.positions, triangles };
    positions = new Float32Array(p.length);
    for (let slot = 0; slot < triangles.length; slot++) {
      if (slot % 4096 === 0) o.signal?.throwIfAborted();
      for (let axis = 0; axis < 3; axis++)
        positions[slot * 3 + axis] =
          result.positions[triangles[slot] * 3 + axis];
    }
    indexedMesh.geometryNormals = meshGeometryNormals(indexedMesh, o.signal);
  }
  validateTransformedTriangles(p, positions, o);
  return {
    ...finish(
      positions,
      `Averaged ${result.matched} triangle vertices with reference surfaces within ${tolerance} mm.`,
      o,
    ),
    ...(indexedMesh ? { indexedMesh } : {}),
  };
}

/** Flatten cylinder coordinates; remove seam facets before emitting repeated copies. */
export function unrollScanMesh(
  p: Positions,
  o: MeshProcessingOptions & {
    center: Vec3;
    axis: Vec3;
    radius: number;
    offsetDegrees?: number;
    instances?: number;
  },
): ScanTransformResult {
  validate(p, o);
  const center = vector(o.center, "Cylinder center"),
    axis = unit(o.axis, "Cylinder axis"),
    offset = o.offsetDegrees ?? 0,
    instances = o.instances ?? 1;
  if (!Number.isFinite(o.radius) || o.radius <= 0 || !Number.isFinite(offset))
    throw new Error("Cylinder radius must be positive and offset finite.");
  if (!Number.isSafeInteger(instances) || instances < 1)
    throw new Error("Unroll instances must be a positive whole number.");
  if (instances > Math.floor(MAX_COORDINATES / p.length))
    throw new Error("Unroll instances exceed the processing limit.");
  const u = unrollRadialAxis(axis);
  const v = new Vector3().crossVectors(axis, u),
    rotation = ((offset % 360) * Math.PI) / 180,
    cosine = Math.cos(rotation),
    sine = Math.sin(rotation),
    circumference = o.radius * TAU,
    mapped = new Float32Array(p.length),
    seamFacets = new Uint8Array(p.length / 9),
    order = Uint32Array.from({ length: p.length / 9 }, (_, i) => i),
    relative = new Vector3();
  for (let i = 0; i < p.length; i += 9) {
    if (i % 9216 === 0)
      checkpoint(o, (0.7 * i) / p.length, "Unrolling cylinder");
    let quadrants = 0;
    for (let j = 0; j < 9; j += 3) {
      relative.fromArray(p, i + j).sub(center);
      const axial = relative.dot(axis),
        rawX = relative.dot(u),
        rawY = relative.dot(v),
        x = Math.fround(rawX * cosine - rawY * sine),
        y = Math.fround(rawX * sine + rawY * cosine),
        radial = Math.sqrt(x * x + y * y);
      // Keep the native near-axis normalization threshold and acos/sign order.
      const nx = radial >= Number.EPSILON ? x / radial : x,
        ny = radial >= Number.EPSILON ? y / radial : y;
      let angle = Math.acos(nx);
      if (ny < 0) angle = TAU - angle;
      quadrants |= 1 << Math.min(3, Math.trunc(angle / (Math.PI / 2)));
      mapped[i + j] = (angle / TAU) * circumference;
      mapped[i + j + 1] = axial;
      mapped[i + j + 2] = radial - o.radius;
    }
    if (quadrants & 1 && quadrants & 8) seamFacets[i / 9] = 1;
  }
  // Deletion replaces each removed facet with the current last facet, then
  // rechecks that slot. This ordering is visible in exported corner streams.
  let count = order.length;
  for (let slot = 0; slot < count; slot++) {
    if (slot % 8192 === 0) o.signal?.throwIfAborted();
    if (seamFacets[order[slot]]) {
      order[slot--] = order[--count];
    }
  }
  const output = new Float32Array(count * 9 * instances);
  for (let copy = 0; copy < instances; copy++) {
    const translation = Math.fround(copy * circumference);
    for (let slot = 0; slot < count; slot++) {
      if (slot % 1024 === 0)
        checkpoint(
          o,
          0.7 + (0.28 * (copy * count + slot)) / (instances * count),
          "Preparing unrolled instances",
        );
      const source = order[slot] * 9,
        target = (copy * count + slot) * 9;
      for (let j = 0; j < 9; j += 3) {
        output[target + j] = mapped[source + j] + translation;
        output[target + j + 1] = mapped[source + j + 1];
        output[target + j + 2] = mapped[source + j + 2];
      }
      // Reject representational collapse, preserving the authored source.
      if (
        triangleAreaSquared(p, source) > 0 &&
        triangleAreaSquared(output, target) === 0
      )
        throw new Error(
          "Unrolled triangle collapses at Float32 precision; no geometry was changed.",
        );
    }
  }
  return finish(
    output,
    `Unrolled cylinder at ${offset} degrees with ${instances} instance(s); ${seamFacets.reduce((sum, value) => sum + value, 0)} seam facets removed; radial deviations retained in Z.`,
    o,
  );
}
