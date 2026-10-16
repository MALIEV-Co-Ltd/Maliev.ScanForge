import { nativeGlobalPointIndex } from "./scan-native-global-point-index";
import { nativeGlobalRawTargetIds } from "./scan-native-global-target-records";
import { nativeGlobalRawTargetMatches } from "./scan-native-global-target";
import { nativeGlobalPlane } from "./scan-native-global-plane";
import { prepareNativeGlobalMeshTargetSet } from "./scan-native-global-mesh-target";
import type { NativeGlobalEvaluatorMesh } from "./scan-native-global-surface";
import type { GlobalCorrespondence } from "./scan-native-global-local";

/** Prepared Float32 vertex records. Every sidecar is immutable for this identity. */
export interface NativeGlobalQueryGeometry {
  points: Float32Array;
  normals: Float32Array;
  labels?: Uint32Array;
  flags?: Uint32Array;
  /** Native group children routed to mesh evaluators, separate from raw records. */
  targetMeshes?: readonly NativeGlobalEvaluatorMesh[];
}
export interface NativeGlobalQueryScan {
  id: string;
  geometry: NativeGlobalQueryGeometry;
  matrix: readonly number[];
}
export interface NativeGlobalQueryInput {
  source: NativeGlobalQueryScan;
  targets: readonly NativeGlobalQueryScan[];
  cells: readonly (readonly number[])[];
  radius: number;
  mode?: "pooled-plane" | "target-average";
  mask?: number;
  gateCount?: number;
}
export interface NativeGlobalQueryPair extends GlobalCorrespondence {
  id: number;
}
const prepared = new WeakMap<
  NativeGlobalQueryGeometry,
  ReturnType<typeof build>
>();
const validated = new WeakSet<NativeGlobalQueryGeometry>();
function validateGeometry(geometry: NativeGlobalQueryGeometry) {
  if (validated.has(geometry)) return;
  const { points, normals, labels, flags } = geometry;
  const count = points.length / 3;
  if (
    !(points instanceof Float32Array) ||
    points.length % 3 ||
    !(normals instanceof Float32Array) ||
    normals.length !== points.length ||
    !points.every(Number.isFinite) ||
    !normals.every(Number.isFinite) ||
    (labels && (!(labels instanceof Uint32Array) || labels.length !== count)) ||
    (flags && (!(flags instanceof Uint32Array) || flags.length !== count))
  )
    throw new Error(
      "Global query geometry requires finite Float32 XYZ/normals and matching uint32 sidecars.",
    );
  validated.add(geometry);
}
function build(geometry: NativeGlobalQueryGeometry) {
  validateGeometry(geometry);
  const { points, flags } = geometry,
    count = points.length / 3;
  const ids = nativeGlobalRawTargetIds(count, flags);
  const carrier =
    ids.length === count ? points : new Float32Array(ids.length * 3);
  if (carrier !== points)
    for (let i = 0; i < ids.length; i++) {
      const from = ids[i] * 3,
        to = i * 3;
      carrier[to] = points[from];
      carrier[to + 1] = points[from + 1];
      carrier[to + 2] = points[from + 2];
    }
  return {
    tree: nativeGlobalPointIndex(carrier),
    ids,
    meshes: geometry.targetMeshes?.length
      ? prepareNativeGlobalMeshTargetSet(geometry.targetMeshes)
      : undefined,
    raw: { point: [0, 0, 0], normal: [0, 0, 0], flags: 0, labelWord: 0 },
  };
}
export function prepareNativeGlobalQueryGeometry(
  geometry: NativeGlobalQueryGeometry,
) {
  let value = prepared.get(geometry);
  if (!value) {
    value = build(geometry);
    prepared.set(geometry, value);
  }
  return value;
}
function frame(scan: NativeGlobalQueryScan) {
  if (
    !scan.id ||
    scan.matrix.length !== 12 ||
    !scan.matrix.every(Number.isFinite)
  )
    throw new Error(
      "Global queries require an identified scan with a finite 3x4 pose.",
    );
}
function localPoint(world: number[], m: readonly number[]) {
  const x = world[0] - m[3],
    y = world[1] - m[7],
    z = world[2] - m[11];
  return [
    y * m[4] + x * m[0] + z * m[8],
    y * m[5] + x * m[1] + z * m[9],
    y * m[6] + x * m[2] + z * m[10],
  ];
}
function transformedF32(
  p: Float32Array,
  id: number,
  m: readonly number[],
  normal = false,
) {
  const i = id * 3,
    x = p[i],
    y = p[i + 1],
    z = p[i + 2];
  const out = [
    y * m[1] + x * m[0] + z * m[2],
    x * m[4] + y * m[5] + z * m[6],
    x * m[8] + y * m[9] + z * m[10],
  ];
  return out.map((v, i) => Math.fround(normal ? v : v + m[i * 4 + 3]));
}
function normalize(p: number[]) {
  const length = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
  if (length >= Number.EPSILON) {
    const reciprocal = 1 / length;
    for (let i = 0; i < 3; i++) p[i] = reciprocal * p[i];
  }
  return p;
}
const maximumFloat = Math.fround(3.4028234663852886e38);
/** Original scan-query branches are numerically different. The multicore UI
 * default averages per-target closest records/normals; the serial fallback
 * fits one plane across combined radius neighborhoods. Neither branch changes
 * scan poses. Immutable geometry indexes survive poses and query batches. */
export function nativeGlobalQuery(input: NativeGlobalQueryInput) {
  const { source, targets, cells } = input,
    mode = input.mode ?? "target-average";
  frame(source);
  validateGeometry(source.geometry);
  const count = source.geometry.points.length / 3,
    mask = input.mask ?? 0;
  if (
    !Number.isFinite(input.radius) ||
    input.radius < 0 ||
    !Number.isInteger(mask) ||
    mask < 0 ||
    mask > 0xffffffff ||
    !["pooled-plane", "target-average"].includes(mode) ||
    (input.gateCount !== undefined &&
      (!Number.isInteger(input.gateCount) || input.gateCount < 0))
  )
    throw new Error("Invalid global correspondence query options.");
  for (const cell of cells)
    for (const id of cell)
      if (!Number.isInteger(id) || id < 0 || id >= count)
        throw new Error(
          "Global query source sample is outside the prepared geometry.",
        );
  const ready = targets.map((scan) => {
    frame(scan);
    return { scan, ...prepareNativeGlobalQueryGeometry(scan.geometry) };
  });
  const pairs: NativeGlobalQueryPair[] = [];
  if ((input.gateCount ?? count) === 0) return { count: 0, pairs };
  const radius =
    mode === "pooled-plane" ? Math.fround(input.radius) : input.radius;
  if (!Number.isFinite(radius))
    throw new Error("Global pooled query radius must fit Float32.");
  for (const cell of cells)
    for (const id of cell) {
      const world = transformedF32(source.geometry.points, id, source.matrix);
      const sourceNormal = transformedF32(
        source.geometry.normals,
        id,
        source.matrix,
        true,
      );
      const label = source.geometry.labels?.[id] ?? 0;
      let maximumDistance = 0,
        matches = 0;
      const points: number[][] = [],
        normal = [0, 0, 0],
        center = [0, 0, 0];
      for (const target of ready) {
        const { scan, tree, ids } = target;
        if (
          scan.id === source.id ||
          (!ids.length && (mode === "pooled-plane" || !target.meshes))
        )
          continue;
        const local = localPoint(world, scan.matrix),
          nearest = tree.closest(local, radius);
        if (mode === "target-average" && target.meshes) {
          let raw;
          if (nearest.id >= 0) {
            const id = ids[nearest.id],
              offset = id * 3,
              g = scan.geometry;
            raw = target.raw;
            for (let axis = 0; axis < 3; axis++) {
              raw.point[axis] = g.points[offset + axis];
              raw.normal[axis] = g.normals[offset + axis];
            }
            raw.flags = g.flags?.[id] ?? 0;
            raw.labelWord = g.labels?.[id] ?? 0;
          }
          const hit = target.meshes.query(local, radius, raw, label, mask);
          if (
            !hit ||
            Math.abs(Math.fround(hit.point[0] - maximumFloat)) < 2 ** -23
          )
            continue;
          const m = scan.matrix,
            p = hit.point,
            n = hit.normal;
          matches++;
          center[0] += p[0] * m[0] + p[1] * m[1] + p[2] * m[2] + m[3];
          center[1] += p[0] * m[4] + p[1] * m[5] + p[2] * m[6] + m[7];
          center[2] += p[0] * m[8] + p[1] * m[9] + p[2] * m[10] + m[11];
          normal[0] += n[0] * m[0] + n[1] * m[1] + n[2] * m[2];
          normal[1] += n[0] * m[4] + n[1] * m[5] + n[2] * m[6];
          normal[2] += n[0] * m[8] + n[1] * m[9] + n[2] * m[10];
          continue;
        }
        if (nearest.id < 0) continue;
        const closestId = ids[nearest.id],
          g = scan.geometry;
        const targetLabel = g.labels?.[closestId] ?? 0;
        // Both original branches compare the record's 32-bit label words.
        if (
          !nativeGlobalRawTargetMatches(
            label,
            targetLabel,
            g.flags?.[closestId] ?? 0,
            mask,
          )
        )
          continue;
        if (mode === "pooled-plane") {
          const p = Array.from(
            g.points.subarray(closestId * 3, closestId * 3 + 3),
          );
          const neighbours = tree.neighbours(p, radius);
          if (!neighbours.length) continue;
          maximumDistance = Math.max(maximumDistance, nearest.distance);
          for (let i = 0; i < 3; i++) normal[i] += sourceNormal[i];
          for (const neighbour of neighbours) {
            const pointId = ids[neighbour.id];
            if ((g.labels?.[pointId] ?? 0) === targetLabel)
              points.push(transformedF32(g.points, pointId, scan.matrix));
          }
        } else {
          const p = closestId * 3,
            m = scan.matrix;
          if (Math.abs(Math.fround(g.points[p] - maximumFloat)) < 2 ** -23)
            continue;
          matches++;
          const x = g.points[p],
            y = g.points[p + 1],
            z = g.points[p + 2];
          const nx = g.normals[p],
            ny = g.normals[p + 1],
            nz = g.normals[p + 2];
          center[0] += x * m[0] + y * m[1] + z * m[2] + m[3];
          center[1] += x * m[4] + y * m[5] + z * m[6] + m[7];
          center[2] += x * m[8] + y * m[9] + z * m[10] + m[11];
          normal[0] += nx * m[0] + ny * m[1] + nz * m[2];
          normal[1] += nx * m[4] + ny * m[5] + nz * m[6];
          normal[2] += nx * m[8] + ny * m[9] + nz * m[10];
        }
      }
      let distance: number, direction: number[], threshold: number;
      if (mode === "pooled-plane") {
        if (points.length <= 3) continue;
        const plane = nativeGlobalPlane(points);
        if (!plane.accepted) continue;
        direction = plane.normal;
        distance =
          direction[1] * world[1] +
          direction[0] * world[0] +
          direction[2] * world[2] +
          plane.coefficient;
        normalize(normal);
        threshold = maximumDistance;
      } else {
        if (!matches) continue;
        normalize(normal);
        direction = normal;
        const reciprocal = 1 / matches;
        distance =
          (world[1] - reciprocal * center[1]) * direction[1] +
          (world[0] - reciprocal * center[0]) * direction[0] +
          (world[2] - reciprocal * center[2]) * direction[2];
        threshold = radius;
      }
      const agreement = mode === "pooled-plane" ? normal : sourceNormal;
      if (
        !(Math.abs(distance) < threshold) ||
        !(
          Math.abs(
            direction[0] * agreement[0] +
              direction[1] * agreement[1] +
              direction[2] * agreement[2],
          ) > 0.95
        )
      )
        continue;
      pairs.push({
        id,
        source: world,
        target: world.map((v, i) => v - direction[i] * distance),
        distance: Math.abs(distance),
        active: true,
      });
    }
  return { count: pairs.length, pairs };
}
