import {
  nativeDatumCadAxisReference,
  nativeDatumCadPlaneReference,
} from "../scan-native-datum-cad";
import type { Vec3 } from "../types";

type FaceIdentity = {
  faceIndex: number;
  firstTriangle: number;
  triangleCount: number;
};
/** Kernel inputs remain separate from sketch/render plane frames. */
export type CadAlignmentInput = FaceIdentity &
  (
    | {
        kind: "plane";
        evaluatedPoint: Vec3;
        derivativeU: Vec3;
        derivativeV: Vec3;
      }
    | {
        kind: "cylinder" | "cone" | "torus";
        location: Vec3;
        axis: Vec3;
        firstV: number;
        lastV: number;
        radius: number;
        semiAngle: number;
      }
    | { kind: "unsupported"; surfaceType: number }
  );

/** Shared conversion for future GUI and MCP reference picking. */
export function evaluateCadAlignmentReference(
  input: CadAlignmentInput,
  referencePoint?: Vec3,
) {
  const identity = {
    faceIndex: input.faceIndex,
    firstTriangle: input.firstTriangle,
    triangleCount: input.triangleCount,
  };
  if (input.kind === "unsupported")
    return { ...identity, kind: input.kind, surfaceType: input.surfaceType };
  if (input.kind === "plane")
    return {
      ...identity,
      kind: input.kind,
      ...nativeDatumCadPlaneReference(
        input.evaluatedPoint,
        input.derivativeU,
        input.derivativeV,
        referencePoint,
      ),
    };
  return {
    ...identity,
    kind: input.kind,
    ...(input.kind === "cylinder" ? { radiusMm: input.radius } : {}),
    ...nativeDatumCadAxisReference(
      input.kind,
      input.location,
      input.axis,
      input.firstV,
      input.lastV,
      input.radius,
      input.semiAngle,
    ),
  };
}
