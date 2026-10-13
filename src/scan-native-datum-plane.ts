import { nativeDatumPrimaryDirection } from "./scan-native-datum-frame";

export interface NativeDatumPlaneState {
  matrix: number[];
  flags: number;
  stage: number;
  anchor: number[];
  linePoint: number[];
  planePoint: number[];
  lineDirection: number[];
  planeNormal: number[];
  primaryAxis: number;
  secondaryAxis: number;
}

export function createNativeDatumPlaneState(): NativeDatumPlaneState {
  return {
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
    flags: 0,
    stage: -1,
    anchor: [0, 0, 0],
    linePoint: [0, 0, 0],
    planePoint: [0, 0, 0],
    lineDirection: [0, 0, 0],
    planeNormal: [0, 0, 0],
    primaryAxis: -1,
    secondaryAxis: -1,
  };
}

const normalize = (v: number[]) => {
  const length = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (length >= Number.EPSILON) {
    const reciprocal = 1 / length;
    for (let i = 0; i < 3; i++) v[i] *= reciprocal;
  }
  return v;
};
const cross = (a: readonly number[], b: readonly number[]) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const crossLength = (a: readonly number[], b: readonly number[]) => {
  const c = cross(a, b);
  return Math.sqrt(c[1] * c[1] + c[0] * c[0] + c[2] * c[2]);
};
const dot = (a: readonly number[], b: readonly number[]) =>
  a[1] * b[1] + a[0] * b[0] + a[2] * b[2];
const column = (matrix: number[], axis: number) => [
  matrix[axis],
  matrix[axis + 4],
  matrix[axis + 8],
];
const translate = (state: NativeDatumPlaneState, point: number[]) => {
  for (let i = 0; i < 3; i++) state.matrix[i * 4 + 3] = point[i];
};
const projectLine = (
  point: readonly number[],
  origin: number[],
  direction: number[],
) => {
  const distance =
    (point[0] - origin[0]) * direction[0] +
    (point[1] - origin[1]) * direction[1] +
    (point[2] - origin[2]) * direction[2];
  return direction.map((value, i) => value * distance + origin[i]);
};

function intersectLinePlane(
  origin: number[],
  direction: number[],
  point: readonly number[],
  normal: readonly number[],
) {
  const denominator =
    normal[0] * direction[0] +
    normal[1] * direction[1] +
    normal[2] * direction[2];
  if (
    !(
      (direction[1] * direction[1] +
        direction[0] * direction[0] +
        direction[2] * direction[2]) *
        0.0001 <
      denominator * denominator
    )
  )
    return undefined;
  const distance =
    (normal[1] * point[1] +
      normal[0] * point[0] +
      normal[2] * point[2] -
      origin[0] * normal[0] -
      normal[1] * origin[1] -
      normal[2] * origin[2]) /
    denominator;
  return direction.map((value, i) => distance * value + origin[i]);
}

function intersectPlanes(
  oldNormal: number[],
  oldPoint: number[],
  normal: readonly number[],
  point: readonly number[],
) {
  const direction = cross(oldNormal, normal);
  if (
    !(
      0.001 <=
      direction[1] * direction[1] +
        direction[0] * direction[0] +
        direction[2] * direction[2]
    )
  )
    return undefined;
  normalize(direction);
  let axis = 0;
  const largest =
    Math.abs(direction[1]) <= Math.abs(direction[2])
      ? direction[2]
      : direction[1];
  if (Math.abs(direction[0]) < Math.abs(largest))
    axis = (Math.abs(direction[1]) < Math.abs(direction[2]) ? 1 : 0) + 1;
  const first = (axis + 1) % 3,
    second = (axis + 2) % 3;
  const determinant =
    normal[second] * oldNormal[first] - normal[first] * oldNormal[second];
  if (!(2 ** -23 <= Math.abs(determinant))) return undefined;
  const reciprocal = 1 / determinant,
    middle = (oldPoint[axis] + point[axis]) * 0.5;
  const oldDistance =
    oldNormal[second] * oldPoint[second] +
    oldNormal[first] * oldPoint[first] +
    (oldPoint[axis] - middle) * oldNormal[axis];
  const distance =
    normal[first] * point[first] +
    normal[second] * point[second] +
    (point[axis] - middle) * normal[axis];
  const origin = [0, 0, 0];
  origin[axis] = middle;
  origin[first] =
    (oldDistance * normal[second] - distance * oldNormal[second]) * reciprocal;
  origin[second] =
    (distance * oldNormal[first] - oldDistance * normal[first]) * reciprocal;
  return { origin, direction };
}

function secondaryDirection(
  state: NativeDatumPlaneState,
  normal: readonly number[],
  axis: number,
) {
  const before = [...state.matrix],
    primary = column(state.matrix, state.primaryAxis);
  const first = (state.primaryAxis + 1) % 3;
  const other = axis === first ? (state.primaryAxis + 2) % 3 : first;
  const transverse = normalize(
    axis === first ? cross(primary, normal) : cross(normal, primary),
  );
  const projected = normalize(
    axis === first ? cross(transverse, primary) : cross(primary, transverse),
  );
  for (let i = 0; i < 3; i++) {
    state.matrix[axis + i * 4] = projected[i];
    state.matrix[other + i * 4] = transverse[i];
  }
  const m = state.matrix;
  const error =
    (m[5] * m[10] - m[6] * m[9]) * m[0] -
    (m[4] * m[10] - m[8] * m[6]) * m[1] +
    (m[4] * m[9] - m[8] * m[5]) * m[2] -
    1;
  if (Math.abs(error) > 2 ** -23) state.matrix = before;
  return projected;
}

/** Original plane-reference frame construction. Public modeling integration is separate. */
export function nativeDatumPlaneReference(
  input: NativeDatumPlaneState,
  stage: 0 | 1 | 2,
  point: readonly number[],
  normal: readonly number[],
  axis: 0 | 1 | 2,
): { accepted: boolean; state: NativeDatumPlaneState } {
  if (
    point.length !== 3 ||
    normal.length !== 3 ||
    !point.every(Number.isFinite) ||
    !normal.every(Number.isFinite) ||
    ![0, 1, 2].includes(axis) ||
    ![0, 1, 2].includes(stage)
  )
    throw new Error(
      "Datum plane requires finite point and normal vectors, stage and axis 0–2.",
    );
  const state = structuredClone(input);
  if (stage === 0) {
    const fresh = createNativeDatumPlaneState();
    fresh.planePoint = [...point];
    fresh.planeNormal = normalize([...normal]);
    fresh.primaryAxis = axis;
    translate(fresh, [...point]);
    fresh.matrix = nativeDatumPrimaryDirection(
      fresh.matrix,
      fresh.planeNormal,
      axis,
    );
    fresh.flags = 4;
    fresh.stage = 0;
    return { accepted: true, state: fresh };
  }
  if (stage === 1) {
    if (state.stage < 0) return { accepted: false, state };
    if (state.primaryAxis === axis && state.flags & 4)
      return { accepted: false, state };
    if (state.primaryAxis === axis && state.flags & 2) {
      if (!(0.9962 < Math.abs(dot(state.lineDirection, normal))))
        return { accepted: false, state };
    } else if (state.flags & 6) {
      if (
        !(
          0.0872 <
          crossLength(
            normal,
            state.flags & 4 ? state.planeNormal : state.lineDirection,
          )
        )
      )
        return { accepted: false, state };
    }
    state.secondaryAxis = -1;
    if (state.primaryAxis === axis) {
      state.anchor = intersectLinePlane(
        state.linePoint,
        state.lineDirection,
        point,
        normal,
      ) ?? [0, 0, 0];
      translate(state, state.anchor);
      state.flags |= 8;
    } else if (state.flags & 1) {
      state.planePoint = [...point];
      state.planeNormal = normalize([...normal]);
      state.matrix = nativeDatumPrimaryDirection(
        state.matrix,
        state.planeNormal,
        axis,
      );
      state.flags |= 32;
      state.primaryAxis = axis;
    } else if (!(state.flags & 2)) {
      const intersection = intersectPlanes(
        state.planeNormal,
        state.planePoint,
        normal,
        point,
      );
      if (intersection) state.lineDirection = intersection.direction;
      state.linePoint = projectLine(
        state.planePoint,
        intersection?.origin ?? [0, 0, 0],
        state.lineDirection,
      );
      translate(state, state.linePoint);
      secondaryDirection(state, normal, axis);
      state.secondaryAxis = (state.primaryAxis + 1) % 3;
      if (axis === state.secondaryAxis)
        state.secondaryAxis = (state.primaryAxis + 2) % 3;
      state.lineDirection = column(state.matrix, state.secondaryAxis);
      state.flags |= 16;
    } else {
      const origin =
        intersectLinePlane(
          state.linePoint,
          state.lineDirection,
          point,
          normal,
        ) ?? projectLine(point, state.linePoint, state.lineDirection);
      state.planePoint = origin;
      state.planeNormal = secondaryDirection(state, normal, axis);
      translate(state, origin);
      state.flags |= 32;
      state.secondaryAxis = axis;
    }
    state.stage = 1;
    return { accepted: true, state };
  }
  if (!(state.stage > 0)) return { accepted: false, state };
  const bothAxes = state.primaryAxis >= 0 && state.secondaryAxis >= 0;
  if (bothAxes) {
    if (
      Math.abs(dot(state.lineDirection, normal)) <= 0.9962 &&
      Math.abs(crossLength(normal, state.planeNormal)) <= 0.0872
    )
      return { accepted: false, state };
  } else if (
    state.primaryAxis === axis ||
    !(
      0.0872 <
      crossLength(
        normal,
        state.flags & 0x24 ? state.planeNormal : state.lineDirection,
      )
    )
  ) {
    return { accepted: false, state };
  }
  if (bothAxes) {
    let anchor = intersectLinePlane(
      state.linePoint,
      state.lineDirection,
      point,
      normal,
    ) ?? [0, 0, 0];
    if (state.flags & 4) {
      const distance =
        (anchor[1] - state.planePoint[1]) * state.planeNormal[1] +
        (anchor[0] - state.planePoint[0]) * state.planeNormal[0] +
        (anchor[2] - state.planePoint[2]) * state.planeNormal[2];
      anchor = anchor.map(
        (value, i) => value - state.planeNormal[i] * distance,
      );
    }
    state.anchor = anchor;
    translate(state, anchor);
    state.flags |= 64;
  } else if (!(state.flags & 0x12)) {
    const intersection = intersectPlanes(
      state.planeNormal,
      state.planePoint,
      normal,
      point,
    );
    if (intersection) state.lineDirection = intersection.direction;
    const origin = intersection?.origin ?? [0, 0, 0];
    const distance =
      (state.planePoint[1] - origin[1]) * state.lineDirection[1] +
      (state.planePoint[0] - origin[0]) * state.lineDirection[0] +
      (state.planePoint[2] - origin[2]) * state.lineDirection[2];
    state.linePoint = state.lineDirection.map(
      (value, i) => value * distance + origin[i],
    );
    secondaryDirection(state, normal, axis);
    state.secondaryAxis = (state.primaryAxis + 1) % 3;
    if (axis === state.secondaryAxis)
      state.secondaryAxis = (state.primaryAxis + 2) % 3;
    state.lineDirection = column(state.matrix, state.secondaryAxis);
    state.flags |= 128;
  } else {
    const origin =
      intersectLinePlane(state.linePoint, state.lineDirection, point, normal) ??
      (() => {
        const distance =
          (point[1] - state.linePoint[1]) * state.lineDirection[1] +
          (point[0] - state.linePoint[0]) * state.lineDirection[0] +
          (point[2] - state.linePoint[2]) * state.lineDirection[2];
        return state.lineDirection.map(
          (value, i) => value * distance + state.linePoint[i],
        );
      })();
    state.planePoint = origin;
    state.planeNormal = secondaryDirection(state, normal, axis);
    state.flags |= 256;
    state.secondaryAxis = axis;
  }
  state.stage = 2;
  return { accepted: true, state };
}
