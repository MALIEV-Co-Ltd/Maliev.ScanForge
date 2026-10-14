import {
  nativeDatumPlaneReference,
  nativeDatumDirectionReference,
  nativeDatumPointReference,
  type NativeDatumPlaneState,
} from "./scan-native-datum-plane";

export type NativeDatumOriginReference =
  "XY" | "YZ" | "XZ" | "X" | "Y" | "Z" | "origin";

/** Origin payloads use world coordinates; target axes remain explicit. */
export function nativeDatumOriginPayload(
  reference: NativeDatumOriginReference,
): {
  kind: "plane" | "direction" | "point";
  point: number[];
  direction?: number[];
} {
  const planes: Record<string, number> = { XY: 2, YZ: 0, XZ: 1 };
  const axes: Record<string, number> = { X: 0, Y: 1, Z: 2 };
  if (reference === "origin") return { kind: "point", point: [0, 0, 0] };
  const plane = Object.hasOwn(planes, reference);
  if (!plane && !Object.hasOwn(axes, reference))
    throw new Error("Unsupported origin reference.");
  const direction = [0, 0, 0];
  direction[(plane ? planes : axes)[reference]] = 1;
  return { kind: plane ? "plane" : "direction", point: [0, 0, 0], direction };
}

/** Complete numerical dispatch for the native dialog's origin references. */
export function nativeDatumOriginReference(
  state: NativeDatumPlaneState,
  stage: 0 | 1 | 2,
  reference: NativeDatumOriginReference,
  assignment: 0 | 1 | 2,
  flip = false,
) {
  if (
    ![0, 1, 2].includes(stage) ||
    ![0, 1, 2].includes(assignment) ||
    typeof flip !== "boolean"
  )
    throw new Error(
      "Origin reference requires stage and assignment 0–2 and a boolean flip.",
    );
  const point = [0, 0, 0];
  if (reference === "origin")
    return nativeDatumPointReference(state, stage, point);
  const planeAxes: Record<string, 0 | 1 | 2> = { XY: 2, YZ: 0, XZ: 1 };
  const lineAxes: Record<string, 0 | 1 | 2> = { X: 0, Y: 1, Z: 2 };
  const plane = Object.hasOwn(planeAxes, reference);
  if (!plane && !Object.hasOwn(lineAxes, reference))
    throw new Error("Unsupported origin reference.");
  const direction = [0, 0, 0];
  direction[(plane ? planeAxes : lineAxes)[reference]] = 1;
  // Direct native execution preserves the stage and flips signed zero too.
  const normal = flip ? direction.map((value) => -value) : direction;
  const nextStage = stage;
  return plane
    ? nativeDatumPlaneReference(
        state,
        nextStage,
        point,
        normal,
        ([2, 0, 1] as const)[assignment],
      )
    : nativeDatumDirectionReference(
        state,
        nextStage,
        point,
        normal,
        assignment,
      );
}
