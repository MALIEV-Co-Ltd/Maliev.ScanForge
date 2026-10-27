import type { Entity, FitResult } from "./types";
import { assertSampledGeometry } from "./reference-entity";
import {
  primitiveFitInput,
  type PrimitiveFitRegion,
} from "./primitive-fit-samples";
import { fitPlane, fitSphere, fitCylinder, fitCone } from "./geometry";
import { Quaternion, Vector3 } from "three";
import { createNumericDatumPlane } from "./datum-construction";

/** One sampling and fitting operation for GUI and agent analysis. */
export function analyzePrimitiveFit(
  source: Entity,
  kind: FitResult["kind"],
  selection?: Uint8Array | null,
  region?: PrimitiveFitRegion,
): { fit: FitResult; samples: number; totalVertices: number } {
  assertSampledGeometry(source);
  const input = primitiveFitInput(source, selection, region);
  const fitters = {
    plane: fitPlane,
    sphere: fitSphere,
    cylinder: fitCylinder,
    cone: fitCone,
  };
  if (!Object.hasOwn(fitters, kind))
    throw new Error("Unsupported primitive fitting kind.");
  return {
    fit: fitters[kind](input.positions),
    samples: input.positions.length / 3,
    totalVertices: input.totalVertices,
  };
}

export function createFittedPlane(
  fit: FitResult,
  size: number,
  name = "Fitted plane reference",
): Entity {
  if (fit.kind !== "plane" || !Number.isFinite(size) || size <= 0)
    throw new Error("Fitted plane requires a positive finite display size.");
  const rotation = new Quaternion().setFromUnitVectors(
    new Vector3(0, 0, 1),
    new Vector3(...fit.axis),
  );
  const tangent = new Vector3(1, 0, 0).applyQuaternion(rotation).toArray() as [
    number,
    number,
    number,
  ];
  const normal = new Vector3(...fit.axis);
  const v = normal
    .clone()
    .cross(new Vector3(...tangent))
    .toArray() as [number, number, number];
  const plane = createNumericDatumPlane(
    { origin: [...fit.center], u: tangent, v, normal: [...fit.axis] },
    size,
    crypto.randomUUID(),
    name,
  );
  // Retain the previous PlaneGeometry triangle order in the binary64 carrier.
  const positions = plane.positions;
  plane.positions = [5, 0, 2, 0, 1, 2].flatMap((index) =>
    Array.from(positions.slice(index * 3, index * 3 + 3)),
  );
  return { ...plane, fit: structuredClone(fit) };
}
