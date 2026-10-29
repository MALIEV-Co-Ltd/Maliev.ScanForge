import type { Entity, Vec3 } from "./types";
import { validateSketchFrame, type SketchFrame } from "./sketch-frame";
import { cloudPoseBits, cloudPoseMatrix } from "./point-cloud-placement";
import { DEFAULT_REFERENCE_COLOR } from "./appearance";

export type CoordinateFrameData = NonNullable<Entity["coordinateFrame"]>;
export interface EncodedCoordinateFrame {
  version: 1;
  /** Binary64 LE carrier ordered as origin, U, V, normal; not a cloud transform. */
  frameBits: string;
  displaySize: number;
}
function object(
  value: unknown,
  fields: readonly string[],
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    throw new Error("Invalid coordinate frame object.");
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    keys.some(
      (key) =>
        typeof key !== "string" ||
        !fields.includes(key) ||
        !("value" in Object.getOwnPropertyDescriptor(value, key)!),
    )
  )
    throw new Error("Invalid coordinate frame fields.");
  return value as Record<string, unknown>;
}
function vector(value: unknown): Vec3 {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    Reflect.ownKeys(value).some(
      (key) => !["0", "1", "2", "length"].includes(String(key)),
    )
  )
    throw new Error(
      "Coordinate frame vectors require three finite coordinates.",
    );
  return [0, 1, 2].map((index) => {
    const entry = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      !entry ||
      !("value" in entry) ||
      typeof entry.value !== "number" ||
      !Number.isFinite(entry.value) ||
      Math.abs(entry.value) > 1e9
    )
      throw new Error(
        "Coordinate frame vectors require three finite coordinates within +/-1e9 mm.",
      );
    return entry.value;
  }) as Vec3;
}
function endpoints(data: CoordinateFrameData): Vec3[] {
  return [
    data.frame.origin,
    ...[data.frame.u, data.frame.v, data.frame.normal].map((axis) => {
      const point = data.frame.origin.map(
        (value, i) => value + axis[i] * data.displaySize,
      ) as Vec3;
      if (
        point.some((value) => !Number.isFinite(value) || Math.abs(value) > 1e9)
      )
        throw new Error("Coordinate frame axis endpoints exceed world bounds.");
      return point;
    }),
  ];
}
/** Validate/detach without normalizing, fitting or rounding authored binary64 values. */
export function copyReferenceFrame(input: unknown): CoordinateFrameData {
  const value = object(input, ["version", "frame", "displaySize"]);
  if (
    value.version !== 1 ||
    typeof value.displaySize !== "number" ||
    !Number.isFinite(value.displaySize) ||
    value.displaySize <= 0 ||
    value.displaySize > 2e9
  )
    throw new Error(
      "Coordinate frame display size must be positive and at most 2e9 mm.",
    );
  const raw = object(value.frame, ["origin", "u", "v", "normal"]);
  const frame: SketchFrame = {
    origin: vector(raw.origin),
    u: vector(raw.u),
    v: vector(raw.v),
    normal: vector(raw.normal),
  };
  validateSketchFrame(frame);
  const data: CoordinateFrameData = {
    version: 1,
    frame,
    displaySize: value.displaySize,
  };
  endpoints(data);
  return data;
}
export function encodeReferenceFrame(input: unknown): EncodedCoordinateFrame {
  const data = copyReferenceFrame(input);
  return {
    version: 1,
    frameBits: cloudPoseBits([
      ...data.frame.origin,
      ...data.frame.u,
      ...data.frame.v,
      ...data.frame.normal,
    ]),
    displaySize: data.displaySize,
  };
}
export function decodeReferenceFrame(input: unknown): CoordinateFrameData {
  const value = object(input, ["version", "frameBits", "displaySize"]);
  if (
    value.version !== 1 ||
    typeof value.frameBits !== "string" ||
    !/^[0-9a-f]{192}$/.test(value.frameBits)
  )
    throw new Error("Invalid coordinate frame binary64 encoding.");
  const values = cloudPoseMatrix(value.frameBits);
  return copyReferenceFrame({
    version: 1,
    frame: {
      origin: values.slice(0, 3),
      u: values.slice(3, 6),
      v: values.slice(6, 9),
      normal: values.slice(9, 12),
    },
    displaySize: value.displaySize,
  });
}

export function createReferenceFrameEntity(
  frame: SketchFrame,
  displaySize: number,
  id: string,
  name: string,
): Entity {
  if (
    typeof id !== "string" ||
    !id ||
    typeof name !== "string" ||
    !name ||
    name.length > 200
  )
    throw new Error("Coordinate frame identity and name are required.");
  return {
    id,
    name,
    kind: "referenceFrame",
    positions: [],
    coordinateFrame: copyReferenceFrame({ version: 1, frame, displaySize }),
    color: DEFAULT_REFERENCE_COLOR,
    opacity: 1,
    visible: true,
  };
}

const incompatible = [
  "reference",
  "indexedMesh",
  "normals",
  "pointColors",
  "meshSelection",
  "pointCloudPlacement",
  "brep",
  "kernelId",
  "fit",
  "planeFrame",
  "surfacePatch",
  "surfaceScanId",
  "parametric",
  "authoringLinks",
  "scanSource",
  "edgePositions",
  "ascAttributes",
  "pointSize",
  "pointAutoDensity",
  "pointDensity",
  "pointColorMode",
] as const;
/** Check raw metadata before JSON/binary codecs can normalize forbidden values. */
export function assertReferenceFrameCompatibleMetadata(
  entity: Pick<Entity, "kind"> & { coordinateFrame?: unknown } & Partial<
      Record<(typeof incompatible)[number], unknown>
    >,
): void {
  if (entity.kind !== "referenceFrame") {
    if (entity.coordinateFrame !== undefined)
      throw new Error(
        "Coordinate frame payload requires a referenceFrame entity.",
      );
    return;
  }
  if (incompatible.some((key) => entity[key] !== undefined))
    throw new Error(
      "Coordinate frame entities require empty positions and compatible semantic metadata.",
    );
}
export function validateReferenceFrameEntity(
  entity: Entity,
): CoordinateFrameData | undefined {
  assertReferenceFrameCompatibleMetadata(entity);
  if (entity.kind !== "referenceFrame") return undefined;
  if (
    !(
      Array.isArray(entity.positions) ||
      entity.positions instanceof Float32Array
    ) ||
    entity.positions.length !== 0
  )
    throw new Error("Coordinate frame entities require empty positions.");
  return copyReferenceFrame(entity.coordinateFrame);
}
function bounds(data: CoordinateFrameData) {
  const points = endpoints(data),
    min: Vec3 = [...points[0]],
    max: Vec3 = [...points[0]];
  for (const point of points.slice(1))
    for (let i = 0; i < 3; i++) {
      if (point[i] < min[i]) min[i] = point[i];
      if (point[i] > max[i]) max[i] = point[i];
    }
  return { min, max };
}
export function referenceFrameBounds(entity: Entity) {
  const data = validateReferenceFrameEntity(entity);
  return data && bounds(data);
}
export function referenceFrameSummary(entity: Entity) {
  const data = validateReferenceFrameEntity(entity);
  return (
    data && { points: 1, lines: 3, triangles: 0 as const, bounds: bounds(data) }
  );
}
export function inspectReferenceFrame(entity: Entity) {
  const data = validateReferenceFrameEntity(entity);
  return (
    data && {
      points: 1,
      lines: 3,
      triangles: 0 as const,
      bounds: bounds(data),
      coordinateFrame: data,
      coordinateFrameEncoding: encodeReferenceFrame(data),
    }
  );
}
