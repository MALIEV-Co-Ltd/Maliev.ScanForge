import type { Vec3 } from "./types";

export interface ReductionFace {
  vertices: [number, number, number];
  normal: Vec3;
  deleted: boolean;
}
export interface ReductionReference {
  face: number;
  corner: number;
}

function normalize(v: Vec3): Vec3 {
  const length = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
  if (length >= Number.EPSILON) {
    const reciprocal = 1 / length;
    return [v[0] * reciprocal, v[1] * reciprocal, v[2] * reciprocal];
  }
  return v;
}

/** Returns rejection and updates only visited incidence-mask bits, in native order. */
export function rejectReductionCollapse(
  point: Vec3,
  other: number,
  vertices: ArrayLike<number>,
  faces: readonly ReductionFace[],
  references: readonly ReductionReference[],
  deletionMask: Uint32Array,
): boolean {
  for (let index = 0; index < references.length; index++) {
    const reference = references[index],
      face = faces[reference.face];
    if (face.deleted) continue;
    const a = face.vertices[(reference.corner + 1) % 3];
    const b = face.vertices[(reference.corner + 2) % 3];
    const word = index >>> 5,
      bit = 1 << (index & 31);
    if (a === other || b === other) {
      deletionMask[word] |= bit;
      continue;
    }
    const u = normalize([
      vertices[a * 3] - point[0],
      vertices[a * 3 + 1] - point[1],
      vertices[a * 3 + 2] - point[2],
    ]);
    const v = normalize([
      vertices[b * 3] - point[0],
      vertices[b * 3 + 1] - point[1],
      vertices[b * 3 + 2] - point[2],
    ]);
    if (Math.abs(v[1] * u[1] + u[0] * v[0] + v[2] * u[2]) > 0.999) return true;
    const normal = normalize([
      v[2] * u[1] - v[1] * u[2],
      u[2] * v[0] - v[2] * u[0],
      v[1] * u[0] - u[1] * v[0],
    ]);
    deletionMask[word] &= ~bit;
    if (
      normal[1] * face.normal[1] +
        normal[0] * face.normal[0] +
        normal[2] * face.normal[2] <
      0.2
    )
      return true;
  }
  return false;
}
