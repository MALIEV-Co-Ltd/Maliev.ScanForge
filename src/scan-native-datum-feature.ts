import { nativeDatumPlaneGeometry } from "./scan-native-datum-apply";
import type { FitResult } from "./types";

export type NativeDatumAxisPlacement =
  "segmentMidpoint" | "extrusionMidpoint" | "origin";

function finiteVector(values: readonly number[]) {
  if (values.length !== 3 || !values.every(Number.isFinite))
    throw new Error("Datum feature requires a finite XYZ vector.");
}

/** Original fitted-feature axis conversion; picking resolves its payload layout separately. */
export function nativeDatumAxisGeometry(
  origin: readonly number[],
  direction: readonly number[],
  length: number,
  placement: NativeDatumAxisPlacement,
): { point: number[]; direction: number[] } {
  finiteVector(origin);
  finiteVector(direction);
  if (
    !Number.isFinite(length) ||
    !["segmentMidpoint", "extrusionMidpoint", "origin"].includes(placement)
  )
    throw new Error(
      "Datum axis requires a finite length and supported placement.",
    );
  const point =
    placement === "segmentMidpoint"
      ? origin.map((value, i) => (length * direction[i] + value + value) * 0.5)
      : placement === "extrusionMidpoint"
        ? origin.map((value, i) => length * direction[i] * 0.5 + value)
        : [...origin];
  return { point, direction: [...direction] };
}

/** Supported native point payloads copy their stored XYZ coordinates unchanged. */
export function nativeDatumPointGeometry(origin: readonly number[]): number[] {
  finiteVector(origin);
  return [...origin];
}

export interface NativeDatumFeatureGeometry {
  kind:
    | "plane"
    | "cylinder"
    | "cone"
    | "referenceLine"
    | "sphere"
    | "referencePoint";
  origin: readonly number[];
  direction?: readonly number[];
  length?: number;
  equationOffset?: number;
}

/** Convert application fit conventions into the native reference payload convention. */
export function nativeDatumFitFeature(
  fit: FitResult,
  nativeConeOrigin?: readonly number[],
): NativeDatumFeatureGeometry {
  finiteVector(fit.center);
  if (!["plane", "cylinder", "cone", "sphere"].includes(fit.kind))
    throw new Error("Unsupported fitted primitive kind.");
  if (fit.kind === "sphere") return { kind: "sphere", origin: [...fit.center] };
  finiteVector(fit.axis);
  if (!(Math.hypot(...fit.axis) > 0))
    throw new Error("The fitted primitive has a zero reference axis.");
  if (fit.kind === "cylinder") {
    if (
      fit.height === undefined ||
      !Number.isFinite(fit.height) ||
      fit.height < 0
    )
      throw new Error(
        "A fitted cylinder requires a finite nonnegative height.",
      );
    return {
      kind: "cylinder",
      origin: fit.center.map(
        (value, i) => value - fit.axis[i] * fit.height! * 0.5,
      ),
      direction: [...fit.axis],
      length: fit.height,
    };
  }
  if (fit.kind === "plane") {
    const offset = -(
      fit.axis[0] * fit.center[0] +
      fit.axis[1] * fit.center[1] +
      fit.axis[2] * fit.center[2]
    );
    if (!Number.isFinite(offset))
      throw new Error("The fitted plane equation exceeds numerical precision.");
    return {
      kind: "plane",
      origin: [...fit.center],
      direction: [...fit.axis],
      equationOffset: offset,
    };
  }
  // The application stores a cone base center; do not guess the native cone anchor.
  if (!nativeConeOrigin)
    throw new Error(
      "Cone reference requires its verified native origin metadata.",
    );
  finiteVector(nativeConeOrigin);
  return {
    kind: "cone",
    origin: [...nativeConeOrigin],
    direction: [...fit.axis],
  };
}

/** RTTI-linked fitted scene classes; CAD-backed adapters are a separate boundary. */
export function nativeDatumPickedFeature(
  feature: NativeDatumFeatureGeometry,
  reference: "plane" | "direction" | "point",
  referencePoint?: readonly number[],
): { point: number[]; direction?: number[] } | undefined {
  finiteVector(feature.origin);
  if (
    ![
      "plane",
      "cylinder",
      "cone",
      "referenceLine",
      "sphere",
      "referencePoint",
    ].includes(feature.kind) ||
    !["plane", "direction", "point"].includes(reference)
  )
    throw new Error("Unsupported fitted feature or reference kind.");
  if (reference === "point") {
    return ["cone", "sphere", "referencePoint"].includes(feature.kind)
      ? { point: nativeDatumPointGeometry(feature.origin) }
      : undefined;
  }
  const supported =
    reference === "plane"
      ? feature.kind === "plane"
      : ["cylinder", "cone", "referenceLine"].includes(feature.kind);
  if (!supported) return undefined;
  if (!feature.direction)
    throw new Error("The fitted feature has no reference direction.");
  if (reference === "plane") {
    const plane = nativeDatumPlaneGeometry(
      feature.origin,
      feature.direction,
      feature.equationOffset ?? 0,
      referencePoint,
    );
    return { point: plane.point, direction: plane.normal };
  }
  return nativeDatumAxisGeometry(
    feature.origin,
    feature.direction,
    feature.length ?? 0,
    feature.kind === "referenceLine"
      ? "segmentMidpoint"
      : feature.kind === "cylinder"
        ? "extrusionMidpoint"
        : "origin",
  );
}
