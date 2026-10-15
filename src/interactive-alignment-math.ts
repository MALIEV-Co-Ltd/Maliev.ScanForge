import { nativeDatumInverseFrame } from "./scan-native-datum-apply";
import { nativeRotateAlignmentFrame } from "./scan-native-alignment-transform";
import { composeCloudPose as composeNativePose } from "./point-cloud-placement";

/** Original callback composition from its view-interface getters; getter semantics are separate. */
export function nativeInteractiveCurrentView(
  matrix: readonly number[],
  point: readonly number[],
) {
  if (
    point.length !== 3 ||
    !point.every((value) => Number.isFinite(Math.fround(value)))
  )
    throw new Error(
      "Current-view alignment requires a finite Float32 view point.",
    );
  return composeNativePose(matrix, [
    1,
    0,
    0,
    -Math.fround(point[0]),
    0,
    1,
    0,
    -Math.fround(point[1]),
    0,
    0,
    1,
    -Math.fround(point[2]),
  ]);
}

export interface InteractiveDragInput {
  mode: number;
  frame: readonly number[];
  original: readonly number[];
  delta: readonly number[];
  previousScreen: readonly number[];
  screen: readonly number[];
  pivotScreen: readonly number[];
  viewSize: number;
  view?: readonly number[];
}
const f = Math.fround;
/** Original 20FC50: Float32 length, Double reciprocal/product, Float32 stores. */
export function nativeInteractiveNormalizeMovement(
  values: readonly number[],
): number[] {
  if (
    values.length !== 3 ||
    !values.every((value) => Number.isFinite(f(value)))
  )
    throw new Error(
      "Interactive movement requires three finite Float32 values.",
    );
  const [x, y, z] = values.map(f);
  const length = f(Math.sqrt(f(f(f(x * x) + f(y * y)) + f(z * z))));
  if (length >= Number.EPSILON) {
    const reciprocal = 1 / length;
    return [f(x * reciprocal), f(y * reciprocal), f(z * reciprocal)];
  }
  return [x, y, z];
}
/** Original 69E220 before the manipulator call. Pixel-to-plane conversion belongs to the renderer. */
export function nativeInteractiveMovement(input: {
  mode: number;
  strength: number;
  previousPixel: readonly number[];
  currentPixel: readonly number[];
  waiting: boolean;
  previousPlane?: readonly number[];
  currentPlane?: readonly number[];
  view: readonly number[];
}): { waiting: boolean; movement: number[] | null } {
  for (const point of [input.previousPixel, input.currentPixel])
    if (
      point.length !== 2 ||
      point.some(
        (v) => !Number.isInteger(v) || v < -2147483648 || v > 2147483647,
      )
    )
      throw new Error(
        "Interactive pointer coordinates must be signed integer pixels.",
      );
  if (
    !Number.isInteger(input.mode) ||
    !Number.isInteger(input.strength) ||
    input.strength < 0 ||
    input.strength > 100 ||
    typeof input.waiting !== "boolean"
  )
    throw new Error(
      "Interactive movement requires an integer handle and drag strength from zero to 100.",
    );
  const waiting =
    input.waiting &&
    ![0, 1].some(
      (a) => Math.abs((input.previousPixel[a] - input.currentPixel[a]) | 0) > 7,
    );
  if (waiting || input.mode < 1 || input.mode > 15)
    return { waiting, movement: null };
  const { previousPlane: previous, currentPlane: current, view } = input;
  if (
    !previous ||
    !current ||
    previous.length !== 2 ||
    current.length !== 2 ||
    ![...previous, ...current].every((v) => Number.isFinite(f(v))) ||
    view.length !== 12 ||
    !view.every(Number.isFinite)
  )
    throw new Error(
      "Interactive movement requires finite renderer plane coordinates and a view frame.",
    );
  const x = f(f(current[0]) - f(previous[0])) - 0,
    y = f(f(current[1]) - f(previous[1])) - 0;
  let movement = [
    f(y * view[4] + x * view[0] + view[8] * 0),
    f(y * view[5] + x * view[1] + view[9] * 0),
    f(y * view[6] + x * view[2] + view[10] * 0),
  ];
  if (input.mode > 6) movement = nativeInteractiveNormalizeMovement(movement);
  const strength = f(f(input.strength) / 100);
  return { waiting: false, movement: movement.map((v) => f(v * strength)) };
}
function screenDirection(x: number, y: number, z: number) {
  const length = f(Math.sqrt(f(f(f(y * y) + f(x * x)) + f(z * z))));
  if (length >= Number.EPSILON) {
    const reciprocal = f(1 / length);
    return [f(x * reciprocal), f(y * reciprocal), f(z * reciprocal)];
  }
  return [x, y, z];
}

/** Recovered shared manipulator update; camera projection and controller gates are external. */
export function nativeInteractiveDrag(input: InteractiveDragInput) {
  for (const [values, count] of [
    [input.frame, 12],
    [input.original, 12],
    [input.delta, 3],
    [input.previousScreen, 3],
    [input.screen, 2],
    [input.pivotScreen, 3],
  ] as const)
    if (values.length !== count || !values.every(Number.isFinite))
      throw new Error(
        "Interactive drag requires finite frames, movement and screen points.",
      );
  if (!Number.isInteger(input.mode) || !Number.isFinite(input.viewSize))
    throw new Error(
      "Interactive drag requires a finite view size and integer handle.",
    );
  const frame = Array.from(input.frame),
    matrix = Array.from(input.original);
  const movement = input.delta.map(f);
  const [mx, my, mz] = movement;
  const x = mx - frame[3],
    y = my - frame[7],
    z = mz - frame[11];
  const local = [
    frame[4] * y + frame[0] * x + frame[8] * z,
    frame[5] * y + frame[1] * x + frame[9] * z,
    frame[6] * y + frame[2] * x + frame[10] * z,
  ];
  const length = Math.sqrt(
    local[0] * local[0] + local[1] * local[1] + local[2] * local[2],
  );
  const direction = Array.from(local);
  if (length >= Number.EPSILON) {
    const reciprocal = 1 / length;
    for (let i = 0; i < 3; i++) direction[i] *= reciprocal;
  }
  const projected = direction.map((value) => value * length);
  const threshold = Math.cos(1.3962634015954636);
  const axisDistance = (axis: number) =>
    Math.abs(direction[axis]) <= threshold ? 0 : length / direction[axis];
  const mode = input.mode;
  if (mode >= 1 && mode <= 6) {
    const [px, py, pz] = projected;
    const axis = mode >= 4 ? axisDistance(mode - 4) : 0;
    for (let r = 0; r < 3; r++) {
      const i = r * 4;
      let translation: number;
      switch (mode) {
        case 1:
          translation = py * frame[i + 1] + frame[i] * 0 + pz * frame[i + 2];
          break;
        case 2:
          translation = px * frame[i] + frame[i + 1] * 0 + pz * frame[i + 2];
          break;
        case 3:
          translation = py * frame[i + 1] + px * frame[i] + frame[i + 2] * 0;
          break;
        case 4:
          translation = axis * frame[i] + frame[i + 1] * 0 + frame[i + 2] * 0;
          break;
        case 5:
          translation = axis * frame[i + 1] + frame[i] * 0 + frame[i + 2] * 0;
          break;
        default:
          translation = frame[i + 1] * 0 + frame[i] * 0 + axis * frame[i + 2];
      }
      matrix[i + 3] = translation + frame[i + 3] + matrix[i + 3];
    }
    return { accepted: true, matrix, frame };
  }
  if (mode >= 10 && mode <= 12) {
    const view = input.view ?? [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
    if (view.length !== 12 || !view.every(Number.isFinite))
      throw new Error("Interactive drag requires a finite view frame.");
    const previous = screenDirection(
      ...(input.previousScreen.map((value, i) =>
        f(f(value) - f(input.pivotScreen[i])),
      ) as [number, number, number]),
    );
    const current = screenDirection(
      f(f(input.screen[0]) - f(input.pivotScreen[0])),
      f(f(input.screen[1]) - f(input.pivotScreen[1])),
      f(0 - f(input.pivotScreen[2])),
    );
    const [a, b, c] = previous,
      [d, e, g] = current;
    const cross = [g * b - e * c, d * c - a * g, a * e - d * b];
    let sine = Math.sqrt(
      cross[0] * cross[0] + cross[1] * cross[1] + cross[2] * cross[2],
    );
    const column = mode - 10;
    const projectedAxis = [0, 1, 2].map(
      (row) =>
        view[row * 4] * frame[column] +
        view[row * 4 + 1] * frame[4 + column] +
        view[row * 4 + 2] * frame[8 + column] +
        0,
    );
    // The provider pseudocode omits this COMISD/XORPS sign selection.
    if (
      projectedAxis[1] * cross[1] +
        projectedAxis[0] * cross[0] +
        projectedAxis[2] * cross[2] <
      0
    )
      sine = -sine;
    const angle =
      Math.atan2(sine, e * b + d * a + g * c) *
      (Math.sqrt(my * my + mx * mx + mz * mz) * 0.5 * 0.4);
    const rotate = (m: readonly number[]) =>
      nativeRotateAlignmentFrame(m, angle, [
        m[column],
        m[4 + column],
        m[8 + column],
      ]);
    return {
      accepted: true,
      matrix: rotate([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]),
      frame: rotate(frame),
    };
  }
  if (mode >= 13 && mode <= 15) {
    const size = f(f(input.viewSize) / 3),
      axis = mode - 13;
    const result = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
    result[axis * 5] =
      Math.abs(size) > 2 ** -23 ? (size + axisDistance(axis)) / size : 0;
    return { accepted: true, matrix: result, frame };
  }
  return { accepted: false, matrix, frame };
}

/** Original renderer 8A9AC0 + 8A9740 for the two As Current View reset paths. */
export function nativeInteractiveResetView(alternateUpAxis: boolean): number[] {
  const base = alternateUpAxis
    ? [1, 0, -0, 0, 0, 0, -1, 0, 0, 1, -0, 0]
    : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  let frame = nativeDatumInverseFrame(base);
  if (alternateUpAxis)
    frame = nativeRotateAlignmentFrame(frame, Math.fround(Math.PI / 2), [
      frame[0],
      frame[4],
      frame[8],
    ]);
  frame = nativeDatumInverseFrame(frame);
  frame[3] = frame[7] = frame[11] = 0;
  return frame;
}

/** Four original step callbacks; unlike gizmo rotations these act about world origin. */
export function nativeInteractiveStep(
  kind:
    | "rotatePositive"
    | "rotateNegative"
    | "translatePositive"
    | "translateNegative",
  axis: number,
  value: number,
  unitScale = 1,
): number[] {
  if (
    ![
      "rotatePositive",
      "rotateNegative",
      "translatePositive",
      "translateNegative",
    ].includes(kind) ||
    !Number.isInteger(axis) ||
    !Number.isFinite(Math.fround(value)) ||
    !Number.isFinite(unitScale) ||
    !Number.isFinite(Math.fround(Math.fround(value) * unitScale))
  )
    throw new Error(
      "Interactive step requires a supported control and finite Float32 values.",
    );
  const m = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0];
  const sign = kind.endsWith("Negative") ? -1 : 1;
  const step = sign * Math.abs(Math.fround(value));
  if (kind.startsWith("translate")) {
    const value = Math.fround(step * unitScale);
    if (axis >= 0 && axis <= 2) {
      const p = [0, 0, 0];
      p[axis] = value;
      for (let r = 0; r < 3; r++)
        m[r * 4 + 3] +=
          m[r * 4] * p[0] + m[r * 4 + 1] * p[1] + m[r * 4 + 2] * p[2];
    }
    return m;
  }
  const angle = step * 0.017453292519943295;
  const cosine = Math.cos(angle),
    sine = Math.sin(angle);
  if (axis === 0) {
    const b = m[1],
      f = m[6],
      k = m[10];
    m[1] = b * cosine + m[2] * sine;
    m[6] = f * cosine - m[5] * sine;
    m[5] = m[5] * cosine + f * sine;
    m[10] = k * cosine - m[9] * sine;
    m[2] = m[2] * cosine - b * sine;
    m[9] = m[9] * cosine + k * sine;
  } else if (axis === 1) {
    const f = m[6],
      k = m[10],
      a = m[0];
    m[6] = f * cosine + m[4] * sine;
    m[0] = a * cosine - m[2] * sine;
    m[10] = k * cosine + m[8] * sine;
    m[4] = m[4] * cosine - f * sine;
    m[2] = a * sine + m[2] * cosine;
    m[8] = m[8] * cosine - k * sine;
  } else if (axis === 2 && Math.abs(angle) >= 1e-5) {
    const f = m[5],
      j = m[9],
      a = m[0];
    m[5] = f * cosine - m[4] * sine;
    m[9] = j * cosine - m[8] * sine;
    m[8] = m[8] * cosine + j * sine;
    m[0] = a * cosine + m[1] * sine;
    m[4] = m[4] * cosine + f * sine;
    m[1] = m[1] * cosine - a * sine;
  }
  return m;
}
