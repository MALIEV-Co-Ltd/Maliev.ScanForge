import type { ScanBoundaryPath } from "./scan-boundary-edges";

/** A bridge owns only an edge drag; camera navigation remains available elsewhere. */
export interface ScanBridgeSession {
  boundary: ScanBoundaryPath;
  onGesture(
    phase: "preview" | "commit" | "cancel",
    start: number,
    end: number | null,
  ): void;
}
