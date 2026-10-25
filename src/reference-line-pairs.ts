import {
  copyReferenceGeometry,
  referenceLineEnd,
  type ReferenceLineGeometry,
  type ReferenceVector,
} from "./reference-construction-values";
import {
  nativeReferenceClosestLines,
  nativeReferenceNormalize,
  nativeReferencePlaneIntersection,
} from "./reference-geometry-numerics";
import type { ResolvedReferencePrimitive } from "./reference-point-evaluation";

export type NativeReferenceBounds = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
];
/** Metadata belongs to each retained pick record, in that record's source order. */
export type NativeReferenceLineRecord = ResolvedReferencePrimitive & {
  readonly objectResolved?: boolean;
  /** Native direct-plane fields +0x80/+0x88; absent for CAD-derived planes. */
  readonly directPlaneHalfSizes?: readonly [number, number];
  /** Raw Float32 minXYZ/maxXYZ, resolved from the source's bounds operation. */
  readonly bounds?: NativeReferenceBounds;
};
type Plane = Extract<NativeReferenceLineRecord, { kind: "plane" }>;
type Axis = Extract<NativeReferenceLineRecord, { kind: "axis" }>;
export interface NativeReferenceLinePairCandidate {
  start: ReferenceVector;
  end: ReferenceVector;
  reason:
    | "previous-endpoints"
    | "pair"
    | "failed-extraction"
    | "axis-projection-fallback"
    | "plane-projection-fallback";
  contributingRecords: number;
}

function vector(value: readonly number[]): ReferenceVector {
  const geometry = copyReferenceGeometry({ kind: "point", position: value });
  if (geometry.kind !== "point")
    throw new Error("Expected reference coordinates.");
  return geometry.position;
}

function checked(record: NativeReferenceLineRecord): NativeReferenceLineRecord {
  if (record.kind === "point")
    return { ...record, position: vector(record.position) };
  if (record.kind === "axis")
    return { ...record, start: vector(record.start), end: vector(record.end) };
  if (record.kind === "plane") {
    if (!Number.isFinite(record.offset))
      throw new Error("Invalid reference plane offset.");
    return {
      ...record,
      origin: vector(record.origin),
      normal: vector(record.normal),
    };
  }
  if (record.kind === "unavailable") return { kind: "unavailable" };
  throw new Error("Unsupported resolved reference primitive.");
}

function midpoint(a: ReferenceVector, b: ReferenceVector): ReferenceVector {
  return [(b[0] + a[0]) * 0.5, (b[1] + a[1]) * 0.5, (b[2] + a[2]) * 0.5];
}

function delta(axis: Axis): ReferenceVector {
  return [
    axis.end[0] - axis.start[0],
    axis.end[1] - axis.start[1],
    axis.end[2] - axis.start[2],
  ];
}

function dot(
  a: readonly number[],
  b: readonly number[],
  order: "xyz" | "yxz",
): number {
  return order === "xyz"
    ? a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
    : a[1] * b[1] + a[0] * b[0] + a[2] * b[2];
}

function projectAxis(
  p: ReferenceVector,
  axis: Axis,
  order: "xyz" | "yxz",
): ReferenceVector {
  const u = delta(axis);
  const offset = [
    p[0] - axis.start[0],
    p[1] - axis.start[1],
    p[2] - axis.start[2],
  ];
  const distance = dot(offset, u, order) / dot(u, u, order);
  return [
    u[0] * distance + axis.start[0],
    u[1] * distance + axis.start[1],
    u[2] * distance + axis.start[2],
  ];
}

function projectPlane(p: ReferenceVector, plane: Plane): ReferenceVector {
  const distance = dot(p, plane.normal, "yxz") + plane.offset;
  return [
    p[0] - plane.normal[0] * distance,
    p[1] - plane.normal[1] * distance,
    p[2] - plane.normal[2] * distance,
  ];
}

function bounds(value: NativeReferenceBounds | undefined): number[] {
  if (
    !Array.isArray(value) ||
    value.length !== 6 ||
    Array.from(value).some((n) => !Number.isFinite(n) || Math.fround(n) !== n)
  )
    throw new Error(
      "Reference plane pair requires resolved Float32 source bounds.",
    );
  return [...value];
}

function validBounds(value: readonly number[]): boolean {
  const maximum = 3.4028234663852886e38;
  return (
    value[0] <= value[3] &&
    value[1] <= value[4] &&
    value[2] <= value[5] &&
    -maximum < value[0] &&
    -maximum < value[1] &&
    -maximum < value[2] &&
    value[3] < maximum &&
    value[4] < maximum &&
    value[5] < maximum
  );
}

function maxSecond(a: number, b: number): number {
  return a > b ? a : b;
}

function planeExtent(
  a: Plane,
  b: Plane,
  point: readonly number[],
  direction: readonly number[],
): { center: ReferenceVector; halfLength: number } {
  if (a.directPlaneHalfSizes && b.directPlaneHalfSizes) {
    const sizeA = a.directPlaneHalfSizes,
      sizeB = b.directPlaneHalfSizes;
    if (
      sizeA.length !== 2 ||
      sizeB.length !== 2 ||
      !Array.from(sizeA).every(Number.isFinite) ||
      !Array.from(sizeB).every(Number.isFinite)
    )
      throw new Error("Invalid reference direct-plane extent.");
    return {
      center: vector(point),
      halfLength: maxSecond(
        maxSecond(sizeA[0], sizeA[1]),
        maxSecond(sizeB[0], sizeB[1]),
      ),
    };
  }
  const first = bounds(a.bounds),
    second = bounds(b.bounds),
    merged = [...first];
  if (validBounds(second)) {
    for (let i = 0; i < 3; i++) {
      if (second[i] <= merged[i]) merged[i] = second[i];
      if (merged[i + 3] <= second[i + 3]) merged[i + 3] = second[i + 3];
    }
  }
  const x = Math.fround(merged[3] - merged[0]),
    y = Math.fround(merged[4] - merged[1]),
    z = Math.fround(merged[5] - merged[2]);
  const span = x <= y ? (z < y ? y : z) : z < x ? x : z;
  // The native caller samples the first source twice, rounding each midpoint and
  // their average through Float32. Do not substitute the merged-box center.
  const center = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const firstMidpoint = Math.fround(
      Math.fround(first[i] + first[i + 3]) * 0.5,
    );
    const secondMidpoint = Math.fround(
      Math.fround(first[i + 3] + first[i]) * 0.5,
    );
    center[i] = Math.fround(Math.fround(firstMidpoint + secondMidpoint) * 0.5);
  }
  const distance =
    (center[0] - point[0]) * direction[0] +
    (center[1] - point[1]) * direction[1] +
    (center[2] - point[2]) * direction[2];
  return {
    center: vector([
      distance * direction[0] + point[0],
      distance * direction[1] + point[1],
      distance * direction[2] + point[2],
    ]),
    halfLength: span * 0.5,
  };
}

/** Candidate endpoints only; caller performs the native strict-length stores. */
export function nativeReferenceLinePairEndpoints(
  records: readonly NativeReferenceLineRecord[],
  prior: ReferenceLineGeometry,
): NativeReferenceLinePairCandidate {
  if (
    records.length < 2 ||
    records[0].objectResolved === false ||
    records[1].objectResolved === false
  )
    return {
      start: prior.start,
      end: referenceLineEnd(prior),
      reason: "previous-endpoints",
      contributingRecords: 0,
    };
  const a = checked(records[0]),
    b = checked(records[1]);
  const result = (
    start: ReferenceVector,
    end: ReferenceVector,
    reason: NativeReferenceLinePairCandidate["reason"] = "pair",
  ): NativeReferenceLinePairCandidate => ({
    start,
    end,
    reason,
    contributingRecords: 2,
  });
  if (a.kind === "unavailable" || b.kind === "unavailable")
    return {
      start: [0, 0, 0],
      end: [0, 0, 0],
      reason: "failed-extraction",
      contributingRecords: 0,
    };
  if (a.kind === "point" && b.kind === "point")
    return result(a.position, b.position);
  if (a.kind === "point" && b.kind === "axis")
    return result(a.position, projectAxis(a.position, b, "yxz"));
  if (a.kind === "axis" && b.kind === "point")
    return result(b.position, projectAxis(b.position, a, "xyz"));
  if (a.kind === "point" && b.kind === "plane")
    return result(a.position, projectPlane(a.position, b));
  if (a.kind === "plane" && b.kind === "point")
    return result(b.position, projectPlane(b.position, a));
  if (a.kind === "axis" && b.kind === "plane")
    return result(projectPlane(a.start, b), projectPlane(a.end, b));
  if (a.kind === "plane" && b.kind === "axis")
    return result(projectPlane(b.start, a), projectPlane(b.end, a));
  const cosine = Math.cos(0.017453292519943295);
  if (a.kind === "axis" && b.kind === "axis") {
    const u = delta(a),
      v = delta(b);
    if (
      Math.abs(
        dot(nativeReferenceNormalize(v), nativeReferenceNormalize(u), "yxz"),
      ) <= cosine
    ) {
      const closest = nativeReferenceClosestLines(
        a.start,
        u,
        b.start,
        v,
        2 ** -23,
      );
      if (closest) return result(vector(closest.first), vector(closest.second));
    }
    const center = midpoint(midpoint(a.start, a.end), midpoint(b.start, b.end));
    return result(
      projectAxis(center, a, "xyz"),
      projectAxis(center, b, "xyz"),
      "axis-projection-fallback",
    );
  }
  if (a.kind === "plane" && b.kind === "plane") {
    if (Math.abs(dot(b.normal, a.normal, "yxz")) <= cosine) {
      const intersection = nativeReferencePlaneIntersection(
        a.normal,
        a.offset,
        b.normal,
        b.offset,
        0.001,
      );
      if (intersection) {
        const { center, halfLength } = planeExtent(
          a,
          b,
          intersection.point,
          intersection.direction,
        );
        const d = intersection.direction;
        return result(
          [
            center[0] - d[0] * halfLength,
            center[1] - d[1] * halfLength,
            center[2] - d[2] * halfLength,
          ],
          [
            d[0] * halfLength + center[0],
            d[1] * halfLength + center[1],
            d[2] * halfLength + center[2],
          ],
        );
      }
    }
    const center = midpoint(a.origin, b.origin);
    return result(
      projectPlane(center, a),
      projectPlane(center, b),
      "plane-projection-fallback",
    );
  }
  throw new Error("Unsupported reference line pair.");
}
