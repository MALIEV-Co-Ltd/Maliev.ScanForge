import type { ReferenceVector } from "./reference-construction-values";
import {
  copySketchSourceRecordStore,
  type SketchSourceRecordStore,
} from "./sketch-source-records.ts";

export interface NativeSketchEllipseGeometry {
  center: ReferenceVector;
  axis: ReferenceVector;
  radius1: number;
  radius2: number;
}
export interface SketchEllipseBackendRequest {
  kind: "ellipse";
  center: ReferenceVector;
  axis: ReferenceVector;
  majorRadius: number;
  minorRadius: number;
}
export interface NativeSketchEllipsePreparation {
  frame: SketchSourceRecordStore["frame"];
  sourceRecords: readonly ReferenceVector[];
  geometry: NativeSketchEllipseGeometry | undefined;
  /** Undefined for direct point edits, which do not perform a diameter fit. */
  fitSucceeded: boolean | undefined;
  backendRequest: SketchEllipseBackendRequest | undefined;
}
function finite(n: number) {
  if (!Number.isFinite(n))
    throw new Error("Sketch ellipse arithmetic overflow.");
  return n;
}

/**
 * Collection rebuild, not the direct three-point creation or point-edit route.
 * Native collection clearing precedes fitting. Incomplete inputs retain XYZ;
 * complete inputs flatten the first three Z coordinates and ignore later ones.
 * An early diameter failure preserves previous geometry/backend but leaves the
 * cleared source collection empty. The caller owns backend and publication.
 */
export function prepareNativeSketchEllipseCollectionRebuild(
  input: unknown,
  placement: unknown,
  previous?: NativeSketchEllipseGeometry,
): NativeSketchEllipsePreparation {
  if (!Array.isArray(input))
    throw new Error("Ellipse collection requires source records.");
  const source = copySketchSourceRecordStore({
    version: 1,
    id: "",
    frame: placement,
    children: [{ id: "", kind: "ellipse", records: input }],
  });
  let geometry: NativeSketchEllipseGeometry | undefined;
  if (previous) {
    const copy = copySketchSourceRecordStore({
      version: 1,
      id: "",
      frame: placement,
      children: [
        { id: "", kind: "ellipse", records: [previous.center, previous.axis] },
      ],
    });
    geometry = {
      center: copy.children[0].records![0],
      axis: copy.children[0].records![1],
      radius1: finite(previous.radius1),
      radius2: finite(previous.radius2),
    };
  }
  const records = source.children[0].records!;
  const failed = (
    sourceRecords: readonly ReferenceVector[],
  ): NativeSketchEllipsePreparation => ({
    frame: source.frame,
    sourceRecords,
    geometry,
    fitSucceeded: false,
    backendRequest: undefined,
  });
  if (records.length < 3) return failed(records);
  const [a, b, c] = records
    .slice(0, 3)
    .map((p): ReferenceVector => [p[0], p[1], 0]);
  const ax = a[0] - b[0],
    ay = a[1] - b[1],
    az = a[2] - b[2];
  const diameter = Math.sqrt(finite(ax * ax + ay * ay + az * az));
  if (diameter < 0.0001) return failed([]);
  const center: ReferenceVector = [
    finite((a[0] + b[0]) * 0.5),
    finite((b[1] + a[1]) * 0.5),
    finite((a[2] + b[2]) * 0.5),
  ];
  const reciprocal = 1 / diameter;
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    dz = b[2] - a[2];
  const axis: ReferenceVector = [
    dx * reciprocal,
    dy * reciprocal,
    reciprocal * dz,
  ];
  const radius1 = diameter * 0.5;
  // Projection is onto the infinite diameter line, with Y/X/Z denominator.
  const numerator = finite(
    (c[0] - a[0]) * dx + (c[1] - a[1]) * dy + (c[2] - a[2]) * dz,
  );
  const fraction = finite(numerator / finite(dy * dy + dx * dx + dz * dz));
  const ex = finite(fraction * dx + a[0] - c[0]),
    ey = finite(fraction * dy + a[1] - c[1]),
    ez = finite(fraction * dz + a[2] - c[2]);
  const radius2 = Math.sqrt(finite(ex * ex + ey * ey + ez * ez));
  geometry = { center, axis, radius1, radius2 };
  return prepareFromGeometry(geometry, source.frame, true);
}

function prepareFromGeometry(
  geometry: NativeSketchEllipseGeometry,
  frame: SketchSourceRecordStore["frame"],
  fitSucceeded: boolean | undefined = undefined,
): NativeSketchEllipsePreparation {
  const { center, axis, radius1, radius2 } = geometry;
  const perpendicular: ReferenceVector = [-axis[1], axis[0], axis[2]];
  const minus = (
    direction: ReferenceVector,
    radius: number,
  ): ReferenceVector => [
    finite(center[0] - radius * direction[0]),
    finite(center[1] - radius * direction[1]),
    finite(center[2] - radius * direction[2]),
  ];
  const plus = (
    direction: ReferenceVector,
    radius: number,
  ): ReferenceVector => [
    finite(radius * direction[0] + center[0]),
    finite(radius * direction[1] + center[1]),
    finite(radius * direction[2] + center[2]),
  ];
  const swapped = radius1 < radius2;
  return {
    frame,
    geometry,
    fitSucceeded,
    sourceRecords: [
      minus(axis, radius1),
      plus(axis, radius1),
      plus(perpendicular, radius2),
      minus(perpendicular, radius2),
      [...center],
    ],
    backendRequest: {
      kind: "ellipse",
      center: [...center],
      axis: swapped ? [axis[1], -axis[0], axis[2]] : [...axis],
      majorRadius: swapped ? radius2 : radius1,
      minorRadius: swapped ? radius1 : radius2,
    },
  };
}

/** Native source-handle edit; direct XYZ geometry update, not a three-point fit. */
export function prepareNativeSketchEllipsePointEdit(
  index: number,
  target: unknown,
  previous: NativeSketchEllipsePreparation,
): { changed: boolean; preparation: NativeSketchEllipsePreparation } {
  if (!Number.isSafeInteger(index) || index < 0 || index > 4)
    throw new Error("Ellipse point index must be between zero and four.");
  const source = copySketchSourceRecordStore({
    version: 1,
    id: "",
    frame: previous.frame,
    children: [
      { id: "old", kind: "ellipse", records: previous.sourceRecords },
      { id: "target", kind: "ellipse", records: [target] },
    ],
  });
  const geometry = prepareNativeSketchEllipseCollectionRebuild(
    [],
    source.frame,
    previous.geometry,
  ).geometry;
  if (!geometry || !source.children[0].records?.[index])
    throw new Error(
      "Ellipse point edit requires retained geometry and the selected source record.",
    );
  const p = source.children[1].records![0],
    old = source.children[0].records[index];
  const x = old[0] - p[0],
    y = old[1] - p[1],
    z = old[2] - p[2];
  const movement = Math.sqrt(
    finite(index === 3 ? y * y + x * x + z * z : x * x + y * y + z * z),
  );
  const unchanged = () => ({
    changed: false,
    preparation: structuredClone(previous),
  });
  if (!(movement > 2 ** -23)) return unchanged();
  if (index === 4) geometry.center = [...p];
  else {
    const negative = index === 0 || index === 2;
    const delta = (i: number) =>
      finite(negative ? geometry.center[i] - p[i] : p[i] - geometry.center[i]);
    const dx = delta(0),
      dy = delta(1),
      dz = delta(2);
    const radius = Math.sqrt(
      finite(
        negative ? dx * dx + dy * dy + dz * dz : dy * dy + dx * dx + dz * dz,
      ),
    );
    if (radius < 0.0001) return unchanged();
    // The native edit divides each component directly, unlike initial fitting.
    const direction: ReferenceVector = [dx / radius, dy / radius, dz / radius];
    if (index < 2) {
      geometry.axis = direction;
      geometry.radius1 = radius;
    } else {
      geometry.axis = [-direction[1], direction[0], direction[2]];
      geometry.radius2 = radius;
    }
  }
  return {
    changed: true,
    preparation: prepareFromGeometry(geometry, source.frame),
  };
}

/** Supplied-world records use the native transpose conversion, not affine inversion. */
export function prepareNativeSketchEllipsePlacedReplacement(
  input: unknown,
  placement: unknown,
  previous: NativeSketchEllipsePreparation,
): NativeSketchEllipsePreparation {
  if (!Array.isArray(input))
    throw new Error("Placed ellipse replacement requires records.");
  const source = copySketchSourceRecordStore({
    version: 1,
    id: "",
    frame: placement,
    children: [{ id: "", kind: "ellipse", records: input }],
  });
  const records = source.children[0].records!,
    [a, b, c] = source.frame;
  const incomplete = records.length < 3;
  const local = records.slice(0, 3).map((p): ReferenceVector => {
    const x = finite(p[0] - a[3]),
      y = finite(p[1] - b[3]),
      z = finite(p[2] - c[3]);
    return [
      finite(y * b[0] + x * a[0] + z * c[0]),
      finite(
        incomplete
          ? x * a[1] + y * b[1] + z * c[1]
          : y * b[1] + x * a[1] + z * c[1],
      ),
      incomplete ? finite(y * b[2] + x * a[2] + z * c[2]) : 0,
    ];
  });
  const preparation = prepareNativeSketchEllipseCollectionRebuild(
    local,
    source.frame,
    previous.geometry,
  );
  if (!preparation.fitSucceeded)
    preparation.frame = copySketchSourceRecordStore({
      version: 1,
      id: "",
      frame: previous.frame,
      children: [],
    }).frame;
  return preparation;
}
