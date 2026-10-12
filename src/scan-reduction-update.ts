import {
  reductionCandidate,
  type ReductionVertex,
} from "./scan-reduction-candidate";
import type {
  ReductionFace,
  ReductionReference,
} from "./scan-reduction-validity";
import type { Vec3 } from "./types";

export interface ReductionWorkingFace extends ReductionFace {
  errors: Vec3;
  bestEdge: number;
  dirty: boolean;
}

/** Native ordered incidence update after a collapse has passed both validity checks. */
export function updateReductionFaces(
  retained: number,
  vertices: readonly ReductionVertex[],
  faces: ReductionWorkingFace[],
  references: readonly ReductionReference[],
  deletionMask: Uint32Array,
  appended: ReductionReference[],
  deletedCount: number,
): number {
  // The native source range is fixed while successors are appended to its vector.
  const count = references.length;
  for (let index = 0; index < count; index++) {
    const reference = references[index],
      face = faces[reference.face];
    if (face.deleted) continue;
    if ((deletionMask[index >>> 5] >>> (index & 31)) & 1) {
      face.deleted = true;
      deletedCount = (deletedCount + 1) | 0;
      continue;
    }
    face.vertices[reference.corner] = retained;
    face.dirty = true;
    const [a, b, c] = face.vertices;
    const e0 = reductionCandidate(vertices[a], vertices[b]).cost;
    const e1 = reductionCandidate(vertices[b], vertices[c]).cost;
    const e2 = reductionCandidate(vertices[c], vertices[a]).cost;
    face.errors = [e0, e1, e2];
    face.bestEdge = e1 <= e0 ? (e2 <= e1 ? 2 : 1) : e2 <= e0 ? 2 : 0;
    appended.push({ ...reference });
  }
  return deletedCount;
}
