import {
  copyReferenceGeometry,
  type ReferenceVector,
} from "./reference-construction-values";

/** Raw provider results in original traversal order, before eligibility checks. */
export interface ProjectedReferenceCandidate {
  /** Failure sentinel, NaN and overflow results are deliberately retained. */
  readonly projection: ReferenceVector;
}

/**
 * Recover the winning projection index only. Provider geometry/extent extraction
 * remains separate: selection does not establish an OpenCascade/alternate-provider
 * correspondence or permit retrying a farther geometrically eligible candidate.
 */
export function selectProjectedReferenceCandidate(
  source: readonly ProjectedReferenceCandidate[],
  pick: ReferenceVector,
): number | undefined {
  if (!Array.isArray(source)) throw new Error("Invalid projection collection.");
  const checked = copyReferenceGeometry({ kind: "point", position: pick });
  if (checked.kind !== "point") throw new Error("Expected reference pick.");
  const picked = checked.position.map(Math.fround);
  if (!picked.every(Number.isFinite))
    throw new Error("Reference pick requires finite Float32 coordinates.");
  const maxFloat = 3.4028234663852886e38;
  let closestSquared = maxFloat;
  let winner: number | undefined;
  for (let index = 0; index < source.length; index++) {
    const projected = source[index]?.projection;
    if (
      !Array.isArray(projected) ||
      projected.length !== 3 ||
      Array.from(projected).some((value) => typeof value !== "number")
    )
      throw new Error("Invalid projection coordinates.");
    const [x, y, z] = projected;
    const sentinelDistance = Math.abs(Math.fround(Math.fround(x) - maxFloat));
    if (Number.isNaN(x) || !(2 ** -23 <= sentinelDistance)) continue;
    const dx = x - picked[0],
      dy = y - picked[1],
      dz = z - picked[2];
    const squared = dx * dx + dy * dy + dz * dz;
    if (squared < closestSquared) {
      closestSquared = squared;
      winner = index;
    }
  }
  return winner;
}
