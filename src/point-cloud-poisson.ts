import { preparePointCloudNormals } from "./point-cloud-normals";
import { reconstructPoisson } from "./poisson-reconstruction";
import {
  validatePointCloudPoissonInput,
  type PointCloudPoissonRequest,
} from "./point-cloud-poisson-input";

/** Shared worker pipeline; the source cloud remains immutable and publication belongs to the application executor. */
export async function meshPointCloudPoisson(
  request: PointCloudPoissonRequest,
  progress: (fraction: number, stage: string) => void = () => {},
) {
  const options = validatePointCloudPoissonInput(request);
  progress(0, "Preparing oriented Poisson normals");
  const positions =
    request.positions instanceof Float32Array
      ? request.positions
      : Float32Array.from(request.positions);
  const supplied = request.normals
    ? Float32Array.from(request.normals)
    : undefined;
  const prepared = preparePointCloudNormals(positions, supplied, {
    mode: options.normalMode,
    neighbors: options.normalNeighbors,
    viewpoint: options.viewpoint,
    onProgress: (fraction) =>
      progress(fraction * 0.25, "Preparing oriented Poisson normals"),
  });
  const { density: _density, ...mesh } = await reconstructPoisson(
    { ...options, positions, normals: prepared.normals },
    (fraction, stage) => progress(0.25 + fraction * 0.74, stage),
  );
  return {
    ...mesh,
    diagnostics: {
      ...mesh.diagnostics,
      normalMode: prepared.diagnostics.mode,
      normalNeighbors: prepared.diagnostics.neighbors,
      normalComponents: prepared.diagnostics.components,
      normalOrientationAnchors:
        prepared.diagnostics.orientationAnchors ??
        (options.normalMode === "provided" ? positions.length / 3 : 0),
      normalInvalidOrientationAnchors:
        prepared.diagnostics.invalidOrientationAnchors ?? 0,
      normalOrientationAssumption: prepared.diagnostics.orientationAssumption,
    },
  };
}
