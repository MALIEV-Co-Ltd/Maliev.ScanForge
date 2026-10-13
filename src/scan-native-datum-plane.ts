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

/** Native point-reference constructor, including constrained anchor projection. */
export function nativeDatumPointReference(
  input: NativeDatumPlaneState,
  stage: 0 | 1 | 2,
  point: readonly number[],
): { accepted: boolean; state: NativeDatumPlaneState } {
  if (
    point.length !== 3 ||
    !point.every(Number.isFinite) ||
    ![0, 1, 2].includes(stage)
  )
    throw new Error(
      "Datum point requires a finite point vector and stage 0–2.",
    );
  const state =
    stage === 0 ? createNativeDatumPlaneState() : structuredClone(input);
  if (stage === 0) {
    state.anchor = [...point];
    translate(state, state.anchor);
    state.flags = 1;
    state.stage = 0;
    return { accepted: true, state };
  }
  const projectPlane = () => {
    const distance =
      (point[1] - state.planePoint[1]) * state.planeNormal[1] +
      (point[0] - state.planePoint[0]) * state.planeNormal[0] +
      (point[2] - state.planePoint[2]) * state.planeNormal[2];
    return point.map((value, i) => value - state.planeNormal[i] * distance);
  };
  if (stage === 1) {
    if (state.stage < 0 || state.flags & 1) return { accepted: false, state };
    state.anchor =
      state.flags & 4
        ? projectPlane()
        : projectLine(point, state.linePoint, state.lineDirection);
    state.flags |= 8;
  } else {
    if (state.stage <= 0 || state.flags & 9) return { accepted: false, state };
    state.anchor = projectLine(
      projectPlane(),
      state.linePoint,
      state.lineDirection,
    );
    state.flags |= 64;
  }
  translate(state, state.anchor);
  state.stage = stage;
  return { accepted: true, state };
}

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

function closestLines(
  a: number[],
  u: number[],
  b: readonly number[],
  v: readonly number[],
) {
  const uv = v[0] * u[0] + v[1] * u[1] + v[2] * u[2];
  const uu = u[0] * u[0] + u[1] * u[1] + u[2] * u[2];
  const vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
  const determinant = vv * uu - uv * uv;
  if (!(2 ** -23 < Math.abs(determinant))) return undefined;
  const dy = b[1] - a[1],
    dz = b[2] - a[2];
  const alongV = (b[0] - a[0]) * v[0] + dy * v[1] + dz * v[2];
  const alongU = (b[0] - a[0]) * u[0] + dy * u[1] + dz * u[2];
  const reciprocal = 1 / determinant;
  const t = (alongU * vv - alongV * uv) * reciprocal;
  return u.map((value, i) => value * t + a[i]);
}

/** Native direction-reference construction and tertiary fallback. */
export function nativeDatumDirectionReference(
  input: NativeDatumPlaneState,
  stage: 0 | 1 | 2,
  point: readonly number[],
  direction: readonly number[],
  axis: 0 | 1 | 2,
): { accepted: boolean; state: NativeDatumPlaneState } {
  if (
    point.length !== 3 ||
    direction.length !== 3 ||
    !point.every(Number.isFinite) ||
    !direction.every(Number.isFinite) ||
    ![0, 1, 2].includes(stage) ||
    ![0, 1, 2].includes(axis)
  )
    throw new Error(
      "Datum direction requires finite point and direction vectors, stage and axis 0–2.",
    );
  const state =
    stage === 0 ? createNativeDatumPlaneState() : structuredClone(input);
  const remainingAxis = () => {
    const first = (state.primaryAxis + 1) % 3;
    return axis === first ? (state.primaryAxis + 2) % 3 : first;
  };
  const projectPlane = () => {
    const distance =
      (point[1] - state.planePoint[1]) * state.planeNormal[1] +
      (point[0] - state.planePoint[0]) * state.planeNormal[0] +
      (point[2] - state.planePoint[2]) * state.planeNormal[2];
    return point.map((value, i) => value - state.planeNormal[i] * distance);
  };
  const intersection = () =>
    intersectLinePlane(
      [...point],
      [...direction],
      state.planePoint,
      state.planeNormal,
    );
  if (stage === 0) {
    state.linePoint = [...point];
    state.lineDirection = normalize([...direction]);
    state.primaryAxis = axis;
    translate(state, [...point]);
    state.matrix = nativeDatumPrimaryDirection(
      state.matrix,
      state.lineDirection,
      axis,
    );
    state.flags = 2;
    state.stage = 0;
    return { accepted: true, state };
  }
  if (stage === 1) {
    if (state.stage < 0) return { accepted: false, state };
    if (state.primaryAxis === axis && state.flags & 2)
      return { accepted: false, state };
    if (state.primaryAxis === axis && state.flags & 4) {
      if (!(0.9962 < Math.abs(dot(state.planeNormal, direction))))
        return { accepted: false, state };
    } else if (state.flags & 6) {
      if (
        !(
          0.0872 <
          crossLength(
            direction,
            state.flags & 4 ? state.planeNormal : state.lineDirection,
          )
        )
      )
        return { accepted: false, state };
    }
    state.secondaryAxis = -1;
    if (state.primaryAxis === axis) {
      state.anchor = intersection() ?? [0, 0, 0];
      translate(state, state.anchor);
      state.flags |= 8;
    } else if (state.flags & 1) {
      state.linePoint = [...point];
      state.lineDirection = normalize([...direction]);
      state.matrix = nativeDatumPrimaryDirection(
        state.matrix,
        state.lineDirection,
        axis,
      );
      state.flags |= 16;
      state.primaryAxis = axis;
    } else if (!(state.flags & 2)) {
      const hit = intersection();
      if (hit) {
        state.linePoint = hit;
        state.lineDirection = secondaryDirection(state, direction, axis);
      } else {
        const projected = projectPlane();
        state.lineDirection = secondaryDirection(state, direction, axis);
        const distance =
          (state.planePoint[1] - projected[1]) * state.lineDirection[1] +
          (state.planePoint[0] - projected[0]) * state.lineDirection[0] +
          (state.planePoint[2] - projected[2]) * state.lineDirection[2];
        state.linePoint = state.lineDirection.map(
          (value, i) => value * distance + projected[i],
        );
      }
      translate(state, state.linePoint);
      state.flags |= 16;
      state.secondaryAxis = axis;
    } else {
      state.planePoint = closestLines(
        state.linePoint,
        state.lineDirection,
        point,
        direction,
      ) ?? [0, 0, 0];
      translate(state, state.planePoint);
      secondaryDirection(state, direction, axis);
      state.secondaryAxis = remainingAxis();
      state.planeNormal = column(state.matrix, state.secondaryAxis);
      state.flags |= 32;
    }
    state.stage = 1;
    return { accepted: true, state };
  }
  const bothAxes = state.primaryAxis >= 0 && state.secondaryAxis >= 0;
  const accepted =
    state.stage > 0 &&
    (bothAxes
      ? 0.0872 < crossLength(direction, state.lineDirection) ||
        0.9962 < Math.abs(dot(state.planeNormal, direction))
      : state.primaryAxis !== axis &&
        0.0872 <
          crossLength(
            direction,
            state.flags & 0x24 ? state.planeNormal : state.lineDirection,
          ));
  if (!accepted) {
    const hit =
      state.stage > 0 &&
      !bothAxes &&
      state.primaryAxis !== axis &&
      state.flags & 0x24
        ? intersection()
        : undefined;
    if (!hit) return { accepted: false, state };
    const dx = point[0] - state.anchor[0],
      dy = point[1] - state.anchor[1],
      dz = point[2] - state.anchor[2];
    if (!(1 < Math.sqrt(dx * dx + dy * dy + dz * dz)))
      return { accepted: false, state };
    if (state.flags & 4) {
      const normal = normalize(hit.map((value, i) => value - state.anchor[i]));
      secondaryDirection(state, normal, axis);
      state.flags |= 128;
      state.stage = 2;
    }
    return { accepted: true, state };
  }
  if (!bothAxes) {
    if (!(state.flags & 2)) {
      const hit = intersection();
      if (hit) state.linePoint = hit;
      state.lineDirection = secondaryDirection(state, direction, axis);
      state.flags |= 128;
    } else {
      // The native closest-line result here does not update frame translation.
      closestLines(state.linePoint, state.lineDirection, point, direction);
      secondaryDirection(state, direction, axis);
      state.secondaryAxis = remainingAxis();
      state.planeNormal = column(state.matrix, state.secondaryAxis);
      state.flags |= 256;
      state.secondaryAxis = axis;
    }
  } else {
    let anchor: number[] | undefined;
    if (!(state.flags & 2)) {
      const hit = intersection();
      anchor = hit
        ? projectLine(hit, state.linePoint, state.lineDirection)
        : closestLines(state.linePoint, state.lineDirection, point, direction);
    } else {
      anchor = closestLines(
        state.linePoint,
        state.lineDirection,
        point,
        direction,
      );
      if (!anchor)
        anchor = projectLine(
          intersection() ?? [0, 0, 0],
          state.linePoint,
          state.lineDirection,
        );
    }
    state.anchor = anchor ?? [0, 0, 0];
    translate(state, state.anchor);
    state.flags |= 64;
  }
  state.stage = 2;
  return { accepted: true, state };
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
