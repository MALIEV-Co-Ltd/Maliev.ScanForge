import { bindShrinkwrap } from "../shrinkwrap-request";
import {
  reconstructionTargets,
  bindNativeReconstruction,
} from "../scan-reconstruction-targets";
import { bindAverageMeshes } from "../scan-average-request";
import type { Entity } from "../types";
import type { ScanToolsRequest, ScanToolOperation } from "../scan-tools";
import type { ScanToolParameters } from "./ScanToolsPanel";
import { mirrorReference, cylinderReference } from "../scan-tools-reference";

/** Bind references at execution time, never silently convert an exact body into a mesh. */
export function scanToolRequest(
  source: Entity,
  parameters: ScanToolParameters,
  entities: Entity[],
  selection?: Uint8Array | null,
): ScanToolsRequest {
  if (source.kind !== "mesh" || source.kernelId || source.parametric)
    throw new Error(
      "Create a separate mesh copy before using Scan Data tools on CAD.",
    );
  let operation: ScanToolOperation;
  switch (parameters.kind) {
    case "shrinkwrap": {
      operation = bindShrinkwrap(source, parameters, entities, selection);
      break;
    }
    case "repolygonize": {
      if (parameters.method !== "voxel") {
        const bound = bindNativeReconstruction(
          source,
          parameters.targetIds,
          entities,
        );
        return {
          kind: "scanTools",
          positions: bound.source.positions,
          operation: {
            kind: "repolygonize",
            resolution: parameters.resolution,
            ...(parameters.method !== undefined
              ? { method: parameters.method }
              : {}),
            targets: bound.references.map((e) => e.positions),
            ...(bound.source.indexedMesh
              ? { sourceTopology: bound.source.indexedMesh }
              : {}),
            ...(bound.references.some((e) => e.indexedMesh)
              ? { targetTopology: bound.references.map((e) => e.indexedMesh) }
              : {}),
          },
        };
      }
      const targets = (parameters.targetIds ?? []).map((id) => {
        const entity = entities.find((e) => e.id === id);
        if (!entity)
          throw new Error("Reconstruction reference no longer exists.");
        return entity;
      });
      operation = {
        kind: parameters.kind,
        resolution: parameters.resolution,
        method: "voxel",
        targets: reconstructionTargets(source, targets),
      };
      break;
    }
    case "averageMesh": {
      const bound = bindAverageMeshes(source, parameters.targetIds, entities);
      operation = {
        kind: parameters.kind,
        tolerance: parameters.tolerance,
        targets: bound.references.map((e) => e.positions),
        sourceTopology: bound.source.indexedMesh,
        targetTopology: bound.references.map((e) => e.indexedMesh),
      };
      return {
        kind: "scanTools",
        positions: bound.source.positions,
        operation,
      };
    }
    case "mirrorMesh": {
      const entity = entities.find(
        (e) => e.id === parameters.referenceId && e.id !== source.id,
      );
      const reference =
        parameters.plane === "object"
          ? entity && mirrorReference(entity)
          : {
              center: [0, 0, 0] as [number, number, number],
              normal:
                parameters.plane === "OXY"
                  ? ([0, 0, 1] as [number, number, number])
                  : parameters.plane === "OYZ"
                    ? ([1, 0, 0] as [number, number, number])
                    : ([0, 1, 0] as [number, number, number]),
            };
      if (!reference)
        throw new Error("Choose a planar CAD or construction object.");
      operation = { kind: parameters.kind, ...reference };
      break;
    }
    case "unroll": {
      const entity = entities.find(
        (e) => e.id === parameters.cylinderId && e.id !== source.id,
      );
      const reference = entity && cylinderReference(entity);
      if (!reference)
        throw new Error("Choose a cylinder reference for unroll.");
      operation = {
        kind: parameters.kind,
        ...reference,
        offsetDegrees: parameters.offsetDegrees,
        instances: parameters.instances,
      };
      break;
    }
    case "reduceNoise":
      if (
        parameters.selectionOnly &&
        (!selection ||
          selection.length !== source.positions.length / 9 ||
          !selection.some(Boolean))
      )
        throw new Error(
          "Select triangles before reducing noise on a selection.",
        );
      operation = {
        ...parameters,
        selection: parameters.selectionOnly
          ? new Uint8Array(selection!)
          : undefined,
      };
      break;
    default:
      operation = parameters;
  }
  return { kind: "scanTools", positions: source.positions, operation };
}
