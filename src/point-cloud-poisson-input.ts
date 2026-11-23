import type { Positions } from "./types";
import type { PointCloudNormalMode } from "./point-cloud-normals";

export const POINT_CLOUD_POISSON_MAX_POINTS = 500_000;
export interface PointCloudPoissonOptions {
  normalMode?: PointCloudNormalMode;
  normalNeighbors?: number;
  viewpoint?: readonly [number, number, number];
  depth?: number;
  pointWeight?: number;
  samplesPerNode?: number;
  densityThreshold?: number;
}
export interface PointCloudPoissonRequest extends PointCloudPoissonOptions {
  kind: "pointCloudPoisson";
  positions: Positions;
  /** Bound from the source entity; never accepted from agent operation arguments. */
  normals?: Positions;
}

/** Cheap admission runs before worker creation; numeric sample validation runs before WASM allocation. */
export function validatePointCloudPoissonInput(
  request: PointCloudPoissonRequest,
) {
  const count = request.positions.length / 3;
  if (
    !Number.isInteger(count) ||
    count < 3 ||
    count > POINT_CLOUD_POISSON_MAX_POINTS
  )
    throw Error(
      "Poisson reconstruction requires 3 to 500,000 points; reduce the cloud first.",
    );
  const {
    normalMode = "provided",
    normalNeighbors = 24,
    depth = 8,
    pointWeight = 2,
    samplesPerNode = 1.5,
    densityThreshold = 0,
  } = request;
  if (
    ![
      "provided",
      "estimate-provided",
      "estimate-outward",
      "estimate-viewpoint",
    ].includes(normalMode)
  )
    throw Error(
      "Choose provided, estimate-provided, estimate-outward or estimate-viewpoint Poisson normals.",
    );
  if (
    (normalMode === "provided" || normalMode === "estimate-provided") &&
    request.normals?.length !== request.positions.length
  )
    throw Error(
      "Provided Poisson normals must match the point count; choose an explicit normal estimation mode otherwise.",
    );
  if (
    !Number.isInteger(normalNeighbors) ||
    normalNeighbors < 8 ||
    normalNeighbors > 48
  )
    throw Error("Poisson normal neighbors must be an integer from 8 to 48.");
  if (
    normalMode === "estimate-viewpoint" &&
    (!request.viewpoint ||
      request.viewpoint.length !== 3 ||
      !request.viewpoint.every(Number.isFinite))
  )
    throw Error(
      "Viewpoint orientation requires a finite XYZ scanner viewpoint in world millimeters.",
    );
  if (!Number.isInteger(depth) || depth < 6 || depth > 10)
    throw Error("Poisson depth must be an integer from 6 to 10.");
  for (const [name, value, min, max] of [
    ["Point weight", pointWeight, 0, 100],
    ["Samples per node", samplesPerNode, 0.1, 100],
    ["Density threshold", densityThreshold, 0, 32],
  ] as const)
    if (!Number.isFinite(value) || value < min || value > max)
      throw Error(`${name} must be finite and between ${min} and ${max}.`);
  return {
    ...request,
    normalMode,
    normalNeighbors,
    depth,
    pointWeight,
    samplesPerNode,
    densityThreshold,
  };
}
