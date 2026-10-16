import type { ScanBoundaryPath } from "./scan-boundary-edges";

/** Inventory references stay stable for both open paths and closed holes. */
export interface ScanBridgeEndpoint {
  boundary: number;
  edge: number;
}
/** A bridge owns only an edge drag; camera navigation remains available elsewhere. */
export interface ScanBridgeSession {
  mode?: "bridge" | "holes";
  onSelectBoundary?(boundary: number): void;
  /** Attempt an entire-hole fill using the picked inventory boundary. */
  onFillBoundary?(boundary: number): void;
  boundaries: readonly ScanBoundaryPath[];
  onGesture(
    phase: "preview" | "commit" | "cancel",
    start: ScanBridgeEndpoint,
    end: ScanBridgeEndpoint | null,
  ): void;
}
