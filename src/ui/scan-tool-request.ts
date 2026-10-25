import { bindShrinkwrap } from "../shrinkwrap-request";
import {
  reconstructionTargets,
  reconstructionScanInputs,
} from "../scan-reconstruction-targets";
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
  if (
    (source.kind !== "mesh" &&
      !(source.kind === "pointcloud" && parameters.kind === "repolygonize")) ||
    source.kernelId ||
    source.parametric
  )
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
      const targets = (parameters.targetIds ?? []).map((id) => {
        const entity = entities.find((e) => e.id === id);
        if (!entity)
          throw new Error("Reconstruction reference no longer exists.");
        return entity;
      });
      operation =
        source.kind === "pointcloud" ||
        targets.some((e) => e.kind === "pointcloud")
          ? {
              kind: parameters.kind,
              resolution: parameters.resolution,
              inputKind: source.kind === "pointcloud" ? "points" : "triangles",
              targetInputs: reconstructionScanInputs(source, targets),
            }
          : {
              kind: parameters.kind,
              resolution: parameters.resolution,
              targets: reconstructionTargets(source, targets),
            };
      break;
    }
    case "averageMesh": {
      const ids = new Set(parameters.targetIds);
      const targets = entities.filter(
        (e) =>
          ids.has(e.id) &&
          e.id !== source.id &&
          e.kind === "mesh" &&
          !e.kernelId &&
          !e.parametric,
      );
      if (!ids.size || targets.length !== ids.size)
        throw new Error("Choose valid reference meshes to average.");
      operation = {
        kind: parameters.kind,
        tolerance: parameters.tolerance,
        targets: targets.map((e) => e.positions),
      };
      break;
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
