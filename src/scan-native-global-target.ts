export interface RawGlobalTarget {
  point: readonly number[];
  normal: readonly number[];
  flags: number;
  labelWord: number;
}
export interface EvaluatedGlobalTarget {
  point: readonly number[];
  normal: readonly number[];
  signedDistance: number;
  edgeFlags: number;
  /** Bit i records whether the projected triangle's edge i has a neighbour. */
  neighbours: number;
  found: boolean;
}

/** The original comparison uses label words, not IEEE floating-point equality. */
export function nativeGlobalRawTargetMatches(
  sourceLabelWord: number,
  targetLabelWord: number,
  flags: number,
  mask: number,
) {
  return (flags & mask) === 0 && sourceLabelWord === targetLabelWord;
}

/** Arbitration from original 0x140ae87d0 after the geometric searches complete.
 * Inputs are already-prepared local-space records, in native evaluator order.
 * The caller owns radius-limited searches, readiness and immutable carriers.
 * Rejected boundary hits retain the raw candidate, not a farther evaluator.
 */
export function nativeGlobalTargetChoice(
  query: readonly number[],
  raw: RawGlobalTarget | undefined,
  evaluators: readonly EvaluatedGlobalTarget[],
  sourceLabelWord = 0,
  mask = 0,
): RawGlobalTarget | EvaluatedGlobalTarget | undefined {
  const fallback =
    raw &&
    nativeGlobalRawTargetMatches(
      sourceLabelWord,
      raw.labelWord,
      raw.flags,
      mask,
    )
      ? raw
      : undefined;
  let distance = Math.fround(3.4028234663852886e38);
  if (fallback) {
    const x = fallback.point[0] - query[0],
      y = fallback.point[1] - query[1],
      z = fallback.point[2] - query[2];
    distance = x * x + y * y + z * z;
  }
  let selected: EvaluatedGlobalTarget | undefined;
  for (const evaluator of evaluators) {
    const candidateDistance = Math.abs(evaluator.signedDistance);
    if (evaluator.found && candidateDistance < distance) {
      distance = candidateDistance;
      selected = evaluator;
    }
  }
  if (!selected || (selected.edgeFlags & ~selected.neighbours & 7) !== 0)
    return fallback;
  return selected;
}
