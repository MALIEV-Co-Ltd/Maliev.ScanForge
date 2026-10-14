import type { NativeDatumPlaneState } from "./scan-native-datum-plane";

const dot = (a: readonly number[], b: readonly number[]) =>
  a[1] * b[1] + a[0] * b[0] + a[2] * b[2];
const crossLength = (a: readonly number[], b: readonly number[]) => {
  const x = a[1] * b[2] - a[2] * b[1];
  const y = a[2] * b[0] - a[0] * b[2];
  const z = a[0] * b[1] - a[1] * b[0];
  return Math.sqrt(y * y + x * x + z * z);
};

/** Original 541770 radio eligibility after resolving a reference payload.
 * Plane radio order is Z/X/Y; direction order is X/Y/Z. This does not
 * construct a frame or fit a reference to scan geometry.
 */
export function nativeDatumReferenceOptions(
  state: NativeDatumPlaneState,
  stage: 0 | 1 | 2,
  kind: "plane" | "direction" | "point" | "unsupported",
  point: readonly number[],
  direction: readonly number[] = [0, 0, 0],
  flip = false,
  currentCode = 0,
) {
  if (
    ![0, 1, 2].includes(stage) ||
    point.length !== 3 ||
    direction.length !== 3 ||
    ![...point, ...direction].every(Number.isFinite)
  )
    throw new Error(
      "Reference options require finite XYZ vectors and stage 0–2.",
    );
  const axes = kind === "plane" ? [2, 0, 1] : [0, 1, 2];
  const normal = direction.map((value) => (flip ? -value : value));
  const visible = kind === "plane" || kind === "direction";
  let enabled = [true, true, true];
  let selectionCode = kind === "point" || stage === 0 ? 0 : currentCode;
  if (visible) {
    if (stage === 0) selectionCode = kind === "plane" ? 0 : 2;
    else
      enabled = axes.map((axis) => {
        if (stage === 1) {
          if (state.stage < 0) return false;
          if (state.primaryAxis === axis) {
            if (state.flags & (kind === "plane" ? 4 : 2)) return false;
            if (state.flags & (kind === "plane" ? 2 : 4))
              return (
                Math.abs(
                  dot(
                    kind === "plane" ? state.lineDirection : state.planeNormal,
                    normal,
                  ),
                ) > 0.9962
              );
          }
          if (!(state.flags & 6)) return true;
          return (
            crossLength(
              normal,
              state.flags & 4 ? state.planeNormal : state.lineDirection,
            ) > 0.0872
          );
        }
        if (state.stage <= 0) return false;
        if (state.primaryAxis >= 0 && state.secondaryAxis >= 0)
          return kind === "plane"
            ? Math.abs(dot(state.lineDirection, normal)) > 0.9962 ||
                crossLength(normal, state.planeNormal) > 0.0872
            : crossLength(normal, state.lineDirection) > 0.0872 ||
                Math.abs(dot(state.planeNormal, normal)) > 0.9962;
        return (
          state.primaryAxis !== axis &&
          crossLength(
            normal,
            state.flags & 0x24 ? state.planeNormal : state.lineDirection,
          ) > 0.0872
        );
      });
    // 3A2640 is a predicate, distinct from the mutating direction constructor.
    if (stage === 2 && kind === "direction" && !enabled.some(Boolean)) {
      const denominator = dot(state.planeNormal, normal);
      const intersects =
        dot(normal, normal) * 0.0001 < denominator * denominator;
      const delta = point.map((value, i) => value - state.anchor[i]);
      enabled = axes.map(
        (axis) =>
          state.stage > 0 &&
          !(state.primaryAxis >= 0 && state.secondaryAxis >= 0) &&
          state.primaryAxis !== axis &&
          !!(state.flags & 0x24) &&
          intersects &&
          Math.sqrt(dot(delta, delta)) > 1,
      );
    }
    const priority = stage === 1 ? [0, 2, 1] : [0, 1, 2];
    if (stage > 0)
      selectionCode = priority.find((code) => enabled[code]) ?? currentCode;
  }
  return {
    recognized: kind !== "unsupported",
    enabled,
    visible: [visible, visible, visible],
    selectionCode,
    axis: axes[selectionCode] as 0 | 1 | 2,
    enabledAxes: [0, 1, 2].map((axis) => enabled[axes.indexOf(axis)]),
  };
}
