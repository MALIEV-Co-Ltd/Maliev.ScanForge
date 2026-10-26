import type { Entity } from "./types";
import {
  processMesh,
  type ProcessingRequest,
  type ProcessingOptions,
  type ProcessingResult,
} from "./processing-client";
import { createDatumTransformExecutor } from "./datum-transform-pool";
import { cloudPlacement, cloudPoseMatrix } from "./point-cloud-placement";

/** Shared GUI/MCP registration: solve in the processing worker, then compose a
 * cloud's native double pose over immutable local buffers rather than re-rounding
 * an already materialized world view. Large transforms use the bounded CPU pool.
 */
export async function processScanRegistration(
  source: Entity,
  request: ProcessingRequest,
  options: ProcessingOptions & {
    parallel?: boolean;
    workerCount?: number;
    check?: () => void;
  } = {},
): Promise<ProcessingResult> {
  if (
    source.kind !== "pointcloud" ||
    (request.kind !== "paired" &&
      request.kind !== "icp" &&
      request.kind !== "global")
  )
    return processMesh(request, options);
  if (request.positions !== source.positions)
    throw new Error(
      "Point-cloud registration moves the whole source; omit selectionOnly.",
    );
  options.signal?.throwIfAborted();
  options.check?.();
  const parallel =
    options.parallel ??
    (request.kind === "paired" ? request.parallel : undefined) ??
    true;
  const lanes =
    options.workerCount ??
    (request.kind === "paired" ? request.workerCount : undefined) ??
    2;
  const placement = request.kind === "icp" ? cloudPlacement(source) : undefined;
  const outputPlacement =
    request.kind === "icp"
      ? {
          sourcePositions:
            placement?.sourcePositions ??
            (source.positions instanceof Float32Array
              ? source.positions
              : new Float32Array(source.positions)),
          matrix: placement
            ? cloudPoseMatrix(placement.matrixBits)
            : [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0],
        }
      : undefined;
  if (!Number.isInteger(lanes) || lanes < 1 || lanes > 16)
    throw new Error(
      "Point-cloud registration requires one to sixteen logical lanes.",
    );
  const result = await processMesh(
    {
      ...request,
      ...(request.kind === "icp" ? { outputPlacement } : {}),
      // Paired registration needs only the picked coordinates, not millions of points.
      positions: request.kind === "paired" ? [] : request.positions,
      deferCloudTransform: true,
    },
    {
      ...options,
      onProgress: (fraction, stage) =>
        options.onProgress?.(fraction * 0.4, stage),
    },
  );
  if (!result.registration)
    throw new Error("Point-cloud registration returned no transform.");
  options.signal?.throwIfAborted();
  options.check?.();
  const { rotation: r, translation: t } = result.registration.transform;
  const matrix = [
    r[0],
    r[1],
    r[2],
    t[0],
    r[3],
    r[4],
    r[5],
    t[1],
    r[6],
    r[7],
    r[8],
    t[2],
  ];
  const executor = createDatumTransformExecutor({
    signal: options.signal,
    parallel: parallel && lanes > 1,
  });
  try {
    options.onProgress?.(0.4, "Applying native point-cloud pose");
    const transformed = await executor.transformScan(source, matrix);
    options.signal?.throwIfAborted();
    options.check?.();
    options.onProgress?.(1, "Point-cloud alignment complete");
    return {
      ...result,
      positions: transformed.entity.positions as Float32Array,
      cloudPreview: transformed.entity,
      diagnostics: {
        ...result.diagnostics,
        localBuffersRetained: true,
        pointCloudPose: transformed.entity.pointCloudPlacement!.matrixBits,
        points: source.positions.length / 3,
        physicalWorkers: Math.max(1, transformed.execution.physicalWorkers),
        transformWorkers: transformed.execution.physicalWorkers,
        logicalLanes: lanes,
        ...(transformed.execution.fallbackReason
          ? { fallbackReason: transformed.execution.fallbackReason }
          : {}),
      },
    };
  } finally {
    executor.close();
  }
}
