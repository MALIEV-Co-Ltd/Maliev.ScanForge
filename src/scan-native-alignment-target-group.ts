import {
  ALIGNMENT_QUERY_SENTINEL,
  type AlignmentQueryHit,
} from "./scan-native-alignment-query";
export type NativeAlignmentTargetQuery = (
  point: readonly number[],
  radius: number,
) => AlignmentQueryHit | undefined;
/** Original query workers keep the first target at equal absolute distances.
 * Each target receives the original search radius, not the preceding hit distance.
 */
export function nativeAlignmentTargetGroupQuery(
  targets: readonly NativeAlignmentTargetQuery[],
): NativeAlignmentTargetQuery {
  return (point, radius) => {
    let closest: AlignmentQueryHit | undefined;
    let best = ALIGNMENT_QUERY_SENTINEL;
    for (const query of targets) {
      const hit = query(point, radius);
      if (hit && Math.abs(hit.distance) < best) {
        best = Math.abs(hit.distance);
        closest = hit;
      }
    }
    return closest;
  };
}
