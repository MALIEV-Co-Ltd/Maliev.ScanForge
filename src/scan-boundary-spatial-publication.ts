import type { SavedSketch } from "./types";
import type { SpatialBoundaryCurve } from "./scan-boundary-spatial";
import { validateSpatialCurves } from "./spatial-sketch";

export function spatialBoundarySketch(
  curves: SpatialBoundaryCurve[],
  id: () => string = () => crypto.randomUUID(),
): SavedSketch {
  validateSpatialCurves(curves);
  return {
    id: id(),
    name: "3D boundary sketch",
    kind: "spatial",
    visible: true,
    curves: structuredClone(curves),
  };
}
