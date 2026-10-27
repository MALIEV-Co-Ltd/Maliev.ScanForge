import {
  flipSourceTopology,
  flipSourceTopologySync,
} from "../scan-flip-request";
import { bindShrinkwrap } from "../shrinkwrap-request";
import {
  reconstructionTargets,
  reconstructionScanInputs,
  reconstructionMethod,
  bindNativeReconstruction,
} from "../scan-reconstruction-targets";
import { bindAverageMeshes } from "../scan-average-request";
import type { Entity, IndexedMesh } from "../types";
import type { ScanToolsRequest, ScanToolOperation } from "../scan-tools";
import type { ScanToolParameters } from "./ScanToolsPanel";
import { mirrorReference, cylinderReference } from "../scan-tools-reference";

/** Bind references at execution time, never silently convert an exact body into a mesh. */
export function scanToolRequest(
  source: Entity,
  parameters: ScanToolParameters,
  entities: Entity[],
  selection?: Uint8Array | null,
  preparedFlip?: { topology: IndexedMesh | undefined },
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
  let positions = source.positions;
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
      const method = reconstructionMethod(source, targets, parameters.method);
      if (method === "native") {
        const bound = bindNativeReconstruction(
          source,
          parameters.targetIds,
          entities,
        );
        positions = bound.source.positions;
        operation = {
          kind: parameters.kind,
          resolution: parameters.resolution,
          method,
          sourceTopology: bound.source.indexedMesh,
          targetTopology: bound.references.map((e) => e.indexedMesh),
          targets: bound.references.map((e) => e.positions),
        };
      } else
        operation =
          source.kind === "pointcloud" ||
          targets.some((e) => e.kind === "pointcloud")
            ? {
                kind: parameters.kind,
                resolution: parameters.resolution,
                method,
                inputKind:
                  source.kind === "pointcloud" ? "points" : "triangles",
                targetInputs: reconstructionScanInputs(source, targets),
              }
            : {
                kind: parameters.kind,
                resolution: parameters.resolution,
                method,
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
    case "flipNormals":
      operation = {
        kind: "flipNormals",
        sourceTopology: preparedFlip
          ? preparedFlip.topology
          : flipSourceTopologySync(source),
      };
      break;
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
  return { kind: "scanTools", positions, operation };
}

/** Yield while binding large indexed Flip inputs before processing begins. */
export async function stagedScanToolRequest(
  source: Entity,
  parameters: ScanToolParameters,
  entities: Entity[],
  selection: Uint8Array | null | undefined,
  check: () => void,
  progress?: (fraction: number, stage: string) => void,
): Promise<ScanToolsRequest> {
  const preparedFlip =
    parameters.kind === "flipNormals"
      ? { topology: await flipSourceTopology(source, check, progress) }
      : undefined;
  check();
  return scanToolRequest(source, parameters, entities, selection, preparedFlip);
}
