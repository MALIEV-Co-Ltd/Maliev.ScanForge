import { ALIGNMENT_QUERY_SENTINEL } from "./scan-native-alignment-query";

/** Native bootstrap correspondence centering; this stage returns an identity pose. */
export function nativeCenterAlignmentCorrespondences(
  pairs: readonly (readonly number[])[],
) {
  if (pairs.some((pair) => pair.length !== 6))
    throw new Error(
      "Alignment correspondence records require six coordinates.",
    );
  const correspondences = pairs.map((pair) => pair.map(Math.fround));
  const valid = (pair: readonly number[]) =>
    !Number.isNaN(pair[3]) &&
    Math.abs(Math.fround(pair[3] - ALIGNMENT_QUERY_SENTINEL)) >= 2 ** -23;
  const sums = [0, 0, 0, 0, 0, 0];
  let count = 0;
  for (const pair of correspondences) {
    if (!valid(pair)) continue;
    count++;
    for (let axis = 0; axis < 6; axis++) sums[axis] += pair[axis];
  }
  if (count) {
    const reciprocal = 1 / count;
    const centers = sums.map((sum) => Math.fround(sum * reciprocal));
    for (const pair of correspondences) {
      if (!valid(pair)) continue;
      for (let axis = 0; axis < 6; axis++)
        pair[axis] = Math.fround(pair[axis] - centers[axis]);
    }
  }
  return {
    correspondences,
    matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
  };
}
