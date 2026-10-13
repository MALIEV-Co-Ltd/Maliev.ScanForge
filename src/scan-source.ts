export interface ScanSourceCounts {
  bytes: number;
  triangles: number;
  displayedTriangles: number;
  /** Full accepted geometry after native facet rejection, when known. */
  acceptedTriangles?: number;
}

/** Legacy previews lack accepted counts; native facet rejection is not sampling. */
export function isSampledScan(source?: ScanSourceCounts) {
  return (
    !!source &&
    source.displayedTriangles < (source.acceptedTriangles ?? source.triangles)
  );
}
