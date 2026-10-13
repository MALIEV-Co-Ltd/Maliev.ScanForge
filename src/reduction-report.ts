/** Signed original-vertex samples against the reduced surface, in unchanged coordinates. */
export interface ReductionStatistics {
  minimum: number | null;
  maximum: number | null;
  rms: number | null;
  percentage: number;
  total: number;
  matched: number;
  within: number;
  unmatched: number;
  tolerance: number;
  originalTriangles?: number;
  reducedTriangles?: number;
}

/** Map nested stages into one range; stage transitions never rewind the bar. */
export function linearProgress(
  report?: (fraction: number, stage: string) => void,
) {
  let last = 0;
  return (start: number, end: number) => (fraction: number, stage: string) => {
    if (!Number.isFinite(fraction)) return;
    last = Math.max(
      last,
      start + Math.min(1, Math.max(0, fraction)) * (end - start),
    );
    report?.(last, stage);
  };
}
