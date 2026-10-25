import {
  copyReferenceGeometry,
  type ReferenceVector,
} from "./reference-construction-values";
import type { NativeReferenceLineRecord } from "./reference-line-evaluation";
import { nativeDatumCadAxisReference } from "./scan-native-datum-cad";
import { nativeReferenceNormalize } from "./reference-geometry-numerics";

/** Native payload snapshots, already resolved into one coordinate frame and unit. */
export type DirectReferenceSource =
  | {
      readonly kind: "sphere" | "referencePoint";
      readonly origin: ReferenceVector;
    }
  | {
      readonly kind: "cylinder" | "referenceLine";
      readonly origin: ReferenceVector;
      readonly direction: ReferenceVector;
      readonly length: number;
    }
  | {
      readonly kind: "cone";
      readonly origin: ReferenceVector;
      readonly direction: ReferenceVector;
      readonly length: number;
      readonly offset: number;
    }
  | {
      readonly kind: "plane";
      readonly origin: ReferenceVector;
      readonly normal: ReferenceVector;
      readonly offset: number;
      readonly halfSizes: readonly [number, number];
    }
  | { readonly kind: "unsupported" };

/** Only the established resolved OpenCascade kinds; provider picking is separate. */
export interface CadReferenceAxisSource {
  readonly provider: "openCascade";
  readonly kind: "cylinder" | "cone" | "torus";
  readonly location: ReferenceVector;
  readonly axis: ReferenceVector;
  readonly firstV: number;
  readonly lastV: number;
  readonly radius: number;
  readonly semiAngle: number;
}

/**
 * Already resolved sketch snapshot. Rows are the owner's stored affine frame;
 * children and their stored point records retain their original order. These
 * are not inferred control points or a replacement curve tessellation.
 */
export interface PickedSketchReferenceSource {
  readonly frame: readonly [
    readonly [number, number, number, number],
    readonly [number, number, number, number],
    readonly [number, number, number, number],
  ];
  readonly children: readonly (readonly ReferenceVector[] | undefined)[];
}

function checkSketchReferenceFrame(
  frame: PickedSketchReferenceSource["frame"],
): void {
  if (!Array.isArray(frame) || frame.length !== 3)
    throw new Error("Invalid sketch reference frame.");
  for (const row of frame) {
    if (!Array.isArray(row) || row.length !== 4)
      throw new Error(
        "Sketch reference frame requires three rows of four values.",
      );
    for (const value of row) finite(value);
  }
}

/**
 * The line tool's already selected sketch-record acquisition branch: round the
 * local record to Float32, place it with the owner's stored double frame, then
 * round the world result to Float32 for the retained pick. Later nearest-record
 * resolution still transforms the original double records independently.
 *
 * This finite-value adapter does not select a child/index, perform viewport hit
 * testing, admit a scene source or publish a construction. Public authoring must
 * retain its bounded rigid-frame validation; this raw snapshot helper does not
 * establish that arbitrary frames are authorable.
 */
export function acquireSketchReferencePick(
  frame: PickedSketchReferenceSource["frame"],
  localRecord: ReferenceVector,
): ReferenceVector {
  checkSketchReferenceFrame(frame);
  const [x, y, z] = vector(vector(localRecord).map(Math.fround));
  const [a, b, c] = frame;
  return vector(
    [
      y * a[1] + x * a[0] + z * a[2] + a[3],
      x * b[0] + y * b[1] + z * b[2] + b[3],
      x * c[0] + y * c[1] + z * c[2] + c[3],
    ].map(Math.fround),
  );
}

/**
 * Select a stored sketch point using the recovered transform and distance order.
 * The supplied pick is quantized to the native Float32 carrier; its acquisition
 * and coordinate-space provenance remain upstream. This internal finite-value
 * adapter does not resolve scene objects, produce child records or publish a
 * construction. Missing source and unsuccessful extraction remain distinct.
 */
export function resolvePickedSketchReferencePoint(
  source: PickedSketchReferenceSource | undefined,
  pick: ReferenceVector,
): NativeReferenceLineRecord {
  if (source === undefined)
    return { kind: "unavailable", objectResolved: false };
  const picked = vector(vector(pick).map(Math.fround));
  if (!Array.isArray(source.children))
    throw new Error("Invalid sketch reference snapshot.");
  checkSketchReferenceFrame(source.frame);
  const [a, b, c] = source.frame;
  // Native initial squared-distance bound is promoted FLT_MAX, not infinity.
  let closestSquared = 3.4028234663852886e38;
  let position: ReferenceVector | undefined;
  for (const records of source.children) {
    if (records === undefined) continue;
    if (!Array.isArray(records))
      throw new Error("Invalid sketch reference point container.");
    for (const record of records) {
      const [x, y, z] = vector(record);
      const transformed: ReferenceVector = [
        y * a[1] + x * a[0] + z * a[2] + a[3],
        x * b[0] + y * b[1] + z * b[2] + b[3],
        x * c[0] + y * c[1] + z * c[2] + c[3],
      ];
      const dx = transformed[0] - picked[0],
        dy = transformed[1] - picked[1],
        dz = transformed[2] - picked[2];
      const squared = dx * dx + dy * dy + dz * dz;
      // Strict comparison retains first ties and rejects overflow/NaN results.
      if (squared < closestSquared) {
        closestSquared = squared;
        position = transformed;
      }
    }
  }
  return position === undefined
    ? { kind: "unavailable", objectResolved: true }
    : { kind: "point", position, objectResolved: true };
}

/** Successful provider surface parameters; face selection and API errors are upstream. */
export type AlternateReferenceAxisSource = {
  readonly location: ReferenceVector;
  readonly axis: ReferenceVector;
  readonly unitScale: number;
} & (
  | { readonly kind: "cylinder" }
  | {
      readonly kind: "cone";
      readonly radius: number;
      readonly semiAngle: number;
    }
);

/**
 * Origin/direction writes from the alternate CAD provider's cylinder/cone path.
 * The native caller's extent slot is not written on this path. This snapshot is
 * deliberately not a line record: it cannot supply an endpoint or publication
 * extent until the surrounding caller state has been resolved. No provider SDK
 * is invoked, and the observed runtime unit scale is not assumed to be constant.
 */
export function extractAlternateReferenceAxis(
  source: AlternateReferenceAxisSource,
): {
  origin: ReferenceVector;
  direction: ReferenceVector;
  extentWritten: false;
} {
  if (source.kind !== "cylinder" && source.kind !== "cone")
    throw new Error("Unsupported alternate reference axis kind.");
  const location = vector(source.location),
    axis = vector(source.axis),
    scale = finite(source.unitScale);
  const direction = nativeReferenceNormalize(axis);
  if (source.kind === "cylinder") {
    return {
      origin: vector(location.map((value) => value * scale)),
      direction: vector(direction),
      extentWritten: false,
    };
  }
  const offset =
    Math.tan(Math.PI / 2 - finite(source.semiAngle)) *
    finite(source.radius) *
    scale;
  return {
    origin: vector(
      location.map((value, i) => value * scale - direction[i] * offset),
    ),
    direction: vector(nativeReferenceNormalize(direction)),
    extentWritten: false,
  };
}

function vector(input: readonly number[]): ReferenceVector {
  const value = copyReferenceGeometry({ kind: "point", position: input });
  if (value.kind !== "point") throw new Error("Expected source coordinates.");
  return value.position;
}

function finite(value: number): number {
  if (!Number.isFinite(value))
    throw new Error("Reference source value must be finite.");
  return value;
}

function endpoint(
  origin: ReferenceVector,
  direction: ReferenceVector,
  extent: number,
): ReferenceVector {
  return vector([
    extent * direction[0] + origin[0],
    extent * direction[1] + origin[1],
    extent * direction[2] + origin[2],
  ]);
}

/**
 * Direct native extraction only. No fit conversion, scene lookup, normalization,
 * CAD fallback, picking, unit conversion or source eligibility is inferred here.
 * Undefined means a missing object; unsupported means an existing object whose
 * direct extraction failed. Public authoring admission is a separate boundary.
 */
export function resolveDirectReferencePrimitive(
  source: DirectReferenceSource | undefined,
): NativeReferenceLineRecord {
  if (source === undefined)
    return { kind: "unavailable", objectResolved: false };
  switch (source.kind) {
    case "unsupported":
      return { kind: "unavailable", objectResolved: true };
    case "sphere":
    case "referencePoint":
      return {
        kind: "point",
        position: vector(source.origin),
        objectResolved: true,
      };
    case "cylinder":
    case "referenceLine": {
      const start = vector(source.origin),
        direction = vector(source.direction);
      return {
        kind: "axis",
        start,
        end: endpoint(start, direction, finite(source.length)),
        objectResolved: true,
      };
    }
    case "cone": {
      const origin = vector(source.origin),
        direction = vector(source.direction);
      const length = finite(source.length),
        offset = finite(source.offset);
      return {
        kind: "axis",
        start: endpoint(origin, direction, offset),
        end: endpoint(origin, direction, length + offset),
        objectResolved: true,
      };
    }
    case "plane": {
      if (!Array.isArray(source.halfSizes) || source.halfSizes.length !== 2)
        throw new Error("Reference plane requires two stored half sizes.");
      return {
        kind: "plane",
        origin: vector(source.origin),
        normal: vector(source.normal),
        offset: finite(source.offset),
        directPlaneHalfSizes: [
          finite(source.halfSizes[0]),
          finite(source.halfSizes[1]),
        ],
        objectResolved: true,
      };
    }
    default:
      throw new Error("Unsupported direct reference source kind.");
  }
}

/**
 * Convert already selected adaptor parameters using the established CAD math.
 * Construction uses direction * nonnegative extent + start, not the trimmed
 * last-V point. Alternate-provider extent and classification 7 are unresolved.
 */
export function resolveCadReferenceAxis(
  source: CadReferenceAxisSource,
): NativeReferenceLineRecord {
  if (source.provider !== "openCascade")
    throw new Error("Unsupported reference CAD provider.");
  if (!["cylinder", "cone", "torus"].includes(source.kind))
    throw new Error("Unsupported reference CAD axis kind.");
  const result = nativeDatumCadAxisReference(
    source.kind,
    source.location,
    source.axis,
    source.firstV,
    source.lastV,
    source.radius,
    source.semiAngle,
  );
  const start = vector(result.point),
    direction = vector(result.direction);
  finite(result.length);
  return {
    kind: "axis",
    start,
    end: vector([
      direction[0] * result.length + start[0],
      direction[1] * result.length + start[1],
      direction[2] * result.length + start[2],
    ]),
    objectResolved: true,
  };
}
