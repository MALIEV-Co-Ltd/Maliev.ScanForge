import type { Entity, Vec3 } from "./types";

export interface DatumPrimitive {
  kind: "point" | "line" | "plane" | "sphere" | "cylinder" | "cone";
  center: Vec3;
  direction?: Vec3;
  tangent?: Vec3;
  radius?: number;
  dimensions?: number[];
}
/** Recovered double-precision geometry handlers; display vertices are separate. */
export function nativeDatumTransformPrimitive(
  input: DatumPrimitive,
  matrix: readonly number[],
) {
  const vectors = [input.center, input.direction, input.tangent].filter(
    (v): v is Vec3 => !!v,
  );
  if (
    matrix.length !== 12 ||
    !matrix.every(Number.isFinite) ||
    vectors.some((v) => v.length !== 3 || !v.every(Number.isFinite))
  )
    throw new Error(
      "Primitive alignment requires finite frame and geometry values.",
    );
  const rotate = (v: Vec3): Vec3 =>
    [0, 4, 8].map(
      (r) => v[0] * matrix[r] + v[1] * matrix[r + 1] + v[2] * matrix[r + 2],
    ) as Vec3;
  const normalize = (v: Vec3): Vec3 => {
    const length = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    return length >= Number.EPSILON
      ? (v.map((value) => value * (1 / length)) as Vec3)
      : v;
  };
  const center = rotate(input.center).map(
    (value, i) => value + matrix[i * 4 + 3],
  ) as Vec3;
  let direction = input.direction ? rotate(input.direction) : undefined,
    tangent = input.tangent ? rotate(input.tangent) : undefined;
  let planeD: number | undefined;
  if (input.kind === "plane") {
    if (!direction) throw new Error("Plane alignment requires a normal.");
    if (tangent) {
      const n = direction,
        t = tangent,
        c = [
          n[2] * t[1] - n[1] * t[2],
          n[0] * t[2] - n[2] * t[0],
          n[1] * t[0] - n[0] * t[1],
        ];
      tangent = normalize([
        c[2] * n[1] - c[1] * n[2],
        c[0] * n[2] - c[2] * n[0],
        c[1] * n[0] - c[0] * n[1],
      ]);
    }
    direction = normalize(direction);
    planeD = -(
      center[1] * direction[1] +
      center[0] * direction[0] +
      center[2] * direction[2]
    );
  }
  if (
    [...center, ...(direction ?? []), ...(tangent ?? [])].some(
      (value) => !Number.isFinite(value) || Math.abs(value) > 1e9,
    )
  )
    throw new Error(
      "Aligned primitive coordinates exceed the supported range.",
    );
  return { ...input, center, direction, tangent, planeD };
}

/** Rigid movement preserves scalar fit parameters and residuals, with owned frames. */
export function datumFeatureMetadata(
  entity: Entity,
  matrix: readonly number[],
) {
  let fit = entity.fit,
    planeFrame = entity.planeFrame;
  if (fit) {
    const moved = nativeDatumTransformPrimitive(
      {
        kind: fit.kind,
        center: fit.center,
        direction: fit.kind === "sphere" ? undefined : fit.axis,
      },
      matrix,
    );
    fit = {
      ...fit,
      center: moved.center,
      axis: moved.direction ?? [...fit.axis],
    };
  }
  if (planeFrame) {
    const moved = nativeDatumTransformPrimitive(
      {
        kind: "plane",
        center: planeFrame.center,
        direction: planeFrame.normal,
        tangent: planeFrame.tangent,
      },
      matrix,
    );
    planeFrame = {
      center: moved.center,
      normal: moved.direction!,
      tangent: moved.tangent!,
    };
  }
  return { fit, planeFrame };
}
